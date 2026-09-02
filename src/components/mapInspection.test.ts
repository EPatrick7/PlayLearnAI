import { describe, expect, it } from 'vitest'
import {
  CONSTRUCTION_GRID_HEIGHT,
  CONSTRUCTION_GRID_WIDTH,
  createConstructionLayout,
  getWorkstationCells,
  offsetPresetPoint,
  offsetStarterPoint,
  type GridPoint,
  type WorkstationPlacement,
} from '../game/construction'
import type { ConstructionOrder } from '../game/constructionJobs'
import { createStarterConstruction } from '../game/constructionCatalog'
import { createInitialState } from '../game/seed'
import { deployPresetMoonbase } from '../game/settlement'
import { constructionSemanticEvaCells } from '../game/constructionHazards'
import {
  buildMapInspection,
  constructionOrderActivity,
  constructionOrderProgress,
} from './mapInspection'

const lifeSupport: WorkstationPlacement = {
  id: 'life-support-1',
  type: 'life-support',
  label: 'Life support',
  origin: { x: 5, y: 4 },
  size: { width: 2, height: 2 },
  rotation: 0,
}

const pointKey = ({ x, y }: GridPoint) => `${x}:${y}`

const workstationOrder = (
  status: ConstructionOrder['status'] = 'building',
): ConstructionOrder => ({
  id: 'construction-8:8',
  commandId: 'construction-8',
  sequence: 8,
  priority: 5,
  operation: 'construct',
  status,
  block: null,
  assignedCrewId: 'crew-builder',
  target: {
    kind: 'workstation',
    cells: getWorkstationCells(lifeSupport),
    construct: lifeSupport,
    deconstruct: null,
  },
  materials: { required: 4, reserved: 2, delivered: 2, recoverable: 0 },
  work: { required: 4, completed: 2 },
})

const inspection = (
  orders: readonly ConstructionOrder[] = [],
  workstations: WorkstationPlacement[] = [],
  constructionPaused = false,
) => {
  const layout = createConstructionLayout()
  layout.workstations = workstations
  return buildMapInspection({
    width: layout.width,
    height: layout.height,
    modules: [],
    crew: [],
    equipment: [],
    workOrders: [],
    entityCells: {
      crew: new Map(),
      equipment: new Map(),
      work: new Map(),
    },
    constructionLayout: layout,
    constructionOrders: orders,
    constructionPaused,
    constructionCrewNames: new Map([['crew-builder', 'Soo-jin Park']]),
  })
}

