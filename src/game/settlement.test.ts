import { describe, expect, it } from 'vitest'
import {
  CONSTRUCTION_GRID_HEIGHT,
  CONSTRUCTION_GRID_WIDTH,
  eraseAt,
  offsetPresetPoint,
  offsetStarterPoint,
  paintBoundaryCell,
  paintBoundaryLine,
  placeWorkstation,
  removeWorkstation,
  type ConstructionLayout,
  type ConstructionResult,
} from './construction'
import {
  deriveConstructionOrders,
  projectConstructionOrders,
  type ConstructionOrder,
} from './constructionJobs'
import { incidentProfileMetadataForSeed } from './incidentProfiles'
import {
  analyzeConstructionPressure,
  constructionEnvironmentAt,
} from './pressureTopology'
import { createInitialState, isOpaqueRunId, nextIncidentSeed } from './seed'
import {
  advanceSimulation,
  commitOperationsPlan,
  deriveAlerts,
  recordLearningEvidence,
  setPlanBrief,
  stagePlanAction,
  validateOperationsPlan,
  verifyOperationsPlan,
} from './simulation'
import {
  availableBlueprintsFor,
  beginOperations,
  buildBlueprints,
  buildProgressFor,
  canBeginOperations,
  constructModule,
} from './settlement'
import { useColonyStore } from './store'
import type { MoonbaseState, PlanActionInput } from './types'

const layoutFrom = (result: ConstructionResult) => {
  if (!result.ok) throw new Error(`${result.code}: ${result.error}`)
  return result.layout
}

const projectExpansionShell = (source: ConstructionLayout) => {
  let layout = layoutFrom(
    paintBoundaryLine(source, { x: 12, y: 3 }, { x: 17, y: 3 }, 'wall'),
  )
  layout = layoutFrom(
    paintBoundaryLine(layout, { x: 12, y: 8 }, { x: 17, y: 8 }, 'wall'),
  )
  layout = layoutFrom(
    paintBoundaryLine(layout, { x: 12, y: 4 }, { x: 12, y: 7 }, 'wall'),
  )
  return paintBoundaryLine(layout, { x: 17, y: 4 }, { x: 17, y: 7 }, 'wall')
}

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
  { kind: 'reserve_equipment', equipmentId: 'equipment-eva-03', workOrderId: 'work-repressurize-lab' },
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

const legacyV12RepressurizationState = () => {
  const state = createInitialState()
  state.settlement.phase = 'operations'
  state.lab = {
    ...state.lab,
    atmosphere: 'no',
    breached: false,
    sealed: true,
  }
  const labModule = state.modules.find((module) => module.location === 'laboratory')!
  labModule.atmosphere = 'no'
  labModule.breached = false

  state.crew.forEach((member) => {
    member.taskId = null
    member.status = 'idle'
    delete member.equippedEvaSuitId
  })
  const engineer = state.crew.find((member) => member.id === 'crew-soo-jin-park')!
  engineer.location = 'laboratory'
  engineer.taskId = 'work-repressurize-lab'
  engineer.status = 'working'

  const seal = state.workOrders.find((order) => order.id === 'work-seal-lab')!
  seal.status = 'complete'
  seal.progressHours = seal.durationHours
  seal.completedAtHour = 0
  seal.assignedCrewIds = []
  seal.reservedEquipmentIds = []

  const repressurize = state.workOrders.find(
    (order) => order.id === 'work-repressurize-lab',
  )!
  repressurize.hazard = 'indoor'
  repressurize.requiredEquipment = ['engineering_kit']
  repressurize.status = 'active'
  repressurize.assignedCrewIds = [engineer.id]
  repressurize.reservedEquipmentIds = ['equipment-engineering-02']
  repressurize.progressHours = 1
  repressurize.logisticsHoursRemaining = 0
  repressurize.startedAtHour = 0

  const engineeringKit = state.equipment.find(
    (item) => item.id === 'equipment-engineering-02',
  )!
  engineeringKit.status = 'deployed'
  engineeringKit.location = 'laboratory'
  engineeringKit.reservedForWorkOrderId = repressurize.id
  engineeringKit.assignedCrewId = engineer.id

  const reusableSuit = state.equipment.find((item) => item.id === 'equipment-eva-01')!
  reusableSuit.status = 'available'
  reusableSuit.location = 'laboratory'
  reusableSuit.reservedForWorkOrderId = null
  reusableSuit.assignedCrewId = null
  state.equipment = state.equipment.filter((item) => item.id !== 'equipment-eva-03')

  state.operationsPlan = {
    ...state.operationsPlan,
    status: 'committed',
    revision: 8,
    basedOnWorldRevision: state.worldRevision,
    objective: 'restore_lab_and_research_sintering',
    constraints: { oxygenFloorHours: 12, protectedCrewIds: [] },
    horizonHours: 12,
    stopCondition: { kind: 'objective_complete' },
    actions: [
      {
        id: 'legacy-assign-repressurize',
        kind: 'assign_crew',
        crewId: engineer.id,
        workOrderId: repressurize.id,
      },
      {
        id: 'legacy-reserve-engineering-kit',
        kind: 'reserve_equipment',
        equipmentId: engineeringKit.id,
        workOrderId: repressurize.id,
      },
    ],
    committedAtHour: 0,
    baseline: {
      worldRevision: state.worldRevision,
      elapsedHours: 0,
      oxygenHours: state.reserves.oxygenHours,
      batteryKwh: state.power.batteryKwh,
      completedWorkOrderIds: ['work-seal-lab'],
    },
  }
  return state
}

