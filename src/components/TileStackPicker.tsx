import {
  useCallback,
  useEffect,
  useId,
  useRef,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { GameIcon, type GameIconName } from './GameIcon'
import type { MapInspectable, MapTileInspection } from './mapInspection'

export interface TileStackPickerProps {
  tile: MapTileInspection
  trigger: HTMLElement | null
  gridWidth: number
  gridHeight: number
  onClose: () => void
  onSelectItem: (tile: MapTileInspection, item: MapInspectable) => void
  onSelectSurface: (tile: MapTileInspection) => void
}

interface PickerPlacement {
  anchorRight: boolean
  anchorBottom: boolean
  style: CSSProperties
}

const surfaceIcon = (tile: MapTileInspection): GameIconName => {
  if (tile.surfaceKind === 'wall') return 'wall'
  if (tile.surfaceKind === 'door') return 'door'
  if (tile.surfaceKind === 'floor' || tile.surfaceKind === 'corridor') return 'floor'
  if (tile.surfaceKind === 'solar') return 'solar'
  if (tile.surfaceKind === 'landing-pad') return 'landingPad'
  return 'map'
}

const pickerPlacement = (
  tile: MapTileInspection,
  trigger: HTMLElement | null,
  gridWidth: number,
  gridHeight: number,
): PickerPlacement => {
  const bounds = trigger?.getBoundingClientRect()
  const viewportWidth = typeof window === 'undefined' ? 0 : window.innerWidth
  const viewportHeight = typeof window === 'undefined' ? 0 : window.innerHeight
  const anchorRight = tile.cell.x >= Math.floor(gridWidth * 0.62)
  const anchorBottom = tile.cell.y >= Math.floor(gridHeight * 0.56)

  return {
    anchorRight,
    anchorBottom,
    style: {
      ...(anchorRight
        ? { right: bounds ? Math.max(8, viewportWidth - bounds.right + 10) : 8 }
        : { left: bounds ? Math.max(8, bounds.left + 10) : 8 }),
      ...(anchorBottom
        ? { bottom: bounds ? Math.max(8, viewportHeight - bounds.top + 10) : 8 }
        : { top: bounds ? Math.max(8, bounds.bottom + 10) : 8 }),
    },
  }
}

/**
 * Shared SS13-style chooser for a tile containing multiple inspectable items.
 * The picker owns dismissal and focus restoration; consumers only own which
 * tile is open and what selection should result.
 */
export function TileStackPicker({
  tile,
  trigger,
  gridWidth,
  gridHeight,
  onClose,
  onSelectItem,
  onSelectSurface,
}: TileStackPickerProps) {
  const pickerRef = useRef<HTMLElement>(null)
  const onCloseRef = useRef(onClose)
  const titleId = useId()
  const placement = pickerPlacement(tile, trigger, gridWidth, gridHeight)

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  const restoreTriggerFocus = useCallback(() => {
    requestAnimationFrame(() => {
      if (!trigger?.isConnected) return
      if (trigger.tabIndex >= 0) {
        trigger.focus()
        if (document.activeElement === trigger) return
      }
      trigger.closest<HTMLElement>('.construction-map')?.focus()
    })
  }, [trigger])

  const closeAndRestore = useCallback(() => {
    onCloseRef.current()
    restoreTriggerFocus()
  }, [restoreTriggerFocus])

  const selectItem = (item: MapInspectable) => {
    onSelectItem(tile, item)
    onCloseRef.current()
    restoreTriggerFocus()
  }

  const selectSurface = () => {
    onSelectSurface(tile)
    onCloseRef.current()
    restoreTriggerFocus()
  }

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      closeAndRestore()
      return
    }
    if (event.key === 'Tab') {
      const controls = [...(pickerRef.current?.querySelectorAll<HTMLButtonElement>(
        'button:not(:disabled)',
      ) ?? [])]
      if (controls.length === 0) return
      event.preventDefault()
      event.stopPropagation()
      const currentIndex = controls.indexOf(document.activeElement as HTMLButtonElement)
      const nextIndex = event.shiftKey
        ? (currentIndex <= 0 ? controls.length - 1 : currentIndex - 1)
        : currentIndex < 0 || currentIndex >= controls.length - 1
          ? 0
          : currentIndex + 1
      controls[nextIndex].focus()
      return
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return

    const choices = [...(pickerRef.current?.querySelectorAll<HTMLButtonElement>(
      '.tile-stack-item, .tile-stack-surface',
    ) ?? [])]
    if (choices.length === 0) return
    event.preventDefault()
    event.stopPropagation()
    const currentIndex = Math.max(
      0,
      choices.indexOf(document.activeElement as HTMLButtonElement),
    )
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? choices.length - 1
        : event.key === 'ArrowDown'
          ? (currentIndex + 1) % choices.length
          : (currentIndex - 1 + choices.length) % choices.length
    choices[nextIndex].focus()
  }

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const firstItem = pickerRef.current?.querySelector<HTMLButtonElement>(
        '.tile-stack-item, .tile-stack-surface',
      )
      firstItem?.focus()
    })
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (pickerRef.current?.contains(event.target as Node)) return
      closeAndRestore()
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('pointerdown', closeOnOutsidePointer)
      restoreTriggerFocus()
    }
  }, [closeAndRestore, restoreTriggerFocus, tile.key])

  return createPortal((
    <section
      aria-labelledby={titleId}
      className={[
        'tile-stack-popover',
        'portal-layer',
        placement.anchorRight ? 'anchor-right' : 'anchor-left',
        placement.anchorBottom ? 'anchor-bottom' : 'anchor-top',
      ].join(' ')}
      data-grid-x={tile.cell.x}
      data-grid-y={tile.cell.y}
      onKeyDown={handleKeyDown}
      ref={pickerRef}
      role="dialog"
      style={placement.style}
    >
      <header className="tile-stack-header">
        <span className="tile-stack-heading-icon"><GameIcon name="inspect" /></span>
        <span>
          <small>Tile {String(tile.cell.x + 1).padStart(2, '0')} · {String(tile.cell.y + 1).padStart(2, '0')}</small>
          <strong id={titleId}>Choose an item</strong>
          <em>{tile.contents.length} things here</em>
        </span>
        <button
          aria-label="Close item picker"
          className="tile-stack-close"
          onClick={closeAndRestore}
          type="button"
        >
          <GameIcon name="close" />
        </button>
      </header>

      <div className="tile-stack-list">
        {tile.contents.map((item) => (
          <button
            className={`tile-stack-item stack-kind-${item.kind}`}
            key={item.key}
            onClick={() => selectItem(item)}
            type="button"
          >
            <span className="tile-stack-item-icon"><GameIcon name={item.icon} /></span>
            <span className="tile-stack-item-copy">
              <strong>{item.label}</strong>
              <small>{item.subtitle}</small>
            </span>
            <GameIcon className="tile-stack-chevron" name="chevron" />
          </button>
        ))}
      </div>

      <button className="tile-stack-surface" onClick={selectSurface} type="button">
        <span className="tile-stack-item-icon"><GameIcon name={surfaceIcon(tile)} /></span>
        <span className="tile-stack-item-copy">
          <strong>{tile.surfaceLabel}</strong>
          <small>{tile.roomLabel ?? 'Exterior'} · Inspect tile surface</small>
        </span>
        <GameIcon className="tile-stack-chevron" name="chevron" />
      </button>
    </section>
  ), document.body)
}
