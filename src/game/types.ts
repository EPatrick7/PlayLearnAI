import type { ConstructionLayout, GridPoint } from './construction'
import type { ConstructionOrder } from './constructionJobs'
import type { ConstructionCrewPosition } from './constructionWorkerRouting'

export const skillKeys = ['engineering', 'science', 'medicine', 'operations'] as const
export type SkillKey = (typeof skillKeys)[number]

export const workOrderIds = [
  'work-seal-lab',
  'work-repressurize-lab',
  'work-research-sintering',
  'work-clean-solar',
] as const
export type WorkOrderId = (typeof workOrderIds)[number]

export const locationIds = [
  'habitat',
  'corridor',
  'life-support',
  'storage',
  'laboratory',
  'airlock',
  'solar-skid',
  'landing-pad',
] as const
export type LocationId = (typeof locationIds)[number]

export type ModuleType =
  | 'habitat'
  | 'corridor'
  | 'life_support'
  | 'storage'
  | 'laboratory'
  | 'airlock'
  | 'solar_battery_skid'
  | 'landing_pad'

export type BuildableModuleId =
  | 'solar_battery_skid'
  | 'life_support'
  | 'airlock'
  | 'storage'
  | 'laboratory'

export type SettlementPhase =
  | 'landing'
  | 'power_online'
  | 'habitable'
  | 'expanding'
  | 'ready'
  | 'operations'

export type CardinalSide = 'north' | 'east' | 'south' | 'west'
export type BuildSiteKind = 'pressurized_bay' | 'exterior_power'

export type AtmosphereState = 'yes' | 'low' | 'no'
export type ScenarioStatus = 'active' | 'objective_complete' | 'failed'
export type AlertSeverity = 'info' | 'warning' | 'critical'
export type CrewStatus = 'idle' | 'assigned' | 'working' | 'resting'
export type EquipmentStatus = 'available' | 'reserved' | 'in_transit' | 'deployed'
export type EquipmentType = 'eva_suit' | 'engineering_kit' | 'medical_kit' | 'rover'
export type WorkOrderType = 'seal_breach' | 'repressurize_lab' | 'research' | 'clean_solar'
export type WorkOrderStatus = 'blocked' | 'ready' | 'queued' | 'active' | 'complete' | 'paused'
export type WorkHazard = 'indoor' | 'vacuum' | 'eva'
export type Priority = 1 | 2 | 3 | 4 | 5
export type ConstructionSpeed = 0 | 1 | 2 | 3
export type Actor = 'manual' | 'agent' | 'simulation' | 'system'
export type LearningPhase = 'ground' | 'plan' | 'supervise' | 'verify'
export type ActivityPhase = 'observed' | 'planned' | 'changed' | 'verified' | 'system'
export type ObjectiveId = 'restore_lab_and_research_sintering'

export interface MapPosition {
  x: number
  y: number
  width: number
  height: number
}

export interface BuildSiteState {
  id: string
  label: string
  x: number
  y: number
  width: number
  height: number
  kind: BuildSiteKind
  connectionSide: CardinalSide | null
  occupiedBy: BuildableModuleId | null
}

export interface SettlementState {
  phase: SettlementPhase
  layout: ConstructionLayout
  constructionOrders: ConstructionOrder[]
  constructionSequence: number
  constructionSpeed: ConstructionSpeed
  constructionCrew: ConstructionCrewPosition[]
  constructionStockpile: GridPoint
  buildSites: BuildSiteState[]
  builtModuleIds: string[]
}

export interface BuildBlueprint {
  id: BuildableModuleId
  name: string
  moduleId: string
  location: LocationId
  moduleType: ModuleType
  cost: number
  width: number
  height: number
  siteKind: BuildSiteKind
  atmosphere: AtmosphereState
  powerPriority: 1 | 2 | 3
}

export type BuildResultCode =
  | 'built'
  | 'operations_started'
  | 'unknown_blueprint'
  | 'unknown_site'
  | 'site_occupied'
  | 'incompatible_site'
  | 'blueprint_unavailable'
  | 'insufficient_stock'
  | 'not_ready'
  | 'already_operational'

export interface BuildResult {
  ok: boolean
  code: BuildResultCode
  phase: SettlementPhase
  worldRevision: number
  moduleId?: string
  siteId?: string
  error?: string
}

