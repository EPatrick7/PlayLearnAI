import type { ConstructionLayout, GridPoint } from './construction'
import {
  advanceConstructionOrders,
  carriedConstructionMaterial,
  constructionMaterialAccountedFor,
  reserveConstructionMaterials,
  type ConstructionAdvanceResult,
  type ConstructionOrder,
  type ConstructionTravelPhase,
  type ConstructionWorker,
} from './constructionJobs'
import {
  advanceConstructionWorkerRouting,
  normalizeConstructionCrewPositions,
  normalizeConstructionStockpile,
  type ConstructionAtSiteWorker,
  type ConstructionCrewPosition,
  type ConstructionRoutingWorker,
  type RoutableConstructionOrder,
} from './constructionWorkerRouting'
import {
  getConstructionApproachCells,
  isConstructionCellWalkable,
} from './constructionPathfinding'

export interface SpatialConstructionWorker extends ConstructionWorker, ConstructionRoutingWorker {
  canConstruct: boolean
  /** Maximum construction material carried per pallet visit. Defaults to one. */
  carryCapacity?: number
  movementRate?: number
}

export interface ConstructionWorkerSimulationInput {
  layout: ConstructionLayout
  orders: readonly ConstructionOrder[]
  constructionStock: number
  stockpile: GridPoint
  crewPositions: readonly ConstructionCrewPosition[]
  workers: readonly SpatialConstructionWorker[]
  /** Live module cells that need EVA despite belonging to a sealed room shell. */
  evaRequiredCells?: readonly GridPoint[]
  elapsed: number
}

export interface ConstructionWorkerSimulationResult extends ConstructionAdvanceResult {
  stockpile: GridPoint
  crewPositions: ConstructionCrewPosition[]
  atSiteWorkers: ConstructionAtSiteWorker[]
  noPathOrderIds: string[]
}

/**
 * Maximum deterministic slice consumed by the store-facing construction clock.
 * Keeping dispatch bounded lets a worker finish one job and accept another during
 * a larger advance instead of discarding the remainder of that advance.
 */
export const CONSTRUCTION_SIMULATION_STEP = 0.25

const travelPhases = new Set<ConstructionTravelPhase>([
  'idle',
  'to_stockpile',
  'to_site',
  'at_site',
])

const routableOrder = (order: ConstructionOrder): RoutableConstructionOrder => {
  const persistedPhase = (order as ConstructionOrder & { travelPhase?: unknown }).travelPhase
  return {
    ...order,
    block: order.block ? { ...order.block } : null,
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
          cells: order.target.cells.map((cell) => ({ ...cell })),
          construct: order.target.construct
            ? {
                ...order.target.construct,
                origin: { ...order.target.construct.origin },
                size: { ...order.target.construct.size },
              }
            : null,
          deconstruct: order.target.deconstruct
            ? {
                ...order.target.deconstruct,
                origin: { ...order.target.deconstruct.origin },
                size: { ...order.target.deconstruct.size },
              }
            : null,
        },
    materials: { ...order.materials },
    work: { ...order.work },
    travelPhase: typeof persistedPhase === 'string' && travelPhases.has(
      persistedPhase as ConstructionTravelPhase,
    )
      ? persistedPhase as ConstructionTravelPhase
      : 'idle',
  }
}

const mergeOrder = (
  orders: RoutableConstructionOrder[],
  updated: ConstructionOrder,
) => orders.map((order) => order.id === updated.id
  ? routableOrder(updated)
  : order)

const pointKey = ({ x, y }: GridPoint) => `${x}:${y}`

const workerCanHaul = (worker: SpatialConstructionWorker) =>
  worker.canHaul ?? worker.canConstruct

const workerCarryCapacity = (worker: SpatialConstructionWorker) => {
  const requested = worker.carryCapacity ?? 1
  return Number.isFinite(requested) ? Math.max(0, requested) : 1
}

const unfinishedConstructCells = (
  orders: readonly RoutableConstructionOrder[],
) => orders
  .filter((order) => order.status !== 'complete' && Boolean(order.target.construct))
  .flatMap((order) => order.target.cells.map((cell) => ({ ...cell })))

const constructTargetBecomesSolid = (order: RoutableConstructionOrder) => (
  order.target.kind === 'workstation'
    ? Boolean(order.target.construct)
    : order.target.construct?.kind === 'wall'
)

