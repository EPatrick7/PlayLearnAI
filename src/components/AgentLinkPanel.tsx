import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import '../agent-link.css'

export type AgentLinkStatus = 'registering' | 'ready' | 'unavailable' | 'error'
export type AgentLinkSettlementPhase =
  | 'landing'
  | 'power_online'
  | 'habitable'
  | 'expanding'
  | 'ready'
  | 'operations'

export interface AgentLinkPanelProps {
  status: AgentLinkStatus
  settlementPhase: AgentLinkSettlementPhase
  learningPhase?: 'ground' | 'plan' | 'supervise' | 'verify'
  className?: string
}

interface PanelPlacement {
  left: number
  maxHeight: number
  side: 'above' | 'below'
  top: number
  width: number
}

const statusContent: Record<AgentLinkStatus, {
  badge: string
  title: string
  summary: string
}> = {
  ready: {
    badge: 'Access ready',
    title: 'Agent access ready',
    summary: 'This browser can share the live mission with an agent. Nothing changes until you ask in the Codex task and review its proposal here.',
  },
  registering: {
    badge: 'Setting up',
    title: 'Setting up agent access',
    summary: 'The page is checking whether this browser can make the live mission available to an agent.',
  },
  unavailable: {
    badge: 'Manual only',
    title: 'Agent access unavailable',
    summary: 'This browser cannot offer the live mission to an agent here. You can still play everything by hand.',
  },
  error: {
    badge: 'Access error',
    title: 'Agent access error',
    summary: 'Agent access did not finish setting up. Your mission and manual controls are still intact.',
  },
}

const phasePrompts: Record<AgentLinkSettlementPhase, string> = {
  landing: 'Inspect my landing site. Explain what is already built and what the first safe expansion needs. Do not build anything yet.',
  power_online: 'Inspect my landing site. Explain what is safe, what is missing, and what I should do next. Do not change anything yet.',
  habitable: 'Inspect my landing site. Check access, life support, and remaining work. Explain the evidence before changing anything.',
  expanding: 'Inspect the build queue and settlement. Tell me what is blocking the first shift. Do not change the queue yet.',
  ready: 'Inspect the finished expansion and tell me whether it is safe to begin the first shift. Wait for me before starting it.',
  operations: 'Inspect the incident and explain the evidence, risks, and choices. Do not stage or commit a plan yet.',
}

const operationsPrompts = {
  ground: 'Inspect the incident, dependencies, crew, gear, oxygen, and power. Explain the evidence. Do not change anything yet.',
  plan: 'Based on the evidence, stage the smallest safe response that achieves the objective. Do not commit it. Show me the assignments, safeguards, and validation issues to review.',
  supervise: 'Advance one hour, then explain what changed and whether we should continue, pause, or revise the plan.',
  verify: 'Compare the fresh outcome with the declared objective and constraints. Show any residual risks.',
} as const

const connectionSteps: Record<AgentLinkStatus, string[]> = {
  ready: [
    'Keep this game open in the same built-in browser tab.',
    'Paste the suggested prompt into the Codex task beside this browser.',
    'Review every proposed change here before advancing the mission.',
  ],
  registering: [
    'Keep this page open while the connection finishes.',
    'If it stays here, reload the page once.',
    'You can continue playing by hand while you wait.',
  ],
  unavailable: [
    'Open this game in the built-in browser in the latest desktop app.',
    'Use GPT-5.6 Sol or GPT-5.6 Terra; Luna does not currently support Site tools.',
    'Reload the game. No separate MCP server, plugin, or API key is needed.',
  ],
  error: [
    'Reload this game in the built-in browser.',
    'Use GPT-5.6 Sol or GPT-5.6 Terra in the latest desktop app.',
    'If it still fails, keep playing by hand; the saved mission is unaffected.',
  ],
}

const calculatePlacement = (trigger: HTMLButtonElement | null): PanelPlacement => {
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  const margin = 8
  const gap = 8
  const width = Math.min(372, Math.max(0, viewportWidth - margin * 2))
  const triggerBounds = trigger?.getBoundingClientRect()
  const headerBounds = trigger?.closest('header')?.getBoundingClientRect()
  const anchorBottom = Math.max(triggerBounds?.bottom ?? margin, headerBounds?.bottom ?? 0)
  const belowTop = anchorBottom + gap
  const estimatedHeight = Math.min(476, viewportHeight - margin * 2)
  const belowSpace = viewportHeight - belowTop - margin
  const anchorTop = triggerBounds?.top ?? margin
  const aboveSpace = anchorTop - gap - margin
  const side = belowSpace < Math.min(320, estimatedHeight) && aboveSpace > belowSpace
    ? 'above'
    : 'below'
  const top = side === 'above'
    ? Math.max(margin, anchorTop - gap - estimatedHeight)
    : Math.max(margin, belowTop)
  const desiredLeft = (triggerBounds?.right ?? viewportWidth - margin) - width
  const left = Math.max(margin, Math.min(desiredLeft, viewportWidth - width - margin))

  return {
    left,
    maxHeight: Math.max(96, viewportHeight - top - margin),
    side,
    top,
    width,
  }
}

