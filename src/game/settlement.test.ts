import { describe, expect, it } from 'vitest'
import { createInitialState } from './seed'
import {
  advanceSimulation,
  commitOperationsPlan,
  setPlanBrief,
  stagePlanAction,
  validateOperationsPlan,
} from './simulation'
import {
  availableBlueprintsFor,
  beginOperations,
  buildBlueprints,
  buildProgressFor,
  constructModule,
} from './settlement'
import { useColonyStore } from './store'
import type { MoonbaseState, PlanActionInput } from './types'

const establishBase = () => {
  let state = createInitialState()
  state = constructModule(state, 'solar_battery_skid', 'site-east-ridge', 'agent')[0]
  state = constructModule(state, 'life_support', 'site-south-shelf', 'agent')[0]
  state = constructModule(state, 'airlock', 'site-north-shelf', 'agent')[0]
  state = constructModule(state, 'laboratory', 'site-north-ridge', 'agent')[0]
  state = constructModule(state, 'storage', 'site-east-apron', 'agent')[0]
  return state
}

const incidentActions: PlanActionInput[] = [
  { kind: 'assign_crew', crewId: 'crew-mateo-alvarez', workOrderId: 'work-seal-lab' },
  { kind: 'reserve_equipment', equipmentId: 'equipment-eva-01', workOrderId: 'work-seal-lab' },
  { kind: 'reserve_equipment', equipmentId: 'equipment-engineering-01', workOrderId: 'work-seal-lab' },
  { kind: 'assign_crew', crewId: 'crew-soo-jin-park', workOrderId: 'work-repressurize-lab' },
  { kind: 'reserve_equipment', equipmentId: 'equipment-engineering-02', workOrderId: 'work-repressurize-lab' },
  { kind: 'assign_crew', crewId: 'crew-leila-haddad', workOrderId: 'work-research-sintering' },
  { kind: 'assign_crew', crewId: 'crew-nia-kimani', workOrderId: 'work-clean-solar' },
  { kind: 'reserve_equipment', equipmentId: 'equipment-eva-02', workOrderId: 'work-clean-solar' },
  { kind: 'reserve_equipment', equipmentId: 'equipment-rover-01', workOrderId: 'work-clean-solar' },
]

const stageIncident = (source: MoonbaseState) => {
  let state = setPlanBrief(source, {
    objective: 'restore_lab_and_research_sintering',
    constraints: { oxygenFloorHours: 12, protectedCrewIds: [] },
    horizonHours: 12,
    stopCondition: { kind: 'objective_complete' },
  }, 'agent')[0]
  for (const action of incidentActions) state = stagePlanAction(state, action, 'agent')[0]
  return state
}

