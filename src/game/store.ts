import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  createInitialState,
  createRunId,
  isOpaqueRunId,
  MOONBASE_SEED,
  nextIncidentSeed,
} from './seed'
import {
  isConstructionLayout,
  type ConstructionResult,
  type GridPoint,
} from './construction'
import { createStarterConstruction, WORKSTATION_SPECS } from './constructionCatalog'
import {
  cancelConstructionCommand as cancelConstructionCommandInState,
  cancelConstructionOrder as cancelConstructionOrderInState,
  cancelConstructionOrders as cancelConstructionOrdersInState,
  carriedConstructionMaterial,
  deriveConstructionOrders,
  migrateV5ConstructionOrders,
  normalizePersistedConstructionOrders,
  projectConstructionOrders,
  rebuildConstructionOrderPrerequisites,
  reserveConstructionMaterials,
  type ConstructionOrder,
  type ConstructionOrderTarget,
} from './constructionJobs'
import {
  findConstructionOrderApproachPath,
  findConstructionPath,
  isConstructionCellWalkable,
} from './constructionPathfinding'
import {
  normalizeConstructionStockpile,
  normalizePersistedConstructionCrewPositions,
} from './constructionWorkerRouting'
import { advanceConstructionWorkerSimulationFixedStep } from './constructionWorkerSimulation'
import {
  constructionSemanticEvaCellKeys,
  constructionSemanticEvaCells,
} from './constructionHazards'
import {
  analyzeConstructionPressure,
  constructionEnvironmentAt,
} from './pressureTopology'
import {
  beginOperations as beginOperationsInState,
  deployPresetMoonbase as deployPresetMoonbaseInState,
} from './settlement'
import {
  advanceSimulation,
  clearOperationsPlan,
  commitOperationsPlan,
  deriveAlerts as deriveAlertsInState,
  rebaseOperationsPlan,
  recordLearningEvidence as recordLearningEvidenceInState,
  removePlanAction as removePlanActionFromState,
  removePlanActionsBatch as removePlanActionsBatchFromState,
  setPlanBrief as setPlanBriefInState,
  stageOperationsPlanBatch,
  type RemovePlanActionsBatchInput,
  type RemovePlanActionsBatchResult,
  stagePlanAction as stagePlanActionInState,
  type StagePlanBatchInput,
  type StagePlanBatchResult,
  validateOperationsPlan,
  verifyOperationsPlan,
} from './simulation'
import type {
  AdvanceInput,
  AdvanceResult,
  BuildResult,
  CommitResult,
  ConstructionSpeed,
  LearningPhase,
  LearningEvidenceOptions,
  MoonbaseState,
  PlanActionInput,
  PlanBriefInput,
  PlanEditResult,
  PlanValidation,
  Priority,
  VerificationResult,
} from './types'

type InteractiveActor = 'manual' | 'agent'

const PHASE_SAFE_PERSISTENCE_VERSION = 10
const RUN_ID_PERSISTENCE_VERSION = 12
const PERSISTENCE_VERSION = 14
const EVA_SAFE_PERSISTENCE_VERSION = 13

const isCrewCollection = (value: unknown): value is MoonbaseState['crew'] => (
  Array.isArray(value) && value.every((member) => {
    if (!member || typeof member !== 'object') return false
    const record = member as Record<string, unknown>
    const skills = record.skills
    return typeof record.id === 'string' &&
      typeof record.name === 'string' &&
      typeof record.role === 'string' &&
      typeof record.trait === 'string' &&
      typeof record.status === 'string' &&
      typeof record.location === 'string' &&
      typeof record.health === 'number' &&
      typeof record.fatigue === 'number' &&
      typeof record.morale === 'number' &&
      Boolean(skills && typeof skills === 'object') &&
      ['engineering', 'science', 'medicine', 'operations'].every(
        (key) => typeof (skills as Record<string, unknown>)[key] === 'number',
      )
  })
)

const isModuleCollection = (value: unknown): value is MoonbaseState['modules'] => (
  Array.isArray(value) && value.every((module) => {
    if (!module || typeof module !== 'object') return false
    const record = module as Record<string, unknown>
    const position = record.position
    return typeof record.id === 'string' &&
      typeof record.name === 'string' &&
      typeof record.type === 'string' &&
      typeof record.location === 'string' &&
      (record.atmosphere === 'yes' || record.atmosphere === 'low' || record.atmosphere === 'no') &&
      typeof record.condition === 'number' &&
      typeof record.powerPriority === 'number' &&
      typeof record.breached === 'boolean' &&
      Boolean(position && typeof position === 'object') &&
      ['x', 'y', 'width', 'height'].every(
        (key) => typeof (position as Record<string, unknown>)[key] === 'number',
      )
  })
)

const reconciledCrewCollection = (
  value: unknown,
  fallback: MoonbaseState['crew'],
): MoonbaseState['crew'] => {
  if (!isCrewCollection(value)) return fallback
  const byId = new Map(value.map((member) => [member.id, member]))
  const fallbackIds = new Set(fallback.map((member) => member.id))
  return [
    ...fallback.map((member) => byId.get(member.id) ?? member),
    ...value.filter((member) => !fallbackIds.has(member.id)),
  ]
}

const reconciledModuleCollection = (
  value: unknown,
  fallback: MoonbaseState['modules'],
): MoonbaseState['modules'] => {
  if (!isModuleCollection(value)) return fallback
  const byId = new Map(value.map((module) => [module.id, module]))
  const fallbackIds = new Set(fallback.map((module) => module.id))
  return [
    ...fallback.map((module) => byId.get(module.id) ?? module),
    ...value.filter((module) => !fallbackIds.has(module.id)),
  ]
}

export interface QueueConstructionResult {
  ok: boolean
  commandId?: string
  orderIds: string[]
  blockedOrderIds?: string[]
  materialRequired?: number
  error?: string
}

export interface ConstructionAdvanceSummary {
  completedOrderIds: string[]
  blockedOrderIds: string[]
}

export interface ConstructionBuilderAssignmentResult {
  ok: boolean
  orderId: string
  crewId: string | null
  error?: string
}

export interface MoonbaseActions {
  resetColony: () => void
  resetMoonbase: () => void
  startNextIncident: () => boolean
  setConstructionSpeed: (speed: ConstructionSpeed) => boolean
  queueConstruction: (result: ConstructionResult) => QueueConstructionResult
  cancelConstructionCommand: (commandId: string) => string[]
  cancelConstructionOrder: (orderId: string) => boolean
  setConstructionOrderPriority: (orderId: string, priority: Priority) => boolean
  setConstructionCommandPriority: (commandId: string, priority: Priority) => number
  setConstructionOrderBuilder: (
    orderId: string,
    crewId: string | null,
  ) => ConstructionBuilderAssignmentResult
  advanceConstruction: (elapsed?: number) => ConstructionAdvanceSummary
  deployPresetMoonbase: (actor?: InteractiveActor) => BuildResult
  beginOperations: (actor?: InteractiveActor) => BuildResult
  setPlanBrief: (input: PlanBriefInput, actor?: InteractiveActor) => PlanEditResult
  stagePlanAction: (input: PlanActionInput, actor?: InteractiveActor) => PlanEditResult
  stagePlanBatch: (input: StagePlanBatchInput, actor?: InteractiveActor) => StagePlanBatchResult
  removePlanAction: (actionId: string, actor?: InteractiveActor) => PlanEditResult
  removePlanActionsBatch: (
    input: RemovePlanActionsBatchInput,
    actor?: InteractiveActor,
  ) => RemovePlanActionsBatchResult
  rebasePlan: (actor?: InteractiveActor) => PlanEditResult
  clearPlan: (actor?: InteractiveActor) => PlanEditResult
  validatePlan: () => PlanValidation
  commitPlan: (
    expectedWorldRevision: number,
    expectedPlanRevision: number,
    actor?: InteractiveActor,
  ) => CommitResult
  advanceTime: (input: AdvanceInput, actor?: InteractiveActor) => AdvanceResult
  advanceHours: (hours: number, actor?: InteractiveActor) => AdvanceResult
  verifyPlan: (actor?: InteractiveActor) => VerificationResult
  recordLearningEvidence: (
    phase: LearningPhase,
    detail: string,
    actor?: InteractiveActor,
    options?: LearningEvidenceOptions,
  ) => void
}

