import { describe, expect, it } from 'vitest'
import { createInitialState } from './seed'
import { advanceSimulation, assignColonists, createOrder, deriveAlerts } from './simulation'

describe('Emberdeep simulation', () => {
  it('starts with enough state to reward structured inspection', () => {
    const state = createInitialState()
    expect(state.colonists).toHaveLength(20)
    expect(state.workOrders).toHaveLength(4)
    expect(state.alerts.some((alert) => alert.severity === 'critical')).toBe(true)
  })

  it('rejects assignments that would send an injured colonist to work', () => {
    const state = createInitialState()
    const injured = state.colonists.find((colonist) => colonist.status === 'injured')!
    const [nextState, result] = assignColonists(state, [
      { colonistId: injured.id, workOrderId: 'order-001' },
    ])

    expect(result.assigned).toHaveLength(0)
    expect(result.errors[0]).toContain('injured')
    expect(nextState.workOrders[0].workers).not.toContain(injured.id)
  })

  it('turns skilled, bounded assignments into visible colony progress', () => {
    const state = createInitialState()
    const growers = [...state.colonists]
      .filter((colonist) => colonist.status !== 'injured')
      .sort((a, b) => b.skills.farming - a.skills.farming)
      .slice(0, 2)
    const [assignedState] = assignColonists(
      state,
      growers.map((colonist) => ({ colonistId: colonist.id, workOrderId: 'order-001' })),
    )
    const advancedState = advanceSimulation(assignedState, 8)

    expect(advancedState.workOrders[0].status).toBe('complete')
    expect(advancedState.resources.food).toBeGreaterThan(state.resources.food)
    expect(advancedState.events[0].message).toContain('Completed')
  })

  it('ignores store action functions when cloning UI-backed state', () => {
    const stateWithAction = Object.assign(createInitialState(), { resetColony: () => undefined })
    expect(() => advanceSimulation(stateWithAction, 1)).not.toThrow()
  })

  it('creates typed work that the agent can assign later', () => {
    const state = createInitialState()
    const [nextState, orderId] = createOrder(state, { type: 'mine_ore', priority: 4 })
    const order = nextState.workOrders.find((candidate) => candidate.id === orderId)

    expect(order).toMatchObject({ requiredSkill: 'mining', priority: 4, status: 'queued' })
  })

  it('derives current risks rather than relying on stale alert text', () => {
    const state = createInitialState()
    state.resources.food = 0
    const alerts = deriveAlerts(state)
    expect(alerts.find((alert) => alert.id === 'alert-food')?.severity).toBe('critical')
  })
})