describe('tiny-start settlement construction', () => {
  it('keeps instant construction mutations out of the public store contract', () => {
    const publicStore = useColonyStore.getState() as unknown as Record<string, unknown>

    expect(publicStore).not.toHaveProperty('setConstructionLayout')
    expect(publicStore).not.toHaveProperty('constructModule')
  })

  it('starts with a typed seven-socket layout and only the solar blueprint', () => {
    const state = createInitialState()

    expect(state.settlement).toMatchObject({
      phase: 'landing',
      builtModuleIds: ['module-habitat', 'module-corridor', 'module-landing-pad'],
    })
    expect(state.map).toEqual({
      width: CONSTRUCTION_GRID_WIDTH,
      height: CONSTRUCTION_GRID_HEIGHT,
    })
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
    expect(state.reserves.constructionStock).toBe(30)
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
      ...offsetPresetPoint({ x: 2, y: 1 }),
      width: 5,
      height: 4,
    })
    expect(powered.reserves.constructionStock).toBe(27)
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
    expect(ready.reserves.constructionStock).toBe(16)
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
    expect(stillPowered.reserves.constructionStock).toBe(27)
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
    const [builtState, built] = constructModule(
      createInitialState(),
      'solar_battery_skid',
      'site-power-east',
    )
    expect(built.ok).toBe(true)
    useColonyStore.setState((store) => ({ ...store, ...builtState }))
    expect(useColonyStore.getState().setConstructionSpeed(3)).toBe(true)

    const saved = JSON.parse(localStorage.getItem('playlearnai-moonbase-poc-v1') ?? '{}') as {
      version?: number
      state?: MoonbaseState
    }
    expect(saved.version).toBe(15)
    expect(saved.state).toMatchObject({
      runSequence: useColonyStore.getState().runSequence,
      runId: useColonyStore.getState().runId,
    })
    expect(saved.state?.settlement).toMatchObject({
      phase: 'power_online',
      constructionOrders: [],
      constructionSequence: 1,
      constructionSpeed: 3,
      constructionStockpile: offsetStarterPoint({ x: 8, y: 9 }),
      constructionCrew: expect.arrayContaining([
        expect.objectContaining({ crewId: 'crew-amina-okafor' }),
      ]),
      buildSites: expect.arrayContaining([
        expect.objectContaining({ id: 'site-power-east', occupiedBy: 'solar_battery_skid' }),
      ]),
    })

    const migrate = useColonyStore.persist.getOptions().migrate
    expect(migrate).toBeTypeOf('function')
    const legacyV11 = structuredClone(saved.state!) as Partial<MoonbaseState>
    delete legacyV11.runSequence
    legacyV11.runId = `moonbase-${legacyV11.seed}-run-1`
    const migratedV11 = await migrate!(legacyV11, 11) as MoonbaseState
    expect(migratedV11).toMatchObject({
      runSequence: 1,
    })
    expect(isOpaqueRunId(migratedV11.runId)).toBe(true)
    expect(migratedV11.runId).not.toContain(String(migratedV11.seed))
    const legacyV12 = structuredClone(saved.state!)
    legacyV12.equipment = legacyV12.equipment.filter(
      (item) => item.id !== 'equipment-eva-03',
    )
    const legacyRepressurization = legacyV12.workOrders.find(
      (order) => order.id === 'work-repressurize-lab',
    )!
    legacyRepressurization.requiredEquipment = ['engineering_kit']
    const migratedV12 = await migrate!(legacyV12, 12) as MoonbaseState
    expect(migratedV12.runId).toBe(saved.state?.runId)
    expect(migratedV12.equipment).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'equipment-eva-03', type: 'eva_suit' }),
    ]))
    expect(
      migratedV12.workOrders.find((order) => order.id === 'work-repressurize-lab'),
    ).toMatchObject({
      hazard: 'vacuum',
      requiredEquipment: ['eva_suit', 'engineering_kit'],
    })
    const legacyV14 = structuredClone(saved.state!)
    legacyV14.map = { width: 24, height: 18 }
    legacyV14.settlement.layout = {
      ...legacyV14.settlement.layout,
      width: 24,
      height: 18,
    }
    const legacyBoundary = legacyV14.settlement.layout.boundaries[0]
    const migratedV14 = await migrate!(legacyV14, 14) as MoonbaseState
    expect(migratedV14.map).toEqual({
      width: CONSTRUCTION_GRID_WIDTH,
      height: CONSTRUCTION_GRID_HEIGHT,
    })
    expect(migratedV14.settlement.layout).toMatchObject({
      width: CONSTRUCTION_GRID_WIDTH,
      height: CONSTRUCTION_GRID_HEIGHT,
    })
    expect(migratedV14.settlement.layout.boundaries).toContainEqual(legacyBoundary)
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

    const legacyV7 = structuredClone(saved.state!) as unknown as Record<string, unknown>
    delete (legacyV7.settlement as Record<string, unknown>).constructionSpeed
    const migratedV7 = await migrate!(legacyV7, 7) as MoonbaseState
    expect(migratedV7.settlement.constructionSpeed).toBe(1)

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
    const legacyV8 = structuredClone(saved.state!) as unknown as Record<string, unknown>
    ;(legacyV8.settlement as Record<string, unknown>).constructionOrders = currentOrders.map(
      (order) => ({
        ...order,
        status: 'building',
        block: null,
        assignedCrewId: 'crew-amina-okafor',
        travelPhase: 'to_site',
        materials: {
          required: order.materials.required,
          reserved: 0,
          delivered: order.materials.required,
          recoverable: order.materials.recoverable,
        },
      }),
    )
    const migratedV8 = await migrate!(legacyV8, 8) as MoonbaseState
    expect(migratedV8.settlement.constructionOrders[0]).toMatchObject({
      status: 'hauling',
      assignedCrewId: 'crew-amina-okafor',
      travelPhase: 'to_site',
      materials: {
        required: 1,
        reserved: 0,
        delivered: 0,
        carried: 1,
        carriedByCrewId: 'crew-amina-okafor',
      },
    })
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

    const legacyV6 = structuredClone(saved.state!) as unknown as Record<string, unknown>
    const legacyV6Settlement = legacyV6.settlement as Record<string, unknown>
    legacyV6Settlement.constructionOrders = [{
      ...currentOrders[0],
      assignedCrewId: 'crew-amina-okafor',
      travelPhase: undefined,
    }]
    delete legacyV6Settlement.constructionCrew
    delete legacyV6Settlement.constructionStockpile
    const migratedV6 = await migrate!(legacyV6, 6) as MoonbaseState
    expect(migratedV6.settlement.constructionOrders[0]).toMatchObject({
      assignedCrewId: null,
      travelPhase: 'idle',
    })
    expect(migratedV6.settlement.constructionCrew).toHaveLength(migratedV6.crew.length)
    expect(migratedV6.settlement.constructionStockpile).toEqual(
      offsetStarterPoint({ x: 8, y: 9 }),
    )

    const legacyCompletedLayout = saved.state!.settlement.layout
    const legacyShellOrders = deriveConstructionOrders(
      legacyCompletedLayout,
      projectExpansionShell(legacyCompletedLayout),
      { commandId: 'v6-shell', sequenceStart: 10 },
    )
    const legacyShellProjection = projectConstructionOrders(
      legacyCompletedLayout,
      legacyShellOrders,
    ).layout
    const legacyDoorOrders = deriveConstructionOrders(
      legacyShellProjection,
      paintBoundaryCell(legacyShellProjection, { x: 14, y: 3 }, 'door'),
      {
        commandId: 'v6-door',
        sequenceStart: 10 + legacyShellOrders.length,
      },
    )
    const legacyRoomOrders = [...legacyShellOrders, ...legacyDoorOrders]
    const legacyRoomProjection = projectConstructionOrders(
      legacyCompletedLayout,
      legacyRoomOrders,
    ).layout
    const legacyFixtureOrders = deriveConstructionOrders(
      legacyRoomProjection,
      placeWorkstation(legacyRoomProjection, {
        id: 'v6-life-support',
        type: 'life-support',
        label: 'V6 life support',
        origin: { x: 13, y: 4 },
        size: { width: 2, height: 2 },
      }),
      {
        commandId: 'v6-life-support',
        priority: 5,
        sequenceStart: 10 + legacyRoomOrders.length,
      },
    )
    const dependencyLegacyV6 = structuredClone(saved.state!) as unknown as Record<string, unknown>
    ;(dependencyLegacyV6.settlement as Record<string, unknown>).constructionOrders = [
      ...legacyRoomOrders,
      ...legacyFixtureOrders,
    ].map((order) => {
      const legacyOrder = { ...order } as ConstructionOrder & {
        prerequisiteOrderIds?: string[]
      }
      delete legacyOrder.prerequisiteOrderIds
      return legacyOrder
    })
    const dependencyMigratedV6 = await migrate!(dependencyLegacyV6, 6) as MoonbaseState
    const migratedFixture = dependencyMigratedV6.settlement.constructionOrders.find(
      (order) => order.commandId === 'v6-life-support',
    )!
    expect(migratedFixture.prerequisiteOrderIds?.length).toBeGreaterThan(0)
    expect(migratedFixture).toMatchObject({
      status: 'blocked',
      block: { kind: 'prerequisite' },
      assignedCrewId: null,
      materials: { reserved: 0 },
    })

    const malformedSpeed = structuredClone(saved.state!) as unknown as Record<string, unknown>
    ;(malformedSpeed.settlement as Record<string, unknown>).constructionSpeed = 99
    expect(merge!(malformedSpeed, useColonyStore.getState()).settlement.constructionSpeed).toBe(3)

    const future = await migrate!(saved.state, 16) as MoonbaseState
    expect(future).toMatchObject({ worldRevision: 1, settlement: { phase: 'landing' } })
  })

  it.each([10, 11, 13])(
    'relocates unsuited vacuum crew from a v%s save before simulation resumes',
    async (version) => {
      const legacy = createInitialState()
      legacy.settlement.phase = 'operations'
      legacy.settlement.constructionCrew = [
        { crewId: 'crew-amina-okafor', cell: { x: 9, y: 9 }, moveCredit: 0.75 },
        { crewId: 'crew-mateo-alvarez', cell: { x: 8, y: 10 }, moveCredit: 0.5 },
        { crewId: 'crew-soo-jin-park', cell: { x: 9, y: 10 }, moveCredit: 0.25 },
        { crewId: 'crew-leila-haddad', cell: { x: 8, y: 8 }, moveCredit: 0.75 },
        { crewId: 'crew-jonah-reed', cell: { x: 9, y: 8 }, moveCredit: 0.5 },
        { crewId: 'crew-nia-kimani', cell: { x: 10, y: 9 }, moveCredit: 0.25 },
      ]
      const healthBefore = new Map(legacy.crew.map((member) => [member.id, member.health]))
      const migrate = useColonyStore.persist.getOptions().migrate!
      const migrated = await migrate(legacy, version) as MoonbaseState
      const pressure = analyzeConstructionPressure(migrated.settlement.layout)

      migrated.settlement.constructionCrew.forEach((position) => {
        expect(constructionEnvironmentAt(
          migrated.settlement.layout,
          pressure,
          position.cell,
        )).toBe('pressurized')
      })
      expect(deriveAlerts(migrated).some((alert) => alert.id === 'alert-unprotected-crew'))
        .toBe(false)

      const [advanced, result] = advanceSimulation(migrated, { hours: 1 }, 'agent')
      expect(result.advancedHours).toBe(1)
      advanced.crew.forEach((member) => {
        expect(member.health).toBe(healthBefore.get(member.id))
      })
    },
  )

  it('falls back to safe domain collections when a legacy payload omits them', async () => {
    const malformed = structuredClone(createInitialState()) as unknown as Record<string, unknown>
    delete malformed.crew
    delete malformed.modules
    delete malformed.lab

    const options = useColonyStore.persist.getOptions()
    const migrated = await options.migrate!(malformed, 13) as MoonbaseState
    expect(migrated.crew).toHaveLength(createInitialState().crew.length)
    expect(migrated.modules).toHaveLength(createInitialState().modules.length)

    malformed.crew = 'not-an-array'
    malformed.modules = { invalid: true }
    malformed.lab = null
    const merged = options.merge!(malformed, useColonyStore.getState())
    expect(merged.crew).toHaveLength(createInitialState().crew.length)
    expect(merged.modules).toHaveLength(createInitialState().modules.length)
    expect(merged.lab).toEqual(useColonyStore.getState().lab)

    malformed.crew = [null]
    malformed.modules = [null]
    const malformedEntries = options.merge!(malformed, useColonyStore.getState())
    expect(malformedEntries.crew).toHaveLength(createInitialState().crew.length)
    expect(malformedEntries.modules).toHaveLength(createInitialState().modules.length)

    malformed.crew = []
    malformed.modules = [createInitialState().modules[0]]
    const partialCollections = options.merge!(malformed, useColonyStore.getState())
    expect(partialCollections.crew).toHaveLength(createInitialState().crew.length)
    expect(partialCollections.modules).toHaveLength(createInitialState().modules.length)
    expect(partialCollections.modules.some((module) => module.location === 'laboratory')).toBe(true)

    const divergent = structuredClone(createInitialState())
    divergent.lab.atmosphere = 'yes'
    divergent.lab.breached = false
    const divergentLabModule = divergent.modules.find(
      (module) => module.location === 'laboratory',
    )!
    divergentLabModule.atmosphere = 'no'
    divergentLabModule.breached = true
    const reconciled = options.merge!(divergent, useColonyStore.getState())
    expect(reconciled.modules.find((module) => module.location === 'laboratory'))
      .toMatchObject({ atmosphere: 'yes', breached: false })
  })

  it('keeps a physically suited exterior worker outside during migration', async () => {
    const legacy = createInitialState()
    legacy.settlement.phase = 'operations'
    legacy.settlement.constructionCrew = legacy.settlement.constructionCrew.map((position) => (
      position.crewId === 'crew-amina-okafor'
        ? { ...position, cell: { x: 8, y: 9 } }
        : position
    ))
    const amina = legacy.crew.find((member) => member.id === 'crew-amina-okafor')!
    const suit = legacy.equipment.find((item) => item.id === 'equipment-eva-01')!
    amina.equippedEvaSuitId = suit.id
    amina.location = 'solar-skid'
    suit.status = 'deployed'
    suit.assignedCrewId = amina.id

    const migrate = useColonyStore.persist.getOptions().migrate!
    const migrated = await migrate(legacy, 13) as MoonbaseState

    expect(migrated.settlement.constructionCrew.find(
      (position) => position.crewId === amina.id,
    )?.cell).toEqual({ x: 8, y: 9 })
    expect(migrated.crew.find((member) => member.id === amina.id)?.equippedEvaSuitId)
      .toBe(suit.id)
    expect(migrated.crew.find((member) => member.id === amina.id)?.location)
      .toBe('solar-skid')
    expect(deriveAlerts(migrated).some((alert) => alert.id === 'alert-unprotected-crew'))
      .toBe(false)
  })

  it('repairs an unsuited exterior semantic location as well as its stale grid cell', async () => {
    const legacy = createInitialState()
    legacy.settlement.phase = 'operations'
    legacy.settlement.constructionCrew = legacy.settlement.constructionCrew.map((position) => (
      position.crewId === 'crew-amina-okafor'
        ? { ...position, cell: { x: 8, y: 9 } }
        : position
    ))
    const amina = legacy.crew.find((member) => member.id === 'crew-amina-okafor')!
    amina.location = 'solar-skid'
    amina.equippedEvaSuitId = null
    legacy.alerts = deriveAlerts(legacy)
    expect(legacy.alerts.some((alert) => alert.id === 'alert-unprotected-crew')).toBe(true)
    const healthBefore = amina.health

    const migrate = useColonyStore.persist.getOptions().migrate!
    const migrated = await migrate(legacy, 13) as MoonbaseState
    const migratedAmina = migrated.crew.find((member) => member.id === amina.id)!

    expect(migratedAmina.location).not.toBe('solar-skid')
    expect(deriveAlerts(migrated).some((alert) => alert.id === 'alert-unprotected-crew'))
      .toBe(false)
    expect(migrated.alerts.some((alert) => alert.id === 'alert-unprotected-crew'))
      .toBe(false)

    const [advanced, result] = advanceSimulation(migrated, { hours: 1 }, 'agent')
    expect(result.advancedHours).toBe(1)
    expect(advanced.crew.find((member) => member.id === amina.id)?.health).toBe(healthBefore)
  })

  it('moves real v12 landing coordinates into deterministic pressurized starter cells', async () => {
    const legacy = createInitialState()
    const runId = legacy.runId
    const oldOutdoorCells = [
      { crewId: 'crew-amina-okafor', cell: { x: 9, y: 9 }, moveCredit: 0.75 },
      { crewId: 'crew-mateo-alvarez', cell: { x: 8, y: 10 }, moveCredit: 0.5 },
      { crewId: 'crew-soo-jin-park', cell: { x: 9, y: 10 }, moveCredit: 0.25 },
      { crewId: 'crew-leila-haddad', cell: { x: 8, y: 8 }, moveCredit: 0.75 },
      { crewId: 'crew-jonah-reed', cell: { x: 9, y: 8 }, moveCredit: 0.5 },
      { crewId: 'crew-nia-kimani', cell: { x: 10, y: 9 }, moveCredit: 0.25 },
    ]
    legacy.settlement.constructionCrew = oldOutdoorCells
    legacy.equipment = legacy.equipment.filter((item) => item.id !== 'equipment-eva-03')

    const migrate = useColonyStore.persist.getOptions().migrate!
    const migrated = await migrate(legacy, 12) as MoonbaseState
    const expectedStarterCells = new Map(
      createInitialState().settlement.constructionCrew.map((position) => [
        position.crewId,
        position.cell,
      ]),
    )
    const pressure = analyzeConstructionPressure(migrated.settlement.layout)

    expect(migrated.runId).toBe(runId)
    expect(isOpaqueRunId(migrated.runId)).toBe(true)
    migrated.settlement.constructionCrew.forEach((position) => {
      expect(position).toMatchObject({
        cell: expectedStarterCells.get(position.crewId),
        moveCredit: 0,
      })
      expect(constructionEnvironmentAt(
        migrated.settlement.layout,
        pressure,
        position.cell,
      )).toBe('pressurized')
    })
  })

  it('gives canonicalized v12 vacuum work a distinct suit before it can resume', async () => {
    const legacy = legacyV12RepressurizationState()
    const runId = legacy.runId
    const migrate = useColonyStore.persist.getOptions().migrate!

    const migrated = await migrate(legacy, 12) as MoonbaseState
    const engineer = migrated.crew.find((member) => member.id === 'crew-soo-jin-park')!
    const repressurize = migrated.workOrders.find(
      (order) => order.id === 'work-repressurize-lab',
    )!
    const suit = migrated.equipment.find((item) => item.id === 'equipment-eva-01')!

    expect(migrated.runId).toBe(runId)
    expect(repressurize).toMatchObject({
      status: 'active',
      hazard: 'vacuum',
      requiredEquipment: ['eva_suit', 'engineering_kit'],
      reservedEquipmentIds: expect.arrayContaining([
        'equipment-eva-01',
        'equipment-engineering-02',
      ]),
    })
    expect(engineer).toMatchObject({
      location: 'laboratory',
      taskId: 'work-repressurize-lab',
      equippedEvaSuitId: 'equipment-eva-01',
    })
    expect(suit).toMatchObject({
      status: 'deployed',
      location: 'laboratory',
      reservedForWorkOrderId: 'work-repressurize-lab',
      assignedCrewId: engineer.id,
    })
    expect(migrated.operationsPlan).toMatchObject({
      status: 'committed',
      revision: 9,
    })
    expect(migrated.operationsPlan.actions).toContainEqual(expect.objectContaining({
      kind: 'reserve_equipment',
      equipmentId: suit.id,
      workOrderId: repressurize.id,
    }))

    const [advanced, result] = advanceSimulation(migrated, { hours: 1 }, 'agent')
    expect(result.advancedHours).toBe(1)
    expect(advanced.alerts.some((alert) => alert.id === 'alert-unprotected-crew')).toBe(false)
    expect(advanced.crew.find((member) => member.id === engineer.id)).toMatchObject({
      location: 'airlock',
      equippedEvaSuitId: null,
      taskId: null,
    })
  })

  it('returns exposed v12 crew and reopens the plan when distinct suits are unavailable', async () => {
    const legacy = legacyV12RepressurizationState()
    const secondEngineer = legacy.crew.find((member) => member.id === 'crew-mateo-alvarez')!
    secondEngineer.location = 'laboratory'
    secondEngineer.taskId = 'work-repressurize-lab'
    secondEngineer.status = 'working'
    const repressurize = legacy.workOrders.find(
      (order) => order.id === 'work-repressurize-lab',
    )!
    repressurize.assignedCrewIds.push(secondEngineer.id)
    legacy.operationsPlan.actions.push({
      id: 'legacy-assign-second-repressurize',
      kind: 'assign_crew',
      crewId: secondEngineer.id,
      workOrderId: repressurize.id,
    })
    legacy.equipment.forEach((item) => {
      if (item.type === 'eva_suit') item.condition = 20
    })

    const migrate = useColonyStore.persist.getOptions().migrate!
    const migrated = await migrate(legacy, 12) as MoonbaseState
    const migratedRepressurize = migrated.workOrders.find(
      (order) => order.id === 'work-repressurize-lab',
    )!

    expect(migrated.runId).toBe(legacy.runId)
    expect(migrated.operationsPlan).toMatchObject({
      status: 'draft',
      basedOnWorldRevision: migrated.worldRevision,
      actions: [],
      committedAtHour: null,
      baseline: null,
    })
    expect(migratedRepressurize).toMatchObject({
      status: 'ready',
      assignedCrewIds: [],
      reservedEquipmentIds: [],
      logisticsHoursRemaining: 0,
    })
    for (const crewId of ['crew-soo-jin-park', 'crew-mateo-alvarez']) {
      expect(migrated.crew.find((member) => member.id === crewId)).toMatchObject({
        location: 'airlock',
        taskId: null,
        equippedEvaSuitId: null,
      })
    }
    expect(migrated.equipment.every((item) => (
      item.reservedForWorkOrderId !== 'work-repressurize-lab' &&
      item.assignedCrewId !== 'crew-soo-jin-park' &&
      item.assignedCrewId !== 'crew-mateo-alvarez'
    ))).toBe(true)
  })

  it('gives each reset a new persisted run identity while revisions restart', () => {
    const before = useColonyStore.getState()
    const beforeRunId = before.runId
    const beforeRunSequence = before.runSequence

    useColonyStore.getState().resetMoonbase()
    const reset = useColonyStore.getState()

    expect(reset.runSequence).toBe(beforeRunSequence + 1)
    expect(isOpaqueRunId(reset.runId)).toBe(true)
    expect(reset.runId).not.toContain(String(reset.seed))
    expect(reset.runId).not.toBe(beforeRunId)
    expect(reset.worldRevision).toBe(1)
    expect(reset.operationsPlan.revision).toBe(1)
  })

  it('refuses to start another incident before operations', () => {
    useColonyStore.getState().resetColony()
    const before = useColonyStore.getState()

    expect(before.startNextIncident()).toBe(false)
    expect(useColonyStore.getState()).toBe(before)
  })

  it('refuses to replace an objective-complete incident before the loop is verified', () => {
    let operational = establishBase()
    operational = beginOperations(operational, 'agent')[0]
    operational = stageIncident(operational)
    operational = commitOperationsPlan(
      operational,
      operational.worldRevision,
      operational.operationsPlan.revision,
      'agent',
    )[0]
    operational = advanceSimulation(operational, { hours: 12 }, 'agent')[0]
    expect(operational.scenarioStatus).toBe('objective_complete')
    expect(operational.learning.completedLoops).toBe(0)

    useColonyStore.setState(operational)
    const before = useColonyStore.getState()
    expect(before.startNextIncident()).toBe(false)
    expect(useColonyStore.getState()).toBe(before)
  })

  it('starts the next incident profile without rebuilding the operational settlement', () => {
    let operational = establishBase()
    operational = beginOperations(operational, 'agent')[0]
    operational = recordLearningEvidence(
      operational,
      'ground',
      'Inspected incident telemetry and dependencies.',
      'agent',
      { groundingKind: 'incident_telemetry' },
    )
    operational = recordLearningEvidence(
      operational,
      'ground',
      'Compared crew and localized equipment.',
      'agent',
      { groundingKind: 'crew_equipment_comparison' },
    )
    operational = stageIncident(operational)
    operational = commitOperationsPlan(
      operational,
      operational.worldRevision,
      operational.operationsPlan.revision,
      'agent',
    )[0]
    operational = advanceSimulation(operational, { hours: 12 }, 'agent')[0]
    operational = verifyOperationsPlan(operational, 'agent')[0]
    expect(operational.scenarioStatus).toBe('objective_complete')
    expect(operational.learning.completedLoops).toBe(1)

    const builtLayout = layoutFrom(
      paintBoundaryCell(operational.settlement.layout, { x: 12, y: 9 }, 'wall'),
    )
    const queuedWall = paintBoundaryCell(builtLayout, { x: 13, y: 9 }, 'wall')
    const constructionOrders = deriveConstructionOrders(
      builtLayout,
      queuedWall,
      { commandId: 'replay-preserved-wall', sequenceStart: 41 },
    )
    const physicalState: MoonbaseState = {
      ...operational,
      reserves: { ...operational.reserves, constructionStock: 6.5 },
      modules: operational.modules.map((module) => module.id === 'module-laboratory'
        ? { ...module, position: { x: 3, y: 2, width: 6, height: 5 } }
        : module),
      settlement: {
        ...operational.settlement,
        layout: builtLayout,
        constructionOrders,
        constructionSequence: 42,
        constructionSpeed: 3,
        constructionCrew: operational.settlement.constructionCrew.map((worker, index) => index === 0
          ? { ...worker, cell: { x: 7, y: 7 }, moveCredit: 0.5 }
          : worker),
        constructionStockpile: { x: 7, y: 9 },
      },
    }
    useColonyStore.setState(physicalState)
    const before = useColonyStore.getState()
    const preservedSettlement = structuredClone(before.settlement)
    const preservedPositions = new Map(
      before.modules.map((module) => [module.id, structuredClone(module.position)]),
    )
    const oldProfile = incidentProfileMetadataForSeed(before.seed)
    const expectedSeed = nextIncidentSeed(before.seed)
    const expectedRunSequence = before.runSequence + 1
    const expectedIncident = createInitialState(expectedSeed, expectedRunSequence)

    expect(before.startNextIncident()).toBe(true)
    const next = useColonyStore.getState()

    expect(incidentProfileMetadataForSeed(next.seed).id).not.toBe(oldProfile.id)
    expect(next.seed).toBe(expectedSeed)
    expect(next.runSequence).toBe(expectedRunSequence)
    expect(isOpaqueRunId(next.runId)).toBe(true)
    expect(next.runId).not.toContain(String(next.seed))
    expect(next.runId).not.toBe(before.runId)
    expect(next.worldRevision).toBe(before.worldRevision + 1)

    expect(next.settlement).toEqual(preservedSettlement)
    expect(next.settlement.phase).toBe('operations')
    expect(next.reserves.constructionStock).toBe(6.5)
    for (const moduleId of next.settlement.builtModuleIds) {
      expect(next.modules.find((module) => module.id === moduleId)?.position)
        .toEqual(preservedPositions.get(moduleId))
    }

    expect(next).toMatchObject({
      missionDay: 1,
      hour: 6,
      elapsedHours: 0,
      scenarioStatus: 'active',
      lab: expectedIncident.lab,
      dust: expectedIncident.dust,
      power: expectedIncident.power,
      research: expectedIncident.research,
      learning: expectedIncident.learning,
      lastAdvance: null,
      verification: null,
    })
    expect(next.crew).toEqual(expectedIncident.crew)
    expect(next.equipment).toEqual(expectedIncident.equipment)
    expect(next.workOrders).toEqual(expectedIncident.workOrders)
    expect(next.operationsPlan).toEqual({
      ...expectedIncident.operationsPlan,
      basedOnWorldRevision: next.worldRevision,
    })
    expect(next.events).toEqual(expectedIncident.events.map((event) => ({
      ...event,
      worldRevision: next.worldRevision,
      planRevision: next.operationsPlan.revision,
    })))
  })

  it('sanitizes pre-v10 establishment saves without discarding construction progress', async () => {
    const initial = createInitialState()
    const wallResult = paintBoundaryCell(initial.settlement.layout, { x: 12, y: 9 }, 'wall')
    const constructionOrders = deriveConstructionOrders(
      initial.settlement.layout,
      wallResult,
      { commandId: 'legacy-landing-wall', sequenceStart: 7 },
    )
    const landingConstruction: MoonbaseState = {
      ...initial,
      worldRevision: 7,
      settlement: {
        ...initial.settlement,
        constructionOrders,
        constructionSequence: 8,
        constructionSpeed: 3,
      },
      modules: initial.modules.map((module) => module.id === 'module-solar-skid'
        ? { ...module, position: { x: 2, y: 2, width: 3, height: 2 } }
        : module),
    }

    let unsafeOperations: MoonbaseState = {
      ...landingConstruction,
      settlement: { ...landingConstruction.settlement, phase: 'operations' },
      operationsPlan: {
        ...landingConstruction.operationsPlan,
        basedOnWorldRevision: landingConstruction.worldRevision,
      },
    }
    unsafeOperations = stageIncident(unsafeOperations)
    unsafeOperations = commitOperationsPlan(
      unsafeOperations,
      unsafeOperations.worldRevision,
      unsafeOperations.operationsPlan.revision,
      'agent',
    )[0]
    unsafeOperations = advanceSimulation(unsafeOperations, { hours: 1 }, 'agent')[0]
    expect(unsafeOperations).toMatchObject({
      elapsedHours: 1,
      operationsPlan: { status: 'committed' },
      lastAdvance: { advancedHours: 1 },
    })

    const legacyLanding: MoonbaseState = {
      ...unsafeOperations,
      settlement: { ...landingConstruction.settlement, phase: 'landing' },
      reserves: {
        ...unsafeOperations.reserves,
        constructionStock: landingConstruction.reserves.constructionStock,
      },
    }
    const migrate = useColonyStore.persist.getOptions().migrate!
    const migrated = await migrate(legacyLanding, 9) as MoonbaseState
    const fresh = createInitialState()

    expect(migrated.worldRevision).toBe(unsafeOperations.worldRevision)
    expect(migrated.settlement).toMatchObject({
      phase: 'landing',
      constructionSequence: 8,
      constructionSpeed: 3,
    })
    expect(migrated.settlement.layout).toEqual(landingConstruction.settlement.layout)
    expect(migrated.settlement.constructionOrders.map((order) => order.id)).toEqual(
      constructionOrders.map((order) => order.id),
    )
    expect(migrated.reserves.constructionStock).toBe(landingConstruction.reserves.constructionStock)
    expect(migrated.modules.find((module) => module.id === 'module-solar-skid')?.position).toEqual({
      x: 2,
      y: 2,
      width: 3,
      height: 2,
    })

    expect(migrated).toMatchObject({
      missionDay: fresh.missionDay,
      hour: fresh.hour,
      elapsedHours: fresh.elapsedHours,
      scenarioStatus: fresh.scenarioStatus,
      lab: fresh.lab,
      dust: fresh.dust,
      research: fresh.research,
      lastAdvance: null,
      verification: null,
    })
    expect(migrated.reserves.oxygenHours).toBe(fresh.reserves.oxygenHours)
    expect(migrated.crew).toEqual(fresh.crew)
    expect(migrated.equipment).toEqual(fresh.equipment)
    expect(migrated.workOrders).toEqual(fresh.workOrders)
    expect(migrated.learning).toEqual(fresh.learning)
    expect(migrated.operationsPlan).toEqual({
      ...fresh.operationsPlan,
      basedOnWorldRevision: migrated.worldRevision,
    })

    const migratedOperations = await migrate(unsafeOperations, 9) as MoonbaseState
    expect(migratedOperations).toMatchObject({
      elapsedHours: 1,
      settlement: { phase: 'operations' },
      operationsPlan: { status: 'committed' },
      lastAdvance: { advancedHours: 1 },
    })
  })

  it('does not begin operations while any construction order remains open', () => {
    const initial = createInitialState()
    let layout = layoutFrom(projectExpansionShell(initial.settlement.layout))
    layout = layoutFrom(paintBoundaryCell(layout, { x: 14, y: 3 }, 'door'))
    layout = layoutFrom(placeWorkstation(layout, {
      id: 'readiness-life-support',
      type: 'life-support',
      label: 'Readiness life support',
      origin: { x: 13, y: 4 },
      size: { width: 2, height: 2 },
      rotation: 0,
    }))
    const ready: MoonbaseState = {
      ...initial,
      settlement: { ...initial.settlement, layout },
    }
    expect(canBeginOperations(ready)).toBe(true)

    const removal = removeWorkstation(layout, 'readiness-life-support')
    const removalOrders = deriveConstructionOrders(layout, removal, {
      commandId: 'remove-readiness-life-support',
      sequenceStart: 1,
    })
    const teardownPending: MoonbaseState = {
      ...ready,
      settlement: {
        ...ready.settlement,
        constructionOrders: removalOrders,
        constructionSequence: 2,
      },
    }

    expect(removalOrders.some((order) => order.status !== 'complete')).toBe(true)
    expect(canBeginOperations(teardownPending)).toBe(false)
    const [unchanged, result] = beginOperations(teardownPending, 'agent')
    expect(unchanged).toBe(teardownPending)
    expect(result).toMatchObject({
      ok: false,
      code: 'not_ready',
      phase: 'landing',
      error: 'Finish or cancel all open construction before beginning operations.',
    })
  })

  it('requires a completed exterior airlock before a freeform settlement can open', () => {
    const initial = createInitialState()
    let layout = layoutFrom(projectExpansionShell(initial.settlement.layout))
    layout = layoutFrom(paintBoundaryCell(layout, { x: 14, y: 3 }, 'door'))
    layout = layoutFrom(placeWorkstation(layout, {
      id: 'readiness-life-support',
      type: 'life-support',
      label: 'Readiness life support',
      origin: { x: 13, y: 4 },
      size: { width: 2, height: 2 },
      rotation: 0,
    }))
    const ready: MoonbaseState = {
      ...initial,
      settlement: { ...initial.settlement, layout },
    }
    expect(canBeginOperations(ready)).toBe(true)

    const crewOutside: MoonbaseState = {
      ...ready,
      settlement: {
        ...ready.settlement,
        constructionCrew: ready.settlement.constructionCrew.map((position, index) => (
          index === 0 ? { ...position, cell: { x: 8, y: 9 } } : position
        )),
      },
    }
    expect(canBeginOperations(crewOutside)).toBe(false)

    layout = layoutFrom(paintBoundaryCell(layout, { x: 7, y: 9 }, 'wall'))
    layout = layoutFrom(paintBoundaryCell(layout, { x: 14, y: 3 }, 'wall'))
    const sealed: MoonbaseState = {
      ...ready,
      settlement: { ...ready.settlement, layout },
    }

    expect(canBeginOperations(sealed)).toBe(false)
  })

  it('keeps the last usable exterior airlock in an active base', () => {
    const [operations, started] = beginOperations(establishBase(), 'agent')
    expect(started.ok).toBe(true)
    useColonyStore.setState((store) => ({ ...store, ...operations }))

    const result = useColonyStore.getState().queueConstruction(
      paintBoundaryCell(
        operations.settlement.layout,
        offsetStarterPoint({ x: 7, y: 9 }),
        'wall',
      ),
    )

    expect(result).toMatchObject({
      ok: false,
      error: expect.stringContaining('at least one usable exterior airlock'),
    })
    expect(useColonyStore.getState().settlement.constructionOrders).toEqual([])
    useColonyStore.getState().resetColony()
  })

  it('blocks venting occupied preset space without enough EVA suits', () => {
    useColonyStore.getState().resetColony()
    expect(useColonyStore.getState().deployPresetMoonbase().ok).toBe(true)
    const deployed = useColonyStore.getState()
    const exposedCrewId = deployed.crew[0].id
    useColonyStore.setState({
      equipment: deployed.equipment.map((item) => item.type === 'eva_suit'
        ? { ...item, condition: 0, assignedCrewId: null, status: 'available' as const }
        : item),
      settlement: {
        ...deployed.settlement,
        constructionCrew: deployed.settlement.constructionCrew.map((position) => (
          position.crewId === exposedCrewId
            ? { ...position, cell: { x: 13, y: 9 } }
            : position
        )),
      },
    })

    const state = useColonyStore.getState()
    const result = state.queueConstruction(eraseAt(
      state.settlement.layout,
      { x: 16, y: 8 },
    ))

    expect(result).toMatchObject({
      ok: false,
      error: expect.stringContaining('vent occupied space'),
    })
    expect(useColonyStore.getState().settlement.constructionOrders).toEqual([])
    useColonyStore.getState().resetColony()
  })

  it('moves a builder through the material pallet before construction can progress', () => {
    useColonyStore.getState().resetColony()
    const target = { x: 12, y: 9 }
    const initial = useColonyStore.getState()
    const queued = initial.queueConstruction(
      paintBoundaryCell(initial.settlement.layout, target, 'wall'),
    )
    expect(queued.ok).toBe(true)

    useColonyStore.getState().advanceConstruction(1.5)
    let state = useColonyStore.getState()
    let order = state.settlement.constructionOrders.find(
      (candidate) => candidate.id === queued.orderIds[0],
    )!
    const mateo = state.settlement.constructionCrew.find(
      (position) => position.crewId === 'crew-mateo-alvarez',
    )!
    expect(order).toMatchObject({
      assignedCrewId: 'crew-mateo-alvarez',
      travelPhase: 'to_site',
      materials: {
        delivered: 0,
        reserved: 0,
        carried: 1,
        carriedByCrewId: 'crew-mateo-alvarez',
      },
      work: { completed: 0 },
    })
    expect(mateo.cell).toEqual(state.settlement.constructionStockpile)
    const suitedMateo = state.crew.find((member) => member.id === 'crew-mateo-alvarez')!
    expect(suitedMateo.equippedEvaSuitId).toMatch(/^equipment-eva-/)
    expect(state.equipment.find((item) => item.id === suitedMateo.equippedEvaSuitId)).toMatchObject({
      status: 'deployed',
      assignedCrewId: 'crew-mateo-alvarez',
    })
    expect(state.reserves.constructionStock).toBe(29)
    expect(state.settlement.layout.boundaries).not.toContainEqual({
      ...target,
      kind: 'wall',
    })

    for (let tick = 0; tick < 30 && order.status !== 'complete'; tick += 1) {
      useColonyStore.getState().advanceConstruction(0.5)
      state = useColonyStore.getState()
      order = state.settlement.constructionOrders.find(
        (candidate) => candidate.id === queued.orderIds[0],
      )!
    }
    expect(order).toMatchObject({
      status: 'complete',
      assignedCrewId: null,
      travelPhase: 'idle',
    })
    expect(state.reserves.constructionStock).toBe(29)
    expect(state.settlement.layout.boundaries).toContainEqual({
      ...target,
      kind: 'wall',
    })
    expect(state.settlement.constructionCrew.find(
      (position) => position.crewId === 'crew-mateo-alvarez',
    )?.cell).not.toEqual(target)
    const returnedMateo = state.crew.find((member) => member.id === 'crew-mateo-alvarez')!
    const returnedCell = state.settlement.constructionCrew.find(
      (position) => position.crewId === 'crew-mateo-alvarez',
    )!.cell
    const pressure = analyzeConstructionPressure(state.settlement.layout)
    expect(constructionEnvironmentAt(state.settlement.layout, pressure, returnedCell))
      .toBe('pressurized')
    expect(returnedMateo.equippedEvaSuitId).toBeNull()
    expect(state.equipment.filter((item) => item.type === 'eva_suit')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: 'available', assignedCrewId: null }),
      ]),
    )
    useColonyStore.getState().resetColony()
  })

  it('dispatches available non-builders as haulers beyond the automatic builder limit', () => {
    useColonyStore.getState().resetColony()
    const initial = useColonyStore.getState()
    useColonyStore.setState({
      settlement: { ...initial.settlement, phase: 'operations' },
    })

    ;[{ x: 12, y: 9 }, { x: 13, y: 9 }, { x: 14, y: 9 }].forEach((target) => {
      const state = useColonyStore.getState()
      const projection = projectConstructionOrders(
        state.settlement.layout,
        state.settlement.constructionOrders,
      ).layout
      expect(state.queueConstruction(paintBoundaryCell(projection, target, 'wall')).ok)
        .toBe(true)
    })

    useColonyStore.getState().advanceConstruction(0)
    const assignedCrewIds = useColonyStore.getState().settlement.constructionOrders
      .map((order) => order.assignedCrewId)
      .filter((crewId): crewId is string => Boolean(crewId))

    expect(new Set(assignedCrewIds).size).toBe(3)
    expect(assignedCrewIds.some((crewId) => ![
      'crew-mateo-alvarez',
      'crew-soo-jin-park',
    ].includes(crewId))).toBe(true)
    useColonyStore.getState().resetColony()
  })

  it('keeps explicit colony-hour advances from applying a second construction clock', () => {
    useColonyStore.getState().resetColony()
    const target = { x: 12, y: 9 }
    const queued = useColonyStore.getState().queueConstruction(
      paintBoundaryCell(useColonyStore.getState().settlement.layout, target, 'wall'),
    )
    expect(queued.ok).toBe(true)
    useColonyStore.getState().setConstructionSpeed(3)
    const queuedState = useColonyStore.getState()
    useColonyStore.setState({
      settlement: { ...queuedState.settlement, phase: 'operations' },
    })

    const before = useColonyStore.getState()
    const constructionBefore = structuredClone({
      layout: before.settlement.layout,
      orders: before.settlement.constructionOrders,
      crew: before.settlement.constructionCrew,
      stockpile: before.settlement.constructionStockpile,
      stock: before.reserves.constructionStock,
    })

    const advanced = useColonyStore.getState().advanceTime({ hours: 1 })
    expect(advanced.advancedHours).toBe(1)

    const afterHour = useColonyStore.getState()
    expect({
      layout: afterHour.settlement.layout,
      orders: afterHour.settlement.constructionOrders,
      crew: afterHour.settlement.constructionCrew,
      stockpile: afterHour.settlement.constructionStockpile,
      stock: afterHour.reserves.constructionStock,
    }).toEqual(constructionBefore)

    const advancedAgain = useColonyStore.getState().advanceHours(1)
    expect(advancedAgain.advancedHours).toBe(1)
    const afterHoursAction = useColonyStore.getState()
    expect({
      layout: afterHoursAction.settlement.layout,
      orders: afterHoursAction.settlement.constructionOrders,
      crew: afterHoursAction.settlement.constructionCrew,
      stockpile: afterHoursAction.settlement.constructionStockpile,
      stock: afterHoursAction.reserves.constructionStock,
    }).toEqual(constructionBefore)

    useColonyStore.getState().advanceConstruction(0.5)
    expect(useColonyStore.getState().settlement.constructionOrders).not.toEqual(
      constructionBefore.orders,
    )
    useColonyStore.getState().resetColony()
  })

  it('assigns and releases an exact builder while paused without moving work or material', () => {
    useColonyStore.getState().resetColony()
    const initial = useColonyStore.getState()
    const queued = initial.queueConstruction(
      paintBoundaryCell(initial.settlement.layout, { x: 12, y: 9 }, 'wall'),
    )
    expect(queued.ok).toBe(true)
    expect(useColonyStore.getState().setConstructionSpeed(0)).toBe(true)

    const before = useColonyStore.getState()
    const orderId = queued.orderIds[0]
    const physicalBefore = structuredClone({
      stock: before.reserves.constructionStock,
      crew: before.settlement.constructionCrew,
      materials: before.settlement.constructionOrders[0].materials,
      work: before.settlement.constructionOrders[0].work,
    })
    const assigned = before.setConstructionOrderBuilder(orderId, 'crew-amina-okafor')
    expect(assigned).toEqual({ ok: true, orderId, crewId: 'crew-amina-okafor' })

    let state = useColonyStore.getState()
    expect(state.worldRevision).toBe(before.worldRevision + 1)
    expect(state.settlement.constructionOrders[0]).toMatchObject({
      forcedCrewId: 'crew-amina-okafor',
      assignedCrewId: 'crew-amina-okafor',
      travelPhase: 'idle',
    })
    expect({
      stock: state.reserves.constructionStock,
      crew: state.settlement.constructionCrew,
      materials: state.settlement.constructionOrders[0].materials,
      work: state.settlement.constructionOrders[0].work,
    }).toEqual(physicalBefore)

    const assignedRevision = state.worldRevision
    expect(state.setConstructionOrderBuilder(orderId, 'crew-amina-okafor').ok).toBe(true)
    expect(useColonyStore.getState().worldRevision).toBe(assignedRevision)

    expect(useColonyStore.getState().setConstructionOrderBuilder(orderId, null).ok).toBe(true)
    state = useColonyStore.getState()
    expect(state.worldRevision).toBe(assignedRevision + 1)
    expect(state.settlement.constructionOrders[0]).toMatchObject({
      forcedCrewId: null,
      assignedCrewId: null,
      travelPhase: 'idle',
    })
    const automaticRevision = state.worldRevision
    expect(state.setConstructionOrderBuilder(orderId, null).ok).toBe(true)
    expect(useColonyStore.getState().worldRevision).toBe(automaticRevision)
    useColonyStore.getState().resetColony()
  })

  it('never reassigns or releases a blueprint while its material is in transit', () => {
    useColonyStore.getState().resetColony()
    const initial = useColonyStore.getState()
    const queued = initial.queueConstruction(
      paintBoundaryCell(initial.settlement.layout, { x: 12, y: 9 }, 'wall'),
    )
    expect(queued.ok).toBe(true)
    const queuedState = useColonyStore.getState()
    useColonyStore.setState({
      settlement: {
        ...queuedState.settlement,
        constructionOrders: queuedState.settlement.constructionOrders.map((order) => ({
          ...order,
          status: 'building' as const,
          block: null,
          assignedCrewId: 'crew-mateo-alvarez',
          forcedCrewId: 'crew-mateo-alvarez',
          travelPhase: 'to_site' as const,
          materials: {
            ...order.materials,
            reserved: 0,
            carried: 1,
            carriedByCrewId: 'crew-mateo-alvarez',
          },
        })),
      },
    })
    const before = structuredClone(useColonyStore.getState().settlement.constructionOrders)
    const revision = useColonyStore.getState().worldRevision

    expect(useColonyStore.getState().setConstructionOrderBuilder(
      queued.orderIds[0],
      'crew-amina-okafor',
    )).toMatchObject({ ok: false, error: expect.stringContaining('must deliver') })
    expect(useColonyStore.getState().setConstructionOrderBuilder(
      queued.orderIds[0],
      null,
    )).toMatchObject({ ok: false, error: expect.stringContaining('Finish delivering') })
    expect(useColonyStore.getState().settlement.constructionOrders).toEqual(before)
    expect(useColonyStore.getState().worldRevision).toBe(revision)
    useColonyStore.getState().resetColony()
  })

  it('lets a manually chosen lower-ranked colonist bypass the automatic two-builder limit', () => {
    useColonyStore.getState().resetColony()
    const initial = useColonyStore.getState()
    useColonyStore.setState({
      settlement: { ...initial.settlement, phase: 'operations' },
    })
    const state = useColonyStore.getState()
    const queued = state.queueConstruction(
      paintBoundaryCell(state.settlement.layout, { x: 12, y: 9 }, 'wall'),
    )
    expect(queued.ok).toBe(true)
    expect(useColonyStore.getState().setConstructionOrderBuilder(
      queued.orderIds[0],
      'crew-leila-haddad',
    ).ok).toBe(true)

    let order = useColonyStore.getState().settlement.constructionOrders[0]
    for (let tick = 0; tick < 40 && order.status !== 'complete'; tick += 1) {
      useColonyStore.getState().advanceConstruction(1)
      order = useColonyStore.getState().settlement.constructionOrders[0]
    }
    expect(order).toMatchObject({
      status: 'complete',
      assignedCrewId: null,
      forcedCrewId: null,
      work: { completed: 1 },
    })
    useColonyStore.getState().resetColony()
  })

  it('repairs unknown and duplicate manual builder intent at the persistence boundary', () => {
    useColonyStore.getState().resetColony()
    const initial = createInitialState()
    const orders = deriveConstructionOrders(
      initial.settlement.layout,
      paintBoundaryLine(initial.settlement.layout, { x: 12, y: 9 }, { x: 14, y: 9 }, 'wall'),
      { commandId: 'forced-persist', sequenceStart: 20 },
    ).map((order, index) => ({
      ...order,
      forcedCrewId: index < 2 ? 'crew-amina-okafor' : 'missing-crew',
      assignedCrewId: index === 0 ? 'crew-amina-okafor' : 'crew-mateo-alvarez',
    }))
    const persisted = {
      ...initial,
      settlement: {
        ...initial.settlement,
        constructionOrders: orders,
        constructionSequence: 23,
      },
    }
    const merge = useColonyStore.persist.getOptions().merge!
    const merged = merge(persisted, useColonyStore.getState())

    expect(merged.settlement.constructionOrders.map((order) => order.forcedCrewId)).toEqual([
      'crew-amina-okafor',
      null,
      null,
    ])
    expect(merged.settlement.constructionOrders[0].assignedCrewId)
      .toBe('crew-amina-okafor')
    useColonyStore.getState().resetColony()
  })

  it('reassigns uncollected material to a newly urgent blueprint', () => {
    useColonyStore.getState().resetColony()
    const initial = useColonyStore.getState()
    useColonyStore.setState({
      reserves: { ...initial.reserves, constructionStock: 1 },
    })

    const first = useColonyStore.getState().queueConstruction(
      paintBoundaryCell(useColonyStore.getState().settlement.layout, { x: 12, y: 9 }, 'wall'),
    )
    const afterFirst = useColonyStore.getState()
    const firstProjection = projectConstructionOrders(
      afterFirst.settlement.layout,
      afterFirst.settlement.constructionOrders,
    ).layout
    const second = useColonyStore.getState().queueConstruction(
      paintBoundaryCell(firstProjection, { x: 14, y: 9 }, 'wall'),
    )
    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)

    let orders = useColonyStore.getState().settlement.constructionOrders
    expect(orders.find((order) => order.id === first.orderIds[0])?.materials.reserved).toBe(1)
    expect(orders.find((order) => order.id === second.orderIds[0])).toMatchObject({
      status: 'blocked',
      block: { kind: 'insufficient_materials' },
      materials: { reserved: 0, delivered: 0 },
    })

    expect(useColonyStore.getState().setConstructionOrderPriority(
      second.orderIds[0],
      5,
    )).toBe(true)

    orders = useColonyStore.getState().settlement.constructionOrders
    expect(orders.find((order) => order.id === first.orderIds[0])).toMatchObject({
      status: 'blocked',
      block: { kind: 'insufficient_materials' },
      materials: { reserved: 0, delivered: 0 },
    })
    expect(orders.find((order) => order.id === second.orderIds[0])).toMatchObject({
      priority: 5,
      status: 'hauling',
      block: null,
      materials: { reserved: 1, delivered: 0 },
    })
  })

  it('queues and advances a high-priority indoor fixture behind its projected room shell', () => {
    useColonyStore.getState().resetColony()
    const initial = useColonyStore.getState()
    useColonyStore.setState({
      reserves: { ...initial.reserves, constructionStock: 100 },
    })

    const completed = useColonyStore.getState().settlement.layout
    const wallQueue = useColonyStore.getState().queueConstruction(
      projectExpansionShell(completed),
    )
    expect(wallQueue.ok).toBe(true)

    let state = useColonyStore.getState()
    let projection = projectConstructionOrders(
      state.settlement.layout,
      state.settlement.constructionOrders,
    ).layout
    const doorQueue = state.queueConstruction(
      paintBoundaryCell(projection, { x: 14, y: 3 }, 'door'),
    )
    expect(doorQueue.ok).toBe(true)

    state = useColonyStore.getState()
    projection = projectConstructionOrders(
      state.settlement.layout,
      state.settlement.constructionOrders,
    ).layout
    const lifeSupportQueue = state.queueConstruction(
      placeWorkstation(projection, {
        id: 'priority-life-support',
        type: 'life-support',
        label: 'Priority life support',
        origin: { x: 15, y: 4 },
        size: { width: 2, height: 2 },
      }),
    )
    expect(lifeSupportQueue.ok).toBe(true)
    expect(state.setConstructionOrderPriority).toBeTypeOf('function')
    expect(useColonyStore.getState().setConstructionOrderPriority(
      lifeSupportQueue.orderIds[0],
      5,
    )).toBe(true)

    state = useColonyStore.getState()
    let lifeSupport = state.settlement.constructionOrders.find(
      (order) => order.id === lifeSupportQueue.orderIds[0],
    )!
    expect(lifeSupport).toMatchObject({
      priority: 5,
      status: 'blocked',
      block: { kind: 'prerequisite' },
      assignedCrewId: null,
      materials: { reserved: 0, delivered: 0 },
      work: { completed: 0 },
    })
    expect(lifeSupport.prerequisiteOrderIds).toContain(doorQueue.orderIds[0])
    expect(lifeSupport.prerequisiteOrderIds!.every((id) =>
      state.settlement.constructionOrders.find((order) => order.id === id)?.priority === 3,
    )).toBe(true)

    for (let tick = 0; tick < 50; tick += 1) {
      state = useColonyStore.getState()
      lifeSupport = state.settlement.constructionOrders.find(
        (order) => order.id === lifeSupportQueue.orderIds[0],
      )!
      const ordersById = new Map(
        state.settlement.constructionOrders.map((order) => [order.id, order]),
      )
      const prerequisitesComplete = lifeSupport.prerequisiteOrderIds!.every(
        (id) => ordersById.get(id)?.status === 'complete',
      )
      if (!prerequisitesComplete) {
        expect(lifeSupport).toMatchObject({
          status: 'blocked',
          block: { kind: 'prerequisite' },
          assignedCrewId: null,
          materials: { reserved: 0, delivered: 0 },
          work: { completed: 0 },
        })
      }
      if (lifeSupport.status === 'complete') break
      useColonyStore.getState().advanceConstruction(10)
    }

    state = useColonyStore.getState()
    lifeSupport = state.settlement.constructionOrders.find(
      (order) => order.id === lifeSupportQueue.orderIds[0],
    )!
    const finalOrdersById = new Map(
      state.settlement.constructionOrders.map((order) => [order.id, order]),
    )
    expect(lifeSupport.status).toBe('complete')
    expect(lifeSupport.prerequisiteOrderIds!.every(
      (id) => finalOrdersById.get(id)?.status === 'complete',
    )).toBe(true)
    useColonyStore.getState().resetColony()
  }, 15_000)


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
      {
        commandId: 'door',
        sequenceStart: 2,
        completedLayout: initial.settlement.layout,
        prerequisiteOrders: wallOrders,
      },
    )
    expect(doorOrders[0].prerequisiteOrderIds).toEqual(['wall:1'])
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