export type MoonbaseStore = MoonbaseState & MoonbaseActions
export type ColonyStore = MoonbaseStore

const MAX_ACTIVE_BUILDERS = 2

const sameBoundaryTarget = (
  left: ConstructionOrderTarget,
  right: ConstructionOrderTarget,
) =>
  left.kind === 'boundary' &&
  right.kind === 'boundary' &&
  Boolean(left.construct) &&
  Boolean(right.deconstruct) &&
  left.construct!.x === right.deconstruct!.x &&
  left.construct!.y === right.deconstruct!.y &&
  left.construct!.kind === right.deconstruct!.kind

const sameWorkstationTarget = (
  left: ConstructionOrderTarget,
  right: ConstructionOrderTarget,
) =>
  left.kind === 'workstation' &&
  right.kind === 'workstation' &&
  Boolean(left.construct) &&
  Boolean(right.deconstruct) &&
  left.construct!.id === right.deconstruct!.id

const removesOnlyPendingTarget = (
  existing: ConstructionOrder,
  candidate: ConstructionOrder,
) =>
  existing.status !== 'complete' &&
  candidate.operation === 'deconstruct' &&
  (sameBoundaryTarget(existing.target, candidate.target) ||
    sameWorkstationTarget(existing.target, candidate.target))

const reallocateUncollectedConstructionReservations = (
  sourceOrders: readonly ConstructionOrder[],
  constructionStock: number,
) => reserveConstructionMaterials(sourceOrders.map((order) => {
  const uncollectedReservation = (
    order.status !== 'complete' &&
    order.materials.reserved > 0 &&
    order.materials.delivered <= Number.EPSILON &&
    (order.materials.carried ?? 0) <= Number.EPSILON
  )
  if (!uncollectedReservation) return order
  return {
    ...order,
    assignedCrewId: null,
    travelPhase: 'idle' as const,
    routeBlockedContextKey: null,
    materials: { ...order.materials, reserved: 0 },
  }
}), constructionStock).orders

const visibleConstructionCrew = (state: MoonbaseState) => (
  state.settlement.phase === 'landing' ? state.crew.slice(0, 2) : state.crew
)

export const constructionCrewUnavailableReason = (
  state: MoonbaseState,
  crewId: string,
) => {
  const member = visibleConstructionCrew(state).find((candidate) => candidate.id === crewId)
  if (!member) return 'That colonist is not deployed for this shift.'
  if (member.health <= 0) return `${member.name} is incapacitated.`
  if (member.status === 'resting') return `${member.name} is resting.`
  if (member.taskId) return `${member.name} is already assigned to incident work.`
  const activeWork = state.workOrders.find((order) => (
    order.status !== 'complete' && order.assignedCrewIds.includes(member.id)
  ))
  if (activeWork) return `${member.name} is assigned to ${activeWork.label}.`
  return null
}

const eligibleConstructionWorkers = (state: MoonbaseState) =>
  visibleConstructionCrew(state)
    .filter((member) => !constructionCrewUnavailableReason(state, member.id))
    .sort((left, right) =>
      right.skills.engineering - left.skills.engineering || left.id.localeCompare(right.id),
    )
    .slice(0, MAX_ACTIVE_BUILDERS)
    .map((member) => ({
      id: member.id,
      engineeringRate: 0.32 + member.skills.engineering * 0.035,
      haulingRate: 0.75,
    }))

const spatialConstructionWorkers = (state: MoonbaseState) => {
  const availableCrewIds = new Set(
    visibleConstructionCrew(state)
      .filter((member) => !constructionCrewUnavailableReason(state, member.id))
      .map((member) => member.id),
  )
  const eligibleById = new Map(
    eligibleConstructionWorkers(state).map((worker, index) => [
      worker.id,
      { ...worker, dispatchPriority: MAX_ACTIVE_BUILDERS - index },
    ]),
  )
  const forcedCrewIds = new Set(
    state.settlement.constructionOrders.flatMap((order) => (
      order.status !== 'complete' && order.forcedCrewId ? [order.forcedCrewId] : []
    )),
  )
  return state.crew.map((member) => {
    const eligible = eligibleById.get(member.id)
    const manuallyEligible = forcedCrewIds.has(member.id) &&
      !constructionCrewUnavailableReason(state, member.id)
    return {
      id: member.id,
      hasEvaSuit: Boolean(member.equippedEvaSuitId),
      canConstruct: Boolean(eligible || manuallyEligible),
      canHaul: availableCrewIds.has(member.id),
      dispatchPriority: eligible?.dispatchPriority ?? 0,
      engineeringRate: eligible?.engineeringRate ??
        0.32 + member.skills.engineering * 0.035,
      haulingRate: eligible?.haulingRate ?? 0.75,
      carryCapacity: 1 + Math.floor(member.skills.operations / 5),
      movementRate: 1.8 + member.skills.operations * 0.04,
    }
  })
}

const constructionSuitForCrew = (state: MoonbaseState, crewId: string) => {
  const member = state.crew.find((candidate) => candidate.id === crewId)
  if (!member?.equippedEvaSuitId) return null
  const suit = state.equipment.find((candidate) => (
    candidate.id === member.equippedEvaSuitId &&
    candidate.type === 'eva_suit' &&
    candidate.assignedCrewId === crewId
  ))
  return suit?.reservedForWorkOrderId ? null : suit ?? null
}

const equipConstructionWorkers = (
  state: MoonbaseState,
  workers: ReturnType<typeof spatialConstructionWorkers>,
) => {
  if (!state.settlement.constructionOrders.some((order) => order.status !== 'complete')) return
  const forcedCrewIds = new Set(state.settlement.constructionOrders.flatMap((order) => (
    order.status !== 'complete' && order.forcedCrewId ? [order.forcedCrewId] : []
  )))
  const assignedCrewIds = new Set(state.settlement.constructionOrders.flatMap((order) => (
    order.status !== 'complete' && order.assignedCrewId ? [order.assignedCrewId] : []
  )))
  const projectedLayout = projectConstructionOrders(
    state.settlement.layout,
    state.settlement.constructionOrders,
  ).layout
  const projectedPressure = analyzeConstructionPressure(projectedLayout)
  const semanticEvaCells = constructionSemanticEvaCells(
    state.modules,
    projectedLayout,
    state.lab.atmosphere,
  )
  const semanticEvaCellKeys = new Set(semanticEvaCells.map(constructionPointKey))
  const positionByCrewId = new Map(
    state.settlement.constructionCrew.map((position) => [position.crewId, position]),
  )
  const projectedExposedCrewIds = new Set(workers.flatMap((worker) => {
    const position = positionByCrewId.get(worker.id)
    return position && (
      constructionEnvironmentAt(projectedLayout, projectedPressure, position.cell) !== 'pressurized' ||
      semanticEvaCellKeys.has(constructionPointKey(position.cell))
    )
      ? [worker.id]
      : []
  }))
  const candidates = [...workers]
    .filter((worker) => worker.canConstruct || worker.canHaul)
    .sort((left, right) =>
      Number(projectedExposedCrewIds.has(right.id)) - Number(projectedExposedCrewIds.has(left.id)) ||
      Number(forcedCrewIds.has(right.id)) - Number(forcedCrewIds.has(left.id)) ||
      Number(assignedCrewIds.has(right.id)) - Number(assignedCrewIds.has(left.id)) ||
      (right.dispatchPriority ?? 0) - (left.dispatchPriority ?? 0) ||
      left.id.localeCompare(right.id),
    )
  const claimedSuitIds = new Set(
    state.crew.flatMap((member) => member.equippedEvaSuitId ? [member.equippedEvaSuitId] : []),
  )
  const availableSuits = state.equipment
    .filter((item) => (
      item.type === 'eva_suit' &&
      item.condition >= 65 &&
      !item.reservedForWorkOrderId &&
      (!item.assignedCrewId || constructionSuitForCrew(state, item.assignedCrewId)?.id === item.id)
    ))
    .sort((left, right) => left.id.localeCompare(right.id))

  for (const worker of candidates) {
    if (constructionSuitForCrew(state, worker.id)) continue
    const member = state.crew.find((candidate) => candidate.id === worker.id)
    const suit = availableSuits.find((candidate) => !claimedSuitIds.has(candidate.id))
    if (!member || !suit) continue
    claimedSuitIds.add(suit.id)
    member.equippedEvaSuitId = suit.id
    suit.status = 'deployed'
    suit.location = 'airlock'
    suit.assignedCrewId = member.id
    suit.reservedForWorkOrderId = null
  }
}

