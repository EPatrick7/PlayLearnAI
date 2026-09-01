import { describe, expect, it } from 'vitest'
import {
  INCIDENT_PROFILE_METADATA,
  incidentProfileForSeed,
  incidentProfileMetadataForSeed,
} from './incidentProfiles'
import { createInitialState, MOONBASE_SEED } from './seed'
import {
  advanceSimulation,
  clearOperationsPlan,
  commitOperationsPlan,
  recordLearningEvidence,
  setPlanBrief,
  stagePlanAction,
  validateOperationsPlan,
  verifyOperationsPlan,
} from './simulation'
import type { MoonbaseState, PlanActionInput } from './types'

const responseActions: PlanActionInput[] = [
  { kind: 'assign_crew', crewId: 'crew-mateo-alvarez', workOrderId: 'work-seal-lab' },
  { kind: 'reserve_equipment', equipmentId: 'equipment-eva-01', workOrderId: 'work-seal-lab' },
  { kind: 'reserve_equipment', equipmentId: 'equipment-engineering-01', workOrderId: 'work-seal-lab' },
  { kind: 'assign_crew', crewId: 'crew-soo-jin-park', workOrderId: 'work-repressurize-lab' },
  { kind: 'reserve_equipment', equipmentId: 'equipment-eva-03', workOrderId: 'work-repressurize-lab' },
  { kind: 'reserve_equipment', equipmentId: 'equipment-engineering-02', workOrderId: 'work-repressurize-lab' },
  { kind: 'assign_crew', crewId: 'crew-leila-haddad', workOrderId: 'work-research-sintering' },
  { kind: 'assign_crew', crewId: 'crew-nia-kimani', workOrderId: 'work-clean-solar' },
  { kind: 'reserve_equipment', equipmentId: 'equipment-eva-02', workOrderId: 'work-clean-solar' },
  { kind: 'reserve_equipment', equipmentId: 'equipment-rover-01', workOrderId: 'work-clean-solar' },
]

const prepareResponse = (seed: number): MoonbaseState => {
  const initial = createInitialState(seed)
  let state: MoonbaseState = {
    ...initial,
    settlement: { ...initial.settlement, phase: 'operations' },
  }
  state = setPlanBrief(state, {
    objective: 'restore_lab_and_research_sintering',
    constraints: { oxygenFloorHours: 12, protectedCrewIds: ['crew-jonah-reed'] },
    horizonHours: 12,
    stopCondition: { kind: 'objective_complete' },
  }, 'agent')[0]

  for (const action of responseActions) {
    state = stagePlanAction(state, action, 'agent')[0]
  }

  return state
}

