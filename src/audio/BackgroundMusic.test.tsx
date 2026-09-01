import '@testing-library/jest-dom/vitest'
import { StrictMode } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BackgroundMusicProvider, MusicToggle } from './BackgroundMusic'

const renderMusic = () => render(
  <StrictMode>
    <BackgroundMusicProvider>
      <MusicToggle className="icon-button" />
    </BackgroundMusicProvider>
  </StrictMode>,
)

beforeEach(() => {
  localStorage.clear()
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined)
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function pause(this: HTMLMediaElement) {
    this.dispatchEvent(new Event('pause'))
  })
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function play(this: HTMLMediaElement) {
    this.dispatchEvent(new Event('playing'))
    return Promise.resolve()
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('background music', () => {
  it('waits for an explicit gesture and toggles playback', () => {
    renderMusic()

    const control = screen.getByRole('button', {
      name: 'Play music. Lunar Drift, 3:2 polyrhythm.',
    })
    expect(control).toHaveAttribute('aria-pressed', 'false')
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled()

    fireEvent.click(control)

    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1)
    expect(control).toHaveAccessibleName('Pause music. Lunar Drift, 3:2 polyrhythm.')
    expect(control).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(control)

    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalledTimes(1)
    expect(control).toHaveAccessibleName('Play music. Lunar Drift, 3:2 polyrhythm.')
    expect(control).toHaveAttribute('aria-pressed', 'false')
  })

  it('continues through the three-song playlist and remembers the current track', async () => {
    const { container } = renderMusic()
    const control = screen.getByRole('button', { name: /Play music\. Lunar Drift/i })
    const audio = container.querySelector('audio')
    expect(audio).not.toBeNull()

    fireEvent.click(control)
    fireEvent.ended(audio!)

    await waitFor(() => {
      expect(control).toHaveAccessibleName('Pause music. Crater Glass, 4:3 polyrhythm.')
    })
    expect(HTMLMediaElement.prototype.load).toHaveBeenCalledTimes(1)
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2)
    expect(JSON.parse(localStorage.getItem('playlearnai-bgm-v1') ?? '{}')).toEqual({
      trackId: 'crater-glass',
    })
  })

  it('restores the last track without autoplaying it', () => {
    localStorage.setItem('playlearnai-bgm-v1', JSON.stringify({ trackId: 'far-side-signals' }))

    renderMusic()

    expect(screen.getByRole('button', {
      name: 'Play music. Far-side Signals, 5:4 polyrhythm.',
    })).toBeVisible()
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled()
  })

  it('returns to an off state when the browser rejects playback', async () => {
    vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValueOnce(
      new DOMException('Playback requires a user gesture.', 'NotAllowedError'),
    )
    renderMusic()

    const control = screen.getByRole('button', { name: /Play music\. Lunar Drift/i })
    fireEvent.click(control)

    await waitFor(() => expect(control).toHaveAttribute('aria-pressed', 'false'))
    expect(control).toHaveAccessibleName('Play music. Lunar Drift, 3:2 polyrhythm.')

    fireEvent.click(control)
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2)
    expect(control).toHaveAttribute('aria-pressed', 'true')
  })
})