const constructionRouteContextKey = (
  input: ConstructionWorkerSimulationInput,
  stockpile: GridPoint,
) => {
  const constructionWorkerIds = new Set(
    input.workers.filter((worker) => worker.canConstruct).map((worker) => worker.id),
  )
  const haulingWorkerIds = new Set(
    input.workers.filter(workerCanHaul).map((worker) => worker.id),
  )
  const eligibleWorkerIds = new Set(
    [...constructionWorkerIds, ...haulingWorkerIds],
  )
  const busyWorkerIds = new Set(
    input.orders
      .filter((order) => order.status !== 'complete')
      .map((order) => (
        carriedConstructionMaterial(order) > 0
          ? order.materials.carriedByCrewId
          : order.block?.kind !== 'no_path'
            ? order.assignedCrewId
            : null
      ))
      .filter((crewId): crewId is string => Boolean(crewId)),
  )

  return JSON.stringify({
    boundaries: [...input.layout.boundaries]
      .sort((left, right) => left.y - right.y || left.x - right.x)
      .map((cell) => `${cell.x}:${cell.y}:${cell.kind}`),
    workstations: [...input.layout.workstations]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((item) => [
        item.id,
        item.type,
        item.origin.x,
        item.origin.y,
        item.size.width,
        item.size.height,
        item.rotation,
    ]),
    stockpile: [stockpile.x, stockpile.y],
    constructionWorkers: [...constructionWorkerIds].sort((left, right) => left.localeCompare(right)),
    haulingWorkers: [...haulingWorkerIds].sort((left, right) => left.localeCompare(right)),
    busyWorkers: [...busyWorkerIds].sort((left, right) => left.localeCompare(right)),
    forcedAssignments: input.orders
      .filter((order) => order.status !== 'complete' && order.forcedCrewId)
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((order) => [order.id, order.forcedCrewId]),
    availableWorkerPositions: input.crewPositions
      .filter((position) => (
        eligibleWorkerIds.has(position.crewId) && !busyWorkerIds.has(position.crewId)
      ))
      .sort((left, right) => left.crewId.localeCompare(right.crewId))
      .map((position) => [position.crewId, position.cell.x, position.cell.y]),
    pendingConstructFootprints: [...new Set(
      input.orders
        .filter((order) => order.status !== 'complete' && Boolean(order.target.construct))
        .flatMap((order) => order.target.cells.map(pointKey)),
    )].sort((left, right) => left.localeCompare(right)),
    evaRequiredCells: [...new Set((input.evaRequiredCells ?? []).map(pointKey))]
      .sort((left, right) => left.localeCompare(right)),
  })
}

/**
 * Spatial construction update used by the store. Routing happens first; only
 * workers that actually reach a target perimeter are passed to the existing
 * hauling/building executor. This preserves the mature material and primitive
 * safety rules while removing its old teleporting presentation shortcut.
 */
