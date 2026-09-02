import {
  getWorkstationCells,
  isInConstructionBounds,
  type ConstructionLayout,
  type GridPoint,
} from './construction'
import {
  carriedConstructionMaterial,
  constructionMaterialAccountedFor,
  type ConstructionOrder,
  type ConstructionTravelPhase,
} from './constructionJobs'
import {
  findConstructionPressureReturnPath,
  findConstructionOrderApproachPath,
  findConstructionPath,
  getConstructionApproachCells,
  isConstructionCellWalkable,
  type ConstructionPathfindingOptions,
} from './constructionPathfinding'
import {
  analyzeConstructionPressure,
  constructionEnvironmentAt,
  type ConstructionPressureTopology,
} from './pressureTopology'

export interface ConstructionCrewPosition {
  crewId: string
  cell: GridPoint
  /** Fractional progress toward the next cardinal tile. */
  moveCredit: number
}

export interface ConstructionRoutingWorker {
  id: string
  canConstruct?: boolean
  /** Defaults to the legacy construction eligibility when omitted. */
  canHaul?: boolean
  movementRate?: number
  /** Higher values receive newly available jobs first. */
  dispatchPriority?: number
  /** Optional hauling-specific override for dispatch ordering. */
  haulingPriority?: number
  /** Explicit false prevents this worker from entering an airlock or vacuum. */
  hasEvaSuit?: boolean
}

export type RoutableConstructionOrder = ConstructionOrder & {
  travelPhase: ConstructionTravelPhase
  prerequisiteOrderIds?: string[]
}

export interface ConstructionAtSiteWorker {
  crewId: string
  orderId: string
  /** Simulation time left after travel during this update. */
  availableWorkTime: number
}

export interface ConstructionRoutingInput {
  layout: ConstructionLayout
  orders: readonly RoutableConstructionOrder[]
  crewPositions: readonly ConstructionCrewPosition[]
  workers: readonly ConstructionRoutingWorker[]
  stockpile: GridPoint
  /** Internal fast path for the simulation, which normalizes the pallet first. */
  stockpileIsNormalized?: boolean
  /** Live module cells that need EVA despite belonging to a sealed room shell. */
  evaRequiredCells?: readonly GridPoint[]
  elapsed: number
}

export interface ConstructionRoutingResult {
  orders: RoutableConstructionOrder[]
  crewPositions: ConstructionCrewPosition[]
  atSiteWorkers: ConstructionAtSiteWorker[]
  noPathOrderIds: string[]
  /** Structurally reachable orders for which available candidates need EVA. */
  evaRequiredOrderIds: string[]
}

const DEFAULT_MOVEMENT_RATE = 3
const MOVEMENT_EPSILON = 0.000_001

const pointKey = ({ x, y }: GridPoint) => `${x}:${y}`

const clonePoint = ({ x, y }: GridPoint): GridPoint => ({ x, y })

const comparePoints = (left: GridPoint, right: GridPoint) =>
  left.y - right.y || left.x - right.x

const compareIds = (left: string, right: string) => left.localeCompare(right)

const compareOrders = (left: ConstructionOrder, right: ConstructionOrder) =>
  right.priority - left.priority || left.sequence - right.sequence || compareIds(left.id, right.id)

const finiteNonnegative = (value: number) =>
  Number.isFinite(value) ? Math.max(0, value) : 0

const workerCanConstruct = (worker: ConstructionRoutingWorker) =>
  worker.canConstruct !== false

const workerCanHaul = (worker: ConstructionRoutingWorker) =>
  worker.canHaul ?? workerCanConstruct(worker)

const workerDispatchPriority = (
  worker: ConstructionRoutingWorker,
  phase: ConstructionTravelPhase,
) => finiteNonnegative(
  phase === 'to_stockpile'
    ? worker.haulingPriority ?? worker.dispatchPriority ?? 0
    : worker.dispatchPriority ?? 0,
)

const cloneOrder = (order: RoutableConstructionOrder): RoutableConstructionOrder => ({
  ...order,
  prerequisiteOrderIds: [...(order.prerequisiteOrderIds ?? [])],
  target: order.target.kind === 'boundary'
    ? {
        ...order.target,
        cells: [{ ...order.target.cells[0] }],
        construct: order.target.construct ? { ...order.target.construct } : null,
        deconstruct: order.target.deconstruct ? { ...order.target.deconstruct } : null,
      }
    : {
        ...order.target,
        cells: order.target.cells.map(clonePoint),
        construct: order.target.construct
          ? {
              ...order.target.construct,
              origin: clonePoint(order.target.construct.origin),
              size: { ...order.target.construct.size },
            }
          : null,
        deconstruct: order.target.deconstruct
          ? {
              ...order.target.deconstruct,
              origin: clonePoint(order.target.deconstruct.origin),
              size: { ...order.target.deconstruct.size },
            }
          : null,
      },
  materials: { ...order.materials },
  work: { ...order.work },
})

