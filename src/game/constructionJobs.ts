import {
  boundaryAt,
  eraseAt,
  getWorkstationCells,
  isInConstructionBounds,
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
import {
  BOUNDARY_SPECS,
  WORKSTATION_SPECS,
  type WorkstationKind,
} from './constructionCatalog'

export type ConstructionOrderStatus =
  | 'hauling'
  | 'building'
  | 'complete'
  | 'blocked'

export type ConstructionOperation = 'construct' | 'deconstruct' | 'replace'

export type ConstructionBlock =
  | {
      kind: 'insufficient_materials'
      message: string
    }
  | {
      kind: 'target_changed'
      message: string
    }

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
  block: ConstructionBlock | null
  assignedCrewId: string | null
  target: ConstructionOrderTarget
  materials: {
    required: number
    reserved: number
    delivered: number
    recoverable: number
  }
  work: {
    required: number
    completed: number
  }
}

export type LegacyConstructionOrderV5 = Omit<
  ConstructionOrder,
  'block' | 'materials'
> & {
  materials: {
    required: number
    delivered: number
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
  constructionStock: number
  recoveredMaterials: number
  completedOrderIds: string[]
  blockedOrderIds: string[]
}

export interface ConstructionAdvanceOptions {
  constructionStock: number
  elapsed?: number
}

export interface ConstructionMaterialReservationResult {
  orders: ConstructionOrder[]
  availableStock: number
  reservedOrderIds: string[]
  blockedOrderIds: string[]
}

export interface CancelConstructionCommandResult {
  layout: ConstructionLayout
  orders: ConstructionOrder[]
  projection: ConstructionProjection
  cancelledOrderIds: string[]
  returnedMaterials: number
}

export interface NormalizePersistedConstructionOrdersOptions {
  legacyV5?: boolean
}

interface AppliedTarget {
  ok: true
  layout: ConstructionLayout
  changed: boolean
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
  block: order.block ? { ...order.block } : null,
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

const workstationMaterialCost = (workstation: WorkstationPlacement) =>
  WORKSTATION_SPECS[workstation.type as WorkstationKind]?.materialCost ??
  getWorkstationCells(workstation).length

const targetMaterialCost = (
  target: ConstructionOrderTarget,
  side: 'construct' | 'deconstruct',
) => {
  if (target.kind === 'boundary') {
    const boundary = target[side]
    return boundary ? BOUNDARY_SPECS[boundary.kind].materialCost : 0
  }
  const workstation = target[side]
  return workstation ? workstationMaterialCost(workstation) : 0
}

const orderRequirements = (target: ConstructionOrderTarget) => {
  const affectedCells = Math.max(1, target.cells.length)

  return {
    materialRequired: targetMaterialCost(target, 'construct'),
    materialRecoverable: targetMaterialCost(target, 'deconstruct'),
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
    ? { ok: true, layout: result.layout, changed: true }
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
    return { ok: true, layout, changed: false }
  }

  if (target.deconstruct && !sameBoundary(current, target.deconstruct)) {
    if (!current && !target.construct) return { ok: true, layout, changed: false }
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
    return { ok: true, layout, changed: false }
  }

  if (target.deconstruct && current && !sameWorkstation(current, target.deconstruct)) {
    return targetChanged(order, `workstation ${targetId} changed`)
  }
  if (!target.deconstruct && current) {
    return targetChanged(order, `workstation id ${targetId} is now occupied`)
  }
  if (!current && !target.construct) return { ok: true, layout, changed: false }

  let candidate = layout
  if (current) {
    const removed = removeWorkstation(candidate, targetId)
    if (!removed.ok) return fromConstructionResult(removed)
    candidate = removed.layout
  }

  if (!target.construct) return { ok: true, layout: candidate, changed: true }
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
      status: requirements.materialRequired > 0 ? 'blocked' : 'building',
      block: requirements.materialRequired > 0
        ? {
            kind: 'insufficient_materials',
            message: `Needs ${requirements.materialRequired} construction material.`,
          }
        : null,
      assignedCrewId: null,
      target,
      materials: {
        required: requirements.materialRequired,
        reserved: 0,
        delivered: 0,
        recoverable: requirements.materialRecoverable,
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

const MATERIAL_EPSILON = 0.000001

const nonnegativeFinite = (value: number) =>
  Number.isFinite(value) && value > 0 ? value : 0

const clampMaterial = (value: number, maximum = Number.POSITIVE_INFINITY) => {
  const upperBound = Number.isFinite(maximum) ? Math.max(0, maximum) : maximum
  return Math.min(nonnegativeFinite(value), upperBound)
}

const materialAmountLabel = (value: number) =>
  Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100)

const insufficientMaterialsBlock = (amount: number): ConstructionBlock => ({
  kind: 'insufficient_materials',
  message: `Needs ${materialAmountLabel(amount)} construction material.`,
})

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const persistedNumber = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0

const persistedPoint = (value: unknown): GridPoint | null => {
  if (
    !isRecord(value) ||
    typeof value.x !== 'number' ||
    typeof value.y !== 'number'
  ) {
    return null
  }
  const point = { x: value.x, y: value.y }
  return isInConstructionBounds(point) ? point : null
}

const persistedBoundary = (value: unknown): BoundaryCell | null => {
  if (
    !isRecord(value) ||
    (value.kind !== 'wall' && value.kind !== 'door')
  ) {
    return null
  }
  const point = persistedPoint(value)
  return point ? { ...point, kind: value.kind } : null
}

const persistedWorkstation = (value: unknown): WorkstationPlacement | null => {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    !value.id.trim() ||
    typeof value.type !== 'string' ||
    !value.type.trim() ||
    !Object.prototype.hasOwnProperty.call(WORKSTATION_SPECS, value.type) ||
    typeof value.label !== 'string' ||
    !isRecord(value.size) ||
    typeof value.size.width !== 'number' ||
    typeof value.size.height !== 'number' ||
    !Number.isSafeInteger(value.size.width) ||
    !Number.isSafeInteger(value.size.height) ||
    (value.size.width as number) <= 0 ||
    (value.size.height as number) <= 0 ||
    (value.rotation !== 0 &&
      value.rotation !== 90 &&
      value.rotation !== 180 &&
      value.rotation !== 270)
  ) {
    return null
  }
  const origin = persistedPoint(value.origin)
  if (!origin) return null
  const workstation: WorkstationPlacement = {
    id: value.id,
    type: value.type,
    label: value.label,
    origin,
    size: {
      width: value.size.width as number,
      height: value.size.height as number,
    },
    rotation: value.rotation,
  }
  const cells = getWorkstationCells(workstation)
  return cells.length > 0 && cells.every((cell) => isInConstructionBounds(cell))
    ? workstation
    : null
}

const persistedTarget = (value: unknown): ConstructionOrderTarget | null => {
  if (!isRecord(value)) return null

  if (value.kind === 'boundary') {
    const construct = value.construct === null
      ? null
      : persistedBoundary(value.construct)
    const deconstruct = value.deconstruct === null
      ? null
      : persistedBoundary(value.deconstruct)
    if (
      (value.construct !== null && !construct) ||
      (value.deconstruct !== null && !deconstruct) ||
      (!construct && !deconstruct)
    ) {
      return null
    }
    const cell = construct ?? deconstruct!
    if (
      construct &&
      deconstruct &&
      (construct.x !== deconstruct.x || construct.y !== deconstruct.y)
    ) {
      return null
    }
    return {
      kind: 'boundary',
      cells: [{ x: cell.x, y: cell.y }],
      construct,
      deconstruct,
    }
  }

  if (value.kind === 'workstation') {
    const construct = value.construct === null
      ? null
      : persistedWorkstation(value.construct)
    const deconstruct = value.deconstruct === null
      ? null
      : persistedWorkstation(value.deconstruct)
    if (
      (value.construct !== null && !construct) ||
      (value.deconstruct !== null && !deconstruct) ||
      (!construct && !deconstruct) ||
      (construct && deconstruct && construct.id !== deconstruct.id)
    ) {
      return null
    }
    return {
      kind: 'workstation',
      cells: uniqueSortedCells([
        ...(construct ? getWorkstationCells(construct) : []),
        ...(deconstruct ? getWorkstationCells(deconstruct) : []),
      ]),
      construct,
      deconstruct,
    }
  }

  return null
}

const normalizePersistedOrder = (
  value: unknown,
  legacyV5: boolean,
): ConstructionOrder | null => {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    !value.id.trim() ||
    typeof value.commandId !== 'string' ||
    !value.commandId.trim() ||
    typeof value.sequence !== 'number' ||
    !Number.isSafeInteger(value.sequence) ||
    (value.sequence as number) < 0 ||
    (value.sequence as number) >= Number.MAX_SAFE_INTEGER
  ) {
    return null
  }

  const target = persistedTarget(value.target)
  if (!target) return null
  const requirements = orderRequirements(target)
  const isComplete = value.status === 'complete'
  const work = isRecord(value.work) ? value.work : {}
  const materials = isRecord(value.materials) ? value.materials : {}
  const priority = typeof value.priority === 'number' && Number.isFinite(value.priority)
    ? Math.min(5, Math.max(1, Math.round(value.priority)))
    : 3

  if (isComplete) {
    return {
      id: value.id,
      commandId: value.commandId,
      sequence: value.sequence as number,
      priority,
      operation: operationFor(Boolean(target.construct), Boolean(target.deconstruct)),
      status: 'complete',
      block: null,
      assignedCrewId: null,
      target,
      materials: {
        required: requirements.materialRequired,
        reserved: 0,
        delivered: requirements.materialRequired,
        recoverable: requirements.materialRecoverable,
      },
      work: {
        required: requirements.workRequired,
        completed: requirements.workRequired,
      },
    }
  }

  const validPersistedWork =
    typeof work.required === 'number' &&
    Number.isFinite(work.required) &&
    Math.abs(work.required - requirements.workRequired) <= MATERIAL_EPSILON &&
    typeof work.completed === 'number' &&
    Number.isFinite(work.completed) &&
    work.completed >= 0 &&
    work.completed <= requirements.workRequired + MATERIAL_EPSILON
  const validPersistedMaterials =
    typeof materials.required === 'number' &&
    Number.isFinite(materials.required) &&
    Math.abs(materials.required - requirements.materialRequired) <= MATERIAL_EPSILON &&
    typeof materials.recoverable === 'number' &&
    Number.isFinite(materials.recoverable) &&
    Math.abs(materials.recoverable - requirements.materialRecoverable) <=
      MATERIAL_EPSILON &&
    typeof materials.delivered === 'number' &&
    Number.isFinite(materials.delivered) &&
    materials.delivered >= 0 &&
    materials.delivered <= requirements.materialRequired + MATERIAL_EPSILON &&
    typeof materials.reserved === 'number' &&
    Number.isFinite(materials.reserved) &&
    materials.reserved >= 0 &&
    materials.reserved <=
      requirements.materialRequired - materials.delivered + MATERIAL_EPSILON
  const completedWork =
    legacyV5 || !validPersistedWork
      ? legacyV5 && requirements.materialRequired <= MATERIAL_EPSILON
        ? clampMaterial(persistedNumber(work.completed), requirements.workRequired)
        : 0
      : clampMaterial(work.completed as number, requirements.workRequired)
  const delivered = !legacyV5 && validPersistedMaterials
    ? clampMaterial(materials.delivered as number, requirements.materialRequired)
    : 0
  const reserved = !legacyV5 && validPersistedMaterials
    ? clampMaterial(
        materials.reserved as number,
        requirements.materialRequired - delivered,
      )
    : 0
  const persistedBlock = isRecord(value.block) ? value.block : null
  const targetChanged = legacyV5
    ? requirements.materialRequired <= MATERIAL_EPSILON &&
      value.status === 'blocked' &&
      completedWork + MATERIAL_EPSILON >= requirements.workRequired
    : value.status === 'blocked' && persistedBlock?.kind === 'target_changed'

  return {
    id: value.id,
    commandId: value.commandId,
    sequence: value.sequence as number,
    priority,
    operation: operationFor(Boolean(target.construct), Boolean(target.deconstruct)),
    status: targetChanged
      ? 'blocked'
      : delivered + MATERIAL_EPSILON >= requirements.materialRequired
        ? 'building'
        : 'blocked',
    block: targetChanged
      ? {
          kind: 'target_changed',
          message: 'The construction target changed before this saved job completed.',
        }
      : requirements.materialRequired - delivered > MATERIAL_EPSILON
        ? insufficientMaterialsBlock(requirements.materialRequired - delivered)
        : null,
    assignedCrewId:
      !legacyV5 &&
      typeof value.assignedCrewId === 'string' &&
      value.assignedCrewId.trim()
        ? value.assignedCrewId
        : null,
    target,
    materials: {
      required: requirements.materialRequired,
      reserved,
      delivered,
      recoverable: requirements.materialRecoverable,
    },
    work: {
      required: requirements.workRequired,
      completed: completedWork,
    },
  }
}

/**
 * Rebuilds persisted order ledgers from validated construction targets. Raw
 * material/work totals are never trusted, and malformed or duplicate records
 * are dropped before projection, reservation, rendering, or cancellation.
 */
export const normalizePersistedConstructionOrders = (
  sourceOrders: unknown,
  constructionStock: number,
  options: NormalizePersistedConstructionOrdersOptions = {},
): ConstructionMaterialReservationResult => {
  const seenOrderIds = new Set<string>()
  const orders = (Array.isArray(sourceOrders) ? sourceOrders : []).flatMap((source) => {
    const order = normalizePersistedOrder(source, Boolean(options.legacyV5))
    if (!order || seenOrderIds.has(order.id)) return []
    seenOrderIds.add(order.id)
    return [order]
  })
  return reserveConstructionMaterials(orders, constructionStock)
}

/** Material still in storage and not promised to an unfinished blueprint. */
export const availableConstructionStock = (
  constructionStock: number,
  orders: readonly ConstructionOrder[],
) => {
  const reserved = orders.reduce(
    (total, order) =>
      order.status === 'complete'
        ? total
        : total + nonnegativeFinite(order.materials.reserved),
    0,
  )
  return Math.max(0, nonnegativeFinite(constructionStock) - reserved)
}

/**
 * Reconciles whole-order material promises against physical stock. Existing
 * valid promises are kept before newly affordable orders are funded. A job is
 * never partially reserved: it either owns every undelivered unit or waits.
 */
export const reserveConstructionMaterials = (
  sourceOrders: readonly ConstructionOrder[],
  constructionStock: number,
): ConstructionMaterialReservationResult => {
  const orders = sourceOrders.map(cloneOrder)
  let unpromisedStock = nonnegativeFinite(constructionStock)
  const fundedOrderIds = new Set<string>()
  const previouslyFundedOrderIds = new Set(
    orders
      .filter((order) => {
        const required = nonnegativeFinite(order.materials.required)
        const delivered = clampMaterial(order.materials.delivered, required)
        const remaining = Math.max(0, required - delivered)
        return (
          order.status !== 'complete' &&
          remaining > MATERIAL_EPSILON &&
          Math.abs(nonnegativeFinite(order.materials.reserved) - remaining) <=
            MATERIAL_EPSILON
        )
      })
      .map((order) => order.id),
  )

  orders.forEach((order) => {
    const required = nonnegativeFinite(order.materials.required)
    const delivered = clampMaterial(order.materials.delivered, required)
    const recoverable = nonnegativeFinite(order.materials.recoverable)
    order.materials = {
      required,
      reserved: clampMaterial(order.materials.reserved, required - delivered),
      delivered,
      recoverable,
    }

    if (order.status === 'complete') {
      order.materials.reserved = 0
      order.block = null
      order.assignedCrewId = null
      return
    }

    if (order.block?.kind === 'target_changed') {
      order.materials.reserved = 0
      order.status = 'blocked'
      order.assignedCrewId = null
      return
    }

    const remaining = Math.max(0, required - delivered)
    if (remaining <= MATERIAL_EPSILON) {
      order.materials.delivered = required
      order.materials.reserved = 0
      order.status = 'building'
      order.block = null
      return
    }

    // A malformed partial promise is released and reconsidered atomically.
    if (Math.abs(order.materials.reserved - remaining) > MATERIAL_EPSILON) {
      order.materials.reserved = 0
    }
  })

  orders
    .filter((order) => previouslyFundedOrderIds.has(order.id))
    .sort(compareProjectionOrder)
    .forEach((order) => {
      if (
        order.status === 'complete' ||
        order.block?.kind === 'target_changed'
      ) return
      const remaining = Math.max(
        0,
        order.materials.required - order.materials.delivered,
      )
      if (
        remaining <= MATERIAL_EPSILON ||
        unpromisedStock + MATERIAL_EPSILON < remaining
      ) {
        order.materials.reserved = 0
        return
      }
      order.materials.reserved = remaining
      order.status = 'hauling'
      order.block = null
      unpromisedStock = Math.max(0, unpromisedStock - remaining)
      fundedOrderIds.add(order.id)
    })

  orders
    .filter((order) => {
      if (
        order.status === 'complete' ||
        order.block?.kind === 'target_changed' ||
        fundedOrderIds.has(order.id)
      ) return false
      return order.materials.required - order.materials.delivered > MATERIAL_EPSILON
    })
    .sort(compareWorkOrder)
    .forEach((order) => {
      const remaining = order.materials.required - order.materials.delivered
      if (unpromisedStock + MATERIAL_EPSILON >= remaining) {
        order.materials.reserved = remaining
        order.status = 'hauling'
        order.block = null
        unpromisedStock = Math.max(0, unpromisedStock - remaining)
        fundedOrderIds.add(order.id)
      } else {
        order.materials.reserved = 0
        order.status = 'blocked'
        order.block = insufficientMaterialsBlock(remaining)
        order.assignedCrewId = null
      }
    })

  const blockedOrderIds = orders
    .filter((order) => order.block?.kind === 'insufficient_materials')
    .map((order) => order.id)
  const reservedOrderIds = [...fundedOrderIds].filter(
    (id) => !previouslyFundedOrderIds.has(id),
  )

  return {
    orders,
    availableStock: Math.max(0, unpromisedStock),
    reservedOrderIds,
    blockedOrderIds,
  }
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
  options: ConstructionAdvanceOptions,
): ConstructionAdvanceResult => {
  let layout = cloneLayout(completedLayout)
  let constructionStock = nonnegativeFinite(options.constructionStock)
  let reservation = reserveConstructionMaterials(sourceOrders, constructionStock)
  let orders = reservation.orders
  const completedOrderIds: string[] = []
  let recoveredMaterials = 0
  const elapsed = options.elapsed ?? 1

  if (!Number.isFinite(elapsed) || elapsed <= 0) {
    return {
      layout,
      orders,
      constructionStock,
      recoveredMaterials,
      completedOrderIds,
      blockedOrderIds: orders
        .filter((order) => order.status === 'blocked')
        .map((order) => order.id),
    }
  }

  // A fully worked order may have been blocked by another queued job. Retry it
  // before dispatching workers so dependencies can resolve without losing work.
  orders
    .filter(
      (order) =>
        order.status === 'blocked' &&
        order.block?.kind === 'target_changed' &&
        order.work.completed >= order.work.required,
    )
    .sort(compareProjectionOrder)
    .forEach((order) => {
      const applied = applyOrderTarget(layout, order)
      if (!applied.ok) return
      layout = applied.layout
      order.status = 'complete'
      order.block = null
      order.assignedCrewId = null
      order.materials.reserved = 0
      if (applied.changed && order.materials.recoverable > 0) {
        constructionStock += order.materials.recoverable
        recoveredMaterials += order.materials.recoverable
      }
      completedOrderIds.push(order.id)
    })

  // Salvage recovered while resolving a dependency can fund waiting work in
  // the same simulation slice, though a worker will not start it until dispatch.
  reservation = reserveConstructionMaterials(orders, constructionStock)
  orders = reservation.orders

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
      const remaining = Math.max(
        0,
        order.materials.required - order.materials.delivered,
      )
      const delivered = Math.min(
        remaining,
        order.materials.reserved,
        constructionStock,
        worker.haulingRate * elapsed,
      )
      if (delivered <= MATERIAL_EPSILON) {
        order.status = 'blocked'
        order.block = insufficientMaterialsBlock(remaining)
        order.assignedCrewId = null
        return
      }
      constructionStock = Math.max(0, constructionStock - delivered)
      order.materials.reserved = Math.max(
        0,
        order.materials.reserved - delivered,
      )
      order.materials.delivered = Math.min(
        order.materials.required,
        order.materials.delivered + delivered,
      )
      if (
        order.materials.delivered + MATERIAL_EPSILON >=
        order.materials.required
      ) {
        order.materials.delivered = order.materials.required
        order.materials.reserved = 0
        order.status = 'building'
        order.block = null
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
      order.block = null
      order.materials.reserved = 0
      if (applied.changed && order.materials.recoverable > 0) {
        constructionStock += order.materials.recoverable
        recoveredMaterials += order.materials.recoverable
      }
      completedOrderIds.push(order.id)
    } else {
      order.status = 'blocked'
      order.block = { kind: 'target_changed', message: applied.error }
    }
  })

  reservation = reserveConstructionMaterials(orders, constructionStock)
  orders = reservation.orders

  return {
    layout,
    orders,
    constructionStock,
    recoveredMaterials,
    completedOrderIds,
    blockedOrderIds: orders
      .filter((order) => order.status === 'blocked')
      .map((order) => order.id),
  }
}