const returnAndDoffConstructionCrew = (state: MoonbaseState) => {
  if (state.settlement.constructionOrders.some((order) => order.status !== 'complete')) return
  const layout = state.settlement.layout
  const pressure = analyzeConstructionPressure(layout)
  const semanticEvaCells = constructionSemanticEvaCells(
    state.modules,
    layout,
    state.lab.atmosphere,
  )
  const semanticEvaCellKeys = new Set(semanticEvaCells.map(constructionPointKey))
  const occupied = new Set(state.settlement.constructionCrew.map((position) => (
    `${position.cell.x}:${position.cell.y}`
  )))
  const pressurizedGoals = pressure.rooms
    .flatMap((room) => room.cells)
    .filter((cell) => (
      isConstructionCellWalkable(layout, cell) &&
      !semanticEvaCellKeys.has(constructionPointKey(cell))
    ))
    .sort((left, right) => left.y - right.y || left.x - right.x)

  for (const position of state.settlement.constructionCrew) {
    const member = state.crew.find((candidate) => candidate.id === position.crewId)
    const suit = constructionSuitForCrew(state, position.crewId)
    if (!member || !suit) continue
    if (
      constructionEnvironmentAt(layout, pressure, position.cell) !== 'pressurized' ||
      semanticEvaCellKeys.has(constructionPointKey(position.cell))
    ) {
      const goals = pressurizedGoals.filter((cell) => (
        !occupied.has(`${cell.x}:${cell.y}`) ||
        (cell.x === position.cell.x && cell.y === position.cell.y)
      ))
      const route = findConstructionPath(layout, position.cell, goals, {
        hasEvaSuit: true,
        pressureTopology: pressure,
        evaRequiredCells: semanticEvaCells,
      })
      const destination = route?.path.at(-1)
      if (!destination) continue
      occupied.delete(`${position.cell.x}:${position.cell.y}`)
      position.cell = { ...destination }
      position.moveCredit = 0
      occupied.add(`${destination.x}:${destination.y}`)
    }
    if (
      constructionEnvironmentAt(layout, pressure, position.cell) !== 'pressurized' ||
      semanticEvaCellKeys.has(constructionPointKey(position.cell))
    ) continue
    member.equippedEvaSuitId = null
    suit.status = 'available'
    suit.location = 'airlock'
    suit.assignedCrewId = null
  }
}

const advanceConstructionInState = (
  state: MoonbaseState,
  elapsed: number,
): ConstructionAdvanceSummary => {
  if (!state.settlement.constructionOrders.some((order) => order.status !== 'complete')) {
    returnAndDoffConstructionCrew(state)
    return { completedOrderIds: [], blockedOrderIds: [] }
  }
  let workers = spatialConstructionWorkers(state)
  equipConstructionWorkers(state, workers)
  workers = spatialConstructionWorkers(state)
  const evaRequiredCells = constructionSemanticEvaCells(
    state.modules,
    state.settlement.layout,
    state.lab.atmosphere,
  )
  const advanced = advanceConstructionWorkerSimulationFixedStep({
    layout: state.settlement.layout,
    orders: state.settlement.constructionOrders,
    constructionStock: state.reserves.constructionStock,
    stockpile: state.settlement.constructionStockpile,
    crewPositions: state.settlement.constructionCrew,
    workers,
    evaRequiredCells,
    elapsed,
  })
  state.settlement = {
    ...state.settlement,
    layout: advanced.layout,
    constructionOrders: advanced.orders,
    constructionCrew: advanced.crewPositions,
    constructionStockpile: advanced.stockpile,
  }
  state.reserves = {
    ...state.reserves,
    constructionStock: advanced.constructionStock,
  }
  returnAndDoffConstructionCrew(state)
  return {
    completedOrderIds: advanced.completedOrderIds,
    blockedOrderIds: advanced.blockedOrderIds,
  }
}

const domainSnapshot = (state: MoonbaseStore): MoonbaseState => ({
  baseName: state.baseName,
  seed: state.seed,
  runSequence: state.runSequence,
  runId: state.runId,
  missionDay: state.missionDay,
  hour: state.hour,
  elapsedHours: state.elapsedHours,
  worldRevision: state.worldRevision,
  scenarioStatus: state.scenarioStatus,
  map: state.map,
  settlement: state.settlement,
  objective: state.objective,
  reserves: state.reserves,
  power: state.power,
  lab: state.lab,
  dust: state.dust,
  modules: state.modules,
  crew: state.crew,
  equipment: state.equipment,
  workOrders: state.workOrders,
  research: state.research,
  alerts: state.alerts,
  events: state.events,
  learning: state.learning,
  operationsPlan: state.operationsPlan,
  lastAdvance: state.lastAdvance,
  verification: state.verification,
})

const normalizedConstructionStock = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, value)
    : fallback

const reconciledEquipment = (
  source: unknown,
  templates: MoonbaseState['equipment'],
): MoonbaseState['equipment'] => {
  const persistedById = new Map(
    (Array.isArray(source) ? source : [])
      .filter((value): value is MoonbaseState['equipment'][number] => Boolean(
        value && typeof value === 'object' && typeof value.id === 'string',
      ))
      .map((item) => [item.id, item]),
  )
  return templates.map((template) => ({
    ...template,
    ...(persistedById.get(template.id) ?? {}),
    id: template.id,
    name: template.name,
    type: template.type,
  }))
}

const reconciledWorkOrders = (
  source: unknown,
  templates: MoonbaseState['workOrders'],
): MoonbaseState['workOrders'] => {
  const persistedById = new Map(
    (Array.isArray(source) ? source : [])
      .filter((value): value is MoonbaseState['workOrders'][number] => Boolean(
        value && typeof value === 'object' && typeof value.id === 'string',
      ))
      .map((order) => [order.id, order]),
  )
  return templates.map((template) => ({
    ...template,
    ...(persistedById.get(template.id) ?? {}),
    detail: template.detail,
    hazard: template.hazard,
    requiredEquipment: [...template.requiredEquipment],
  }))
}

const normalizedRunSequence = (value: unknown, fallback = 1) => (
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? value
    : fallback
)

const normalizedConstructionSpeed = (
  value: unknown,
  fallback: ConstructionSpeed,
): ConstructionSpeed => value === 0 || value === 1 || value === 2 || value === 3
  ? value
  : fallback

const persistedGridPoint = (value: unknown): GridPoint | null => {
  if (!value || typeof value !== 'object') return null
  const point = value as Record<string, unknown>
  return typeof point.x === 'number' &&
    typeof point.y === 'number' &&
    Number.isInteger(point.x) &&
    Number.isInteger(point.y)
    ? { x: point.x, y: point.y }
    : null
}

const resetLegacyTravelAssignments = (
  orders: readonly ConstructionOrder[],
  validCrewIds?: ReadonlySet<string>,
) => {
  const forcedCrewIds = new Set<string>()
  return orders.map((order) => {
    const carrierId = (order.materials.carried ?? 0) > Number.EPSILON
      ? order.materials.carriedByCrewId ?? null
      : null
    const requestedForcedCrewId = order.forcedCrewId &&
      validCrewIds?.has(order.forcedCrewId) &&
      !forcedCrewIds.has(order.forcedCrewId) &&
      (!carrierId || carrierId === order.forcedCrewId)
        ? order.forcedCrewId
        : null
    if (requestedForcedCrewId) forcedCrewIds.add(requestedForcedCrewId)
    if (carrierId) {
      return {
        ...order,
        assignedCrewId: carrierId,
        forcedCrewId: requestedForcedCrewId,
        travelPhase: order.travelPhase === 'at_site' ? 'at_site' as const : 'to_site' as const,
      }
    }
    const assignmentValid = order.assignedCrewId &&
      validCrewIds?.has(order.assignedCrewId) &&
      (!requestedForcedCrewId || order.assignedCrewId === requestedForcedCrewId)
    if (assignmentValid) return { ...order, forcedCrewId: requestedForcedCrewId }
    return {
      ...order,
      assignedCrewId: null,
      forcedCrewId: requestedForcedCrewId,
      travelPhase: 'idle' as const,
    }
  })
}