const occupiedCellKeys = (layout: ConstructionLayout) => new Set([
  ...layout.boundaries
    .filter((boundary) => boundary.kind === 'wall')
    .map(pointKey),
  ...layout.workstations.flatMap((workstation) =>
    getWorkstationCells(workstation).map(pointKey),
  ),
])

const allWalkableCells = (layout: ConstructionLayout) => {
  const blocked = occupiedCellKeys(layout)
  return Array.from({ length: layout.width * layout.height }, (_, index) => ({
    x: index % layout.width,
    y: Math.floor(index / layout.width),
  })).filter((cell) => !blocked.has(pointKey(cell)))
}

const exteriorConnectedCellKeys = (
  layout: ConstructionLayout,
  cells: readonly GridPoint[],
) => {
  const walkable = new Set(cells.map(pointKey))
  const connected = new Set<string>()
  const queue = cells.filter((cell) => (
    cell.x === 0 ||
    cell.y === 0 ||
    cell.x === layout.width - 1 ||
    cell.y === layout.height - 1
  ))
  queue.forEach((cell) => connected.add(pointKey(cell)))

  for (let index = 0; index < queue.length; index += 1) {
    const cell = queue[index]
    const neighbors = [
      { x: cell.x - 1, y: cell.y },
      { x: cell.x + 1, y: cell.y },
      { x: cell.x, y: cell.y - 1 },
      { x: cell.x, y: cell.y + 1 },
    ]
    neighbors.forEach((neighbor) => {
      const key = pointKey(neighbor)
      if (!walkable.has(key) || connected.has(key)) return
      connected.add(key)
      queue.push(neighbor)
    })
  }

  return connected
}

interface ConstructionRoutingTopology {
  key: string
  stableCells: GridPoint[]
  stableCellKeys: Set<string>
}

let cachedRoutingTopology: ConstructionRoutingTopology | null = null

const constructionRoutingTopology = (
  layout: ConstructionLayout,
  transientBlockedCells: readonly GridPoint[],
): ConstructionRoutingTopology => {
  const occupied = occupiedCellKeys(layout)
  analyzeConstructionPressure(layout).breachCells.forEach((cell) => occupied.add(pointKey(cell)))
  const transient = new Set(
    transientBlockedCells
      .filter((cell) => isInConstructionBounds(cell, layout))
      .map(pointKey),
  )
  const key = [
    `${layout.width}x${layout.height}`,
    [...occupied].sort((left, right) => left.localeCompare(right)).join(','),
    [...transient].sort((left, right) => left.localeCompare(right)).join(','),
  ].join('|')
  if (cachedRoutingTopology?.key === key) return cachedRoutingTopology

  const safeCells = Array.from({ length: layout.width * layout.height }, (_, index) => ({
    x: index % layout.width,
    y: Math.floor(index / layout.width),
  })).filter((cell) => {
    const cellKey = pointKey(cell)
    return !occupied.has(cellKey) && !transient.has(cellKey)
  })
  const exteriorConnected = exteriorConnectedCellKeys(layout, safeCells)
  const stableCells = exteriorConnected.size > 0
    ? safeCells.filter((cell) => exteriorConnected.has(pointKey(cell)))
    : safeCells
  const topology = {
    key,
    stableCells,
    stableCellKeys: new Set(stableCells.map(pointKey)),
  }
  cachedRoutingTopology = topology
  return topology
}

/** Keeps the material pickup cell usable after loading an old or edited map. */
export const normalizeConstructionStockpile = (
  layout: ConstructionLayout,
  requested: GridPoint | null | undefined,
  fallback: GridPoint = {
    x: Math.floor(layout.width / 2),
    y: Math.floor(layout.height / 2),
  },
  transientBlockedCells: readonly GridPoint[] = [],
): GridPoint => {
  const topology = constructionRoutingTopology(layout, transientBlockedCells)
  if (requested && topology.stableCellKeys.has(pointKey(requested))) {
    return clonePoint(requested)
  }
  if (!requested && topology.stableCellKeys.has(pointKey(fallback))) {
    return clonePoint(fallback)
  }
  const anchor = requested && isInConstructionBounds(requested, layout)
    ? requested
    : fallback
  return topology.stableCells
    .sort((left, right) =>
      manhattanDistance(left, anchor) - manhattanDistance(right, anchor) ||
      comparePoints(left, right),
    )[0] ?? clonePoint(anchor)
}

const manhattanDistance = (left: GridPoint, right: GridPoint) =>
  Math.abs(left.x - right.x) + Math.abs(left.y - right.y)

/**
 * Repairs persisted worker positions without allowing a pawn to remain inside
 * a newly built wall or workstation. New workers start close to the material
 * stockpile. Existing overlaps remain valid (and inspectable); newly seeded
 * workers use distinct cells when a free tile exists.
 */
