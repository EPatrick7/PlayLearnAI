import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import {
  detectRooms,
  getWorkstationCells,
  paintBoundaryCell,
  paintBoundaryLine,
  placeWorkstation,
  type ConstructionLayout,
  type ConstructionResult,
  type GridPoint,
} from './game/construction'
import { useColonyStore } from './game/store'

const renderFreshApp = () => {
  const view = render(<App />)
  const pause = screen.queryByRole('button', { name: 'Pause construction' })
  if (pause) fireEvent.click(pause)
  return view
}

const advanceAllConstruction = () => {
  act(() => {
    const previousSpeed = useColonyStore.getState().settlement.constructionSpeed
    useColonyStore.getState().setConstructionSpeed(1)
    for (let tick = 0; tick < 60; tick += 1) {
      if (!useColonyStore.getState().settlement.constructionOrders.some(
        (order) => order.status !== 'complete',
      )) break
      useColonyStore.getState().advanceConstruction(1)
    }
    useColonyStore.getState().setConstructionSpeed(previousSpeed)
  })
}

const constructionMap = () => screen.getByRole('group', {
  name: /freeform construction grid/i,
})

const constructionCell = ({ x, y }: GridPoint) => {
  const cell = constructionMap().querySelector<HTMLElement>(
    `[data-construction-cell][data-grid-x="${x}"][data-grid-y="${y}"]`,
  )
  if (!cell) throw new Error(`Missing construction cell ${x}:${y}.`)
  return cell
}

interface ConstructionPointerGestureOptions {
  button?: number
  endClient?: { x: number; y: number }
  pointerType?: 'mouse' | 'pen' | 'touch'
  startClient?: { x: number; y: number }
}

const clientPointForCell = ({ x, y }: GridPoint) => ({
  x: 40 + x * 32,
  y: 40 + y * 32,
})

const buttonsForButton = (button: number) => button === 0 ? 1 : button === 1 ? 4 : 2

const dragConstructionTool = (
  start: GridPoint,
  end: GridPoint,
  pointerId = 1,
  options: ConstructionPointerGestureOptions = {},
) => {
  const button = options.button ?? 0
  const startClient = options.startClient ?? clientPointForCell(start)
  const endClient = options.endClient ?? clientPointForCell(end)
  const pointerType = options.pointerType ?? 'mouse'
  fireEvent.pointerDown(constructionCell(start), {
    button,
    buttons: buttonsForButton(button),
    clientX: startClient.x,
    clientY: startClient.y,
    pointerId,
    pointerType,
  })
  fireEvent.pointerMove(constructionCell(end), {
    button,
    buttons: buttonsForButton(button),
    clientX: endClient.x,
    clientY: endClient.y,
    pointerId,
    pointerType,
  })
  fireEvent.pointerUp(constructionCell(end), {
    button,
    buttons: 0,
    clientX: endClient.x,
    clientY: endClient.y,
    pointerId,
    pointerType,
  })
}

const clickConstructionCell = (point: GridPoint, pointerId = 1) =>
  dragConstructionTool(point, point, pointerId)

const cancelConstructionToolWithSecondaryClick = (pointerId: number) => {
  fireEvent.pointerDown(constructionMap(), {
    button: 2,
    clientX: 120,
    clientY: 120,
    pointerId,
    pointerType: 'mouse',
  })
  fireEvent.pointerUp(constructionMap(), {
    button: 2,
    clientX: 120,
    clientY: 120,
    pointerId,
    pointerType: 'mouse',
  })
  fireEvent.contextMenu(constructionMap())
}

const dragConstructionCamera = ({
  button,
  endClient,
  pointerId,
  pointerType = 'mouse',
  startClient,
}: {
  button: 0 | 1 | 2
  endClient: { x: number; y: number }
  pointerId: number
  pointerType?: 'mouse' | 'pen' | 'touch'
  startClient: { x: number; y: number }
}) => {
  const map = constructionMap()
  fireEvent.pointerDown(map, {
    button,
    buttons: buttonsForButton(button),
    clientX: startClient.x,
    clientY: startClient.y,
    pointerId,
    pointerType,
  })
  fireEvent.pointerMove(map, {
    button,
    buttons: buttonsForButton(button),
    clientX: endClient.x,
    clientY: endClient.y,
    pointerId,
    pointerType,
  })
  fireEvent.pointerUp(map, {
    button,
    buttons: 0,
    clientX: endClient.x,
    clientY: endClient.y,
    pointerId,
    pointerType,
  })
  if (button === 2) fireEvent.contextMenu(map)
}

const boundaryConnectionSignature = (root: HTMLElement) =>
  [...root.querySelectorAll<HTMLElement>('[data-boundary-mask]')]
    .filter((tile) => !tile.classList.contains('construction-preview'))
    .map((tile) => [
      tile.dataset.gridX,
      tile.dataset.gridY,
      tile.dataset.tileKind ?? tile.dataset.freeformBoundary,
      tile.dataset.boundaryMask,
      tile.dataset.boundaryConnection,
      tile.classList.contains('door-horizontal') ? 'horizontal' :
        tile.classList.contains('door-vertical') ? 'vertical' : 'wall',
    ].join(':'))
    .sort()

