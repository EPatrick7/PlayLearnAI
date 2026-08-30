import {
  boundaryAt,
  eraseAt,
  getWorkstationCells,
  paintBoundaryCell,
  placeWorkstation,
  removeWorkstation,
  type BoundaryCell,
  type ConstructionFailureCode,
  type ConstructionLayout,
  type ConstructionResult,
  type GridPoint,
  type WorkstationPlacement,
} from './construction'

export type ConstructionOrderStatus =
  | 'hauling'
  | 'building'
  | 'complete'
  | 'blocked'

export type ConstructionOperation = 'construct' | 'deconstruct' | 'replace'

export interface BoundaryConstructionTarget {
  kind: 'boundary'
  cells: [GridPoint]
  construct: BoundaryCell | null
  deconstruct: BoundaryCell | null
}

export interface WorkstationConstructionTarget {
  kind: 'workstation'
  cells: GridPoint[]
  construct: WorkstationPlacement | null
  deconstruct: WorkstationPlacement | null
}

export type ConstructionOrderTarget =
  | BoundaryConstructionTarget
  | WorkstationConstructionTarget

/**
 * A serializable unit of player-designated construction work. `commandId`
 * groups every tile produced by one drag/click, while `sequence` preserves the
 * order in which projected commands were issued.
 */
export interface ConstructionOrder {
  id: string
  commandId: string
  sequence: number
  priority: number
  operation: ConstructionOperation
  status: ConstructionOrderStatus
  assignedCrewId: string | null
  target: ConstructionOrderTarget
  materials: {
    required: number
    delivered: number
  }
  work: {
    required: number
    completed: number
  }
}

export interface ConstructionWorker {
  id: string
  engineeringRate: number
  haulingRate?: number
}

export interface DeriveConstructionOrdersOptions {
  commandId: string
  priority?: number
  sequenceStart?: number
}

export interface ConstructionProjectionIssue {
  orderId: string
  code: ConstructionFailureCode | 'target_changed'
  error: string
}

export interface ConstructionProjection {
  valid: boolean
  layout: ConstructionLayout
  issues: ConstructionProjectionIssue[]
}

export interface ConstructionAdvanceResult {
  layout: ConstructionLayout
  orders: ConstructionOrder[]
  completedOrderIds: string[]
  blockedOrderIds: string[]
}

export interface CancelConstructionCommandResult {
  layout: ConstructionLayout
  orders: ConstructionOrder[]
  projection: ConstructionProjection
  cancelledOrderIds: string[]
}

interface AppliedTarget {
  ok: true
  layout: ConstructionLayout
}

interface RejectedTarget {
  ok: false
  code: ConstructionProjectionIssue['code']
  error: string
}

type ApplyTargetResult = AppliedTarget | RejectedTarget

const pointKey = ({ x, y }: GridPoint) => `${x}:${y}`

const comparePoints = (left: GridPoint, right: GridPoint) =>
  left.y - right.y || left.x - right.x

const clonePoint = ({ x, y }: GridPoint): GridPoint => ({ x, y })

const cloneBoundary = (boundary: BoundaryCell): BoundaryCell => ({ ...boundary })

const cloneWorkstation = (
  workstation: WorkstationPlacement,
): WorkstationPlacement => ({
  ...workstation,
  origin: { ...workstation.origin },
  size: { ...workstation.size },
})

const cloneLayout = (layout: ConstructionLayout): ConstructionLayout => ({
  ...layout,
  boundaries: layout.boundaries.map(cloneBoundary),
  workstations: layout.workstations.map(cloneWorkstation),
})

const cloneTarget = (target: ConstructionOrderTarget): ConstructionOrderTarget =>
  target.kind === 'boundary'
    ? {
        kind: 'boundary',
        cells: [clonePoint(target.cells[0])],
        construct: target.construct ? cloneBoundary(target.construct) : null,
        deconstruct: target.deconstruct ? cloneBoundary(target.deconstruct) : null,
      }
    : {
        kind: 'workstation',
        cells: target.cells.map(clonePoint),
        construct: target.construct ? cloneWorkstation(target.construct) : null,
        deconstruct: target.deconstruct
          ? cloneWorkstation(target.deconstruct)
          : null,
      }

const cloneOrder = (order: ConstructionOrder): ConstructionOrder => ({
  ...order,
  target: cloneTarget(order.target),
  materials: { ...order.materials },
  work: { ...order.work },
})

