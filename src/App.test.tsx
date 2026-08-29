import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import App from './App'
import { useColonyStore } from './game/store'

const renderFreshApp = () => render(<App />)

const stageRecommendedResponse = () => {
  fireEvent.click(screen.getByRole('button', { name: /stage a response/i }))
  return screen.getByRole('region', { name: 'plan command panel' })
}

beforeEach(() => {
  localStorage.clear()
  useColonyStore.getState().resetColony()
})

afterEach(() => {
  cleanup()
})

describe('Moonbase game UI', () => {
  it('loads map-first with interactive crew and dock controls while the command sheet stays hidden', () => {
    renderFreshApp()

    const map = screen.getByRole('group', {
      name: /top-down interactive map of shackleton base/i,
    })
    const laboratory = within(map).getByRole('button', {
      name: /inspect kepler laboratory.*hull breach open/i,
    })
    const mateo = within(map).getByRole('button', {
      name: /select mateo alvarez, structural engineer/i,
    })

    expect(map).toBeVisible()
    expect(laboratory).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(mateo)
    expect(mateo).toHaveAttribute('aria-pressed', 'true')

    const crewStrip = screen.getByRole('region', { name: 'Colony crew' })
    expect(within(crewStrip).getAllByRole('button')).toHaveLength(6)

    const dock = screen.getByRole('navigation', { name: 'Colony commands' })
    const dockButtons = within(dock).getAllByRole('button')
    expect(dockButtons).toHaveLength(5)
    for (const command of ['Work', 'Crew', 'Gear', 'Plan']) {
      expect(within(dock).getByRole('button', { name: command })).toBeEnabled()
    }
    expect(within(dock).getByRole('button', { name: /^Log/ })).toBeEnabled()
    expect(dockButtons.every((button) => button.getAttribute('aria-expanded') === 'false')).toBe(true)

    expect(screen.queryByRole('region', { name: /command panel/i })).not.toBeInTheDocument()
    expect(document.querySelector('[aria-label="work command panel"]')).toHaveAttribute(
      'aria-hidden',
      'true',
    )

    fireEvent.click(within(dock).getByRole('button', { name: 'Crew' }))
    expect(screen.getByRole('region', { name: 'crew command panel' })).toBeVisible()
    expect(within(dock).getByRole('button', { name: 'Crew' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
  })

  it('stages the nine-action recommended response as a valid, committable plan', () => {
    renderFreshApp()

    const planPanel = stageRecommendedResponse()
    const commit = within(planPanel).getByRole('button', { name: /commit plan/i })

    expect(within(planPanel).getByText('9 total')).toBeVisible()
    expect(
      within(planPanel).getAllByRole('button', { name: 'Remove staged action' }),
    ).toHaveLength(9)
    expect(within(planPanel).getByText('Ready to commit')).toBeVisible()
    expect(commit).toBeEnabled()

    const state = useColonyStore.getState()
    expect(state.operationsPlan.actions).toHaveLength(9)
    expect(state.validatePlan().valid).toBe(true)
  })

  it('enables execution only after commit and keeps the run inside its declared bound', () => {
    renderFreshApp()

    const advanceOneHour = screen.getByRole('button', { name: '+1h' })
    const advanceToStop = screen.getByRole('button', { name: 'To stop' })
    expect(advanceOneHour).toBeDisabled()
    expect(advanceToStop).toBeDisabled()

    const planPanel = stageRecommendedResponse()
    fireEvent.click(within(planPanel).getByRole('button', { name: /commit plan/i }))

    expect(screen.getByText('Plan live')).toBeVisible()
    expect(advanceOneHour).toBeEnabled()
    expect(advanceToStop).toBeEnabled()
    expect(useColonyStore.getState().operationsPlan).toMatchObject({
      status: 'committed',
      horizonHours: 12,
      stopCondition: { kind: 'objective_complete' },
    })

    fireEvent.click(advanceToStop)

    const finished = useColonyStore.getState()
    expect(finished.lastAdvance).toMatchObject({
      boundedHours: 12,
      advancedHours: 10,
      stopReason: 'objective_complete',
    })
    expect(finished.elapsedHours).toBeLessThanOrEqual(finished.operationsPlan.horizonHours)
    expect(finished.scenarioStatus).toBe('objective_complete')
    expect(screen.getByText('Objective secured')).toBeVisible()
    expect(advanceToStop).toBeDisabled()
  })
})