describe('tiny-start settlement construction', () => {
  it('starts with two revealed structures, five vacant sites, and the solar blueprint', () => {
    const state = createInitialState()

    expect(state.settlement).toMatchObject({
      phase: 'landing',
      builtModuleIds: ['module-habitat', 'module-landing-pad'],
    })
    expect(state.settlement.buildSites).toHaveLength(5)
    expect(state.settlement.buildSites.every((site) => site.occupiedBy === null)).toBe(true)
    expect(state.reserves.constructionStock).toBe(14)
    expect(buildBlueprints.reduce((total, blueprint) => total + blueprint.cost, 0)).toBe(14)
    expect(availableBlueprintsFor(state).map((blueprint) => blueprint.id)).toEqual([
      'solar_battery_skid',
    ])
    expect(buildProgressFor(state)).toEqual({ built: 0, total: 5, percent: 0 })
  })

  it('persists the chosen site in module geometry and advances the establishment phases', () => {
    const initial = createInitialState()
    const [powered, solarResult] = constructModule(
      initial,
      'solar_battery_skid',
      'site-east-ridge',
      'manual',
    )

    expect(solarResult).toMatchObject({ ok: true, code: 'built', phase: 'power_online' })
    expect(powered.modules.find((module) => module.id === 'module-solar-skid')?.position).toEqual({
      x: 14,
      y: 1,
      width: 5,
      height: 4,
    })
    expect(powered.reserves.constructionStock).toBe(11)
    expect(initial.modules.find((module) => module.id === 'module-solar-skid')?.position).not.toEqual(
      powered.modules.find((module) => module.id === 'module-solar-skid')?.position,
    )
    expect(availableBlueprintsFor(powered).map((blueprint) => blueprint.id)).toEqual([
      'life_support',
    ])

    const [habitable] = constructModule(powered, 'life_support', 'site-south-shelf')
    expect(habitable.settlement.phase).toBe('habitable')
    expect(availableBlueprintsFor(habitable).map((blueprint) => blueprint.id)).toEqual([
      'airlock',
    ])

    const [expanding] = constructModule(habitable, 'airlock', 'site-north-shelf')
    expect(expanding.settlement.phase).toBe('expanding')
    expect(availableBlueprintsFor(expanding).map((blueprint) => blueprint.id)).toEqual([
      'storage',
      'laboratory',
    ])

    const ready = establishBase()
    expect(ready.settlement.phase).toBe('ready')
    expect(ready.reserves.constructionStock).toBe(0)
    expect(buildProgressFor(ready)).toEqual({ built: 5, total: 5, percent: 100 })
    expect(availableBlueprintsFor(ready)).toEqual([])
  })

  it('rejects locked blueprints and occupied sites without mutating the source', () => {
    const initial = createInitialState()
    const [unchanged, locked] = constructModule(initial, 'life_support', 'site-north-ridge')
    expect(locked).toMatchObject({ ok: false, code: 'blueprint_unavailable' })
    expect(unchanged).toBe(initial)

    const [powered] = constructModule(initial, 'solar_battery_skid', 'site-north-ridge')
    const [stillPowered, occupied] = constructModule(powered, 'life_support', 'site-north-ridge')
    expect(occupied).toMatchObject({ ok: false, code: 'site_occupied' })
    expect(stillPowered).toBe(powered)
    expect(stillPowered.reserves.constructionStock).toBe(11)
  })

  it('reveals operations only when ready and preserves the complete emergency simulation', () => {
    const initial = createInitialState()
    const [notStarted, early] = beginOperations(initial)
    expect(early).toMatchObject({ ok: false, code: 'not_ready', phase: 'landing' })
    expect(notStarted).toBe(initial)

    const ready = establishBase()
    const laboratoryPosition = ready.modules.find((module) => module.id === 'module-laboratory')!.position
    const [operations, started] = beginOperations(ready, 'agent')
    expect(started).toMatchObject({ ok: true, code: 'operations_started', phase: 'operations' })
    expect(operations.settlement.builtModuleIds).toHaveLength(8)
    expect(operations.modules.find((module) => module.id === 'module-laboratory')?.position).toEqual(
      laboratoryPosition,
    )
    expect(operations.operationsPlan.basedOnWorldRevision).toBe(operations.worldRevision)

    const planned = stageIncident(operations)
    expect(validateOperationsPlan(planned).valid).toBe(true)
    const [committed, commit] = commitOperationsPlan(
      planned,
      planned.worldRevision,
      planned.operationsPlan.revision,
      'agent',
    )
    expect(commit.ok).toBe(true)

    const [finished, advance] = advanceSimulation(committed, { hours: 12 }, 'agent')
    expect(advance).toMatchObject({ advancedHours: 10, stopReason: 'objective_complete' })
    expect(finished.scenarioStatus).toBe('objective_complete')
    expect(finished.lab).toMatchObject({ breached: false, atmosphere: 'yes', sealed: true })
  })

  it('persists site occupancy and safely replaces a legacy v1 save', async () => {
    localStorage.clear()
    useColonyStore.getState().resetColony()
    const built = useColonyStore.getState().constructModule('solar_battery_skid', 'site-east-ridge')
    expect(built.ok).toBe(true)

    const saved = JSON.parse(localStorage.getItem('playlearnai-moonbase-poc-v1') ?? '{}') as {
      version?: number
      state?: MoonbaseState
    }
    expect(saved.version).toBe(2)
    expect(saved.state?.settlement).toMatchObject({
      phase: 'power_online',
      buildSites: expect.arrayContaining([
        expect.objectContaining({ id: 'site-east-ridge', occupiedBy: 'solar_battery_skid' }),
      ]),
    })

    const migrate = useColonyStore.persist.getOptions().migrate
    expect(migrate).toBeTypeOf('function')
    const legacy = { ...createInitialState(), settlement: undefined }
    const migrated = await migrate!(legacy, 1) as MoonbaseState
    expect(migrated.settlement).toMatchObject({
      phase: 'landing',
      builtModuleIds: ['module-habitat', 'module-landing-pad'],
    })
    expect(migrated.settlement.buildSites.every((site) => site.occupiedBy === null)).toBe(true)
  })
})