const sameBoundary = (
  left: BoundaryCell | undefined,
  right: BoundaryCell | undefined,
) =>
  left?.x === right?.x &&
  left?.y === right?.y &&
  left?.kind === right?.kind

const sameWorkstation = (
  left: WorkstationPlacement | undefined,
  right: WorkstationPlacement | undefined,
) =>
  left?.id === right?.id &&
  left?.type === right?.type &&
  left?.label === right?.label &&
  left?.origin.x === right?.origin.x &&
  left?.origin.y === right?.origin.y &&
  left?.size.width === right?.size.width &&
  left?.size.height === right?.size.height &&
  left?.rotation === right?.rotation

const operationFor = (hasConstruct: boolean, hasDeconstruct: boolean) => {
  if (hasConstruct && hasDeconstruct) return 'replace' as const
  return hasConstruct ? ('construct' as const) : ('deconstruct' as const)
}

const uniqueSortedCells = (cells: GridPoint[]) => {
  const cellsByKey = new Map<string, GridPoint>()
  cells.forEach((cell) => cellsByKey.set(pointKey(cell), clonePoint(cell)))
  return [...cellsByKey.values()].sort(comparePoints)
}

const orderRequirements = (target: ConstructionOrderTarget) => {
  const constructCells = target.construct
    ? target.kind === 'boundary'
      ? 1
      : getWorkstationCells(target.construct).length
    : 0
  const affectedCells = Math.max(1, target.cells.length)

  return {
    materialRequired: constructCells,
    workRequired: affectedCells,
  }
}

const compareProjectionOrder = (
  left: ConstructionOrder,
  right: ConstructionOrder,
) => left.sequence - right.sequence || left.id.localeCompare(right.id)

const compareWorkOrder = (left: ConstructionOrder, right: ConstructionOrder) =>
  right.priority - left.priority || compareProjectionOrder(left, right)

const targetChanged = (order: ConstructionOrder, detail: string): RejectedTarget => ({
  ok: false,
  code: 'target_changed',
  error: `Order ${order.id} cannot be completed because ${detail}`,
})

const fromConstructionResult = (
  result: ConstructionResult,
): ApplyTargetResult =>
  result.ok
    ? { ok: true, layout: result.layout }
    : { ok: false, code: result.code, error: result.error }

const applyBoundaryTarget = (
  layout: ConstructionLayout,
  order: ConstructionOrder,
  target: BoundaryConstructionTarget,
): ApplyTargetResult => {
  const cell = target.cells[0]
  const current = boundaryAt(layout, cell)

  // Treat an already-applied target as complete. This makes recovery from a
  // save between applying a primitive and persisting the order idempotent.
  if (target.construct && sameBoundary(current, target.construct)) {
    return { ok: true, layout }
  }

  if (target.deconstruct && !sameBoundary(current, target.deconstruct)) {
    if (!current && !target.construct) return { ok: true, layout }
    return targetChanged(order, `the boundary at ${pointKey(cell)} changed`)
  }

  if (!target.deconstruct && current) {
    return targetChanged(order, `cell ${pointKey(cell)} is now occupied`)
  }

  return target.construct
    ? fromConstructionResult(paintBoundaryCell(layout, cell, target.construct.kind))
    : fromConstructionResult(eraseAt(layout, cell))
}

const applyWorkstationTarget = (
  layout: ConstructionLayout,
  order: ConstructionOrder,
  target: WorkstationConstructionTarget,
): ApplyTargetResult => {
  const targetId = target.construct?.id ?? target.deconstruct?.id
  if (!targetId) return targetChanged(order, 'its workstation target is empty')

  const current = layout.workstations.find((workstation) => workstation.id === targetId)
  if (target.construct && sameWorkstation(current, target.construct)) {
    return { ok: true, layout }
  }

  if (target.deconstruct && current && !sameWorkstation(current, target.deconstruct)) {
    return targetChanged(order, `workstation ${targetId} changed`)
  }
  if (!target.deconstruct && current) {
    return targetChanged(order, `workstation id ${targetId} is now occupied`)
  }
  if (!current && !target.construct) return { ok: true, layout }

  let candidate = layout
  if (current) {
    const removed = removeWorkstation(candidate, targetId)
    if (!removed.ok) return fromConstructionResult(removed)
    candidate = removed.layout
  }

  if (!target.construct) return { ok: true, layout: candidate }
  return fromConstructionResult(placeWorkstation(candidate, target.construct))
}

