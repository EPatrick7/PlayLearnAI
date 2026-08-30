import { describe, expect, it } from 'vitest'
import {
  createConstructionLayout,
  getWorkstationCells,
  type WorkstationPlacement,
} from '../game/construction'
import type { ConstructionOrder } from '../game/constructionJobs'
import { createStarterConstruction } from '../game/constructionCatalog'
import { createInitialState } from '../game/seed'
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
  it('does not claim an enclosed freeform room is pressurized without atmosphere data', () => {
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

    expect(tiles.get('4:9')).toMatchObject({
      surfaceLabel: 'Vacuum floor',
      surfaceDetail: 'Unpressurized player-built room',
      atmosphere: 'no',
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
          { label: 'Materials', value: '2 / 4 delivered · 2 reserved' },
          { label: 'Priority', value: 'P5' },
          { label: 'Builder', value: 'Soo-jin Park' },
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
    expect(blueprint?.stats).toContainEqual({ label: 'Builder', value: 'Unassigned' })
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
      materials: { required: 4, reserved: 0, delivered: 4, recoverable: 0 },
      work: { required: 4, completed: 0 },
    }
    const blueprint = inspection([carrying]).get('5:4')?.contents[0]

    expect(blueprint?.stats).toContainEqual({
      label: 'Materials',
      value: '4 / 4 carried',
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
    expect(inspection().size).toBe(24 * 18)
  })
})