export const advanceConstructionWorkerSimulation = (
  input: ConstructionWorkerSimulationInput,
): ConstructionWorkerSimulationResult => {
  const elapsed = Number.isFinite(input.elapsed) ? Math.max(0, input.elapsed) : 0
  const initialOrders = input.orders.map(routableOrder)
  const stockpile = normalizeConstructionStockpile(
    input.layout,
    input.stockpile,
    undefined,
    unfinishedConstructCells(initialOrders),
  )
  const routeContextKey = constructionRouteContextKey(input, stockpile)
  let layout = input.layout
  let constructionStock = Number.isFinite(input.constructionStock)
    ? Math.max(0, input.constructionStock)
    : 0
  let recoveredMaterials = 0
  const completedOrderIds: string[] = []

  const retryableOrders = input.orders.map((order) => {
    if (order.block?.kind !== 'no_path' || order.routeBlockedContextKey === routeContextKey) {
      return order
    }
    const carrierId = carriedConstructionMaterial(order) > 0
      ? order.materials.carriedByCrewId ?? null
      : null
    return {
      ...order,
      status: constructionMaterialAccountedFor(order) >= order.materials.required
        ? 'building' as const
        : 'blocked' as const,
      block: null,
      assignedCrewId: carrierId,
      travelPhase: carrierId ? 'to_site' as const : 'idle' as const,
      routeBlockedContextKey: null,
    }
  })
  const initialReservation = reserveConstructionMaterials(
    retryableOrders,
    constructionStock,
  )
  const routing = advanceConstructionWorkerRouting({
    layout,
    orders: initialReservation.orders.map(routableOrder),
    crewPositions: input.crewPositions,
    workers: input.workers,
    stockpile,
    stockpileIsNormalized: true,
    evaRequiredCells: input.evaRequiredCells,
    elapsed,
  })
  let orders = routing.orders
  const ordersBeforeRouting = new Map(
    initialReservation.orders.map((order) => [order.id, order]),
  )
  const workerById = new Map(input.workers.map((worker) => [worker.id, worker]))
  orders.forEach((order) => {
    const before = ordersBeforeRouting.get(order.id)
    if (!before || order.operation === 'deconstruct') return
    const remaining = Math.max(
      0,
      order.materials.required - constructionMaterialAccountedFor(order),
    )
    if (remaining <= 0) return
    const reachedStockpile = (
      before.travelPhase === undefined ||
      before.travelPhase === 'idle' ||
      before.travelPhase === 'to_stockpile'
    ) && (
      order.travelPhase === 'to_site' ||
      order.travelPhase === 'at_site'
    )
    if (!reachedStockpile) return
    const worker = order.assignedCrewId
      ? workerById.get(order.assignedCrewId)
      : undefined
    if (!worker || !workerCanHaul(worker)) return
    const pickedUp = Math.min(
      remaining,
      Math.max(0, order.materials.reserved),
      constructionStock,
      workerCarryCapacity(worker),
    )
    if (pickedUp <= 0.000_001) return

    // Material becomes physical cargo at the pallet and remains bound to this
    // colonist until arrival. It is not staged at the blueprint yet.
    constructionStock = Math.max(0, constructionStock - pickedUp)
    order.materials.carried = carriedConstructionMaterial(order) + pickedUp
    order.materials.carriedByCrewId = order.assignedCrewId
    order.materials.reserved = Math.max(0, order.materials.reserved - pickedUp)
    order.status = 'hauling'
    order.block = null
    order.routeBlockedContextKey = null
  })
  const noPathIds = new Set(routing.noPathOrderIds)
  orders.forEach((order) => {
    if (!noPathIds.has(order.id) || order.status === 'complete') return
    order.status = 'blocked'
    order.block = {
      kind: 'no_path',
      message: routing.evaRequiredOrderIds.includes(order.id)
        ? 'A sealed EVA suit is required to cycle the airlock and reach this construction site.'
        : 'No walkable route from an available builder to this construction site.',
    }
    const carrierId = carriedConstructionMaterial(order) > 0
      ? order.materials.carriedByCrewId ?? null
      : null
    order.assignedCrewId = carrierId
    order.travelPhase = carrierId ? 'to_site' : 'idle'
    order.routeBlockedContextKey = routeContextKey
    order.materials.reserved = 0
  })
  const crewPositionById = new Map(
    routing.crewPositions.map((position) => [position.crewId, position]),
  )

  routing.atSiteWorkers
    .forEach((arrival) => {
      const order = orders.find((candidate) => candidate.id === arrival.orderId)
      const worker = workerById.get(arrival.crewId)
      const crewPosition = crewPositionById.get(arrival.crewId)
      if (!order || !worker || !crewPosition || order.status === 'complete') return

      // An earlier arrival in this same update may have changed the walkable
      // perimeter. Revalidate against the live layout instead of allowing work
      // from a stale route and repairing a trapped pawn afterward.
      const approachCells = getConstructionApproachCells(
        layout,
        order.target.cells,
      )
      if (!approachCells.some((cell) => pointKey(cell) === pointKey(crewPosition.cell))) {
        order.travelPhase = 'to_site'
        return
      }

      const carried = carriedConstructionMaterial(order)
      if (carried > 0) {
        if (order.materials.carriedByCrewId !== arrival.crewId) return
        order.materials.delivered = Math.min(
          order.materials.required,
          order.materials.delivered + carried,
        )
        order.materials.carried = 0
        order.materials.carriedByCrewId = null
        if (order.forcedCrewId && order.forcedCrewId !== arrival.crewId) {
          order.assignedCrewId = null
          order.travelPhase = 'idle'
          return
        }
      }
      if (order.materials.delivered + 0.000_001 < order.materials.required) {
        order.assignedCrewId = null
        order.travelPhase = 'idle'
        return
      }
      if (constructTargetBecomesSolid(order)) {
        const targetKeys = new Set(order.target.cells.map(pointKey))
        const occupied = routing.crewPositions.some((position) => (
          targetKeys.has(pointKey(position.cell))
        ))
        if (occupied) return
      }
      if (!worker.canConstruct) {
        order.assignedCrewId = null
        order.travelPhase = 'idle'
        return
      }
      if (arrival.availableWorkTime <= 0) return

      // The isolated executor still receives each explicit completed dependency
      // so its reservation gate cannot mistake a valid at-site job for an orphan.
      const prerequisiteIds = new Set(order.prerequisiteOrderIds ?? [])
      const completedPrerequisites = orders.filter((candidate) =>
        prerequisiteIds.has(candidate.id) && candidate.status === 'complete',
      )
      const advanced = advanceConstructionOrders(
        layout,
        [...completedPrerequisites, order],
        [worker],
        {
          constructionStock,
          elapsed: arrival.availableWorkTime,
        },
      )
      const updated = advanced.orders.find((candidate) => candidate.id === order.id)
      if (!updated) return
      layout = advanced.layout
      constructionStock = advanced.constructionStock
      recoveredMaterials += advanced.recoveredMaterials
      advanced.completedOrderIds.forEach((orderId) => {
        if (!completedOrderIds.includes(orderId)) completedOrderIds.push(orderId)
      })
      orders = mergeOrder(orders, updated)
      if (updated.status === 'complete') {
        const completed = orders.find((candidate) => candidate.id === updated.id)
        if (completed) completed.travelPhase = 'idle'
      }
    })

  const finalReservation = reserveConstructionMaterials(orders, constructionStock)
  orders = finalReservation.orders.map(routableOrder)
  const blockedOrderIds = [...new Set([
    ...finalReservation.blockedOrderIds,
    ...routing.noPathOrderIds,
  ])]
  const finalStockpile = isConstructionCellWalkable(layout, stockpile)
    ? { ...stockpile }
    : normalizeConstructionStockpile(
        layout,
        stockpile,
        undefined,
        unfinishedConstructCells(orders),
      )
  const crewPositions = normalizeConstructionCrewPositions(
    layout,
    input.workers,
    routing.crewPositions,
    finalStockpile,
    orders,
    input.evaRequiredCells,
  )

  return {
    layout,
    orders,
    constructionStock,
    recoveredMaterials,
    completedOrderIds,
    blockedOrderIds,
    stockpile: finalStockpile,
    crewPositions,
    atSiteWorkers: routing.atSiteWorkers,
    noPathOrderIds: routing.noPathOrderIds,
  }
}