export const normalizeConstructionCrewPositions = (
  layout: ConstructionLayout,
  workers: readonly Pick<ConstructionRoutingWorker, 'id'>[],
  sourcePositions: readonly ConstructionCrewPosition[],
  stockpile: GridPoint,
  orders: readonly Pick<ConstructionOrder, 'status' | 'target'>[] = [],
  evaRequiredCells: readonly GridPoint[] = [],
): ConstructionCrewPosition[] => {
  const normalizedStockpile = isConstructionCellWalkable(layout, stockpile)
    ? clonePoint(stockpile)
    : normalizeConstructionStockpile(layout, stockpile)
  const workerIds = new Set(
    workers
      .map((worker) => worker.id.trim())
      .filter(Boolean),
  )
  const sourceByCrewId = new Map<string, ConstructionCrewPosition>()
  const blockedSourceCellByCrewId = new Map<string, GridPoint>()
  const seenCrewIds = new Set<string>()
  sourcePositions.forEach((position) => {
    if (
      !workerIds.has(position.crewId) ||
      seenCrewIds.has(position.crewId)
    ) return
    seenCrewIds.add(position.crewId)
    if (!isConstructionCellWalkable(layout, position.cell)) {
      if (isInConstructionBounds(position.cell, layout)) {
        blockedSourceCellByCrewId.set(position.crewId, clonePoint(position.cell))
      }
      return
    }
    sourceByCrewId.set(position.crewId, {
      crewId: position.crewId,
      cell: clonePoint(position.cell),
      moveCredit: Math.min(1 - MOVEMENT_EPSILON, finiteNonnegative(position.moveCredit)),
    })
  })

  const unfinishedTargets = new Set(
    orders
      .filter((order) => order.status !== 'complete')
      .flatMap((order) => order.target.cells)
      .filter((cell) => isInConstructionBounds(cell, layout))
      .map(pointKey),
  )
  const pressure = analyzeConstructionPressure(layout)
  const evaRequiredCellKeys = new Set(evaRequiredCells.map(pointKey))
  const unsafeCellRank = (cell: GridPoint) => Number(
    constructionEnvironmentAt(layout, pressure, cell) !== 'pressurized' ||
    evaRequiredCellKeys.has(pointKey(cell)),
  )
  const preferredCells = allWalkableCells(layout).sort((left, right) =>
    unsafeCellRank(left) - unsafeCellRank(right) ||
    Number(unfinishedTargets.has(pointKey(left))) - Number(unfinishedTargets.has(pointKey(right))) ||
    manhattanDistance(left, normalizedStockpile) - manhattanDistance(right, normalizedStockpile) ||
    comparePoints(left, right),
  )
  const used = new Set<string>()

  return [...workerIds]
    .sort(compareIds)
    .map((crewId, index) => {
      const persisted = sourceByCrewId.get(crewId)
      if (persisted) {
        used.add(pointKey(persisted.cell))
        return persisted
      }
      const blockedSourceCell = blockedSourceCellByCrewId.get(crewId)
      const candidates = blockedSourceCell
        ? [...preferredCells].sort((left, right) =>
            unsafeCellRank(left) - unsafeCellRank(right) ||
            Number(unfinishedTargets.has(pointKey(left))) -
              Number(unfinishedTargets.has(pointKey(right))) ||
            manhattanDistance(left, blockedSourceCell) -
              manhattanDistance(right, blockedSourceCell) ||
            comparePoints(left, right),
          )
        : preferredCells
      const cell = candidates.find((candidate) => !used.has(pointKey(candidate)))
        ?? preferredCells[index % Math.max(1, preferredCells.length)]
        ?? { x: 0, y: 0 }
      used.add(pointKey(cell))
      return { crewId, cell: clonePoint(cell), moveCredit: 0 }
    })
}

/** Runtime-safe persistence boundary for crew cells and fractional movement. */
export const normalizePersistedConstructionCrewPositions = (
  layout: ConstructionLayout,
  workers: readonly Pick<ConstructionRoutingWorker, 'id'>[],
  sourcePositions: unknown,
  stockpile: GridPoint,
  orders: readonly Pick<ConstructionOrder, 'status' | 'target'>[] = [],
  evaRequiredCells: readonly GridPoint[] = [],
): ConstructionCrewPosition[] => {
  const sanitized = (Array.isArray(sourcePositions) ? sourcePositions : []).flatMap(
    (value): ConstructionCrewPosition[] => {
      if (!value || typeof value !== 'object') return []
      const candidate = value as Record<string, unknown>
      const cell = candidate.cell
      if (
        typeof candidate.crewId !== 'string' ||
        !candidate.crewId.trim() ||
        !cell ||
        typeof cell !== 'object'
      ) return []
      const point = cell as Record<string, unknown>
      if (
        typeof point.x !== 'number' ||
        typeof point.y !== 'number' ||
        !Number.isInteger(point.x) ||
        !Number.isInteger(point.y)
      ) return []
      return [{
        crewId: candidate.crewId,
        cell: { x: point.x, y: point.y },
        moveCredit: typeof candidate.moveCredit === 'number'
          ? candidate.moveCredit
          : 0,
      }]
    },
  )
  return normalizeConstructionCrewPositions(
    layout,
    workers,
    sanitized,
    stockpile,
    orders,
    evaRequiredCells,
  )
}