/**
 * Compact status control for the browser's WebMCP connection. The non-modal
 * dialog explains how to connect and begin supervised play without exposing
 * the implementation's tool catalog.
 */
export function AgentLinkPanel({
  status,
  settlementPhase,
  learningPhase = 'ground',
  className,
}: AgentLinkPanelProps) {
  const [open, setOpen] = useState(false)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [placement, setPlacement] = useState<PanelPlacement | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const summaryId = useId()
  const panelId = useId()
  const connection = statusContent[status]
  const firstPrompt = settlementPhase === 'operations'
    ? operationsPrompts[learningPhase]
    : phasePrompts[settlementPhase]
  const steps = connectionSteps[status]

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(firstPrompt)
      setCopyState('copied')
    } catch {
      setCopyState('failed')
    }
  }

  const updatePlacement = useCallback(() => {
    setPlacement(calculatePlacement(triggerRef.current))
  }, [])

  const restoreTriggerFocus = useCallback(() => {
    window.requestAnimationFrame(() => triggerRef.current?.focus())
  }, [])

  const closePanel = useCallback((restoreFocus: boolean) => {
    setOpen(false)
    if (restoreFocus) restoreTriggerFocus()
  }, [restoreTriggerFocus])

  const togglePanel = () => {
    if (open) {
      closePanel(true)
      return
    }
    setCopyState('idle')
    updatePlacement()
    setOpen(true)
  }

  useLayoutEffect(() => {
    if (!open) return
    updatePlacement()
  }, [open, updatePlacement])

  useEffect(() => {
    if (!open) return
    const frame = window.requestAnimationFrame(() => closeRef.current?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [open])

  useEffect(() => {
    if (!open) return

    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return
      closePanel(false)
    }
    const closeOnOutsideFocus = (event: FocusEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return
      closePanel(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      closePanel(true)
    }

    document.addEventListener('pointerdown', closeOnOutsidePointer)
    document.addEventListener('focusin', closeOnOutsideFocus)
    document.addEventListener('keydown', closeOnEscape)
    window.addEventListener('resize', updatePlacement)
    window.addEventListener('scroll', updatePlacement, true)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer)
      document.removeEventListener('focusin', closeOnOutsideFocus)
      document.removeEventListener('keydown', closeOnEscape)
      window.removeEventListener('resize', updatePlacement)
      window.removeEventListener('scroll', updatePlacement, true)
    }
  }, [closePanel, open, updatePlacement])

  const panel = open && placement ? createPortal((
    <section
      aria-describedby={summaryId}
      aria-labelledby={titleId}
      className="agent-link-popover"
      data-placement={placement.side}
      data-status={status}
      id={panelId}
      ref={panelRef}
      role="dialog"
      style={{
        left: placement.left,
        maxHeight: placement.maxHeight,
        top: placement.top,
        width: placement.width,
      }}
    >
      <header className="agent-link-popover-header">
        <span aria-hidden="true" className="agent-link-mark">
          <i />
          <i />
          <i />
        </span>
        <span className="agent-link-heading-copy">
          <span className="agent-link-eyebrow">Shared mission</span>
          <strong id={titleId}>{connection.title}</strong>
        </span>
        <button
          aria-label="Close Agent Link details"
          className="agent-link-close"
          onClick={() => closePanel(true)}
          ref={closeRef}
          type="button"
        >
          <span aria-hidden="true">×</span>
        </button>
      </header>

      <div className="agent-link-status-card">
        <span aria-hidden="true" className="agent-link-signal"><i /></span>
        <span>
          <strong>{connection.badge}</strong>
          <small id={summaryId}>{connection.summary}</small>
        </span>
      </div>

      <section className="agent-link-setup" aria-label="Agent connection steps">
        <span className="agent-link-eyebrow">{status === 'ready' ? 'Play together' : 'Connect'}</span>
        <ol>
          {steps.map((step) => <li key={step}>{step}</li>)}
        </ol>
      </section>

      {status === 'ready' && (
        <div className="agent-link-capability">
          <span className="agent-link-capability-heading">
            <span className="agent-link-eyebrow">Try this in Codex</span>
            <button onClick={() => void copyPrompt()} type="button">
              {copyState === 'copied' ? 'Copied' : copyState === 'failed' ? 'Copy failed' : 'Copy prompt'}
            </button>
          </span>
          <p>“{firstPrompt}”</p>
        </div>
      )}

      <p className="agent-link-footnote">
        The agent works in this same live game. Its actions appear here, and you can keep using the manual controls.
      </p>
    </section>
  ), document.body) : null

  return (
    <div
      className={['agent-link-panel', className].filter(Boolean).join(' ')}
      data-status={status}
    >
      <button
        aria-controls={open ? panelId : undefined}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`${connection.title}. ${open ? 'Close' : 'Open'} connection help.`}
        className="agent-link-trigger"
        onClick={togglePanel}
        ref={triggerRef}
        type="button"
      >
        <span aria-hidden="true" className="agent-link-trigger-signal"><i /></span>
        <span className="agent-link-trigger-label">Agent</span>
        <span className="agent-link-trigger-state">{connection.badge}</span>
      </button>
      <span aria-live="polite" className="agent-link-visually-hidden">
        Agent Link status: {connection.badge}.
      </span>
      {panel}
    </div>
  )
}
