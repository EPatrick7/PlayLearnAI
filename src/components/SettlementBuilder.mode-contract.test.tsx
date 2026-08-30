import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GridPoint } from '../game/construction'
import { useColonyStore } from '../game/store'
import { SettlementBuilder } from './SettlementBuilder'

const constructionMap = () => screen.getByRole('group', {
  name: /freeform construction grid/i,
})

const inspectCell = ({ x, y }: GridPoint, pointerId = 81) => {
  const cell = constructionMap().querySelector<HTMLElement>(
    `[data-construction-cell][data-grid-x="${x}"][data-grid-y="${y}"]`,
  )
  if (!cell) throw new Error(`Missing construction cell ${x}:${y}.`)
  fireEvent.pointerDown(cell, {
    button: 0,
    buttons: 1,
    clientX: 120,
    clientY: 140,
    pointerId,
    pointerType: 'mouse',
  })
  fireEvent.pointerUp(cell, {
    button: 0,
    buttons: 0,
    clientX: 120,
    clientY: 140,
    pointerId,
    pointerType: 'mouse',
  })
}

const openBuild = () => {
  const trigger = screen.getByRole('button', { name: 'Build menu' })
  if (trigger.getAttribute('aria-pressed') !== 'true') fireEvent.click(trigger)
  return trigger
}

const chooseWall = () => {
  openBuild()
  fireEvent.click(screen.getByRole('button', { name: /^Wall: Drag a 1-tile line/i }))
}

beforeEach(() => {
  localStorage.clear()
  useColonyStore.getState().resetColony()
  useColonyStore.setState((state) => ({
    settlement: { ...state.settlement, phase: 'operations' },
  }))
})

afterEach(cleanup)