const orderPrerequisitesComplete = (
  order: RoutableConstructionOrder,
  statusByOrderId: ReadonlyMap<string, ConstructionOrder['status']>,
) => (order.prerequisiteOrderIds ?? []).every(
  (orderId) => statusByOrderId.get(orderId) === 'complete',
)

const orderCanRoute = (
  order: RoutableConstructionOrder,
  statusByOrderId: ReadonlyMap<string, ConstructionOrder['status']>,
) =>
  (order.status === 'hauling' || order.status === 'building') &&
  orderPrerequisitesComplete(order, statusByOrderId)

const initialTravelPhase = (order: ConstructionOrder): ConstructionTravelPhase =>
  order.operation === 'deconstruct' ||
  constructionMaterialAccountedFor(order) + MOVEMENT_EPSILON >= order.materials.required
    ? 'to_site'
    : 'to_stockpile'

const workerEligibleForPhase = (
  worker: ConstructionRoutingWorker,
  order: ConstructionOrder,
  phase: ConstructionTravelPhase,
) => {
  if (carriedConstructionMaterial(order) > MOVEMENT_EPSILON) return workerCanHaul(worker)
  if (phase === 'to_stockpile') return workerCanHaul(worker)
  return workerCanConstruct(worker) && (
    !order.forcedCrewId || order.forcedCrewId === worker.id
  )
}

const unfinishedConstructCells = (
  orders: readonly RoutableConstructionOrder[],
) => orders
  .filter((order) => order.status !== 'complete' && Boolean(order.target.construct))
  .flatMap((order) => order.target.cells.map(clonePoint))

const solidifyingConstructCells = (
  orders: readonly RoutableConstructionOrder[],
) => orders
  .filter((order) => {
    const becomesSolid = order.target.kind === 'workstation'
      ? Boolean(order.target.construct)
      : order.target.construct?.kind === 'wall'
    return (
      order.status !== 'complete' &&
      becomesSolid &&
      order.materials.delivered + MOVEMENT_EPSILON >= order.materials.required
    )
  })
  .flatMap((order) => order.target.cells.map(clonePoint))

const workerMovementRate = (worker: ConstructionRoutingWorker) => {
  const requested = worker.movementRate ?? DEFAULT_MOVEMENT_RATE
  return Number.isFinite(requested) && requested > 0
    ? requested
    : DEFAULT_MOVEMENT_RATE
}

const routeStillAtSite = (
  layout: ConstructionLayout,
  cell: GridPoint,
  order: RoutableConstructionOrder,
  routeOptions: ConstructionPathfindingOptions,
) => getConstructionApproachCells(layout, order.target.cells, routeOptions)
  .some((candidate) => pointKey(candidate) === pointKey(cell))

const workerCanOccupyCell = (
  layout: ConstructionLayout,
  pressureTopology: ConstructionPressureTopology,
  worker: ConstructionRoutingWorker,
  cell: GridPoint,
  evaRequiredCellKeys: ReadonlySet<string>,
) => worker.hasEvaSuit !== false || (
  constructionEnvironmentAt(layout, pressureTopology, cell) === 'pressurized' &&
  !evaRequiredCellKeys.has(pointKey(cell))
)

const workerRouteOptions = (
  pressureTopology: ConstructionPressureTopology,
  transientBlockedCells: readonly GridPoint[],
  worker: Pick<ConstructionRoutingWorker, 'hasEvaSuit'>,
  evaRequiredCells: readonly GridPoint[],
): ConstructionPathfindingOptions => ({
  transientBlockedCells,
  pressureTopology,
  hasEvaSuit: worker.hasEvaSuit,
  evaRequiredCells,
})

const workerCanReachOrder = (
  layout: ConstructionLayout,
  stockpile: GridPoint,
  cell: GridPoint,
  order: RoutableConstructionOrder,
  requestedPhase: ConstructionTravelPhase,
  transientBlockedCells: readonly GridPoint[],
  pressureTopology: ConstructionPressureTopology,
  evaRequiredCells: readonly GridPoint[],
  worker: ConstructionRoutingWorker,
) => {
  const phase = requestedPhase === 'idle'
    ? initialTravelPhase(order)
    : requestedPhase
  const routeOptions = workerRouteOptions(
    pressureTopology,
    transientBlockedCells,
    worker,
    evaRequiredCells,
  )
  const evaRequiredCellKeys = new Set(evaRequiredCells.map(pointKey))
  if (!workerCanOccupyCell(
    layout,
    pressureTopology,
    worker,
    cell,
    evaRequiredCellKeys,
  )) return false
  if (phase === 'at_site' && routeStillAtSite(
    layout,
    cell,
    order,
    routeOptions,
  )) return true
  if (phase === 'to_stockpile') {
    return Boolean(
      findConstructionPath(layout, cell, [stockpile], routeOptions) &&
      findConstructionOrderApproachPath(layout, stockpile, order, routeOptions),
    )
  }
  return Boolean(findConstructionOrderApproachPath(layout, cell, order, routeOptions))
}

