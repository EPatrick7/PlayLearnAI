import type {
  Actor,
  ActivityEntry,
  AdvanceInput,
  AdvanceResult,
  AlertState,
  CommitResult,
  CrewMember,
  EquipmentType,
  GroundingEvidenceKind,
  LearningEvidenceOptions,
  LearningPhase,
  MoonbaseState,
  ObjectiveId,
  OperationsPlan,
  PlanAction,
  PlanActionInput,
  PlanBriefInput,
  PlanEditResult,
  PlanValidation,
  Priority,
  StopCondition,
  StopReason,
  ValidationIssue,
  VerificationCheck,
  VerificationResult,
  WorkOrder,
  WorkOrderId,
} from './types'
import {
  analyzeConstructionPressure,
  constructionEnvironmentAt,
} from './pressureTopology'
import { constructionSemanticEvaCellKeys } from './constructionHazards'

export const MAX_ADVANCE_HOURS = 12

export interface StagePlanBatchInput {
  expectedRunId: string
  expectedWorldRevision: number
  expectedPlanRevision: number
  mode?: 'append' | 'replace'
  brief?: PlanBriefInput
  actions: PlanActionInput[]
}

export interface StagePlanBatchActionResult extends PlanEditResult {
  actionIndex: number
}

export interface StagePlanBatchResult {
  ok: boolean
  code: 'staged' | 'stale_run' | 'stale_revision' | 'edit_failed'
  worldRevision: number
  planRevision: number
  currentWorldRevision: number
  currentPlanRevision: number
  editResults: StagePlanBatchActionResult[]
  replaceResult?: PlanEditResult
  briefResult?: PlanEditResult
  failedStage?: 'replace' | 'brief' | 'action'
  failedActionIndex?: number
  error?: string
}

export interface RemovePlanActionsBatchInput {
  expectedRunId: string
  expectedPlanRevision: number
  actionIds: string[]
}

export interface RemovePlanActionsBatchFailure {
  actionIndex: number
  actionId: string
  error: string
}

export interface RemovePlanActionsBatchResult {
  ok: boolean
  code: 'removed' | 'stale_run' | 'stale_plan' | 'edit_failed'
  planRevision: number
  currentPlanRevision: number
  editResults: PlanEditResult[]
  failures: RemovePlanActionsBatchFailure[]
  error?: string
}

const OBJECTIVE_WORK_ORDER_IDS: WorkOrderId[] = [
  'work-seal-lab',
  'work-repressurize-lab',
  'work-research-sintering',
]

const cloneState = (state: MoonbaseState): MoonbaseState =>
  JSON.parse(JSON.stringify(state)) as MoonbaseState

const round = (value: number, places = 1) => {
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}

const boundedNumber = (value: number, fallback: number) =>
  Number.isFinite(value) ? value : fallback

const unique = <T>(values: T[]): T[] => [...new Set(values)]

const eventId = (state: MoonbaseState) => {
  const prefix = `event-${String(state.worldRevision).padStart(4, '0')}-${String(state.operationsPlan.revision).padStart(3, '0')}`
  const sequence = state.events.filter((entry) => entry.id.startsWith(prefix)).length + 1
  return `${prefix}-${String(sequence).padStart(3, '0')}`
}

const addEvent = (
  state: MoonbaseState,
  phase: ActivityEntry['phase'],
  actor: Actor,
  message: string,
  targetIds: string[] = [],
) => {
  state.events.unshift({
    id: eventId(state),
    elapsedHours: state.elapsedHours,
    missionDay: state.missionDay,
    hour: state.hour,
    worldRevision: state.worldRevision,
    planRevision: state.operationsPlan.revision,
    phase,
    actor,
    message,
    targetIds,
  })
  state.events = state.events.slice(0, 40)
}

const learningCopy = {
  ground: 'Ground the next decision in fresh pressure, reserve, power, crew, equipment, and work evidence.',
  plan: 'Stage an objective, constraints, assignments, equipment reservations, horizon, and stop condition.',
  supervise: 'Commit the reviewed plan and advance only within its horizon while watching stop conditions.',
  verify: 'Compare the actual laboratory, research, oxygen, and power outcome with the committed baseline.',
} satisfies Record<LearningPhase, string>

const addLearningEvidence = (
  state: MoonbaseState,
  phase: LearningPhase,
  detail: string,
  actor: 'manual' | 'agent',
  completesPhase = true,
  groundingKind?: GroundingEvidenceKind,
) => {
  const phases: LearningPhase[] = ['ground', 'plan', 'supervise', 'verify']
  if (phase === 'ground' && phases.every((candidate) => state.learning.achieved[candidate])) {
    state.learning.achieved = { ground: false, plan: false, supervise: false, verify: false }
  }
  const loopWasComplete = phases.every((candidate) => state.learning.achieved[candidate])

  const evidencePrefix = `evidence-${state.operationsPlan.revision}-${state.worldRevision}`
  const evidenceSequence = state.learning.evidence.filter((entry) => entry.id.startsWith(evidencePrefix)).length + 1
  state.learning.evidence.unshift({
    id: `${evidencePrefix}-${evidenceSequence}`,
    phase,
    actor,
    detail,
    worldRevision: state.worldRevision,
    planRevision: state.operationsPlan.revision,
    elapsedHours: state.elapsedHours,
    ...(groundingKind ? {
      groundingKind,
      learningLoop: state.learning.completedLoops,
    } : {}),
  })
  state.learning.evidence = state.learning.evidence.slice(0, 24)
  if (!completesPhase || state.learning.currentPhase !== phase) {
    const currentPhase = state.learning.currentPhase
    state.learning.coaching = currentPhase === 'supervise'
      ? 'Inspect what changed after this checkpoint, then choose whether to continue, pause, or revise.'
      : learningCopy[currentPhase]
    return
  }
  state.learning.achieved[phase] = true

  if (!loopWasComplete && phases.every((candidate) => state.learning.achieved[candidate])) {
    state.learning.completedLoops += 1
    state.learning.currentPhase = 'ground'
    state.learning.coaching = 'Operating loop complete. Ground the next plan in the new world revision.'
    return
  }

  state.learning.currentPhase = phases.find((candidate) => !state.learning.achieved[candidate]) ?? 'ground'
  state.learning.coaching = learningCopy[state.learning.currentPhase]
}

export const recordLearningEvidence = (
  source: MoonbaseState,
  phase: LearningPhase,
  detail: string,
  actor: 'manual' | 'agent' = 'manual',
  options: LearningEvidenceOptions = {},
): MoonbaseState => {
  const state = cloneState(source)
  const complementaryGroundingExists = options.groundingKind
      ? state.learning.evidence.some((entry) => (
        entry.phase === 'ground' &&
        entry.learningLoop === state.learning.completedLoops &&
        entry.groundingKind !== undefined &&
        entry.groundingKind !== options.groundingKind
      ))
    : false
  const completedLoop = (['ground', 'plan', 'supervise', 'verify'] as const).every(
    (candidate) => state.learning.achieved[candidate],
  )
  const completesPhase = options.completesPhase ?? (
    phase === 'ground'
      ? options.groundingKind
        ? (!completedLoop && state.learning.achieved.ground) || complementaryGroundingExists
        : false
      : true
  )
  addLearningEvidence(
    state,
    phase,
    detail,
    actor,
    completesPhase,
    options.groundingKind,
  )
  if (phase === 'ground' && options.groundingKind && !state.learning.achieved.ground) {
    state.learning.coaching = options.groundingKind === 'incident_telemetry'
      ? 'Now compare crew and equipment before staging the response.'
      : 'Now inspect incident pressure, reserves, power, and work dependencies before staging the response.'
  }
  const activityPhase = phase === 'ground' ? 'observed' : phase === 'plan' ? 'planned' : phase === 'verify' ? 'verified' : 'changed'
  addEvent(state, activityPhase, actor, detail)
  return state
}

const draftError = (state: MoonbaseState): PlanEditResult => ({
  ok: false,
  planRevision: state.operationsPlan.revision,
  error: 'The Operations Plan is already committed. Clear it to stage a new plan.',
})

const operationsAreAvailable = (state: MoonbaseState) => state.settlement.phase === 'operations'

const operationsUnavailableError = (state: MoonbaseState): PlanEditResult => ({
  ok: false,
  planRevision: state.operationsPlan.revision,
  error: `The Operations Plan is unavailable while the settlement phase is ${state.settlement.phase}. Complete base construction and begin operations first.`,
})

export const setPlanBrief = (
  source: MoonbaseState,
  input: PlanBriefInput,
  actor: 'manual' | 'agent' = 'manual',
): [MoonbaseState, PlanEditResult] => {
  if (!operationsAreAvailable(source)) return [source, operationsUnavailableError(source)]
  const state = cloneState(source)
  if (state.operationsPlan.status !== 'draft') return [state, draftError(state)]

  state.operationsPlan.objective = input.objective
  state.operationsPlan.constraints = {
    oxygenFloorHours: input.constraints.oxygenFloorHours,
    protectedCrewIds: unique(input.constraints.protectedCrewIds).slice(0, 6),
  }
  state.operationsPlan.horizonHours = input.horizonHours
  state.operationsPlan.stopCondition = input.stopCondition
  state.operationsPlan.revision += 1
  state.verification = null
  addEvent(
    state,
    'planned',
    actor,
    `Updated plan brief: restore the lab within ${input.horizonHours} hours and keep oxygen at or above ${input.constraints.oxygenFloorHours} hours.`,
    [state.operationsPlan.id],
  )
  return [state, { ok: true, planRevision: state.operationsPlan.revision }]
}

