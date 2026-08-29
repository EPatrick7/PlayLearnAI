import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
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

const renderFreshApp = () => render(<App />)

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
  expect(tool).toHaveAttribute('aria-pressed', 'true')
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

    const bunks = layout.workstations.filter((workstation) => workstation.type === 'bed')
    expect(bunks).toHaveLength(2)
    expect(new Set(bunks.map((bunk) => bunk.id)).size).toBe(2)
    const firstBunkCells = new Set(getWorkstationCells(bunks[0]).map(({ x, y }) => `${x}:${y}`))
    expect(getWorkstationCells(bunks[1]).some(({ x, y }) => firstBunkCells.has(`${x}:${y}`))).toBe(false)
    expect(screen.getByRole('img', { name: 'Amina bunk, 1 by 2 tiles' })).toBeVisible()
    expect(screen.getByRole('img', { name: 'Mateo bunk, 1 by 2 tiles' })).toBeVisible()

    expect(map.querySelector('[data-build-site-id]')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^(Place|Preview)\b/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/build socket|blueprint/i)).not.toBeInTheDocument()
  })

  it('opens Build → Structure and commits a five-cell wall drag as one revision', () => {
    renderFreshApp()
    const revision = useColonyStore.getState().worldRevision

    selectTool('Structure', /^Wall/i)
    dragConstructionTool({ x: 9, y: 6 }, { x: 13, y: 6 })

    const state = useColonyStore.getState()
    const painted = state.settlement.layout.boundaries.filter(
      (cell) => cell.y === 6 && cell.x >= 9 && cell.x <= 13,
    )
    expect(painted).toEqual([
      { x: 9, y: 6, kind: 'wall' },
      { x: 10, y: 6, kind: 'wall' },
      { x: 11, y: 6, kind: 'wall' },
      { x: 12, y: 6, kind: 'wall' },
      { x: 13, y: 6, kind: 'wall' },
    ])
    expect(state.worldRevision).toBe(revision + 1)

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

    expect(useColonyStore.getState().settlement.layout.boundaries).toEqual(
      expect.arrayContaining([
        { x: 9, y: 9, kind: 'wall' },
        { x: 10, y: 9, kind: 'wall' },
      ]),
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
    )).toEqual({ x: 4, y: 7, kind: 'door' })
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
    const rotate = screen.getByRole('button', { name: /^Rotate 0°$/i })
    fireEvent.click(rotate)
    expect(screen.getByRole('button', { name: /^Rotate 90°$/i })).toBeVisible()

    clickConstructionCell({ x: 10, y: 3 })

    const state = useColonyStore.getState()
    expect(state.worldRevision).toBe(revision + 1)
    expect(state.settlement.layout.workstations).toContainEqual(expect.objectContaining({
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

  it('deconstructs a whole workstation from a covered cell and Undo restores it', () => {
    seedSecondRoom()
    renderFreshApp()

    selectTool('Production', /^Life support/i)
    clickConstructionCell({ x: 10, y: 3 })
    expect(screen.getByRole('img', { name: 'Life support, 2 by 2 tiles' })).toBeVisible()

    selectTool('Orders', /^Deconstruct/i)
    clickConstructionCell({ x: 11, y: 4 }, 2)

    expect(useColonyStore.getState().settlement.layout.workstations).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'life-support' })]),
    )
    expect(screen.queryByRole('img', { name: 'Life support, 2 by 2 tiles' })).not.toBeInTheDocument()

    const undo = screen.getByRole('button', { name: /^Undo/i })
    expect(undo).toBeEnabled()
    fireEvent.click(undo)

    expect(useColonyStore.getState().settlement.layout.workstations).toEqual(
      expect.arrayContaining([expect.objectContaining({
        id: 'life-support-1',
        origin: { x: 10, y: 3 },
      })]),
    )
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

    fireEvent.click(screen.getByRole('button', { name: 'Begin first shift' }))

    const operations = useColonyStore.getState()
    expect(operations.settlement.phase).toBe('operations')
    expect(screen.queryByRole('group', { name: /freeform construction grid/i })).not.toBeInTheDocument()
    expect(screen.getByRole('main')).toHaveClass('world-stage')
    const operationsMap = screen.getByRole('group', { name: /2 player-built rooms/i })
    expect(operationsMap).toHaveAttribute('data-custom-layout', 'true')
    expect(operationsMap.querySelectorAll('[data-freeform-boundary]')).toHaveLength(
      layout.boundaries.length,
    )
    expect(operationsMap.querySelector('[data-freeform-workstation="life-support"]')).toBeVisible()
    const operationalTokens = operationsMap.querySelectorAll<HTMLElement>(
      '.crew-marker, .equipment-marker, .work-hotspot',
    )
    const operationalTokenCells = new Set(
      [...operationalTokens].map((token) => `${token.style.gridColumn}|${token.style.gridRow}`),
    )
    expect(operationalTokenCells.size).toBe(operationalTokens.length)
    const moduleTargets = operationsMap.querySelectorAll<HTMLElement>('.module-select-target')
    const moduleTargetAreas = new Set(
      [...moduleTargets].map((target) => `${target.style.gridColumn}|${target.style.gridRow}`),
    )
    expect(moduleTargetAreas.size).toBe(moduleTargets.length)
    const highestModuleTargetLayer = Math.max(
      ...[...moduleTargets].map((target) => Number(target.style.zIndex)),
    )
    expect([...operationalTokens].every(
      (token) => Number(token.style.zIndex) > highestModuleTargetLayer,
    )).toBe(true)
    const lifeSupportTarget = within(operationsMap).getByRole('button', { name: /Inspect Life Support/i })
    const laboratoryTarget = within(operationsMap).getByRole('button', { name: /Inspect Kepler Laboratory/i })
    expect(Number(lifeSupportTarget.style.zIndex)).toBeGreaterThan(
      Number(laboratoryTarget.style.zIndex),
    )
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
  })
})
