import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { createInitialState } from './seed'
import { advanceSimulation, assignColonists, createOrder, reprioritizeOrder } from './simulation'
import type {
  AssignmentInput,
  ColonyState,
  CreateOrderInput,
  ToolCallKind,
} from './types'

interface ColonyActions {
  resetColony: () => void
  advanceHours: (hours: number) => void
  addOrder: (input: CreateOrderInput) => string
  updateAssignments: (assignments: AssignmentInput[]) => { assigned: string[]; errors: string[] }
  setOrderPriority: (orderId: string, priority: 1 | 2 | 3 | 4 | 5) => boolean
  recordToolCall: (name: string, kind: ToolCallKind) => void
}

export type ColonyStore = ColonyState & ColonyActions

export const useColonyStore = create<ColonyStore>()(
  persist(
    (set, get) => ({
      ...createInitialState(),
      resetColony: () => set(createInitialState()),
      advanceHours: (hours) => set((state) => advanceSimulation(state, hours)),
      addOrder: (input) => {
        const [nextState, id] = createOrder(get(), input)
        set(nextState)
        return id
      },
      updateAssignments: (assignments) => {
        const [nextState, result] = assignColonists(get(), assignments)
        set(nextState)
        return result
      },
      setOrderPriority: (orderId, priority) => {
        const [nextState, updated] = reprioritizeOrder(get(), orderId, priority)
        if (updated) set(nextState)
        return updated
      },
      recordToolCall: (name, kind) =>
        set((state) => {
          const learning = structuredClone(state.learning)
          let scoreDelta = 1

          if (kind === 'inspect' && learning.phase === 'inspect') {
            scoreDelta = 6
            learning.phase = 'act'
            learning.coaching = 'Good context gathering. Now delegate a specific outcome with constraints and a reason.'
          } else if (kind === 'act' && learning.phase === 'act') {
            scoreDelta = 10
            learning.phase = 'verify'
            learning.coaching = 'The change is applied. Ask the agent to advance cautiously, then verify the outcome.'
          } else if (kind === 'verify' && learning.phase === 'verify') {
            scoreDelta = 14
            learning.phase = 'inspect'
            learning.completedLoops += 1
            learning.coaching = 'Loop complete: inspect → act → verify. Reassess before issuing the next delegation.'
          } else if (kind === 'act' && learning.phase === 'inspect') {
            scoreDelta = 0
            learning.coaching = 'Action without context is risky. Ask for a colony assessment before the next change.'
          } else if (kind === 'inspect' && learning.phase === 'verify') {
            scoreDelta = 4
            learning.phase = 'inspect'
            learning.completedLoops += 1
            learning.coaching = 'You checked the result. Start the next loop by naming the new bottleneck.'
          }

          learning.score = Math.min(100, learning.score + scoreDelta)
          learning.toolCalls.unshift({
            id: `tool-${state.tick}-${learning.toolCalls.length}`,
            tick: state.tick,
            name,
            kind,
          })
          learning.toolCalls = learning.toolCalls.slice(0, 10)
          return { learning }
        }),
    }),
    {
      name: 'playlearnai-colony-v1',
      partialize: (state) => ({
        colonyName: state.colonyName,
        day: state.day,
        hour: state.hour,
        tick: state.tick,
        season: state.season,
        weather: state.weather,
        resources: state.resources,
        capacity: state.capacity,
        colonists: state.colonists,
        workOrders: state.workOrders,
        alerts: state.alerts,
        events: state.events,
        learning: state.learning,
      }),
    },
  ),
)