const constructionPointKey = ({ x, y }: GridPoint) => `${x}:${y}`

const crewHasPhysicalEvaSuit = (state: MoonbaseState, crewId: string) => {
  const member = state.crew.find((candidate) => candidate.id === crewId)
  if (!member?.equippedEvaSuitId) return false
  return state.equipment.some((item) => (
    item.id === member.equippedEvaSuitId &&
    item.type === 'eva_suit' &&
    item.condition >= 65 &&
    item.assignedCrewId === crewId &&
    item.status === 'deployed'
  ))
}

const crewLocationRequiresEva = (state: MoonbaseState, crewId: string) => {
  const member = state.crew.find((candidate) => candidate.id === crewId)
  if (!member) return true
  if (member.location === 'laboratory') return state.lab.atmosphere !== 'yes'
  return state.modules.find((module) => module.location === member.location)?.atmosphere !== 'yes'
}

const reconcileLaboratoryModuleState = (
  modules: MoonbaseState['modules'],
  lab: MoonbaseState['lab'],
) => modules.map((module) => module.location === 'laboratory'
  ? { ...module, atmosphere: lab.atmosphere, breached: lab.breached }
  : module)

const relocateUnprotectedConstructionCrew = <State extends MoonbaseState>(
  state: State,
  initialState: MoonbaseState,
): State => {
  const layout = state.settlement.layout
  const pressure = analyzeConstructionPressure(layout)
  const semanticEvaCellKeys = constructionSemanticEvaCellKeys(
    state.modules,
    layout,
    state.lab.atmosphere,
  )
  const safeCells = pressure.rooms
    .flatMap((room) => room.cells)
    .filter((cell) => (
      isConstructionCellWalkable(layout, cell) &&
      !semanticEvaCellKeys.has(constructionPointKey(cell))
    ))
    .sort((left, right) => left.y - right.y || left.x - right.x)
  if (safeCells.length === 0) return state

  const safeCellKeys = new Set(safeCells.map(constructionPointKey))
  const safeLocations = state.modules
    .filter((module) => (
      module.location === 'laboratory'
        ? state.lab.atmosphere === 'yes'
        : module.atmosphere === 'yes'
    ))
    .map((module) => module.location)
  const starterCellByCrewId = new Map(
    initialState.settlement.constructionCrew.map((position) => [position.crewId, position.cell]),
  )
  const constructionCrew = state.settlement.constructionCrew.map((position, index) => {
    if (
      (
        constructionEnvironmentAt(layout, pressure, position.cell) === 'pressurized' &&
        !semanticEvaCellKeys.has(constructionPointKey(position.cell))
      ) ||
      crewHasPhysicalEvaSuit(state, position.crewId)
    ) {
      return position
    }
    const starterCell = starterCellByCrewId.get(position.crewId)
    const cell = starterCell && safeCellKeys.has(constructionPointKey(starterCell))
      ? starterCell
      : safeCells[index % safeCells.length]
    return {
      ...position,
      cell: { ...cell },
      moveCredit: 0,
    }
  })
  const crew = state.crew.map((member, index) => {
    if (
      !crewLocationRequiresEva(state, member.id) ||
      crewHasPhysicalEvaSuit(state, member.id) ||
      safeLocations.length === 0
    ) {
      return member
    }
    return {
      ...member,
      location: safeLocations[index % safeLocations.length],
      equippedEvaSuitId: null,
    }
  })

  const relocatedState = {
    ...state,
    crew,
    settlement: {
      ...state.settlement,
      constructionCrew,
    },
  } as State
  return {
    ...relocatedState,
    alerts: deriveAlertsInState(relocatedState),
  } as State
}

const reopenLegacyEvaPlan = (source: MoonbaseState): MoonbaseState => {
  const state = structuredClone(source)
  const incompleteOrderIds = new Set(
    state.workOrders
      .filter((order) => order.status !== 'complete')
      .map((order) => order.id),
  )
  const completedOrderIds = new Set(
    state.workOrders
      .filter((order) => order.status === 'complete')
      .map((order) => order.id),
  )

  state.crew.forEach((member) => {
    if (member.taskId && incompleteOrderIds.has(member.taskId)) {
      member.taskId = null
      member.status = member.fatigue >= 75 ? 'resting' : 'idle'
    }
    if (crewLocationRequiresEva(state, member.id)) member.location = 'airlock'
    member.equippedEvaSuitId = null
  })

  state.equipment.forEach((item) => {
    if (!item.reservedForWorkOrderId || !incompleteOrderIds.has(item.reservedForWorkOrderId)) return
    const order = state.workOrders.find((candidate) => candidate.id === item.reservedForWorkOrderId)
    if (order?.hazard !== 'indoor') item.location = 'airlock'
    item.status = 'available'
    item.reservedForWorkOrderId = null
    item.assignedCrewId = null
  })

  state.workOrders.forEach((order) => {
    if (order.status === 'complete') return
    order.assignedCrewIds = []
    order.reservedEquipmentIds = []
    order.logisticsHoursRemaining = 0
    order.status = order.prerequisiteIds.every((id) => completedOrderIds.has(id))
      ? 'ready'
      : 'blocked'
  })

  state.operationsPlan = {
    ...state.operationsPlan,
    status: 'draft',
    revision: Math.max(1, state.operationsPlan.revision + 1),
    basedOnWorldRevision: state.worldRevision,
    actions: [],
    committedAtHour: null,
    baseline: null,
  }
  state.research.assignedResearcherId = null
  if (state.research.status !== 'complete') {
    state.research.status = state.lab.atmosphere === 'yes' ? 'available' : 'blocked'
  }
  state.lastAdvance = null
  state.verification = null
  return state
}

