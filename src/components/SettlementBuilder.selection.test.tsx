import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { paintBoundaryCell, type GridPoint } from '../game/construction'
import { useColonyStore } from '../game/store'
import { SettlementBuilder } from './SettlementBuilder'

const mapCell = ({ x, y }: GridPoint) => screen.getByRole('group', {
  name: /freeform construction grid/i,
}).querySelector<HTMLElement>(
  `[data-construction-cell][data-grid-x="${x}"][data-grid-y="${y}"]`,
)!

const inspectCell = (point: GridPoint) => {
  const cell = mapCell(point)
  fireEvent.pointerDown(cell, {
    button: 0,
    clientX: 120,
    clientY: 140,
    pointerId: 81,
    pointerType: 'mouse',
  })
  fireEvent.pointerUp(cell, {
    button: 0,
    clientX: 120,
    clientY: 140,
    pointerId: 81,
    pointerType: 'mouse',
  })
}

beforeEach(() => {
  localStorage.clear()
  useColonyStore.getState().resetColony()
})

afterEach(cleanup)

describe('SettlementBuilder inspection selection', () => {
  it('keeps a colonist selected as assignment changes move them between tiles', async () => {
    const view = render(<SettlementBuilder />)
    fireEvent.click(screen.getByRole('button', { name: 'Pause construction' }))

    const mateo = view.container.querySelector<HTMLElement>(
      '[data-crew-id="crew-mateo-alvarez"]',
    )!
    const idleCell = {
      x: Number(mateo.dataset.gridX),
      y: Number(mateo.dataset.gridY),
    }
    inspectCell(idleCell)
    expect(screen.getByRole('region', { name: 'Mateo Alvarez inspector' })).toBeVisible()

    const target = { x: 9, y: 6 }
    act(() => {
      const state = useColonyStore.getState()
      const result = paintBoundaryCell(state.settlement.layout, target, 'wall')
      expect(state.queueConstruction(result).ok).toBe(true)
      useColonyStore.getState().advanceConstruction(0.1)
    })

    await waitFor(() => {
      expect(screen.getByRole('region', { name: 'Mateo Alvarez inspector' })).toBeVisible()
      expect(view.container.querySelector('.construction-selection-cell')).toHaveAttribute(
        'data-grid-x',
        String(target.x),
      )
      expect(view.container.querySelector('.construction-selection-cell')).toHaveAttribute(
        'data-grid-y',
        String(target.y),
      )
    })

    act(() => {
      for (let tick = 0; tick < 20; tick += 1) {
        useColonyStore.getState().advanceConstruction(1)
      }
    })

    await waitFor(() => {
      const movedMateo = view.container.querySelector<HTMLElement>(
        '[data-crew-id="crew-mateo-alvarez"]',
      )!
      const selectedCell = view.container.querySelector('.construction-selection-cell')
      expect(screen.getByRole('region', { name: 'Mateo Alvarez inspector' })).toBeVisible()
      expect(selectedCell).toHaveAttribute('data-grid-x', movedMateo.dataset.gridX)
      expect(selectedCell).toHaveAttribute('data-grid-y', movedMateo.dataset.gridY)
    })
  })

  it('returns focus to the construction map when B externally dismisses the tile picker', async () => {
    render(<SettlementBuilder />)
    fireEvent.click(screen.getByRole('button', { name: 'Pause construction' }))
    const target = { x: 9, y: 6 }

    act(() => {
      const state = useColonyStore.getState()
      const result = paintBoundaryCell(state.settlement.layout, target, 'wall')
      expect(state.queueConstruction(result).ok).toBe(true)
      useColonyStore.getState().advanceConstruction(0.1)
    })
    inspectCell(target)

    const picker = screen.getByRole('dialog', { name: 'Choose an item' })
    await waitFor(() => expect(picker).toContainElement(document.activeElement as HTMLElement))
    fireEvent.keyDown(window, { key: 'b' })

    expect(screen.queryByRole('dialog', { name: 'Choose an item' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Build menu' })).toHaveAttribute('aria-pressed', 'true')
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('group', {
      name: /freeform construction grid/i,
    })))
  })
})
