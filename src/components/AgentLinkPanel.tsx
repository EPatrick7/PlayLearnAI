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
    badge: 'Ready',
    title: 'Agent ready',
    summary: 'Ask Codex to inspect or propose changes. You approve plans before time advances.',
  },
  registering: {
    badge: 'Connecting…',
    title: 'Connecting agent',
    summary: 'You can keep playing while the connection finishes.',
  },
  unavailable: {
    badge: 'Manual play',
    title: 'Manual play',
    summary: 'Agent access is not available in this browser.',
  },
  error: {
    badge: 'Offline',
    title: 'Agent connection failed',
    summary: 'Your mission is safe. Play manually or reload.',
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
  ground: 'Inspect this incident and explain the main risks. Do not change anything.',
  plan: 'Stage a safe plan for review. Do not commit it.',
  supervise: 'Advance 1 hour, then summarize what changed.',
  verify: 'Check the outcome and list remaining risks.',
} as const

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

      {status === 'ready' && (
        <div className="agent-link-capability">
          <span className="agent-link-capability-heading">
            <span className="agent-link-eyebrow">Try this in Codex</span>
            <button onClick={() => void copyPrompt()} type="button">
              {copyState === 'copied' ? 'Copied' : copyState === 'failed' ? 'Copy failed' : 'Copy prompt'}
            </button>
          </span>
          <p>{firstPrompt}</p>
        </div>
      )}
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
