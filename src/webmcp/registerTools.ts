import { useEffect, useState } from 'react'
import { useColonyStore } from '../game/store'
import { skillKeys, workOrderIds } from '../game/types'
import type {
  PlanActionInput,
  Priority,
  SkillKey,
  StopCondition,
  WorkOrderId,
} from '../game/types'

export type WebMcpStatus = 'registering' | 'ready' | 'unavailable' | 'error'

const textResult = (value: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
})

const effectiveGeneration = () => {
  const { power } = useColonyStore.getState()
  return power.solarGenerationKw * (1 - power.dustDeratePercent / 100)
}

const workOrderView = (order: ReturnType<typeof useColonyStore.getState>['workOrders'][number]) => ({
  id: order.id,
  label: order.label,
  detail: order.detail,
  status: order.status,
  location: order.location,
  priority: order.priority,
  skill: { name: order.requiredSkill, minimum: order.minimumSkill },
  requiredEquipment: order.requiredEquipment,
  hazard: order.hazard,
  prerequisites: order.prerequisiteIds,
  progress: { hours: order.progressHours, requiredHours: order.durationHours },
  assignedCrewIds: order.assignedCrewIds,
  reservedEquipmentIds: order.reservedEquipmentIds,
})

const moonbaseBrief = () => {
  const state = useColonyStore.getState()
  return {
    base: state.baseName,
    seed: state.seed,
    time: { missionDay: state.missionDay, hour: state.hour, elapsedHours: state.elapsedHours },
    worldRevision: state.worldRevision,
    scenarioStatus: state.scenarioStatus,
    objective: state.objective,
    reserves: {
      ...state.reserves,
      declaredOxygenFloorHours: state.operationsPlan.objective
        ? state.operationsPlan.constraints.oxygenFloorHours
        : state.objective.recommendedOxygenFloorHours,
    },
    power: {
      ...state.power,
      effectiveGenerationKw: effectiveGeneration(),
      netKw: effectiveGeneration() - state.power.demandKw,
    },
    laboratory: state.lab,
    dust: {
      ...state.dust,
      startsInHours: Math.max(0, state.dust.startsAtHour - state.elapsedHours),
    },
    research: state.research,
    alerts: state.alerts,
    workOrders: state.workOrders.map(workOrderView),
    operationsPlan: {
      id: state.operationsPlan.id,
      status: state.operationsPlan.status,
      revision: state.operationsPlan.revision,
      basedOnWorldRevision: state.operationsPlan.basedOnWorldRevision,
      actionCount: state.operationsPlan.actions.length,
    },
    workflow: {
      phase: state.learning.currentPhase,
      coaching: state.learning.coaching,
    },
  }
}

interface StopConditionInput {
  kind: StopCondition['kind']
  thresholdHours?: number
  thresholdKwh?: number
  workOrderId?: WorkOrderId
}

const parseStopCondition = (input: StopConditionInput): StopCondition | string => {
  if (input.kind === 'oxygen_below') {
    if (typeof input.thresholdHours !== 'number') return 'oxygen_below requires thresholdHours.'
    return { kind: input.kind, thresholdHours: input.thresholdHours }
  }
  if (input.kind === 'battery_below') {
    if (typeof input.thresholdKwh !== 'number') return 'battery_below requires thresholdKwh.'
    return { kind: input.kind, thresholdKwh: input.thresholdKwh }
  }
  if (input.kind === 'work_order_complete') {
    if (!input.workOrderId) return 'work_order_complete requires workOrderId.'
    return { kind: input.kind, workOrderId: input.workOrderId }
  }
  return { kind: input.kind }
}

interface RawPlanAction {
  kind: PlanActionInput['kind']
  crewId?: string
  equipmentId?: string
  workOrderId: WorkOrderId
  priority?: Priority
}

const parsePlanAction = (input: RawPlanAction): PlanActionInput | string => {
  if (input.kind === 'assign_crew') {
    if (!input.crewId) return 'assign_crew requires crewId.'
    return { kind: input.kind, crewId: input.crewId, workOrderId: input.workOrderId }
  }
  if (input.kind === 'reserve_equipment') {
    if (!input.equipmentId) return 'reserve_equipment requires equipmentId.'
    return { kind: input.kind, equipmentId: input.equipmentId, workOrderId: input.workOrderId }
  }
  if (typeof input.priority !== 'number') return 'set_priority requires priority.'
  return { kind: input.kind, workOrderId: input.workOrderId, priority: input.priority }
}

