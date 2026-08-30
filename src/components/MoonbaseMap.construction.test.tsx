import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { getWorkstationCells, type WorkstationPlacement } from '../game/construction'
import type { ConstructionOrder } from '../game/constructionJobs'
import {
  generateLunarTerrain,
  isLunarTerrainQuietCell,
  lunarTerrainFeatures,
} from '../game/lunarTerrain'
import { createInitialState } from '../game/seed'
import { MoonbaseMap, type MoonbaseMapProps } from './MoonbaseMap'

const wallCell = { x: 17, y: 12 }
const bunk: WorkstationPlacement = {
  id: 'operations-bunk',
  type: 'bed',
  label: 'Bunk bed',
  origin: { x: 19, y: 12 },
  size: { width: 1, height: 2 },
  rotation: 0,
}

const wallOrder = (overrides: Partial<ConstructionOrder> = {}): ConstructionOrder => ({
  id: 'operations-wall',
  commandId: 'operations-command',
  sequence: 1,
  priority: 3,
  operation: 'construct',
  status: 'hauling',
  block: null,
  assignedCrewId: 'crew-amina-okafor',
  travelPhase: 'to_site',
  target: {
    kind: 'boundary',
    cells: [wallCell],
    construct: { ...wallCell, kind: 'wall' },
    deconstruct: null,
  },
  materials: {
    required: 2,
    reserved: 0,
    delivered: 0,
    recoverable: 0,
    carried: 2,
    carriedByCrewId: 'crew-amina-okafor',
  },
  work: { required: 1, completed: 0 },
  ...overrides,
})

const bunkOrder = (): ConstructionOrder => ({
  ...wallOrder({
    id: 'operations-bunk-order',
    sequence: 2,
    status: 'building',
    assignedCrewId: null,
    travelPhase: 'idle',
    materials: {
      required: 2,
      reserved: 0,
      delivered: 2,
      recoverable: 0,
    },
    work: { required: 2, completed: 1 },
  }),
  target: {
    kind: 'workstation',
    cells: getWorkstationCells(bunk),
    construct: bunk,
    deconstruct: null,
  },
})

const wallBlueprintAt = (id: string, cell: { x: number; y: number }, sequence: number) => wallOrder({
  id,
  commandId: `${id}-command`,
  sequence,
  status: 'hauling',
  assignedCrewId: null,
  travelPhase: 'idle',
  target: {
    kind: 'boundary',
    cells: [cell],
    construct: { ...cell, kind: 'wall' },
    deconstruct: null,
  },
  materials: {
    required: 1,
    reserved: 1,
    delivered: 0,
    recoverable: 0,
  },
  work: { required: 1, completed: 0 },
})

const renderMap = (overrides: Partial<MoonbaseMapProps> = {}) => {
  const state = createInitialState()
  const props: MoonbaseMapProps = {
    width: state.map.width,
    height: state.map.height,
    modules: state.modules,
    crew: [state.crew[0]],
    equipment: [],
    workOrders: [],
    plan: state.operationsPlan,
    dustActive: false,
    selectedModuleId: '',
    onInspectModule: vi.fn(),
    constructionLayout: state.settlement.layout,
    ...overrides,
  }
  return { ...render(<MoonbaseMap {...props} />), props, state }
}

const terrainSignature = (seed: number) => lunarTerrainFeatures(generateLunarTerrain({
  width: 24,
  height: 18,
  seed,
})).map((feature) => [
  feature.kind,
  feature.x,
  feature.y,
  feature.width,
  feature.height,
  feature.variant,
  feature.rotation,
  feature.neighborMask ?? null,
])