const redundantAction = (candidate: PlanAction, input: PlanActionInput) => {
  if (candidate.kind !== input.kind) return false
  if (candidate.kind === 'assign_crew' && input.kind === 'assign_crew') return candidate.crewId === input.crewId
  if (candidate.kind === 'reserve_equipment' && input.kind === 'reserve_equipment') {
    return candidate.equipmentId === input.equipmentId
  }
  if (candidate.kind === 'set_priority' && input.kind === 'set_priority') {
    return candidate.workOrderId === input.workOrderId
  }
  return false
}

export const stagePlanAction = (
  source: MoonbaseState,
  input: PlanActionInput,
  actor: 'manual' | 'agent' = 'manual',
): [MoonbaseState, PlanEditResult] => {
  if (!operationsAreAvailable(source)) return [source, operationsUnavailableError(source)]
  const state = cloneState(source)
  if (state.operationsPlan.status !== 'draft') return [state, draftError(state)]

  state.operationsPlan.revision += 1
  const id = `plan-action-${String(state.operationsPlan.revision).padStart(3, '0')}`
  state.operationsPlan.actions = state.operationsPlan.actions.filter((action) => !redundantAction(action, input))
  state.operationsPlan.actions.push({ ...input, id } as PlanAction)
  state.verification = null
  addEvent(state, 'planned', actor, `Staged ${input.kind.replaceAll('_', ' ')} for ${input.workOrderId}.`, [id, input.workOrderId])
  return [state, { ok: true, planRevision: state.operationsPlan.revision, actionId: id }]
}

export const removePlanAction = (
  source: MoonbaseState,
  actionId: string,
  actor: 'manual' | 'agent' = 'manual',
): [MoonbaseState, PlanEditResult] => {
  if (!operationsAreAvailable(source)) return [source, operationsUnavailableError(source)]
  const state = cloneState(source)
  if (state.operationsPlan.status !== 'draft') return [state, draftError(state)]
  const existing = state.operationsPlan.actions.find((action) => action.id === actionId)
  if (!existing) {
    return [state, { ok: false, planRevision: state.operationsPlan.revision, error: `Unknown plan action: ${actionId}` }]
  }

  state.operationsPlan.actions = state.operationsPlan.actions.filter((action) => action.id !== actionId)
  state.operationsPlan.revision += 1
  addEvent(state, 'planned', actor, `Removed staged action ${actionId}.`, [actionId])
  return [state, { ok: true, planRevision: state.operationsPlan.revision }]
}

export const rebaseOperationsPlan = (
  source: MoonbaseState,
  actor: 'manual' | 'agent' = 'manual',
): [MoonbaseState, PlanEditResult] => {
  if (!operationsAreAvailable(source)) return [source, operationsUnavailableError(source)]
  const state = cloneState(source)
  if (state.operationsPlan.status !== 'draft') return [state, draftError(state)]
  state.operationsPlan.basedOnWorldRevision = state.worldRevision
  state.operationsPlan.revision += 1
  addEvent(state, 'planned', actor, `Rebased the draft on world revision ${state.worldRevision}.`, [state.operationsPlan.id])
  return [state, { ok: true, planRevision: state.operationsPlan.revision }]
}

export const clearOperationsPlan = (
  source: MoonbaseState,
  actor: 'manual' | 'agent' = 'manual',
): [MoonbaseState, PlanEditResult] => {
  if (!operationsAreAvailable(source)) return [source, operationsUnavailableError(source)]
  const hasUnverifiedAdvance =
    source.operationsPlan.baseline !== null &&
    source.lastAdvance !== null &&
    (
      source.elapsedHours > source.operationsPlan.baseline.elapsedHours ||
      source.operationsPlan.status === 'completed'
    ) &&
    !(
      source.verification?.verifiedAtWorldRevision === source.worldRevision &&
      source.verification.verifiedAtHour === source.elapsedHours
    )
  if (hasUnverifiedAdvance) {
    return [source, {
      ok: false,
      planRevision: source.operationsPlan.revision,
      error: 'Verify the supervised outcome before opening a new Operations Plan.',
    }]
  }
  const state = cloneState(source)
  const nextRevision = state.operationsPlan.revision + 1
  state.operationsPlan = {
    id: state.operationsPlan.id,
    title: 'Laboratory recovery',
    status: 'draft',
    revision: nextRevision,
    basedOnWorldRevision: state.worldRevision,
    objective: state.objective.id,
    constraints: {
      oxygenFloorHours: state.objective.recommendedOxygenFloorHours,
      protectedCrewIds: [],
    },
    horizonHours: MAX_ADVANCE_HOURS,
    stopCondition: { kind: 'objective_complete' },
    actions: [],
    committedAtHour: null,
    baseline: null,
  }
  state.verification = null
  addEvent(state, 'planned', actor, 'Cleared the Operations Plan and opened a fresh draft.', [state.operationsPlan.id])
  return [state, { ok: true, planRevision: nextRevision }]
}

/**
 * Applies a complete plan-staging request to an isolated candidate state. The
 * caller receives the original state object on any stale revision or edit
 * failure, so a store can publish the candidate with one atomic write only
 * after every requested edit succeeds.
 */
export const stageOperationsPlanBatch = (
  source: MoonbaseState,
  input: StagePlanBatchInput,
  actor: 'manual' | 'agent' = 'manual',
): [MoonbaseState, StagePlanBatchResult] => {
  const result = (
    values: Partial<StagePlanBatchResult>,
  ): StagePlanBatchResult => ({
    ok: false,
    code: 'edit_failed',
    worldRevision: source.worldRevision,
    planRevision: source.operationsPlan.revision,
    currentWorldRevision: source.worldRevision,
    currentPlanRevision: source.operationsPlan.revision,
    editResults: [],
    ...values,
  })

  if (input.expectedRunId !== source.runId) {
    return [source, result({ code: 'stale_run' })]
  }
  if (
    input.expectedWorldRevision !== source.worldRevision ||
    input.expectedPlanRevision !== source.operationsPlan.revision
  ) {
    return [source, result({ code: 'stale_revision' })]
  }
  if (!operationsAreAvailable(source)) {
    const unavailable = operationsUnavailableError(source)
    return [source, result({ error: unavailable.error })]
  }

  let candidate = source
  let replaceResult: PlanEditResult | undefined
  let briefResult: PlanEditResult | undefined
  const editResults: StagePlanBatchActionResult[] = []

  if (input.mode === 'replace') {
    const [nextState, edit] = clearOperationsPlan(candidate, actor)
    replaceResult = edit
    if (!edit.ok) {
      return [source, result({ replaceResult, failedStage: 'replace', error: edit.error })]
    }
    candidate = nextState
  }

  if (input.brief) {
    const [nextState, edit] = setPlanBrief(candidate, input.brief, actor)
    briefResult = edit
    if (!edit.ok) {
      return [source, result({
        replaceResult,
        briefResult,
        failedStage: 'brief',
        error: edit.error,
      })]
    }
    candidate = nextState
  }

  for (const [actionIndex, action] of input.actions.entries()) {
    const [nextState, edit] = stagePlanAction(candidate, action, actor)
    const actionResult = { ...edit, actionIndex }
    editResults.push(actionResult)
    if (!edit.ok) {
      return [source, result({
        replaceResult,
        briefResult,
        editResults,
        failedStage: 'action',
        failedActionIndex: actionIndex,
        error: edit.error,
      })]
    }
    candidate = nextState
  }

  return [candidate, result({
    ok: true,
    code: 'staged',
    planRevision: candidate.operationsPlan.revision,
    currentPlanRevision: candidate.operationsPlan.revision,
    replaceResult,
    briefResult,
    editResults,
  })]
}

/**
 * Removes a set of staged actions from an isolated candidate and publishes no
 * intermediate plan. Any stale identity, missing action, or edit failure
 * returns the original state object so callers cannot observe a partial batch.
 */
export const removePlanActionsBatch = (
  source: MoonbaseState,
  input: RemovePlanActionsBatchInput,
  actor: 'manual' | 'agent' = 'manual',
): [MoonbaseState, RemovePlanActionsBatchResult] => {
  const result = (
    values: Partial<RemovePlanActionsBatchResult>,
  ): RemovePlanActionsBatchResult => ({
    ok: false,
    code: 'edit_failed',
    planRevision: source.operationsPlan.revision,
    currentPlanRevision: source.operationsPlan.revision,
    editResults: [],
    failures: [],
    ...values,
  })

  if (input.expectedRunId !== source.runId) {
    return [source, result({ code: 'stale_run' })]
  }
  if (input.expectedPlanRevision !== source.operationsPlan.revision) {
    return [source, result({ code: 'stale_plan' })]
  }
  if (!operationsAreAvailable(source)) {
    const unavailable = operationsUnavailableError(source)
    return [source, result({ error: unavailable.error })]
  }
  if (source.operationsPlan.status !== 'draft') {
    const error = draftError(source)
    return [source, result({ error: error.error })]
  }

  const actionIds = unique(input.actionIds)
  if (actionIds.length === 0) {
    return [source, result({ error: 'Choose at least one staged action to remove.' })]
  }

  const stagedActionIds = new Set(source.operationsPlan.actions.map((action) => action.id))
  const failures = actionIds.flatMap((actionId) => {
    const actionIndex = input.actionIds.indexOf(actionId)
    return stagedActionIds.has(actionId)
      ? []
      : [{ actionIndex, actionId, error: `Unknown plan action: ${actionId}` }]
  })
  if (failures.length > 0) {
    return [source, result({
      failures,
      error: failures[0].error,
    })]
  }

  let candidate = source
  const editResults: PlanEditResult[] = []
  for (const actionId of actionIds) {
    const [nextState, edit] = removePlanAction(candidate, actionId, actor)
    editResults.push(edit)
    if (!edit.ok) {
      return [source, result({
        editResults,
        error: edit.error,
      })]
    }
    candidate = nextState
  }

  return [candidate, result({
    ok: true,
    code: 'removed',
    planRevision: candidate.operationsPlan.revision,
    currentPlanRevision: candidate.operationsPlan.revision,
    editResults,
  })]
}