const applyOrderTarget = (
  layout: ConstructionLayout,
  order: ConstructionOrder,
): ApplyTargetResult =>
  order.target.kind === 'boundary'
    ? applyBoundaryTarget(layout, order, order.target)
    : applyWorkstationTarget(layout, order, order.target)

/**
 * Converts the diff between the layout a player saw and a successful projected
 * construction result into worker-executable orders. The source layout is not
 * mutated and the result layout is represented only as queued targets.
 */
export const deriveConstructionOrders = (
  projectedSource: ConstructionLayout,
  result: ConstructionResult,
  options: DeriveConstructionOrdersOptions,
): ConstructionOrder[] => {
  if (!result.ok) return []

  const targets: ConstructionOrderTarget[] = []
  const sourceBoundaries = new Map(
    projectedSource.boundaries.map((boundary) => [pointKey(boundary), boundary]),
  )
  const resultBoundaries = new Map(
    result.layout.boundaries.map((boundary) => [pointKey(boundary), boundary]),
  )
  const boundaryKeys = new Set([
    ...sourceBoundaries.keys(),
    ...resultBoundaries.keys(),
  ])

  ;[...boundaryKeys]
    .map((key) => ({ key, point: sourceBoundaries.get(key) ?? resultBoundaries.get(key)! }))
    .sort((left, right) => comparePoints(left.point, right.point))
    .forEach(({ key, point }) => {
      const before = sourceBoundaries.get(key)
      const after = resultBoundaries.get(key)
      if (sameBoundary(before, after)) return
      targets.push({
        kind: 'boundary',
        cells: [clonePoint(point)],
        construct: after ? cloneBoundary(after) : null,
        deconstruct: before ? cloneBoundary(before) : null,
      })
    })

  const sourceWorkstations = new Map(
    projectedSource.workstations.map((workstation) => [workstation.id, workstation]),
  )
  const resultWorkstations = new Map(
    result.layout.workstations.map((workstation) => [workstation.id, workstation]),
  )

  ;[...new Set([...sourceWorkstations.keys(), ...resultWorkstations.keys()])]
    .sort((left, right) => left.localeCompare(right))
    .forEach((id) => {
      const before = sourceWorkstations.get(id)
      const after = resultWorkstations.get(id)
      if (sameWorkstation(before, after)) return
      targets.push({
        kind: 'workstation',
        cells: uniqueSortedCells([
          ...(before ? getWorkstationCells(before) : []),
          ...(after ? getWorkstationCells(after) : []),
        ]),
        construct: after ? cloneWorkstation(after) : null,
        deconstruct: before ? cloneWorkstation(before) : null,
      })
    })

  const priority = Number.isFinite(options.priority) ? options.priority! : 0
  const sequenceStart = Number.isSafeInteger(options.sequenceStart)
    ? options.sequenceStart!
    : 0

  return targets.map((target, index) => {
    const requirements = orderRequirements(target)
    const sequence = sequenceStart + index
    return {
      id: `${options.commandId}:${sequence}`,
      commandId: options.commandId,
      sequence,
      priority,
      operation: operationFor(Boolean(target.construct), Boolean(target.deconstruct)),
      status: requirements.materialRequired > 0 ? 'hauling' : 'building',
      assignedCrewId: null,
      target,
      materials: {
        required: requirements.materialRequired,
        delivered: 0,
      },
      work: {
        required: requirements.workRequired,
        completed: 0,
      },
    }
  })
}

/**
 * Applies every unfinished target to an ephemeral layout. This is the layout
 * build tools should validate against and render as ghosts; it is never the
 * authoritative completed construction state.
 */
export const projectConstructionOrders = (
  completedLayout: ConstructionLayout,
  orders: readonly ConstructionOrder[],
): ConstructionProjection => {
  let layout = cloneLayout(completedLayout)
  const issues: ConstructionProjectionIssue[] = []

  orders
    .filter((order) => order.status !== 'complete')
    .map(cloneOrder)
    .sort(compareProjectionOrder)
    .forEach((order) => {
      const applied = applyOrderTarget(layout, order)
      if (applied.ok) {
        layout = applied.layout
      } else {
        issues.push({ orderId: order.id, code: applied.code, error: applied.error })
      }
    })

  return { valid: issues.length === 0, layout, issues }
}

