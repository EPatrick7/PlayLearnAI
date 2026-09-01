import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MissionArrival, type MissionArrivalProps } from './MissionArrival'

const ARRIVAL_STAGES = ['descent', 'touchdown', 'approach', 'airlock'] as const

const TEST_TIMINGS: NonNullable<MissionArrivalProps['timings']> = {
  descent: 100,
  touchdown: 100,
  approach: 100,
  airlock: 100,
}

const beginLanding = async () => {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /start landing/i }))
    await Promise.resolve()
  })
}

describe('MissionArrival', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('holds on an explanatory briefing until the player explicitly starts', () => {
    const onPrepareNewMission = vi.fn()
    const onComplete = vi.fn()

    render(
      <MissionArrival
        onComplete={onComplete}
        onPrepareNewMission={onPrepareNewMission}
        timings={TEST_TIMINGS}
      />,
    )

    expect(screen.getByRole('heading', { name: /land safely.*build deliberately/i })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Ground → Plan → Supervise → Verify' })).toBeVisible()
    expect(screen.getByText(/nothing starts on its own/i)).toBeVisible()
    expect(screen.getByRole('button', { name: /start landing/i })).toBeEnabled()

    act(() => vi.advanceTimersByTime(60_000))

    expect(onPrepareNewMission).not.toHaveBeenCalled()
    expect(onComplete).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /start landing/i })).toBeEnabled()
  })

  it('prepares a fresh mission, stages the full suited arrival, and completes once', async () => {
    const onPrepareNewMission = vi.fn().mockResolvedValue(undefined)
    const onComplete = vi.fn()
    const { container } = render(
      <MissionArrival
        onComplete={onComplete}
        onPrepareNewMission={onPrepareNewMission}
        timings={TEST_TIMINGS}
      />,
    )

    await beginLanding()

    expect(onPrepareNewMission).toHaveBeenCalledTimes(1)
    expect(container.querySelector('.mission-arrival')).toHaveAttribute('data-arrival-stage', 'descent')
    expect(screen.getByRole('img', { name: /powered descent active/i })).toBeVisible()

    for (const stage of ARRIVAL_STAGES.slice(1)) {
      act(() => vi.advanceTimersByTime(100))
      expect(container.querySelector('.mission-arrival')).toHaveAttribute('data-arrival-stage', stage)
    }

    expect(container.querySelectorAll('[data-pawn-suited="true"]')).toHaveLength(6)
    expect(screen.getByRole('img', { name: /airlock is pressurizing/i })).toBeVisible()

    act(() => vi.advanceTimersByTime(100))

    expect(onComplete).toHaveBeenCalledTimes(1)
    expect(onComplete).toHaveBeenCalledWith({ kind: 'new', skipped: false })
    expect(screen.getByRole('strong')).toHaveTextContent('Opening mission')

    act(() => vi.advanceTimersByTime(10_000))
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it('lets the player skip the timed arrival without duplicating completion', async () => {
    const onComplete = vi.fn()
    render(
      <MissionArrival
        onComplete={onComplete}
        onPrepareNewMission={vi.fn()}
        timings={TEST_TIMINGS}
      />,
    )

    await beginLanding()
    fireEvent.click(screen.getByRole('button', { name: /skip arrival/i }))

    expect(onComplete).toHaveBeenCalledWith({ kind: 'new', skipped: true })

    act(() => vi.advanceTimersByTime(10_000))
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it('resumes a saved mission without resetting it or replaying the cutscene', () => {
    const onPrepareNewMission = vi.fn()
    const onComplete = vi.fn()
    render(
      <MissionArrival
        hasSavedMission
        onComplete={onComplete}
        onPrepareNewMission={onPrepareNewMission}
      />,
    )

    expect(screen.getByRole('button', { name: /resume saved mission/i })).toBeVisible()
    expect(screen.getByRole('button', { name: /start a new landing/i })).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: /resume saved mission/i }))

    expect(onPrepareNewMission).not.toHaveBeenCalled()
    expect(onComplete).toHaveBeenCalledWith({ kind: 'saved', skipped: false })
    expect(screen.queryByTestId('arrival-scene')).not.toBeInTheDocument()
  })

  it('keeps the player at the briefing when preparation fails', async () => {
    const onComplete = vi.fn()
    render(
      <MissionArrival
        onComplete={onComplete}
        onPrepareNewMission={() => Promise.reject(new Error('navigation check failed'))}
      />,
    )

    await beginLanding()

    expect(screen.getByRole('alert')).toHaveTextContent(/navigation check failed/i)
    expect(screen.getByRole('button', { name: /start landing/i })).toBeEnabled()
    expect(screen.queryByTestId('arrival-scene')).not.toBeInTheDocument()
    expect(onComplete).not.toHaveBeenCalled()
  })
})
