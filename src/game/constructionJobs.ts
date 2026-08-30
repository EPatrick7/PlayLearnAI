import {
  boundaryAt,
  detectRooms,
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

export type ConstructionTravelPhase =
  | 'idle'
  | 'to_stockpile'
  | 'to_site'
  | 'at_site'

export type ConstructionBlock =
  | {
      kind: 'insufficient_materials'
      message: string
    }
  | {
      kind: 'prerequisite'
      message: string
    }
  | {
      kind: 'target_changed'
      message: string
    }
  | {
      kind: 'no_path'
      message: string
    }
  | {
      kind: 'carrier_unavailable'
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
  /** Durable player intent. Routing may release the live claim without losing this priority. */
  forcedCrewId?: string | null
  /** Persisted physical phase used by the spatial worker simulation. */
  travelPhase?: ConstructionTravelPhase
  /** Spatial context in which a route was last proven impossible. */
  routeBlockedContextKey?: string | null
  /**
   * Earlier construction orders whose completed targets make this target
   * executable. Optional only so pre-dependency saves and hand-authored test
   * fixtures remain source-compatible; derived and normalized orders emit it.
   */
  prerequisiteOrderIds?: string[]
  target: ConstructionOrderTarget
  materials: {
    required: number
    reserved: number
    delivered: number
    recoverable: number
    /** Material physically held by a colonist while walking to this site. */
    carried?: number
    /** The only colonist allowed to move this in-transit material. */
    carriedByCrewId?: string | null
  }
  work: {
    required: number
    completed: number
  }
}

export type LegacyConstructionOrderV5 = Omit<
  ConstructionOrder,
  | 'block'
  | 'materials'
  | 'prerequisiteOrderIds'
  | 'travelPhase'
  | 'routeBlockedContextKey'
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
  /** The authoritative layout containing completed construction only. */
  completedLayout?: ConstructionLayout
  /** Existing projected orders that precede the newly derived command. */
  prerequisiteOrders?: readonly ConstructionOrder[]
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
  /** v8 stored in-transit cargo in `delivered`; convert it without teleporting. */
  legacyDeliveredInTransit?: boolean
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
  prerequisiteOrderIds: [...(order.prerequisiteOrderIds ?? [])],
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

const prerequisiteWaitBlock = (
  prerequisiteOrderIds: readonly string[],
): ConstructionBlock => ({
  kind: 'prerequisite',
  message: prerequisiteOrderIds.length === 1
    ? `Waiting for prerequisite ${prerequisiteOrderIds[0]}.`
    : `Waiting for ${prerequisiteOrderIds.length} prerequisite construction orders.`,
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

const indoorTargetFitsCompletedRoom = (
  layout: ConstructionLayout,
  order: ConstructionOrder,
) => {
  if (order.target.kind !== 'workstation' || !order.target.construct) return true
  const spec = WORKSTATION_SPECS[order.target.construct.type as WorkstationKind]
  if (!spec?.indoor) return true

  const roomByCell = new Map(
    detectRooms(layout).flatMap((room) =>
      room.cells.map((cell) => [pointKey(cell), room.id] as const),
    ),
  )
  const roomIds = order.target.cells.map((cell) => roomByCell.get(pointKey(cell)))
  return Boolean(
    roomIds[0] && roomIds.every((roomId) => roomId === roomIds[0]),
  )
}

const targetIsExecutable = (
  layout: ConstructionLayout,
  order: ConstructionOrder,
) => {
  const applied = applyOrderTarget(layout, order)
  return applied.ok && indoorTargetFitsCompletedRoom(applied.layout, order)
}

const targetIsExecutableAfter = (
  completedLayout: ConstructionLayout,
  prerequisiteOrders: readonly ConstructionOrder[],
  order: ConstructionOrder,
) => {
  let layout = cloneLayout(completedLayout)
  for (const prerequisite of [...prerequisiteOrders].sort(compareProjectionOrder)) {
    const applied = applyOrderTarget(layout, prerequisite)
    if (!applied.ok) return false
    layout = applied.layout
  }
  return targetIsExecutable(layout, order)
}

/**
 * Reduces the preceding projected ledger to an inclusion-minimal, deterministic
 * set whose completed targets make `order` executable from the completed
 * layout. Keeping transitive prerequisites is intentionally conservative: it
 * also guarantees the selected targets can themselves be projected in order.
 */
const derivePrerequisiteOrderIds = (
  completedLayout: ConstructionLayout,
  sourceOrders: readonly ConstructionOrder[],
  order: ConstructionOrder,
) => {
  const candidates = sourceOrders
    .filter((candidate) => candidate.status !== 'complete')
    .map(cloneOrder)
    .sort(compareProjectionOrder)
  if (targetIsExecutableAfter(completedLayout, [], order)) return []

  let required = candidates
  for (const candidate of candidates) {
    const withoutCandidate = required.filter((item) => item.id !== candidate.id)
    if (targetIsExecutableAfter(completedLayout, withoutCandidate, order)) {
      required = withoutCandidate
    }
  }
  return required.map((candidate) => candidate.id)
}

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

  const orders = targets.map((target, index): ConstructionOrder => {
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
      forcedCrewId: null,
      travelPhase: 'idle',
      routeBlockedContextKey: null,
      prerequisiteOrderIds: [],
      target,
      materials: {
        required: requirements.materialRequired,
        reserved: 0,
        delivered: 0,
        recoverable: requirements.materialRecoverable,
        carried: 0,
        carriedByCrewId: null,
      },
      work: {
        required: requirements.workRequired,
        completed: 0,
      },
    }
  })

  if (!options.completedLayout || !options.prerequisiteOrders) return orders

  orders.forEach((order, index) => {
    order.prerequisiteOrderIds = derivePrerequisiteOrderIds(
      options.completedLayout!,
      [...options.prerequisiteOrders!, ...orders.slice(0, index)],
      order,
    )
    if (order.prerequisiteOrderIds.length === 0) return
    order.status = 'blocked'
    order.block = prerequisiteWaitBlock(order.prerequisiteOrderIds)
    order.assignedCrewId = null
    order.materials.reserved = 0
  })

  return orders
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

export const carriedConstructionMaterial = (
  order: Pick<ConstructionOrder, 'materials'>,
) => clampMaterial(
  typeof order.materials.carried === 'number' ? order.materials.carried : 0,
  Math.max(0, order.materials.required - order.materials.delivered),
)

export const constructionMaterialAccountedFor = (
  order: Pick<ConstructionOrder, 'materials'>,
) => Math.min(
  nonnegativeFinite(order.materials.required),
  nonnegativeFinite(order.materials.delivered) + carriedConstructionMaterial(order),
)

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
  legacyDeliveredInTransit: boolean,
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
  const prerequisiteOrderIds = !legacyV5 && Array.isArray(value.prerequisiteOrderIds)
    ? [...new Set(
        value.prerequisiteOrderIds.filter(
          (id): id is string => typeof id === 'string' && Boolean(id.trim()),
        ),
      )].filter((id) => id !== value.id)
    : []
  const requirements = orderRequirements(target)
  const isComplete = value.status === 'complete'
  const work = isRecord(value.work) ? value.work : {}
  const materials = isRecord(value.materials) ? value.materials : {}
  const priority = typeof value.priority === 'number' && Number.isFinite(value.priority)
    ? Math.min(5, Math.max(1, Math.round(value.priority)))
    : 3
  const persistedTravelPhase: ConstructionTravelPhase =
    !legacyV5 &&
    (value.travelPhase === 'to_stockpile' ||
      value.travelPhase === 'to_site' ||
      value.travelPhase === 'at_site')
      ? value.travelPhase
      : 'idle'
  const persistedAssignedCrewId =
    !legacyV5 &&
    typeof value.assignedCrewId === 'string' &&
    value.assignedCrewId.trim()
      ? value.assignedCrewId
      : null
  const persistedForcedCrewId =
    !legacyV5 &&
    typeof value.forcedCrewId === 'string' &&
    value.forcedCrewId.trim()
      ? value.forcedCrewId
      : null

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
      forcedCrewId: null,
      travelPhase: 'idle',
      routeBlockedContextKey: null,
      prerequisiteOrderIds,
      target,
      materials: {
        required: requirements.materialRequired,
        reserved: 0,
        delivered: requirements.materialRequired,
        recoverable: requirements.materialRecoverable,
        carried: 0,
        carriedByCrewId: null,
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
  const persistedCarried = typeof materials.carried === 'number'
    ? materials.carried
    : 0
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
    (materials.carried === undefined || (
      typeof materials.carried === 'number' &&
      Number.isFinite(materials.carried) &&
      persistedCarried >= 0
    )) &&
    typeof materials.reserved === 'number' &&
    Number.isFinite(materials.reserved) &&
    materials.reserved >= 0 &&
    materials.reserved <=
      requirements.materialRequired - materials.delivered - persistedCarried + MATERIAL_EPSILON
  const completedWork =
    legacyV5 || !validPersistedWork
      ? legacyV5 && requirements.materialRequired <= MATERIAL_EPSILON
        ? clampMaterial(persistedNumber(work.completed), requirements.workRequired)
        : 0
      : clampMaterial(work.completed as number, requirements.workRequired)
  const normalizedDelivered = !legacyV5 && validPersistedMaterials
    ? clampMaterial(materials.delivered as number, requirements.materialRequired)
    : 0
  const persistedCarrierId =
    typeof materials.carriedByCrewId === 'string' && materials.carriedByCrewId.trim()
      ? materials.carriedByCrewId
      : null
  const migrateInTransit = Boolean(
    legacyDeliveredInTransit &&
    persistedAssignedCrewId &&
    persistedTravelPhase === 'to_site' &&
    normalizedDelivered > MATERIAL_EPSILON,
  )
  const orphanedCarried = !migrateInTransit && !persistedCarrierId
    ? clampMaterial(persistedCarried, requirements.materialRequired - normalizedDelivered)
    : 0
  const delivered = migrateInTransit
    ? 0
    : clampMaterial(normalizedDelivered + orphanedCarried, requirements.materialRequired)
  const carried = migrateInTransit
    ? normalizedDelivered
    : !legacyV5 && validPersistedMaterials && persistedCarrierId
      ? clampMaterial(
          persistedCarried,
          requirements.materialRequired - delivered,
        )
      : 0
  const carriedByCrewId = carried > MATERIAL_EPSILON
    ? migrateInTransit
      ? persistedAssignedCrewId
      : persistedCarrierId
    : null
  const reserved = !legacyV5 && validPersistedMaterials
    ? clampMaterial(
        materials.reserved as number,
        requirements.materialRequired - delivered - carried,
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
      : delivered + carried + MATERIAL_EPSILON >= requirements.materialRequired
        ? 'building'
        : 'blocked',
    block: targetChanged
      ? {
          kind: 'target_changed',
          message: 'The construction target changed before this saved job completed.',
        }
      : requirements.materialRequired - delivered - carried > MATERIAL_EPSILON
        ? insufficientMaterialsBlock(requirements.materialRequired - delivered - carried)
        : null,
    assignedCrewId: carriedByCrewId ?? persistedAssignedCrewId,
    forcedCrewId: persistedForcedCrewId,
    travelPhase: carriedByCrewId ? 'to_site' : persistedTravelPhase,
    routeBlockedContextKey:
      !legacyV5 &&
      typeof value.routeBlockedContextKey === 'string' &&
      value.routeBlockedContextKey.length <= 20_000
        ? value.routeBlockedContextKey
        : null,
    prerequisiteOrderIds,
    target,
    materials: {
      required: requirements.materialRequired,
      reserved,
      delivered,
      recoverable: requirements.materialRecoverable,
      carried,
      carriedByCrewId,
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
    const order = normalizePersistedOrder(
      source,
      Boolean(options.legacyV5),
      Boolean(options.legacyDeliveredInTransit),
    )
    if (!order || seenOrderIds.has(order.id)) return []
    seenOrderIds.add(order.id)
    return [order]
  })
  const ordersById = new Map(orders.map((order) => [order.id, order]))
  orders.forEach((order) => {
    order.prerequisiteOrderIds = (order.prerequisiteOrderIds ?? []).filter((id) => {
      const prerequisite = ordersById.get(id)
      return Boolean(
        prerequisite && compareProjectionOrder(prerequisite, order) < 0,
      )
    })
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

const constructionPrerequisitesComplete = (
  order: ConstructionOrder,
  ordersById: ReadonlyMap<string, ConstructionOrder>,
) => (order.prerequisiteOrderIds ?? []).every(
  (id) => ordersById.get(id)?.status === 'complete',
)

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
  const ordersById = new Map(orders.map((order) => [order.id, order]))
  let unpromisedStock = nonnegativeFinite(constructionStock)
  const fundedOrderIds = new Set<string>()
  const previouslyFundedOrderIds = new Set(
    orders
      .filter((order) => {
        const required = nonnegativeFinite(order.materials.required)
        const delivered = clampMaterial(order.materials.delivered, required)
        const carried = carriedConstructionMaterial(order)
        const remaining = Math.max(0, required - delivered - carried)
        return (
          order.status !== 'complete' &&
          constructionPrerequisitesComplete(order, ordersById) &&
          remaining > MATERIAL_EPSILON &&
          Math.abs(nonnegativeFinite(order.materials.reserved) - remaining) <=
            MATERIAL_EPSILON
        )
      })
      .map((order) => order.id),
  )

  orders.forEach((order) => {
    const required = nonnegativeFinite(order.materials.required)
    const initialDelivered = clampMaterial(order.materials.delivered, required)
    const candidateCarried = clampMaterial(
      carriedConstructionMaterial(order),
      required - initialDelivered,
    )
    const carriedByCrewId = candidateCarried > MATERIAL_EPSILON &&
      typeof order.materials.carriedByCrewId === 'string' &&
      order.materials.carriedByCrewId.trim()
        ? order.materials.carriedByCrewId
        : null
    const delivered = carriedByCrewId
      ? initialDelivered
      : clampMaterial(initialDelivered + candidateCarried, required)
    const carried = carriedByCrewId ? candidateCarried : 0
    const recoverable = nonnegativeFinite(order.materials.recoverable)
    order.materials = {
      required,
      reserved: clampMaterial(order.materials.reserved, required - delivered - carried),
      delivered,
      recoverable,
      carried,
      carriedByCrewId,
    }

    if (order.status === 'complete') {
      order.materials.reserved = 0
      order.block = null
      order.assignedCrewId = null
      order.forcedCrewId = null
      order.travelPhase = 'idle'
      order.routeBlockedContextKey = null
      order.materials.carried = 0
      order.materials.carriedByCrewId = null
      return
    }

    if (
      order.block?.kind === 'target_changed' ||
      order.block?.kind === 'no_path' ||
      order.block?.kind === 'carrier_unavailable'
    ) {
      order.materials.reserved = 0
      order.status = 'blocked'
      order.assignedCrewId = carriedByCrewId
      order.travelPhase = carriedByCrewId ? 'to_site' : 'idle'
      if (order.block.kind === 'target_changed') order.routeBlockedContextKey = null
      return
    }

    if (!constructionPrerequisitesComplete(order, ordersById)) {
      order.materials.reserved = 0
      order.status = 'blocked'
      order.block = prerequisiteWaitBlock(order.prerequisiteOrderIds ?? [])
      order.assignedCrewId = carriedByCrewId
      order.travelPhase = carriedByCrewId ? 'to_site' : 'idle'
      order.routeBlockedContextKey = null
      return
    }

    const remaining = Math.max(0, required - delivered - carried)
    if (remaining <= MATERIAL_EPSILON) {
      order.materials.reserved = 0
      order.status = carriedByCrewId ? 'hauling' : 'building'
      order.block = null
      order.routeBlockedContextKey = null
      order.assignedCrewId = carriedByCrewId ?? order.assignedCrewId
      if (carriedByCrewId && order.travelPhase !== 'at_site') order.travelPhase = 'to_site'
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
        order.block?.kind === 'target_changed' ||
        order.block?.kind === 'no_path' ||
        order.block?.kind === 'carrier_unavailable' ||
        !constructionPrerequisitesComplete(order, ordersById)
      ) return
      const remaining = Math.max(
        0,
        order.materials.required - constructionMaterialAccountedFor(order),
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
      order.routeBlockedContextKey = null
      unpromisedStock = Math.max(0, unpromisedStock - remaining)
      fundedOrderIds.add(order.id)
    })

  orders
    .filter((order) => {
      if (
        order.status === 'complete' ||
        order.block?.kind === 'target_changed' ||
        order.block?.kind === 'no_path' ||
        order.block?.kind === 'carrier_unavailable' ||
        !constructionPrerequisitesComplete(order, ordersById) ||
        fundedOrderIds.has(order.id)
      ) return false
      return order.materials.required - constructionMaterialAccountedFor(order) > MATERIAL_EPSILON
    })
    .sort(compareWorkOrder)
    .forEach((order) => {
      const remaining = order.materials.required - constructionMaterialAccountedFor(order)
      if (unpromisedStock + MATERIAL_EPSILON >= remaining) {
        order.materials.reserved = remaining
        order.status = 'hauling'
        order.block = null
        order.routeBlockedContextKey = null
        unpromisedStock = Math.max(0, unpromisedStock - remaining)
        fundedOrderIds.add(order.id)
      } else {
        order.materials.reserved = 0
        order.status = 'blocked'
        order.block = insufficientMaterialsBlock(remaining)
        const carrierId = order.materials.carriedByCrewId ?? null
        order.assignedCrewId = carrierId
        order.travelPhase = carrierId ? 'to_site' : 'idle'
        order.routeBlockedContextKey = null
      }
    })

  const blockedOrderIds = orders
    .filter((order) => order.status === 'blocked')
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
 * Reconstructs dependency edges for pre-v7 saves, whose projected orders were
 * valid as a ledger but did not record which earlier primitives had to become
 * real first. This keeps upgraded high-priority indoor jobs behind their shell.
 */
export const rebuildConstructionOrderPrerequisites = (
  completedLayout: ConstructionLayout,
  sourceOrders: readonly ConstructionOrder[],
  constructionStock: number,
): ConstructionMaterialReservationResult => {
  const orders = sourceOrders.map(cloneOrder)
  const ordered = [...orders].sort(compareProjectionOrder)

  ordered.forEach((order) => {
    if (order.status === 'complete') {
      order.prerequisiteOrderIds = []
      return
    }
    const earlierOrders = ordered.filter(
      (candidate) => compareProjectionOrder(candidate, order) < 0,
    )
    order.prerequisiteOrderIds = derivePrerequisiteOrderIds(
      completedLayout,
      earlierOrders,
      order,
    )
    if (order.prerequisiteOrderIds.length > 0) {
      order.status = 'blocked'
      order.block = prerequisiteWaitBlock(order.prerequisiteOrderIds)
      const carrierId = carriedConstructionMaterial(order) > MATERIAL_EPSILON
        ? order.materials.carriedByCrewId ?? null
        : null
      order.assignedCrewId = carrierId
      order.travelPhase = carrierId ? 'to_site' : 'idle'
      order.routeBlockedContextKey = null
      order.materials.reserved = 0
    } else if (order.block?.kind === 'prerequisite') {
      order.block = null
    }
  })

  return reserveConstructionMaterials(orders, constructionStock)
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
  const retryOrdersById = new Map(orders.map((order) => [order.id, order]))
  orders
    .filter(
      (order) =>
        order.status === 'blocked' &&
        order.block?.kind === 'target_changed' &&
        order.work.completed >= order.work.required &&
        constructionPrerequisitesComplete(order, retryOrdersById),
    )
    .sort(compareProjectionOrder)
    .forEach((order) => {
      const applied = applyOrderTarget(layout, order)
      if (!applied.ok) return
      layout = applied.layout
      order.status = 'complete'
      order.block = null
      order.assignedCrewId = null
      order.forcedCrewId = null
      order.travelPhase = 'idle'
      order.routeBlockedContextKey = null
      order.materials.reserved = 0
      order.materials.carried = 0
      order.materials.carriedByCrewId = null
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
  const ordersById = new Map(orders.map((order) => [order.id, order]))
  const activeOrders = orders
    .filter(
      (order) =>
        (order.status === 'hauling' || order.status === 'building') &&
        constructionPrerequisitesComplete(order, ordersById),
    )
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
        order.travelPhase = 'idle'
        order.routeBlockedContextKey = null
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
    if (order.work.completed + MATERIAL_EPSILON < order.work.required) return
    order.work.completed = order.work.required

    const applied = applyOrderTarget(layout, order)
    order.assignedCrewId = null
    if (applied.ok) {
      layout = applied.layout
      order.status = 'complete'
      order.block = null
      order.travelPhase = 'idle'
      order.routeBlockedContextKey = null
      order.materials.reserved = 0
      order.forcedCrewId = null
      if (applied.changed && order.materials.recoverable > 0) {
        constructionStock += order.materials.recoverable
        recoveredMaterials += order.materials.recoverable
      }
      completedOrderIds.push(order.id)
    } else {
      order.status = 'blocked'
      order.block = { kind: 'target_changed', message: applied.error }
      order.forcedCrewId = null
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

/** Material staged at blueprints or carried by colonists and recoverable on cancel. */
export const returnedConstructionMaterials = (
  orders: readonly ConstructionOrder[],
) => orders.reduce(
  (total, order) =>
    order.status === 'complete'
      ? total
      : total + nonnegativeFinite(order.materials.delivered) +
        carriedConstructionMaterial(order),
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
  const cancelledIds = new Set(
    sourceOrders
      .filter(
        (order) => requestedOrderIds.has(order.id) && order.status !== 'complete',
      )
      .map((order) => order.id),
  )

  const addExplicitDependants = () => {
    let added: boolean
    do {
      added = false
      sourceOrders.forEach((order) => {
        if (
          order.status !== 'complete' &&
          !cancelledIds.has(order.id) &&
          (order.prerequisiteOrderIds ?? []).some((id) => cancelledIds.has(id))
        ) {
          cancelledIds.add(order.id)
          added = true
        }
      })
    } while (added)
  }
  addExplicitDependants()

  let orders = sourceOrders
    .filter((order) => !cancelledIds.has(order.id))
    .map(cloneOrder)

  const layout = cloneLayout(completedLayout)
  let projection = projectConstructionOrders(layout, orders)
  while (true) {
    const dependentOrderIds = projection.issues
      .filter((issue) => !baselineIssueIds.has(issue.orderId))
      .map((issue) => issue.orderId)
    const previousSize = cancelledIds.size
    dependentOrderIds.forEach((id) => {
      const order = sourceOrders.find((candidate) => candidate.id === id)
      if (order && order.status !== 'complete') cancelledIds.add(id)
    })
    if (cancelledIds.size === previousSize) break
    addExplicitDependants()
    orders = sourceOrders
      .filter((order) => !cancelledIds.has(order.id))
      .map(cloneOrder)
    projection = projectConstructionOrders(layout, orders)
  }

  const cancelledOrders = sourceOrders.filter((order) => cancelledIds.has(order.id))
  const cancelledOrderIds = cancelledOrders.map((order) => order.id)

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