const normalizedWorkers = (workers: readonly ConstructionWorker[]) => {
  const sorted = workers
    .filter(
      (worker) =>
        worker.id.trim() &&
        Number.isFinite(worker.engineeringRate) &&
        worker.engineeringRate > 0,
    )
    .map((worker) => ({
      ...worker,
      haulingRate:
        Number.isFinite(worker.haulingRate) && worker.haulingRate! > 0
          ? worker.haulingRate!
          : 1,
    }))
    .sort(
      (left, right) =>
        right.engineeringRate - left.engineeringRate ||
        left.id.localeCompare(right.id) ||
        right.haulingRate - left.haulingRate,
    )

  const workersById = new Map<string, (typeof sorted)[number]>()
  sorted.forEach((worker) => {
    if (!workersById.has(worker.id)) workersById.set(worker.id, worker)
  })
  return [...workersById.values()]
}

/**
 * Advances one simulation slice. Each eligible worker takes at most one order;
 * hauling and building are distinct phases. Construction primitives are called
 * only after work reaches its requirement, so partial work cannot alter the
 * completed layout.
 */
export const advanceConstructionOrders = (
  completedLayout: ConstructionLayout,
  sourceOrders: readonly ConstructionOrder[],
  eligibleWorkers: readonly ConstructionWorker[],
  elapsed = 1,
): ConstructionAdvanceResult => {
  let layout = cloneLayout(completedLayout)
  const orders = sourceOrders.map(cloneOrder)
  const completedOrderIds: string[] = []
  const blockedOrderIds: string[] = []

  if (!Number.isFinite(elapsed) || elapsed <= 0) {
    return { layout, orders, completedOrderIds, blockedOrderIds }
  }

  // A fully worked order may have been blocked by another queued job. Retry it
  // before dispatching workers so dependencies can resolve without losing work.
  orders
    .filter(
      (order) =>
        order.status === 'blocked' && order.work.completed >= order.work.required,
    )
    .sort(compareProjectionOrder)
    .forEach((order) => {
      const applied = applyOrderTarget(layout, order)
      if (!applied.ok) return
      layout = applied.layout
      order.status = 'complete'
      order.assignedCrewId = null
      completedOrderIds.push(order.id)
    })

  orders.forEach((order) => {
    if (order.status !== 'complete') order.assignedCrewId = null
    if (
      order.status === 'hauling' &&
      order.materials.delivered >= order.materials.required
    ) {
      order.status = 'building'
    }
  })

  const workers = normalizedWorkers(eligibleWorkers)
  const activeOrders = orders
    .filter((order) => order.status === 'hauling' || order.status === 'building')
    .sort(compareWorkOrder)

  activeOrders.slice(0, workers.length).forEach((order, index) => {
    const worker = workers[index]
    order.assignedCrewId = worker.id

    if (order.status === 'hauling') {
      order.materials.delivered = Math.min(
        order.materials.required,
        order.materials.delivered + worker.haulingRate * elapsed,
      )
      if (order.materials.delivered >= order.materials.required) {
        order.status = 'building'
      }
      return
    }

    order.work.completed = Math.min(
      order.work.required,
      order.work.completed + worker.engineeringRate * elapsed,
    )
    if (order.work.completed < order.work.required) return

    const applied = applyOrderTarget(layout, order)
    order.assignedCrewId = null
    if (applied.ok) {
      layout = applied.layout
      order.status = 'complete'
      completedOrderIds.push(order.id)
    } else {
      order.status = 'blocked'
      blockedOrderIds.push(order.id)
    }
  })

  return { layout, orders, completedOrderIds, blockedOrderIds }
}

/** Cancels unfinished work from one player command and rebuilds its ghost view. */
export const cancelConstructionCommand = (
  completedLayout: ConstructionLayout,
  sourceOrders: readonly ConstructionOrder[],
  commandId: string,
): CancelConstructionCommandResult => {
  const cancelledOrderIds: string[] = []
  const orders = sourceOrders
    .filter((order) => {
      const cancel = order.commandId === commandId && order.status !== 'complete'
      if (cancel) cancelledOrderIds.push(order.id)
      return !cancel
    })
    .map(cloneOrder)

  const layout = cloneLayout(completedLayout)
  return {
    layout,
    orders,
    projection: projectConstructionOrders(layout, orders),
    cancelledOrderIds,
  }
}