export interface ModuleState {
  id: string
  name: string
  type: ModuleType
  location: LocationId
  position: MapPosition
  atmosphere: AtmosphereState
  condition: number
  powerPriority: 1 | 2 | 3
  breached: boolean
}

export interface CrewMember {
  id: string
  name: string
  role: string
  trait: string
  status: CrewStatus
  health: number
  fatigue: number
  morale: number
  location: LocationId
  taskId: WorkOrderId | null
  skills: Record<SkillKey, number>
}

export interface Equipment {
  id: string
  name: string
  type: EquipmentType
  status: EquipmentStatus
  location: LocationId
  condition: number
  reservedForWorkOrderId: WorkOrderId | null
  assignedCrewId: string | null
}

export interface WorkOrder {
  id: WorkOrderId
  type: WorkOrderType
  label: string
  detail: string
  location: LocationId
  status: WorkOrderStatus
  priority: Priority
  requiredSkill: SkillKey
  minimumSkill: number
  requiredEquipment: EquipmentType[]
  hazard: WorkHazard
  prerequisiteIds: WorkOrderId[]
  assignedCrewIds: string[]
  reservedEquipmentIds: string[]
  progressHours: number
  durationHours: number
  logisticsHoursRemaining: number
  startedAtHour: number | null
  completedAtHour: number | null
}

export interface ReserveState {
  oxygenHours: number
  minimumOxygenHours: number
  waterDays: number
  foodDays: number
  constructionStock: number
}

export interface PowerState {
  solarGenerationKw: number
  demandKw: number
  batteryKwh: number
  batteryCapacityKwh: number
  dustDeratePercent: number
  status: 'surplus' | 'battery' | 'critical'
}

export interface LaboratoryState {
  moduleId: string
  atmosphere: AtmosphereState
  breached: boolean
  sealed: boolean
}

export interface DustRiskState {
  startsAtHour: number
  active: boolean
  severity: 'moderate'
  baseDeratePercent: number
  mitigatedDeratePercent: number
  mitigated: boolean
}

export interface ResearchState {
  id: 'research-regolith-sintering'
  title: 'Regolith Sintering'
  status: 'blocked' | 'available' | 'active' | 'complete'
  progressHours: number
  requiredHours: number
  assignedResearcherId: string | null
  unlocks: string[]
}

export interface ScenarioObjective {
  id: ObjectiveId
  summary: string
  successCriteria: string[]
  recommendedOxygenFloorHours: number
}

export type StopCondition =
  | { kind: 'objective_complete' }
  | { kind: 'oxygen_below'; thresholdHours: number }
  | { kind: 'battery_below'; thresholdKwh: number }
  | { kind: 'critical_alert' }
  | { kind: 'work_order_complete'; workOrderId: WorkOrderId }

export interface PlanConstraints {
  oxygenFloorHours: number
  protectedCrewIds: string[]
}

export interface AssignCrewAction {
  id: string
  kind: 'assign_crew'
  crewId: string
  workOrderId: WorkOrderId
}

export interface ReserveEquipmentAction {
  id: string
  kind: 'reserve_equipment'
  equipmentId: string
  workOrderId: WorkOrderId
}

export interface SetPriorityAction {
  id: string
  kind: 'set_priority'
  workOrderId: WorkOrderId
  priority: Priority
}

export type PlanAction = AssignCrewAction | ReserveEquipmentAction | SetPriorityAction
export type PlanActionInput =
  | Omit<AssignCrewAction, 'id'>
  | Omit<ReserveEquipmentAction, 'id'>
  | Omit<SetPriorityAction, 'id'>

export interface PlanBriefInput {
  objective: ObjectiveId
  constraints: PlanConstraints
  horizonHours: number
  stopCondition: StopCondition
}

export interface PlanBaseline {
  worldRevision: number
  elapsedHours: number
  oxygenHours: number
  batteryKwh: number
  completedWorkOrderIds: WorkOrderId[]
}

export interface OperationsPlan {
  id: string
  title: string
  status: 'draft' | 'committed' | 'completed'
  revision: number
  basedOnWorldRevision: number
  objective: ObjectiveId | null
  constraints: PlanConstraints
  horizonHours: number
  stopCondition: StopCondition | null
  actions: PlanAction[]
  committedAtHour: number | null
  baseline: PlanBaseline | null
}