const getOrder = (state: MoonbaseState, id: WorkOrderId) =>
  state.workOrders.find((order) => order.id === id)

const activeConstructionOrderForCrew = (state: MoonbaseState, crewId: string) =>
  state.settlement.constructionOrders.find((order) => (
    order.status !== 'complete' &&
    (order.assignedCrewId === crewId || order.forcedCrewId === crewId)
  ))

const constructionOrderDescription = (
  order: MoonbaseState['settlement']['constructionOrders'][number],
) => {
  if (order.target.kind === 'workstation') {
    const workstation = order.target.construct ?? order.target.deconstruct
    return workstation?.label ?? 'a workstation blueprint'
  }
  const cell = order.target.cells[0]
  const boundary = order.target.construct ?? order.target.deconstruct
  const label = boundary?.kind === 'door' ? 'door' : 'wall'
  return `${label} blueprint at tile ${cell.x + 1}, ${cell.y + 1}`
}

const crewForOrder = (state: MoonbaseState, plan: OperationsPlan, id: WorkOrderId) => {
  const existing = getOrder(state, id)?.assignedCrewIds ?? []
  const staged = plan.actions.flatMap((action) =>
    action.kind === 'assign_crew' && action.workOrderId === id ? [action.crewId] : [],
  )
  return unique([...existing, ...staged])
}

const equipmentForOrder = (state: MoonbaseState, plan: OperationsPlan, id: WorkOrderId) => {
  const existing = getOrder(state, id)?.reservedEquipmentIds ?? []
  const staged = plan.actions.flatMap((action) =>
    action.kind === 'reserve_equipment' && action.workOrderId === id ? [action.equipmentId] : [],
  )
  return unique([...existing, ...staged])
}

const hasRequiredEquipment = (state: MoonbaseState, plan: OperationsPlan, order: WorkOrder) => {
  const reservedTypes = equipmentForOrder(state, plan, order.id)
    .map((id) => state.equipment.find((item) => item.id === id)?.type)
    .filter((type): type is EquipmentType => Boolean(type))
  return order.requiredEquipment.every((type) => reservedTypes.includes(type))
}

const orderIsConfigured = (state: MoonbaseState, plan: OperationsPlan, order: WorkOrder) =>
  crewForOrder(state, plan, order.id).length > 0 && hasRequiredEquipment(state, plan, order)

const incompleteOrderChain = (state: MoonbaseState, targetId: WorkOrderId) => {
  const orderedIds: WorkOrderId[] = []
  const visited = new Set<WorkOrderId>()

  const visit = (id: WorkOrderId) => {
    if (visited.has(id)) return
    visited.add(id)
    const order = getOrder(state, id)
    if (!order) return
    order.prerequisiteIds.forEach(visit)
    if (order.status !== 'complete') orderedIds.push(order.id)
  }

  visit(targetId)
  return orderedIds
}

const orderDependsOn = (
  state: MoonbaseState,
  candidateId: WorkOrderId,
  prerequisiteId: WorkOrderId,
) => {
  const visited = new Set<WorkOrderId>()
  const visit = (id: WorkOrderId): boolean => {
    if (visited.has(id)) return false
    visited.add(id)
    const order = getOrder(state, id)
    if (!order) return false
    return order.prerequisiteIds.some((id) => id === prerequisiteId || visit(id))
  }
  return candidateId !== prerequisiteId && visit(candidateId)
}

const estimatedCompletionTimes = (state: MoonbaseState, plan: OperationsPlan) => {
  const memo = new Map<WorkOrderId, number | null>()
  const visiting = new Set<WorkOrderId>()

  const completionFor = (id: WorkOrderId): number | null => {
    if (memo.has(id)) return memo.get(id) ?? null
    const order = getOrder(state, id)
    if (!order) return null
    if (order.status === 'complete') {
      memo.set(id, 0)
      return 0
    }
    if (!orderIsConfigured(state, plan, order) || visiting.has(id)) {
      memo.set(id, null)
      return null
    }

    visiting.add(id)
    const prerequisiteTimes = order.prerequisiteIds.map(completionFor)
    visiting.delete(id)
    if (prerequisiteTimes.some((time) => time === null)) {
      memo.set(id, null)
      return null
    }

    const assignedCrew = crewForOrder(state, plan, id)
    const reservedEquipment = equipmentForOrder(state, plan, id)
    const needsRetrieval =
      assignedCrew.some((crewId) => state.crew.find((member) => member.id === crewId)?.location !== order.location) ||
      reservedEquipment.some((equipmentId) => state.equipment.find((item) => item.id === equipmentId)?.location !== order.location)
    const prerequisitesCompleteAt = prerequisiteTimes.length > 0 ? Math.max(...(prerequisiteTimes as number[])) : 0
    const remainingWork = Math.max(0, order.durationHours - order.progressHours)
    const completion = prerequisitesCompleteAt + (needsRetrieval ? 1 : 0) + remainingWork
    memo.set(id, completion)
    return completion
  }

  state.workOrders.forEach((order) => completionFor(order.id))
  return memo
}

const forecastPlan = (state: MoonbaseState, plan: OperationsPlan) => {
  const times = estimatedCompletionTimes(state, plan)
  const objectiveCompletion = times.get('work-research-sintering') ?? null
  const milestoneTargetId = plan.stopCondition?.kind === 'work_order_complete'
    ? plan.stopCondition.workOrderId
    : null
  const affectedWorkOrderIds = unique(plan.actions.map((action) => action.workOrderId))
  const affectedTimes = affectedWorkOrderIds
    .map((id) => times.get(id))
    .filter((time): time is number => typeof time === 'number')
  const estimatedCompletionHours = milestoneTargetId
    ? times.get(milestoneTargetId) ?? null
    : plan.objective === 'restore_lab_and_research_sintering'
      ? objectiveCompletion
      : affectedTimes.length > 0
        ? Math.max(...affectedTimes)
        : null
  const safeHorizon = Math.max(1, Math.min(MAX_ADVANCE_HOURS, Math.round(boundedNumber(plan.horizonHours, MAX_ADVANCE_HOURS))))
  const forecastHours = Math.min(safeHorizon, estimatedCompletionHours ?? safeHorizon)
  const sealCompleteAt = times.get('work-seal-lab') ?? null
  const repressurizeCompleteAt = times.get('work-repressurize-lab') ?? null
  const researchCompleteAt = times.get('work-research-sintering') ?? null
  const cleanCompleteAt = times.get('work-clean-solar') ?? null

  let oxygen = state.reserves.oxygenHours
  let battery = state.power.batteryKwh
  for (let hour = 1; hour <= forecastHours; hour += 1) {
    oxygen -= 0.35
    if (state.lab.breached && (sealCompleteAt === null || hour <= sealCompleteAt)) oxygen -= 1.25
    if (repressurizeCompleteAt !== null && (hour === repressurizeCompleteAt - 1 || hour === repressurizeCompleteAt)) {
      oxygen -= 2
    }

    const dustActive = state.elapsedHours + hour >= state.dust.startsAtHour
    const dustMitigated = cleanCompleteAt !== null && hour > cleanCompleteAt
    const derate = !dustActive ? 0 : dustMitigated ? state.dust.mitigatedDeratePercent : state.dust.baseDeratePercent
    const generation = 24 * (1 - derate / 100)
    const researchStartsAt = researchCompleteAt === null ? null : researchCompleteAt - 2
    const researchActive = researchStartsAt !== null && hour >= researchStartsAt && hour <= researchCompleteAt!
    const demand = 18 + (researchActive ? 4 : 0)
    battery = Math.max(0, Math.min(state.power.batteryCapacityKwh, battery + generation - demand))
  }

  return {
    affectedWorkOrderIds,
    assignedCrewIds: unique(
      plan.actions.filter((action) => action.kind === 'assign_crew').map((action) => action.crewId),
    ),
    reservedEquipmentIds: unique(
      plan.actions.filter((action) => action.kind === 'reserve_equipment').map((action) => action.equipmentId),
    ),
    estimatedCompletionHours,
    projectedOxygenHours: round(oxygen),
    projectedBatteryKwh: round(battery),
  }
}

const validateStopCondition = (condition: StopCondition | null) => {
  if (!condition) return false
  if (condition.kind === 'oxygen_below') return Number.isFinite(condition.thresholdHours) && condition.thresholdHours >= 0
  if (condition.kind === 'battery_below') return Number.isFinite(condition.thresholdKwh) && condition.thresholdKwh >= 0
  if (condition.kind === 'work_order_complete') return typeof condition.workOrderId === 'string'
  return condition.kind === 'objective_complete' || condition.kind === 'critical_alert'
}

