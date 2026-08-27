export const resourceKeys = ['food', 'wood', 'stone', 'ore', 'medicine'] as const
export type ResourceKey = (typeof resourceKeys)[number]

export const skillKeys = ['farming', 'woodcutting', 'mining', 'masonry', 'medicine', 'hauling'] as const
export type SkillKey = (typeof skillKeys)[number]

export type ColonistStatus = 'working' | 'idle' | 'resting' | 'injured'
export type WorkOrderStatus = 'queued' | 'active' | 'complete' | 'cancelled'
export type AlertSeverity = 'info' | 'warning' | 'critical'
export type ToolCallKind = 'inspect' | 'act' | 'verify'
export type LearningPhase = 'inspect' | 'act' | 'verify'

export type WorkOrderType =
  | 'harvest_food'
  | 'chop_wood'
  | 'mine_stone'
  | 'mine_ore'
  | 'craft_medicine'
  | 'build_bedroom'
  | 'treat_injured'

export interface Colonist {
  id: string
  name: string
  title: string
  trait: string
  status: ColonistStatus
  health: number
  morale: number
  fatigue: number
  hunger: number
  location: string
  assignedOrderId: string | null
  skills: Record<SkillKey, number>
}

export interface WorkOrder {
  id: string
  type: WorkOrderType
  label: string
  priority: 1 | 2 | 3 | 4 | 5
  requiredSkill: SkillKey
  workers: string[]
  progress: number
  target: number
  status: WorkOrderStatus
  createdAt: number
}

export interface ColonyAlert {
  id: string
  severity: AlertSeverity
  title: string
  detail: string
}

export interface EventLogEntry {
  id: string
  tick: number
  tone: 'neutral' | 'good' | 'bad' | 'agent'
  message: string
}

export interface ToolCallEntry {
  id: string
  tick: number
  name: string
  kind: ToolCallKind
}

export interface LearningState {
  score: number
  phase: LearningPhase
  completedLoops: number
  coaching: string
  toolCalls: ToolCallEntry[]
}

export interface ColonyState {
  colonyName: string
  day: number
  hour: number
  tick: number
  season: 'Early Spring'
  weather: string
  resources: Record<ResourceKey, number>
  capacity: Record<ResourceKey, number>
  colonists: Colonist[]
  workOrders: WorkOrder[]
  alerts: ColonyAlert[]
  events: EventLogEntry[]
  learning: LearningState
}

export interface AssignmentInput {
  colonistId: string
  workOrderId: string | null
}

export interface CreateOrderInput {
  type: WorkOrderType
  priority: 1 | 2 | 3 | 4 | 5
}
