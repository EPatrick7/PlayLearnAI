import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentLinkPanel, type AgentLinkStatus } from './AgentLinkPanel'

afterEach(cleanup)

const renderPanel = (
  status: AgentLinkStatus = 'ready',
  settlementPhase: Parameters<typeof AgentLinkPanel>[0]['settlementPhase'] = 'operations',
) => render(<AgentLinkPanel settlementPhase={settlementPhase} status={status} />)

describe('AgentLinkPanel', () => {
  it('shows connection status and a supervised first prompt without exposing the tool catalog', async () => {
    renderPanel()
    const trigger = screen.getByRole('button', { name: /Agent ready.*Open connection help/i })

    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(trigger).toHaveTextContent('AgentReady')
    expect(trigger).not.toHaveTextContent(/\d/)
    fireEvent.click(trigger)

    const dialog = screen.getByRole('dialog', { name: 'Agent ready' })
    expect(dialog).not.toHaveAttribute('aria-modal')
    expect(dialog).toHaveTextContent('You approve plans before time advances')
    expect(dialog).toHaveTextContent('Inspect this incident and explain the main risks')
    expect(dialog).not.toHaveTextContent(/\btools?\b/i)
    expect(dialog).not.toHaveTextContent(/capabilit/i)
    expect(dialog).not.toHaveTextContent(/revision/i)
    await waitFor(() => expect(document.activeElement).toBe(
      within(dialog).getByRole('button', { name: 'Close Agent Link details' }),
    ))
  })

  it.each([
    ['ready', 'Agent ready', 'approve plans before time advances'],
    ['registering', 'Connecting agent', 'keep playing while the connection finishes'],
    ['unavailable', 'Manual play', 'not available in this browser'],
    ['error', 'Agent connection failed', 'mission is safe'],
  ] as const)('explains the %s connection state', (status, heading, explanation) => {
    renderPanel(status)
    fireEvent.click(screen.getByRole('button', { name: new RegExp(heading, 'i') }))

    const dialog = screen.getByRole('dialog', { name: heading })
    expect(dialog).toHaveAttribute('data-status', status)
    expect(dialog).toHaveTextContent(explanation)
  })

  it('keeps the disconnected state concise and playable', () => {
    renderPanel('unavailable', 'landing')
    fireEvent.click(screen.getByRole('button', { name: /Manual play/i }))

    const dialog = screen.getByRole('dialog', { name: 'Manual play' })
    expect(dialog).toHaveTextContent('Agent access is not available in this browser')
    expect(dialog).not.toHaveTextContent(/MCP server|API key|GPT-5/i)
  })

  it.each([
    ['landing', 'what the first safe expansion needs'],
    ['power_online', 'what is safe, what is missing'],
    ['habitable', 'Check access, life support, and remaining work'],
    ['expanding', 'what is blocking the first shift'],
    ['ready', 'whether it is safe to begin the first shift'],
    ['operations', 'explain the main risks'],
  ] as const)('offers an inspect-first prompt for %s', (phase, prompt) => {
    renderPanel('ready', phase)
    fireEvent.click(screen.getByRole('button', { name: /Open connection help/i }))
    expect(screen.getByRole('dialog', { name: 'Agent ready' })).toHaveTextContent(prompt)
  })

  it.each([
    ['ground', 'Do not change anything'],
    ['plan', 'Do not commit it'],
    ['supervise', 'Advance 1 hour'],
    ['verify', 'list remaining risks'],
  ] as const)('teaches the %s authority boundary', (learningPhase, prompt) => {
    render(
      <AgentLinkPanel
        learningPhase={learningPhase}
        settlementPhase="operations"
        status="ready"
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Open connection help/i }))
    expect(screen.getByRole('dialog', { name: 'Agent ready' })).toHaveTextContent(prompt)
  })

  it('closes on Escape and the close control, restoring focus to the trigger', async () => {
    renderPanel()
    const trigger = screen.getByRole('button', { name: /Open connection help/i })
    fireEvent.click(trigger)
    const dialog = screen.getByRole('dialog', { name: 'Agent ready' })
    await waitFor(() => expect(dialog).toContainElement(document.activeElement as HTMLElement))

    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Agent ready' })).not.toBeInTheDocument()
    await waitFor(() => expect(document.activeElement).toBe(trigger))

    fireEvent.click(trigger)
    fireEvent.click(await screen.findByRole('button', { name: 'Close Agent Link details' }))
    expect(screen.queryByRole('dialog', { name: 'Agent ready' })).not.toBeInTheDocument()
    await waitFor(() => expect(document.activeElement).toBe(trigger))
  })

  it('dismisses on an outside pointer without stealing outside focus', () => {
    render(
      <>
        <AgentLinkPanel settlementPhase="operations" status="ready" />
        <button type="button">Outside action</button>
      </>,
    )
    fireEvent.click(screen.getByRole('button', { name: /Open connection help/i }))
    const outside = screen.getByRole('button', { name: 'Outside action' })
    fireEvent.pointerDown(outside)
    outside.focus()

    expect(screen.queryByRole('dialog', { name: 'Agent ready' })).not.toBeInTheDocument()
    expect(document.activeElement).toBe(outside)
  })

  it('copies the phase-specific prompt for use in the Codex task', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    renderPanel('ready', 'operations')
    fireEvent.click(screen.getByRole('button', { name: /Open connection help/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Copy prompt' }))

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining(
      'Inspect this incident and explain the main risks',
    )))
    expect(screen.getByRole('button', { name: 'Copied' })).toBeVisible()
  })
})