export const validateOperationsPlan = (state: MoonbaseState): PlanValidation => {
  const plan = state.operationsPlan
  const issues: ValidationIssue[] = []
  const issue = (entry: ValidationIssue) => issues.push(entry)

  if (!operationsAreAvailable(state)) {
    issue({
      code: 'operations_not_ready',
      severity: 'error',
      message: `Operations are unavailable while the settlement phase is ${state.settlement.phase}. Complete base construction and begin operations first.`,
      targetId: plan.id,
    })
  }

  if (plan.objective !== 'restore_lab_and_research_sintering') {
    issue({ code: 'missing_objective', severity: 'error', message: 'Choose the laboratory recovery objective.' })
  }
  if (!validateStopCondition(plan.stopCondition)) {
    issue({ code: 'missing_stop_condition', severity: 'error', message: 'Choose a valid bounded stop condition.' })
  }
  if (
    !Number.isInteger(plan.horizonHours) ||
    plan.horizonHours < 1 ||
    plan.horizonHours > MAX_ADVANCE_HOURS
  ) {
    issue({ code: 'invalid_horizon', severity: 'error', message: `Plan horizon must be between 1 and ${MAX_ADVANCE_HOURS} hours.` })
  }
  if (
    !Number.isFinite(plan.constraints.oxygenFloorHours) ||
    plan.constraints.oxygenFloorHours < 1 ||
    plan.constraints.oxygenFloorHours > state.reserves.oxygenHours
  ) {
    issue({
      code: 'invalid_oxygen_floor',
      severity: 'error',
      message: 'Oxygen floor must be positive and no higher than the current reserve.',
    })
  }
  if (plan.basedOnWorldRevision !== state.worldRevision) {
    issue({
      code: 'stale_world_revision',
      severity: 'error',
      message: `Plan is based on world revision ${plan.basedOnWorldRevision}, but the current revision is ${state.worldRevision}.`,
    })
  }
  if (plan.actions.length === 0) {
    issue({ code: 'no_actions', severity: 'error', message: 'Stage at least one crew, equipment, or priority action.' })
  }
  for (const protectedCrewId of plan.constraints.protectedCrewIds) {
    if (!state.crew.some((member) => member.id === protectedCrewId)) {
      issue({
        code: 'unknown_crew',
        severity: 'error',
        message: `Unknown protected crew member: ${protectedCrewId}`,
        targetId: protectedCrewId,
      })
    }
  }
  if (plan.stopCondition?.kind === 'work_order_complete') {
    const target = getOrder(state, plan.stopCondition.workOrderId)
    if (!target) {
      issue({
        code: 'unknown_work_order',
        severity: 'error',
        message: `Unknown stop-condition work order: ${plan.stopCondition.workOrderId}`,
        targetId: plan.stopCondition.workOrderId,
      })
    } else if (target.status === 'complete') {
      issue({
        code: 'closed_work_order',
        severity: 'error',
        message: `${target.label} is already complete; choose the next incomplete milestone.`,
        targetId: target.id,
      })
    }
  }

  const crewAssignments = new Map<string, WorkOrderId[]>()
  const equipmentReservations = new Map<string, WorkOrderId[]>()

  for (const action of plan.actions) {
    const order = getOrder(state, action.workOrderId)
    if (!order) {
      issue({
        code: 'unknown_work_order',
        severity: 'error',
        message: `Unknown work order: ${action.workOrderId}`,
        actionId: action.id,
        targetId: action.workOrderId,
      })
      continue
    }
    if (order.status === 'complete') {
      issue({
        code: 'closed_work_order',
        severity: 'error',
        message: `${order.label} is already complete.`,
        actionId: action.id,
        targetId: order.id,
      })
    }

    if (action.kind === 'assign_crew') {
      const member = state.crew.find((candidate) => candidate.id === action.crewId)
      if (!member) {
        issue({
          code: 'unknown_crew',
          severity: 'error',
          message: `Unknown crew member: ${action.crewId}`,
          actionId: action.id,
          targetId: action.crewId,
        })
        continue
      }
      crewAssignments.set(member.id, [...(crewAssignments.get(member.id) ?? []), order.id])
      const constructionOrder = activeConstructionOrderForCrew(state, member.id)
      if (constructionOrder) {
        issue({
          code: 'crew_conflict',
          severity: 'error',
          message: `${member.name} is already assigned to ${constructionOrderDescription(constructionOrder)}. Finish or cancel that construction order before assigning incident work.`,
          actionId: action.id,
          targetId: member.id,
        })
      }
      if (member.taskId && member.taskId !== order.id) {
        issue({
          code: 'crew_conflict',
          severity: 'error',
          message: `${member.name} is already assigned to ${member.taskId}.`,
          actionId: action.id,
          targetId: member.id,
        })
      }
      if (plan.constraints.protectedCrewIds.includes(member.id) && order.hazard !== 'indoor') {
        issue({
          code: 'protected_crew_hazard',
          severity: 'error',
          message: `${member.name} is protected from ${order.hazard} work by this plan.`,
          actionId: action.id,
          targetId: member.id,
        })
      }
      if (member.skills[order.requiredSkill] < order.minimumSkill) {
        issue({
          code: 'insufficient_skill',
          severity: 'error',
          message: `${member.name} needs ${order.requiredSkill} ${order.minimumSkill} for ${order.label}.`,
          actionId: action.id,
          targetId: member.id,
        })
      }
    }

    if (action.kind === 'reserve_equipment') {
      const equipment = state.equipment.find((candidate) => candidate.id === action.equipmentId)
      if (!equipment) {
        issue({
          code: 'unknown_equipment',
          severity: 'error',
          message: `Unknown equipment: ${action.equipmentId}`,
          actionId: action.id,
          targetId: action.equipmentId,
        })
        continue
      }
      equipmentReservations.set(equipment.id, [...(equipmentReservations.get(equipment.id) ?? []), order.id])
      if (
        equipment.type === 'eva_suit' &&
        equipment.status === 'deployed' &&
        equipment.assignedCrewId &&
        !equipment.reservedForWorkOrderId
      ) {
        const wearer = state.crew.find((candidate) => candidate.id === equipment.assignedCrewId)
        issue({
          code: 'equipment_conflict',
          severity: 'error',
          message: `${equipment.name} is currently worn by ${wearer?.name ?? equipment.assignedCrewId} for construction EVA. Bring that colonist inside before reserving it.`,
          actionId: action.id,
          targetId: equipment.id,
        })
      }
      if (equipment.reservedForWorkOrderId && equipment.reservedForWorkOrderId !== order.id) {
        issue({
          code: 'equipment_conflict',
          severity: 'error',
          message: `${equipment.name} is already reserved for ${equipment.reservedForWorkOrderId}.`,
          actionId: action.id,
          targetId: equipment.id,
        })
      }
      if (equipment.condition < 65) {
        issue({
          code: 'equipment_condition',
          severity: 'error',
          message: `${equipment.name} condition is below the 65% incident-work floor.`,
          actionId: action.id,
          targetId: equipment.id,
        })
      }
      if (!order.requiredEquipment.includes(equipment.type)) {
        issue({
          code: 'wrong_equipment_type',
          severity: 'error',
          message: `${equipment.name} is not required for ${order.label}.`,
          actionId: action.id,
          targetId: equipment.id,
        })
      }
    }
  }

  for (const [crewId, orders] of crewAssignments) {
    if (unique(orders).length > 1) {
      issue({
        code: 'crew_conflict',
        severity: 'error',
        message: `${crewId} cannot be assigned to multiple simultaneous work orders.`,
        targetId: crewId,
      })
    }
  }
  for (const [equipmentId, orders] of equipmentReservations) {
    if (unique(orders).length > 1) {
      issue({
        code: 'equipment_conflict',
        severity: 'error',
        message: `${equipmentId} cannot be reserved for multiple work orders.`,
        targetId: equipmentId,
      })
    }
  }

  const affected = unique(plan.actions.map((action) => action.workOrderId))
  const milestoneTargetId = plan.stopCondition?.kind === 'work_order_complete'
    ? plan.stopCondition.workOrderId
    : null
  if (milestoneTargetId && getOrder(state, milestoneTargetId)) {
    for (const orderId of affected) {
      if (!orderDependsOn(state, orderId, milestoneTargetId)) continue
      const order = getOrder(state, orderId)
      const target = getOrder(state, milestoneTargetId)
      if (!order || !target) continue
      issue({
        code: 'milestone_scope',
        severity: 'error',
        message: `${order.label} occurs after the declared ${target.label} milestone and belongs in a later plan.`,
        targetId: order.id,
      })
    }
  }
  const requiredObjectiveOrders = milestoneTargetId && getOrder(state, milestoneTargetId)
    ? incompleteOrderChain(state, milestoneTargetId)
    : plan.objective === 'restore_lab_and_research_sintering'
      ? OBJECTIVE_WORK_ORDER_IDS
      : []
  const ordersToConfigure = unique([
    ...affected,
    ...requiredObjectiveOrders,
  ])
  for (const orderId of ordersToConfigure) {
    const order = getOrder(state, orderId)
    if (!order || order.status === 'complete') continue
    if (crewForOrder(state, plan, order.id).length === 0) {
      issue({
        code: 'missing_crew',
        severity: 'error',
        message: `${order.label} needs an assigned crew member.`,
        targetId: order.id,
      })
    }
    const reservedTypes = equipmentForOrder(state, plan, order.id)
      .map((id) => state.equipment.find((item) => item.id === id)?.type)
      .filter((type): type is EquipmentType => Boolean(type))
    for (const requiredType of order.requiredEquipment) {
      if (!reservedTypes.includes(requiredType)) {
        issue({
          code: 'missing_equipment',
          severity: 'error',
          message: `${order.label} needs a reserved ${requiredType.replaceAll('_', ' ')}.`,
          targetId: order.id,
        })
      }
    }
    const evaSuitCount = reservedTypes.filter((type) => type === 'eva_suit').length
    const assignedCrewCount = crewForOrder(state, plan, order.id).length
    if (
      order.requiredEquipment.includes('eva_suit') &&
      evaSuitCount > 0 &&
      evaSuitCount < assignedCrewCount
    ) {
      issue({
        code: 'missing_equipment',
        severity: 'error',
        message: `${order.label} needs one reserved EVA suit per exposed crew member (${assignedCrewCount} crew, ${evaSuitCount} suits).`,
        targetId: order.id,
      })
    }
  }

  const preview = forecastPlan(state, plan)
  if (
    preview.estimatedCompletionHours !== null &&
    Number.isFinite(plan.horizonHours) &&
    preview.estimatedCompletionHours > plan.horizonHours
  ) {
    issue({
      code: 'invalid_horizon',
      severity: 'error',
      message: `Forecast needs ${preview.estimatedCompletionHours} hours, beyond the ${plan.horizonHours}-hour plan horizon.`,
    })
  }
  if (preview.projectedOxygenHours < plan.constraints.oxygenFloorHours) {
    issue({
      code: 'oxygen_projection',
      severity: 'error',
      message: `Projected oxygen is ${preview.projectedOxygenHours} hours, below the ${plan.constraints.oxygenFloorHours}-hour floor.`,
    })
  }
  if (preview.projectedBatteryKwh <= 0) {
    const forecastTarget = milestoneTargetId ? 'the declared milestone' : 'the objective'
    issue({
      code: 'power_projection',
      severity: 'error',
      message: `The forecast exhausts the battery before ${forecastTarget} completes; mitigate the dust loss.`,
      targetId: 'work-clean-solar',
    })
  } else if (preview.projectedBatteryKwh < 8) {
    issue({
      code: 'power_projection',
      severity: 'warning',
      message: `Projected battery reserve is only ${preview.projectedBatteryKwh} kWh.`,
      targetId: 'module-solar-skid',
    })
  }

  return {
    valid: !issues.some((candidate) => candidate.severity === 'error'),
    worldRevision: state.worldRevision,
    planRevision: plan.revision,
    issues,
    preview,
  }
}