describe('deterministic incident profiles', () => {
  it('selects stable profiles from normalized seeds and preserves the reference default', () => {
    const fractional = createInitialState(2.9)
    const normalized = createInitialState(2)
    expect(fractional).toEqual({ ...normalized, runId: fractional.runId })

    const invalid = createInitialState(Number.NaN)
    const zero = createInitialState(0)
    expect(invalid).toEqual({ ...zero, runId: invalid.runId })
    expect(incidentProfileForSeed(-2).id).toBe(incidentProfileForSeed(2).id)

    const reference = createInitialState()
    expect(reference.seed).toBe(MOONBASE_SEED)
    expect(incidentProfileMetadataForSeed(MOONBASE_SEED).id).toBe('balanced_front')
    expect(reference.reserves.oxygenHours).toBe(32)
    expect(reference.power).toMatchObject({ batteryKwh: 30, batteryCapacityKwh: 40 })
    expect(reference.dust).toMatchObject({
      startsAtHour: 3,
      baseDeratePercent: 50,
      mitigatedDeratePercent: 15,
    })
  })

  it('exports human-readable metadata for every distinct balance profile', () => {
    expect(INCIDENT_PROFILE_METADATA.map((profile) => profile.id)).toEqual([
      'leaking_margin',
      'balanced_front',
      'power_window',
    ])
    expect(INCIDENT_PROFILE_METADATA.every((profile) => (
      profile.name.length > 0 && profile.summary.length > 20 && profile.planningFocus.length > 20
    ))).toBe(true)
  })

  it('creates meaningfully different but compensating operational pressures', () => {
    const leakingMargin = createInitialState(0)
    const balancedFront = createInitialState(1)
    const powerWindow = createInitialState(2)

    expect(leakingMargin.reserves.oxygenHours).toBeLessThan(balancedFront.reserves.oxygenHours)
    expect(leakingMargin.dust.startsAtHour).toBeGreaterThan(balancedFront.dust.startsAtHour)
    expect(leakingMargin.dust.baseDeratePercent).toBeLessThan(balancedFront.dust.baseDeratePercent)
    expect(leakingMargin.workOrders.find((order) => order.id === 'work-seal-lab')?.durationHours).toBe(3)
    expect(leakingMargin.equipment.find((item) => item.id === 'equipment-eva-01')?.condition).toBe(74)
    expect(leakingMargin.equipment.find((item) => item.id === 'equipment-engineering-01')?.condition).toBe(60)

    expect(powerWindow.reserves.oxygenHours).toBeGreaterThan(balancedFront.reserves.oxygenHours)
    expect(powerWindow.dust.startsAtHour).toBeLessThan(balancedFront.dust.startsAtHour)
    expect(powerWindow.dust.baseDeratePercent).toBeGreaterThan(balancedFront.dust.baseDeratePercent)
    expect(powerWindow.power.batteryCapacityKwh).toBeLessThan(balancedFront.power.batteryCapacityKwh)
    expect(powerWindow.equipment.find((item) => item.id === 'equipment-rover-01')?.condition).toBe(68)
  })

  it.each([
    { seed: 1, profileId: 'balanced_front' },
    { seed: 2, profileId: 'power_window' },
  ])('keeps the $profileId profile solvable by the baseline response', ({ seed, profileId }) => {
    expect(incidentProfileMetadataForSeed(seed).id).toBe(profileId)
    const planned = prepareResponse(seed)
    const validation = validateOperationsPlan(planned)
    expect(validation.valid).toBe(true)
    expect(validation.preview.projectedOxygenHours).toBeGreaterThanOrEqual(12)
    expect(validation.preview.projectedBatteryKwh).toBeGreaterThan(0)

    const [committed, commit] = commitOperationsPlan(
      planned,
      planned.worldRevision,
      planned.operationsPlan.revision,
      'agent',
    )
    expect(commit.ok).toBe(true)

    const [finished, advance] = advanceSimulation(committed, { hours: 12 }, 'agent')
    expect(advance.stopReason).toBe('objective_complete')
    expect(advance.advancedHours).toBeLessThanOrEqual(12)
    expect(finished.scenarioStatus).toBe('objective_complete')
    expect(finished.reserves.minimumOxygenHours).toBeGreaterThanOrEqual(12)
    expect(finished.power.batteryKwh).toBeGreaterThan(0)
    expect(finished.power.status).not.toBe('critical')

    const [, verification] = verifyOperationsPlan(finished, 'agent')
    expect(verification.status).toBe('success')
    expect(verification.checks.every((check) => check.passed)).toBe(true)
  })

  it('makes Leaking Margin a safe equipment-reuse recovery instead of the baseline answer', () => {
    const baseline = prepareResponse(0)
    expect(validateOperationsPlan(baseline)).toMatchObject({
      valid: false,
      issues: expect.arrayContaining([
        expect.objectContaining({
          code: 'equipment_condition',
          targetId: 'equipment-engineering-01',
        }),
      ]),
    })

    const runMilestone = (
      source: MoonbaseState,
      workOrderId: 'work-seal-lab' | 'work-repressurize-lab' | 'work-research-sintering',
      actions: PlanActionInput[],
    ) => {
      let planned = recordLearningEvidence(
        source,
        'ground',
        `Inspected fresh incident telemetry before planning ${workOrderId}.`,
        'agent',
        { groundingKind: 'incident_telemetry' },
      )
      planned = recordLearningEvidence(
        planned,
        'ground',
        `Compared fresh crew and equipment evidence before planning ${workOrderId}.`,
        'agent',
        { groundingKind: 'crew_equipment_comparison' },
      )
      planned = clearOperationsPlan(planned, 'agent')[0]
      planned = setPlanBrief(planned, {
        objective: 'restore_lab_and_research_sintering',
        constraints: { oxygenFloorHours: 12, protectedCrewIds: ['crew-jonah-reed'] },
        horizonHours: 12,
        stopCondition: { kind: 'work_order_complete', workOrderId },
      }, 'agent')[0]
      for (const action of actions) planned = stagePlanAction(planned, action, 'agent')[0]

      expect(validateOperationsPlan(planned).valid).toBe(true)
      const [committed, commit] = commitOperationsPlan(
        planned,
        planned.worldRevision,
        planned.operationsPlan.revision,
        'agent',
      )
      expect(commit.ok).toBe(true)
      const [advanced] = advanceSimulation(committed, { hours: 12 }, 'agent')
      const [verified, verification] = verifyOperationsPlan(advanced, 'agent')
      expect(verification.status).toBe('success')
      return verified
    }

    const initial = createInitialState(0)
    let state: MoonbaseState = {
      ...initial,
      settlement: { ...initial.settlement, phase: 'operations' },
    }
    state = runMilestone(state, 'work-seal-lab', [
      { kind: 'assign_crew', crewId: 'crew-mateo-alvarez', workOrderId: 'work-seal-lab' },
      { kind: 'reserve_equipment', equipmentId: 'equipment-eva-01', workOrderId: 'work-seal-lab' },
      { kind: 'reserve_equipment', equipmentId: 'equipment-engineering-02', workOrderId: 'work-seal-lab' },
      ...responseActions.slice(7),
    ])
    state = runMilestone(state, 'work-repressurize-lab', [
      { kind: 'assign_crew', crewId: 'crew-soo-jin-park', workOrderId: 'work-repressurize-lab' },
      { kind: 'reserve_equipment', equipmentId: 'equipment-eva-03', workOrderId: 'work-repressurize-lab' },
      { kind: 'reserve_equipment', equipmentId: 'equipment-engineering-02', workOrderId: 'work-repressurize-lab' },
    ])
    state = runMilestone(state, 'work-research-sintering', [
      { kind: 'assign_crew', crewId: 'crew-leila-haddad', workOrderId: 'work-research-sintering' },
    ])

    expect(state.scenarioStatus).toBe('objective_complete')
    expect(state.reserves.minimumOxygenHours).toBeGreaterThanOrEqual(12)
    expect(state.power.status).not.toBe('critical')
    expect(state.learning.completedLoops).toBe(3)
  })

  it('reports each profile’s actual active dust derate', () => {
    const initial = createInitialState(2)
    const operations: MoonbaseState = {
      ...initial,
      settlement: { ...initial.settlement, phase: 'operations' },
    }
    const [advanced] = advanceSimulation(operations, { hours: 1 }, 'agent')

    expect(advanced.alerts).toContainEqual(expect.objectContaining({
      id: 'alert-dust-active',
      title: 'Dust derate: 65%',
      detail: expect.stringContaining('8.4 kW solar output'),
    }))
  })
})
