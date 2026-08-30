import { describe, expect, it } from 'vitest'
import {
  paintBoundaryCell,
  paintBoundaryLine,
  placeWorkstation,
  type ConstructionLayout,
  type ConstructionResult,
} from './construction'
import {
  deriveConstructionOrders,
  projectConstructionOrders,
  type ConstructionOrder,
} from './constructionJobs'
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
    expect(saved.version).toBe(10)
    expect(saved.state?.settlement).toMatchObject({
      phase: 'power_online',
      constructionOrders: [],
      constructionSequence: 1,
      constructionSpeed: 3,
      constructionStockpile: { x: 8, y: 9 },
      constructionCrew: expect.arrayContaining([
        expect.objectContaining({ crewId: 'crew-amina-okafor' }),
      ]),
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
    expect(migratedV6.settlement.constructionStockpile).toEqual({ x: 8, y: 9 })

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

    const future = await migrate!(saved.state, 11) as MoonbaseState
    expect(future).toMatchObject({ worldRevision: 1, settlement: { phase: 'landing' } })
  })

  it('moves a builder through the material pallet before construction can progress', () => {
    useColonyStore.getState().resetColony()
    const target = { x: 12, y: 9 }
    const initial = useColonyStore.getState()
    const queued = initial.queueConstruction(
      paintBoundaryCell(initial.settlement.layout, target, 'wall'),
    )
    expect(queued.ok).toBe(true)

    useColonyStore.getState().advanceConstruction(0.5)
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
    expect(state.reserves.constructionStock).toBe(13)
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
    expect(state.reserves.constructionStock).toBe(13)
    expect(state.settlement.layout.boundaries).toContainEqual({
      ...target,
      kind: 'wall',
    })
    expect(state.settlement.constructionCrew.find(
      (position) => position.crewId === 'crew-mateo-alvarez',
    )?.cell).not.toEqual(target)
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
        origin: { x: 13, y: 4 },
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