const orderPrerequisitesComplete = (state: MoonbaseState, order: WorkOrder) =>
  order.prerequisiteIds.every((id) => getOrder(state, id)?.status === 'complete')

const calculateLogisticsHours = (state: MoonbaseState, order: WorkOrder) => {
  const crewAway = order.assignedCrewIds.some(
    (crewId) => state.crew.find((member) => member.id === crewId)?.location !== order.location,
  )
  const equipmentAway = order.reservedEquipmentIds.some(
    (equipmentId) => state.equipment.find((item) => item.id === equipmentId)?.location !== order.location,
  )
  return crewAway || equipmentAway ? 1 : 0
}

export const commitOperationsPlan = (
  source: MoonbaseState,
  expectedWorldRevision: number,
  expectedPlanRevision: number,
  actor: 'manual' | 'agent' = 'manual',
): [MoonbaseState, CommitResult] => {
  if (!operationsAreAvailable(source)) {
    return [
      source,
      {
        ok: false,
        code: 'invalid_plan',
        worldRevision: source.worldRevision,
        planRevision: source.operationsPlan.revision,
        validation: validateOperationsPlan(source),
      },
    ]
  }
  const state = cloneState(source)
  const validation = validateOperationsPlan(state)
  const result = (code: CommitResult['code']): [MoonbaseState, CommitResult] => [
    state,
    {
      ok: code === 'committed',
      code,
      worldRevision: state.worldRevision,
      planRevision: state.operationsPlan.revision,
      validation,
    },
  ]

  if (state.operationsPlan.status !== 'draft') return result('plan_not_draft')
  if (expectedWorldRevision !== state.worldRevision || state.operationsPlan.basedOnWorldRevision !== state.worldRevision) {
    return result('stale_world')
  }
  if (expectedPlanRevision !== state.operationsPlan.revision) return result('stale_plan')
  if (!validation.valid) return result('invalid_plan')

  for (const action of state.operationsPlan.actions) {
    const order = getOrder(state, action.workOrderId)
    if (!order) continue
    if (action.kind === 'set_priority') order.priority = action.priority
    if (action.kind === 'assign_crew') {
      const member = state.crew.find((candidate) => candidate.id === action.crewId)
      if (!member) continue
      order.assignedCrewIds = unique([...order.assignedCrewIds, member.id])
      member.taskId = order.id
      member.status = 'assigned'
    }
    if (action.kind === 'reserve_equipment') {
      const equipment = state.equipment.find((candidate) => candidate.id === action.equipmentId)
      if (!equipment) continue
      order.reservedEquipmentIds = unique([...order.reservedEquipmentIds, equipment.id])
      equipment.reservedForWorkOrderId = order.id
      equipment.status = 'reserved'
    }
  }

  for (const order of state.workOrders.filter((candidate) => candidate.status !== 'complete')) {
    if (order.assignedCrewIds.length === 0) continue
    order.logisticsHoursRemaining = calculateLogisticsHours(state, order)
    order.status = orderPrerequisitesComplete(state, order) ? 'queued' : 'blocked'
    const evaSuitCrewIds = [...order.assignedCrewIds]
    for (const equipmentId of order.reservedEquipmentIds) {
      const equipment = state.equipment.find((candidate) => candidate.id === equipmentId)
      if (!equipment) continue
      equipment.assignedCrewId = equipment.type === 'eva_suit'
        ? evaSuitCrewIds.shift() ?? null
        : order.assignedCrewIds[0] ?? null
    }
  }

  const researchOrder = getOrder(state, 'work-research-sintering')
  state.research.assignedResearcherId = researchOrder?.assignedCrewIds[0] ?? null
  state.operationsPlan.status = 'committed'
  state.operationsPlan.committedAtHour = state.elapsedHours
  state.operationsPlan.revision += 1
  state.worldRevision += 1
  state.operationsPlan.baseline = {
    worldRevision: state.worldRevision,
    elapsedHours: state.elapsedHours,
    oxygenHours: state.reserves.oxygenHours,
    batteryKwh: state.power.batteryKwh,
    completedWorkOrderIds: state.workOrders
      .filter((order) => order.status === 'complete')
      .map((order) => order.id),
  }
  state.verification = null
  addLearningEvidence(state, 'plan', 'Committed a validated, revision-checked Operations Plan.', actor)
  addEvent(
    state,
    'changed',
    actor,
    `Committed Operations Plan revision ${expectedPlanRevision} with ${state.operationsPlan.actions.length} staged actions.`,
    [state.operationsPlan.id, ...validation.preview.affectedWorkOrderIds],
  )
  state.alerts = deriveAlerts(state)

  return [
    state,
    {
      ok: true,
      code: 'committed',
      worldRevision: state.worldRevision,
      planRevision: state.operationsPlan.revision,
      validation,
    },
  ]
}

const syncLaboratoryModule = (state: MoonbaseState) => {
  const module = state.modules.find((candidate) => candidate.id === state.lab.moduleId)
  if (!module) return
  module.atmosphere = state.lab.atmosphere
  module.breached = state.lab.breached
}

const releaseCompletedOrder = (state: MoonbaseState, order: WorkOrder) => {
  const returnedThroughAirlock = order.hazard !== 'indoor'
  for (const equipmentId of order.reservedEquipmentIds) {
    const equipment = state.equipment.find((candidate) => candidate.id === equipmentId)
    if (!equipment || equipment.reservedForWorkOrderId !== order.id) continue
    if (returnedThroughAirlock) equipment.location = 'airlock'
    equipment.status = 'available'
    equipment.reservedForWorkOrderId = null
    equipment.assignedCrewId = null
    equipment.condition = Math.max(0, equipment.condition - (order.hazard === 'indoor' ? 1 : 2))
  }
  for (const crewId of order.assignedCrewIds) {
    const member = state.crew.find((candidate) => candidate.id === crewId)
    if (!member || member.taskId !== order.id) continue
    if (returnedThroughAirlock) member.location = 'airlock'
    member.equippedEvaSuitId = null
    member.taskId = null
    member.status = member.fatigue >= 75 ? 'resting' : 'idle'
  }
  return returnedThroughAirlock
}

const completeOrder = (state: MoonbaseState, order: WorkOrder) => {
  order.status = 'complete'
  order.progressHours = order.durationHours
  order.completedAtHour = state.elapsedHours

  if (order.type === 'seal_breach') {
    state.lab.breached = false
    state.lab.sealed = true
    const labModule = state.modules.find((module) => module.id === state.lab.moduleId)
    if (labModule) labModule.condition = Math.max(labModule.condition, 72)
  }
  if (order.type === 'repressurize_lab') {
    state.lab.atmosphere = 'yes'
    const labModule = state.modules.find((module) => module.id === state.lab.moduleId)
    if (labModule) labModule.condition = Math.max(labModule.condition, 76)
  }
  if (order.type === 'clean_solar') {
    state.dust.mitigated = true
    const solarModule = state.modules.find((module) => module.id === 'module-solar-skid')
    if (solarModule) solarModule.condition = Math.min(100, solarModule.condition + 8)
  }
  if (order.type === 'research') {
    state.research.status = 'complete'
    state.research.progressHours = state.research.requiredHours
    state.research.unlocks = ['production-microwave-sintering']
  }

  const returnedThroughAirlock = releaseCompletedOrder(state, order)
  syncLaboratoryModule(state)
  if (returnedThroughAirlock) {
    addEvent(
      state,
      'changed',
      'simulation',
      `Crew returned through South Airlock and doffed EVA gear after ${order.label}.`,
      [order.id, 'module-airlock'],
    )
  }
  addEvent(state, 'changed', 'simulation', `Completed: ${order.label}.`, [order.id])
}

const equipmentSatisfied = (state: MoonbaseState, order: WorkOrder) => {
  const reserved = order.reservedEquipmentIds
    .map((id) => state.equipment.find((item) => item.id === id))
    .filter((item) => Boolean(item))
  const requiredTypesPresent = order.requiredEquipment.every((type) =>
    reserved.some((item) => item?.type === type && item.reservedForWorkOrderId === order.id),
  )
  if (!requiredTypesPresent) return false
  if (!order.requiredEquipment.includes('eva_suit')) return true
  return reserved.filter((item) => (
    item?.type === 'eva_suit' && item.reservedForWorkOrderId === order.id
  )).length >= order.assignedCrewIds.length
}

const atmosphereAtCrewLocation = (state: MoonbaseState, member: CrewMember) => (
  state.modules.find((module) => module.location === member.location)?.atmosphere ?? 'no'
)