/** Material already staged at unfinished blueprints and recoverable on cancel. */
export const returnedConstructionMaterials = (
  orders: readonly ConstructionOrder[],
) => orders.reduce(
  (total, order) =>
    order.status === 'complete'
      ? total
      : total + nonnegativeFinite(order.materials.delivered),
  0,
)

/**
 * Cancels explicit unfinished orders plus any later blueprints whose targets
 * only projected successfully because those orders existed.
 */
export const cancelConstructionOrders = (
  completedLayout: ConstructionLayout,
  sourceOrders: readonly ConstructionOrder[],
  requestedOrderIds: ReadonlySet<string>,
): CancelConstructionCommandResult => {
  const baselineIssueIds = new Set(
    projectConstructionOrders(completedLayout, sourceOrders).issues.map(
      (issue) => issue.orderId,
    ),
  )
  const cancelledOrderIds: string[] = []
  const cancelledOrders: ConstructionOrder[] = []
  let orders = sourceOrders
    .filter((order) => {
      const cancel = requestedOrderIds.has(order.id) && order.status !== 'complete'
      if (cancel) {
        cancelledOrderIds.push(order.id)
        cancelledOrders.push(order)
      }
      return !cancel
    })
    .map(cloneOrder)

  const layout = cloneLayout(completedLayout)
  let projection = projectConstructionOrders(layout, orders)
  while (true) {
    const dependentOrderIds = new Set(
      projection.issues
        .filter((issue) => !baselineIssueIds.has(issue.orderId))
        .map((issue) => issue.orderId),
    )
    if (dependentOrderIds.size === 0) break

    const retainedOrders: ConstructionOrder[] = []
    let removedDependent = false
    orders.forEach((order) => {
      if (dependentOrderIds.has(order.id) && order.status !== 'complete') {
        cancelledOrderIds.push(order.id)
        cancelledOrders.push(order)
        removedDependent = true
      } else {
        retainedOrders.push(order)
      }
    })
    if (!removedDependent) break
    orders = retainedOrders
    projection = projectConstructionOrders(layout, orders)
  }

  return {
    layout,
    orders,
    projection,
    cancelledOrderIds,
    returnedMaterials: returnedConstructionMaterials(cancelledOrders),
  }
}

