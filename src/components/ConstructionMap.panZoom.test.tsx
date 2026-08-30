import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createConstructionLayout,
  type ConstructionLayout,
  type GridPoint,
} from '../game/construction'
import type { ConstructionTool } from '../game/constructionCatalog'
import type { ConstructionOrder } from '../game/constructionJobs'
import type { CrewMember } from '../game/types'
import { ConstructionMap } from './ConstructionMap'
import type { MapTileInspection } from './mapInspection'

const originalElementFromPoint = Object.getOwnPropertyDescriptor(document, 'elementFromPoint')

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  if (originalElementFromPoint) {
    Object.defineProperty(document, 'elementFromPoint', originalElementFromPoint)
  } else {
    Reflect.deleteProperty(document, 'elementFromPoint')
  }
})

interface RenderMapOptions {
  constructionOrders?: readonly ConstructionOrder[]
  constructionStock?: number
  constructionStockpile?: GridPoint | null
  crew?: readonly CrewMember[]
  crewCells?: ReadonlyMap<string, GridPoint>
  focusTarget?: { cell: GridPoint; requestId: number } | null
  inspectionByCell?: ReadonlyMap<string, MapTileInspection>
  layout?: ConstructionLayout
  overlapCounts?: ReadonlyMap<string, number>
}

const renderMap = (
  selectedTool: ConstructionTool | null = null,
  options: RenderMapOptions = {},
) => {
  const onApply = vi.fn()
  const onCancelTool = vi.fn()
  const onInspectCell = vi.fn()
  const layout = options.layout ?? createConstructionLayout()
  const mapView = (focusTarget: RenderMapOptions['focusTarget']) => (
    <div className="construction-map-scroll">
      <ConstructionMap
        constructionOrders={options.constructionOrders}
        constructionStock={options.constructionStock}
        constructionStockpile={options.constructionStockpile}
        crew={options.crew}
        crewCells={options.crewCells}
        focusTarget={focusTarget}
        inspectionByCell={options.inspectionByCell}
        layout={layout}
        onApply={onApply}
        onCancelTool={onCancelTool}
        onError={vi.fn()}
        onInspectCell={onInspectCell}
        onRotate={vi.fn()}
        onUndo={vi.fn()}
        overlapCounts={options.overlapCounts}
        rotation={0}
        selectedTool={selectedTool}
      />
    </div>
  )
  const view = render(mapView(options.focusTarget))
  const map = screen.getByRole('group', { name: /freeform construction grid/i })
  const scroll = view.container.querySelector<HTMLElement>('.construction-map-scroll')!
  const surface = view.container.querySelector<HTMLElement>('.construction-camera-surface')!
  const cell = ({ x, y }: GridPoint) => map.querySelector<HTMLElement>(
    `[data-construction-cell][data-grid-x="${x}"][data-grid-y="${y}"]`,
  )!
  const rerenderFocusTarget = (focusTarget: RenderMapOptions['focusTarget']) => {
    view.rerender(mapView(focusTarget))
  }
  return {
    cell,
    container: view.container,
    map,
    onApply,
    onCancelTool,
    onInspectCell,
    rerenderFocusTarget,
    scroll,
    surface,
  }
}

const mockRect = (left: number, top: number, width: number, height: number): DOMRect => ({
  bottom: top + height,
  height,
  left,
  right: left + width,
  top,
  width,
  x: left,
  y: top,
  toJSON: () => ({}),
})

const builder: CrewMember = {
  id: 'crew-builder',
  name: 'Amina Okafor',
  role: 'Mission Commander',
  trait: 'Steady',
  status: 'idle',
  health: 100,
  fatigue: 12,
  morale: 90,
  location: 'habitat',
  taskId: null,
  skills: { engineering: 3, science: 2, medicine: 1, operations: 3 },
}

const inspectionTile = (
  cell: GridPoint,
  contents: MapTileInspection['contents'],
): MapTileInspection => ({
  key: `${cell.x}:${cell.y}`,
  cell,
  surfaceKind: 'terrain',
  surfaceLabel: 'Lunar regolith',
  surfaceDetail: 'Exterior surveyed ground',
  roomId: null,
  roomLabel: null,
  roomArea: null,
  moduleId: null,
  moduleName: null,
  atmosphere: 'exterior',
  contents,
  focusedItem: null,
})