const hardenLegacyEvaState = (
  source: MoonbaseState,
): MoonbaseState => {
  const state = structuredClone(source)
  state.crew.forEach((member) => {
    member.equippedEvaSuitId = null
  })
  if (state.settlement.phase !== 'operations') return state

  const crewById = new Map(state.crew.map((member) => [member.id, member]))
  const equipmentById = new Map(state.equipment.map((item) => [item.id, item]))
  const evaSuits = state.equipment
    .filter((item) => item.type === 'eva_suit' && item.condition >= 65)
    .sort((left, right) => left.id.localeCompare(right.id))
  const claimedSuitIds = new Set<string>()
  let missingSuit = false
  let planChanged = false

  state.workOrders.forEach((order) => {
    if (order.status === 'complete' || !order.requiredEquipment.includes('eva_suit')) return
    order.assignedCrewIds = [...new Set(order.assignedCrewIds)].filter((id) => crewById.has(id))
    order.reservedEquipmentIds = [...new Set(order.reservedEquipmentIds)].filter(
      (id) => equipmentById.has(id),
    )

    order.assignedCrewIds.forEach((crewId) => {
      const member = crewById.get(crewId)!
      const reservedForCrew = evaSuits.find((suit) => (
        !claimedSuitIds.has(suit.id) &&
        suit.reservedForWorkOrderId === order.id &&
        suit.assignedCrewId === crewId
      ))
      const reservedForOrder = evaSuits.find((suit) => (
        !claimedSuitIds.has(suit.id) &&
        suit.reservedForWorkOrderId === order.id &&
        !suit.assignedCrewId
      ))
      const available = evaSuits
        .filter((suit) => (
          !claimedSuitIds.has(suit.id) &&
          !suit.reservedForWorkOrderId &&
          !suit.assignedCrewId &&
          suit.status === 'available'
        ))
        .sort((left, right) => (
          Number(left.location !== member.location) - Number(right.location !== member.location) ||
          left.id.localeCompare(right.id)
        ))[0]
      const suit = reservedForCrew ?? reservedForOrder ?? available
      if (!suit) {
        missingSuit = true
        return
      }

      claimedSuitIds.add(suit.id)
      const newlyReserved = suit.reservedForWorkOrderId !== order.id
      suit.reservedForWorkOrderId = order.id
      suit.assignedCrewId = crewId
      if (!order.reservedEquipmentIds.includes(suit.id)) {
        order.reservedEquipmentIds.push(suit.id)
      }

      const exposed = crewLocationRequiresEva(state, crewId)
      if (exposed && suit.location === member.location) {
        suit.status = 'deployed'
        member.equippedEvaSuitId = suit.id
      } else if (exposed) {
        member.location = 'airlock'
        member.equippedEvaSuitId = null
        suit.status = 'reserved'
        order.logisticsHoursRemaining = Math.max(1, order.logisticsHoursRemaining)
        if (order.status === 'active') order.status = 'queued'
      } else {
        member.equippedEvaSuitId = null
        if (newlyReserved) suit.status = 'reserved'
      }

      if (newlyReserved && !state.operationsPlan.actions.some((action) => (
        action.kind === 'reserve_equipment' &&
        action.equipmentId === suit.id &&
        action.workOrderId === order.id
      ))) {
        state.operationsPlan.actions.push({
          id: `plan-action-migrated-${suit.id}`,
          kind: 'reserve_equipment',
          equipmentId: suit.id,
          workOrderId: order.id,
        })
        planChanged = true
      }
    })
  })

  if (missingSuit) return reopenLegacyEvaPlan(state)

  state.crew.forEach((member) => {
    if (!crewLocationRequiresEva(state, member.id)) return
    const suit = member.equippedEvaSuitId
      ? equipmentById.get(member.equippedEvaSuitId)
      : null
    if (
      suit?.type === 'eva_suit' &&
      suit.assignedCrewId === member.id &&
      suit.location === member.location
    ) return
    member.location = 'airlock'
    member.equippedEvaSuitId = null
    if (!member.taskId) return
    const order = state.workOrders.find((candidate) => candidate.id === member.taskId)
    if (!order || order.status === 'complete') return
    order.logisticsHoursRemaining = Math.max(1, order.logisticsHoursRemaining)
    if (order.status === 'active') order.status = 'queued'
  })

  if (planChanged) state.operationsPlan.revision += 1
  return state
}

const repairedConstructionSequence = (
  orders: readonly ConstructionOrder[],
  persistedSequence: unknown,
) => {
  const highestSequence = orders.reduce(
    (highest, order) => Math.max(highest, order.sequence),
    0,
  )
  const requestedSequence =
    typeof persistedSequence === 'number' &&
    Number.isSafeInteger(persistedSequence) &&
    persistedSequence > 0
      ? persistedSequence
      : 1
  return Math.max(highestSequence + 1, requestedSequence)
}

const isPersistedModulePosition = (value: unknown): value is MoonbaseState['modules'][number]['position'] => {
  if (!value || typeof value !== 'object') return false
  const position = value as Record<string, unknown>
  return ['x', 'y', 'width', 'height'].every((key) => (
    typeof position[key] === 'number' && Number.isFinite(position[key])
  )) && Number(position.width) > 0 && Number(position.height) > 0
}

/**
 * Versions before v10 allowed incident commands to run during establishment.
 * Keep the player's physical construction work, but rebuild the hidden incident
 * from the deterministic seed so a landing save cannot carry an already staged,
 * committed, or advanced operation across the new phase boundary.
 */
const resetLegacyEstablishmentIncident = (
  state: MoonbaseState,
  initialState: MoonbaseState,
): MoonbaseState => {
  const worldRevision = Number.isSafeInteger(state.worldRevision) && state.worldRevision > 0
    ? state.worldRevision
    : initialState.worldRevision
  const persistedModules = new Map(
    (Array.isArray(state.modules) ? state.modules : []).map((module) => [module.id, module]),
  )
  const modules = initialState.modules.map((module) => {
    const persistedPosition = persistedModules.get(module.id)?.position
    return isPersistedModulePosition(persistedPosition)
      ? { ...module, position: { ...persistedPosition } }
      : module
  })
  const settlementEvents = (Array.isArray(state.events) ? state.events : [])
    .filter((event) => event.id.startsWith('event-settlement-'))

  return {
    ...initialState,
    worldRevision,
    settlement: state.settlement,
    reserves: {
      ...initialState.reserves,
      constructionStock: state.reserves.constructionStock,
    },
    modules,
    events: [...settlementEvents, ...initialState.events].slice(0, 40),
    operationsPlan: {
      ...initialState.operationsPlan,
      basedOnWorldRevision: worldRevision,
    },
  }
}