const constructionCrewOutsidePressure = (state: MoonbaseState) => {
  const pressure = analyzeConstructionPressure(state.settlement.layout)
  const semanticEvaCellKeys = constructionSemanticEvaCellKeys(
    state.modules,
    state.settlement.layout,
    state.lab.atmosphere,
  )
  const activeConstructionCrewIds = new Set(
    state.settlement.constructionOrders
      .filter((order) => order.status !== 'complete' && order.assignedCrewId)
      .map((order) => order.assignedCrewId!),
  )
  return new Set(state.settlement.constructionCrew.flatMap((position) => (
    (state.settlement.phase === 'operations' && !activeConstructionCrewIds.has(position.crewId)) ||
    (
      constructionEnvironmentAt(state.settlement.layout, pressure, position.cell) === 'pressurized' &&
      !semanticEvaCellKeys.has(`${position.cell.x}:${position.cell.y}`)
    )
      ? []
      : [position.crewId]
  )))
}

const prepareOrdersForHour = (state: MoonbaseState) => {
  const eligible = new Set<WorkOrderId>()

  for (const member of state.crew) {
    if (!member.taskId && atmosphereAtCrewLocation(state, member) === 'yes') {
      member.equippedEvaSuitId = null
    }
    if (member.taskId) member.status = 'assigned'
    else if (member.status !== 'resting') member.status = 'idle'
  }

  const ordered = [...state.workOrders].sort((a, b) => b.priority - a.priority)
  for (const order of ordered) {
    if (order.status === 'complete') continue
    if (!orderPrerequisitesComplete(state, order)) {
      order.status = 'blocked'
      continue
    }
    if (order.assignedCrewIds.length === 0) {
      order.status = 'ready'
      continue
    }
    if (!equipmentSatisfied(state, order)) {
      order.status = 'paused'
      continue
    }

    order.status = 'active'
    order.startedAtHour ??= state.elapsedHours
    for (const crewId of order.assignedCrewIds) {
      const member = state.crew.find((candidate) => candidate.id === crewId)
      if (member) member.status = 'working'
    }

    if (order.logisticsHoursRemaining > 0) {
      for (const equipmentId of order.reservedEquipmentIds) {
        const equipment = state.equipment.find((candidate) => candidate.id === equipmentId)
        if (equipment) equipment.status = 'in_transit'
      }
      order.logisticsHoursRemaining -= 1
      if (order.logisticsHoursRemaining === 0) {
        for (const crewId of order.assignedCrewIds) {
          const member = state.crew.find((candidate) => candidate.id === crewId)
          if (member) {
            member.location = order.location
            const suit = order.reservedEquipmentIds
              .map((equipmentId) => state.equipment.find((candidate) => candidate.id === equipmentId))
              .find((equipment) => (
                equipment?.type === 'eva_suit' && equipment.assignedCrewId === member.id
              ))
            member.equippedEvaSuitId = suit?.id ?? null
          }
        }
        for (const equipmentId of order.reservedEquipmentIds) {
          const equipment = state.equipment.find((candidate) => candidate.id === equipmentId)
          if (equipment) {
            equipment.location = order.location
            equipment.status = 'deployed'
          }
        }
        const transit = order.location === 'solar-skid' || order.location === 'landing-pad'
          ? 'Crew cycled South Airlock in EVA suits and reached'
          : order.requiredEquipment.includes('eva_suit')
            ? 'Crew crossed the pressure boundary in EVA suits and reached'
            : 'Equipment and crew reached'
        addEvent(state, 'changed', 'simulation', `${transit} ${order.label}.`, [order.id])
      }
      continue
    }

    for (const equipmentId of order.reservedEquipmentIds) {
      const equipment = state.equipment.find((candidate) => candidate.id === equipmentId)
      if (equipment) equipment.status = 'deployed'
    }
    for (const crewId of order.assignedCrewIds) {
      const member = state.crew.find((candidate) => candidate.id === crewId)
      if (!member) continue
      const suit = order.reservedEquipmentIds
        .map((equipmentId) => state.equipment.find((candidate) => candidate.id === equipmentId))
        .find((equipment) => (
          equipment?.type === 'eva_suit' && equipment.assignedCrewId === member.id
        ))
      member.equippedEvaSuitId = suit?.id ?? (
        atmosphereAtCrewLocation(state, member) === 'yes'
          ? null
          : member.equippedEvaSuitId ?? null
      )
    }
    eligible.add(order.id)
  }
  return eligible
}

const updatePowerForHour = (state: MoonbaseState, researchNeedsPower: boolean) => {
  if (state.elapsedHours >= state.dust.startsAtHour) state.dust.active = true
  const derate = !state.dust.active
    ? 0
    : state.dust.mitigated
      ? state.dust.mitigatedDeratePercent
      : state.dust.baseDeratePercent
  const generation = 24 * (1 - derate / 100)
  const demand = 18 + (researchNeedsPower ? 4 : 0)
  const priorBattery = state.power.batteryKwh
  const supported = generation + priorBattery >= demand
  const nextBattery = Math.max(0, Math.min(state.power.batteryCapacityKwh, priorBattery + generation - demand))

  state.power.solarGenerationKw = 24
  state.power.demandKw = demand
  state.power.batteryKwh = round(nextBattery)
  state.power.dustDeratePercent = derate
  state.power.status = generation >= demand ? 'surplus' : nextBattery > 0 ? 'battery' : 'critical'
  return supported
}

const updateResearchState = (state: MoonbaseState) => {
  const order = getOrder(state, 'work-research-sintering')
  if (!order) return
  state.research.progressHours = Math.min(state.research.requiredHours, order.progressHours)
  state.research.assignedResearcherId = order.assignedCrewIds[0] ?? null
  if (order.status === 'complete') {
    state.research.status = 'complete'
    return
  }
  if (state.lab.atmosphere !== 'yes') {
    state.research.status = 'blocked'
    return
  }
  state.research.status = order.status === 'active' ? 'active' : 'available'
}

const progressOrders = (state: MoonbaseState, eligible: Set<WorkOrderId>, powerSupported: boolean) => {
  const ordered = [...state.workOrders].sort((a, b) => b.priority - a.priority)
  for (const order of ordered) {
    if (!eligible.has(order.id) || order.status === 'complete') continue
    if ((order.type === 'repressurize_lab' || order.type === 'research') && !powerSupported) {
      order.status = 'paused'
      continue
    }

    const previousProgress = order.progressHours
    order.progressHours = Math.min(order.durationHours, order.progressHours + 1)

    if (order.type === 'repressurize_lab' && previousProgress < 1 && order.progressHours >= 1) {
      state.lab.atmosphere = 'low'
      state.reserves.oxygenHours = Math.max(0, state.reserves.oxygenHours - 2)
      syncLaboratoryModule(state)
      addEvent(state, 'changed', 'simulation', 'Kepler Laboratory reached low pressure; pressure testing continues.', [order.id])
    }
    if (order.type === 'repressurize_lab' && order.progressHours >= order.durationHours) {
      state.reserves.oxygenHours = Math.max(0, state.reserves.oxygenHours - 2)
    }

    if (order.progressHours >= order.durationHours) completeOrder(state, order)
  }
}

const updateCrewCondition = (state: MoonbaseState) => {
  const constructionExposedCrewIds = constructionCrewOutsidePressure(state)
  for (const member of state.crew) {
    if (
      (atmosphereAtCrewLocation(state, member) !== 'yes' ||
        constructionExposedCrewIds.has(member.id)) &&
      !member.equippedEvaSuitId
    ) {
      member.health = Math.max(0, member.health - 35)
    }
    if (member.status === 'working') member.fatigue = Math.min(100, member.fatigue + 3)
    else if (member.status === 'assigned') member.fatigue = Math.min(100, member.fatigue + 1)
    else member.fatigue = Math.max(0, member.fatigue - 2)
  }
}