/** Cancels unfinished work from one player command and rebuilds its ghost view. */
export const cancelConstructionCommand = (
  completedLayout: ConstructionLayout,
  sourceOrders: readonly ConstructionOrder[],
  commandId: string,
): CancelConstructionCommandResult =>
  cancelConstructionOrders(
    completedLayout,
    sourceOrders,
    new Set(
      sourceOrders
        .filter((order) => order.commandId === commandId)
        .map((order) => order.id),
    ),
  )

/** Cancels one unfinished blueprint and any projected dependants. */
export const cancelConstructionOrder = (
  completedLayout: ConstructionLayout,
  sourceOrders: readonly ConstructionOrder[],
  orderId: string,
): CancelConstructionCommandResult =>
  cancelConstructionOrders(completedLayout, sourceOrders, new Set([orderId]))

/**
 * Converts v5's cosmetic hauling progress into the first material-ledger save.
 * Unfinished construction is deliberately reset because v5 delivery never
 * removed stock. Completed targets are grandfathered without a retroactive
 * charge; unfinished deconstruction keeps its material-free labor progress.
 * Invalid records are ignored and all target-derived costs are rebuilt.
 */
export const migrateV5ConstructionOrders = (
  sourceOrders: unknown,
  constructionStock: number,
): ConstructionMaterialReservationResult =>
  normalizePersistedConstructionOrders(sourceOrders, constructionStock, {
    legacyV5: true,
  })
