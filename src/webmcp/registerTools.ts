import { useEffect, useState } from 'react'
import { orderCatalog } from '../game/simulation'
import { useColonyStore } from '../game/store'
import type { ColonistStatus, SkillKey, WorkOrderStatus, WorkOrderType } from '../game/types'

export type WebMcpStatus = 'registering' | 'ready' | 'unavailable' | 'error'

const textResult = (value: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
})

const colonyBrief = () => {
  const state = useColonyStore.getState()
  const activeOrders = state.workOrders.filter((order) => order.status === 'active')
  return {
    colony: state.colonyName,
    time: { day: state.day, hour: state.hour, season: state.season, weather: state.weather },
    population: {
      total: state.colonists.length,
      idle: state.colonists.filter((colonist) => colonist.status === 'idle').length,
      working: state.colonists.filter((colonist) => colonist.status === 'working').length,
      resting: state.colonists.filter((colonist) => colonist.status === 'resting').length,
      injured: state.colonists.filter((colonist) => colonist.status === 'injured').length,
    },
    resources: state.resources,
    activeWork: activeOrders.map(({ id, label, priority, progress, target, workers }) => ({
      id,
      label,
      priority,
      progress: `${Math.round((progress / target) * 100)}%`,
      workerCount: workers.length,
    })),
    alerts: state.alerts,
    delegationLesson: {
      phase: state.learning.phase,
      coaching: state.learning.coaching,
    },
  }
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
              name: 'get_colony_brief',
              description:
                'Inspect the current Emberdeep colony situation before making changes. Returns time, population, resources, active work, risks, and the current learning-loop phase. Use this first when the user asks for a plan.',
              inputSchema: { type: 'object', properties: {} },
              execute: () => {
                useColonyStore.getState().recordToolCall('get_colony_brief', 'inspect')
                return textResult(colonyBrief())
              },
            },
            { signal: controller.signal },
          ),
          modelContext.registerTool(
            {
              name: 'query_colonists',
              description:
                'Find colonists using structured constraints. Use this to compare candidates by relevant skill, fatigue, health, morale, and current assignment instead of guessing from the visual roster.',
              inputSchema: {
                type: 'object',
                properties: {
                  status: {
                    type: 'string',
                    enum: ['working', 'idle', 'resting', 'injured'],
                    description: 'Optional current status filter.',
                  },
                  skill: {
                    type: 'string',
                    enum: ['farming', 'woodcutting', 'mining', 'masonry', 'medicine', 'hauling'],
                    description: 'Optional skill to rank from highest to lowest.',
                  },
                  maxFatigue: {
                    type: 'number',
                    minimum: 0,
                    maximum: 100,
                    description: 'Only return colonists at or below this fatigue.',
                  },
                  limit: { type: 'number', minimum: 1, maximum: 20, default: 8 },
                },
              },
              execute: (rawInput) => {
                const input = rawInput as {
                  status?: ColonistStatus
                  skill?: SkillKey
                  maxFatigue?: number
                  limit?: number
                }
                useColonyStore.getState().recordToolCall('query_colonists', 'inspect')
                const limit = Math.min(20, Math.max(1, input.limit ?? 8))
                let colonists = [...useColonyStore.getState().colonists]
                if (input.status) colonists = colonists.filter((colonist) => colonist.status === input.status)
                if (input.maxFatigue !== undefined) {
                  colonists = colonists.filter((colonist) => colonist.fatigue <= input.maxFatigue!)
                }
                if (input.skill) colonists.sort((a, b) => b.skills[input.skill!] - a.skills[input.skill!])
                return textResult({
                  count: Math.min(colonists.length, limit),
                  colonists: colonists.slice(0, limit).map((colonist) => ({
                    id: colonist.id,
                    name: colonist.name,
                    title: colonist.title,
                    status: colonist.status,
                    health: colonist.health,
                    morale: colonist.morale,
                    fatigue: colonist.fatigue,
                    assignedOrderId: colonist.assignedOrderId,
                    relevantSkill: input.skill ? { name: input.skill, level: colonist.skills[input.skill] } : undefined,
                  })),
                })
              },
            },
            { signal: controller.signal },
          ),
          modelContext.registerTool(
            {
              name: 'list_work_orders',
              description:
                'Inspect open or completed colony work orders, including IDs, priorities, required skills, assigned workers, and progress. Useful before assigning colonists or changing priorities.',
              inputSchema: {
                type: 'object',
                properties: {
                  status: {
                    type: 'string',
                    enum: ['queued', 'active', 'complete', 'cancelled'],
                    description: 'Optional status filter.',
                  },
                },
              },
              execute: (rawInput) => {
                const input = rawInput as { status?: WorkOrderStatus }
                useColonyStore.getState().recordToolCall('list_work_orders', 'inspect')
                let orders = useColonyStore.getState().workOrders
                if (input.status) orders = orders.filter((order) => order.status === input.status)
                return textResult({
                  orders: orders
                    .sort((a, b) => b.priority - a.priority)
                    .map((order) => ({
                      id: order.id,
                      label: order.label,
                      type: order.type,
                      status: order.status,
                      priority: order.priority,
                      requiredSkill: order.requiredSkill,
                      progressPercent: Math.round((order.progress / order.target) * 100),
                      workerIds: order.workers,
                    })),
                })
              },
            },
            { signal: controller.signal },
          ),
          modelContext.registerTool(
            {
              name: 'create_work_order',
              description:
                'Create one bounded colony work order after inspecting current needs. Explain the rationale so the human can evaluate the decision. This changes shared game state immediately.',
              inputSchema: {
                type: 'object',
                properties: {
                  type: {
                    type: 'string',
                    enum: Object.keys(orderCatalog),
                    description: 'The concrete outcome the colony should produce.',
                  },
                  priority: { type: 'number', enum: [1, 2, 3, 4, 5], description: '1 is lowest; 5 is urgent.' },
                  rationale: {
                    type: 'string',
                    minLength: 8,
                    description: 'A concise reason tied to observed colony state.',
                  },
                },
                required: ['type', 'priority', 'rationale'],
              },
              execute: (rawInput) => {
                const input = rawInput as {
                  type: WorkOrderType
                  priority: 1 | 2 | 3 | 4 | 5
                  rationale: string
                }
                const store = useColonyStore.getState()
                store.recordToolCall('create_work_order', 'act')
                const orderId = store.addOrder({ type: input.type, priority: input.priority })
                return textResult({
                  ok: true,
                  orderId,
                  rationale: input.rationale,
                  next: 'Assign suitable, rested colonists or leave the order queued for human review.',
                })
              },
            },
            { signal: controller.signal },
          ),
          modelContext.registerTool(
            {
              name: 'assign_colonists',
              description:
                'Apply up to twelve explicit colonist-to-work-order assignments as one reviewable batch. Inspect colonists and work orders first; protect injured or exhausted workers. Use null workOrderId to rest or unassign someone.',
              inputSchema: {
                type: 'object',
                properties: {
                  assignments: {
                    type: 'array',
                    minItems: 1,
                    maxItems: 12,
                    items: {
                      type: 'object',
                      properties: {
                        colonistId: { type: 'string' },
                        workOrderId: { type: ['string', 'null'] },
                      },
                      required: ['colonistId', 'workOrderId'],
                    },
                  },
                  rationale: {
                    type: 'string',
                    minLength: 8,
                    description: 'Why this batch balances skill, urgency, health, and fatigue.',
                  },
                },
                required: ['assignments', 'rationale'],
              },
              execute: (rawInput) => {
                const input = rawInput as {
                  assignments: Array<{ colonistId: string; workOrderId: string | null }>
                  rationale: string
                }
                const store = useColonyStore.getState()
                store.recordToolCall('assign_colonists', 'act')
                const result = store.updateAssignments(input.assignments)
                return textResult({ ...result, rationale: input.rationale, next: 'Advance no more than a few hours, then verify.' })
              },
            },
            { signal: controller.signal },
          ),
          modelContext.registerTool(
            {
              name: 'set_work_order_priority',
              description:
                'Change one open work order priority after explaining the observed tradeoff. This does not assign workers.',
              inputSchema: {
                type: 'object',
                properties: {
                  workOrderId: { type: 'string' },
                  priority: { type: 'number', enum: [1, 2, 3, 4, 5] },
                  rationale: { type: 'string', minLength: 8 },
                },
                required: ['workOrderId', 'priority', 'rationale'],
              },
              execute: (rawInput) => {
                const input = rawInput as {
                  workOrderId: string
                  priority: 1 | 2 | 3 | 4 | 5
                  rationale: string
                }
                const store = useColonyStore.getState()
                store.recordToolCall('set_work_order_priority', 'act')
                const ok = store.setOrderPriority(input.workOrderId, input.priority)
                return textResult({ ok, rationale: input.rationale })
              },
            },
            { signal: controller.signal },
          ),
          modelContext.registerTool(
            {
              name: 'advance_colony_time',
              description:
                'Advance the shared simulation by one to four hours so assigned work can progress. Use a small observation window, then call verify_colony_outcome. Time advancement consumes food and increases worker fatigue.',
              inputSchema: {
                type: 'object',
                properties: {
                  hours: { type: 'number', minimum: 1, maximum: 4 },
                  expectedOutcome: {
                    type: 'string',
                    minLength: 8,
                    description: 'A falsifiable expectation to check after time advances.',
                  },
                },
                required: ['hours', 'expectedOutcome'],
              },
              execute: (rawInput) => {
                const input = rawInput as { hours: number; expectedOutcome: string }
                const store = useColonyStore.getState()
                store.recordToolCall('advance_colony_time', 'act')
                store.advanceHours(input.hours)
                return textResult({
                  advancedHours: input.hours,
                  expectedOutcome: input.expectedOutcome,
                  next: 'Call verify_colony_outcome and compare the evidence with the expectation.',
                })
              },
            },
            { signal: controller.signal },
          ),
          modelContext.registerTool(
            {
              name: 'verify_colony_outcome',
              description:
                'Close the delegation loop after an action. Returns current evidence—resources, risks, work progress, and worker strain—so you can state whether the intended outcome occurred and adjust safely.',
              inputSchema: {
                type: 'object',
                properties: {
                  focus: {
                    type: 'string',
                    description: 'The outcome, resource, work order, or risk being verified.',
                  },
                },
                required: ['focus'],
              },
              execute: (rawInput) => {
                const input = rawInput as { focus: string }
                useColonyStore.getState().recordToolCall('verify_colony_outcome', 'verify')
                const state = useColonyStore.getState()
                return textResult({
                  focus: input.focus,
                  time: { day: state.day, hour: state.hour },
                  resources: state.resources,
                  alerts: state.alerts,
                  openWork: state.workOrders
                    .filter((order) => order.status === 'active' || order.status === 'queued')
                    .map((order) => ({
                      id: order.id,
                      label: order.label,
                      status: order.status,
                      progressPercent: Math.round((order.progress / order.target) * 100),
                      workers: order.workers.length,
                    })),
                  strainedWorkers: state.colonists
                    .filter((colonist) => colonist.fatigue >= 75 || colonist.health < 70)
                    .map(({ id, name, health, fatigue, status }) => ({ id, name, health, fatigue, status })),
                  learningLoop: state.learning,
                })
              },
            },
            { signal: controller.signal },
          ),
        ])
        setStatus('ready')
      } catch (error) {
        if ((error as DOMException).name !== 'AbortError') {
          console.error('Unable to register WebMCP tools', error)
          setStatus('error')
        }
      }
    }

    void register()
    return () => controller.abort()
  }, [])

  return status
}