export interface ConstructionWorkerRoutePreview {
  reachable: boolean
  phase: ConstructionTravelPhase
  steps: number | null
  path: GridPoint[]
}

/** Read-only route truth for assignment UI and map feedback. */
export const previewConstructionWorkerRoute = ({
  layout,
  orders,
  order,
  stockpile,
  crewCell,
  hasEvaSuit,
  evaRequiredCells = [],
}: {
  layout: ConstructionLayout
  orders: readonly RoutableConstructionOrder[]
  order: RoutableConstructionOrder
  stockpile: GridPoint
  crewCell: GridPoint
  hasEvaSuit?: boolean
  evaRequiredCells?: readonly GridPoint[]
}): ConstructionWorkerRoutePreview => {
  const pendingConstructCells = unfinishedConstructCells(orders)
  const routeBlockedCells = solidifyingConstructCells(orders)
  const normalizedStockpile = normalizeConstructionStockpile(
    layout,
    stockpile,
    undefined,
    pendingConstructCells,
  )
  const phase = carriedConstructionMaterial(order) > MOVEMENT_EPSILON
    ? order.travelPhase === 'at_site' ? 'at_site' : 'to_site'
    : initialTravelPhase(order)
  // Unsupplied ghosts stay walkable. Once a solid target is fully staged it
  // becomes a routing obstacle while the existing occupancy guard prevents
  // completion beneath a colonist who still needs to step clear.
  const pressureTopology = analyzeConstructionPressure(layout)
  const routeOptions: ConstructionPathfindingOptions = {
    transientBlockedCells: routeBlockedCells,
    pressureTopology,
    hasEvaSuit,
    evaRequiredCells,
  }
  const evaRequiredCellKeys = new Set(evaRequiredCells.map(pointKey))
  if (
    hasEvaSuit === false &&
    (constructionEnvironmentAt(layout, pressureTopology, crewCell) !== 'pressurized' ||
      evaRequiredCellKeys.has(pointKey(crewCell)))
  ) return { reachable: false, phase, steps: null, path: [] }
  if (phase === 'at_site' && routeStillAtSite(
    layout,
    crewCell,
    order,
    routeOptions,
  )) {
    return { reachable: true, phase, steps: 0, path: [clonePoint(crewCell)] }
  }
  if (phase === 'to_stockpile') {
    const toStockpile = findConstructionPath(
      layout,
      crewCell,
      [normalizedStockpile],
      routeOptions,
    )
    const toSite = findConstructionOrderApproachPath(
      layout,
      normalizedStockpile,
      order,
      routeOptions,
    )
    if (!toStockpile || !toSite) {
      return { reachable: false, phase, steps: null, path: [] }
    }
    const path = [...toStockpile.path.map(clonePoint), ...toSite.path.slice(1).map(clonePoint)]
    return { reachable: true, phase, steps: Math.max(0, path.length - 1), path }
  }
  const toSite = findConstructionOrderApproachPath(
    layout,
    crewCell,
    order,
    routeOptions,
  )
  if (!toSite) return { reachable: false, phase, steps: null, path: [] }
  return {
    reachable: true,
    phase,
    steps: Math.max(0, toSite.path.length - 1),
    path: toSite.path.map(clonePoint),
  }
}

interface MovementResult {
  cell: GridPoint
  remainingDistance: number
  reached: boolean
}

const travelAlongPath = (
  cell: GridPoint,
  path: readonly GridPoint[],
  availableDistance: number,
): MovementResult => {
  const requiredSteps = Math.max(0, path.length - 1)
  const steps = Math.min(requiredSteps, Math.floor(availableDistance + MOVEMENT_EPSILON))
  return {
    cell: clonePoint(path[steps] ?? cell),
    remainingDistance: Math.max(0, availableDistance - steps),
    reached: steps >= requiredSteps,
  }
}

/**
 * Advances only assignment and travel. It never changes material, work, or the
 * completed layout; the caller may safely apply `atSiteWorkers` afterward.
 */
