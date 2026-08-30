import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { paintBoundaryCell } from '../game/construction'
import { useColonyStore } from '../game/store'
import { SettlementBuilder } from './SettlementBuilder'

const openBlueprintInspector = () => {
  const state = useColonyStore.getState()
  expect(state.queueConstruction(
    paintBoundaryCell(state.settlement.layout, { x: 12, y: 9 }, 'wall'),
  ).ok).toBe(true)
  render(<SettlementBuilder />)
  fireEvent.click(screen.getByRole('button', { name: /Open construction queue/i }))
  fireEvent.click(within(screen.getByRole('dialog', { name: 'Construction queue' }))
    .getByRole('button', { name: /Wall, paused/i }))
  return screen.getByRole('region', { name: 'Wall blueprint inspector' })
}

beforeEach(() => {
  localStorage.clear()
  useColonyStore.getState().resetColony()
  useColonyStore.getState().setConstructionSpeed(0)
})

afterEach(cleanup)

describe('SettlementBuilder exact builder assignment', () => {
  it('assigns from the icon-led roster and links blueprint and pawn inspectors', async () => {
    const inspector = openBlueprintInspector()
    expect(inspector).toHaveTextContent('Automatic · waiting for builder')
    const trigger = within(inspector).getByRole('button', { name: 'Assign builder for Wall blueprint' })

    fireEvent.click(trigger)
    const picker = screen.getByRole('dialog', { name: 'Choose a builder' })
    const automatic = within(picker).getByRole('radio', { name: /Automatic assignment/i })
    expect(automatic).toHaveAttribute('aria-checked', 'true')
    await waitFor(() => expect(automatic).toHaveFocus())

    const amina = within(picker).getByRole('radio', { name: /Amina Okafor, Available/i })
    expect(amina).toHaveAttribute('aria-disabled', 'false')
    expect(amina).toHaveTextContent(/Engineering 5 · Fatigue 24% · \d+ steps/)
    fireEvent.click(amina)

    expect(screen.queryByRole('dialog', { name: 'Choose a builder' })).not.toBeInTheDocument()
    const order = useColonyStore.getState().settlement.constructionOrders[0]
    expect(order).toMatchObject({
      forcedCrewId: 'crew-amina-okafor',
      assignedCrewId: 'crew-amina-okafor',
    })
    const assignedInspector = screen.getByRole('region', { name: 'Wall blueprint inspector' })
    expect(assignedInspector).toHaveTextContent('Amina Okafor')
    expect(assignedInspector).toHaveTextContent('Assigned manually · active')

    fireEvent.click(within(assignedInspector).getByRole('button', { name: 'Inspect Amina Okafor' }))
    const pawnInspector = screen.getByRole('region', { name: 'Amina Okafor inspector' })
    expect(pawnInspector).toHaveTextContent('Manual · Wall blueprint')
    fireEvent.click(within(pawnInspector).getByRole('button', {
      name: 'Jump to Wall blueprint',
    }))
    expect(screen.getByRole('region', { name: 'Wall blueprint inspector' })).toBeVisible()
  })

  it('keeps unavailable rows focusable with a reason and restores the builder trigger', async () => {
    const initial = useColonyStore.getState()
    useColonyStore.setState({
      crew: initial.crew.map((member) => member.id === 'crew-amina-okafor'
        ? { ...member, status: 'resting' as const }
        : member),
    })
    const inspector = openBlueprintInspector()
    const trigger = within(inspector).getByRole('button', { name: 'Assign builder for Wall blueprint' })
    fireEvent.click(trigger)

    const picker = screen.getByRole('dialog', { name: 'Choose a builder' })
    const automatic = within(picker).getByRole('radio', { name: /Automatic assignment/i })
    const amina = within(picker).getByRole('radio', { name: /Amina Okafor, Unavailable. Resting/i })
    expect(amina).toHaveAttribute('aria-disabled', 'true')
    fireEvent.keyDown(automatic, { key: 'ArrowDown' })
    expect(amina).toHaveFocus()
    fireEvent.click(amina)
    expect(picker).toBeVisible()

    fireEvent.keyDown(amina, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Choose a builder' })).not.toBeInTheDocument()
    await waitFor(() => expect(trigger).toHaveFocus())
  })
})
