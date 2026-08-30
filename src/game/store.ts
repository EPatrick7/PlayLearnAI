import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { createInitialState } from './seed'
import {
  isConstructionLayout,
  type ConstructionLayout,
  type ConstructionResult,
} from './construction'
import { createStarterConstruction } from './constructionCatalog'
import {
  advanceConstructionOrders,
  availableConstructionStock,
  cancelConstructionCommand as cancelConstructionCommandInState,
  cancelConstructionOrder as cancelConstructionOrderInState,
  cancelConstructionOrders as cancelConstructionOrdersInState,
  deriveConstructionOrders,
  migrateV5ConstructionOrders,
  normalizePersistedConstructionOrders,
  projectConstructionOrders,
  reserveConstructionMaterials,
  returnedConstructionMaterials,
  type ConstructionOrder,
  type ConstructionOrderTarget,
} from './constructionJobs'
import {
  beginOperations as beginOperationsInState,
  buildBlueprints,
  constructModule as constructModuleInState,
} from './settlement'
import {
  advanceSimulation,
  clearOperationsPlan,
  commitOperationsPlan,
  rebaseOperationsPlan,
  recordLearningEvidence as recordLearningEvidenceInState,
  removePlanAction as removePlanActionFromState,
  setPlanBrief as setPlanBriefInState,
  stagePlanAction as stagePlanActionInState,
  validateOperationsPlan,
  verifyOperationsPlan,
} from './simulation'
import type {
  AdvanceInput,
  AdvanceResult,
  BuildResult,
  BuildableModuleId,
  CommitResult,
  LearningPhase,
  MoonbaseState,
  PlanActionInput,
  PlanBriefInput,
  PlanEditResult,
  PlanValidation,
  Priority,
  VerificationResult,
} from './types'

type InteractiveActor = 'manual' | 'agent'

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