describe('lunar terrain generation', () => {
  it('is repeatable for one run seed and varies between run seeds', () => {
    expect(terrainSignature(240826)).toEqual(terrainSignature(240826))
    expect(terrainSignature(240827)).not.toEqual(terrainSignature(240826))
    expect(terrainSignature(0)).not.toEqual(terrainSignature(1))
  })

  it('keeps features in bounds at a restrained density', () => {
    const terrain = generateLunarTerrain({ width: 24, height: 18, seed: 240826 })
    const features = lunarTerrainFeatures(terrain)

    expect(terrain.mountains.length).toBeGreaterThanOrEqual(24)
    expect(terrain.mountains.length).toBeLessThanOrEqual(32)
    expect(terrain.boulders.length).toBeGreaterThanOrEqual(4)
    expect(terrain.boulders.length).toBeLessThanOrEqual(12)
    expect((terrain.mountains.length + terrain.boulders.length) / (24 * 18))
      .toBeGreaterThanOrEqual(0.05)
    expect((terrain.mountains.length + terrain.boulders.length) / (24 * 18))
      .toBeLessThanOrEqual(0.11)
    expect(features.length).toBeGreaterThanOrEqual(46)
    expect(features.length).toBeLessThanOrEqual(72)
    features.forEach((feature) => {
      expect(Number.isInteger(feature.x) && Number.isInteger(feature.y)).toBe(true)
      expect(feature.x).toBeGreaterThanOrEqual(0)
      expect(feature.y).toBeGreaterThanOrEqual(0)
      expect(feature.x + feature.width).toBeLessThanOrEqual(24)
      expect(feature.y + feature.height).toBeLessThanOrEqual(18)
      expect(feature.variant).toBeGreaterThanOrEqual(0)
      expect(feature.variant).toBeLessThanOrEqual(3)
    })
  })

  it('keeps every footprint in bounds on maps smaller than the usual feature sizes', () => {
    ;[
      { width: 1, height: 1 },
      { width: 2, height: 1 },
      { width: 2, height: 2 },
    ].forEach(({ width, height }) => {
      lunarTerrainFeatures(generateLunarTerrain({ width, height, seed: 0 })).forEach((feature) => {
        expect(feature.x).toBeGreaterThanOrEqual(0)
        expect(feature.y).toBeGreaterThanOrEqual(0)
        expect(feature.x + feature.width).toBeLessThanOrEqual(width)
        expect(feature.y + feature.height).toBeLessThanOrEqual(height)
      })
    })
  })

  it('does not overlap physical feature footprints', () => {
    const terrain = generateLunarTerrain({ width: 24, height: 18, seed: 240826 })
    const occupied = new Set<string>()
    ;[
      ...terrain.mountains,
      ...terrain.boulders,
      ...terrain.craters,
      ...terrain.tracks,
      ...terrain.debris,
    ]
      .forEach((feature) => {
        for (let y = feature.y; y < feature.y + feature.height; y += 1) {
          for (let x = feature.x; x < feature.x + feature.width; x += 1) {
            const key = `${x}:${y}`
            expect(occupied.has(key)).toBe(false)
            occupied.add(key)
          }
        }
      })
  })

  it('joins mountain walls while keeping individual boulders separate', () => {
    ;[0, 1, 240826, 240827, -17].forEach((seed) => {
      const terrain = generateLunarTerrain({ width: 24, height: 18, seed })
      const mountainKeys = new Set(terrain.mountains.map((feature) => `${feature.x}:${feature.y}`))
      const rockKeys = new Set([
        ...mountainKeys,
        ...terrain.boulders.map((feature) => `${feature.x}:${feature.y}`),
      ])

      terrain.mountains.forEach((feature) => {
        const expectedMask =
          (mountainKeys.has(`${feature.x}:${feature.y - 1}`) ? 1 : 0) |
          (mountainKeys.has(`${feature.x + 1}:${feature.y}`) ? 2 : 0) |
          (mountainKeys.has(`${feature.x}:${feature.y + 1}`) ? 4 : 0) |
          (mountainKeys.has(`${feature.x - 1}:${feature.y}`) ? 8 : 0)
        expect(feature.width).toBe(1)
        expect(feature.height).toBe(1)
        expect(feature.neighborMask).toBe(expectedMask)
        expect(feature.neighborMask).toBeGreaterThan(0)
        expect(isLunarTerrainQuietCell(feature, 24, 18)).toBe(false)
      })

      terrain.boulders.forEach((feature) => {
        expect(feature.width).toBe(1)
        expect(feature.height).toBe(1)
        expect(feature.neighborMask).toBeUndefined()
        expect(isLunarTerrainQuietCell(feature, 24, 18)).toBe(false)
        for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
          for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
            if (offsetX === 0 && offsetY === 0) continue
            expect(rockKeys.has(`${feature.x + offsetX}:${feature.y + offsetY}`)).toBe(false)
          }
        }
      })
    })
  })
})