export const deriveAlerts = (state: MoonbaseState): AlertState[] => {
  const alerts: AlertState[] = []
  const constructionExposedCrewIds = constructionCrewOutsidePressure(state)
  const exposedCrew = state.crew.filter((member) => (
    (atmosphereAtCrewLocation(state, member) !== 'yes' ||
      constructionExposedCrewIds.has(member.id)) &&
    !member.equippedEvaSuitId
  ))
  if (exposedCrew.length > 0) {
    alerts.push({
      id: 'alert-unprotected-crew',
      severity: 'critical',
      title: 'Unprotected crew in vacuum',
      detail: `${exposedCrew.map((member) => member.name).join(', ')} ${exposedCrew.length === 1 ? 'is' : 'are'} outside breathable atmosphere without a sealed EVA suit.`,
    })
  }
  const effectiveGeneration = state.power.solarGenerationKw * (1 - state.power.dustDeratePercent / 100)
  if (state.lab.breached) {
    alerts.push({
      id: 'alert-lab-breach',
      severity: 'critical',
      title: 'Laboratory pressure: No',
      detail: 'The micrometeorite puncture is still open; oxygen loss continues until it is sealed.',
    })
  } else if (state.lab.atmosphere === 'no') {
    alerts.push({
      id: 'alert-lab-vacuum',
      severity: 'warning',
      title: 'Laboratory sealed, still at vacuum',
      detail: 'Complete controlled repressurization before assigning indoor research.',
    })
  } else if (state.lab.atmosphere === 'low') {
    alerts.push({
      id: 'alert-lab-low-pressure',
      severity: 'warning',
      title: 'Laboratory pressure: Low',
      detail: 'Repressurization is in progress; the laboratory is not yet safe for research.',
    })
  }

  if (!state.dust.active) {
    const eta = Math.max(0, state.dust.startsAtHour - state.elapsedHours)
    alerts.push({
      id: 'alert-dust-forecast',
      severity: 'warning',
      title: `Dust front in ${eta} ${eta === 1 ? 'hour' : 'hours'}`,
      detail: 'Unmitigated dust will push solar output below base demand.',
    })
  } else if (!state.dust.mitigated) {
    alerts.push({
      id: 'alert-dust-active',
      severity: 'warning',
      title: `Dust derate: ${round(state.power.dustDeratePercent)}%`,
      detail: `${round(effectiveGeneration)} kW solar output is carrying ${state.power.demandKw} kW demand while priority surfaces remain obscured.`,
    })
  }

  if (state.power.status === 'critical') {
    alerts.push({
      id: 'alert-power-critical',
      severity: 'critical',
      title: 'Battery reserve exhausted',
      detail: 'Powered work is paused until generation meets demand.',
    })
  } else if (effectiveGeneration < state.power.demandKw) {
    alerts.push({
      id: 'alert-power-battery',
      severity: state.power.batteryKwh < 8 ? 'critical' : 'warning',
      title: `Battery supporting ${round(state.power.demandKw - effectiveGeneration)} kW deficit`,
      detail: `${state.power.batteryKwh} kWh remains in the battery skid.`,
    })
  }

  const oxygenFloor = state.operationsPlan.objective
    ? state.operationsPlan.constraints.oxygenFloorHours
    : state.objective.recommendedOxygenFloorHours
  if (state.reserves.oxygenHours <= oxygenFloor) {
    alerts.push({
      id: 'alert-oxygen-floor',
      severity: 'critical',
      title: `Oxygen reserve at ${state.reserves.oxygenHours} hours`,
      detail: `The declared plan floor is ${oxygenFloor} hours.`,
    })
  } else if (state.reserves.oxygenHours <= oxygenFloor + 4) {
    alerts.push({
      id: 'alert-oxygen-margin',
      severity: 'warning',
      title: `Oxygen margin: ${round(state.reserves.oxygenHours - oxygenFloor)} hours`,
      detail: 'Stop before the reserve crosses the committed floor.',
    })
  }

  if (state.scenarioStatus === 'objective_complete') {
    alerts.push({
      id: 'alert-objective-complete',
      severity: 'info',
      title: 'Regolith Sintering unlocked',
      detail: 'Verify the laboratory, oxygen-floor, stop-condition, and power evidence against the plan.',
    })
  }
  return alerts
}

const stepOneHour = (source: MoonbaseState) => {
  const state = cloneState(source)
  state.elapsedHours += 1
  state.hour += 1
  if (state.hour >= 24) {
    state.hour = 0
    state.missionDay += 1
  }
  state.worldRevision += 1

  const dustWasActive = state.dust.active
  if (state.elapsedHours >= state.dust.startsAtHour) state.dust.active = true
  if (!dustWasActive && state.dust.active) {
    addEvent(state, 'changed', 'simulation', 'The forecast dust front reached Shackleton Relay.', ['module-solar-skid'])
  }

  state.reserves.oxygenHours = Math.max(0, state.reserves.oxygenHours - 0.35 - (state.lab.breached ? 1.25 : 0))
  state.reserves.waterDays = Math.max(0, state.reserves.waterDays - 0.015)
  state.reserves.foodDays = Math.max(0, state.reserves.foodDays - 0.012)

  const eligible = prepareOrdersForHour(state)
  const powerSupported = updatePowerForHour(state, eligible.has('work-research-sintering'))
  progressOrders(state, eligible, powerSupported)
  updateCrewCondition(state)
  updateResearchState(state)

  // Research power is consumed for the completion hour, but the live end-of-hour
  // telemetry should release that load once the work is complete.
  if (state.research.status === 'complete' && state.power.demandKw > 18) {
    const generation = state.power.solarGenerationKw * (1 - state.power.dustDeratePercent / 100)
    state.power.demandKw = 18
    state.power.status = generation >= state.power.demandKw
      ? 'surplus'
      : state.power.batteryKwh > 0
        ? 'battery'
        : 'critical'
  }

  state.reserves.oxygenHours = round(state.reserves.oxygenHours)
  state.reserves.minimumOxygenHours = Math.min(state.reserves.minimumOxygenHours, state.reserves.oxygenHours)
  state.reserves.waterDays = round(state.reserves.waterDays, 2)
  state.reserves.foodDays = round(state.reserves.foodDays, 2)
  syncLaboratoryModule(state)

  const objectiveMet = state.lab.atmosphere === 'yes' && state.research.status === 'complete'
  if (objectiveMet && state.scenarioStatus !== 'objective_complete') {
    state.scenarioStatus = 'objective_complete'
    if (state.operationsPlan.status === 'committed') {
      state.operationsPlan.status = 'completed'
      state.operationsPlan.revision += 1
    }
    addEvent(state, 'changed', 'simulation', 'Scenario objective complete: laboratory restored and Regolith Sintering unlocked.', [
      'module-laboratory',
      'research-regolith-sintering',
    ])
  }
  if (state.reserves.oxygenHours <= 0) state.scenarioStatus = 'failed'
  state.alerts = deriveAlerts(state)
  return state
}

const explicitStopReason = (
  state: MoonbaseState,
  condition: StopCondition | null,
  completedThisAdvance: WorkOrderId[],
  initialCriticalIds: Set<string>,
): StopReason | null => {
  if (!condition) return null
  if (condition.kind === 'objective_complete' && state.scenarioStatus === 'objective_complete') return 'objective_complete'
  if (condition.kind === 'oxygen_below' && state.reserves.oxygenHours < condition.thresholdHours) return 'oxygen_below'
  if (condition.kind === 'battery_below' && state.power.batteryKwh < condition.thresholdKwh) return 'battery_below'
  if (
    condition.kind === 'critical_alert' &&
    state.alerts.some((alert) => alert.severity === 'critical' && !initialCriticalIds.has(alert.id))
  ) {
    return 'critical_alert'
  }
  if (condition.kind === 'work_order_complete' && completedThisAdvance.includes(condition.workOrderId)) {
    return 'work_order_complete'
  }
  return null
}

export const advanceSimulation = (
  source: MoonbaseState,
  input: AdvanceInput | number,
  actor: 'manual' | 'agent' = 'manual',
): [MoonbaseState, AdvanceResult] => {
  const requestedHours = typeof input === 'number' ? input : input.hours
  const requestedStop = typeof input === 'number' ? undefined : input.stopCondition
  const roundedHours = Math.round(boundedNumber(requestedHours, 1))
  const boundedHours = Math.max(1, Math.min(MAX_ADVANCE_HOURS, roundedHours))
  if (source.operationsPlan.status === 'completed') {
    return [
      source,
      {
        requestedHours,
        boundedHours,
        advancedHours: 0,
        stopped: true,
        stopReason: source.lastAdvance?.stopReason ?? 'horizon_reached',
        worldRevision: source.worldRevision,
        completedWorkOrderIds: source.lastAdvance?.completedWorkOrderIds ?? [],
      },
    ]
  }
  if (!operationsAreAvailable(source)) {
    return [
      source,
      {
        requestedHours,
        boundedHours,
        advancedHours: 0,
        stopped: true,
        stopReason: 'operations_not_ready',
        worldRevision: source.worldRevision,
        completedWorkOrderIds: [],
      },
    ]
  }

  let state = cloneState(source)
  const plan = state.operationsPlan
  const committedStop = plan.status !== 'draft' ? plan.stopCondition ?? undefined : undefined
  const initialCriticalIds = new Set(
    state.alerts.filter((alert) => alert.severity === 'critical').map((alert) => alert.id),
  )
  const completedAtStart = new Set(
    state.workOrders.filter((order) => order.status === 'complete').map((order) => order.id),
  )
  const completedWorkOrderIds: WorkOrderId[] = []
  const declaredMilestoneComplete =
    committedStop?.kind === 'work_order_complete' &&
    getOrder(state, committedStop.workOrderId)?.status === 'complete'
  const requestedMilestoneComplete =
    requestedStop?.kind === 'work_order_complete' &&
    getOrder(state, requestedStop.workOrderId)?.status === 'complete'
  const committedStopAtStart = declaredMilestoneComplete
    ? 'work_order_complete' as const
    : explicitStopReason(state, committedStop ?? null, [], initialCriticalIds)
  const requestedStopAtStart = requestedMilestoneComplete
    ? 'work_order_complete' as const
    : explicitStopReason(state, requestedStop ?? null, [], initialCriticalIds)
  let advancedHours = 0
  let terminalPlanStop =
    plan.status === 'committed' && (
      state.scenarioStatus === 'objective_complete' ||
      state.scenarioStatus === 'failed' ||
      committedStopAtStart !== null
    )
  let stopReason: StopReason | null =
    state.scenarioStatus === 'objective_complete'
      ? 'objective_complete'
      : state.scenarioStatus === 'failed'
        ? 'base_failed'
        : committedStopAtStart ?? requestedStopAtStart

  const planHoursAlreadyUsed =
    plan.status !== 'draft' && plan.committedAtHour !== null ? state.elapsedHours - plan.committedAtHour : 0
  const planHoursRemaining = plan.status !== 'draft' ? Math.max(0, plan.horizonHours - planHoursAlreadyUsed) : boundedHours
  const hoursToAttempt = Math.min(boundedHours, planHoursRemaining)
  if (hoursToAttempt === 0 && plan.status !== 'draft') {
    if (!terminalPlanStop) stopReason = 'horizon_reached'
    terminalPlanStop = true
  }

  for (let step = 0; step < hoursToAttempt && !stopReason; step += 1) {
    const candidate = stepOneHour(state)
    const oxygenFloor =
      plan.status !== 'draft' ? plan.constraints.oxygenFloorHours : requestedStop?.kind === 'oxygen_below' ? 0 : null
    if (oxygenFloor !== null && candidate.reserves.oxygenHours < oxygenFloor) {
      stopReason = 'oxygen_floor'
      terminalPlanStop = plan.status === 'committed'
      addEvent(
        state,
        'changed',
        'simulation',
        `Advance stopped before oxygen would cross the ${oxygenFloor}-hour plan floor.`,
        [state.operationsPlan.id],
      )
      break
    }

    state = candidate
    advancedHours += 1
    for (const order of state.workOrders) {
      if (order.status === 'complete' && !completedAtStart.has(order.id) && !completedWorkOrderIds.includes(order.id)) {
        completedWorkOrderIds.push(order.id)
      }
    }

    if (state.scenarioStatus === 'failed') {
      stopReason = 'base_failed'
      terminalPlanStop = plan.status === 'committed'
    } else if (state.scenarioStatus === 'objective_complete') {
      stopReason = 'objective_complete'
      terminalPlanStop = plan.status === 'committed'
    } else {
      const committedStopReason = explicitStopReason(
        state,
        committedStop ?? null,
        completedWorkOrderIds,
        initialCriticalIds,
      )
      const requestedStopReason = explicitStopReason(
        state,
        requestedStop ?? null,
        completedWorkOrderIds,
        initialCriticalIds,
      )
      stopReason = committedStopReason ?? requestedStopReason
      if (committedStopReason) terminalPlanStop = plan.status === 'committed'
    }

    const usedAfterStep = planHoursAlreadyUsed + advancedHours
    if (plan.status !== 'draft' && usedAfterStep >= plan.horizonHours && !terminalPlanStop) {
      stopReason = 'horizon_reached'
      terminalPlanStop = plan.status === 'committed'
    }
  }

  const result: AdvanceResult = {
    requestedHours,
    boundedHours,
    advancedHours,
    stopped: stopReason !== null,
    stopReason,
    worldRevision: state.worldRevision,
    completedWorkOrderIds,
  }
  if (terminalPlanStop && state.operationsPlan.status === 'committed') {
    state.operationsPlan.status = 'completed'
    state.operationsPlan.revision += 1
  }
  state.lastAdvance = result
  if (advancedHours > 0 || terminalPlanStop) state.verification = null
  if (advancedHours > 0 || terminalPlanStop) {
    addLearningEvidence(
      state,
      'supervise',
      advancedHours > 0
        ? `Supervised ${advancedHours} simulated ${advancedHours === 1 ? 'hour' : 'hours'}${stopReason ? `; stopped on ${stopReason}` : '; checkpoint reached'}.`
        : `Supervised the committed safeguards; execution stopped on ${stopReason} before time advanced.`,
      actor,
      terminalPlanStop,
    )
    addEvent(
      state,
      'changed',
      actor,
      `Advanced ${advancedHours}/${boundedHours} bounded hours${stopReason ? ` and stopped on ${stopReason}` : ''}.`,
      completedWorkOrderIds,
    )
  }
  return [state, result]
}