export interface MoonbaseActions {
  resetColony: () => void
  resetMoonbase: () => void
  setConstructionLayout: (layout: ConstructionLayout) => void
  queueConstruction: (result: ConstructionResult) => QueueConstructionResult
  cancelConstructionCommand: (commandId: string) => string[]
  cancelConstructionOrder: (orderId: string) => boolean
  setConstructionOrderPriority: (orderId: string, priority: Priority) => boolean
  advanceConstruction: (elapsed?: number) => ConstructionAdvanceSummary
  constructModule: (
    blueprintId: BuildableModuleId,
    siteId: string,
    actor?: InteractiveActor,
  ) => BuildResult
  beginOperations: (actor?: InteractiveActor) => BuildResult
  setPlanBrief: (input: PlanBriefInput, actor?: InteractiveActor) => PlanEditResult
  stagePlanAction: (input: PlanActionInput, actor?: InteractiveActor) => PlanEditResult
  removePlanAction: (actionId: string, actor?: InteractiveActor) => PlanEditResult
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

const eligibleConstructionWorkers = (state: MoonbaseState) =>
  (state.settlement.phase === 'landing' ? state.crew.slice(0, 2) : state.crew)
    .filter((member) => member.health > 0 && member.taskId === null)
    .sort((left, right) =>
      right.skills.engineering - left.skills.engineering || left.id.localeCompare(right.id),
    )
    .slice(0, MAX_ACTIVE_BUILDERS)
    .map((member) => ({
      id: member.id,
      engineeringRate: 0.32 + member.skills.engineering * 0.035,
      haulingRate: 0.75,
    }))

const advanceConstructionInState = (
  state: MoonbaseState,
  elapsed: number,
): ConstructionAdvanceSummary => {
  if (!state.settlement.constructionOrders.some((order) => order.status !== 'complete')) {
    return { completedOrderIds: [], blockedOrderIds: [] }
  }
  const advanced = advanceConstructionOrders(
    state.settlement.layout,
    state.settlement.constructionOrders,
    eligibleConstructionWorkers(state),
    {
      constructionStock: state.reserves.constructionStock,
      elapsed,
    },
  )
  state.settlement = {
    ...state.settlement,
    layout: advanced.layout,
    constructionOrders: advanced.orders,
  }
  state.reserves = {
    ...state.reserves,
    constructionStock: advanced.constructionStock,
  }
  return {
    completedOrderIds: advanced.completedOrderIds,
    blockedOrderIds: advanced.blockedOrderIds,
  }
}

const domainSnapshot = (state: MoonbaseStore): MoonbaseState => ({
  baseName: state.baseName,
  seed: state.seed,
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

export const useColonyStore = create<MoonbaseStore>()(
  persist(
    (set, get) => ({
      ...createInitialState(),
      resetColony: () => set(createInitialState()),
      resetMoonbase: () => set(createInitialState()),
      setConstructionLayout: (layout) => set((state) => ({
        settlement: { ...state.settlement, layout, constructionOrders: [] },
        reserves: {
          ...state.reserves,
          constructionStock: state.reserves.constructionStock +
            returnedConstructionMaterials(state.settlement.constructionOrders),
        },
        worldRevision: state.worldRevision + 1,
      })),
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
        })
        if (derived.length === 0) {
          return { ok: false, orderIds: [], error: 'Nothing changed on those tiles.' }
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
        set({
          settlement: { ...state.settlement, constructionOrders },
          worldRevision: state.worldRevision + 1,
        })
        return true
      },
      advanceConstruction: (elapsed = 1) => {
        const state = structuredClone(domainSnapshot(get()))
        const summary = advanceConstructionInState(state, elapsed)
        if (
          summary.completedOrderIds.length > 0 ||
          state.settlement.constructionOrders.some((order, index) =>
            JSON.stringify(order) !== JSON.stringify(get().settlement.constructionOrders[index]),
          )
        ) {
          state.worldRevision += 1
          set(state)
        }
        return summary
      },
      constructModule: (blueprintId, siteId, actor = 'manual') => {
        const state = get()
        const blueprint = buildBlueprints.find((candidate) => candidate.id === blueprintId)
        const availableStock = availableConstructionStock(
          state.reserves.constructionStock,
          state.settlement.constructionOrders,
        )
        if (
          blueprint &&
          state.settlement.phase !== 'operations' &&
          availableStock < blueprint.cost
        ) {
          const availabilityView = {
            ...state,
            reserves: { ...state.reserves, constructionStock: availableStock },
          }
          const [, result] = constructModuleInState(
            availabilityView,
            blueprintId,
            siteId,
            actor,
          )
          return result
        }
        const [nextState, result] = constructModuleInState(state, blueprintId, siteId, actor)
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
      removePlanAction: (actionId, actor = 'manual') => {
        const [nextState, result] = removePlanActionFromState(get(), actionId, actor)
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
        advanceConstructionInState(nextState, result.advancedHours * 4)
        set(nextState)
        return result
      },
      advanceHours: (hours, actor = 'manual') => {
        const [nextState, result] = advanceSimulation(get(), { hours }, actor)
        advanceConstructionInState(nextState, result.advancedHours * 4)
        set(nextState)
        return result
      },
      verifyPlan: (actor = 'manual') => {
        const [nextState, result] = verifyOperationsPlan(get(), actor)
        set(nextState)
        return result
      },
      recordLearningEvidence: (phase, detail, actor = 'manual') => {
        set(recordLearningEvidenceInState(get(), phase, detail, actor))
      },
    }),
    {
      name: 'playlearnai-moonbase-poc-v1',
      version: 6,
      partialize: domainSnapshot,
      migrate: (persistedState, version) => {
        if (version > 6) return createInitialState()
        const state = persistedState as Partial<MoonbaseState>
        if (!state.settlement) return createInitialState()
        const layout = version < 4
          ? createStarterConstruction()
          : state.settlement.layout
        if (!isConstructionLayout(layout)) return createInitialState()
        const constructionStock = normalizedConstructionStock(
          state.reserves?.constructionStock,
          createInitialState().reserves.constructionStock,
        )
        const sourceOrders = version < 5 || !Array.isArray(state.settlement.constructionOrders)
          ? []
          : state.settlement.constructionOrders
        const constructionOrders = version === 5
          ? migrateV5ConstructionOrders(sourceOrders, constructionStock).orders
          : normalizePersistedConstructionOrders(
              sourceOrders,
              constructionStock,
            ).orders
        return {
          ...state,
          reserves: { ...state.reserves, constructionStock },
          settlement: {
            ...state.settlement,
            layout,
            constructionOrders,
            constructionSequence: repairedConstructionSequence(
              constructionOrders,
              state.settlement.constructionSequence,
            ),
          },
        } as MoonbaseState
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
        const constructionOrders = normalizePersistedConstructionOrders(
          persisted.settlement.constructionOrders,
          constructionStock,
        ).orders
        return {
          ...currentState,
          ...persisted,
          reserves: {
            ...currentState.reserves,
            ...persisted.reserves,
            constructionStock,
          },
          settlement: {
            ...currentState.settlement,
            ...persisted.settlement,
            constructionOrders,
            constructionSequence: repairedConstructionSequence(
              constructionOrders,
              persisted.settlement.constructionSequence,
            ),
          },
        }
      },
    },
  ),
)

export const useMoonbaseStore = useColonyStore