export const useColonyStore = create<MoonbaseStore>()(
  persist(
    (set, get) => ({
      ...createInitialState(),
      resetColony: () => set((state) => createInitialState(
        MOONBASE_SEED,
        normalizedRunSequence(state.runSequence) + 1,
      )),
      resetMoonbase: () => set((state) => createInitialState(
        MOONBASE_SEED,
        normalizedRunSequence(state.runSequence) + 1,
      )),
      startNextIncident: () => {
        const state = get()
        if (state.settlement.phase !== 'operations' || state.learning.completedLoops <= 0) {
          return false
        }

        const seed = nextIncidentSeed(state.seed)
        const runSequence = normalizedRunSequence(state.runSequence) + 1
        const fresh = createInitialState(seed, runSequence)
        const worldRevision = Math.max(fresh.worldRevision, state.worldRevision + 1)
        const currentPositions = new Map(
          state.modules.map((module) => [module.id, module.position]),
        )
        const modules = fresh.modules.map((module) => {
          const position = currentPositions.get(module.id)
          return position ? { ...module, position: { ...position } } : module
        })

        set({
          ...fresh,
          worldRevision,
          settlement: { ...state.settlement, phase: 'operations' },
          reserves: {
            ...fresh.reserves,
            constructionStock: state.reserves.constructionStock,
          },
          modules,
          events: fresh.events.map((event) => ({
            ...event,
            worldRevision,
            planRevision: fresh.operationsPlan.revision,
          })),
          operationsPlan: {
            ...fresh.operationsPlan,
            basedOnWorldRevision: worldRevision,
          },
        })
        return true
      },
      setConstructionSpeed: (speed) => {
        if (speed !== 0 && speed !== 1 && speed !== 2 && speed !== 3) return false
        const state = get()
        if (state.settlement.constructionSpeed === speed) return false
        set({
          settlement: { ...state.settlement, constructionSpeed: speed },
          worldRevision: state.worldRevision + 1,
        })
        return true
      },
      queueConstruction: (result) => {
        if (!result.ok) return { ok: false, orderIds: [], error: result.error }
        const state = get()
        const projection = projectConstructionOrders(
          state.settlement.layout,
          state.settlement.constructionOrders,
        )
        if (!projection.valid) {
          return {
            ok: false,
            orderIds: [],
            error: projection.issues[0]?.error ?? 'Existing blueprints must be resolved first.',
          }
        }

        const sequenceStart = state.settlement.constructionSequence
        const commandId = `construction-${sequenceStart}`
        const derived = deriveConstructionOrders(projection.layout, result, {
          commandId,
          priority: 3,
          sequenceStart,
          completedLayout: state.settlement.layout,
          prerequisiteOrders: state.settlement.constructionOrders,
        })
        if (derived.length === 0) {
          return { ok: false, orderIds: [], error: 'Nothing changed on those tiles.' }
        }
        const stockpile = state.settlement.constructionStockpile
        const coversStockpile = derived.some((order) => (
          order.status !== 'complete' &&
          Boolean(order.target.construct) &&
          order.target.cells.some((cell) => cell.x === stockpile.x && cell.y === stockpile.y)
        ))
        if (coversStockpile) {
          return {
            ok: false,
            orderIds: [],
            error: 'The construction pallet occupies that footprint. Build beside it so colonists can collect materials.',
          }
        }

        const cancelledIds = new Set<string>()
        const skippedNewIds = new Set<string>()
        derived.forEach((candidate) => {
          state.settlement.constructionOrders.forEach((existing) => {
            if (removesOnlyPendingTarget(existing, candidate)) {
              cancelledIds.add(existing.id)
              skippedNewIds.add(candidate.id)
            }
          })
        })
        const cancelled = cancelledIds.size > 0
          ? cancelConstructionOrdersInState(
              state.settlement.layout,
              state.settlement.constructionOrders,
              cancelledIds,
            )
          : null
        const nextOrders = [
          ...(cancelled?.orders ?? state.settlement.constructionOrders),
          ...derived.filter((order) => !skippedNewIds.has(order.id)),
        ]
        const nextProjection = projectConstructionOrders(
          state.settlement.layout,
          nextOrders,
        )
        const indoorWorkstationOutsideRoom = nextProjection.valid
          ? derived.find((order) => {
              if (
                skippedNewIds.has(order.id) ||
                order.status === 'complete' ||
                order.target.kind !== 'workstation' ||
                !order.target.construct
              ) return false
              const spec = WORKSTATION_SPECS[
                order.target.construct.type as keyof typeof WORKSTATION_SPECS
              ]
              if (!spec.indoor) return false
              const topology = analyzeConstructionPressure(nextProjection.layout)
              const rooms = new Set(order.target.cells.map((cell) => (
                topology.roomByCell.get(`${cell.x}:${cell.y}`)?.id
              )))
              if (rooms.size !== 1 || rooms.has(undefined)) return true
              const roomId = [...rooms][0]
              const targetKeys = new Set(order.target.cells.map((cell) => `${cell.x}:${cell.y}`))
              return topology.doors.some((door) => (
                door.role !== 'invalid' &&
                door.roomIds.includes(roomId!) &&
                door.passageCells.some((cell) => targetKeys.has(`${cell.x}:${cell.y}`))
              ))
            })
          : undefined
        if (indoorWorkstationOutsideRoom) {
          return {
            ok: false,
            orderIds: [],
            error: 'Place this workstation inside one enclosed room and leave the floor immediately inside each working door clear.',
          }
        }
        const inaccessibleWorkstation = nextProjection.valid
          ? derived.find((order) => (
              !skippedNewIds.has(order.id) &&
              order.status !== 'complete' &&
              order.target.kind === 'workstation' &&
              Boolean(order.target.construct) &&
              order.materials.required > 0 &&
              !findConstructionOrderApproachPath(
                nextProjection.layout,
                stockpile,
                order,
              )
            ))
          : undefined
        if (inaccessibleWorkstation) {
          return {
            ok: false,
            orderIds: [],
            error: 'That workstation blocks its construction access. Leave a clear walkable path from the construction pallet through a valid door to at least one floor tile beside the fixture.',
          }
        }
        if (state.settlement.phase === 'operations') {
          const pressure = nextProjection.valid
            ? analyzeConstructionPressure(nextProjection.layout)
            : null
          const keepsExteriorAirlock = pressure?.doors.some((door) => (
            door.role === 'exterior_airlock' && door.roomIds.length === 1
          ))
          if (!keepsExteriorAirlock) {
            return {
              ok: false,
              orderIds: [],
              error: 'Operations need at least one usable exterior airlock. Build a replacement before removing the last one.',
            }
          }
        }
        if (nextProjection.valid) {
          const currentPressure = analyzeConstructionPressure(state.settlement.layout)
          const nextPressure = analyzeConstructionPressure(nextProjection.layout)
          const currentSemanticEvaCellKeys = constructionSemanticEvaCellKeys(
            state.modules,
            state.settlement.layout,
            state.lab.atmosphere,
          )
          const nextSemanticEvaCellKeys = constructionSemanticEvaCellKeys(
            state.modules,
            nextProjection.layout,
            state.lab.atmosphere,
          )
          const deployedCrewIds = new Set(visibleConstructionCrew(state).map((member) => member.id))
          const newlyExposedCrewIds = state.settlement.constructionCrew
            .filter((position) => deployedCrewIds.has(position.crewId))
            .filter((position) => {
              const key = constructionPointKey(position.cell)
              const currentlyRequiresEva = constructionEnvironmentAt(
                state.settlement.layout,
                currentPressure,
                position.cell,
              ) !== 'pressurized' || currentSemanticEvaCellKeys.has(key)
              const nextRequiresEva = constructionEnvironmentAt(
                nextProjection.layout,
                nextPressure,
                position.cell,
              ) !== 'pressurized' || nextSemanticEvaCellKeys.has(key)
              return !currentlyRequiresEva && nextRequiresEva
            })
            .map((position) => position.crewId)
          const unprotectedCrewIds = newlyExposedCrewIds.filter((crewId) => (
            !constructionSuitForCrew(state, crewId)
          ))
          const availableSuitCount = state.equipment.filter((item) => (
            item.type === 'eva_suit' &&
            item.condition >= 65 &&
            !item.reservedForWorkOrderId &&
            !item.assignedCrewId
          )).length
          const unavailableCrew = unprotectedCrewIds.find((crewId) => (
            Boolean(constructionCrewUnavailableReason(state, crewId))
          ))
          if (unavailableCrew || unprotectedCrewIds.length > availableSuitCount) {
            return {
              ok: false,
              orderIds: [],
              error: 'That change would vent occupied space before every colonist can seal an EVA suit. Move the crew or free enough suits first.',
            }
          }
        }
        const returnedMaterials = cancelled?.returnedMaterials ?? 0
        const constructionStock = state.reserves.constructionStock + returnedMaterials
        const reservation = reserveConstructionMaterials(nextOrders, constructionStock)
        const queuedOrderIds = derived
          .filter((order) => !skippedNewIds.has(order.id))
          .map((order) => order.id)
        set({
          settlement: {
            ...state.settlement,
            constructionOrders: reservation.orders,
            constructionSequence: sequenceStart + Math.max(1, derived.length),
          },
          reserves: {
            ...state.reserves,
            constructionStock,
          },
          worldRevision: state.worldRevision + 1,
        })
        return {
          ok: true,
          commandId,
          orderIds: queuedOrderIds,
          blockedOrderIds: reservation.blockedOrderIds.filter((id) => queuedOrderIds.includes(id)),
          materialRequired: derived
            .filter((order) => !skippedNewIds.has(order.id))
            .reduce((total, order) => total + order.materials.required, 0),
        }
      },
      cancelConstructionCommand: (commandId) => {
        const state = get()
        const cancelled = cancelConstructionCommandInState(
          state.settlement.layout,
          state.settlement.constructionOrders,
          commandId,
        )
        if (cancelled.cancelledOrderIds.length > 0) {
          const constructionStock = state.reserves.constructionStock + cancelled.returnedMaterials
          const reservation = reserveConstructionMaterials(cancelled.orders, constructionStock)
          set({
            settlement: {
              ...state.settlement,
              constructionOrders: reservation.orders,
            },
            reserves: { ...state.reserves, constructionStock },
            worldRevision: state.worldRevision + 1,
          })
        }
        return cancelled.cancelledOrderIds
      },
      cancelConstructionOrder: (orderId) => {
        const state = get()
        const cancelled = cancelConstructionOrderInState(
          state.settlement.layout,
          state.settlement.constructionOrders,
          orderId,
        )
        if (cancelled.cancelledOrderIds.length === 0) return false
        const constructionStock = state.reserves.constructionStock +
          cancelled.returnedMaterials
        const reservation = reserveConstructionMaterials(cancelled.orders, constructionStock)
        set({
          settlement: {
            ...state.settlement,
            constructionOrders: reservation.orders,
          },
          reserves: { ...state.reserves, constructionStock },
          worldRevision: state.worldRevision + 1,
        })
        return true
      },
      setConstructionOrderPriority: (orderId, priority) => {
        if (![1, 2, 3, 4, 5].includes(priority)) return false
        const state = get()
        let changed = false
        const constructionOrders = state.settlement.constructionOrders.map((order) => {
          if (order.id !== orderId || order.status === 'complete' || order.priority === priority) {
            return order
          }
          changed = true
          return { ...order, priority }
        })
        if (!changed) return false
        const reprioritizedOrders = reallocateUncollectedConstructionReservations(
          constructionOrders,
          state.reserves.constructionStock,
        )
        set({
          settlement: { ...state.settlement, constructionOrders: reprioritizedOrders },
          worldRevision: state.worldRevision + 1,
        })
        return true
      },
      setConstructionCommandPriority: (commandId, priority) => {
        if (![1, 2, 3, 4, 5].includes(priority)) return 0
        const state = get()
        let changedCount = 0
        const constructionOrders = state.settlement.constructionOrders.map((order) => {
          if (
            order.commandId !== commandId ||
            order.status === 'complete' ||
            order.priority === priority
          ) return order
          changedCount += 1
          return { ...order, priority }
        })
        if (changedCount === 0) return 0
        set({
          settlement: {
            ...state.settlement,
            constructionOrders: reallocateUncollectedConstructionReservations(
              constructionOrders,
              state.reserves.constructionStock,
            ),
          },
          worldRevision: state.worldRevision + 1,
        })
        return changedCount
      },
      setConstructionOrderBuilder: (orderId, crewId) => {
        const state = get()
        const target = state.settlement.constructionOrders.find((order) => order.id === orderId)
        const failure = (error: string): ConstructionBuilderAssignmentResult => ({
          ok: false,
          orderId,
          crewId,
          error,
        })
        if (!target || target.status === 'complete') {
          return failure('That blueprint is no longer waiting for construction.')
        }

        if (crewId === null) {
          if (!target.forcedCrewId) {
            return { ok: true, orderId, crewId: null }
          }
          if (carriedConstructionMaterial(target) > 0) {
            return failure('Finish delivering this blueprint\'s construction material before returning it to Automatic.')
          }
          const constructionOrders = state.settlement.constructionOrders.map((order) => (
            order.id === orderId
              ? {
                  ...order,
                  forcedCrewId: null,
                  assignedCrewId: order.assignedCrewId === order.forcedCrewId
                    ? null
                    : order.assignedCrewId,
                  travelPhase: order.assignedCrewId === order.forcedCrewId
                    ? 'idle' as const
                    : order.travelPhase,
                  routeBlockedContextKey: order.assignedCrewId === order.forcedCrewId
                    ? null
                    : order.routeBlockedContextKey,
                }
              : order
          ))
          set({
            settlement: { ...state.settlement, constructionOrders },
            worldRevision: state.worldRevision + 1,
          })
          return { ok: true, orderId, crewId: null }
        }

        const unavailable = constructionCrewUnavailableReason(state, crewId)
        if (unavailable) return failure(unavailable)
        const member = state.crew.find((candidate) => candidate.id === crewId)
        if (!member) return failure('That colonist is not available.')
        if (target.forcedCrewId === crewId) {
          return { ok: true, orderId, crewId }
        }

        if (target.block?.kind === 'target_changed') {
          return failure('The blueprint target changed. Cancel it and place a fresh blueprint.')
        }
        if (target.block?.kind === 'carrier_unavailable') {
          return failure(target.block.message)
        }
        if (target.block?.kind === 'prerequisite') {
          return failure('Finish the prerequisite construction before assigning a builder.')
        }
        if (target.block?.kind === 'insufficient_materials') {
          return failure('This blueprint needs construction material before a builder can prioritize it.')
        }

        const targetCarrierId = carriedConstructionMaterial(target) > 0
          ? target.materials.carriedByCrewId ?? null
          : null
        if (targetCarrierId && targetCarrierId !== crewId) {
          const carrierName = state.crew.find((candidate) => candidate.id === targetCarrierId)?.name
          return failure(`${carrierName ?? 'Another colonist'} is carrying this blueprint's material and must deliver it first.`)
        }
        const carriedOrder = state.settlement.constructionOrders.find((order) => (
          order.id !== orderId &&
          order.status !== 'complete' &&
          carriedConstructionMaterial(order) > 0 &&
          order.materials.carriedByCrewId === crewId
        ))
        if (carriedOrder) {
          return failure(`${member.name} is carrying construction material and must deliver it first.`)
        }

        const constructionOrders = state.settlement.constructionOrders.map((order) => {
          if (order.id === orderId) {
            return {
              ...order,
              forcedCrewId: crewId,
              assignedCrewId: order.block?.kind === 'no_path'
                ? targetCarrierId
                : targetCarrierId ?? crewId,
              travelPhase: targetCarrierId ? 'to_site' as const : 'idle' as const,
            }
          }
          const workerIsCarrying = carriedConstructionMaterial(order) > 0 &&
            order.materials.carriedByCrewId === crewId
          if (workerIsCarrying) return order
          const releasesForcedIntent = order.forcedCrewId === crewId
          const releasesLiveClaim = order.assignedCrewId === crewId
          if (!releasesForcedIntent && !releasesLiveClaim) return order
          return {
            ...order,
            forcedCrewId: releasesForcedIntent ? null : order.forcedCrewId,
            assignedCrewId: releasesLiveClaim ? null : order.assignedCrewId,
            travelPhase: releasesLiveClaim ? 'idle' as const : order.travelPhase,
            routeBlockedContextKey: releasesLiveClaim ? null : order.routeBlockedContextKey,
          }
        })
        set({
          settlement: {
            ...state.settlement,
            constructionOrders,
          },
          worldRevision: state.worldRevision + 1,
        })
        return { ok: true, orderId, crewId }
      },
      advanceConstruction: (elapsed = 1) => {
        const before = get()
        if (before.settlement.constructionSpeed === 0) {
          return { completedOrderIds: [], blockedOrderIds: [] }
        }
        const state = structuredClone(domainSnapshot(before))
        const summary = advanceConstructionInState(state, elapsed)
        if (
          summary.completedOrderIds.length > 0 ||
          state.settlement.constructionOrders.some((order, index) =>
            JSON.stringify(order) !== JSON.stringify(before.settlement.constructionOrders[index]),
          ) ||
          JSON.stringify(state.settlement.constructionCrew) !==
            JSON.stringify(before.settlement.constructionCrew) ||
          JSON.stringify(state.settlement.constructionStockpile) !==
            JSON.stringify(before.settlement.constructionStockpile) ||
          JSON.stringify(state.crew) !== JSON.stringify(before.crew) ||
          JSON.stringify(state.equipment) !== JSON.stringify(before.equipment)
        ) {
          state.worldRevision += 1
          set(state)
        }
        return summary
      },
      deployPresetMoonbase: (actor = 'manual') => {
        const [nextState, result] = deployPresetMoonbaseInState(get(), actor)
        if (result.ok) set(nextState)
        return result
      },
      beginOperations: (actor = 'manual') => {
        const [nextState, result] = beginOperationsInState(get(), actor)
        if (result.ok) set(nextState)
        return result
      },
      setPlanBrief: (input, actor = 'manual') => {
        const [nextState, result] = setPlanBriefInState(get(), input, actor)
        if (result.ok) set(nextState)
        return result
      },
      stagePlanAction: (input, actor = 'manual') => {
        const [nextState, result] = stagePlanActionInState(get(), input, actor)
        if (result.ok) set(nextState)
        return result
      },
      stagePlanBatch: (input, actor = 'manual') => {
        const [nextState, result] = stageOperationsPlanBatch(get(), input, actor)
        if (result.ok) set(nextState)
        return result
      },
      removePlanAction: (actionId, actor = 'manual') => {
        const [nextState, result] = removePlanActionFromState(get(), actionId, actor)
        if (result.ok) set(nextState)
        return result
      },
      removePlanActionsBatch: (input, actor = 'manual') => {
        const [nextState, result] = removePlanActionsBatchFromState(get(), input, actor)
        if (result.ok) set(nextState)
        return result
      },
      rebasePlan: (actor = 'manual') => {
        const [nextState, result] = rebaseOperationsPlan(get(), actor)
        if (result.ok) set(nextState)
        return result
      },
      clearPlan: (actor = 'manual') => {
        const [nextState, result] = clearOperationsPlan(get(), actor)
        if (result.ok) set(nextState)
        return result
      },
      validatePlan: () => validateOperationsPlan(get()),
      commitPlan: (expectedWorldRevision, expectedPlanRevision, actor = 'manual') => {
        const [nextState, result] = commitOperationsPlan(
          get(),
          expectedWorldRevision,
          expectedPlanRevision,
          actor,
        )
        if (result.ok) set(nextState)
        return result
      },
      advanceTime: (input, actor = 'manual') => {
        const [nextState, result] = advanceSimulation(get(), input, actor)
        set(nextState)
        return result
      },
      advanceHours: (hours, actor = 'manual') => {
        const [nextState, result] = advanceSimulation(get(), { hours }, actor)
        set(nextState)
        return result
      },
      verifyPlan: (actor = 'manual') => {
        const current = get()
        const [nextState, result] = verifyOperationsPlan(current, actor)
        if (nextState !== current) set(nextState)
        return result
      },
      recordLearningEvidence: (phase, detail, actor = 'manual', options = {}) => {
        set(recordLearningEvidenceInState(get(), phase, detail, actor, options))
      },
    }),
    {
      name: 'playlearnai-moonbase-poc-v1',
      version: PERSISTENCE_VERSION,
      partialize: domainSnapshot,
      migrate: (persistedState, version) => {
        const initialState = createInitialState()
        if (version > PERSISTENCE_VERSION) return initialState
        const state = persistedState as Partial<MoonbaseState>
        if (!state.settlement) return initialState
        const runSequence = normalizedRunSequence(state.runSequence)
        const layout = version < 4
          ? createStarterConstruction()
          : state.settlement.layout
        if (!isConstructionLayout(layout)) return initialState
        const constructionStock = normalizedConstructionStock(
          state.reserves?.constructionStock,
          initialState.reserves.constructionStock,
        )
        const constructionSpeed = normalizedConstructionSpeed(
          state.settlement.constructionSpeed,
          initialState.settlement.constructionSpeed,
        )
        const sourceOrders = version < 5 || !Array.isArray(state.settlement.constructionOrders)
          ? []
          : state.settlement.constructionOrders
        const normalizedOrders = version === 5
          ? migrateV5ConstructionOrders(sourceOrders, constructionStock).orders
          : normalizePersistedConstructionOrders(
              sourceOrders,
              constructionStock,
              { legacyDeliveredInTransit: version < 9 },
            ).orders
        const dependencySafeOrders = version < 7
          ? rebuildConstructionOrderPrerequisites(
              layout,
              normalizedOrders,
              constructionStock,
            ).orders
          : normalizedOrders
        const crewMembers = reconciledCrewCollection(state.crew, initialState.crew)
        const persistedModuleStates = reconciledModuleCollection(
          state.modules,
          initialState.modules,
        )
        const labState = state.lab && typeof state.lab === 'object'
          ? { ...initialState.lab, ...state.lab }
          : initialState.lab
        const moduleStates = reconcileLaboratoryModuleState(persistedModuleStates, labState)
        const crewIds = new Set(crewMembers.map((member) => member.id))
        const constructionOrders = resetLegacyTravelAssignments(
          dependencySafeOrders,
          version >= 7 ? crewIds : undefined,
        )
        const constructionStockpile = normalizeConstructionStockpile(
          layout,
          version >= 7
            ? persistedGridPoint(state.settlement.constructionStockpile)
            : initialState.settlement.constructionStockpile,
          initialState.settlement.constructionStockpile,
        )
        const constructionCrew = normalizePersistedConstructionCrewPositions(
          layout,
          crewMembers,
          version >= 7 ? state.settlement.constructionCrew : [],
          constructionStockpile,
          constructionOrders,
          constructionSemanticEvaCells(moduleStates, layout, labState.atmosphere),
        )
        const migratedState = {
          ...initialState,
          ...state,
          crew: crewMembers,
          modules: moduleStates,
          lab: labState,
          runSequence,
          runId: version >= RUN_ID_PERSISTENCE_VERSION && isOpaqueRunId(state.runId)
            ? state.runId
            : createRunId(),
          reserves: { ...state.reserves, constructionStock },
          equipment: reconciledEquipment(state.equipment, initialState.equipment),
          workOrders: reconciledWorkOrders(state.workOrders, initialState.workOrders),
          settlement: {
            ...state.settlement,
            layout,
            constructionSpeed,
            constructionOrders,
            constructionCrew,
            constructionStockpile,
            constructionSequence: repairedConstructionSequence(
              constructionOrders,
              state.settlement.constructionSequence,
            ),
          },
        } as MoonbaseState
        const evaSafeState = version < EVA_SAFE_PERSISTENCE_VERSION &&
          version >= RUN_ID_PERSISTENCE_VERSION
          ? hardenLegacyEvaState(migratedState)
          : migratedState
        const phaseSafeState = version < PHASE_SAFE_PERSISTENCE_VERSION &&
          evaSafeState.settlement.phase !== 'operations'
          ? resetLegacyEstablishmentIncident(evaSafeState, initialState)
          : evaSafeState
        return relocateUnprotectedConstructionCrew(phaseSafeState, initialState)
      },
      merge: (persistedState, currentState) => {
        const persisted = persistedState as Partial<MoonbaseState>
        if (!persisted.settlement || !isConstructionLayout(persisted.settlement.layout)) {
          return currentState
        }
        const constructionStock = normalizedConstructionStock(
          persisted.reserves?.constructionStock,
          currentState.reserves.constructionStock,
        )
        const constructionSpeed = normalizedConstructionSpeed(
          persisted.settlement.constructionSpeed,
          currentState.settlement.constructionSpeed,
        )
        const constructionOrders = normalizePersistedConstructionOrders(
          persisted.settlement.constructionOrders,
          constructionStock,
        ).orders
        const crewMembers = reconciledCrewCollection(persisted.crew, currentState.crew)
        const persistedModuleStates = reconciledModuleCollection(
          persisted.modules,
          currentState.modules,
        )
        const labState = persisted.lab && typeof persisted.lab === 'object'
          ? { ...currentState.lab, ...persisted.lab }
          : currentState.lab
        const moduleStates = reconcileLaboratoryModuleState(persistedModuleStates, labState)
        const crewIds = new Set(crewMembers.map((member) => member.id))
        const repairedOrders = resetLegacyTravelAssignments(
          constructionOrders,
          crewIds,
        )
        const constructionStockpile = normalizeConstructionStockpile(
          persisted.settlement.layout,
          persistedGridPoint(persisted.settlement.constructionStockpile),
          currentState.settlement.constructionStockpile,
        )
        const constructionCrew = normalizePersistedConstructionCrewPositions(
          persisted.settlement.layout,
          crewMembers,
          persisted.settlement.constructionCrew,
          constructionStockpile,
          repairedOrders,
          constructionSemanticEvaCells(
            moduleStates,
            persisted.settlement.layout,
            labState.atmosphere,
          ),
        )
        const runSequence = normalizedRunSequence(
          persisted.runSequence,
          currentState.runSequence,
        )
        const mergedState = {
          ...currentState,
          ...persisted,
          crew: crewMembers,
          modules: moduleStates,
          lab: labState,
          runSequence,
          runId: isOpaqueRunId(persisted.runId)
            ? persisted.runId
            : currentState.runId,
          reserves: {
            ...currentState.reserves,
            ...persisted.reserves,
            constructionStock,
          },
          equipment: reconciledEquipment(persisted.equipment, currentState.equipment),
          workOrders: reconciledWorkOrders(persisted.workOrders, currentState.workOrders),
          settlement: {
            ...currentState.settlement,
            ...persisted.settlement,
            constructionSpeed,
            constructionOrders: repairedOrders,
            constructionCrew,
            constructionStockpile,
            constructionSequence: repairedConstructionSequence(
              repairedOrders,
              persisted.settlement.constructionSequence,
            ),
          },
        }
        return relocateUnprotectedConstructionCrew(mergedState, currentState)
      },
    },
  ),
)

export const useMoonbaseStore = useColonyStore
