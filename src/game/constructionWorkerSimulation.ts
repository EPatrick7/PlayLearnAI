import type { ConstructionLayout, GridPoint } from './construction'
import {
  advanceConstructionOrders,
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

export interface SpatialConstructionWorker extends ConstructionWorker, ConstructionRoutingWorker {
  canConstruct: boolean
  movementRate?: number
}

export interface ConstructionWorkerSimulationInput {
  layout: ConstructionLayout
  orders: readonly ConstructionOrder[]
  constructionStock: number
  stockpile: GridPoint
  crewPositions: readonly ConstructionCrewPosition[]
  workers: readonly SpatialConstructionWorker[]
  elapsed: number
}

export interface ConstructionWorkerSimulationResult extends ConstructionAdvanceResult {
  stockpile: GridPoint
  crewPositions: ConstructionCrewPosition[]
  atSiteWorkers: ConstructionAtSiteWorker[]
  noPathOrderIds: string[]
}

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

const constructionRouteContextKey = (
  input: ConstructionWorkerSimulationInput,
  stockpile: GridPoint,
) => {
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
    eligibleWorkers: input.workers
      .filter((worker) => worker.canConstruct)
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((worker) => worker.id),
    busyWorkers: [...new Set(
      input.orders
        .filter((order) =>
          order.status !== 'complete' && order.block?.kind !== 'no_path',
        )
        .map((order) => order.assignedCrewId)
        .filter((crewId): crewId is string => Boolean(crewId)),
    )].sort((left, right) => left.localeCompare(right)),
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
  const stockpile = normalizeConstructionStockpile(input.layout, input.stockpile)
  const routeContextKey = constructionRouteContextKey(input, stockpile)
  let layout = input.layout
  let constructionStock = Number.isFinite(input.constructionStock)
    ? Math.max(0, input.constructionStock)
    : 0
  let recoveredMaterials = 0
  const completedOrderIds: string[] = []

  const retryableOrders = input.orders.map((order) =>
    order.block?.kind === 'no_path' && order.routeBlockedContextKey !== routeContextKey
    ? {
        ...order,
        status: order.materials.delivered >= order.materials.required
          ? 'building' as const
          : 'blocked' as const,
        block: null,
        assignedCrewId: null,
        travelPhase: 'idle' as const,
        routeBlockedContextKey: null,
      }
    : order)
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
    elapsed,
  })
  let orders = routing.orders
  const ordersBeforeRouting = new Map(
    initialReservation.orders.map((order) => [order.id, order]),
  )
  orders.forEach((order) => {
    const before = ordersBeforeRouting.get(order.id)
    if (!before || order.operation === 'deconstruct') return
    const remaining = Math.max(0, order.materials.required - order.materials.delivered)
    if (remaining <= 0) return
    const wasAlreadyCarrying = before.travelPhase === 'to_site' ||
      before.travelPhase === 'at_site'
    const reachedStockpile = (
      before.travelPhase === undefined ||
      before.travelPhase === 'idle' ||
      before.travelPhase === 'to_stockpile'
    ) && (
      order.travelPhase === 'to_site' ||
      order.travelPhase === 'at_site'
    )
    if (!wasAlreadyCarrying && !reachedStockpile) return
    if (constructionStock + 0.000_001 < remaining) return

    // Material becomes physically carried at the pallet. The existing
    // `delivered` ledger also serves as recoverable staged material if the
    // player cancels before the builder reaches the site.
    constructionStock = Math.max(0, constructionStock - remaining)
    order.materials.delivered = order.materials.required
    order.materials.reserved = 0
    order.status = 'building'
    order.block = null
    order.routeBlockedContextKey = null
  })
  const noPathIds = new Set(routing.noPathOrderIds)
  orders.forEach((order) => {
    if (!noPathIds.has(order.id) || order.status === 'complete') return
    order.status = 'blocked'
    order.block = {
      kind: 'no_path',
      message: 'No walkable route from an available builder to this construction site.',
    }
    order.assignedCrewId = null
    order.travelPhase = 'idle'
    order.routeBlockedContextKey = routeContextKey
    order.materials.reserved = 0
  })
  const workerById = new Map(input.workers.map((worker) => [worker.id, worker]))

  routing.atSiteWorkers
    .filter((arrival) => arrival.availableWorkTime > 0)
    .forEach((arrival) => {
      const order = orders.find((candidate) => candidate.id === arrival.orderId)
      const worker = workerById.get(arrival.crewId)
      if (!order || !worker || !worker.canConstruct || order.status === 'complete') return

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
  const finalStockpile = normalizeConstructionStockpile(layout, stockpile)
  const crewPositions = normalizeConstructionCrewPositions(
    layout,
    input.workers,
    routing.crewPositions,
    finalStockpile,
    orders,
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
