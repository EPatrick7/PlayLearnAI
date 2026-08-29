import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { createInitialState } from './seed'
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
  CommitResult,
  LearningPhase,
  MoonbaseState,
  PlanActionInput,
  PlanBriefInput,
  PlanEditResult,
  PlanValidation,
  VerificationResult,
} from './types'

type InteractiveActor = 'manual' | 'agent'

export interface MoonbaseActions {
  resetColony: () => void
  resetMoonbase: () => void
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

const domainSnapshot = (state: MoonbaseStore): MoonbaseState => ({
  baseName: state.baseName,
  seed: state.seed,
  missionDay: state.missionDay,
  hour: state.hour,
  elapsedHours: state.elapsedHours,
  worldRevision: state.worldRevision,
  scenarioStatus: state.scenarioStatus,
  map: state.map,
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

export const useColonyStore = create<MoonbaseStore>()(
  persist(
    (set, get) => ({
      ...createInitialState(),
      resetColony: () => set(createInitialState()),
      resetMoonbase: () => set(createInitialState()),
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
        set(nextState)
        return result
      },
      advanceHours: (hours, actor = 'manual') => {
        const [nextState, result] = advanceSimulation(get(), { hours }, actor)
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
      version: 1,
      partialize: domainSnapshot,
    },
  ),
)

export const useMoonbaseStore = useColonyStore