/**
 * Advances spatial construction in deterministic slices. Calls whose elapsed
 * values partition the same quarter-unit duration therefore cross the same
 * dispatch, travel, and completion boundaries.
 */
export const advanceConstructionWorkerSimulationFixedStep = (
  input: ConstructionWorkerSimulationInput,
): ConstructionWorkerSimulationResult => {
  const elapsed = Number.isFinite(input.elapsed) ? Math.max(0, input.elapsed) : 0
  if (
    elapsed <= CONSTRUCTION_SIMULATION_STEP ||
    input.workers.every((worker) => !worker.canConstruct && !workerCanHaul(worker))
  ) {
    return advanceConstructionWorkerSimulation({ ...input, elapsed })
  }

  let remaining = elapsed
  let layout = input.layout
  let orders = input.orders
  let constructionStock = input.constructionStock
  let stockpile = input.stockpile
  let crewPositions = input.crewPositions
  let recoveredMaterials = 0
  const completedOrderIds: string[] = []
  let latest: ConstructionWorkerSimulationResult | null = null

  while (remaining > 0.000_000_001) {
    const step = Math.min(CONSTRUCTION_SIMULATION_STEP, remaining)
    latest = advanceConstructionWorkerSimulation({
      ...input,
      layout,
      orders,
      constructionStock,
      stockpile,
      crewPositions,
      elapsed: step,
    })
    layout = latest.layout
    orders = latest.orders
    constructionStock = latest.constructionStock
    stockpile = latest.stockpile
    crewPositions = latest.crewPositions
    recoveredMaterials += latest.recoveredMaterials
    latest.completedOrderIds.forEach((orderId) => {
      if (!completedOrderIds.includes(orderId)) completedOrderIds.push(orderId)
    })
    remaining = Math.max(0, remaining - step)
    if (!orders.some((order) => order.status !== 'complete')) break
  }

  if (!latest) return advanceConstructionWorkerSimulation({ ...input, elapsed: 0 })
  return {
    ...latest,
    recoveredMaterials,
    completedOrderIds,
  }
}
