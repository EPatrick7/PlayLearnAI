import { incidentProfileMetadataForSeed } from './incidentProfiles'
import type {
  MoonbaseState,
  PlanActionInput,
  StopCondition,
  WorkOrderId,
} from './types'

const dustMitigationActions: readonly PlanActionInput[] = [
  { kind: 'assign_crew', crewId: 'crew-nia-kimani', workOrderId: 'work-clean-solar' },
  { kind: 'reserve_equipment', equipmentId: 'equipment-eva-02', workOrderId: 'work-clean-solar' },
  { kind: 'reserve_equipment', equipmentId: 'equipment-rover-01', workOrderId: 'work-clean-solar' },
]

const completeRecoveryActions: readonly PlanActionInput[] = [
  { kind: 'assign_crew', crewId: 'crew-mateo-alvarez', workOrderId: 'work-seal-lab' },
  { kind: 'reserve_equipment', equipmentId: 'equipment-eva-01', workOrderId: 'work-seal-lab' },
  { kind: 'reserve_equipment', equipmentId: 'equipment-engineering-01', workOrderId: 'work-seal-lab' },
  { kind: 'assign_crew', crewId: 'crew-soo-jin-park', workOrderId: 'work-repressurize-lab' },
  { kind: 'reserve_equipment', equipmentId: 'equipment-eva-03', workOrderId: 'work-repressurize-lab' },
  { kind: 'reserve_equipment', equipmentId: 'equipment-engineering-02', workOrderId: 'work-repressurize-lab' },
  { kind: 'assign_crew', crewId: 'crew-leila-haddad', workOrderId: 'work-research-sintering' },
  ...dustMitigationActions,
]

const leakingMarginFirstActions: readonly PlanActionInput[] = [
  { kind: 'assign_crew', crewId: 'crew-mateo-alvarez', workOrderId: 'work-seal-lab' },
  { kind: 'reserve_equipment', equipmentId: 'equipment-eva-01', workOrderId: 'work-seal-lab' },
  { kind: 'reserve_equipment', equipmentId: 'equipment-engineering-02', workOrderId: 'work-seal-lab' },
  ...dustMitigationActions,
]

const repressurizeWithReusedKitActions: readonly PlanActionInput[] = [
  { kind: 'assign_crew', crewId: 'crew-soo-jin-park', workOrderId: 'work-repressurize-lab' },
  { kind: 'reserve_equipment', equipmentId: 'equipment-eva-03', workOrderId: 'work-repressurize-lab' },
  { kind: 'reserve_equipment', equipmentId: 'equipment-engineering-02', workOrderId: 'work-repressurize-lab' },
]

const researchFinalActions: readonly PlanActionInput[] = [
  { kind: 'assign_crew', crewId: 'crew-leila-haddad', workOrderId: 'work-research-sintering' },
]

export interface RecommendedOperationsResponse {
  actions: PlanActionInput[]
  detail: string
  horizonHours: number
  rationale: string
  stopCondition: StopCondition
}

/**
 * One shared, inspectable response proposal for both the visible UI and Site
 * tools. It adapts to the seeded incident and filters work that is already
 * complete, but never commits or advances the simulation.
 */
export const recommendedOperationsResponse = (
  state: Pick<MoonbaseState, 'scenarioStatus' | 'seed' | 'workOrders'>,
): RecommendedOperationsResponse | null => {
  if (state.scenarioStatus === 'objective_complete') return null

  const incomplete = (workOrderId: WorkOrderId) => (
    state.workOrders.find((order) => order.id === workOrderId)?.status !== 'complete'
  )
  const profile = incidentProfileMetadataForSeed(state.seed)

  if (profile.id === 'leaking_margin') {
    if (incomplete('work-seal-lab')) {
      const actions = leakingMarginFirstActions.filter((action) => incomplete(action.workOrderId))
      const solarPending = incomplete('work-clean-solar')
      return {
        actions: [...actions],
        detail: solarPending ? 'Seal + solar first milestone' : 'Seal breach milestone',
        horizonHours: 8,
        rationale: profile.planningFocus,
        stopCondition: { kind: 'work_order_complete', workOrderId: 'work-seal-lab' },
      }
    }
    if (incomplete('work-repressurize-lab')) {
      return {
        actions: [...repressurizeWithReusedKitActions],
        detail: 'Repressurize with reused kit',
        horizonHours: 8,
        rationale: profile.planningFocus,
        stopCondition: { kind: 'work_order_complete', workOrderId: 'work-repressurize-lab' },
      }
    }
    if (incomplete('work-research-sintering')) {
      return {
        actions: [...researchFinalActions],
        detail: 'Research final milestone',
        horizonHours: 8,
        rationale: profile.planningFocus,
        stopCondition: { kind: 'work_order_complete', workOrderId: 'work-research-sintering' },
      }
    }
    return null
  }

  const actions = completeRecoveryActions.filter((action) => incomplete(action.workOrderId))
  return actions.length > 0
    ? {
        actions,
        detail: 'Complete safe response',
        horizonHours: 12,
        rationale: profile.planningFocus,
        stopCondition: { kind: 'objective_complete' },
      }
    : null
}