const stopConditionWasRespected = (state: MoonbaseState) => {
  const condition = state.operationsPlan.stopCondition
  const advance = state.lastAdvance
  if (!condition || !advance) return false
  if (condition.kind === 'objective_complete') {
    return state.scenarioStatus !== 'objective_complete' || advance.stopReason === 'objective_complete'
  }
  if (condition.kind === 'oxygen_below') {
    return state.reserves.minimumOxygenHours >= condition.thresholdHours || advance.stopReason === 'oxygen_below'
  }
  if (condition.kind === 'battery_below') {
    return state.power.batteryKwh >= condition.thresholdKwh || advance.stopReason === 'battery_below'
  }
  if (condition.kind === 'critical_alert') {
    return !state.alerts.some((alert) => alert.severity === 'critical') || advance.stopReason === 'critical_alert'
  }
  const orderComplete = getOrder(state, condition.workOrderId)?.status === 'complete'
  return !orderComplete || advance.stopReason === 'work_order_complete' || advance.stopReason === 'objective_complete'
}

const verificationFor = (state: MoonbaseState): VerificationResult => {
  const plan = state.operationsPlan
  const ready =
    operationsAreAvailable(state) &&
    plan.baseline !== null &&
    plan.status !== 'draft' &&
    state.lastAdvance !== null &&
    (state.elapsedHours > plan.baseline.elapsedHours || plan.status === 'completed')
  const objectiveMet = state.lab.atmosphere === 'yes' && state.research.status === 'complete'
  const milestoneOrder = plan.stopCondition?.kind === 'work_order_complete'
    ? getOrder(state, plan.stopCondition.workOrderId)
    : null
  const milestoneMet = milestoneOrder?.status === 'complete'
  const oxygenFloorMet = state.reserves.minimumOxygenHours >= plan.constraints.oxygenFloorHours
  const stopConditionRespected = stopConditionWasRespected(state)
  const powerStable = state.power.status !== 'critical'
  const effectiveGeneration = state.power.solarGenerationKw * (1 - state.power.dustDeratePercent / 100)
  const outcomeCheck: VerificationCheck = milestoneOrder
    ? {
        id: 'milestone',
        label: 'Declared milestone achieved',
        passed: milestoneMet,
        evidence: milestoneMet
          ? `${milestoneOrder.label} completed at elapsed hour ${milestoneOrder.completedAtHour}.`
          : `${milestoneOrder.label} status is ${milestoneOrder.status}.`,
      }
    : {
        id: 'objective',
        label: 'Objective achieved',
        passed: objectiveMet,
        evidence: objectiveMet
          ? 'Regolith Sintering is complete and its production job is unlocked.'
          : `Research status is ${state.research.status}.`,
      }
  const checks: VerificationCheck[] = [
    outcomeCheck,
    {
      id: 'oxygen_floor',
      label: 'Oxygen floor protected',
      passed: oxygenFloorMet,
      evidence: `Minimum observed reserve ${state.reserves.minimumOxygenHours}h; plan floor ${plan.constraints.oxygenFloorHours}h.`,
    },
    {
      id: 'stop_condition',
      label: 'Stop condition honored',
      passed: stopConditionRespected,
      evidence: `Last bounded advance stopped on ${state.lastAdvance?.stopReason ?? 'no trigger'}.`,
    },
    ...(!milestoneOrder
      ? [{
          id: 'lab_pressure' as const,
          label: 'Laboratory restored',
          passed: state.lab.sealed && state.lab.atmosphere === 'yes',
          evidence: `Breach ${state.lab.sealed ? 'sealed' : 'open'}; atmosphere ${state.lab.atmosphere}.`,
        }]
      : []),
    {
      id: 'power',
      label: 'Power remains available',
      passed: powerStable,
      evidence: `${state.power.batteryKwh} kWh battery; ${round(effectiveGeneration)}/${state.power.demandKw} kW generation/demand.`,
    },
  ]
  const residualRisks: string[] = []
  if (!state.dust.mitigated) residualRisks.push('Dust remains unmitigated and continues to derate solar generation.')
  if (state.power.batteryKwh < 10) residualRisks.push('Battery reserve is below 10 kWh.')
  if (state.reserves.oxygenHours - plan.constraints.oxygenFloorHours < 3) {
    residualRisks.push('Oxygen has less than three hours of margin above the declared floor.')
  }
  if (!objectiveMet) {
    residualRisks.push(
      milestoneMet
        ? 'Overall recovery continues: the laboratory recovery research objective is still incomplete.'
        : 'The laboratory recovery research objective is incomplete.',
    )
  }

  const success = ready && checks.every((check) => check.passed)
  return {
    status: !ready ? 'not_ready' : success ? 'success' : 'failure',
    objectiveMet,
    oxygenFloorMet,
    stopConditionRespected,
    checks,
    residualRisks,
    verifiedAtWorldRevision: state.worldRevision,
    verifiedAtHour: state.elapsedHours,
    summary: !ready
      ? 'Commit and supervise an Operations Plan before verifying it.'
      : success
        ? milestoneOrder && !objectiveMet
          ? `Verified milestone: ${milestoneOrder.label} completed safely; the overall laboratory recovery continues.`
          : 'Verified: laboratory recovery succeeded within the oxygen, power, and stop-condition constraints.'
        : 'Verification found unmet objective or safety checks; inspect the evidence before replanning.',
  }
}

export const verifyOperationsPlan = (
  source: MoonbaseState,
  actor: 'manual' | 'agent' = 'manual',
): [MoonbaseState, VerificationResult] => {
  if (
    source.verification?.verifiedAtWorldRevision === source.worldRevision &&
    source.verification.verifiedAtHour === source.elapsedHours
  ) {
    return [source, source.verification]
  }
  const verification = verificationFor(source)
  if (verification.status === 'not_ready') return [source, verification]

  const state = cloneState(source)
  state.verification = verification
  addLearningEvidence(state, 'verify', verification.summary, actor)
  const verificationTargets = source.operationsPlan.stopCondition?.kind === 'work_order_complete'
    ? [source.operationsPlan.id, source.operationsPlan.stopCondition.workOrderId]
    : [source.operationsPlan.id, 'module-laboratory', 'research-regolith-sintering']
  addEvent(
    state,
    'verified',
    actor,
    verification.summary,
    verificationTargets,
  )
  return [state, verification]
}

export const setOrderPriority = (
  source: MoonbaseState,
  workOrderId: WorkOrderId,
  priority: Priority,
  actor: 'manual' | 'agent' = 'manual',
): [MoonbaseState, PlanEditResult] =>
  stagePlanAction(source, { kind: 'set_priority', workOrderId, priority }, actor)

export const objectiveLabel = (objective: ObjectiveId) =>
  objective === 'restore_lab_and_research_sintering'
    ? 'Restore laboratory and research Regolith Sintering'
    : objective