describe('ConstructionMap pan and zoom', () => {
  it('left-drags and one-finger drags the nearest scroll container in Pan mode', () => {
    const { map, scroll } = renderMap()
    scroll.scrollLeft = 100
    scroll.scrollTop = 80

    fireEvent.pointerDown(map, {
      button: 0,
      clientX: 150,
      clientY: 120,
      pointerId: 1,
      pointerType: 'mouse',
    })
    expect(map).toHaveClass('is-panning')
    fireEvent.pointerMove(map, {
      clientX: 120,
      clientY: 100,
      pointerId: 1,
      pointerType: 'mouse',
    })
    fireEvent.pointerUp(map, { pointerId: 1, pointerType: 'mouse' })

    expect(scroll.scrollLeft).toBe(130)
    expect(scroll.scrollTop).toBe(100)

    fireEvent.pointerDown(map, {
      button: 0,
      clientX: 120,
      clientY: 100,
      pointerId: 2,
      pointerType: 'touch',
    })
    fireEvent.pointerMove(map, {
      clientX: 100,
      clientY: 90,
      pointerId: 2,
      pointerType: 'touch',
    })
    fireEvent.pointerUp(map, { pointerId: 2, pointerType: 'touch' })

    expect(scroll.scrollLeft).toBe(150)
    expect(scroll.scrollTop).toBe(110)
  })

  it('focuses the construction grid when a normal pan begins so keyboard controls keep working', () => {
    const { map, scroll, surface } = renderMap()
    const zoomIn = screen.getByRole('button', { name: /zoom in construction map/i })
    zoomIn.focus()
    scroll.scrollTop = 80

    fireEvent.pointerDown(surface, {
      button: 0,
      clientX: 150,
      clientY: 120,
      pointerId: 70,
      pointerType: 'mouse',
    })

    expect(map).toHaveFocus()
    fireEvent.keyDown(document.activeElement!, { key: 'w' })
    expect(scroll.scrollTop).toBe(32)

    fireEvent.pointerUp(surface, {
      button: 0,
      clientX: 150,
      clientY: 120,
      pointerId: 70,
      pointerType: 'mouse',
    })
  })

  it('treats a stationary click as inspection but suppresses inspection after a pan', () => {
    const { cell, map, onInspectCell } = renderMap()

    fireEvent.pointerDown(cell({ x: 4, y: 5 }), {
      button: 0,
      clientX: 120,
      clientY: 140,
      pointerId: 20,
      pointerType: 'mouse',
    })
    fireEvent.pointerUp(cell({ x: 4, y: 5 }), {
      button: 0,
      clientX: 120,
      clientY: 140,
      pointerId: 20,
      pointerType: 'mouse',
    })
    expect(onInspectCell).toHaveBeenCalledWith({ x: 4, y: 5 }, { x: 120, y: 140 })

    onInspectCell.mockClear()
    fireEvent.pointerDown(cell({ x: 4, y: 5 }), {
      button: 0,
      clientX: 120,
      clientY: 140,
      pointerId: 21,
      pointerType: 'mouse',
    })
    fireEvent.pointerMove(map, {
      clientX: 105,
      clientY: 140,
      pointerId: 21,
      pointerType: 'mouse',
    })
    fireEvent.pointerUp(map, {
      button: 0,
      clientX: 105,
      clientY: 140,
      pointerId: 21,
      pointerType: 'mouse',
    })
    expect(onInspectCell).not.toHaveBeenCalled()
  })

  it('preserves a directly hit colonist identity through the camera pointer gesture', () => {
    const crewCell = { x: 6, y: 7 }
    const { map, onInspectCell } = renderMap(null, {
      crew: [builder],
      crewCells: new Map([[builder.id, crewCell]]),
    })
    const pawn = map.querySelector<HTMLElement>(`[data-crew-id="${builder.id}"]`)!

    expect(pawn).toHaveAttribute('data-inspect-item-key', `crew:${builder.id}`)
    fireEvent.pointerDown(pawn, {
      button: 0,
      clientX: 120,
      clientY: 140,
      pointerId: 71,
      pointerType: 'mouse',
    })
    fireEvent.pointerUp(pawn, {
      button: 0,
      clientX: 120,
      clientY: 140,
      pointerId: 71,
      pointerType: 'mouse',
    })

    expect(onInspectCell).toHaveBeenCalledWith(
      crewCell,
      { x: 120, y: 140 },
      `crew:${builder.id}`,
    )
  })

  it('keeps touch jitter as a direct colonist tap, then pans by the full drag distance', () => {
    const crewCell = { x: 6, y: 7 }
    const { map, onInspectCell, scroll } = renderMap(null, {
      crew: [builder],
      crewCells: new Map([[builder.id, crewCell]]),
    })
    const pawn = map.querySelector<HTMLElement>(`[data-crew-id="${builder.id}"]`)!
    scroll.scrollLeft = 100

    fireEvent.pointerDown(pawn, {
      button: 0,
      clientX: 100,
      clientY: 100,
      pointerId: 72,
      pointerType: 'touch',
    })
    fireEvent.pointerMove(map, {
      clientX: 108,
      clientY: 100,
      pointerId: 72,
      pointerType: 'touch',
    })
    expect(scroll.scrollLeft).toBe(100)
    fireEvent.pointerUp(map, {
      clientX: 108,
      clientY: 100,
      pointerId: 72,
      pointerType: 'touch',
    })
    expect(onInspectCell).toHaveBeenCalledWith(
      crewCell,
      { x: 108, y: 100 },
      `crew:${builder.id}`,
    )

    onInspectCell.mockClear()
    fireEvent.pointerDown(pawn, {
      button: 0,
      clientX: 100,
      clientY: 100,
      pointerId: 73,
      pointerType: 'touch',
    })
    fireEvent.pointerMove(map, {
      clientX: 108,
      clientY: 100,
      pointerId: 73,
      pointerType: 'touch',
    })
    fireEvent.pointerMove(map, {
      clientX: 113,
      clientY: 100,
      pointerId: 73,
      pointerType: 'touch',
    })
    expect(scroll.scrollLeft).toBe(87)
    fireEvent.pointerUp(map, {
      clientX: 113,
      clientY: 100,
      pointerId: 73,
      pointerType: 'touch',
    })
    expect(onInspectCell).not.toHaveBeenCalled()
  })

  it('opens overlap inspection from an accessible button without arming camera pan', () => {
    const point = { x: 4, y: 5 }
    const tile = inspectionTile(point, [
      {
        key: `crew:${builder.id}`,
        kind: 'crew',
        id: builder.id,
        label: builder.name,
        subtitle: 'Colonist · Idle',
        detail: builder.role,
        icon: 'crew',
        cell: point,
        stats: [],
      },
      {
        key: 'blueprint:wall-1',
        kind: 'blueprint',
        id: 'wall-1',
        label: 'Wall blueprint',
        subtitle: 'Blueprint · Paused · P3',
        detail: 'Build a wall.',
        icon: 'wall',
        cell: point,
        stats: [],
      },
    ])
    const { map, onInspectCell } = renderMap(null, {
      inspectionByCell: new Map([[tile.key, tile]]),
      overlapCounts: new Map([[tile.key, 2]]),
    })
    const trigger = screen.getByRole('button', {
      name: /choose 2 overlapping items on column 5, row 6: Amina Okafor, Wall blueprint/i,
    })

    expect(trigger.querySelector('.game-icon')).toBeInTheDocument()
    expect(trigger).toHaveTextContent('2')
    fireEvent.pointerDown(trigger, {
      button: 0,
      pointerId: 74,
      pointerType: 'mouse',
    })
    expect(map).not.toHaveClass('is-panning')
    fireEvent.click(trigger)

    expect(onInspectCell).toHaveBeenCalledWith(point, { x: 0, y: 0 })
  })

  it('exposes stable inspection keys on every rendered construction object type', () => {
    const layout = createConstructionLayout()
    layout.boundaries = [{ x: 2, y: 2, kind: 'wall' }]
    layout.workstations = [{
      id: 'rack-1',
      type: 'storage-rack',
      label: 'Storage rack',
      origin: { x: 5, y: 5 },
      size: { width: 2, height: 2 },
      rotation: 0,
    }]
    const blueprint: ConstructionOrder = {
      id: 'construction-1:1',
      commandId: 'construction-1',
      sequence: 1,
      priority: 3,
      operation: 'construct',
      status: 'building',
      block: null,
      assignedCrewId: null,
      target: {
        kind: 'boundary',
        cells: [{ x: 9, y: 6 }],
        construct: { x: 9, y: 6, kind: 'wall' },
        deconstruct: null,
      },
      materials: { required: 1, reserved: 0, delivered: 1, recoverable: 0 },
      work: { required: 1, completed: 0 },
    }
    const { map } = renderMap(null, {
      constructionOrders: [blueprint],
      constructionStock: 10,
      constructionStockpile: { x: 8, y: 9 },
      crew: [builder],
      crewCells: new Map([[builder.id, { x: 7, y: 7 }]]),
      layout,
    })

    expect(map.querySelector('[data-tile-kind="wall"]'))
      .toHaveAttribute('data-inspect-item-key', 'boundary:2:2')
    expect(map.querySelector('[data-workstation-id="rack-1"]'))
      .toHaveAttribute('data-inspect-item-key', 'workstation:rack-1')
    expect(map.querySelector('[data-construction-order-id="construction-1:1"]'))
      .toHaveAttribute('data-inspect-item-key', 'blueprint:construction-1:1')
    expect(map.querySelector('[data-crew-id="crew-builder"]'))
      .toHaveAttribute('data-inspect-item-key', 'crew:crew-builder')
    expect(map.querySelector('.construction-stockpile'))
      .toHaveAttribute('data-inspect-item-key', 'stockpile:construction-material')
  })

  it.each(['mouse', 'touch'])('never inspects a cancelled stationary %s pointer', (pointerType) => {
    const { cell, map, onInspectCell } = renderMap()

    fireEvent.pointerDown(cell({ x: 4, y: 5 }), {
      button: 0,
      clientX: 120,
      clientY: 140,
      pointerId: 22,
      pointerType,
    })
    fireEvent.pointerCancel(map, {
      clientX: 121,
      clientY: 140,
      pointerId: 22,
      pointerType,
    })

    expect(onInspectCell).not.toHaveBeenCalled()
    expect(map).not.toHaveClass('is-panning')
  })

  it('keeps left drag for construction while middle drag pans with a tool active', () => {
    const { cell, map, onApply, onInspectCell, scroll } = renderMap('wall')

    fireEvent.pointerDown(cell({ x: 1, y: 1 }), {
      button: 0,
      clientX: 40,
      clientY: 40,
      pointerId: 3,
      pointerType: 'mouse',
    })
    fireEvent.pointerUp(cell({ x: 1, y: 1 }), {
      button: 0,
      pointerId: 3,
      pointerType: 'mouse',
    })
    expect(onApply).toHaveBeenCalledOnce()

    scroll.scrollLeft = 60
    fireEvent.pointerDown(map, {
      button: 1,
      clientX: 100,
      clientY: 100,
      pointerId: 4,
      pointerType: 'mouse',
    })
    fireEvent.pointerMove(map, {
      clientX: 75,
      clientY: 100,
      pointerId: 4,
      pointerType: 'mouse',
    })
    fireEvent.pointerUp(map, { button: 1, pointerId: 4, pointerType: 'mouse' })

    expect(scroll.scrollLeft).toBe(85)
    expect(onApply).toHaveBeenCalledOnce()
    expect(onInspectCell).not.toHaveBeenCalled()
  })

  it('middle-drags the camera in Move / Select mode without inspecting', () => {
    const { map, onInspectCell, scroll } = renderMap()
    scroll.scrollLeft = 60
    scroll.scrollTop = 70

    fireEvent.pointerDown(map, {
      button: 1,
      clientX: 100,
      clientY: 100,
      pointerId: 78,
      pointerType: 'mouse',
    })
    fireEvent.pointerMove(map, {
      button: 1,
      clientX: 75,
      clientY: 80,
      pointerId: 78,
      pointerType: 'mouse',
    })
    fireEvent.pointerUp(map, {
      button: 1,
      clientX: 75,
      clientY: 80,
      pointerId: 78,
      pointerType: 'mouse',
    })

    expect(scroll.scrollLeft).toBe(85)
    expect(scroll.scrollTop).toBe(90)
    expect(onInspectCell).not.toHaveBeenCalled()
  })

  it.each([null, 'wall'] as const)(
    'never inspects or applies from a stationary middle click with %s selected',
    (selectedTool) => {
      const { cell, onApply, onInspectCell } = renderMap(selectedTool)

      fireEvent.pointerDown(cell({ x: 4, y: 5 }), {
        button: 1,
        clientX: 120,
        clientY: 140,
        pointerId: 77,
        pointerType: 'mouse',
      })
      fireEvent.pointerUp(cell({ x: 4, y: 5 }), {
        button: 1,
        clientX: 120,
        clientY: 140,
        pointerId: 77,
        pointerType: 'mouse',
      })

      expect(onApply).not.toHaveBeenCalled()
      expect(onInspectCell).not.toHaveBeenCalled()
    },
  )

  it.each([
    ['mouse', 'wall'],
    ['touch', 'wall'],
    ['mouse', 'solar-array'],
    ['touch', 'solar-array'],
  ] as const)(
    'leaves an active-tool primary %s gutter drag inert while %s remains selected',
    (pointerType, selectedTool) => {
      const {
        map,
        onApply,
        onCancelTool,
        onInspectCell,
        scroll,
        surface,
      } = renderMap(selectedTool)
      scroll.scrollLeft = 120
      scroll.scrollTop = 100

      fireEvent.pointerDown(surface, {
        button: 0,
        clientX: 150,
        clientY: 130,
        pointerId: 75,
        pointerType,
      })
      fireEvent.pointerMove(surface, {
        button: 0,
        clientX: 115,
        clientY: 90,
        pointerId: 75,
        pointerType,
      })
      fireEvent.pointerUp(surface, {
        button: 0,
        clientX: 115,
        clientY: 90,
        pointerId: 75,
        pointerType,
      })

      expect(scroll.scrollLeft).toBe(120)
      expect(scroll.scrollTop).toBe(100)
      expect(onApply).not.toHaveBeenCalled()
      expect(onInspectCell).not.toHaveBeenCalled()
      expect(onCancelTool).not.toHaveBeenCalled()
      expect(map).toHaveClass('tool-active')
      expect(map).not.toHaveClass('is-panning')
    },
  )

  it.each(['mouse', 'touch'] as const)(
    'leaves a stationary active-tool gutter %s tap inert',
    (pointerType) => {
      const {
        map,
        onApply,
        onCancelTool,
        onInspectCell,
        scroll,
        surface,
      } = renderMap('wall')
      scroll.scrollLeft = 120
      scroll.scrollTop = 100

      fireEvent.pointerDown(surface, {
        button: 0,
        clientX: 150,
        clientY: 130,
        pointerId: 76,
        pointerType,
      })
      fireEvent.pointerUp(surface, {
        button: 0,
        clientX: 150,
        clientY: 130,
        pointerId: 76,
        pointerType,
      })

      expect(scroll.scrollLeft).toBe(120)
      expect(scroll.scrollTop).toBe(100)
      expect(onApply).not.toHaveBeenCalled()
      expect(onInspectCell).not.toHaveBeenCalled()
      expect(onCancelTool).not.toHaveBeenCalled()
      expect(map).toHaveClass('tool-active')
      expect(map).not.toHaveClass('is-panning')
    },
  )

  it('turns an active touch draft into a two-finger pan without applying it', () => {
    const { cell, map, onApply, scroll } = renderMap('wall')
    scroll.scrollLeft = 100

    fireEvent.pointerDown(cell({ x: 1, y: 1 }), {
      button: 0,
      clientX: 100,
      clientY: 100,
      pointerId: 5,
      pointerType: 'touch',
    })
    fireEvent.pointerDown(cell({ x: 2, y: 1 }), {
      button: 0,
      clientX: 140,
      clientY: 100,
      pointerId: 6,
      pointerType: 'touch',
    })
    fireEvent.pointerMove(map, {
      clientX: 100,
      clientY: 100,
      pointerId: 6,
      pointerType: 'touch',
    })
    fireEvent.pointerUp(map, { pointerId: 6, pointerType: 'touch' })
    fireEvent.pointerUp(map, { pointerId: 5, pointerType: 'touch' })

    expect(scroll.scrollLeft).toBe(120)
    expect(onApply).not.toHaveBeenCalled()
  })

  it('turns a dragged workstation touch into a pan and preserves tap placement', () => {
    const { cell, map, onApply, scroll } = renderMap('solar-array')
    scroll.scrollLeft = 120
    scroll.scrollTop = 100

    fireEvent.pointerDown(cell({ x: 10, y: 6 }), {
      button: 0,
      clientX: 100,
      clientY: 100,
      pointerId: 60,
      pointerType: 'touch',
    })
    fireEvent.pointerMove(map, {
      clientX: 160,
      clientY: 150,
      pointerId: 60,
      pointerType: 'touch',
    })
    fireEvent.pointerUp(map, {
      clientX: 160,
      clientY: 150,
      pointerId: 60,
      pointerType: 'touch',
    })

    expect(scroll.scrollLeft).toBe(60)
    expect(scroll.scrollTop).toBe(50)
    expect(onApply).not.toHaveBeenCalled()
    expect(map).toHaveClass('tool-active')

    fireEvent.pointerDown(cell({ x: 12, y: 6 }), {
      button: 0,
      clientX: 180,
      clientY: 130,
      pointerId: 61,
      pointerType: 'touch',
    })
    fireEvent.pointerUp(cell({ x: 12, y: 6 }), {
      button: 0,
      clientX: 180,
      clientY: 130,
      pointerId: 61,
      pointerType: 'touch',
    })

    expect(onApply).toHaveBeenCalledOnce()
  })

  it('turns a dragged door touch into a pan without placing a door', () => {
    const { cell, map, onApply, scroll } = renderMap('door')
    scroll.scrollLeft = 90
    scroll.scrollTop = 70

    fireEvent.pointerDown(cell({ x: 4, y: 3 }), {
      button: 0,
      clientX: 100,
      clientY: 100,
      pointerId: 62,
      pointerType: 'touch',
    })
    fireEvent.pointerMove(map, {
      clientX: 135,
      clientY: 125,
      pointerId: 62,
      pointerType: 'touch',
    })
    fireEvent.pointerUp(map, {
      clientX: 135,
      clientY: 125,
      pointerId: 62,
      pointerType: 'touch',
    })

    expect(scroll.scrollLeft).toBe(55)
    expect(scroll.scrollTop).toBe(45)
    expect(onApply).not.toHaveBeenCalled()
    expect(map).toHaveClass('tool-active')
  })

  it('allows indoor workstations outdoors with a clear non-blocking room warning', () => {
    const { cell, onApply } = renderMap('storage-rack')

    expect(screen.getAllByText(/placeable.*inactive until enclosed/i)).toHaveLength(2)

    fireEvent.pointerDown(cell({ x: 10, y: 5 }), {
      button: 0,
      clientX: 180,
      clientY: 140,
      pointerId: 63,
      pointerType: 'mouse',
    })
    fireEvent.pointerUp(cell({ x: 10, y: 5 }), {
      button: 0,
      clientX: 180,
      clientY: 140,
      pointerId: 63,
      pointerType: 'mouse',
    })

    expect(onApply).toHaveBeenCalledOnce()
    expect(onApply.mock.calls[0][0]).toMatchObject({
      ok: true,
      layout: {
        workstations: [expect.objectContaining({
          origin: { x: 10, y: 5 },
          type: 'storage-rack',
        })],
      },
    })
  })

  it('edge-scrolls an active wall draft and commits through the newly exposed endpoint', () => {
    const frames: FrameRequestCallback[] = []
    vi.spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        frames.push(callback)
        return frames.length
      })
    vi.spyOn(window, 'cancelAnimationFrame')
      .mockImplementation(() => undefined)
    const { cell, map, onApply, scroll, surface } = renderMap('wall')
    act(() => {
      frames.splice(0).forEach((callback) => callback(0))
    })
    scroll.scrollLeft = 100
    scroll.scrollTop = 80
    vi.spyOn(scroll, 'getBoundingClientRect').mockReturnValue({
      bottom: 240,
      height: 240,
      left: 0,
      right: 300,
      top: 0,
      width: 300,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })
    vi.spyOn(map, 'getBoundingClientRect').mockImplementation(() => {
      const horizontalOffset = scroll.scrollLeft - 100
      return {
        bottom: 760,
        height: 720,
        left: -20 - horizontalOffset,
        right: 940 - horizontalOffset,
        top: 40,
        width: 960,
        x: -20 - horizontalOffset,
        y: 40,
        toJSON: () => ({}),
      }
    })
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn().mockReturnValue(map),
    })

    fireEvent.pointerDown(cell({ x: 2, y: 2 }), {
      button: 0,
      clientX: 180,
      clientY: 120,
      pointerId: 62,
      pointerType: 'mouse',
    })
    fireEvent.pointerMove(map, {
      clientX: 296,
      clientY: 120,
      pointerId: 62,
      pointerType: 'mouse',
    })
    expect(onApply).not.toHaveBeenCalled()

    act(() => {
      frames.shift()?.(16)
      frames.shift()?.(32)
    })

    expect(scroll.scrollLeft).toBeGreaterThan(100)
    expect(screen.getByText('Camera scrolling')).toBeVisible()

    fireEvent.pointerUp(surface, {
      button: 0,
      clientX: 980,
      clientY: 800,
      pointerId: 62,
      pointerType: 'mouse',
    })

    expect(onApply).toHaveBeenCalledOnce()
    expect(onApply.mock.calls[0][0]).toMatchObject({
      ok: true,
      affectedCells: [
        { x: 2, y: 2 },
        { x: 3, y: 2 },
        { x: 4, y: 2 },
        { x: 5, y: 2 },
        { x: 6, y: 2 },
        { x: 7, y: 2 },
        { x: 8, y: 2 },
      ],
    })
    expect(screen.queryByText('Camera scrolling')).not.toBeInTheDocument()
  })

  it('restarts edge-scroll timing without jumping after the pointer leaves and re-enters the edge', () => {
    const frames: FrameRequestCallback[] = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback)
      return frames.length
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined)
    const { cell, map, scroll, surface } = renderMap('wall')
    act(() => {
      frames.splice(0).forEach((callback) => callback(0))
    })
    scroll.scrollLeft = 100
    vi.spyOn(scroll, 'getBoundingClientRect').mockReturnValue({
      bottom: 240,
      height: 240,
      left: 0,
      right: 300,
      top: 0,
      width: 300,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })
    vi.spyOn(map, 'getBoundingClientRect').mockImplementation(() => ({
      bottom: 760,
      height: 720,
      left: -20 - (scroll.scrollLeft - 100),
      right: 940 - (scroll.scrollLeft - 100),
      top: 40,
      width: 960,
      x: -20 - (scroll.scrollLeft - 100),
      y: 40,
      toJSON: () => ({}),
    }))

    fireEvent.pointerDown(cell({ x: 2, y: 2 }), {
      button: 0,
      clientX: 180,
      clientY: 120,
      pointerId: 68,
      pointerType: 'mouse',
    })
    fireEvent.pointerMove(map, {
      clientX: 296,
      clientY: 120,
      pointerId: 68,
      pointerType: 'mouse',
    })
    act(() => {
      frames.shift()?.(16)
      frames.shift()?.(32)
    })
    expect(scroll.scrollLeft).toBeGreaterThan(100)

    fireEvent.pointerMove(map, {
      clientX: 150,
      clientY: 120,
      pointerId: 68,
      pointerType: 'mouse',
    })
    act(() => {
      frames.shift()?.(48)
    })
    const scrollAfterLeavingEdge = scroll.scrollLeft
    expect(screen.queryByText('Camera scrolling')).not.toBeInTheDocument()

    fireEvent.pointerMove(map, {
      clientX: 296,
      clientY: 120,
      pointerId: 68,
      pointerType: 'mouse',
    })
    act(() => {
      frames.shift()?.(1_000)
    })
    expect(scroll.scrollLeft).toBe(scrollAfterLeavingEdge)
    act(() => {
      frames.shift()?.(1_016)
    })
    expect(scroll.scrollLeft).toBeGreaterThan(scrollAfterLeavingEdge)

    fireEvent.pointerCancel(surface, {
      pointerId: 68,
      pointerType: 'mouse',
    })
  })

  it('keeps an edge-adjacent wall tap stationary and one tile wide', () => {
    const frames: FrameRequestCallback[] = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback)
      return frames.length
    })
    const { cell, onApply, scroll } = renderMap('wall')
    act(() => {
      frames.splice(0).forEach((callback) => callback(0))
    })
    scroll.scrollLeft = 100

    fireEvent.pointerDown(cell({ x: 7, y: 2 }), {
      button: 0,
      clientX: 296,
      clientY: 120,
      pointerId: 64,
      pointerType: 'touch',
    })
    expect(frames).toHaveLength(0)
    fireEvent.pointerUp(cell({ x: 7, y: 2 }), {
      button: 0,
      clientX: 296,
      clientY: 120,
      pointerId: 64,
      pointerType: 'touch',
    })

    expect(scroll.scrollLeft).toBe(100)
    expect(onApply).toHaveBeenCalledOnce()
    expect(onApply.mock.calls[0][0]).toMatchObject({
      affectedCells: [{ x: 7, y: 2 }],
    })
  })

  it('tolerates touch jitter on object placement but pans after deliberate movement', () => {
    const { cell, map, onApply, scroll } = renderMap('solar-array')
    scroll.scrollLeft = 100

    fireEvent.pointerDown(cell({ x: 8, y: 5 }), {
      button: 0,
      clientX: 100,
      clientY: 100,
      pointerId: 65,
      pointerType: 'touch',
    })
    fireEvent.pointerMove(cell({ x: 8, y: 5 }), {
      clientX: 108,
      clientY: 100,
      pointerId: 65,
      pointerType: 'touch',
    })
    fireEvent.pointerUp(cell({ x: 8, y: 5 }), {
      button: 0,
      clientX: 108,
      clientY: 100,
      pointerId: 65,
      pointerType: 'touch',
    })
    expect(onApply).toHaveBeenCalledOnce()
    expect(scroll.scrollLeft).toBe(100)

    fireEvent.pointerDown(cell({ x: 12, y: 5 }), {
      button: 0,
      clientX: 150,
      clientY: 100,
      pointerId: 66,
      pointerType: 'touch',
    })
    fireEvent.pointerMove(map, {
      clientX: 163,
      clientY: 100,
      pointerId: 66,
      pointerType: 'touch',
    })
    fireEvent.pointerUp(map, {
      button: 0,
      clientX: 163,
      clientY: 100,
      pointerId: 66,
      pointerType: 'touch',
    })
    expect(onApply).toHaveBeenCalledOnce()
    expect(scroll.scrollLeft).toBe(87)
  })

  it('stops a wall edge-scroll silently when pointer capture is lost', () => {
    const frames: FrameRequestCallback[] = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback)
      return frames.length
    })
    const { cell, map, onApply, scroll, surface } = renderMap('wall')
    act(() => {
      frames.splice(0).forEach((callback) => callback(0))
    })
    scroll.scrollLeft = 100
    vi.spyOn(scroll, 'getBoundingClientRect').mockReturnValue({
      bottom: 240,
      height: 240,
      left: 0,
      right: 300,
      top: 0,
      width: 300,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })

    fireEvent.pointerDown(cell({ x: 2, y: 2 }), {
      button: 0,
      clientX: 180,
      clientY: 120,
      pointerId: 67,
      pointerType: 'mouse',
    })
    fireEvent.pointerMove(map, {
      clientX: 296,
      clientY: 120,
      pointerId: 67,
      pointerType: 'mouse',
    })
    expect(frames).toHaveLength(1)
    fireEvent.lostPointerCapture(surface, {
      pointerId: 67,
      pointerType: 'mouse',
    })
    act(() => {
      frames.splice(0).forEach((callback) => callback(32))
    })

    expect(scroll.scrollLeft).toBe(100)
    expect(onApply).not.toHaveBeenCalled()
    expect(screen.queryByText('Camera scrolling')).not.toBeInTheDocument()
  })

  it('pinch-zooms around the two-finger centroid', () => {
    const { cell, map } = renderMap()
    const output = screen.getByText('100%')

    fireEvent.pointerDown(cell({ x: 1, y: 1 }), {
      button: 0,
      clientX: 100,
      clientY: 100,
      pointerId: 40,
      pointerType: 'touch',
    })
    fireEvent.pointerDown(cell({ x: 2, y: 1 }), {
      button: 0,
      clientX: 140,
      clientY: 100,
      pointerId: 41,
      pointerType: 'touch',
    })
    fireEvent.pointerMove(map, {
      clientX: 180,
      clientY: 100,
      pointerId: 41,
      pointerType: 'touch',
    })

    expect(Number.parseInt(output.textContent ?? '0')).toBeGreaterThan(100)
    fireEvent.pointerUp(map, { pointerId: 41, pointerType: 'touch' })
    fireEvent.pointerUp(map, { pointerId: 40, pointerType: 'touch' })
  })

  it('zooms for unmodified pixel wheel input without using the active tool', () => {
    const { map, onApply, scroll } = renderMap('wall')
    scroll.scrollLeft = 90
    scroll.scrollTop = 70
    vi.spyOn(map, 'getBoundingClientRect').mockReturnValue({
      bottom: 350,
      height: 300,
      left: 100,
      right: 500,
      top: 50,
      width: 400,
      x: 100,
      y: 50,
      toJSON: () => ({}),
    })

    const wheelEvent = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      clientX: 200,
      clientY: 150,
      deltaMode: 0,
      deltaX: 24,
      deltaY: -18,
    })
    fireEvent(map, wheelEvent)

    expect(wheelEvent).toHaveProperty('defaultPrevented', true)
    expect(scroll.scrollLeft).toBe(90)
    expect(scroll.scrollTop).toBe(70)
    expect(Number.parseInt(screen.getByText(/%/).textContent ?? '0')).toBeGreaterThan(100)
    expect(onApply).not.toHaveBeenCalled()
    expect(map).toHaveClass('tool-active')
  })

  it('normalizes pixel, line, and page wheel units through the same zoom action', () => {
    const { map, scroll } = renderMap()
    scroll.scrollTop = 70
    vi.spyOn(map, 'getBoundingClientRect').mockReturnValue({
      bottom: 350,
      height: 300,
      left: 100,
      right: 500,
      top: 50,
      width: 400,
      x: 100,
      y: 50,
      toJSON: () => ({}),
    })

    fireEvent.wheel(map, { clientX: 200, clientY: 150, deltaMode: 0, deltaY: -18 })
    const afterPixel = Number.parseInt(screen.getByText(/%/).textContent ?? '0')
    expect(afterPixel).toBeGreaterThan(100)
    expect(scroll.scrollTop).toBe(70)

    fireEvent.wheel(map, { clientX: 200, clientY: 150, deltaMode: 1, deltaY: -1 })
    const afterLine = Number.parseInt(screen.getByText(/%/).textContent ?? '0')
    expect(afterLine).toBeGreaterThan(afterPixel)
    expect(scroll.scrollTop).toBe(70)

    fireEvent.wheel(map, { clientX: 200, clientY: 150, deltaMode: 2, deltaY: -1 })
    expect(Number.parseInt(screen.getByText(/%/).textContent ?? '0')).toBeGreaterThan(afterLine)
    expect(scroll.scrollTop).toBe(70)
  })

  it.each(['ctrlKey', 'metaKey'] as const)(
    'treats %s wheel input as pointer-anchored pinch zoom',
    (modifier) => {
      const { map, scroll } = renderMap('wall')
      scroll.scrollLeft = 50
      scroll.scrollTop = 60
      vi.spyOn(map, 'getBoundingClientRect')
        .mockReturnValueOnce({
          bottom: 350,
          height: 300,
          left: 100,
          right: 500,
          top: 50,
          width: 400,
          x: 100,
          y: 50,
          toJSON: () => ({}),
        })
        .mockReturnValueOnce({
          bottom: 390,
          height: 360,
          left: 80,
          right: 560,
          top: 30,
          width: 480,
          x: 80,
          y: 30,
          toJSON: () => ({}),
        })

      fireEvent.wheel(map, {
        clientX: 300,
        clientY: 200,
        deltaMode: 0,
        deltaY: -20,
        [modifier]: true,
      })

      expect(Number.parseInt(screen.getByText(/%/).textContent ?? '0')).toBeGreaterThan(100)
      expect(scroll.scrollLeft).toBe(70)
      expect(scroll.scrollTop).toBe(70)
    },
  )

  it('clamps an off-map wheel anchor to the nearest map edge', () => {
    const { map, scroll } = renderMap()
    scroll.scrollLeft = 50
    scroll.scrollTop = 60
    vi.spyOn(map, 'getBoundingClientRect')
      .mockReturnValueOnce({
        bottom: 350,
        height: 300,
        left: 100,
        right: 500,
        top: 50,
        width: 400,
        x: 100,
        y: 50,
        toJSON: () => ({}),
      })
      .mockReturnValueOnce({
        bottom: 390,
        height: 360,
        left: 80,
        right: 560,
        top: 30,
        width: 480,
        x: 80,
        y: 30,
        toJSON: () => ({}),
      })

    fireEvent.wheel(map, {
      clientX: 20,
      clientY: 900,
      deltaMode: 0,
      deltaY: -20,
    })

    expect(scroll.scrollLeft).toBe(30)
    expect(scroll.scrollTop).toBe(100)
  })

  it('zooms with a coarse wheel and exposes clamped accessible controls', () => {
    const { map } = renderMap()
    const output = screen.getByText('100%')

    fireEvent.wheel(map, { clientX: 200, clientY: 150, deltaMode: 1, deltaY: -3 })
    expect(Number.parseInt(output.textContent ?? '0')).toBeGreaterThan(100)

    const zoomIn = screen.getByRole('button', { name: /zoom in construction map/i })
    for (let index = 0; index < 12; index += 1) fireEvent.click(zoomIn)
    expect(output).toHaveTextContent('180%')
    expect(zoomIn).toBeDisabled()

    const zoomOut = screen.getByRole('button', { name: /zoom out construction map/i })
    for (let index = 0; index < 12; index += 1) fireEvent.click(zoomOut)
    expect(output).toHaveTextContent('70%')
    expect(zoomOut).toBeDisabled()
    expect(screen.getByRole('button', { name: /center construction map/i })).toBeVisible()
    expect(map).toHaveAttribute('aria-keyshortcuts', expect.stringContaining('Space'))
    expect(map).toHaveAccessibleDescription(/hold space and left-drag.*every wheel input zooms/i)
  })

  it('temporarily pans with Space and left drag without parking or applying the active tool', () => {
    const { cell, map, onApply, onCancelTool, scroll } = renderMap('wall')
    scroll.scrollLeft = 80
    scroll.scrollTop = 70

    expect(fireEvent.keyDown(map, { code: 'Space', key: ' ' })).toBe(false)
    fireEvent.pointerDown(cell({ x: 2, y: 2 }), {
      button: 0,
      clientX: 120,
      clientY: 110,
      pointerId: 50,
      pointerType: 'mouse',
    })
    fireEvent.pointerMove(map, {
      clientX: 95,
      clientY: 90,
      pointerId: 50,
      pointerType: 'mouse',
    })
    fireEvent.pointerUp(map, { button: 0, pointerId: 50, pointerType: 'mouse' })
    fireEvent.keyUp(map, { code: 'Space', key: ' ' })

    expect(scroll.scrollLeft).toBe(105)
    expect(scroll.scrollTop).toBe(90)
    expect(onApply).not.toHaveBeenCalled()
    expect(onCancelTool).not.toHaveBeenCalled()
    expect(map).toHaveClass('tool-active')

    fireEvent.pointerDown(cell({ x: 3, y: 2 }), {
      button: 0,
      pointerId: 51,
      pointerType: 'mouse',
    })
    fireEvent.pointerUp(cell({ x: 3, y: 2 }), {
      button: 0,
      pointerId: 51,
      pointerType: 'mouse',
    })
    expect(onApply).toHaveBeenCalledOnce()
  })

  it('keeps stationary Space inert while Enter starts and finishes a line draft', () => {
    const { map, onApply } = renderMap('wall')

    fireEvent.keyDown(map, { code: 'Space', key: ' ' })
    fireEvent.keyUp(map, { code: 'Space', key: ' ' })
    expect(onApply).not.toHaveBeenCalled()

    fireEvent.keyDown(map, { key: 'Enter' })
    expect(onApply).not.toHaveBeenCalled()
    fireEvent.keyDown(map, { key: 'ArrowRight' })
    fireEvent.keyDown(map, { key: 'Enter' })
    expect(onApply).toHaveBeenCalledOnce()
    expect(onApply.mock.calls[0][1]).toBe('Wall')
  })

  it('does not arm a line draft when Space wraps a WASD camera move', () => {
    const { map, onApply, scroll } = renderMap('wall')
    scroll.scrollLeft = 80

    fireEvent.keyDown(map, { code: 'Space', key: ' ' })
    fireEvent.keyDown(map, { key: 'd' })
    fireEvent.keyUp(map, { code: 'Space', key: ' ' })
    expect(scroll.scrollLeft).toBe(128)

    fireEvent.keyDown(map, { key: 'Enter' })
    expect(onApply).not.toHaveBeenCalled()
    fireEvent.keyDown(map, { key: 'ArrowRight' })
    fireEvent.keyDown(map, { key: 'Enter' })
    expect(onApply).toHaveBeenCalledOnce()
  })

  it('focuses and centers the first external tile request from live DOM bounds', () => {
    const target = { x: 3, y: 4 }
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains('construction-map-scroll')) {
        return mockRect(50, 30, 300, 200)
      }
      if (this.dataset.gridX === String(target.x) && this.dataset.gridY === String(target.y)) {
        return mockRect(410, 250, 40, 40)
      }
      return mockRect(0, 0, 0, 0)
    })

    const { container, map, scroll } = renderMap(null, {
      focusTarget: { cell: target, requestId: 1 },
    })

    expect(document.activeElement).toBe(map)
    expect(scroll.scrollLeft).toBe(230)
    expect(scroll.scrollTop).toBe(140)
    expect(screen.getByRole('status')).toHaveTextContent(/column 4, row 5/i)
    expect(container.querySelector('.construction-cursor')).toHaveStyle({
      gridColumn: '4',
      gridRow: '5',
    })
  })

  it('re-centers the same tile only for a new focus request id using its latest geometry', () => {
    const target = { x: 6, y: 7 }
    const { cell, rerenderFocusTarget, scroll } = renderMap()
    let viewportBounds = mockRect(20, 10, 240, 180)
    let cellBounds = mockRect(340, 250, 40, 40)
    vi.spyOn(scroll, 'getBoundingClientRect').mockImplementation(() => viewportBounds)
    vi.spyOn(cell(target), 'getBoundingClientRect').mockImplementation(() => cellBounds)
    scroll.scrollLeft = 25
    scroll.scrollTop = 35

    rerenderFocusTarget({ cell: target, requestId: 101 })

    expect(scroll.scrollLeft).toBe(245)
    expect(scroll.scrollTop).toBe(205)

    viewportBounds = mockRect(50, 30, 400, 300)
    cellBounds = mockRect(120, 90, 80, 60)
    scroll.scrollLeft = 90
    scroll.scrollTop = 75
    rerenderFocusTarget({ cell: target, requestId: 101 })
    expect(scroll.scrollLeft).toBe(90)
    expect(scroll.scrollTop).toBe(75)

    rerenderFocusTarget({ cell: target, requestId: 102 })
    expect(scroll.scrollLeft).toBe(0)
    expect(scroll.scrollTop).toBe(15)
  })

  it('moves an active designator preview without applying, cancelling, or inspecting', () => {
    const target = { x: 3, y: 3 }
    const {
      cell,
      map,
      onApply,
      onCancelTool,
      onInspectCell,
      rerenderFocusTarget,
      scroll,
    } = renderMap('solar-array')
    vi.spyOn(scroll, 'getBoundingClientRect').mockReturnValue(mockRect(0, 0, 300, 240))
    vi.spyOn(cell(target), 'getBoundingClientRect').mockReturnValue(mockRect(120, 90, 40, 40))
    const focus = vi.spyOn(map, 'focus')

    rerenderFocusTarget({ cell: target, requestId: 201 })

    expect(focus).toHaveBeenCalledWith({ preventScroll: true })
    expect(map.querySelector(
      '[data-preview-kind="solar-array"][data-grid-x="3"][data-grid-y="3"]',
    )).toBeInTheDocument()
    expect(onApply).not.toHaveBeenCalled()
    expect(onCancelTool).not.toHaveBeenCalled()
    expect(onInspectCell).not.toHaveBeenCalled()
  })

  it('recenters the occupied workspace after a viewport resize', () => {
    let frame = 0
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frame += 1
      callback(frame)
      return frame
    })
    const { map, scroll } = renderMap()
    Object.defineProperties(map, {
      offsetLeft: { configurable: true, value: 400 },
      offsetTop: { configurable: true, value: 300 },
      offsetWidth: { configurable: true, value: 240 },
      offsetHeight: { configurable: true, value: 180 },
    })
    Object.defineProperties(scroll, {
      clientWidth: { configurable: true, value: 100 },
      clientHeight: { configurable: true, value: 80 },
    })

    window.dispatchEvent(new Event('resize'))

    expect(scroll.scrollLeft).toBe(470)
    expect(scroll.scrollTop).toBe(350)
  })

  it('keeps the pan surface larger than the grid so margins also accept camera drags', () => {
    const { map, scroll, surface } = renderMap()
    scroll.scrollLeft = 80

    fireEvent.pointerDown(surface, {
      button: 0,
      clientX: 80,
      clientY: 80,
      pointerId: 30,
      pointerType: 'mouse',
    })
    fireEvent.pointerMove(surface, {
      clientX: 55,
      clientY: 80,
      pointerId: 30,
      pointerType: 'mouse',
    })
    fireEvent.pointerUp(surface, { pointerId: 30, pointerType: 'mouse' })

    expect(scroll.scrollLeft).toBe(105)
    expect(map).not.toBe(surface)
    expect(surface).toContainElement(map)
  })

  it('pans with WASD while Arrow keys move and reveal only the tile cursor', () => {
    const { cell, map, scroll } = renderMap()
    scroll.scrollLeft = 40
    scroll.scrollTop = 25
    vi.spyOn(scroll, 'getBoundingClientRect').mockReturnValue({
      bottom: 200,
      height: 200,
      left: 0,
      right: 200,
      top: 0,
      width: 200,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })
    vi.spyOn(cell({ x: 9, y: 9 }), 'getBoundingClientRect').mockReturnValue({
      bottom: 150,
      height: 40,
      left: 210,
      right: 250,
      top: 110,
      width: 40,
      x: 210,
      y: 110,
      toJSON: () => ({}),
    })

    fireEvent.keyDown(map, { key: 'ArrowRight' })

    expect(scroll.scrollLeft).toBe(114)
    expect(scroll.scrollTop).toBe(25)
    expect(screen.getByRole('status')).toHaveTextContent(/column 10, row 10/i)

    fireEvent.keyDown(map, { key: 'w' })
    expect(scroll.scrollTop).toBe(-23)
    expect(screen.getByRole('status')).toHaveTextContent(/column 10, row 10/i)

    const input = document.createElement('input')
    map.append(input)
    input.focus()
    expect(fireEvent.keyDown(input, { key: 'd' })).toBe(true)
    expect(fireEvent.keyDown(input, { key: ' ' })).toBe(true)
    expect(fireEvent.keyUp(input, { key: ' ' })).toBe(true)
    expect(scroll.scrollLeft).toBe(114)
    expect(scroll.scrollTop).toBe(-23)
  })
})