describe('construction map inspection', () => {
  it('reports preset corridors, the breached lab, and landing pad consistently', () => {
    const [deployed] = deployPresetMoonbase(createInitialState())
    const tiles = buildMapInspection({
      width: deployed.map.width,
      height: deployed.map.height,
      modules: deployed.modules,
      crew: [],
      equipment: [],
      workOrders: [],
      entityCells: {
        crew: new Map(),
        equipment: new Map(),
        work: new Map(),
      },
      constructionLayout: deployed.settlement.layout,
    })

    expect(tiles.get(pointKey(offsetPresetPoint({ x: 7, y: 9 })))).toMatchObject({
      surfaceKind: 'floor',
      surfaceLabel: 'Pressurized floor',
      atmosphere: 'yes',
    })
    expect(tiles.get(pointKey(offsetPresetPoint({ x: 16, y: 6 })))).toMatchObject({
      surfaceKind: 'floor',
      surfaceLabel: 'Vacuum floor',
      atmosphere: 'no',
      moduleName: 'Kepler Laboratory',
    })
    expect(tiles.get(pointKey(offsetPresetPoint({ x: 19, y: 11 })))).toMatchObject({
      surfaceKind: 'landing-pad',
      surfaceLabel: 'Landing pad',
      atmosphere: 'exterior',
      moduleName: 'Shackleton Pad',
    })
  })

  it('reports the central spine as vacuum when the breached lab is opened into it', () => {
    const [deployed] = deployPresetMoonbase(createInitialState())
    const labSpineDoor = offsetPresetPoint({ x: 16, y: 8 })
    const layout = {
      ...deployed.settlement.layout,
      boundaries: deployed.settlement.layout.boundaries.filter(
        (boundary) => boundary.x !== labSpineDoor.x || boundary.y !== labSpineDoor.y,
      ),
    }
    const evaRequiredCells = constructionSemanticEvaCells(
      deployed.modules,
      layout,
      deployed.lab.atmosphere,
    )
    const tiles = buildMapInspection({
      width: deployed.map.width,
      height: deployed.map.height,
      modules: deployed.modules,
      crew: [],
      equipment: [],
      workOrders: [],
      entityCells: { crew: new Map(), equipment: new Map(), work: new Map() },
      constructionLayout: layout,
      evaRequiredCells,
    })

    expect(tiles.get(pointKey(offsetPresetPoint({ x: 13, y: 9 })))).toMatchObject({
      surfaceLabel: 'Vacuum floor',
      atmosphere: 'no',
    })
  })

  it.each([
    { kind: 'wall' as const, label: 'Composite wall', icon: 'wall' as const },
    { kind: 'door' as const, label: 'Unsealed hatch', icon: 'door' as const },
  ])('keeps a $kind as one structure above the underlying terrain surface', ({ kind, label, icon }) => {
    const layout = createConstructionLayout()
    layout.boundaries = [{ x: 5, y: 4, kind }]
    const tiles = buildMapInspection({
      width: layout.width,
      height: layout.height,
      modules: [],
      crew: [],
      equipment: [],
      workOrders: [],
      entityCells: {
        crew: new Map(),
        equipment: new Map(),
        work: new Map(),
      },
      constructionLayout: layout,
    })

    const tile = tiles.get('5:4')
    expect(tile).toMatchObject({
      surfaceKind: 'terrain',
      surfaceLabel: 'Lunar regolith',
    })
    expect(tile?.contents).toEqual([
      expect.objectContaining({
        key: 'boundary:5:4',
        kind: 'boundary',
        label,
        icon,
      }),
    ])
    expect(tile?.contents.filter((item) => item.label === label)).toHaveLength(1)
  })

  it('uses the inspectable key as a stable tie-break for same-kind, same-label items', () => {
    const layout = createConstructionLayout()
    const crewTemplate = createInitialState().crew[0]
    const crew = [
      { ...crewTemplate, id: 'crew-zulu', name: 'Alex Chen' },
      { ...crewTemplate, id: 'crew-alpha', name: 'Alex Chen' },
    ]
    const tiles = buildMapInspection({
      width: layout.width,
      height: layout.height,
      modules: [],
      crew,
      equipment: [],
      workOrders: [],
      entityCells: {
        crew: new Map(crew.map((member) => [member.id, { x: 5, y: 4 }])),
        equipment: new Map(),
        work: new Map(),
      },
      constructionLayout: layout,
    })

    expect(tiles.get('5:4')?.contents.map((item) => item.key)).toEqual([
      'crew:crew-alpha',
      'crew:crew-zulu',
    ])
  })

  it('treats the established starter room as breathable when no incident modules are present', () => {
    const layout = createStarterConstruction()
    const tiles = buildMapInspection({
      width: layout.width,
      height: layout.height,
      modules: [],
      crew: [],
      equipment: [],
      workOrders: [],
      entityCells: {
        crew: new Map(),
        equipment: new Map(),
        work: new Map(),
      },
      constructionLayout: layout,
    })

    expect(tiles.get(pointKey(offsetStarterPoint({ x: 4, y: 9 })))).toMatchObject({
      surfaceLabel: 'Pressurized floor',
      surfaceDetail: 'Sealed player-built room',
      atmosphere: 'yes',
    })
  })

  it('indexes one inspectable blueprint on every target cell with live job data', () => {
    const order = workstationOrder()
    const tiles = inspection([order])

    expect(constructionOrderProgress(order)).toBe(50)
    getWorkstationCells(lifeSupport).forEach((cell) => {
      const blueprint = tiles.get(`${cell.x}:${cell.y}`)?.contents.find(
        (item) => item.kind === 'blueprint',
      )
      expect(blueprint).toMatchObject({
        key: `blueprint:${order.id}`,
        id: order.id,
        label: 'Life support blueprint',
        subtitle: 'Blueprint · Building · P5',
        icon: 'lifeSupport',
        stats: [
          { label: 'Status', value: 'Building' },
          { label: 'Progress', value: '50%' },
          {
            label: 'Materials',
            value: '2 / 4 supplied · 2 delivered at site · 2 reserved at pallet',
          },
          { label: 'Priority', value: 'P5' },
          { label: 'Builder', value: 'Soo-jin Park · automatic' },
          { label: 'Operation', value: 'Inactive until enclosed' },
        ],
      })
    })
  })

  it('keeps a deconstruction blueprint separate from its completed target', () => {
    const order: ConstructionOrder = {
      ...workstationOrder('building'),
      operation: 'deconstruct',
      target: {
        kind: 'workstation',
        cells: getWorkstationCells(lifeSupport),
        construct: null,
        deconstruct: lifeSupport,
      },
      materials: { required: 0, reserved: 0, delivered: 0, recoverable: 4 },
    }
    const tile = inspection([order], [lifeSupport]).get('5:4')

    expect(tile?.contents.map((item) => item.kind)).toEqual([
      'blueprint',
      'workstation',
    ])
    expect(tile?.contents[0]).toMatchObject({
      label: 'Deconstruct Life support',
      detail: 'Remove the complete life support footprint.',
    })
    expect(tile?.contents[0].stats).toContainEqual({
      label: 'Materials',
      value: '4 recoverable',
    })
  })

  it('surfaces a blocked order reason instead of hiding it behind blueprint copy', () => {
    const order: ConstructionOrder = {
      ...workstationOrder('blocked'),
      block: {
        kind: 'insufficient_materials',
        message: 'Needs 2 construction material.',
      },
      assignedCrewId: null,
      materials: { required: 4, reserved: 0, delivered: 2, recoverable: 0 },
    }
    const blueprint = inspection([order]).get('5:4')?.contents[0]

    expect(blueprint).toMatchObject({
      subtitle: 'Blueprint · Needs material · P5',
      detail: 'Needs 2 construction material.',
    })
    expect(blueprint?.stats).toContainEqual({ label: 'Builder', value: 'Automatic · unassigned' })
  })

  it('prioritizes blockers, then pause, then an unassigned builder wait in activity labels', () => {
    const active = {
      ...workstationOrder('hauling'),
      travelPhase: 'to_stockpile' as const,
    }
    const noRoute = {
      ...active,
      assignedCrewId: null,
      status: 'blocked' as const,
      block: {
        kind: 'no_path' as const,
        message: 'No walkable route to this construction site.',
      },
    }
    const prerequisite = {
      ...noRoute,
      block: {
        kind: 'prerequisite' as const,
        message: 'Waiting for an earlier wall.',
      },
    }
    const needsMaterial = {
      ...noRoute,
      block: {
        kind: 'insufficient_materials' as const,
        message: 'Needs 2 construction material.',
      },
    }

    expect(constructionOrderActivity(noRoute, true)).toBe('No route')
    expect(constructionOrderActivity(prerequisite, true)).toBe('Waiting on prerequisite')
    expect(constructionOrderActivity(needsMaterial, true)).toBe('Needs material')
    expect(constructionOrderActivity(active, true)).toBe('Paused')
    expect(constructionOrderActivity({ ...active, assignedCrewId: null })).toBe('Waiting for builder')

    const pausedBlueprint = inspection([active], [], true).get('5:4')?.contents[0]
    expect(pausedBlueprint).toMatchObject({
      subtitle: 'Blueprint · Paused · P5',
      stats: expect.arrayContaining([{ label: 'Status', value: 'Paused' }]),
    })
  })

  it('labels picked-up material as carried until the builder reaches the site', () => {
    const carrying: ConstructionOrder = {
      ...workstationOrder('building'),
      travelPhase: 'to_site',
      materials: {
        required: 4,
        reserved: 0,
        delivered: 0,
        recoverable: 0,
        carried: 4,
        carriedByCrewId: 'crew-builder',
      },
      work: { required: 4, completed: 0 },
    }
    const blueprint = inspection([carrying]).get('5:4')?.contents[0]

    expect(blueprint?.stats).toContainEqual({
      label: 'Materials',
      value: '4 / 4 supplied · 4 carried by Soo-jin Park',
    })
  })

  it('shows physical cargo on the colonist carrying it', () => {
    const layout = createConstructionLayout()
    const builder = {
      ...createInitialState().crew[0],
      id: 'crew-builder',
      name: 'Soo-jin Park',
      status: 'idle' as const,
    }
    const carrying: ConstructionOrder = {
      ...workstationOrder('building'),
      travelPhase: 'to_site',
      materials: {
        required: 4,
        reserved: 0,
        delivered: 0,
        recoverable: 0,
        carried: 4,
        carriedByCrewId: builder.id,
      },
      work: { required: 4, completed: 0 },
    }
    const tiles = buildMapInspection({
      width: layout.width,
      height: layout.height,
      modules: [],
      crew: [builder],
      equipment: [],
      workOrders: [],
      entityCells: {
        crew: new Map([[builder.id, { x: 5, y: 4 }]]),
        equipment: new Map(),
        work: new Map(),
      },
      constructionLayout: layout,
      constructionOrders: [carrying],
    })

    const colonist = tiles.get('5:4')?.contents.find((item) => item.kind === 'crew')
    expect(colonist).toMatchObject({
      label: 'Soo-jin Park',
      subtitle: 'Colonist · Walking to site',
      detail: expect.stringContaining('Carrying 4 material'),
    })
    expect(colonist?.stats).toContainEqual({
      label: 'Cargo',
      value: '4 construction material',
    })
  })

  it('marks an indoor workstation built outdoors as unusable until enclosed', () => {
    const workstation = inspection([], [lifeSupport]).get('5:4')?.contents.find(
      (item) => item.kind === 'workstation',
    )

    expect(workstation).toMatchObject({
      detail: expect.stringContaining('Built outdoors; unusable until enclosed.'),
      stats: expect.arrayContaining([
        { label: 'Room', value: 'Exterior' },
        { label: 'Operation', value: 'Needs enclosed room' },
      ]),
    })
  })

  it('shows a colonist construction assignment instead of stale idle status', () => {
    const layout = createConstructionLayout()
    const builder = {
      ...createInitialState().crew[0],
      id: 'crew-builder',
      name: 'Soo-jin Park',
      status: 'idle' as const,
    }
    const tiles = buildMapInspection({
      width: layout.width,
      height: layout.height,
      modules: [],
      crew: [builder],
      equipment: [],
      workOrders: [],
      entityCells: {
        crew: new Map([[builder.id, { x: 5, y: 4 }]]),
        equipment: new Map(),
        work: new Map(),
      },
      constructionLayout: layout,
      constructionOrders: [workstationOrder('hauling')],
    })

    const colonist = tiles.get('5:4')?.contents.find((item) => item.kind === 'crew')
    expect(colonist).toMatchObject({
      label: 'Soo-jin Park',
      subtitle: 'Colonist · Hauling',
      detail: expect.stringContaining('Life support blueprint'),
    })
    expect(colonist?.stats).toContainEqual({
      label: 'Task',
      value: 'Life support blueprint',
    })
  })

  it('uses physical travel and route-failure language in inspectors', () => {
    const walking = {
      ...workstationOrder('hauling'),
      travelPhase: 'to_site' as const,
    }
    const walkingBlueprint = inspection([walking]).get('5:4')?.contents.find(
      (item) => item.kind === 'blueprint',
    )
    expect(walkingBlueprint).toMatchObject({
      subtitle: 'Blueprint · Walking to site · P5',
      stats: expect.arrayContaining([{ label: 'Status', value: 'Walking to site' }]),
    })

    const stranded = {
      ...walking,
      status: 'blocked' as const,
      assignedCrewId: null,
      travelPhase: 'idle' as const,
      block: {
        kind: 'no_path' as const,
        message: 'No walkable route from an available builder to this construction site.',
      },
    }
    const strandedBlueprint = inspection([stranded]).get('5:4')?.contents.find(
      (item) => item.kind === 'blueprint',
    )
    expect(strandedBlueprint).toMatchObject({
      subtitle: 'Blueprint · No route · P5',
      detail: expect.stringContaining('No walkable route'),
    })
  })

  it('adds the physical material pallet to overlap inspection', () => {
    const layout = createConstructionLayout()
    const tiles = buildMapInspection({
      width: layout.width,
      height: layout.height,
      modules: [],
      crew: [],
      equipment: [],
      workOrders: [],
      entityCells: {
        crew: new Map(),
        equipment: new Map(),
        work: new Map(),
      },
      constructionLayout: layout,
      constructionStockpile: {
        cell: { x: 8, y: 9 },
        stored: 14,
        reserved: 4,
        available: 10,
      },
    })

    expect(tiles.get('8:9')?.contents).toContainEqual(expect.objectContaining({
      key: 'stockpile:construction-material',
      kind: 'stockpile',
      label: 'Construction pallet',
      icon: 'storage',
      stats: [
        { label: 'On pallet', value: '14' },
        { label: 'Reserved', value: '4' },
        { label: 'Available', value: '10' },
      ],
    }))
  })

  it('ignores complete construction orders and remains backward compatible when omitted', () => {
    expect(inspection([workstationOrder('complete')]).get('5:4')?.contents).toEqual([])
    expect(inspection().size).toBe(CONSTRUCTION_GRID_WIDTH * CONSTRUCTION_GRID_HEIGHT)
  })
})