export const useWebMcpTools = (): WebMcpStatus => {
  const [status, setStatus] = useState<WebMcpStatus>(() =>
    document.modelContext ? 'registering' : 'unavailable',
  )

  useEffect(() => {
    const modelContext = document.modelContext
    if (!modelContext) return

    const controller = new AbortController()
    const register = async () => {
      try {
        await Promise.all([
          modelContext.registerTool(
            {
              name: 'inspect_moonbase',
              description:
                'Ground a Moonbase decision in live evidence without changing simulation state. Returns world revision, pressure, reserves, power, dust timing, research, alerts, work dependencies, and plan status. Use before staging a response.',
              inputSchema: {
                type: 'object',
                properties: {
                  focus: {
                    type: 'string',
                    description: 'Optional inspection intent recorded as workflow evidence.',
                  },
                },
              },
              execute: (rawInput) => {
                const input = rawInput as { focus?: string }
                useColonyStore.getState().recordLearningEvidence(
                  'ground',
                  input.focus ? `Agent inspected the moonbase for: ${input.focus}` : 'Agent inspected the live moonbase brief.',
                  'agent',
                )
                return textResult(moonbaseBrief())
              },
            },
            { signal: controller.signal },
          ),
          modelContext.registerTool(
            {
              name: 'query_crew_and_equipment',
              description:
                'Compare crew and localized equipment before staging assignments. Can rank one skill, cap fatigue, and focus on the requirements of one work order. This is read-only.',
              inputSchema: {
                type: 'object',
                properties: {
                  skill: { type: 'string', enum: skillKeys },
                  maxFatigue: { type: 'number', minimum: 0, maximum: 100 },
                  workOrderId: { type: 'string', enum: workOrderIds },
                  includeEquipment: { type: 'boolean', default: true },
                },
              },
              execute: (rawInput) => {
                const input = rawInput as {
                  skill?: SkillKey
                  maxFatigue?: number
                  workOrderId?: WorkOrderId
                  includeEquipment?: boolean
                }
                const store = useColonyStore.getState()
                const order = input.workOrderId
                  ? store.workOrders.find((candidate) => candidate.id === input.workOrderId)
                  : undefined
                const skill = input.skill ?? order?.requiredSkill
                let crew = [...store.crew]
                if (input.maxFatigue !== undefined) crew = crew.filter((member) => member.fatigue <= input.maxFatigue!)
                if (skill) crew.sort((a, b) => b.skills[skill] - a.skills[skill])
                const equipment = input.includeEquipment === false
                  ? []
                  : store.equipment.filter((item) => !order || order.requiredEquipment.includes(item.type))
                store.recordLearningEvidence(
                  'ground',
                  `Agent compared ${crew.length} crew${order ? ` and gear for ${order.label}` : ' and localized gear'}.`,
                  'agent',
                )
                return textResult({
                  worldRevision: store.worldRevision,
                  workOrder: order ? workOrderView(order) : null,
                  crew: crew.map((member) => ({
                    id: member.id,
                    name: member.name,
                    role: member.role,
                    trait: member.trait,
                    status: member.status,
                    health: member.health,
                    fatigue: member.fatigue,
                    location: member.location,
                    taskId: member.taskId,
                    relevantSkill: skill ? { name: skill, level: member.skills[skill] } : undefined,
                  })),
                  equipment,
                })
              },
            },
            { signal: controller.signal },
          ),
          modelContext.registerTool(
            {
              name: 'inspect_operations_plan',
              description:
                'Read the shared editable Operations Plan and a fresh validation preview. Use after a human edit and immediately before commit so plan and world revisions are current.',
              inputSchema: { type: 'object', properties: {} },
              execute: () => {
                const store = useColonyStore.getState()
                return textResult({
                  worldRevision: store.worldRevision,
                  plan: store.operationsPlan,
                  validation: store.validatePlan(),
                })
              },
            },
            { signal: controller.signal },
          ),
          modelContext.registerTool(
            {
              name: 'stage_operations_plan',
              description:
                'Stage bounded typed actions in the shared draft; nothing executes until commit. Supply the revisions you inspected. replace mode clears the existing draft first. The returned preview exposes conflicts, safety warnings, projected oxygen, battery, and duration.',
              inputSchema: {
                type: 'object',
                properties: {
                  expectedWorldRevision: { type: 'number', minimum: 1 },
                  expectedPlanRevision: { type: 'number', minimum: 1 },
                  mode: { type: 'string', enum: ['append', 'replace'], default: 'append' },
                  brief: {
                    type: 'object',
                    properties: {
                      oxygenFloorHours: { type: 'number', minimum: 1 },
                      protectedCrewIds: { type: 'array', maxItems: 6, items: { type: 'string' } },
                      horizonHours: { type: 'number', minimum: 1, maximum: 12 },
                      stopCondition: {
                        type: 'object',
                        properties: {
                          kind: {
                            type: 'string',
                            enum: ['objective_complete', 'oxygen_below', 'battery_below', 'critical_alert', 'work_order_complete'],
                          },
                          thresholdHours: { type: 'number' },
                          thresholdKwh: { type: 'number' },
                          workOrderId: { type: 'string', enum: workOrderIds },
                        },
                        required: ['kind'],
                      },
                    },
                    required: ['oxygenFloorHours', 'horizonHours', 'stopCondition'],
                  },
                  actions: {
                    type: 'array',
                    minItems: 1,
                    maxItems: 16,
                    items: {
                      type: 'object',
                      properties: {
                        kind: { type: 'string', enum: ['assign_crew', 'reserve_equipment', 'set_priority'] },
                        crewId: { type: 'string' },
                        equipmentId: { type: 'string' },
                        workOrderId: { type: 'string', enum: workOrderIds },
                        priority: { type: 'number', enum: [1, 2, 3, 4, 5] },
                      },
                      required: ['kind', 'workOrderId'],
                    },
                  },
                },
                required: ['expectedWorldRevision', 'expectedPlanRevision', 'actions'],
              },
              execute: (rawInput) => {
                const input = rawInput as {
                  expectedWorldRevision: number
                  expectedPlanRevision: number
                  mode?: 'append' | 'replace'
                  brief?: {
                    oxygenFloorHours: number
                    protectedCrewIds?: string[]
                    horizonHours: number
                    stopCondition: StopConditionInput
                  }
                  actions: RawPlanAction[]
                }
                const current = useColonyStore.getState()
                if (input.expectedWorldRevision !== current.worldRevision || input.expectedPlanRevision !== current.operationsPlan.revision) {
                  return textResult({
                    ok: false,
                    code: 'stale_revision',
                    currentWorldRevision: current.worldRevision,
                    currentPlanRevision: current.operationsPlan.revision,
                    next: 'Inspect the Operations Plan again before editing it.',
                  })
                }

                const parsedActions = input.actions.map(parsePlanAction)
                const actionError = parsedActions.find((action): action is string => typeof action === 'string')
                if (actionError) return textResult({ ok: false, code: 'invalid_action', error: actionError })
                const parsedStop = input.brief ? parseStopCondition(input.brief.stopCondition) : null
                if (typeof parsedStop === 'string') return textResult({ ok: false, code: 'invalid_stop_condition', error: parsedStop })

                if (input.mode === 'replace') useColonyStore.getState().clearPlan('agent')
                if (input.brief && parsedStop) {
                  useColonyStore.getState().setPlanBrief({
                    objective: useColonyStore.getState().objective.id,
                    constraints: {
                      oxygenFloorHours: input.brief.oxygenFloorHours,
                      protectedCrewIds: input.brief.protectedCrewIds ?? [],
                    },
                    horizonHours: input.brief.horizonHours,
                    stopCondition: parsedStop,
                  }, 'agent')
                }
                const editResults = parsedActions.map((action) =>
                  useColonyStore.getState().stagePlanAction(action as PlanActionInput, 'agent'),
                )
                const store = useColonyStore.getState()
                return textResult({
                  ok: editResults.every((result) => result.ok),
                  editResults,
                  worldRevision: store.worldRevision,
                  plan: store.operationsPlan,
                  validation: store.validatePlan(),
                  next: 'Review warnings and have the human amend the shared draft if needed. Re-inspect immediately before commit.',
                })
              },
            },
            { signal: controller.signal },
          ),
          modelContext.registerTool(
            {
              name: 'edit_operations_plan',
              description:
                'Perform the same draft edits available in the visible plan: remove specific action IDs, clear to a fresh draft, or rebase the draft onto the current world revision.',
              inputSchema: {
                type: 'object',
                properties: {
                  expectedPlanRevision: { type: 'number', minimum: 1 },
                  operation: { type: 'string', enum: ['remove_actions', 'clear', 'rebase'] },
                  actionIds: { type: 'array', maxItems: 16, items: { type: 'string' } },
                },
                required: ['expectedPlanRevision', 'operation'],
              },
              execute: (rawInput) => {
                const input = rawInput as {
                  expectedPlanRevision: number
                  operation: 'remove_actions' | 'clear' | 'rebase'
                  actionIds?: string[]
                }
                const current = useColonyStore.getState()
                if (input.expectedPlanRevision !== current.operationsPlan.revision) {
                  return textResult({ ok: false, code: 'stale_plan', currentPlanRevision: current.operationsPlan.revision })
                }
                const results = input.operation === 'clear'
                  ? [current.clearPlan('agent')]
                  : input.operation === 'rebase'
                    ? [current.rebasePlan('agent')]
                    : (input.actionIds ?? []).map((id) => useColonyStore.getState().removePlanAction(id, 'agent'))
                const store = useColonyStore.getState()
                return textResult({
                  ok: results.length > 0 && results.every((result) => result.ok),
                  results,
                  worldRevision: store.worldRevision,
                  plan: store.operationsPlan,
                  validation: store.validatePlan(),
                })
              },
            },
            { signal: controller.signal },
          ),
          modelContext.registerTool(
            {
              name: 'commit_operations_plan',
              description:
                'Atomically commit the validated shared draft using the exact world and plan revisions from the latest inspection. Stale or invalid plans fail without executing any action.',
              inputSchema: {
                type: 'object',
                properties: {
                  expectedWorldRevision: { type: 'number', minimum: 1 },
                  expectedPlanRevision: { type: 'number', minimum: 1 },
                },
                required: ['expectedWorldRevision', 'expectedPlanRevision'],
              },
              execute: (rawInput) => {
                const input = rawInput as { expectedWorldRevision: number; expectedPlanRevision: number }
                const result = useColonyStore.getState().commitPlan(
                  input.expectedWorldRevision,
                  input.expectedPlanRevision,
                  'agent',
                )
                return textResult({
                  ...result,
                  currentPlan: useColonyStore.getState().operationsPlan,
                  next: result.ok ? 'Advance a bounded observation window, then verify with fresh evidence.' : 'Inspect and amend the plan before retrying.',
                })
              },
            },
            { signal: controller.signal },
          ),
          modelContext.registerTool(
            {
              name: 'advance_until',
              description:
                'Advance a committed Moonbase plan by at most twelve simulated hours, stopping early on its oxygen floor, horizon, objective, new critical alert, or the supplied typed stop condition.',
              inputSchema: {
                type: 'object',
                properties: {
                  expectedWorldRevision: { type: 'number', minimum: 1 },
                  hours: { type: 'number', minimum: 1, maximum: 12 },
                  stopCondition: {
                    type: 'object',
                    properties: {
                      kind: {
                        type: 'string',
                        enum: ['objective_complete', 'oxygen_below', 'battery_below', 'critical_alert', 'work_order_complete'],
                      },
                      thresholdHours: { type: 'number' },
                      thresholdKwh: { type: 'number' },
                      workOrderId: { type: 'string', enum: workOrderIds },
                    },
                    required: ['kind'],
                  },
                },
                required: ['expectedWorldRevision', 'hours'],
              },
              execute: (rawInput) => {
                const input = rawInput as {
                  expectedWorldRevision: number
                  hours: number
                  stopCondition?: StopConditionInput
                }
                const current = useColonyStore.getState()
                if (input.expectedWorldRevision !== current.worldRevision) {
                  return textResult({ ok: false, code: 'stale_world', currentWorldRevision: current.worldRevision })
                }
                if (current.operationsPlan.status === 'draft') {
                  return textResult({ ok: false, code: 'plan_not_committed' })
                }
                const parsedStop = input.stopCondition ? parseStopCondition(input.stopCondition) : undefined
                if (typeof parsedStop === 'string') return textResult({ ok: false, code: 'invalid_stop_condition', error: parsedStop })
                const result = current.advanceTime({ hours: input.hours, stopCondition: parsedStop }, 'agent')
                const next = useColonyStore.getState()
                return textResult({
                  ok: true,
                  ...result,
                  state: {
                    time: { missionDay: next.missionDay, hour: next.hour, elapsedHours: next.elapsedHours },
                    worldRevision: next.worldRevision,
                    reserves: next.reserves,
                    power: next.power,
                    laboratory: next.lab,
                    research: next.research,
                    alerts: next.alerts,
                  },
                  next: 'Verify the actual result against the committed objective and constraints.',
                })
              },
            },
            { signal: controller.signal },
          ),
          modelContext.registerTool(
            {
              name: 'verify_operations_plan',
              description:
                'Compare fresh Moonbase state with the committed objective, oxygen floor, stop condition, laboratory pressure, and power constraint. Returns explicit checks and residual risks.',
              inputSchema: {
                type: 'object',
                properties: {
                  expectedWorldRevision: { type: 'number', minimum: 1 },
                },
                required: ['expectedWorldRevision'],
              },
              execute: (rawInput) => {
                const input = rawInput as { expectedWorldRevision: number }
                const current = useColonyStore.getState()
                if (input.expectedWorldRevision !== current.worldRevision) {
                  return textResult({ ok: false, code: 'stale_world', currentWorldRevision: current.worldRevision })
                }
                const verification = current.verifyPlan('agent')
                return textResult({
                  ok: verification.status !== 'not_ready',
                  verification,
                  scenarioStatus: useColonyStore.getState().scenarioStatus,
                  workflow: useColonyStore.getState().learning,
                })
              },
            },
            { signal: controller.signal },
          ),
        ])
        setStatus('ready')
      } catch (error) {
        if ((error as DOMException).name !== 'AbortError') {
          console.error('Unable to register Moonbase WebMCP tools', error)
          setStatus('error')
        }
      }
    }

    void register()
    return () => controller.abort()
  }, [])

  return status
}
