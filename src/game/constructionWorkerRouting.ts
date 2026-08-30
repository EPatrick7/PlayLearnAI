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
  findConstructionOrderApproachPath,
  findConstructionPath,
  getConstructionApproachCells,
  isConstructionCellWalkable,
} from './constructionPathfinding'

export interface ConstructionCrewPosition {
  crewId: string
  cell: GridPoint
  /** Fractional progress toward the next cardinal tile. */
  moveCredit: number
}

export interface ConstructionRoutingWorker {
  id: string
  canConstruct?: boolean
  movementRate?: number
  /** Higher values receive newly available jobs first. */
  dispatchPriority?: number
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
  elapsed: number
}

export interface ConstructionRoutingResult {
  orders: RoutableConstructionOrder[]
  crewPositions: ConstructionCrewPosition[]
  atSiteWorkers: ConstructionAtSiteWorker[]
  noPathOrderIds: string[]
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

/** Keeps the material pickup cell usable after loading an old or edited map. */
export const normalizeConstructionStockpile = (
  layout: ConstructionLayout,
  requested: GridPoint | null | undefined,
  fallback: GridPoint = { x: 8, y: 9 },
): GridPoint => {
  if (requested && isConstructionCellWalkable(layout, requested)) {
    return clonePoint(requested)
  }
  if (requested && isInConstructionBounds(requested, layout)) {
    return allWalkableCells(layout).sort((left, right) =>
      manhattanDistance(left, requested) - manhattanDistance(right, requested) ||
      comparePoints(left, right),
    )[0] ?? clonePoint(requested)
  }
  if (isConstructionCellWalkable(layout, fallback)) return clonePoint(fallback)
  return allWalkableCells(layout).sort((left, right) =>
    manhattanDistance(left, fallback) - manhattanDistance(right, fallback) ||
    comparePoints(left, right),
  )[0] ?? { x: 0, y: 0 }
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
): ConstructionCrewPosition[] => {
  const normalizedStockpile = normalizeConstructionStockpile(layout, stockpile)
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
  const preferredCells = allWalkableCells(layout).sort((left, right) =>
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
) => getConstructionApproachCells(layout, order.target.cells)
  .some((candidate) => pointKey(candidate) === pointKey(cell))

const workerCanReachOrder = (
  layout: ConstructionLayout,
  stockpile: GridPoint,
  cell: GridPoint,
  order: RoutableConstructionOrder,
  requestedPhase: ConstructionTravelPhase,
) => {
  const phase = requestedPhase === 'idle'
    ? initialTravelPhase(order)
    : requestedPhase
  if (phase === 'at_site' && routeStillAtSite(layout, cell, order)) return true
  if (phase === 'to_stockpile') {
    return Boolean(
      findConstructionPath(layout, cell, [stockpile]) &&
      findConstructionOrderApproachPath(layout, stockpile, order),
    )
  }
  return Boolean(findConstructionOrderApproachPath(layout, cell, order))
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
  const stockpile = normalizeConstructionStockpile(input.layout, input.stockpile)
  const orders = input.orders.map(cloneOrder)
  const workers = [...input.workers]
    .filter((worker, index, source) =>
      Boolean(worker.id.trim()) && source.findIndex((candidate) => candidate.id === worker.id) === index,
    )
    .sort((left, right) => compareIds(left.id, right.id))
  const eligibleWorkerIds = new Set(
    workers.filter((worker) => worker.canConstruct !== false).map((worker) => worker.id),
  )
  const statusByOrderId = new Map(orders.map((order) => [order.id, order.status]))
  const crewPositions = normalizeConstructionCrewPositions(
    input.layout,
    workers,
    input.crewPositions,
    stockpile,
    orders,
  )
  const positionByCrewId = new Map(crewPositions.map((position) => [position.crewId, position]))
  const workerById = new Map(workers.map((worker) => [worker.id, worker]))
  const noPathOrderIds: string[] = []

  // Invalid, duplicate, ineligible, or stranded assignments are released first.
  // A released job can then be offered to another builder with a valid route.
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
      const phase = carrierId
        ? order.travelPhase === 'at_site' ? 'at_site' : 'to_site'
        : order.travelPhase === 'idle'
        ? initialTravelPhase(order)
        : order.travelPhase
      if (carrierId) {
        order.assignedCrewId = carrierId
        order.travelPhase = phase
        const canUnloadAtSite = Boolean(
          position &&
          phase === 'at_site' &&
          routeStillAtSite(input.layout, position.cell, order),
        )
        if (
          claimedCrewIds.has(carrierId) ||
          !position ||
          (!eligibleWorkerIds.has(carrierId) && !canUnloadAtSite)
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
        order.status = 'building'
        order.block = null
        statusByOrderId.set(order.id, order.status)
        if (!workerCanReachOrder(input.layout, stockpile, position.cell, order, phase)) {
          noPathOrderIds.push(order.id)
        }
        return
      }
      if (
        !crewId ||
        !eligibleWorkerIds.has(crewId) ||
        claimedCrewIds.has(crewId) ||
        !orderCanRoute(order, statusByOrderId) ||
        !position ||
        !workerCanReachOrder(input.layout, stockpile, position.cell, order, phase)
      ) {
        order.assignedCrewId = null
        order.travelPhase = 'idle'
        return
      }
      claimedCrewIds.add(crewId)
      order.travelPhase = phase
    })

  const availableWorkers = [...workers]
    .filter((worker) => eligibleWorkerIds.has(worker.id) && !claimedCrewIds.has(worker.id))
    .sort((left, right) =>
      finiteNonnegative(right.dispatchPriority ?? 0) -
        finiteNonnegative(left.dispatchPriority ?? 0) ||
      compareIds(left.id, right.id),
    )
  orders
    .filter((order) => !order.assignedCrewId && orderCanRoute(order, statusByOrderId))
    .sort(compareOrders)
    .forEach((order) => {
      if (availableWorkers.length === 0) return
      const phase = initialTravelPhase(order)
      const workerIndex = availableWorkers.findIndex((candidate) => {
        const position = positionByCrewId.get(candidate.id)
        return Boolean(position && workerCanReachOrder(
          input.layout,
          stockpile,
          position.cell,
          order,
          phase,
        ))
      })
      if (workerIndex < 0) {
        noPathOrderIds.push(order.id)
        return
      }
      const [worker] = availableWorkers.splice(workerIndex, 1)
      order.assignedCrewId = worker.id
      order.travelPhase = phase
      claimedCrewIds.add(worker.id)
    })

  const atSiteWorkers: ConstructionAtSiteWorker[] = []

  orders
    .filter((order) => (
      order.assignedCrewId &&
      (order.status === 'hauling' || order.status === 'building')
    ))
    .sort(compareOrders)
    .forEach((order) => {
      const crewId = order.assignedCrewId!
      const position = positionByCrewId.get(crewId)
      const worker = workerById.get(crewId)
      if (!position || !worker) return
      const movementRate = workerMovementRate(worker)
      let availableDistance = position.moveCredit + movementRate * elapsed
      let cell = clonePoint(position.cell)
      let phase = order.travelPhase === 'idle'
        ? initialTravelPhase(order)
        : order.travelPhase

      // At most two travel legs exist: storage, then the work perimeter.
      for (let transition = 0; transition < 3; transition += 1) {
        if (phase === 'at_site' && !routeStillAtSite(input.layout, cell, order)) {
          phase = 'to_site'
        }

        if (phase === 'at_site') {
          atSiteWorkers.push({
            crewId,
            orderId: order.id,
            availableWorkTime: availableDistance / movementRate,
          })
          availableDistance = 0
          break
        }

        const route = phase === 'to_stockpile'
          ? findConstructionPath(input.layout, cell, [stockpile])
          : findConstructionOrderApproachPath(input.layout, cell, order)
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

  return {
    orders: orders.sort((left, right) => left.sequence - right.sequence || compareIds(left.id, right.id)),
    crewPositions: crewPositions.sort((left, right) => compareIds(left.crewId, right.crewId)),
    atSiteWorkers,
    noPathOrderIds: [...new Set(noPathOrderIds)],
  }
}
