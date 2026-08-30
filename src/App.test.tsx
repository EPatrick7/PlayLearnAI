import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
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
    for (let tick = 0; tick < 60; tick += 1) {
      if (!useColonyStore.getState().settlement.constructionOrders.some(
        (order) => order.status !== 'complete',
      )) break
      useColonyStore.getState().advanceConstruction(1)
    }
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

const dragConstructionTool = (start: GridPoint, end: GridPoint, pointerId = 1) => {
  fireEvent.pointerDown(constructionCell(start), {
    button: 0,
    buttons: 1,
    pointerId,
    pointerType: 'mouse',
  })
  fireEvent.pointerMove(constructionCell(end), {
    button: 0,
    buttons: 1,
    pointerId,
    pointerType: 'mouse',
  })
  fireEvent.pointerUp(constructionCell(end), {
    button: 0,
    buttons: 0,
    pointerId,
    pointerType: 'mouse',
  })
}

const clickConstructionCell = (point: GridPoint, pointerId = 1) =>
  dragConstructionTool(point, point, pointerId)

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
  expect(screen.getByRole('region', { name: new RegExp(`^${category} build tools$`, 'i') })).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Build menu' }))
  expect(constructionMap()).toHaveClass('tool-active')
  expect(screen.queryByRole('region', { name: new RegExp(`^${category} build tools$`, 'i') })).not.toBeInTheDocument()
}

const layoutFrom = (result: ConstructionResult) => {
  if (!result.ok) throw new Error(`${result.code}: ${result.error}`)
  return result.layout
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
  state.setConstructionLayout(layout)
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
  useColonyStore.getState().setConstructionLayout(layout)
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
  })

  it('announces keyboard cursor position and commits a keyboard wall draft', () => {
    renderFreshApp()
    selectTool('Structure', /^Wall/i)

    const map = constructionMap()
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent(/column 9, row 10.*open lunar ground.*valid wall.*1 tile/i)

    fireEvent.keyDown(map, { key: 'ArrowRight' })
    expect(status).toHaveTextContent(/column 10, row 10/i)
    fireEvent.keyDown(map, { key: ' ' })
    fireEvent.keyDown(map, { key: 'ArrowRight' })
    expect(status).toHaveTextContent(/column 11, row 10.*valid wall.*2 tiles/i)
    fireEvent.keyDown(map, { key: ' ' })

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
    fireEvent.keyDown(map, { key: ' ' })

    selectTool('Orders', /^Deconstruct/i)
    fireEvent.keyDown(map, { key: 'ArrowLeft' })
    fireEvent.keyDown(map, { key: ' ' })

    expect(useColonyStore.getState().settlement.layout.boundaries).toContainEqual(
      { x: 7, y: 9, kind: 'door' },
    )

    fireEvent.keyDown(map, { key: ' ' })
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
    fireEvent.keyDown(map, { key: ' ' })

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
    const scrollContainer = map.parentElement!
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
    expect(screen.getByRole('img', { name: /Door blueprint, hauling/i })).toBeVisible()
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
    const blueprint = screen.getByRole('img', { name: /Life support blueprint, hauling/i })
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
    expect(screen.getByRole('img', { name: /Deconstruct Life support blueprint, building/i })).toBeVisible()

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
    useColonyStore.getState().setConstructionLayout(layout)
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
    expect(chooser).toHaveTextContent('Tile 05 · 09')
    expect(chooser).toHaveTextContent('2 things here')
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

  it('inspects a clicked colonist directly while the tile stack badge opens the chooser', () => {
    const map = startOperations()

    fireEvent.click(screen.getByRole('button', { name: /^Select Amina Okafor,/i }))

    expect(screen.queryByRole('dialog', { name: 'Choose an item' })).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Amina Okafor inspector' })).toBeVisible()

    fireEvent.click(within(map).getByRole('button', {
      name: /Choose 2 overlapping items on column 5, row 9: Amina Okafor, Amina bunk/i,
    }))

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
