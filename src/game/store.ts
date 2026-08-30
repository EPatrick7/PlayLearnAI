import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { createInitialState } from './seed'
import {
  isConstructionLayout,
  type ConstructionLayout,
  type ConstructionResult,
  type GridPoint,
} from './construction'
import { createStarterConstruction } from './constructionCatalog'
import {
  availableConstructionStock,
  cancelConstructionCommand as cancelConstructionCommandInState,
  cancelConstructionOrder as cancelConstructionOrderInState,
  cancelConstructionOrders as cancelConstructionOrdersInState,
  deriveConstructionOrders,
  migrateV5ConstructionOrders,
  normalizePersistedConstructionOrders,
  projectConstructionOrders,
  rebuildConstructionOrderPrerequisites,
  reserveConstructionMaterials,
  returnedConstructionMaterials,
  type ConstructionOrder,
  type ConstructionOrderTarget,
} from './constructionJobs'
import {
  normalizeConstructionStockpile,
  normalizePersistedConstructionCrewPositions,
} from './constructionWorkerRouting'
import { advanceConstructionWorkerSimulationFixedStep } from './constructionWorkerSimulation'
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
  ConstructionSpeed,
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
  setConstructionSpeed: (speed: ConstructionSpeed) => boolean
  queueConstruction: (result: ConstructionResult) => QueueConstructionResult
  cancelConstructionCommand: (commandId: string) => string[]
  cancelConstructionOrder: (orderId: string) => boolean
  setConstructionOrderPriority: (orderId: string, priority: Priority) => boolean
  setConstructionCommandPriority: (commandId: string, priority: Priority) => number
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

const reallocateUncollectedConstructionReservations = (
  sourceOrders: readonly ConstructionOrder[],
  constructionStock: number,
) => reserveConstructionMaterials(sourceOrders.map((order) => {
  const uncollectedReservation = (
    order.status !== 'complete' &&
    order.materials.reserved > 0 &&
    order.materials.delivered <= Number.EPSILON
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

const spatialConstructionWorkers = (state: MoonbaseState) => {
  const eligibleById = new Map(
    eligibleConstructionWorkers(state).map((worker, index) => [
      worker.id,
      { ...worker, dispatchPriority: MAX_ACTIVE_BUILDERS - index },
    ]),
  )
  return state.crew.map((member) => {
    const eligible = eligibleById.get(member.id)
    return {
      id: member.id,
      canConstruct: Boolean(eligible),
      dispatchPriority: eligible?.dispatchPriority ?? 0,
      engineeringRate: eligible?.engineeringRate ??
        0.32 + member.skills.engineering * 0.035,
      haulingRate: eligible?.haulingRate ?? 0.75,
      movementRate: 1.8 + member.skills.operations * 0.04,
    }
  })
}

const advanceConstructionInState = (
  state: MoonbaseState,
  elapsed: number,
): ConstructionAdvanceSummary => {
  if (!state.settlement.constructionOrders.some((order) => order.status !== 'complete')) {
    return { completedOrderIds: [], blockedOrderIds: [] }
  }
  const advanced = advanceConstructionWorkerSimulationFixedStep({
    layout: state.settlement.layout,
    orders: state.settlement.constructionOrders,
    constructionStock: state.reserves.constructionStock,
    stockpile: state.settlement.constructionStockpile,
    crewPositions: state.settlement.constructionCrew,
    workers: spatialConstructionWorkers(state),
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
  return {
    completedOrderIds: advanced.completedOrderIds,
    blockedOrderIds: advanced.blockedOrderIds,
  }
}

const advanceConstructionBeforeHour = (state: MoonbaseState) => {
  if (state.settlement.constructionSpeed === 0) return
  advanceConstructionInState(state, 4)
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
) => orders.map((order) => {
  const assignmentValid = order.assignedCrewId && validCrewIds?.has(order.assignedCrewId)
  if (assignmentValid) return order
  return { ...order, assignedCrewId: null, travelPhase: 'idle' as const }
})

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
      setConstructionSpeed: (speed) => {
        if (speed !== 0 && speed !== 1 && speed !== 2 && speed !== 3) return false
        const state = get()
        if (state.settlement.constructionSpeed === speed) return false
        set({
          settlement: { ...state.settlement, constructionSpeed: speed },
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
            JSON.stringify(before.settlement.constructionStockpile)
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
        const [nextState, result] = advanceSimulation(get(), input, actor, {
          beforeHour: advanceConstructionBeforeHour,
        })
        set(nextState)
        return result
      },
      advanceHours: (hours, actor = 'manual') => {
        const [nextState, result] = advanceSimulation(get(), { hours }, actor, {
          beforeHour: advanceConstructionBeforeHour,
        })
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
      version: 8,
      partialize: domainSnapshot,
      migrate: (persistedState, version) => {
        const initialState = createInitialState()
        if (version > 8) return initialState
        const state = persistedState as Partial<MoonbaseState>
        if (!state.settlement) return initialState
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
            ).orders
        const dependencySafeOrders = version < 7
          ? rebuildConstructionOrderPrerequisites(
              layout,
              normalizedOrders,
              constructionStock,
            ).orders
          : normalizedOrders
        const crewMembers = Array.isArray(state.crew) ? state.crew : initialState.crew
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
        )
        return {
          ...state,
          reserves: { ...state.reserves, constructionStock },
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
        const crewMembers = Array.isArray(persisted.crew)
          ? persisted.crew
          : currentState.crew
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
        )
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
      },
    },
  ),
)

export const useMoonbaseStore = useColonyStore