const openCategory = (category: 'Structure' | 'Production' | 'Orders') => {
  const build = screen.getByRole('button', { name: /^Build/i })
  if (build.getAttribute('aria-pressed') !== 'true') fireEvent.click(build)
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${category}$`, 'i') }))
  return screen.getByRole('region', { name: new RegExp(`^${category} build tools$`, 'i') })
}

const selectTool = (
  category: 'Structure' | 'Production' | 'Orders',
  toolName: RegExp,
) => {
  const tray = openCategory(category)
  const tool = within(tray).getByRole('button', { name: toolName })
  fireEvent.click(tool)
  expect(constructionMap()).toHaveClass('tool-active')
  expect(screen.queryByRole('region', { name: new RegExp(`^${category} build tools$`, 'i') }))
    .not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Build menu' })).toHaveAttribute('aria-pressed', 'false')
  expect(screen.getByRole('button', { name: /Return to Select mode from/i })).toBeVisible()
  expect(screen.queryByRole('button', { name: /Move \/ Select|Continue placing/i })).not.toBeInTheDocument()
}

const layoutFrom = (result: ConstructionResult) => {
  if (!result.ok) throw new Error(`${result.code}: ${result.error}`)
  return result.layout
}

const installCompletedConstructionLayout = (layout: ConstructionLayout) => {
  useColonyStore.setState((state) => ({
    settlement: { ...state.settlement, layout, constructionOrders: [] },
    worldRevision: state.worldRevision + 1,
  }))
}

const addEnclosedRoom = (
  source: ConstructionLayout,
  left: number,
  top: number,
  right: number,
  bottom: number,
) => {
  let layout = layoutFrom(
    paintBoundaryLine(source, { x: left, y: top }, { x: right, y: top }, 'wall'),
  )
  layout = layoutFrom(
    paintBoundaryLine(layout, { x: right, y: top }, { x: right, y: bottom }, 'wall'),
  )
  layout = layoutFrom(
    paintBoundaryLine(layout, { x: right, y: bottom }, { x: left, y: bottom }, 'wall'),
  )
  layout = layoutFrom(
    paintBoundaryLine(layout, { x: left, y: bottom }, { x: left, y: top }, 'wall'),
  )
  return layoutFrom(paintBoundaryCell(layout, { x: left + 1, y: top }, 'door'))
}

const seedSecondRoom = () => {
  const state = useColonyStore.getState()
  const layout = addEnclosedRoom(state.settlement.layout, 9, 2, 14, 7)
  installCompletedConstructionLayout(layout)
  return layout
}

const startOperations = () => {
  let layout = seedSecondRoom()
  layout = layoutFrom(placeWorkstation(layout, {
    id: 'life-support-1',
    type: 'life-support',
    label: 'Life support',
    origin: { x: 10, y: 3 },
    size: { width: 2, height: 2 },
    rotation: 0,
  }))
  installCompletedConstructionLayout(layout)
  renderFreshApp()
  fireEvent.click(screen.getByRole('button', { name: 'Begin first shift' }))
  return screen.getByRole('group', { name: /2 player-built rooms/i })
}

beforeEach(() => {
  localStorage.clear()
  useColonyStore.getState().resetColony()
})

afterEach(() => {
  cleanup()
})

describe('freeform settlement builder', () => {
  it('persists the construction clock instead of resetting it when Architect remounts', () => {
    const view = render(<App />)
    fireEvent.click(screen.getByRole('button', { name: '3 times construction speed' }))
    expect(useColonyStore.getState().settlement.constructionSpeed).toBe(3)

    view.unmount()
    render(<App />)

    expect(screen.getByRole('button', { name: '3 times construction speed' }))
      .toHaveAttribute('aria-pressed', 'true')
  })

  it('starts with a semantic 24×18 grid, one room, two independent bunks, and no prefab controls', () => {
    renderFreshApp()

    const map = constructionMap()
    expect(map).toHaveAttribute('aria-roledescription', 'freeform tile construction grid')
    expect(map).toHaveAttribute('data-grid-width', '24')
    expect(map).toHaveAttribute('data-grid-height', '18')
    expect(map).toHaveAccessibleName(/24 columns by 18 rows\. 1 room\./i)

    const layout = useColonyStore.getState().settlement.layout
    expect(detectRooms(layout)).toHaveLength(1)
    expect(layout.boundaries).toHaveLength(16)
    expect(layout.boundaries.filter((cell) => cell.kind === 'wall')).toHaveLength(15)
    expect(layout.boundaries.filter((cell) => cell.kind === 'door')).toHaveLength(1)
    expect(map.querySelectorAll('[data-tile-kind="wall"]')).toHaveLength(15)
    expect(map.querySelectorAll('[data-tile-kind="door"]')).toHaveLength(1)

    const corner = map.querySelector('[data-tile-kind="wall"][data-grid-x="3"][data-grid-y="7"]')
    const straight = map.querySelector('[data-tile-kind="wall"][data-grid-x="4"][data-grid-y="7"]')
    const door = map.querySelector('[data-tile-kind="door"][data-grid-x="7"][data-grid-y="9"]')
    expect(corner).toHaveAttribute('data-boundary-connection', 'corner-east-south')
    expect(corner).toHaveAttribute('data-boundary-mask', '6')
    expect(straight).toHaveAttribute('data-boundary-connection', 'straight-horizontal')
    expect(straight).toHaveAttribute('data-boundary-mask', '10')
    expect(door).toHaveAttribute('data-boundary-connection', 'straight-vertical')
    expect(door).toHaveClass('door-vertical')

    const bunks = layout.workstations.filter((workstation) => workstation.type === 'bed')
    expect(bunks).toHaveLength(2)
    expect(new Set(bunks.map((bunk) => bunk.id)).size).toBe(2)
    const firstBunkCells = new Set(getWorkstationCells(bunks[0]).map(({ x, y }) => `${x}:${y}`))
    expect(getWorkstationCells(bunks[1]).some(({ x, y }) => firstBunkCells.has(`${x}:${y}`))).toBe(false)
    expect(screen.getByRole('img', { name: 'Amina bunk, 1 by 2 tiles' })).toBeVisible()
    expect(screen.getByRole('img', { name: 'Mateo bunk, 1 by 2 tiles' })).toBeVisible()

    expect(map.querySelector('[data-build-site-id]')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^(Place|Preview)\b/i })).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Construction status' })).toHaveTextContent(/No blueprints/i)

    const modes = screen.getByRole('navigation', { name: 'Construction modes' })
    expect(within(modes).getAllByRole('button')).toHaveLength(1)
    expect(within(modes).getByRole('button', { name: 'Build menu' })).toBeVisible()
    expect(screen.queryByRole('complementary', { name: /build guidance/i })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Settlement layout status')).toHaveClass('sr-only')
  })

  it('queues a five-cell wall drag as worker blueprints before completing it', () => {
    renderFreshApp()
    const revision = useColonyStore.getState().worldRevision

    selectTool('Structure', /^Wall/i)
    dragConstructionTool({ x: 9, y: 6 }, { x: 13, y: 6 })

    const state = useColonyStore.getState()
    const paintedBeforeWork = state.settlement.layout.boundaries.filter(
      (cell) => cell.y === 6 && cell.x >= 9 && cell.x <= 13,
    )
    expect(paintedBeforeWork).toEqual([])
    expect(state.settlement.constructionOrders).toHaveLength(5)
    expect(state.settlement.constructionOrders.every(
      (order) => order.status === 'hauling' && order.commandId === 'construction-1',
    )).toBe(true)
    expect(document.querySelector('.construction-toast')).toHaveTextContent(
      /5 wall blueprints placed.*Colonists will haul materials and complete the blueprints/i,
    )
    expect(constructionMap().querySelectorAll(
      '[data-construction-order-status="hauling"]',
    )).toHaveLength(5)
    expect(state.worldRevision).toBe(revision + 1)

    advanceAllConstruction()
    const painted = useColonyStore.getState().settlement.layout.boundaries.filter(
      (cell) => cell.y === 6 && cell.x >= 9 && cell.x <= 13,
    )
    expect(painted).toEqual([
      { x: 9, y: 6, kind: 'wall' },
      { x: 10, y: 6, kind: 'wall' },
      { x: 11, y: 6, kind: 'wall' },
      { x: 12, y: 6, kind: 'wall' },
      { x: 13, y: 6, kind: 'wall' },
    ])
    for (let x = 9; x <= 13; x += 1) {
      expect(constructionMap().querySelector(
        `[data-tile-kind="wall"][data-grid-x="${x}"][data-grid-y="6"]`,
      )).toBeInTheDocument()
    }
    expect(screen.queryByRole('button', { name: 'Undo last construction order' })).not.toBeInTheDocument()
  })

  it('keeps unaffordable blueprints visible and blocked instead of creating material', () => {
    useColonyStore.setState((state) => ({
      reserves: { ...state.reserves, constructionStock: 1 },
    }))
    renderFreshApp()

    selectTool('Structure', /^Wall/i)
    dragConstructionTool({ x: 9, y: 6 }, { x: 10, y: 6 })

    const queued = useColonyStore.getState().settlement.constructionOrders
    expect(queued).toHaveLength(2)
    expect(queued.map((order) => order.status)).toEqual(['hauling', 'blocked'])
    expect(queued[1]).toMatchObject({
      block: { kind: 'insufficient_materials' },
      materials: { required: 1, reserved: 0, delivered: 0 },
    })
    expect(screen.getByRole('region', { name: 'Construction status' })).toHaveTextContent(
      /needs material/i,
    )
    expect(screen.getByRole('img', {
      name: /wall blueprint, needs material/i,
    })).toBeVisible()

    advanceAllConstruction()
    const state = useColonyStore.getState()
    expect(state.reserves.constructionStock).toBe(0)
    expect(state.settlement.layout.boundaries).toContainEqual({ x: 9, y: 6, kind: 'wall' })
    expect(state.settlement.layout.boundaries).not.toContainEqual({ x: 10, y: 6, kind: 'wall' })
    expect(state.settlement.constructionOrders[1]).toMatchObject({
      status: 'blocked',
      block: { kind: 'insufficient_materials' },
    })
  })

  it('closes the desktop catalog after choosing a tool and reselecting it keeps the designator', () => {
    renderFreshApp()
    const structureTools = openCategory('Structure')
    const wall = within(structureTools).getByRole('button', { name: /^Wall:/i })

    fireEvent.click(wall)
    expect(screen.queryByRole('region', { name: /^Structure build tools$/i }))
      .not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Build menu' }))
      .toHaveAttribute('aria-pressed', 'false')
    expect(constructionMap()).toHaveClass('tool-active')
    expect(document.querySelector('.active-tool-summary')).toHaveTextContent('Wall')
    expect(document.querySelector('.construction-designator-strip')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Move \/ Select|Continue placing/i })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Build menu' }))
    const reopenedStructureTools = screen.getByRole('region', {
      name: /^Structure build tools$/i,
    })
    const selectedWall = within(reopenedStructureTools).getByRole('button', { name: /^Wall:/i })
    expect(selectedWall).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(selectedWall)

    expect(screen.queryByRole('region', { name: /^Structure build tools$/i }))
      .not.toBeInTheDocument()
    expect(constructionMap()).toHaveClass('tool-active')
    expect(document.querySelector('.active-tool-summary')).toHaveTextContent('Wall')
    expect(screen.getByRole('button', { name: 'Return to Select mode from Wall' })).toBeVisible()
    expect(screen.queryByRole('button', { name: /Move \/ Select|Continue placing/i })).not.toBeInTheDocument()
    expect(useColonyStore.getState().settlement.constructionOrders).toHaveLength(0)

    cancelConstructionToolWithSecondaryClick(91)
    expect(constructionMap()).toHaveClass('select-active')
    expect(document.querySelector('.active-tool-summary')).toHaveTextContent('Select')

    selectTool('Structure', /^Wall/i)
    fireEvent.keyDown(constructionMap(), { key: 'Escape' })
    expect(constructionMap()).toHaveClass('select-active')
    expect(screen.queryByRole('button', { name: 'Return to Select mode from Wall' })).not.toBeInTheDocument()
  })

  it('keeps placement, active-tool camera drags, and Select inspection in one coherent flow', () => {
    renderFreshApp()
    const completedLayoutBefore = structuredClone(
      useColonyStore.getState().settlement.layout,
    )

    selectTool('Structure', /^Wall/i)
    dragConstructionTool(
      { x: 9, y: 6 },
      { x: 11, y: 6 },
      201,
      {
        startClient: { x: 360, y: 260 },
        endClient: { x: 440, y: 260 },
      },
    )

    let state = useColonyStore.getState()
    expect(state.settlement.layout).toEqual(completedLayoutBefore)
    expect(state.settlement.constructionOrders).toHaveLength(3)
    expect(state.settlement.constructionOrders.every(
      (order) => order.status !== 'complete' && order.target.kind === 'boundary',
    )).toBe(true)
    expect(constructionMap()).toHaveClass('tool-active')
    expect(screen.getByRole('button', { name: 'Build menu' }))
      .toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'Return to Select mode from Wall' })).toBeVisible()

    const orderSnapshot = structuredClone(state.settlement.constructionOrders)
    const revisionAfterPlacement = state.worldRevision
    const scroll = constructionMap().closest<HTMLElement>('.construction-map-scroll')!
    scroll.scrollLeft = 180
    scroll.scrollTop = 140

    dragConstructionCamera({
      button: 2,
      startClient: { x: 320, y: 280 },
      endClient: { x: 270, y: 245 },
      pointerId: 202,
    })
    expect(scroll.scrollLeft).toBe(230)
    expect(scroll.scrollTop).toBe(175)
    expect(constructionMap()).toHaveClass('tool-active')

    dragConstructionCamera({
      button: 1,
      startClient: { x: 270, y: 245 },
      endClient: { x: 240, y: 225 },
      pointerId: 203,
    })
    expect(scroll.scrollLeft).toBe(260)
    expect(scroll.scrollTop).toBe(195)
    expect(constructionMap()).toHaveClass('tool-active')

    state = useColonyStore.getState()
    expect(state.settlement.constructionOrders).toEqual(orderSnapshot)
    expect(state.settlement.layout).toEqual(completedLayoutBefore)
    expect(state.worldRevision).toBe(revisionAfterPlacement)

    fireEvent.click(screen.getByRole('button', { name: 'Return to Select mode from Wall' }))
    expect(constructionMap()).toHaveClass('select-active')

    dragConstructionCamera({
      button: 0,
      startClient: { x: 240, y: 225 },
      endClient: { x: 205, y: 195 },
      pointerId: 204,
    })
    expect(scroll.scrollLeft).toBe(295)
    expect(scroll.scrollTop).toBe(225)
    expect(document.querySelector('.construction-selection-inspector')).not.toBeInTheDocument()
    expect(useColonyStore.getState().settlement.constructionOrders).toEqual(orderSnapshot)

    clickConstructionCell({ x: 0, y: 0 }, 205)
    expect(screen.getByRole('region', { name: 'Lunar regolith inspector' })).toBeVisible()
    expect(useColonyStore.getState().settlement.constructionOrders).toEqual(orderSnapshot)
  })

  it('uses Escape for the active designator, a Build drawer, and tile inspection in sequence', () => {
    renderFreshApp()
    selectTool('Structure', /^Wall/i)

    const map = constructionMap()
    fireEvent.keyDown(map, { key: 'Escape' })
    expect(map).toHaveClass('select-active')
    expect(screen.queryByRole('button', { name: 'Return to Select mode from Wall' }))
      .not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Build menu' }))
    expect(screen.getByRole('button', { name: 'Build menu' }))
      .toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('region', { name: /^Structure build tools$/i })).toBeVisible()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.getByRole('button', { name: 'Build menu' }))
      .toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByRole('region', { name: /^Structure build tools$/i }))
      .not.toBeInTheDocument()

    clickConstructionCell({ x: 0, y: 0 }, 206)
    expect(screen.getByRole('region', { name: 'Lunar regolith inspector' })).toBeVisible()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('region', { name: 'Lunar regolith inspector' }))
      .not.toBeInTheDocument()
    expect(map).toHaveClass('select-active')
    expect(useColonyStore.getState().settlement.constructionOrders).toHaveLength(0)
  })

  it('auto-collapses the catalog after a phone-size tool choice', () => {
    const previousWidth = window.innerWidth
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 700 })
    try {
      renderFreshApp()
      const structureTools = openCategory('Structure')

      fireEvent.click(within(structureTools).getByRole('button', { name: /^Wall:/i }))

      expect(screen.queryByRole('region', { name: /^Structure build tools$/i })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Build menu' })).toHaveAttribute('aria-pressed', 'false')
      expect(document.querySelector('.active-tool-summary')).toHaveTextContent('Wall')
      expect(screen.getByRole('button', { name: 'Return to Select mode from Wall' })).toBeVisible()
      expect(screen.queryByRole('button', { name: /Move \/ Select|Continue placing/i })).not.toBeInTheDocument()
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: previousWidth })
    }
  })

  it('inspects empty tiles and colonists with the same deliberate click gesture', () => {
    renderFreshApp()

    clickConstructionCell({ x: 0, y: 0 })
    const terrainInspector = screen.getByRole('region', { name: 'Lunar regolith inspector' })
    expect(terrainInspector).toHaveTextContent('Exterior · Tile 1, 1')
    expect(terrainInspector).toHaveTextContent('PressureVacuum')
    expect(terrainInspector).toHaveTextContent('ContentsEmpty')

    fireEvent.keyDown(window, { key: 'b' })
    expect(screen.queryByRole('region', { name: 'Lunar regolith inspector' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Build menu' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.keyDown(window, { key: 'b' })

    const colonist = constructionMap().querySelector<HTMLElement>('[data-crew-id]')
    if (!colonist) throw new Error('Missing a visible construction colonist.')
    clickConstructionCell({
      x: Number(colonist.dataset.gridX),
      y: Number(colonist.dataset.gridY),
    }, 2)

    const member = useColonyStore.getState().crew.find(
      (candidate) => candidate.id === colonist.dataset.crewId,
    )!
    const colonistInspector = screen.getByRole('region', { name: `${member.name} inspector` })
    expect(colonistInspector).toHaveClass('selection-crew')
    expect(colonistInspector).toHaveTextContent(member.role)
    expect(colonistInspector).toHaveTextContent('Health')
    expect(colonistInspector).toHaveTextContent('Fatigue')
  })

  it('opens an SS13-style chooser when a worker and blueprint overlap', async () => {
    renderFreshApp()
    selectTool('Structure', /^Wall/i)
    clickConstructionCell({ x: 9, y: 6 })
    cancelConstructionToolWithSecondaryClick(92)
    expect(constructionMap()).toHaveClass('select-active')

    act(() => {
      useColonyStore.getState().setConstructionSpeed(1)
      useColonyStore.getState().advanceConstruction(0.1)
      useColonyStore.getState().setConstructionSpeed(0)
    })
    const order = useColonyStore.getState().settlement.constructionOrders[0]
    expect(order.assignedCrewId).toBeTruthy()
    const assignedState = useColonyStore.getState()
    act(() => {
      useColonyStore.setState({
        settlement: {
          ...assignedState.settlement,
          constructionCrew: assignedState.settlement.constructionCrew.map((position) =>
            position.crewId === order.assignedCrewId
              ? { ...position, cell: { x: 9, y: 6 } }
              : position,
          ),
        },
      })
    })
    const pausedWorker = constructionMap().querySelector<HTMLElement>(
      `[data-construction-worker-id="${order.assignedCrewId}"]`,
    )!
    expect(pausedWorker).toHaveClass('worker-paused')
    expect(pausedWorker).toHaveAttribute('data-construction-worker-state', 'paused')
    expect(pausedWorker.querySelector('.construction-worker-task')).not.toBeInTheDocument()
    expect(pausedWorker.querySelector('[data-pawn-status-dot]')).not.toBeInTheDocument()
    expect(screen.getByRole('img', {
      name: /wall blueprint, paused/i,
    })).toBeVisible()

    fireEvent.pointerDown(pausedWorker, {
      button: 0,
      clientX: 320,
      clientY: 240,
      pointerId: 38,
      pointerType: 'mouse',
    })
    fireEvent.pointerUp(pausedWorker, {
      button: 0,
      clientX: 320,
      clientY: 240,
      pointerId: 38,
      pointerType: 'mouse',
    })
    const directBuilder = useColonyStore.getState().crew.find(
      (member) => member.id === order.assignedCrewId,
    )!
    const directChooser = screen.getByRole('dialog', { name: 'Choose an item' })
    const directBuilderChoice = within(directChooser).getByRole('button', {
      name: new RegExp(`${directBuilder.name}.*Colonist.*Targeted`, 'i'),
    })
    expect(directBuilderChoice).toHaveAttribute('data-pointer-hit', 'true')
    fireEvent.click(directBuilderChoice)
    expect(screen.getByRole('region', { name: `${directBuilder.name} inspector` })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Close inspector' }))

    const map = constructionMap()
    map.focus()
    expect(screen.getByRole('status')).toHaveTextContent(
      /2 inspectable items:.*wall blueprint.*press enter to choose/i,
    )
    fireEvent.keyDown(map, { key: 'Enter' })
    const chooser = screen.getByRole('dialog', { name: 'Choose an item' })
    expect(within(chooser).getByLabelText('2 overlapping items')).toHaveTextContent('2')
    expect(within(chooser).getByRole('button', { name: /Colonist/i })).toBeVisible()
    expect(within(chooser).getByRole('button', {
      name: /Wall blueprint.*Blueprint · Paused/i,
    })).toBeVisible()
    expect(within(chooser).getByRole('button', { name: /Lunar regolith/i })).toBeVisible()

    fireEvent.click(within(chooser).getByRole('button', { name: /Colonist/i }))
    const builder = useColonyStore.getState().crew.find(
      (member) => member.id === order.assignedCrewId,
    )!
    expect(screen.getByRole('region', { name: `${builder.name} inspector` })).toBeVisible()

    const colonistStackButton = screen.getByRole('button', {
      name: 'Choose 2 overlapping items on this tile',
    })
    expect(colonistStackButton).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(colonistStackButton)
    expect(colonistStackButton).toHaveAttribute('aria-expanded', 'true')
    const reopenedChooser = screen.getByRole('dialog', { name: 'Choose an item' })
    expect(reopenedChooser).toBeVisible()
    fireEvent.keyDown(reopenedChooser, { key: 'Escape' })
    expect(screen.getByRole('region', { name: `${builder.name} inspector` })).toBeVisible()
    expect(colonistStackButton).toHaveAttribute('aria-expanded', 'false')
    await waitFor(() => expect(document.activeElement).toBe(colonistStackButton))

    fireEvent.click(colonistStackButton)
    const chooserAfterEscape = screen.getByRole('dialog', { name: 'Choose an item' })
    fireEvent.click(within(chooserAfterEscape).getByRole('button', {
      name: /Wall blueprint.*Blueprint · Paused/i,
    }))
    const blueprintInspector = screen.getByRole('region', { name: 'Wall blueprint inspector' })
    expect(blueprintInspector).toHaveTextContent('Blueprint priority')
    expect(within(blueprintInspector).getByRole('button', { name: 'Cancel blueprint' }))
      .toBeVisible()

    fireEvent.click(within(blueprintInspector).getByRole('button', {
      name: 'Choose 2 overlapping items on this tile',
    }))
    expect(screen.getByRole('dialog', { name: 'Choose an item' })).toBeVisible()
    fireEvent.keyDown(window, { key: 'b' })
    expect(screen.queryByRole('dialog', { name: 'Choose an item' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Build menu' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('edits priority and cancellation for only the blueprint inspected on the tile', () => {
    renderFreshApp()
    selectTool('Structure', /^Wall/i)
    dragConstructionTool({ x: 9, y: 6 }, { x: 11, y: 6 })
    cancelConstructionToolWithSecondaryClick(93)
    clickConstructionCell({ x: 10, y: 6 }, 2)

    const inspector = screen.getByRole('region', { name: 'Wall blueprint inspector' })
    const selectedOrderId = useColonyStore.getState().settlement.constructionOrders.find(
      (order) => order.target.cells.some((cell) => cell.x === 10 && cell.y === 6),
    )!.id
    expect(inspector).toHaveTextContent('P3')
    expect(inspector).toHaveTextContent('0 / 1 supplied · 1 reserved at pallet')
    expect(inspector).toHaveTextContent('Blueprint priority')
    expect(within(inspector).getByRole('button', { name: 'Cancel blueprint' })).toBeVisible()
    expect(screen.getByText('11 free')).toBeVisible()

    const revisionBeforePriorityChange = useColonyStore.getState().worldRevision
    fireEvent.click(within(inspector).getByRole('button', { name: 'Raise blueprint priority' }))
    const reprioritized = useColonyStore.getState().settlement.constructionOrders
    expect(reprioritized).toHaveLength(3)
    expect(reprioritized.find((order) => order.id === selectedOrderId)?.priority).toBe(4)
    expect(reprioritized.filter((order) => order.id !== selectedOrderId).every(
      (order) => order.priority === 3,
    )).toBe(true)
    expect(useColonyStore.getState().worldRevision).toBe(revisionBeforePriorityChange + 1)
    expect(inspector).toHaveTextContent('P4')

    fireEvent.click(within(inspector).getByRole('button', { name: 'Cancel blueprint' }))

    const remaining = useColonyStore.getState().settlement.constructionOrders
    expect(remaining).toHaveLength(2)
    expect(remaining.some((order) => order.id === selectedOrderId)).toBe(false)
    expect(remaining.every((order) => order.priority === 3)).toBe(true)
    expect(screen.getByText('12 free')).toBeVisible()
    expect(screen.getByRole('region', { name: 'Lunar regolith inspector' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Undo last construction order' })).toBeVisible()
  })

  it('opens the current tile inspector from the keyboard in select mode', () => {
    renderFreshApp()
    const map = constructionMap()

    fireEvent.keyDown(map, { key: 'Enter' })

    const inspector = screen.getByRole('region', { name: 'Construction pallet inspector' })
    expect(inspector).toHaveTextContent('Exterior9, 10')
  })

  it('announces keyboard cursor position and commits a keyboard wall draft', () => {
    renderFreshApp()
    selectTool('Structure', /^Wall/i)

    const map = constructionMap()
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent(
      /column 9, row 10.*construction pallet.*press enter to inspect/i,
    )

    fireEvent.keyDown(map, { key: 'ArrowRight' })
    expect(status).toHaveTextContent(/column 10, row 10.*valid wall.*1 tile/i)
    fireEvent.keyDown(map, { key: 'Enter' })
    fireEvent.keyDown(map, { key: 'ArrowRight' })
    expect(status).toHaveTextContent(/column 11, row 10.*valid wall.*2 tiles/i)
    fireEvent.keyDown(map, { key: 'Enter' })

    expect(useColonyStore.getState().settlement.layout.boundaries).not.toEqual(
      expect.arrayContaining([
        { x: 9, y: 9, kind: 'wall' },
        { x: 10, y: 9, kind: 'wall' },
      ]),
    )
    expect(useColonyStore.getState().settlement.constructionOrders).toHaveLength(2)
    advanceAllConstruction()
    expect(useColonyStore.getState().settlement.layout.boundaries).toEqual(
      expect.arrayContaining([
        { x: 9, y: 9, kind: 'wall' },
        { x: 10, y: 9, kind: 'wall' },
      ]),
    )
  })

  it('clears an unfinished keyboard draft when switching construction tools', () => {
    renderFreshApp()
    selectTool('Structure', /^Wall/i)

    const map = constructionMap()
    fireEvent.keyDown(map, { key: 'Enter' })

    selectTool('Orders', /^Deconstruct/i)
    fireEvent.keyDown(map, { key: 'ArrowLeft' })
    fireEvent.keyDown(map, { key: 'Enter' })

    expect(useColonyStore.getState().settlement.layout.boundaries).toContainEqual(
      { x: 7, y: 9, kind: 'door' },
    )

    fireEvent.keyDown(map, { key: 'Enter' })
    expect(useColonyStore.getState().settlement.layout.boundaries).toContainEqual(
      { x: 7, y: 9, kind: 'door' },
    )
    expect(useColonyStore.getState().settlement.constructionOrders).toEqual(
      expect.arrayContaining([expect.objectContaining({ operation: 'deconstruct' })]),
    )
    advanceAllConstruction()
    expect(useColonyStore.getState().settlement.layout.boundaries).not.toContainEqual(
      { x: 7, y: 9, kind: 'door' },
    )
  })

  it('moves a switched tool preview to the live keyboard cursor', () => {
    renderFreshApp()
    selectTool('Structure', /^Wall/i)

    const map = constructionMap()
    fireEvent.keyDown(map, { key: 'Enter' })

    selectTool('Structure', /^Door/i)
    for (let step = 0; step < 4; step += 1) fireEvent.keyDown(map, { key: 'ArrowLeft' })
    fireEvent.keyDown(map, { key: 'ArrowUp' })
    fireEvent.keyDown(map, { key: 'ArrowUp' })

    const preview = map.querySelector('.construction-preview.preview-door')
    expect(preview).toHaveAttribute('data-grid-x', '4')
    expect(preview).toHaveAttribute('data-grid-y', '7')
    expect(screen.getByRole('status')).toHaveTextContent(/column 5, row 8.*valid door/i)

    fireEvent.keyDown(map, { key: 'Enter' })
    expect(useColonyStore.getState().settlement.layout.boundaries).toContainEqual(
      { x: 4, y: 7, kind: 'wall' },
    )
    expect(useColonyStore.getState().settlement.constructionOrders).toEqual(
      expect.arrayContaining([expect.objectContaining({ operation: 'replace' })]),
    )
    advanceAllConstruction()
    expect(useColonyStore.getState().settlement.layout.boundaries).toContainEqual(
      { x: 4, y: 7, kind: 'door' },
    )
  })

  it('uses a two-finger gesture to pan without committing the active wall draft', () => {
    renderFreshApp()
    selectTool('Structure', /^Wall/i)

    const map = constructionMap()
    const scrollContainer = map.closest<HTMLElement>('.construction-map-scroll')!
    scrollContainer.scrollLeft = 100
    const before = useColonyStore.getState().settlement.layout.boundaries

    fireEvent.pointerDown(constructionCell({ x: 1, y: 1 }), {
      button: 0,
      clientX: 100,
      clientY: 100,
      pointerId: 1,
      pointerType: 'touch',
    })
    fireEvent.pointerDown(constructionCell({ x: 2, y: 1 }), {
      button: 0,
      clientX: 140,
      clientY: 100,
      pointerId: 2,
      pointerType: 'touch',
    })
    fireEvent.pointerMove(map, {
      clientX: 100,
      clientY: 100,
      pointerId: 2,
      pointerType: 'touch',
    })
    fireEvent.pointerUp(map, { pointerId: 2, pointerType: 'touch' })
    fireEvent.pointerUp(map, { pointerId: 1, pointerType: 'touch' })

    expect(scrollContainer.scrollLeft).toBeGreaterThan(100)
    expect(useColonyStore.getState().settlement.layout.boundaries).toEqual(before)
  })

  it('rejects a door on terrain, then replaces an existing wall without adding a boundary', () => {
    renderFreshApp()
    selectTool('Structure', /^Door/i)

    const before = useColonyStore.getState()
    clickConstructionCell({ x: 9, y: 6 })

    const rejected = useColonyStore.getState()
    expect(rejected.worldRevision).toBe(before.worldRevision)
    expect(rejected.settlement.layout).toEqual(before.settlement.layout)
    expect(document.querySelector('.construction-toast')).toHaveTextContent(
      /door can only replace an existing wall at 9:6/i,
    )

    clickConstructionCell({ x: 4, y: 7 }, 2)

    const accepted = useColonyStore.getState()
    expect(accepted.worldRevision).toBe(before.worldRevision + 1)
    expect(accepted.settlement.layout.boundaries).toHaveLength(16)
    expect(accepted.settlement.layout.boundaries.find(
      (cell) => cell.x === 4 && cell.y === 7,
    )).toEqual({ x: 4, y: 7, kind: 'wall' })
    expect(screen.getByRole('img', { name: /Door blueprint, paused/i })).toBeVisible()
    expect(constructionMap().querySelector(
      '[data-tile-kind="wall"][data-grid-x="4"][data-grid-y="7"]',
    )).toBeInTheDocument()

    advanceAllConstruction()
    expect(constructionMap().querySelector(
      '[data-tile-kind="door"][data-grid-x="4"][data-grid-y="7"]',
    )).toBeInTheDocument()
    expect(constructionMap().querySelector(
      '[data-tile-kind="wall"][data-grid-x="4"][data-grid-y="7"]',
    )).not.toBeInTheDocument()
  })

  it('reports a newly enclosed freeform room in the semantic grid status', () => {
    const layout = seedSecondRoom()
    expect(detectRooms(layout)).toHaveLength(2)

    renderFreshApp()

    const map = constructionMap()
    expect(map).toHaveAccessibleName(/2 rooms\./i)
    expect(map.querySelectorAll('[data-room-id]')).toHaveLength(
      detectRooms(layout).reduce((area, room) => area + room.area, 0),
    )
    expect(screen.getByLabelText('Settlement layout status')).toHaveTextContent(/Rooms2/i)
  })

  it('places rotated 2×2 life support inside a room', () => {
    seedSecondRoom()
    renderFreshApp()
    const revision = useColonyStore.getState().worldRevision

    selectTool('Production', /^Life support/i)
    const rotate = screen.getByRole('button', { name: /^Rotate Life support to 90°$/i })
    fireEvent.click(rotate)
    expect(screen.getByRole('button', { name: /^Rotate Life support to 180°$/i })).toBeVisible()

    clickConstructionCell({ x: 10, y: 3 })

    const state = useColonyStore.getState()
    expect(state.worldRevision).toBe(revision + 1)
    expect(state.settlement.layout.workstations).not.toContainEqual(expect.objectContaining({
      type: 'life-support',
    }))
    expect(state.settlement.constructionOrders).toContainEqual(expect.objectContaining({
      operation: 'construct',
      target: expect.objectContaining({
        kind: 'workstation',
        construct: expect.objectContaining({
          rotation: 90,
        }),
      }),
    }))
    const blueprint = screen.getByRole('img', { name: /Life support blueprint, paused/i })
    expect(blueprint).toHaveAttribute('data-grid-width', '2')
    expect(blueprint).toHaveAttribute('data-grid-height', '2')

    advanceAllConstruction()
    expect(useColonyStore.getState().settlement.layout.workstations).toContainEqual(expect.objectContaining({
      id: 'life-support-1',
      type: 'life-support',
      label: 'Life support',
      origin: { x: 10, y: 3 },
      size: { width: 2, height: 2 },
      rotation: 90,
    }))
    const lifeSupport = screen.getByRole('img', { name: 'Life support, 2 by 2 tiles' })
    expect(lifeSupport).toHaveAttribute('data-grid-x', '10')
    expect(lifeSupport).toHaveAttribute('data-grid-y', '3')
    expect(lifeSupport).toHaveAttribute('data-grid-width', '2')
    expect(lifeSupport).toHaveAttribute('data-grid-height', '2')
  })

  it('keeps a workstation designator active and queues distinct projected placements', () => {
    seedSecondRoom()
    renderFreshApp()

    selectTool('Production', /^Life support/i)
    fireEvent.click(screen.getByRole('button', { name: 'Rotate Life support to 90°' }))
    clickConstructionCell({ x: 10, y: 3 })

    const map = constructionMap()
    expect(map).toHaveClass('tool-active')
    expect(screen.getByRole('button', {
      name: 'Return to Select mode from Life support',
    })).toBeVisible()
    expect(map.querySelector('.construction-preview')).not.toBeInTheDocument()

    fireEvent.pointerMove(constructionCell({ x: 10, y: 3 }), {
      clientX: 220,
      clientY: 180,
      pointerId: 95,
      pointerType: 'mouse',
    })
    expect(map.querySelector('.construction-preview.invalid')).toHaveAttribute('data-grid-x', '10')
    expect(document.querySelector('.construction-draft-label')).toHaveTextContent(
      'Tile 11, 4 is occupied by Life support.',
    )
    expect(document.querySelector('.construction-draft-label')).not.toHaveTextContent(
      /life-support-1|Cell 10:3/,
    )

    fireEvent.pointerMove(constructionCell({ x: 12, y: 5 }), {
      clientX: 260,
      clientY: 220,
      pointerId: 96,
      pointerType: 'mouse',
    })
    expect(map.querySelector('.construction-preview.valid')).toHaveAttribute('data-grid-x', '12')

    clickConstructionCell({ x: 12, y: 5 }, 94)

    const state = useColonyStore.getState()
    expect(state.settlement.layout.workstations.some(
      (workstation) => workstation.type === 'life-support',
    )).toBe(false)
    const lifeSupportOrders = state.settlement.constructionOrders.filter(
      (order) => order.target.kind === 'workstation' &&
        order.target.construct?.type === 'life-support',
    )
    expect(lifeSupportOrders).toHaveLength(2)
    expect(new Set(lifeSupportOrders.map((order) => order.commandId)).size).toBe(2)
    expect(lifeSupportOrders.map((order) => (
      order.target.kind === 'workstation' ? order.target.construct : null
    ))).toEqual([
      expect.objectContaining({
        id: 'life-support-1',
        origin: { x: 10, y: 3 },
        rotation: 90,
      }),
      expect.objectContaining({
        id: 'life-support-2',
        origin: { x: 12, y: 5 },
        rotation: 90,
      }),
    ])
    expect(screen.getAllByRole('img', { name: /Life support blueprint, paused/i }))
      .toHaveLength(2)
  })

  it('queues whole-workstation deconstruction and Undo cancels it before removal', () => {
    seedSecondRoom()
    renderFreshApp()

    selectTool('Production', /^Life support/i)
    clickConstructionCell({ x: 10, y: 3 })
    advanceAllConstruction()
    expect(screen.getByRole('img', { name: 'Life support, 2 by 2 tiles' })).toBeVisible()

    selectTool('Orders', /^Deconstruct/i)
    clickConstructionCell({ x: 11, y: 4 }, 2)

    expect(useColonyStore.getState().settlement.layout.workstations).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'life-support' })]),
    )
    expect(screen.getByRole('img', { name: /Deconstruct Life support blueprint, paused/i })).toBeVisible()

    const undo = screen.getByRole('button', { name: /^Undo/i })
    expect(undo).toBeEnabled()
    fireEvent.click(undo)

    expect(useColonyStore.getState().settlement.layout.workstations).toEqual(
      expect.arrayContaining([expect.objectContaining({
        id: 'life-support-1',
        origin: { x: 10, y: 3 },
      })]),
    )
    expect(screen.queryByRole('img', { name: /Deconstruct Life support blueprint/i })).not.toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Life support, 2 by 2 tiles' })).toBeVisible()
  })

  it('keeps the latest unfinished placement undoable after Architect remounts', () => {
    const initialStock = useColonyStore.getState().reserves.constructionStock
    const firstView = renderFreshApp()
    selectTool('Structure', /^Wall/i)
    dragConstructionTool({ x: 9, y: 6 }, { x: 11, y: 6 })

    const commandId = useColonyStore.getState().settlement.constructionOrders.at(-1)?.commandId
    expect(commandId).toBeTruthy()
    expect(useColonyStore.getState().settlement.constructionOrders.filter(
      (order) => order.commandId === commandId && order.status !== 'complete',
    )).toHaveLength(3)

    firstView.unmount()
    renderFreshApp()

    const undo = screen.getByRole('button', { name: 'Undo last construction order' })
    expect(undo).toBeVisible()
    fireEvent.click(undo)

    expect(useColonyStore.getState().settlement.constructionOrders.some(
      (order) => order.commandId === commandId && order.status !== 'complete',
    )).toBe(false)
    expect(screen.getByTitle(`${initialStock} material physically in storage`))
      .toHaveTextContent(`${initialStock} free`)
  })

  it('reveals the first-shift transition after a second room has life support', () => {
    let layout = seedSecondRoom()
    layout = layoutFrom(placeWorkstation(layout, {
      id: 'life-support-1',
      type: 'life-support',
      label: 'Life support',
      origin: { x: 10, y: 3 },
      size: { width: 2, height: 2 },
      rotation: 0,
    }))
    installCompletedConstructionLayout(layout)
    renderFreshApp()

    const builderSignature = boundaryConnectionSignature(constructionMap())
    expect(builderSignature).toHaveLength(layout.boundaries.length)
    expect(detectRooms(layout)).toHaveLength(2)

    fireEvent.click(screen.getByRole('button', { name: 'Begin first shift' }))

    const operations = useColonyStore.getState()
    expect(operations.settlement.phase).toBe('operations')
    expect(screen.queryByRole('group', { name: /freeform construction grid/i })).not.toBeInTheDocument()
    expect(screen.getByRole('main')).toHaveClass('world-stage')
    const operationsMap = screen.getByRole('group', { name: /2 player-built rooms/i })
    const tileGrid = within(operationsMap).getByRole('grid', { name: 'Inspectable colony tiles' })
    expect(operationsMap).toHaveAttribute('data-custom-layout', 'true')
    expect(tileGrid).toHaveAttribute('aria-colcount', '24')
    expect(tileGrid).toHaveAttribute('aria-rowcount', '18')
    expect(within(tileGrid).getAllByRole('row')).toHaveLength(18)
    expect(tileGrid.querySelectorAll('[data-map-cell]')).toHaveLength(24 * 18)
    expect(operationsMap.querySelectorAll('[data-freeform-boundary]')).toHaveLength(
      layout.boundaries.length,
    )
    expect(boundaryConnectionSignature(operationsMap)).toEqual(builderSignature)
    expect(detectRooms(operations.settlement.layout)).toHaveLength(2)
    expect(operationsMap.querySelector('[data-freeform-workstation="life-support"]')).toBeVisible()
    const operationalTokens = operationsMap.querySelectorAll<HTMLElement>(
      '.crew-marker, .equipment-marker, .work-hotspot',
    )
    expect([...operationalTokens].every(
      (token) => token.hasAttribute('data-grid-x') && token.hasAttribute('data-grid-y'),
    )).toBe(true)
    expect(operationsMap.querySelector(
      '[data-map-cell][data-grid-x="4"][data-grid-y="8"]',
    )).toHaveAccessibleName(/Amina Okafor.*Amina bunk/i)
    expect(operations.modules.find((module) => module.id === 'module-laboratory')?.position).toEqual({
      x: 9,
      y: 2,
      width: 6,
      height: 6,
    })
    expect(operations.modules.find((module) => module.id === 'module-life-support')?.position).toEqual({
      x: 10,
      y: 3,
      width: 2,
      height: 2,
    })

    expect(screen.queryByRole('region', { name: 'Colony crew' })).not.toBeInTheDocument()
    expect(document.querySelector('.selection-inspector')).not.toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Construction speed' })).toBeVisible()
    expect(screen.getByRole('button', {
      name: 'Open Architect. No unfinished construction jobs.',
    })).toBeVisible()
    expect(within(screen.getByRole('region', { name: 'Current objective' })).getByRole(
      'group',
      { name: 'Active alerts' },
    )).toBeVisible()

    fireEvent.click(within(screen.getByRole('navigation', { name: 'Colony commands' })).getByRole(
      'button',
      { name: 'Crew' },
    ))
    expect(screen.getByRole('region', { name: 'Colony crew' })).toBeVisible()
    expect(document.querySelectorAll('.colonist-strip .pawn-sprite')).toHaveLength(operations.crew.length)
    expect(document.querySelectorAll('.large-portrait .pawn-sprite')).toHaveLength(operations.crew.length)
  })

  it('keeps Architect reachable after operations begin and returns to the colony', () => {
    startOperations()

    const commands = screen.getByRole('navigation', { name: 'Colony commands' })
    fireEvent.click(within(commands).getByRole('button', { name: 'Build' }))

    expect(constructionMap()).toBeVisible()
    expect(screen.getByRole('button', { name: 'Return to colony' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Reset construction map' })).not.toBeInTheDocument()
    expect(useColonyStore.getState().settlement.phase).toBe('operations')

    fireEvent.click(screen.getByRole('button', { name: 'Return to colony' }))
    expect(screen.getByRole('main')).toHaveClass('world-stage')
    expect(screen.getByRole('navigation', { name: 'Colony commands' })).toBeVisible()
  })

  it('keeps one construction clock running after returning to the colony and preserves its receipt', () => {
    vi.useFakeTimers()
    let advanceSpy: ReturnType<typeof vi.spyOn> | null = null
    try {
      startOperations()
      fireEvent.click(within(
        screen.getByRole('navigation', { name: 'Colony commands' }),
      ).getByRole('button', { name: 'Build' }))

      const target = { x: 16, y: 9 }
      selectTool('Structure', /^Wall/i)
      clickConstructionCell(target)

      const queued = useColonyStore.getState().settlement.constructionOrders.at(-1)
      if (!queued) throw new Error('The operations wall did not create a construction order.')
      expect(queued.status).not.toBe('complete')
      expect(useColonyStore.getState().settlement.layout.boundaries)
        .not.toContainEqual({ ...target, kind: 'wall' })

      advanceSpy = vi.spyOn(useColonyStore.getState(), 'advanceConstruction')
      fireEvent.click(screen.getByRole('button', { name: '3 times construction speed' }))

      act(() => vi.advanceTimersByTime(180))

      expect(advanceSpy).toHaveBeenCalledTimes(1)
      let current = useColonyStore.getState().settlement.constructionOrders.find(
        (order) => order.id === queued.id,
      )!
      expect(current.assignedCrewId).toBeTruthy()
      expect(current.status).not.toBe('complete')
      advanceSpy.mockClear()

      fireEvent.click(screen.getByRole('button', { name: 'Return to colony' }))

      expect(screen.getByRole('main')).toHaveClass('world-stage')
      const colonyClock = screen.getByRole('group', { name: 'Construction speed' })
      expect(colonyClock).toBeVisible()
      expect(within(colonyClock).getByRole('button', {
        name: '3 times construction speed',
      })).toHaveAttribute('aria-pressed', 'true')
      expect(screen.getByRole('button', {
        name: /Open Architect, 1 unfinished construction job/i,
      })).toBeVisible()
      expect(document.querySelector(
        `[data-construction-order-id="${queued.id}"]`,
      )).toHaveClass('operations-blueprint')
      const liveBuilder = document.querySelector<HTMLElement>(
        `[data-construction-worker-id="${current.assignedCrewId}"]`,
      )
      expect(liveBuilder).toBeVisible()
      fireEvent.click(liveBuilder!)
      expect(screen.getByRole('region', { name: /inspector/i })).toHaveTextContent(
        /Colonist selected.*TaskWall blueprint/i,
      )

      fireEvent.click(within(colonyClock).getByRole('button', { name: 'Pause construction' }))
      expect(liveBuilder).toHaveClass('worker-paused')
      act(() => vi.advanceTimersByTime(360))
      expect(advanceSpy).not.toHaveBeenCalled()

      fireEvent.click(within(colonyClock).getByRole('button', {
        name: '3 times construction speed',
      }))
      act(() => vi.advanceTimersByTime(180))

      expect(advanceSpy).toHaveBeenCalledTimes(1)
      current = useColonyStore.getState().settlement.constructionOrders.find(
        (order) => order.id === queued.id,
      )!
      expect(current.status).not.toBe('complete')

      for (let tick = 0; tick < 100 && current.status !== 'complete'; tick += 1) {
        act(() => vi.advanceTimersByTime(180))
        current = useColonyStore.getState().settlement.constructionOrders.find(
          (order) => order.id === queued.id,
        )!
      }

      expect(current.status).toBe('complete')
      expect(useColonyStore.getState().settlement.layout.boundaries)
        .toContainEqual({ ...target, kind: 'wall' })

      const buildCommand = within(
        screen.getByRole('navigation', { name: 'Colony commands' }),
      ).getByRole('button', { name: 'Build' })
      expect(buildCommand).toHaveAttribute('title', expect.stringMatching(
        /^Construction complete: 1 wall completed by .+\.$/,
      ))
      expect(buildCommand.querySelector('.construction-complete-badge')).toHaveTextContent('✓')

      fireEvent.click(buildCommand)
      expect(screen.getByRole('region', { name: 'Construction status' })).toHaveTextContent(
        /Construction complete(?:Queue · Complete)?1 wall completed by .+\./,
      )
      expect(document.querySelector('.construction-toast')).toHaveTextContent(
        /1 wall completed by .+\./,
      )
    } finally {
      advanceSpy?.mockRestore()
      vi.useRealTimers()
    }
  }, 15000)

  it('routes, supplies, and builds an operations blueprint on the live Architect clock', () => {
    vi.useFakeTimers()
    try {
      startOperations()
      expect(useColonyStore.getState().operationsPlan.baseline).toBeNull()
      expect(screen.queryByTitle('Advance one hour')).not.toBeInTheDocument()

      fireEvent.click(within(
        screen.getByRole('navigation', { name: 'Colony commands' }),
      ).getByRole('button', { name: 'Build' }))

      expect(screen.getByRole('group', { name: 'Construction speed' })).toBeVisible()
      expect(screen.getByRole('button', { name: '3 times construction speed' })).toBeVisible()

      const target = { x: 16, y: 9 }
      selectTool('Structure', /^Wall/i)
      clickConstructionCell(target)

      let state = useColonyStore.getState()
      const orderId = state.settlement.constructionOrders.at(-1)?.id
      if (!orderId) throw new Error('The operations wall did not create a construction order.')
      expect(state.settlement.layout.boundaries).not.toContainEqual({ ...target, kind: 'wall' })
      expect(state.settlement.constructionOrders.find((order) => order.id === orderId)).toMatchObject({
        status: 'hauling',
        assignedCrewId: null,
        materials: { required: 1, reserved: 1, delivered: 0 },
        work: { completed: 0 },
      })

      fireEvent.click(screen.getByRole('button', { name: '3 times construction speed' }))
      act(() => vi.advanceTimersByTime(180))

      state = useColonyStore.getState()
      let order = state.settlement.constructionOrders.find((candidate) => candidate.id === orderId)!
      expect(order.assignedCrewId).toBeTruthy()
      expect(order.travelPhase).toBe('to_stockpile')
      expect(screen.getByRole('region', { name: 'Construction status' })).toHaveTextContent(
        '1 collecting material',
      )

      const builderId = order.assignedCrewId!
      const startingPosition = state.settlement.constructionCrew.find(
        (position) => position.crewId === builderId,
      )!
      const startingCell = { ...startingPosition.cell }
      const startingMoveCredit = startingPosition.moveCredit
      let sawMovement = false
      let sawCarriedMaterial = false
      let sawDeliveredMaterial = false
      let sawTimedWork = false

      for (let tick = 0; tick < 80 && order.status !== 'complete'; tick += 1) {
        act(() => vi.advanceTimersByTime(180))
        state = useColonyStore.getState()
        order = state.settlement.constructionOrders.find((candidate) => candidate.id === orderId)!
        const builderPosition = state.settlement.constructionCrew.find(
          (position) => position.crewId === builderId,
        )!
        sawMovement ||= builderPosition.cell.x !== startingCell.x ||
          builderPosition.cell.y !== startingCell.y ||
          builderPosition.moveCredit !== startingMoveCredit
        sawCarriedMaterial ||= (order.materials.carried ?? 0) > 0 &&
          order.materials.carriedByCrewId === builderId
        sawDeliveredMaterial ||= order.materials.delivered > 0
        sawTimedWork ||= order.work.completed > 0 && order.work.completed < order.work.required
        if (order.status !== 'complete') {
          expect(state.settlement.layout.boundaries).not.toContainEqual({ ...target, kind: 'wall' })
        }
      }

      expect(sawMovement).toBe(true)
      expect(sawCarriedMaterial).toBe(true)
      expect(sawDeliveredMaterial).toBe(true)
      expect(sawTimedWork).toBe(true)
      const builderName = state.crew.find((member) => member.id === builderId)?.name
      if (!builderName) throw new Error('The completed construction worker was not found.')
      expect(order).toMatchObject({
        status: 'complete',
        assignedCrewId: null,
        travelPhase: 'idle',
        materials: { delivered: 1, carried: 0, carriedByCrewId: null },
        work: { completed: 1 },
      })
      expect(state.settlement.layout.boundaries).toContainEqual({ ...target, kind: 'wall' })
      expect(state.reserves.constructionStock).toBe(13)
      expect(screen.getByRole('region', { name: 'Construction status' })).toHaveTextContent(
        new RegExp(`Construction complete(?:Queue · Complete)?1 wall completed by ${builderName}\\.`),
      )
      expect(document.querySelector('.construction-toast')).toHaveTextContent(
        `1 wall completed by ${builderName}.`,
      )

      const batchStart = { x: 9, y: 12 }
      const batchEnd = { x: 13, y: 12 }
      dragConstructionTool(batchStart, batchEnd, 3)
      state = useColonyStore.getState()
      const batchOrders = state.settlement.constructionOrders.slice(-5)
      expect(batchOrders).toHaveLength(5)
      expect(batchOrders.every((candidate) => candidate.status !== 'complete')).toBe(true)

      for (let tick = 0; tick < 180 && batchOrders.some((candidate) => {
        const current = useColonyStore.getState().settlement.constructionOrders.find(
          (orderCandidate) => orderCandidate.id === candidate.id,
        )
        return current?.status !== 'complete'
      }); tick += 1) {
        act(() => vi.advanceTimersByTime(180))
      }

      state = useColonyStore.getState()
      expect(batchOrders.every((candidate) => state.settlement.constructionOrders.find(
        (orderCandidate) => orderCandidate.id === candidate.id,
      )?.status === 'complete')).toBe(true)
      expect(screen.getByRole('region', { name: 'Construction status' })).toHaveTextContent(
        /Construction complete(?:Queue · Complete)?5 walls completed by .+\./,
      )
      expect(state.reserves.constructionStock).toBe(8)
    } finally {
      vi.useRealTimers()
    }
  }, 15000)

  it('does not open Architect when B is typed into an operations field', () => {
    startOperations()

    const commands = screen.getByRole('navigation', { name: 'Colony commands' })
    fireEvent.click(within(commands).getByRole('button', { name: 'Plan' }))
    const oxygenFloor = screen.getByRole('spinbutton', { name: 'O₂ reserve floor hours' })

    oxygenFloor.focus()
    fireEvent.keyDown(oxygenFloor, { key: 'b' })

    expect(oxygenFloor).toBeVisible()
    expect(screen.getByRole('main')).toHaveClass('world-stage')
    expect(screen.queryByRole('button', { name: 'Return to colony' })).not.toBeInTheDocument()
  })

  it('keeps plan-time actions inside the committed Plan panel', () => {
    startOperations()
    expect(screen.queryByTitle('Advance one hour')).not.toBeInTheDocument()

    fireEvent.click(within(
      screen.getByRole('navigation', { name: 'Colony commands' }),
    ).getByRole('button', { name: 'Work' }))
    fireEvent.click(screen.getByRole('button', { name: /Stage response|Load example/i }))
    const panelClock = screen.getByRole('group', { name: 'Construction speed' })
    expect(panelClock).toBeVisible()
    fireEvent.click(within(panelClock).getByRole('button', { name: 'Pause construction' }))
    expect(within(panelClock).getByRole('button', { name: 'Pause construction' }))
      .toHaveAttribute('aria-pressed', 'true')

    const commit = screen.getByRole('button', { name: 'Commit plan' })
    expect(commit).toBeEnabled()
    fireEvent.click(commit)

    expect(screen.getByTitle('Advance one hour')).toBeVisible()
    expect(screen.getByTitle('Advance to the plan stop condition')).toBeVisible()
    expect(screen.getByTitle('Verify the operation')).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: 'Close command panel' }))
    expect(screen.getByTitle('Advance one hour').closest('.command-sheet'))
      .toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByTitle('Advance one hour').closest('.command-sheet'))
      .toHaveAttribute('inert')
    const colonyClock = screen.getByRole('group', { name: 'Construction speed' })
    expect(colonyClock).toBeVisible()
    expect(within(colonyClock).getByRole('button', { name: 'Pause construction' }))
      .toHaveAttribute('aria-pressed', 'true')
  })

  it('inspects an empty lunar tile with user-facing coordinates', () => {
    const map = startOperations()
    const emptyTile = map.querySelector<HTMLElement>(
      '[data-map-cell][data-grid-x="0"][data-grid-y="0"]',
    )
    if (!emptyTile) throw new Error('Missing the first operational map tile.')

    fireEvent.click(emptyTile)

    const inspector = screen.getByRole('region', { name: 'Lunar regolith inspector' })
    expect(inspector).toHaveClass('selection-tile')
    expect(inspector).toHaveTextContent('Column 1 · Row 1')
    expect(inspector).toHaveTextContent('Lunar exterior')
    expect(inspector).toHaveTextContent('Nothing')
    expect(screen.queryByRole('dialog', { name: 'Choose an item' })).not.toBeInTheDocument()
  })

  it('selects a lone colonist directly and closes an open command drawer', () => {
    startOperations()
    fireEvent.click(screen.getByRole('button', { name: 'Crew' }))
    expect(screen.getByRole('region', { name: 'Colony crew' })).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: /^Select Jonah Reed,/i }))

    expect(screen.queryByRole('dialog', { name: 'Choose an item' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Colony crew' })).not.toBeInTheDocument()
    const inspector = screen.getByRole('region', { name: 'Jonah Reed inspector' })
    expect(inspector).toHaveClass('selection-crew')
    expect(inspector).toHaveTextContent('Flight Medic')
    expect(inspector).toHaveTextContent('Health')
    expect(inspector).toHaveTextContent('Fatigue')
  })

  it('opens a keyboard-friendly chooser for overlapping tile items', async () => {
    const map = startOperations()
    const stackedTile = map.querySelector<HTMLButtonElement>(
      '[data-map-cell][data-grid-x="4"][data-grid-y="8"]',
    )
    if (!stackedTile) throw new Error('Missing the Amina bunk tile.')

    fireEvent.click(stackedTile)

    const chooser = screen.getByRole('dialog', { name: 'Choose an item' })
    expect(chooser).toHaveTextContent('Tile 5, 9')
    expect(within(chooser).getByLabelText('2 overlapping items')).toHaveTextContent('2')
    expect(within(chooser).getByRole('button', { name: /Amina Okafor.*Colonist/i })).toBeVisible()
    expect(within(chooser).getByRole('button', { name: /Amina bunk.*Workstation/i })).toBeVisible()
    expect(within(chooser).getByRole('button', { name: /Pressurized floor/i })).toBeVisible()
    await waitFor(() => expect(document.activeElement).toBe(
      within(chooser).getByRole('button', { name: /Amina Okafor.*Colonist/i }),
    ))

    fireEvent.keyDown(chooser, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(
      within(chooser).getByRole('button', { name: /Amina bunk.*Workstation/i }),
    )
    fireEvent.click(document.activeElement as HTMLElement)

    expect(screen.queryByRole('dialog', { name: 'Choose an item' })).not.toBeInTheDocument()
    const inspector = screen.getByRole('region', { name: 'Amina bunk inspector' })
    expect(inspector).toHaveAttribute('data-inspected-kind', 'workstation')
    expect(inspector).toHaveTextContent('Footprint')
    expect(inspector).toHaveTextContent('1×2')
    await waitFor(() => expect(document.activeElement).toBe(stackedTile))

    fireEvent.click(stackedTile)
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Choose an item' }), { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Choose an item' })).not.toBeInTheDocument()
    expect(document.activeElement).toBe(stackedTile)
  })

  it('opens the chooser from a directly clicked colonist when its tile is stacked', () => {
    const map = startOperations()

    fireEvent.click(screen.getByRole('button', { name: /^Select Amina Okafor,/i }))

    const directChooser = screen.getByRole('dialog', { name: 'Choose an item' })
    const aminaChoice = within(directChooser).getByRole('button', {
      name: /Amina Okafor.*Colonist.*Targeted/i,
    })
    expect(aminaChoice).toHaveAttribute('data-pointer-hit', 'true')
    fireEvent.click(aminaChoice)
    expect(screen.getByRole('region', { name: 'Amina Okafor inspector' })).toBeVisible()

    const stackBadge = within(map).getByRole('button', {
      name: /Choose 2 overlapping items on column 5, row 9: Amina Okafor, Amina bunk/i,
    })
    expect(stackBadge.querySelector('.game-icon')).toBeInTheDocument()
    fireEvent.click(stackBadge)

    expect(screen.getByRole('dialog', { name: 'Choose an item' })).toBeVisible()
  })

  it('indexes every covered workstation cell and supports roving tile focus', () => {
    const map = startOperations()
    const workstationCell = map.querySelector<HTMLButtonElement>(
      '[data-map-cell][data-grid-x="10"][data-grid-y="4"]',
    )
    if (!workstationCell) throw new Error('Missing a covered life-support tile.')
    expect(workstationCell).toHaveAccessibleName(/Life support/i)

    fireEvent.click(workstationCell)
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Choose an item' })).getByRole(
      'button',
      { name: /Life support.*Workstation/i },
    ))
    const inspector = screen.getByRole('region', { name: 'Life support inspector' })
    expect(inspector).toHaveAttribute('data-inspected-kind', 'workstation')
    expect(inspector).toHaveTextContent('2×2')

    const firstCell = map.querySelector<HTMLButtonElement>(
      '[data-map-cell][data-grid-x="0"][data-grid-y="0"]',
    )!
    fireEvent.focus(firstCell)
    fireEvent.keyDown(firstCell, { key: 'ArrowRight' })
    expect(document.activeElement).toHaveAttribute('data-grid-x', '1')
    expect(document.activeElement).toHaveAttribute('data-grid-y', '0')
  })

  it('reports the breached laboratory room as vacuum instead of assuming every room is pressurized', () => {
    const map = startOperations()
    const laboratoryTile = map.querySelector<HTMLButtonElement>(
      '[data-map-cell][data-grid-x="12"][data-grid-y="5"]',
    )
    if (!laboratoryTile) throw new Error('Missing a laboratory room tile.')

    expect(laboratoryTile).toHaveAccessibleName(/Vacuum floor/i)
    fireEvent.click(laboratoryTile)

    const inspector = screen.getByRole('region', { name: 'Vacuum floor inspector' })
    expect(inspector).toHaveTextContent('Pressure')
    expect(inspector).toHaveTextContent('Vacuum')
    expect(inspector).toHaveTextContent('Unpressurized player-built room')
  })
})
