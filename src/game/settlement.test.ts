import { describe, expect, it } from 'vitest'
import { paintBoundaryCell } from './construction'
import { deriveConstructionOrders, projectConstructionOrders } from './constructionJobs'
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
  state = constructModule(state, 'solar_battery_skid', 'site-power-east', 'agent')[0]
  state = constructModule(state, 'life_support', 'site-bay-northwest', 'agent')[0]
  state = constructModule(state, 'airlock', 'site-bay-southeast', 'agent')[0]
  state = constructModule(state, 'laboratory', 'site-bay-northeast', 'agent')[0]
  state = constructModule(state, 'storage', 'site-bay-southwest', 'agent')[0]
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
  it('starts with a typed seven-socket layout and only the solar blueprint', () => {
    const state = createInitialState()

    expect(state.settlement).toMatchObject({
      phase: 'landing',
      builtModuleIds: ['module-habitat', 'module-corridor', 'module-landing-pad'],
    })
    expect(state.map).toEqual({ width: 24, height: 18 })
    expect(state.settlement.buildSites.map((site) => [site.id, site.kind])).toEqual([
      ['site-power-west', 'exterior_power'],
      ['site-power-east', 'exterior_power'],
      ['site-power-south', 'exterior_power'],
      ['site-bay-northwest', 'pressurized_bay'],
      ['site-bay-northeast', 'pressurized_bay'],
      ['site-bay-southwest', 'pressurized_bay'],
      ['site-bay-southeast', 'pressurized_bay'],
    ])
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
      'site-power-west',
      'manual',
    )

    expect(solarResult).toMatchObject({ ok: true, code: 'built', phase: 'power_online' })
    expect(powered.modules.find((module) => module.id === 'module-solar-skid')?.position).toEqual({
      x: 2,
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

    const [habitable] = constructModule(powered, 'life_support', 'site-bay-northwest')
    expect(habitable.settlement.phase).toBe('habitable')
    expect(availableBlueprintsFor(habitable).map((blueprint) => blueprint.id)).toEqual([
      'airlock',
    ])

    const [expanding] = constructModule(habitable, 'airlock', 'site-bay-southeast')
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

  it('rejects incompatible, locked, and occupied sockets without mutating the source', () => {
    const initial = createInitialState()

    const initialSnapshot = structuredClone(initial)
    const [incompatibleState, incompatible] = constructModule(
      initial,
      'solar_battery_skid',
      'site-bay-northwest',
    )
    expect(incompatible).toMatchObject({
      ok: false,
      code: 'incompatible_site',
      siteId: 'site-bay-northwest',
    })
    expect(incompatibleState).toBe(initial)
    expect(incompatibleState).toEqual(initialSnapshot)

    const [unchanged, locked] = constructModule(initial, 'life_support', 'site-bay-northwest')
    expect(locked).toMatchObject({ ok: false, code: 'blueprint_unavailable' })
    expect(unchanged).toBe(initial)

    const [powered] = constructModule(initial, 'solar_battery_skid', 'site-power-east')
    const [stillPowered, occupied] = constructModule(powered, 'life_support', 'site-power-east')
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
    const built = useColonyStore.getState().constructModule('solar_battery_skid', 'site-power-east')
    expect(built.ok).toBe(true)

    const saved = JSON.parse(localStorage.getItem('playlearnai-moonbase-poc-v1') ?? '{}') as {
      version?: number
      state?: MoonbaseState
    }
    expect(saved.version).toBe(6)
    expect(saved.state?.settlement).toMatchObject({
      phase: 'power_online',
      constructionOrders: [],
      constructionSequence: 1,
      buildSites: expect.arrayContaining([
        expect.objectContaining({ id: 'site-power-east', occupiedBy: 'solar_battery_skid' }),
      ]),
    })

    const migrate = useColonyStore.persist.getOptions().migrate
    expect(migrate).toBeTypeOf('function')
    const legacy = { ...createInitialState(), settlement: undefined }
    const migrated = await migrate!(legacy, 1) as MoonbaseState
    expect(migrated.settlement).toMatchObject({
      phase: 'landing',
      builtModuleIds: ['module-habitat', 'module-corridor', 'module-landing-pad'],
    })
    expect(migrated.settlement.buildSites.every((site) => site.occupiedBy === null)).toBe(true)

    const legacyV3 = JSON.parse(JSON.stringify(saved.state)) as Record<string, unknown>
    delete (legacyV3.settlement as Record<string, unknown>).layout
    const migratedV3 = await migrate!(legacyV3, 3) as MoonbaseState
    expect(migratedV3.worldRevision).toBe(saved.state?.worldRevision)
    expect(migratedV3.settlement).toMatchObject({
      phase: 'power_online',
      buildSites: expect.arrayContaining([
        expect.objectContaining({ id: 'site-power-east', occupiedBy: 'solar_battery_skid' }),
      ]),
    })
    expect(migratedV3.settlement.layout.boundaries).toHaveLength(16)
    expect(migratedV3.settlement.constructionOrders).toEqual([])
    expect(migratedV3.settlement.constructionSequence).toBe(1)

    const plannedWall = paintBoundaryCell(
      saved.state!.settlement.layout,
      { x: 9, y: 6 },
      'wall',
    )
    const currentOrders = deriveConstructionOrders(
      saved.state!.settlement.layout,
      plannedWall,
      { commandId: 'legacy-command', priority: 3, sequenceStart: 4 },
    )
    const legacyOrders = currentOrders.map((order) => {
      const legacy = {
        ...order,
        status: 'building' as const,
        assignedCrewId: 'crew-amina-okafor',
        materials: {
          required: order.materials.required,
          delivered: order.materials.required,
        },
        work: { ...order.work, completed: 0.5 },
      } as Partial<typeof order>
      delete legacy.block
      return legacy
    })
    const legacyV5 = structuredClone(saved.state!) as unknown as Record<string, unknown>
    ;(legacyV5.settlement as Record<string, unknown>).constructionOrders = legacyOrders
    ;(legacyV5.settlement as Record<string, unknown>).constructionSequence = 1
    const migratedV5 = await migrate!(legacyV5, 5) as MoonbaseState
    expect(migratedV5.reserves.constructionStock).toBe(saved.state?.reserves.constructionStock)
    expect(migratedV5.settlement.constructionSequence).toBe(5)
    expect(migratedV5.settlement.constructionOrders[0]).toMatchObject({
      status: 'hauling',
      assignedCrewId: null,
      block: null,
      materials: { required: 1, reserved: 1, delivered: 0, recoverable: 0 },
      work: { required: 1, completed: 0 },
    })

    const merge = useColonyStore.persist.getOptions().merge
    expect(merge).toBeTypeOf('function')
    const malformedCurrentVersion = structuredClone(saved.state!) as unknown as Record<string, unknown>
    delete (malformedCurrentVersion.settlement as Record<string, unknown>).layout
    const recovered = merge!(malformedCurrentVersion, useColonyStore.getState())
    expect(recovered.settlement.layout.boundaries).toHaveLength(16)

    const staleCurrentVersion = structuredClone(saved.state!) as unknown as Record<string, unknown>
    ;(staleCurrentVersion.settlement as Record<string, unknown>).constructionOrders = [{
      ...currentOrders[0],
      materials: undefined,
      work: undefined,
    }]
    ;(staleCurrentVersion.settlement as Record<string, unknown>).constructionSequence = 1
    const normalized = merge!(staleCurrentVersion, useColonyStore.getState())
    expect(normalized.settlement.constructionSequence).toBe(5)
    expect(normalized.settlement.constructionOrders[0]).toMatchObject({
      id: 'legacy-command:4',
      operation: 'construct',
      materials: { required: 1, reserved: 1, delivered: 0, recoverable: 0 },
      work: { required: 1, completed: 0 },
    })

    const malformedLegacyV5 = structuredClone(legacyV5)
    ;(malformedLegacyV5.settlement as Record<string, unknown>).constructionOrders = [
      null,
      ...legacyOrders,
    ]
    const filteredV5 = await migrate!(malformedLegacyV5, 5) as MoonbaseState
    expect(filteredV5.settlement.constructionOrders).toHaveLength(1)

    const future = await migrate!(saved.state, 7) as MoonbaseState
    expect(future).toMatchObject({ worldRevision: 1, settlement: { phase: 'landing' } })
  })

  it('refunds staged material from dependent jobs when one blueprint is cancelled', () => {
    const initial = createInitialState()
    const wallOrders = deriveConstructionOrders(
      initial.settlement.layout,
      paintBoundaryCell(initial.settlement.layout, { x: 10, y: 6 }, 'wall'),
      { commandId: 'wall', sequenceStart: 1 },
    )
    const projected = projectConstructionOrders(
      initial.settlement.layout,
      wallOrders,
    ).layout
    const doorOrders = deriveConstructionOrders(
      projected,
      paintBoundaryCell(projected, { x: 10, y: 6 }, 'door'),
      { commandId: 'door', sequenceStart: 2 },
    )
    const staged = [...wallOrders, ...doorOrders].map((order) => ({
      ...order,
      status: 'building' as const,
      block: null,
      materials: {
        ...order.materials,
        reserved: 0,
        delivered: order.materials.required,
      },
    }))
    useColonyStore.setState({
      settlement: {
        ...initial.settlement,
        constructionOrders: staged,
        constructionSequence: 3,
      },
      reserves: {
        ...initial.reserves,
        constructionStock: initial.reserves.constructionStock - 2,
      },
    })

    expect(useColonyStore.getState().cancelConstructionOrder('wall:1')).toBe(true)
    expect(useColonyStore.getState().settlement.constructionOrders).toEqual([])
    expect(useColonyStore.getState().reserves.constructionStock).toBe(
      initial.reserves.constructionStock,
    )
    useColonyStore.getState().resetColony()
  })
})