describe('MoonbaseMap live construction layer', () => {
  it('keeps seeded terrain stable and separate from the 24 by 18 inspection grid', () => {
    const view = renderMap({ terrainSeed: 240826 })
    const terrain = () => view.container.querySelector<HTMLElement>('.lunar-terrain')
    const signature = () => terrain()?.dataset.terrainSignature
    const generated = generateLunarTerrain({ width: 24, height: 18, seed: 240826 })

    const initialSignature = signature()
    expect(Number(terrain()?.dataset.terrainFeatureCount)).toBeGreaterThanOrEqual(46)
    expect(Number(terrain()?.dataset.terrainMountainCount)).toBe(generated.mountains.length)
    expect(Number(terrain()?.dataset.terrainBoulderCount)).toBe(generated.boulders.length)
    expect(view.container.querySelectorAll('[data-map-cell]')).toHaveLength(24 * 18)
    expect(terrain()).toHaveAttribute('aria-hidden', 'true')
    expect(terrain()).not.toHaveAttribute('data-map-cell')
    expect(terrain()?.style.backgroundImage).toContain('data:image/svg+xml')

    view.rerender(<MoonbaseMap {...view.props} dustActive />)
    expect(signature()).toBe(initialSignature)
    expect(view.container.querySelectorAll('[data-map-cell]')).toHaveLength(24 * 18)

    view.rerender(<MoonbaseMap {...view.props} terrainSeed={240827} />)
    expect(signature()).not.toBe(initialSignature)
  })

  it('renders unfinished walls and workstations as designations above completed objects', () => {
    const { container } = renderMap({ constructionOrders: [wallOrder(), bunkOrder()] })

    const wallBlueprint = container.querySelector('[data-construction-order-id="operations-wall"]')
    expect(wallBlueprint).toHaveClass(
      'operations-blueprint',
      'construction-blueprint-boundary',
      'blueprint-construct',
    )
    expect(wallBlueprint).toHaveAttribute('aria-label', 'Wall blueprint, Walking to site, 35 percent')
    expect(wallBlueprint?.querySelector('.construction-job-progress > i')).toHaveStyle({ width: '35%' })

    const workstationBlueprint = container.querySelector(
      '[data-construction-order-id="operations-bunk-order"]',
    )
    expect(workstationBlueprint).toHaveClass(
      'operations-blueprint',
      'construction-blueprint-workstation',
    )
    expect(workstationBlueprint).toHaveAttribute('data-grid-width', '1')
    expect(workstationBlueprint).toHaveAttribute('data-grid-height', '2')

    expect(container.querySelector('.construction-boundary:not(.operations-blueprint)')).toBeInTheDocument()
    expect(container.querySelector('.construction-workstation:not(.operations-blueprint)')).toBeInTheDocument()
  })

  it('uses simulated construction cells and exposes live activity and cargo', () => {
    const onSelectCrew = vi.fn()
    const onInspectTile = vi.fn()
    const order = wallOrder()
    const state = createInitialState()
    const unassignedCrew = state.crew[1]
    const { container } = renderMap({
      crew: [state.crew[0], unassignedCrew],
      constructionOrders: [order],
      constructionCrew: [
        {
          crewId: 'crew-amina-okafor',
          cell: wallCell,
          moveCredit: 0.4,
        },
        {
          crewId: unassignedCrew.id,
          cell: { x: 23, y: 17 },
          moveCredit: 0,
        },
      ],
      onInspectTile,
      onSelectCrew,
    })

    const builder = screen.getByRole('button', {
      name: /select amina okafor.*walking to site.*carrying 2 construction material/i,
    })
    expect(builder).toHaveAttribute('data-grid-x', '17')
    expect(builder).toHaveAttribute('data-grid-y', '12')
    expect(builder).toHaveAttribute('data-construction-worker-state', 'walking-to-site')
    expect(builder).toHaveAttribute('data-order-id', order.id)
    expect(builder).toHaveAttribute('title', 'Amina Okafor — Walking to site')
    expect(builder.querySelector('.operations-worker-task')).toBeInTheDocument()
    expect(builder.querySelector('.operations-worker-cargo')).toHaveTextContent('2')

    const unassigned = screen.getByRole('button', { name: new RegExp(`select ${unassignedCrew.name}`, 'i') })
    expect(unassigned).not.toHaveAttribute('data-grid-x', '23')
    expect(unassigned).not.toHaveAttribute('data-grid-y', '17')
    expect(unassigned).not.toHaveAttribute('data-construction-worker-id')

    expect(container.querySelector('[data-grid-x="17"][data-grid-y="12"].tile-stack-trigger'))
      .toHaveAccessibleName(/amina okafor, wall blueprint/i)

    fireEvent.click(builder)
    const chooser = screen.getByRole('dialog', { name: 'Choose an item' })
    const builderChoice = within(chooser).getByRole('button', {
      name: /Amina Okafor.*Colonist.*Targeted/i,
    })
    expect(builderChoice).toHaveAttribute('data-pointer-hit', 'true')
    expect(onInspectTile).not.toHaveBeenCalled()
    fireEvent.click(builderChoice)
    expect(onInspectTile).toHaveBeenCalledWith(expect.objectContaining({
      cell: wallCell,
      focusedItem: expect.objectContaining({
        id: 'crew-amina-okafor',
        subtitle: 'Colonist · Walking to site',
        stats: expect.arrayContaining([
          { label: 'Task', value: 'Wall blueprint' },
          { label: 'Cargo', value: '2 construction material' },
        ]),
      }),
    }))
    expect(onSelectCrew).not.toHaveBeenCalled()
  })

  it('keeps legacy callers unchanged when construction simulation props are omitted', () => {
    const { container } = renderMap()
    const builder = screen.getByRole('button', { name: /select amina okafor/i })

    expect(container.querySelector('.operations-blueprint')).not.toBeInTheDocument()
    expect(builder).not.toHaveAttribute('data-construction-worker-id')
    expect(builder).not.toHaveClass('operations-construction-worker')
  })

  it('routes stacked equipment and work marker activation through the chooser', () => {
    const state = createInitialState()
    const equipment = state.equipment[0]
    const workOrder = state.workOrders[0]
    const onSelectEquipment = vi.fn()
    const onSelectWorkOrder = vi.fn()
    const view = renderMap({
      crew: [],
      equipment: [equipment],
      workOrders: [workOrder],
      onSelectEquipment,
      onSelectWorkOrder,
    })

    const equipmentMarker = screen.getByRole('button', {
      name: new RegExp(`select ${equipment.name}`, 'i'),
    })
    const workMarker = screen.getByRole('button', {
      name: new RegExp(`select work order ${workOrder.label}`, 'i'),
    })
    const equipmentCell = {
      x: Number(equipmentMarker.dataset.gridX),
      y: Number(equipmentMarker.dataset.gridY),
    }
    const workCell = {
      x: Number(workMarker.dataset.gridX),
      y: Number(workMarker.dataset.gridY),
    }
    const constructionOrders = [
      wallBlueprintAt('equipment-overlap', equipmentCell, 3),
      wallBlueprintAt('work-overlap', workCell, 4),
    ]

    view.rerender(<MoonbaseMap {...view.props} constructionOrders={constructionOrders} />)

    const stackedEquipment = screen.getByRole('button', {
      name: new RegExp(`select ${equipment.name}.*things share this tile`, 'i'),
    })
    expect(stackedEquipment).toHaveAttribute('aria-haspopup', 'dialog')
    expect(stackedEquipment).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(stackedEquipment)
    expect(stackedEquipment).toHaveAttribute('aria-expanded', 'true')
    const equipmentChooser = screen.getByRole('dialog', { name: 'Choose an item' })
    const equipmentChoice = within(equipmentChooser).getByRole('button', {
      name: new RegExp(`${equipment.name}.*Equipment.*Targeted`, 'i'),
    })
    expect(equipmentChoice).toHaveAttribute('data-pointer-hit', 'true')
    fireEvent.click(equipmentChoice)
    expect(onSelectEquipment).toHaveBeenCalledWith(equipment.id)

    const stackedWork = screen.getByRole('button', {
      name: new RegExp(`select work order ${workOrder.label}.*things share this tile`, 'i'),
    })
    expect(stackedWork).toHaveAttribute('aria-haspopup', 'dialog')
    fireEvent.click(stackedWork)
    const workChooser = screen.getByRole('dialog', { name: 'Choose an item' })
    const workChoice = within(workChooser).getByRole('button', {
      name: new RegExp(`${workOrder.label}.*Work order.*Targeted`, 'i'),
    })
    fireEvent.click(workChoice)
    expect(onSelectWorkOrder).toHaveBeenCalledWith(workOrder.id)
  })
})
