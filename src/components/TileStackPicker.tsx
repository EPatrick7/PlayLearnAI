import {
  useCallback,
  useEffect,
  useRef,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { GameIcon, type GameIconName } from './GameIcon'
import type { MapInspectable, MapTileInspection } from './mapInspection'
import { PawnSprite } from './PawnSprite'

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
  const margin = 8
  const gap = 8
  const estimatedWidth = Math.min(260, Math.max(220, viewportWidth - margin * 2))
  const estimatedHeight = Math.min(342, 46 + (tile.contents.length + 1) * 48)
  const anchorRight = bounds
    ? bounds.right + gap + estimatedWidth > viewportWidth - margin
    : tile.cell.x >= Math.floor(gridWidth * 0.62)
  const anchorBottom = bounds
    ? bounds.top + estimatedHeight > viewportHeight - margin
    : tile.cell.y >= Math.floor(gridHeight * 0.56)
  const left = bounds
    ? anchorRight
      ? bounds.left - estimatedWidth - gap
      : bounds.right + gap
    : margin
  const top = bounds
    ? anchorBottom
      ? bounds.bottom - estimatedHeight
      : bounds.top
    : margin

  return {
    anchorRight,
    anchorBottom,
    style: {
      left: Math.max(margin, Math.min(left, viewportWidth - estimatedWidth - margin)),
      top: Math.max(margin, Math.min(top, viewportHeight - estimatedHeight - margin)),
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
  const placement = pickerPlacement(tile, trigger, gridWidth, gridHeight)
  const contentKeys = tile.contents.map((item) => item.key).join('\u001f')

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
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (pickerRef.current?.contains(event.target as Node)) return
      closeAndRestore()
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer)
      restoreTriggerFocus()
    }
  }, [closeAndRestore, restoreTriggerFocus, tile.key])

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const picker = pickerRef.current
      if (!picker || picker.contains(document.activeElement)) return
      picker.querySelector<HTMLButtonElement>(
        '.tile-stack-item, .tile-stack-surface',
      )?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [contentKeys, tile.key])

  return createPortal((
    <>
    <div aria-hidden="true" className="tile-stack-backdrop portal-layer" />
    <section
      aria-label="Choose an item"
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
          <strong>Tile {tile.cell.x + 1}, {tile.cell.y + 1}</strong>
          <small>Select what to inspect</small>
        </span>
        <em aria-label={`${tile.contents.length} overlapping items`}>{tile.contents.length}</em>
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
            <span className={`tile-stack-item-icon ${item.portrait ? 'tile-stack-pawn-icon' : ''}`}>
              {item.portrait
                ? <PawnSprite {...item.portrait} size="compact" />
                : <GameIcon name={item.icon} />}
            </span>
            <span className="tile-stack-item-copy">
              <strong>{item.label}</strong>
              <small>{item.subtitle}</small>
            </span>
          </button>
        ))}
      </div>

      <div aria-label="Tile itself" className="tile-stack-surface-section" role="group">
        <button className="tile-stack-surface" onClick={selectSurface} type="button">
          <span className="tile-stack-item-icon"><GameIcon name={surfaceIcon(tile)} /></span>
          <span className="tile-stack-item-copy">
            <strong>Tile itself · {tile.surfaceLabel}</strong>
            <small>{tile.roomLabel ?? 'Exterior'} · Tile {tile.cell.x + 1}, {tile.cell.y + 1}</small>
          </span>
        </button>
      </div>
    </section>
    </>
  ), document.body)
}