describe('SettlementBuilder Select and Build contract', () => {
  it('uses Select help and collapses every chosen tool into the compact blueprint bar', () => {
    const view = render(<SettlementBuilder />)

    expect(screen.getByRole('region', { name: 'Construction status' }))
      .toHaveTextContent('Colonists haul and build every placed blueprint.')
    expect(view.container.querySelector('.select-mode-summary'))
      .toHaveTextContent('SelectClick/tap inspect · drag map')

    openBuild()
    const wall = screen.getByRole('button', { name: /^Wall: Drag a 1-tile line/i })
    expect(wall).not.toHaveTextContent('Drag a 1-tile line')
    expect(wall).toHaveTextContent('Wall')
    expect(wall).toHaveTextContent('1 / tile')

    fireEvent.click(wall)

    expect(screen.queryByRole('region', { name: 'Structure build tools' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Build menu' })).toHaveAttribute('aria-pressed', 'false')
    expect(view.container.querySelector('.active-tool-summary'))
      .toHaveTextContent('WallBLUEPRINT · Drag a tile line')
    expect(constructionMap()).toHaveClass('tool-active')

    openBuild()
    const selectedWall = screen.getByRole('button', { name: /^Wall: Drag a 1-tile line/i })
    expect(selectedWall).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(selectedWall)

    expect(screen.queryByRole('region', { name: 'Structure build tools' })).not.toBeInTheDocument()
    expect(constructionMap()).toHaveClass('tool-active')
    expect(constructionMap()).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Return to Select mode from Wall' })).toBeVisible()
  })

  it('keeps the active designator while B toggles the drawer and categories are browsed', () => {
    const view = render(<SettlementBuilder />)
    chooseWall()

    fireEvent.keyDown(window, { key: 'b' })
    expect(screen.getByRole('button', { name: 'Build menu' })).toHaveAttribute('aria-pressed', 'true')
    expect(constructionMap()).toHaveClass('tool-active')

    fireEvent.click(screen.getByRole('button', { name: 'Furniture' }))
    expect(screen.getByRole('region', { name: 'Furniture build tools' })).toBeVisible()
    expect(constructionMap()).toHaveClass('tool-active')
    expect(screen.getByRole('group', { name: 'Wall blueprint active' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Return to Select mode from Wall' })).toBeVisible()
    expect(view.container.querySelector('.construction-toast'))
      .toHaveTextContent('Furniture tools open. Wall blueprint remains active.')

    fireEvent.keyDown(window, { key: 'b' })
    expect(screen.queryByRole('region', { name: 'Furniture build tools' })).not.toBeInTheDocument()
    expect(view.container.querySelector('.active-tool-summary')).toHaveTextContent('Wall')

    openBuild()
    fireEvent.click(screen.getByRole('button', { name: /^Bunk bed:/i }))
    expect(screen.queryByRole('region', { name: 'Furniture build tools' })).not.toBeInTheDocument()
    expect(view.container.querySelector('.active-tool-summary')).toHaveTextContent('Bunk bed')
    expect(screen.getByRole('button', { name: 'Return to Select mode from Bunk bed' })).toBeVisible()
  })

  it('applies Escape to overlays, designator, drawer, inspector, then exit', () => {
    const state = useColonyStore.getState()
    const stockpile = state.settlement.constructionStockpile
    useColonyStore.setState({
      settlement: {
        ...state.settlement,
        constructionCrew: state.settlement.constructionCrew.map((position, index) => (
          index === 0 ? { ...position, cell: { ...stockpile } } : position
        )),
      },
    })
    const onExit = vi.fn()
    render(<SettlementBuilder onExit={onExit} />)

    inspectCell(stockpile)
    expect(screen.getByRole('dialog', { name: 'Choose an item' })).toBeVisible()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Choose an item' })).not.toBeInTheDocument()
    expect(onExit).not.toHaveBeenCalled()

    chooseWall()
    fireEvent.keyDown(window, { key: 'b' })
    expect(screen.getByRole('region', { name: 'Structure build tools' })).toBeVisible()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(constructionMap()).toHaveClass('select-active')
    expect(screen.getByRole('region', { name: 'Structure build tools' })).toBeVisible()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('region', { name: 'Structure build tools' })).not.toBeInTheDocument()

    inspectCell({ x: 0, y: 0 }, 82)
    expect(screen.getByRole('region', { name: 'Lunar regolith inspector' })).toBeVisible()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('region', { name: 'Lunar regolith inspector' })).not.toBeInTheDocument()
    expect(onExit).not.toHaveBeenCalled()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onExit).toHaveBeenCalledOnce()
  })

  it('keeps tool detail available to assistive tech without rendering it as card copy', () => {
    render(<SettlementBuilder />)
    openBuild()

    const tools = screen.getByRole('region', { name: 'Structure build tools' })
    const wall = within(tools).getByRole('button', { name: /^Wall: Drag a 1-tile line/i })
    expect(wall).toHaveAccessibleName(/Drag a 1-tile line.*1 construction material/i)
    expect(wall.querySelector('small')).not.toBeInTheDocument()
  })

  it('returns focus to the map when placement begins after browsing the drawer', () => {
    render(<SettlementBuilder />)
    chooseWall()
    const build = screen.getByRole('button', { name: 'Build menu' })
    fireEvent.click(build)
    build.focus()
    fireEvent.click(build)
    expect(build).toHaveFocus()

    const map = constructionMap()
    const cell = map.querySelector<HTMLElement>(
      '[data-construction-cell][data-grid-x="10"][data-grid-y="6"]',
    )!
    fireEvent.pointerDown(cell, {
      button: 0,
      buttons: 1,
      clientX: 360,
      clientY: 260,
      pointerId: 91,
      pointerType: 'mouse',
    })

    expect(map).toHaveFocus()
    fireEvent.keyDown(map, { key: 'Escape' })
    expect(screen.getByRole('button', { name: 'Return to Select mode from Wall' })).toBeVisible()
    fireEvent.pointerUp(cell, {
      button: 0,
      buttons: 0,
      clientX: 360,
      clientY: 260,
      pointerId: 91,
      pointerType: 'mouse',
    })
    expect(useColonyStore.getState().settlement.constructionOrders).toHaveLength(0)
  })
})
