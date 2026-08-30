import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { paintBoundaryCell, paintBoundaryLine } from '../game/construction'
import { projectConstructionOrders } from '../game/constructionJobs'
import { useColonyStore } from '../game/store'
import { SettlementBuilder } from './SettlementBuilder'

const queueWallLine = () => {
  const state = useColonyStore.getState()
  const result = paintBoundaryLine(state.settlement.layout, { x: 11, y: 4 }, { x: 13, y: 4 }, 'wall')
  expect(state.queueConstruction(result).ok).toBe(true)
}

const queueWall = (x: number, y: number) => {
  const state = useColonyStore.getState()
  const projected = projectConstructionOrders(
    state.settlement.layout,
    state.settlement.constructionOrders,
  )
  const result = paintBoundaryCell(projected.layout, { x, y }, 'wall')
  expect(state.queueConstruction(result).ok).toBe(true)
}

beforeEach(() => {
  localStorage.clear()
  useColonyStore.getState().resetColony()
  useColonyStore.getState().setConstructionSpeed(0)
})

afterEach(cleanup)

describe('SettlementBuilder construction queue', () => {
  it('offers a one-click Select mode escape from an active designator', () => {
    const view = render(<SettlementBuilder />)

    fireEvent.click(screen.getByRole('button', { name: 'Build menu' }))
    fireEvent.click(screen.getByRole('button', { name: /Wall: Drag a 1-tile line/i }))

    expect(view.container.querySelector('.construction-map')).toHaveClass('tool-active')
    const selectMode = screen.getByRole('button', { name: 'Return to Select mode from Wall' })
    expect(selectMode).toBeVisible()

    fireEvent.click(selectMode)

    expect(view.container.querySelector('.construction-map')).toHaveClass('pan-active')
    expect(screen.queryByRole('button', { name: 'Return to Select mode from Wall' }))
      .not.toBeInTheDocument()
    expect(view.container.querySelector('.construction-toast'))
      .toHaveTextContent('Select mode. Wall designator stopped.')
  })

  it('groups a dragged placement and jumps directly to its next blueprint inspector', async () => {
    queueWallLine()
    const view = render(<SettlementBuilder />)

    fireEvent.click(screen.getByRole('button', { name: 'Build menu' }))
    fireEvent.click(screen.getByRole('button', { name: /Wall: Drag a 1-tile line/i }))
    expect(view.container.querySelector('.construction-map')).toHaveClass('tool-active')

    const trigger = screen.getByRole('button', {
      name: /Open construction queue, 1 placement, 3 jobs/i,
    })
    expect(trigger.querySelector('.construction-queue-label-compact'))
      .toHaveTextContent('Queue · 3 jobs')
    fireEvent.click(trigger)

    const queue = screen.getByRole('dialog', { name: 'Construction queue' })
    expect(within(queue).getByRole('button', { name: /Wall ×3, paused/i })).toHaveFocus()
    expect(within(queue).getByText('0/3 complete')).toBeVisible()
    expect(view.container.querySelector('.construction-map-scroll')).toHaveAttribute('inert')
    expect(view.container.querySelector('.construction-controls')).toHaveAttribute('inert')
    expect(view.container.querySelector('.construction-map')).not.toHaveClass('tool-active')

    fireEvent.click(view.container.querySelector('.construction-queue-backdrop')!)
    expect(screen.queryByRole('dialog', { name: 'Construction queue' })).not.toBeInTheDocument()
    expect(view.container.querySelector('.construction-map')).toHaveClass('tool-active')

    fireEvent.click(trigger)
    const reopenedQueue = screen.getByRole('dialog', { name: 'Construction queue' })
    const placement = within(reopenedQueue).getByRole('button', { name: /Wall ×3, paused/i })
    expect(placement).toHaveFocus()

    fireEvent.click(placement)

    expect(screen.queryByRole('dialog', { name: 'Construction queue' })).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Choose an item' })).not.toBeInTheDocument()
    const inspector = screen.getByRole('region', { name: 'Wall blueprint inspector' })
    expect(inspector).toBeVisible()
    expect(inspector).toHaveTextContent('Blueprint priority')
    expect(inspector.querySelector('.construction-priority-label-compact'))
      .toHaveTextContent('Priority')
    expect(within(inspector).getByRole('button', { name: 'Cancel blueprint' })).toBeVisible()
    expect(inspector).not.toHaveTextContent('Placement priority')
    expect(view.container.querySelector('.construction-map')).not.toHaveClass('tool-active')
    expect(view.container.querySelector('.construction-selection-cell')).toHaveAttribute('data-grid-x', '11')
    expect(view.container.querySelector('.construction-selection-cell')).toHaveAttribute('data-grid-y', '4')
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('group', {
      name: /freeform construction grid/i,
    })))
  })

  it('supports roving arrow keys and restores the status trigger on Escape', async () => {
    queueWall(10, 3)
    queueWall(14, 6)
    render(<SettlementBuilder />)

    const trigger = screen.getByRole('button', {
      name: /Open construction queue, 2 placements, 2 jobs/i,
    })
    fireEvent.click(trigger)
    const queue = screen.getByRole('dialog', { name: 'Construction queue' })
    const placements = within(queue).getAllByRole('button', { name: /Wall, paused/i })
    expect(placements[0]).toHaveFocus()

    fireEvent.keyDown(placements[0], { key: 'ArrowDown' })
    expect(placements[1]).toHaveFocus()
    fireEvent.keyDown(placements[1], { key: 'Home' })
    expect(placements[0]).toHaveFocus()
    fireEvent.keyDown(placements[0], { key: 'End' })
    expect(placements[1]).toHaveFocus()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Construction queue' })).not.toBeInTheDocument()
    await waitFor(() => expect(trigger).toHaveFocus())

    fireEvent.click(trigger)
    fireEvent.keyDown(window, { key: 'b' })
    expect(screen.queryByRole('dialog', { name: 'Construction queue' })).not.toBeInTheDocument()
    const buildMenu = screen.getByRole('button', { name: 'Build menu' })
    expect(buildMenu).toHaveAttribute('aria-pressed', 'true')
    await waitFor(() => expect(buildMenu).toHaveFocus())
  })
})