export type ValidationCode =
  | 'missing_objective'
  | 'missing_stop_condition'
  | 'invalid_horizon'
  | 'invalid_oxygen_floor'
  | 'stale_world_revision'
  | 'no_actions'
  | 'unknown_crew'
  | 'unknown_equipment'
  | 'unknown_work_order'
  | 'closed_work_order'
  | 'crew_conflict'
  | 'protected_crew_hazard'
  | 'insufficient_skill'
  | 'equipment_conflict'
  | 'equipment_condition'
  | 'wrong_equipment_type'
  | 'missing_crew'
  | 'missing_equipment'
  | 'oxygen_projection'
  | 'power_projection'

export interface ValidationIssue {
  code: ValidationCode
  severity: 'error' | 'warning'
  message: string
  actionId?: string
  targetId?: string
}

export interface PlanPreview {
  affectedWorkOrderIds: WorkOrderId[]
  assignedCrewIds: string[]
  reservedEquipmentIds: string[]
  estimatedCompletionHours: number | null
  projectedOxygenHours: number
  projectedBatteryKwh: number
}

export interface PlanValidation {
  valid: boolean
  worldRevision: number
  planRevision: number
  issues: ValidationIssue[]
  preview: PlanPreview
}

export interface PlanEditResult {
  ok: boolean
  planRevision: number
  actionId?: string
  error?: string
}

export interface CommitResult {
  ok: boolean
  code: 'committed' | 'stale_world' | 'stale_plan' | 'invalid_plan' | 'plan_not_draft'
  worldRevision: number
  planRevision: number
  validation: PlanValidation
}

export interface AdvanceInput {
  hours: number
  stopCondition?: StopCondition
}

export type StopReason =
  | 'objective_complete'
  | 'oxygen_floor'
  | 'oxygen_below'
  | 'battery_below'
  | 'critical_alert'
  | 'work_order_complete'
  | 'horizon_reached'
  | 'base_failed'

export interface AdvanceResult {
  requestedHours: number
  boundedHours: number
  advancedHours: number
  stopped: boolean
  stopReason: StopReason | null
  worldRevision: number
  completedWorkOrderIds: WorkOrderId[]
}

export interface VerificationCheck {
  id: 'objective' | 'oxygen_floor' | 'stop_condition' | 'lab_pressure' | 'power'
  label: string
  passed: boolean
  evidence: string
}

export interface VerificationResult {
  status: 'not_ready' | 'success' | 'failure'
  objectiveMet: boolean
  oxygenFloorMet: boolean
  stopConditionRespected: boolean
  checks: VerificationCheck[]
  residualRisks: string[]
  verifiedAtWorldRevision: number
  verifiedAtHour: number
  summary: string
}

export interface AlertState {
  id: string
  severity: AlertSeverity
  title: string
  detail: string
}

export interface ActivityEntry {
  id: string
  elapsedHours: number
  missionDay: number
  hour: number
  worldRevision: number
  planRevision: number
  phase: ActivityPhase
  actor: Actor
  message: string
  targetIds: string[]
}

export interface LearningEvidenceEntry {
  id: string
  phase: LearningPhase
  actor: Exclude<Actor, 'simulation' | 'system'>
  detail: string
  worldRevision: number
  planRevision: number
  elapsedHours: number
}

export interface LearningState {
  currentPhase: LearningPhase
  completedLoops: number
  achieved: Record<LearningPhase, boolean>
  coaching: string
  evidence: LearningEvidenceEntry[]
}

export interface MoonbaseState {
  baseName: string
  seed: number
  missionDay: number
  hour: number
  elapsedHours: number
  worldRevision: number
  scenarioStatus: ScenarioStatus
  map: { width: 24; height: 18 }
  settlement: SettlementState
  objective: ScenarioObjective
  reserves: ReserveState
  power: PowerState
  lab: LaboratoryState
  dust: DustRiskState
  modules: ModuleState[]
  crew: CrewMember[]
  equipment: Equipment[]
  workOrders: WorkOrder[]
  research: ResearchState
  alerts: AlertState[]
  events: ActivityEntry[]
  learning: LearningState
  operationsPlan: OperationsPlan
  lastAdvance: AdvanceResult | null
  verification: VerificationResult | null
}