export const advanceConstructionWorkerRouting = (
  input: ConstructionRoutingInput,
): ConstructionRoutingResult => {
  const elapsed = finiteNonnegative(input.elapsed)
  const orders = input.orders.map(cloneOrder)
  const pendingConstructCells = unfinishedConstructCells(orders)
  const routeBlockedCells = solidifyingConstructCells(orders)
  const stockpile = input.stockpileIsNormalized
    ? clonePoint(input.stockpile)
    : normalizeConstructionStockpile(
        input.layout,
        input.stockpile,
        undefined,
        pendingConstructCells,
      )
  const workers = [...input.workers]
    .filter((worker, index, source) =>
      Boolean(worker.id.trim()) && source.findIndex((candidate) => candidate.id === worker.id) === index,
    )
    .sort((left, right) => compareIds(left.id, right.id))
  const statusByOrderId = new Map(orders.map((order) => [order.id, order.status]))
  const pressureTopology = analyzeConstructionPressure(input.layout)
  const evaRequiredCells = input.evaRequiredCells ?? []
  const evaRequiredCellKeys = new Set(evaRequiredCells.map(pointKey))
  const crewPositions = normalizeConstructionCrewPositions(
    input.layout,
    workers,
    input.crewPositions,
    stockpile,
    orders,
    evaRequiredCells,
  )
  const positionByCrewId = new Map(crewPositions.map((position) => [position.crewId, position]))
  const workerById = new Map(workers.map((worker) => [worker.id, worker]))
  const noPathOrderIds: string[] = []
  const evaRequiredOrderIds: string[] = []
  const canWorkerReach = (
    worker: ConstructionRoutingWorker,
    position: ConstructionCrewPosition,
    order: RoutableConstructionOrder,
    phase: ConstructionTravelPhase,
  ) => workerCanReachOrder(
    input.layout,
    stockpile,
    position.cell,
    order,
    phase,
    routeBlockedCells,
    pressureTopology,
    evaRequiredCells,
    worker,
  )
  const workerNeedsEva = (
    worker: ConstructionRoutingWorker,
    position: ConstructionCrewPosition,
    order: RoutableConstructionOrder,
    phase: ConstructionTravelPhase,
  ) => worker.hasEvaSuit === false &&
    !canWorkerReach(worker, position, order, phase) &&
    canWorkerReach({ ...worker, hasEvaSuit: undefined }, position, order, phase)
  const forcedOrderByCrewId = new Map<string, RoutableConstructionOrder>()
  ;[...orders]
    .filter((order) => order.status !== 'complete' && Boolean(order.forcedCrewId))
    .sort(compareOrders)
    .forEach((order) => {
      const crewId = order.forcedCrewId!
      if (!forcedOrderByCrewId.has(crewId)) forcedOrderByCrewId.set(crewId, order)
    })
  const forcedWorkerIds = new Set(forcedOrderByCrewId.keys())

  // Ghosts remain walkable until their material is staged. A pawn inside a
  // supplied solid footprint exits before normal dispatch, and the simulation's
  // occupancy check remains the final guard against solidifying beneath it.
  const routingTopology = constructionRoutingTopology(
    input.layout,
    solidifyingConstructCells(orders),
  )
  const stableCells = routingTopology.stableCells
  const stableCellKeys = routingTopology.stableCellKeys
  const evacuatingCrewIds = new Set<string>()
  crewPositions.forEach((position) => {
    if (stableCellKeys.has(pointKey(position.cell))) return
    const worker = workerById.get(position.crewId)
    if (!worker) return
    const escape = findConstructionPath(
      input.layout,
      position.cell,
      stableCells,
      workerRouteOptions(pressureTopology, routeBlockedCells, worker, evaRequiredCells),
    )
    if (!escape) return
    evacuatingCrewIds.add(position.crewId)
    const movementRate = workerMovementRate(worker)
    const availableDistance = position.moveCredit + movementRate * elapsed
    const travelled = travelAlongPath(position.cell, escape.path, availableDistance)
    position.cell = travelled.cell
    position.moveCredit = Math.min(1 - MOVEMENT_EPSILON, travelled.remainingDistance)
  })
  orders.forEach((order) => {
    if (
      order.assignedCrewId &&
      evacuatingCrewIds.has(order.assignedCrewId) &&
      order.travelPhase === 'at_site'
    ) {
      order.travelPhase = 'to_site'
    }
  })

  // Invalid, duplicate, ineligible, or stranded assignments are released first.
  // Hauling and construction are separate capabilities; cargo nevertheless
  // remains physically bound to its current carrier until it is unloaded.
  const claimedCrewIds = new Set<string>()
  orders
    .sort((left, right) => left.sequence - right.sequence || compareIds(left.id, right.id))
    .forEach((order) => {
      const carried = carriedConstructionMaterial(order)
      const carrierId = carried > MOVEMENT_EPSILON
        ? order.materials.carriedByCrewId ?? null
        : null
      const crewId = carrierId ?? order.assignedCrewId
      const position = crewId ? positionByCrewId.get(crewId) : undefined
      const worker = crewId ? workerById.get(crewId) : undefined
      const phase = carrierId
        ? order.travelPhase === 'at_site' ? 'at_site' : 'to_site'
        : order.travelPhase === 'idle'
        ? initialTravelPhase(order)
        : order.travelPhase
      if (carrierId) {
        order.assignedCrewId = carrierId
        order.travelPhase = phase
        const routeOptions = worker
          ? workerRouteOptions(pressureTopology, routeBlockedCells, worker, evaRequiredCells)
          : null
        const canUnloadAtSite = Boolean(
          position &&
          worker &&
          routeOptions &&
          workerCanOccupyCell(
            input.layout,
            pressureTopology,
            worker,
            position.cell,
            evaRequiredCellKeys,
          ) &&
          phase === 'at_site' &&
          routeStillAtSite(
            input.layout,
            position.cell,
            order,
            routeOptions,
          ),
        )
        if (
          claimedCrewIds.has(carrierId) ||
          !position ||
          !worker ||
          (!workerCanHaul(worker) && !canUnloadAtSite)
        ) {
          order.status = 'blocked'
          order.block = {
            kind: 'carrier_unavailable',
            message: 'The colonist carrying this material is unavailable. Cancel to recover the cargo.',
          }
          claimedCrewIds.add(carrierId)
          statusByOrderId.set(order.id, order.status)
          return
        }
        claimedCrewIds.add(carrierId)
        if (order.block?.kind === 'no_path' && order.status === 'blocked') return
        if (!orderPrerequisitesComplete(order, statusByOrderId)) {
          order.status = 'blocked'
          statusByOrderId.set(order.id, order.status)
          return
        }
        order.status = order.materials.delivered + MOVEMENT_EPSILON >=
          order.materials.required
            ? 'building'
            : 'hauling'
        order.block = null
        statusByOrderId.set(order.id, order.status)
        if (!canWorkerReach(worker, position, order, phase)) {
          noPathOrderIds.push(order.id)
          if (workerNeedsEva(worker, position, order, phase)) {
            evaRequiredOrderIds.push(order.id)
          }
        }
        return
      }
      const forcedOrder = crewId ? forcedOrderByCrewId.get(crewId) : null
      const reachable = Boolean(
        worker && position && canWorkerReach(worker, position, order, phase),
      )
      if (
        worker && position && !reachable && workerNeedsEva(worker, position, order, phase)
      ) {
        evaRequiredOrderIds.push(order.id)
      }
      if (
        !crewId ||
        (forcedOrder && forcedOrder.id !== order.id) ||
        !worker ||
        !workerEligibleForPhase(worker, order, phase) ||
        claimedCrewIds.has(crewId) ||
        !orderCanRoute(order, statusByOrderId) ||
        !position ||
        !reachable
      ) {
        order.assignedCrewId = null
        order.travelPhase = 'idle'
        return
      }
      claimedCrewIds.add(crewId)
      order.travelPhase = phase
    })

  const sortedCandidates = (
    order: RoutableConstructionOrder,
    phase: ConstructionTravelPhase,
    include: (worker: ConstructionRoutingWorker) => boolean,
  ) => workers
    .filter((worker) => (
      include(worker) &&
      !claimedCrewIds.has(worker.id) &&
      !evacuatingCrewIds.has(worker.id) &&
      workerEligibleForPhase(worker, order, phase)
    ))
    .sort((left, right) =>
      workerDispatchPriority(right, phase) - workerDispatchPriority(left, phase) ||
      compareIds(left.id, right.id),
    )

  const claimReachableWorker = (
    order: RoutableConstructionOrder,
    phase: ConstructionTravelPhase,
    candidates: readonly ConstructionRoutingWorker[],
  ) => {
    const worker = candidates.find((candidate) => {
      const position = positionByCrewId.get(candidate.id)
      return Boolean(position && canWorkerReach(candidate, position, order, phase))
    })
    if (!worker) {
      if (candidates.length > 0) {
        noPathOrderIds.push(order.id)
        if (candidates.some((candidate) => {
          const position = positionByCrewId.get(candidate.id)
          return Boolean(position && workerNeedsEva(candidate, position, order, phase))
        })) evaRequiredOrderIds.push(order.id)
      }
      return false
    }
    order.assignedCrewId = worker.id
    order.travelPhase = phase
    claimedCrewIds.add(worker.id)
    return true
  }

  // Forced intent controls who performs construction, while any eligible
  // hauler may stage its material. The forced builder remains reserved from
  // unrelated automatic jobs and is the fallback carrier when working alone.
  ;[...forcedOrderByCrewId.values()]
    .filter((order) => !order.assignedCrewId && orderCanRoute(order, statusByOrderId))
    .sort(compareOrders)
    .forEach((order) => {
      const phase = initialTravelPhase(order)
      const forcedCrewId = order.forcedCrewId!
      const candidates = sortedCandidates(
        order,
        phase,
        phase === 'to_stockpile'
          ? (worker) => !forcedWorkerIds.has(worker.id) || worker.id === forcedCrewId
          : (worker) => worker.id === forcedCrewId,
      )
      if (phase === 'to_stockpile') {
        candidates.sort((left, right) =>
          Number(left.id === forcedCrewId) - Number(right.id === forcedCrewId) ||
          workerDispatchPriority(right, phase) - workerDispatchPriority(left, phase) ||
          compareIds(left.id, right.id),
        )
      }
      claimReachableWorker(order, phase, candidates)
    })

  orders
    .filter((order) => (
      !order.assignedCrewId &&
      !order.forcedCrewId &&
      orderCanRoute(order, statusByOrderId)
    ))
    .sort(compareOrders)
    .forEach((order) => {
      const phase = initialTravelPhase(order)
      const candidates = sortedCandidates(
        order,
        phase,
        (worker) => !forcedWorkerIds.has(worker.id),
      )
      claimReachableWorker(order, phase, candidates)
    })

  const atSiteWorkers: ConstructionAtSiteWorker[] = []

  orders
    .filter((order) => (
      order.assignedCrewId &&
      !evacuatingCrewIds.has(order.assignedCrewId) &&
      (order.status === 'hauling' || order.status === 'building')
    ))
    .sort(compareOrders)
    .forEach((order) => {
      const crewId = order.assignedCrewId!
      const position = positionByCrewId.get(crewId)
      const worker = workerById.get(crewId)
      if (!position || !worker) return
      const routeOptions = workerRouteOptions(
        pressureTopology,
        routeBlockedCells,
        worker,
        evaRequiredCells,
      )
      const movementRate = workerMovementRate(worker)
      let availableDistance = position.moveCredit + movementRate * elapsed
      let cell = clonePoint(position.cell)
      let phase = order.travelPhase === 'idle'
        ? initialTravelPhase(order)
        : order.travelPhase

      // At most two travel legs exist: storage, then the work perimeter.
      for (let transition = 0; transition < 3; transition += 1) {
        if (phase === 'at_site' && !routeStillAtSite(
          input.layout,
          cell,
          order,
          routeOptions,
        )) {
          phase = 'to_site'
        }

        if (phase === 'at_site') {
          if (!workerCanOccupyCell(
            input.layout,
            pressureTopology,
            worker,
            cell,
            evaRequiredCellKeys,
          )) {
            noPathOrderIds.push(order.id)
            if (worker.hasEvaSuit === false) evaRequiredOrderIds.push(order.id)
            availableDistance = Math.min(1 - MOVEMENT_EPSILON, availableDistance)
            break
          }
          atSiteWorkers.push({
            crewId,
            orderId: order.id,
            availableWorkTime: availableDistance / movementRate,
          })
          availableDistance = 0
          break
        }

        const route = phase === 'to_stockpile'
          ? findConstructionPath(input.layout, cell, [stockpile], routeOptions)
          : findConstructionOrderApproachPath(input.layout, cell, order, routeOptions)
        if (!route) {
          noPathOrderIds.push(order.id)
          availableDistance = Math.min(1 - MOVEMENT_EPSILON, availableDistance)
          break
        }

        const travelled = travelAlongPath(cell, route.path, availableDistance)
        cell = travelled.cell
        availableDistance = travelled.remainingDistance
        if (!travelled.reached) break
        phase = phase === 'to_stockpile' ? 'to_site' : 'at_site'
      }

      order.travelPhase = phase
      position.cell = cell
      position.moveCredit = phase === 'at_site'
        ? 0
        : Math.min(1 - MOVEMENT_EPSILON, availableDistance)
    })

  // A suited pawn whose last order ended outside keeps the suit sealed and
  // follows the nearest valid airlock route back into breathable space.
  crewPositions.forEach((position) => {
    if (claimedCrewIds.has(position.crewId) || evacuatingCrewIds.has(position.crewId)) return
    const worker = workerById.get(position.crewId)
    if (!worker || worker.hasEvaSuit !== true) return
    if (
      constructionEnvironmentAt(input.layout, pressureTopology, position.cell) === 'pressurized' &&
      !evaRequiredCellKeys.has(pointKey(position.cell))
    ) {
      return
    }
    const returnRoute = findConstructionPressureReturnPath(
      input.layout,
      position.cell,
      workerRouteOptions(pressureTopology, routeBlockedCells, worker, evaRequiredCells),
    )
    if (!returnRoute) return
    const movementRate = workerMovementRate(worker)
    const availableDistance = position.moveCredit + movementRate * elapsed
    const travelled = travelAlongPath(position.cell, returnRoute.path, availableDistance)
    position.cell = travelled.cell
    position.moveCredit = travelled.reached
      ? 0
      : Math.min(1 - MOVEMENT_EPSILON, travelled.remainingDistance)
  })

  return {
    orders: orders.sort((left, right) => left.sequence - right.sequence || compareIds(left.id, right.id)),
    crewPositions: crewPositions.sort((left, right) => compareIds(left.crewId, right.crewId)),
    atSiteWorkers,
    noPathOrderIds: [...new Set(noPathOrderIds)],
    evaRequiredOrderIds: [...new Set(evaRequiredOrderIds)],
  }
}
