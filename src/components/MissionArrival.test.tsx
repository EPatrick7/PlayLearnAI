import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MissionArrival, type MissionArrivalProps } from './MissionArrival'

const ARRIVAL_STAGES = ['touchdown', 'emergency'] as const

const TEST_TIMINGS: NonNullable<MissionArrivalProps['timings']> = {
  touchdown: 100,
  emergency: 100,
}

const beginLanding = async () => {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /start new colony/i }))
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

  it('holds on a concise mission briefing until the player explicitly starts', () => {
    const onPrepareNewMission = vi.fn()
    const onComplete = vi.fn()

    render(
      <MissionArrival
        onComplete={onComplete}
        onPrepareNewMission={onPrepareNewMission}
        timings={TEST_TIMINGS}
      />,
    )

    expect(screen.getByRole('heading', { name: /build a home.*on the moon/i })).toBeVisible()
    expect(screen.getByRole('complementary', { name: 'First shift' })).toHaveTextContent(
      'Build a second room with an airlock and life support.',
    )
    expect(screen.getByText(/start with one habitat.*keep six crew safe/i)).toBeVisible()
    expect(screen.getByRole('button', { name: /start new colony/i })).toBeEnabled()

    act(() => vi.advanceTimersByTime(60_000))

    expect(onPrepareNewMission).not.toHaveBeenCalled()
    expect(onComplete).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /start new colony/i })).toBeEnabled()
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
    expect(container.querySelector('.mission-arrival')).toHaveAttribute('data-arrival-stage', 'touchdown')
    expect(screen.getByRole('img', { name: /landed safely beside the starter habitat/i })).toBeVisible()

    for (const stage of ARRIVAL_STAGES.slice(1)) {
      act(() => vi.advanceTimersByTime(100))
      expect(container.querySelector('.mission-arrival')).toHaveAttribute('data-arrival-stage', stage)
    }

    expect(container.querySelectorAll('[data-pawn-suited="true"]')).toHaveLength(6)
    expect(screen.getByRole('img', { name: /Amina and Mateo are starting a habitat expansion/i })).toBeVisible()

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
    fireEvent.click(screen.getByRole('button', { name: /skip intro/i }))

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
        savedMissionDay={3}
        savedMissionLabel="Complete the first expansion"
      />,
    )

    expect(screen.getByRole('button', { name: /continue mission/i })).toBeVisible()
    expect(screen.getByRole('button', { name: /new colony/i })).toBeVisible()
    expect(screen.getByRole('complementary', { name: /saved mission/i })).toHaveTextContent(
      /continue · day 3.*complete the first expansion/i,
    )

    fireEvent.click(screen.getByRole('button', { name: /continue mission/i }))

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
    expect(screen.getByRole('button', { name: /start new colony/i })).toBeEnabled()
    expect(screen.queryByTestId('arrival-scene')).not.toBeInTheDocument()
    expect(onComplete).not.toHaveBeenCalled()
  })
})
