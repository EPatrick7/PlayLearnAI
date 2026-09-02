import { describe, expect, it } from 'vitest'
import { detectRooms, offsetPresetPoint } from './construction'
import { createPresetMoonbaseConstruction } from './constructionCatalog'
import { constructionSemanticEvaCells } from './constructionHazards'
import type { ConstructionOrder } from './constructionJobs'
import { findConstructionPath } from './constructionPathfinding'
import { normalizeConstructionCrewPositions } from './constructionWorkerRouting'
import {
  analyzeConstructionPressure,
  constructionEnvironmentAt,
} from './pressureTopology'
import { createInitialState } from './seed'
import { deployPresetMoonbase } from './settlement'
import { advanceSimulation, deriveAlerts } from './simulation'

describe('preset moonbase arrival', () => {
  it('creates a furnished multi-room relay with a valid exterior airlock', () => {
    const layout = createPresetMoonbaseConstruction()
    const pressure = analyzeConstructionPressure(layout)

    expect(detectRooms(layout)).toHaveLength(6)
    expect(layout.workstations.filter((item) => item.type === 'bed')).toHaveLength(6)
    expect(layout.workstations).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'life-support' }),
      expect.objectContaining({ type: 'research-bench' }),
      expect.objectContaining({ type: 'storage-rack' }),
      expect.objectContaining({ type: 'solar-array' }),
      expect.objectContaining({ type: 'battery-bank' }),
    ]))
    expect(pressure.doors).toContainEqual(expect.objectContaining({
      role: 'exterior_airlock',
      roomIds: expect.any(Array),
    }))
  })

  it('hands live crew off inside pressure without a breathing alert', () => {
    const initial = createInitialState()
    const [deployed, result] = deployPresetMoonbase(initial)
    const pressure = analyzeConstructionPressure(deployed.settlement.layout)

    expect(result).toMatchObject({ ok: true, code: 'operations_started' })
    expect(deployed.settlement.phase).toBe('operations')
    expect(deployed.settlement.builtModuleIds).toHaveLength(deployed.modules.length)
    expect(deployed.operationsPlan.basedOnWorldRevision).toBe(deployed.worldRevision)
    expect(deployed.crew.every((member) => member.equippedEvaSuitId === null)).toBe(true)
    deployed.settlement.constructionCrew.forEach((position) => {
      expect(constructionEnvironmentAt(
        deployed.settlement.layout,
        pressure,
        position.cell,
      )).toBe('pressurized')
      expect(findConstructionPath(
        deployed.settlement.layout,
        position.cell,
        [deployed.settlement.constructionStockpile],
        { hasEvaSuit: false, pressureTopology: pressure },
      )).not.toBeNull()
    })
    expect(deriveAlerts(deployed).some((alert) => alert.id === 'alert-unprotected-crew'))
      .toBe(false)
    const healthBefore = new Map(deployed.crew.map((member) => [member.id, member.health]))
    const [advanced, advanceResult] = advanceSimulation(deployed, { hours: 1 }, 'agent')
    expect(advanceResult.advancedHours).toBe(1)
    advanced.crew.forEach((member) => {
      expect(member.health).toBe(healthBefore.get(member.id))
    })
    expect(initial.settlement.phase).toBe('landing')
  })

  it('requires an EVA suit for construction movement through the breached lab', () => {
    const [deployed] = deployPresetMoonbase(createInitialState())
    const layout = deployed.settlement.layout
    const pressure = analyzeConstructionPressure(layout)
    const evaRequiredCells = constructionSemanticEvaCells(
      deployed.modules,
      layout,
      deployed.lab.atmosphere,
    )
    const labFloor = offsetPresetPoint({ x: 16, y: 6 })

    expect(evaRequiredCells).toContainEqual(labFloor)
    expect(findConstructionPath(
      layout,
      deployed.settlement.constructionStockpile,
      [labFloor],
      { hasEvaSuit: false, pressureTopology: pressure, evaRequiredCells },
    )).toBeNull()
    expect(findConstructionPath(
      layout,
      deployed.settlement.constructionStockpile,
      [labFloor],
      { hasEvaSuit: true, pressureTopology: pressure, evaRequiredCells },
    )).not.toBeNull()
  })

  it('propagates a breached module hazard through a structurally opened room', () => {
    const [deployed] = deployPresetMoonbase(createInitialState())
    const openedDoor = offsetPresetPoint({ x: 16, y: 8 })
    const openedLayout = {
      ...deployed.settlement.layout,
      boundaries: deployed.settlement.layout.boundaries.filter(
        (boundary) => boundary.x !== openedDoor.x || boundary.y !== openedDoor.y,
      ),
    }
    const hazardKeys = new Set(constructionSemanticEvaCells(
      deployed.modules,
      openedLayout,
      deployed.lab.atmosphere,
    ).map((cell) => `${cell.x}:${cell.y}`))

    const labKey = offsetPresetPoint({ x: 16, y: 6 })
    const spineKey = offsetPresetPoint({ x: 13, y: 9 })
    expect(hazardKeys.has(`${labKey.x}:${labKey.y}`)).toBe(true)
    expect(hazardKeys.has(`${spineKey.x}:${spineKey.y}`)).toBe(true)
  })

  it('repairs fixture-overlapped crew into breathable preset cells', () => {
    const [deployed] = deployPresetMoonbase(createInitialState())
    const layout = deployed.settlement.layout
    const pressure = analyzeConstructionPressure(layout)
    const evaRequiredCells = constructionSemanticEvaCells(
      deployed.modules,
      layout,
      deployed.lab.atmosphere,
    )
    const evaRequiredCellKeys = new Set(
      evaRequiredCells.map((cell) => `${cell.x}:${cell.y}`),
    )
    const repaired = normalizeConstructionCrewPositions(
      layout,
      [{ id: 'lab-left' }, { id: 'lab-right' }, { id: 'eclss' }],
      [
        { crewId: 'lab-left', cell: offsetPresetPoint({ x: 15, y: 4 }), moveCredit: 0 },
        { crewId: 'lab-right', cell: offsetPresetPoint({ x: 17, y: 5 }), moveCredit: 0 },
        { crewId: 'eclss', cell: offsetPresetPoint({ x: 9, y: 4 }), moveCredit: 0 },
      ],
      deployed.settlement.constructionStockpile,
      [],
      evaRequiredCells,
    )

    expect(new Set(repaired.map((position) => `${position.cell.x}:${position.cell.y}`)).size)
      .toBe(repaired.length)
    repaired.forEach((position) => {
      expect(constructionEnvironmentAt(layout, pressure, position.cell)).toBe('pressurized')
      expect(evaRequiredCellKeys.has(`${position.cell.x}:${position.cell.y}`)).toBe(false)
    })
  })

  it('alerts and damages an unsuited active builder inside the breached lab', () => {
    const [deployed] = deployPresetMoonbase(createInitialState())
    const exposed = structuredClone(deployed)
    const member = exposed.crew[0]
    const labFloor = offsetPresetPoint({ x: 16, y: 6 })
    const target = offsetPresetPoint({ x: 16, y: 7 })
    const order: ConstructionOrder = {
      id: 'test-lab-wall',
      commandId: 'test-lab-command',
      sequence: 1,
      priority: 3,
      operation: 'construct',
      status: 'building',
      block: null,
      assignedCrewId: member.id,
      travelPhase: 'at_site',
      target: {
        kind: 'boundary',
        cells: [target],
        construct: { ...target, kind: 'wall' },
        deconstruct: null,
      },
      materials: {
        required: 1,
        reserved: 0,
        delivered: 1,
        recoverable: 0,
      },
      work: { required: 1, completed: 0 },
    }
    exposed.settlement.constructionOrders = [order]
    exposed.settlement.constructionCrew = exposed.settlement.constructionCrew.map((position) => (
      position.crewId === member.id ? { ...position, cell: labFloor } : position
    ))
    member.equippedEvaSuitId = null

    expect(deriveAlerts(exposed)).toContainEqual(expect.objectContaining({
      id: 'alert-unprotected-crew',
    }))
    const healthBefore = member.health
    const [advanced, result] = advanceSimulation(exposed, { hours: 1 }, 'agent')
    expect(result.advancedHours).toBe(1)
    expect(advanced.crew.find((candidate) => candidate.id === member.id)?.health)
      .toBeLessThan(healthBefore)
  })
})
