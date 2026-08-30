import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { createPortal } from 'react-dom'
import type { CrewMember } from '../game/types'
import { crewPawnPresentation } from './crewPawnPresentation'
import { GameIcon } from './GameIcon'
import { PawnSprite } from './PawnSprite'

export interface ConstructionWorkerOption {
  member: CrewMember
  crewIndex: number
  available: boolean
  badge: 'Assigned' | 'Working' | 'Available' | 'Reassign' | 'Unavailable'
  detail: string
  routeSteps: number | null
}

interface ConstructionWorkerPickerProps {
  orderLabel: string
  selectedCrewId: string | null
  automaticAvailable: boolean
  automaticDetail: string
  options: readonly ConstructionWorkerOption[]
  trigger: HTMLElement | null
  onClose: () => void
  onSelect: (crewId: string | null) => void
}

const pickerPosition = (trigger: HTMLElement | null): CSSProperties => {
  if (typeof window === 'undefined') return {}
  const margin = 8
  const gap = 8
  const width = Math.min(340, window.innerWidth - margin * 2)
  const height = Math.min(430, window.innerHeight - margin * 2)
  const bounds = trigger?.getBoundingClientRect()
  const proposedLeft = bounds
    ? bounds.right + gap + width <= window.innerWidth - margin
      ? bounds.right + gap
      : bounds.left - width - gap
    : margin
  const proposedTop = bounds ? bounds.top : margin
  return {
    left: Math.max(margin, Math.min(proposedLeft, window.innerWidth - width - margin)),
    top: Math.max(margin, Math.min(proposedTop, window.innerHeight - height - margin)),
  }
}

export function ConstructionWorkerPicker({
  orderLabel,
  selectedCrewId,
  automaticAvailable,
  automaticDetail,
  options,
  trigger,
  onClose,
  onSelect,
}: ConstructionWorkerPickerProps) {
  const pickerRef = useRef<HTMLElement>(null)
  const onCloseRef = useRef(onClose)
  const optionKey = options.map((option) => (
    `${option.member.id}:${option.available}:${option.badge}:${option.routeSteps}`
  )).join('|')
  const [position, setPosition] = useState<CSSProperties>(() => pickerPosition(trigger))

  useEffect(() => {
    const updatePosition = () => setPosition(pickerPosition(trigger))
    updatePosition()
    window.addEventListener('resize', updatePosition)
    return () => window.removeEventListener('resize', updatePosition)
  }, [trigger])

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  const restoreFocus = useCallback(() => {
    requestAnimationFrame(() => {
      if (trigger?.isConnected) {
        trigger.focus()
        if (document.activeElement === trigger) return
      }
      document.querySelector<HTMLElement>('.construction-map')?.focus()
    })
  }, [trigger])

  const closeAndRestore = useCallback(() => {
    onCloseRef.current()
    restoreFocus()
  }, [restoreFocus])

  const choose = (crewId: string | null, available: boolean) => {
    if (!available) return
    onSelect(crewId)
    onCloseRef.current()
    restoreFocus()
  }

  const choices = () => [...(pickerRef.current?.querySelectorAll<HTMLButtonElement>(
    '.construction-worker-option',
  ) ?? [])]
  const tabStops = () => [...(pickerRef.current?.querySelectorAll<HTMLButtonElement>(
    '.construction-worker-picker-header > button, .construction-worker-option',
  ) ?? [])]

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      closeAndRestore()
      return
    }
    if (event.key === 'Tab') {
      const focusable = tabStops()
      if (focusable.length === 0) return
      const current = Math.max(0, focusable.indexOf(document.activeElement as HTMLButtonElement))
      const next = event.shiftKey
        ? (current - 1 + focusable.length) % focusable.length
        : (current + 1) % focusable.length
      event.preventDefault()
      focusable[next].focus()
      return
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    const focusable = choices()
    if (focusable.length === 0) return
    const current = Math.max(0, focusable.indexOf(document.activeElement as HTMLButtonElement))
    const next = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? focusable.length - 1
        : event.key === 'ArrowDown'
          ? (current + 1) % focusable.length
          : (current - 1 + focusable.length) % focusable.length
    event.preventDefault()
    event.stopPropagation()
    focusable[next].focus()
  }

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const checked = pickerRef.current?.querySelector<HTMLButtonElement>(
        '.construction-worker-option[aria-checked="true"]',
      )
      ;(checked ?? pickerRef.current?.querySelector<HTMLButtonElement>(
        '.construction-worker-option',
      ))?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [optionKey, selectedCrewId])

  useEffect(() => () => restoreFocus(), [restoreFocus])

  return createPortal((
    <>
      <button
        aria-label="Close builder picker"
        className="construction-worker-backdrop portal-layer"
        onClick={closeAndRestore}
        tabIndex={-1}
        type="button"
      />
      <section
        aria-label="Choose a builder"
        aria-modal="true"
        className="construction-worker-picker portal-layer"
        onKeyDown={handleKeyDown}
        ref={pickerRef}
        role="dialog"
        style={position}
      >
        <header className="construction-worker-picker-header">
          <span><GameIcon name="crew" /></span>
          <span>
            <strong>Choose a builder</strong>
            <small>{orderLabel}</small>
          </span>
          <button aria-label="Close builder picker" onClick={closeAndRestore} type="button">
            <GameIcon name="close" />
          </button>
        </header>

        <div aria-label="Builder assignment" className="construction-worker-list" role="radiogroup">
          <button
            aria-checked={selectedCrewId === null}
            aria-disabled={!automaticAvailable}
            className="construction-worker-option construction-worker-automatic"
            data-worker-state={automaticAvailable ? 'available' : 'unavailable'}
            onClick={() => choose(null, automaticAvailable)}
            role="radio"
            type="button"
          >
            <span className="construction-worker-option-icon"><GameIcon name="gear" /></span>
            <span className="construction-worker-option-copy">
              <strong>Automatic assignment</strong>
              <small>{automaticDetail}</small>
            </span>
            <span className="construction-worker-option-badge">
              {selectedCrewId === null && <GameIcon name="check" />}
              {automaticAvailable ? 'Auto' : 'Locked'}
            </span>
          </button>

          {options.map((option) => {
            const portrait = crewPawnPresentation(option.member, option.crewIndex)
            const checked = selectedCrewId === option.member.id
            return (
              <button
                aria-checked={checked}
                aria-disabled={!option.available}
                aria-label={`${option.member.name}, ${option.badge}. ${option.detail}`}
                className="construction-worker-option"
                data-crew-id={option.member.id}
                data-worker-state={option.available ? option.badge.toLowerCase() : 'unavailable'}
                key={option.member.id}
                onClick={() => choose(option.member.id, option.available)}
                role="radio"
                type="button"
              >
                <span className="construction-worker-portrait">
                  <PawnSprite {...portrait} size="compact" />
                </span>
                <span className="construction-worker-option-copy">
                  <strong>{option.member.name}</strong>
                  <small>{option.member.role}</small>
                  <em>
                    Engineering {option.member.skills.engineering} · Fatigue {Math.round(option.member.fatigue)}%
                    {option.routeSteps === null ? '' : ` · ${option.routeSteps} steps`}
                  </em>
                  <i>{option.detail}</i>
                </span>
                <span className="construction-worker-option-badge">
                  {checked && <GameIcon name="check" />}
                  {option.badge}
                </span>
              </button>
            )
          })}
        </div>
      </section>
    </>
  ), document.body)
}
