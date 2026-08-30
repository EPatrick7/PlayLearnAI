import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import {
  boundaryAt,
  cellsOnConstructionLine,
  detectRooms,
  eraseLine,
  getWorkstationFootprintSize,
  isInConstructionBounds,
  paintBoundaryCell,
  paintBoundaryLine,
  placeWorkstation,
  validateWorkstationPlacement,
  workstationAt,
  type ConstructionLayout,
  type ConstructionResult,
  type GridPoint,
  type WorkstationPlacementInput,
  type WorkstationRotation,
} from '../game/construction'
import {
  WORKSTATION_SPECS,
  isWorkstationTool,
  type ConstructionTool,
  type WorkstationKind,
} from '../game/constructionCatalog'
import {
  BOUNDARY_CONNECTION_BITS,
  getBoundaryConnection,
  getBoundaryDoorAxis,
} from '../game/boundaryConnections'
import { GameIcon } from './GameIcon'
import { PawnSprite } from './PawnSprite'

interface ConstructionMapProps {
  layout: ConstructionLayout
  selectedTool: ConstructionTool | null
  rotation: WorkstationRotation
  onApply: (result: ConstructionResult, label: string) => void
  onCancelTool: () => void
  onError: (message: string) => void
  onRotate: () => void
  onUndo: () => void
}

interface DraftPreview {
  cells: GridPoint[]
  valid: boolean
  label: string
  error: string | null
}

interface PointerPosition {
  x: number
  y: number
}

const keyFor = (point: GridPoint) => `${point.x}:${point.y}`

const pointFromElement = (element: Element | null): GridPoint | null => {
  const cell = element?.closest<HTMLElement>('[data-construction-cell]')
  if (!cell) return null
  const x = Number(cell.dataset.gridX)
  const y = Number(cell.dataset.gridY)
  return Number.isInteger(x) && Number.isInteger(y) ? { x, y } : null
}

const workstationInput = (
  kind: WorkstationKind,
  point: GridPoint,
  rotation: WorkstationRotation,
  id = `preview-${kind}`,
): WorkstationPlacementInput => {
  const spec = WORKSTATION_SPECS[kind]
  return {
    id,
    type: kind,
    label: spec.label,
    origin: point,
    size: { width: spec.width, height: spec.height },
    rotation,
  }
}

const nextWorkstationId = (layout: ConstructionLayout, kind: WorkstationKind) => {
  let sequence = layout.workstations.filter((item) => item.type === kind).length + 1
  let id = `${kind}-${sequence}`
  while (layout.workstations.some((item) => item.id === id)) {
    sequence += 1
    id = `${kind}-${sequence}`
  }
  return id
}

export function ConstructionMap({
  layout,
  selectedTool,
  rotation,
  onApply,
  onCancelTool,
  onError,
  onRotate,
  onUndo,
}: ConstructionMapProps) {
  const mapRef = useRef<HTMLDivElement>(null)
  const pointerIdRef = useRef<number | null>(null)
  const dragStartRef = useRef<GridPoint | null>(null)
  const dragEndRef = useRef<GridPoint | null>(null)
  const keyboardAnchorRef = useRef<GridPoint | null>(null)
  const touchPointsRef = useRef(new Map<number, PointerPosition>())
  const touchPanCenterRef = useRef<PointerPosition | null>(null)
  const [hoverCell, setHoverCell] = useState<GridPoint | null>({ x: 8, y: 9 })
  const [dragStart, setDragStart] = useState<GridPoint | null>(null)
  const [dragEnd, setDragEnd] = useState<GridPoint | null>(null)
  const [draftTool, setDraftTool] = useState<ConstructionTool | null>(null)
  const [cursor, setCursor] = useState<GridPoint>({ x: 8, y: 9 })
  const rooms = useMemo(() => detectRooms(layout), [layout])

  const roomByCell = useMemo(() => {
    const map = new Map<string, (typeof rooms)[number]>()
    rooms.forEach((room) => room.cells.forEach((cell) => map.set(keyFor(cell), room)))
    return map
  }, [rooms])

  const pointerPoint = (event: ReactPointerEvent<HTMLDivElement>) => {
    const direct = pointFromElement(event.target as Element)
    if (direct) return direct
    return pointFromElement(document.elementFromPoint(event.clientX, event.clientY))
  }

  const clearDraft = () => {
    pointerIdRef.current = null
    dragStartRef.current = null
    dragEndRef.current = null
    keyboardAnchorRef.current = null
    setDragStart(null)
    setDragEnd(null)
    setDraftTool(null)
  }

  const touchCenter = () => {
    const points = [...touchPointsRef.current.values()]
    if (points.length === 0) return null
    return {
      x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
      y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
    }
  }

  const indoorFootprintError = useCallback((kind: WorkstationKind, cells: GridPoint[]) => {
    if (!WORKSTATION_SPECS[kind].indoor) return null
    const roomIds = cells.map((cell) => roomByCell.get(keyFor(cell))?.id ?? null)
    const firstRoom = roomIds[0]
    return firstRoom && roomIds.every((roomId) => roomId === firstRoom)
      ? null
      : `${WORKSTATION_SPECS[kind].label} must fit completely inside one enclosed room.`
  }, [roomByCell])

  const preview = useMemo<DraftPreview | null>(() => {
    if (!selectedTool) return null
    const point = (draftTool === selectedTool ? dragEnd : null) ?? hoverCell ?? cursor

    if (selectedTool === 'wall' || selectedTool === 'erase') {
      const start = draftTool === selectedTool ? dragStart ?? point : point
      const cells = cellsOnConstructionLine(start, point) ?? []
      const outOfBounds = cells.some((cell) => !isInConstructionBounds(cell, layout))
      const occupied = selectedTool === 'wall'
        ? cells.some((cell) => Boolean(workstationAt(layout, cell)))
        : false
      const valid = !outOfBounds && !occupied
      return {
        cells,
        valid,
        label: selectedTool === 'wall'
          ? `Wall · ${cells.length} ${cells.length === 1 ? 'tile' : 'tiles'}`
          : `Deconstruct · ${cells.length} ${cells.length === 1 ? 'tile' : 'tiles'}`,
        error: outOfBounds ? 'Outside the construction grid.' : occupied ? 'A workstation occupies this wall line.' : null,
      }
    }

    if (selectedTool === 'door') {
      const valid = boundaryAt(layout, point)?.kind === 'wall'
      return {
        cells: [point],
        valid,
        label: 'Door · 1 tile',
        error: valid ? null : 'Door needs an existing wall tile.',
      }
    }

    const input = workstationInput(selectedTool, point, rotation)
    const validation = validateWorkstationPlacement(layout, input)
    const indoorError = validation.valid
      ? indoorFootprintError(selectedTool, validation.cells)
      : null
    const footprint = getWorkstationFootprintSize({
      size: input.size,
      rotation,
    })
    return {
      cells: validation.cells,
      valid: validation.valid && !indoorError,
      label: `${WORKSTATION_SPECS[selectedTool].label} · ${footprint.width}×${footprint.height}`,
      error: validation.error ?? indoorError,
    }
  }, [cursor, draftTool, dragEnd, dragStart, hoverCell, indoorFootprintError, layout, rotation, selectedTool])

  const previewBoundaryLayout = useMemo<ConstructionLayout | null>(() => {
    if (!preview || (selectedTool !== 'wall' && selectedTool !== 'door')) return null
    const boundaries = new Map(
      layout.boundaries.map((boundary) => [keyFor(boundary), boundary]),
    )
    preview.cells
      .filter((cell) => isInConstructionBounds(cell, layout))
      .forEach((cell) => boundaries.set(keyFor(cell), { ...cell, kind: selectedTool }))
    return { ...layout, boundaries: [...boundaries.values()] }
  }, [layout, preview, selectedTool])

  const commitAt = (point: GridPoint) => {
    if (!selectedTool) return
    if (selectedTool === 'wall') {
      const start = dragStartRef.current ?? point
      onApply(paintBoundaryLine(layout, start, point, 'wall'), 'Wall')
      return
    }
    if (selectedTool === 'erase') {
      const start = dragStartRef.current ?? point
      onApply(eraseLine(layout, start, point), 'Deconstruct')
      return
    }
    if (selectedTool === 'door') {
      onApply(paintBoundaryCell(layout, point, 'door'), 'Door')
      return
    }

    const id = nextWorkstationId(layout, selectedTool)
    const input = workstationInput(selectedTool, point, rotation, id)
    const validation = validateWorkstationPlacement(layout, input)
    const indoorError = validation.valid
      ? indoorFootprintError(selectedTool, validation.cells)
      : null
    if (indoorError) {
      onError(indoorError)
      return
    }
    if (!validation.valid) {
      onError(validation.error ?? 'That workstation does not fit there.')
      return
    }
    onApply(placeWorkstation(layout, input), WORKSTATION_SPECS[selectedTool].label)
  }

  const beginPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!selectedTool || event.button !== 0) return
    if (event.pointerType === 'touch') {
      touchPointsRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
      if (touchPointsRef.current.size >= 2) {
        event.preventDefault()
        clearDraft()
        touchPanCenterRef.current = touchCenter()
        event.currentTarget.setPointerCapture?.(event.pointerId)
        return
      }
    }
    const point = pointerPoint(event)
    if (!point) return
    event.preventDefault()
    pointerIdRef.current = event.pointerId
    dragStartRef.current = point
    dragEndRef.current = point
    setHoverCell(point)
    setCursor(point)
    setDragStart(point)
    setDragEnd(point)
    setDraftTool(selectedTool)
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  const movePointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch' && touchPointsRef.current.has(event.pointerId)) {
      touchPointsRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
      if (touchPanCenterRef.current) {
        event.preventDefault()
        const nextCenter = touchCenter()
        const scrollContainer = mapRef.current?.parentElement
        if (nextCenter && scrollContainer) {
          scrollContainer.scrollLeft -= nextCenter.x - touchPanCenterRef.current.x
          scrollContainer.scrollTop -= nextCenter.y - touchPanCenterRef.current.y
          touchPanCenterRef.current = nextCenter
        }
        return
      }
    }
    const point = pointerPoint(event)
    if (!point) return
    setHoverCell(point)
    if (pointerIdRef.current !== event.pointerId) return
    dragEndRef.current = point
    setDragEnd(point)
  }

  const finishPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const wasTouchPan = event.pointerType === 'touch' && touchPanCenterRef.current !== null
    if (event.pointerType === 'touch') touchPointsRef.current.delete(event.pointerId)
    if (wasTouchPan) {
      if (touchPointsRef.current.size < 2) touchPanCenterRef.current = null
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
      return
    }
    if (pointerIdRef.current !== event.pointerId || !selectedTool) return
    const point = pointerPoint(event) ?? dragEndRef.current ?? dragStartRef.current
    if (point) commitAt(point)
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    clearDraft()
  }

  const cancelPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch') touchPointsRef.current.delete(event.pointerId)
    if (touchPointsRef.current.size < 2) touchPanCenterRef.current = null
    if (pointerIdRef.current !== null) onError('Draft cancelled.')
    clearDraft()
  }

  const commitKeyboardDraft = (point: GridPoint) => {
    if (!selectedTool) return
    if (selectedTool === 'wall' || selectedTool === 'erase') {
      if (!keyboardAnchorRef.current || draftTool !== selectedTool) {
        keyboardAnchorRef.current = point
        setDragStart(point)
        setDragEnd(point)
        setDraftTool(selectedTool)
        return
      }
      dragStartRef.current = keyboardAnchorRef.current
      commitAt(point)
      keyboardAnchorRef.current = null
      clearDraft()
      return
    }
    commitAt(point)
  }

  const handleKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const movement: Record<string, GridPoint> = {
      ArrowUp: { x: 0, y: -1 },
      ArrowRight: { x: 1, y: 0 },
      ArrowDown: { x: 0, y: 1 },
      ArrowLeft: { x: -1, y: 0 },
    }
    if (movement[event.key]) {
      event.preventDefault()
      const next = {
        x: Math.min(layout.width - 1, Math.max(0, cursor.x + movement[event.key].x)),
        y: Math.min(layout.height - 1, Math.max(0, cursor.y + movement[event.key].y)),
      }
      setCursor(next)
      setHoverCell(next)
      if (keyboardAnchorRef.current && draftTool === selectedTool) setDragEnd(next)
      return
    }
    if ((event.key === 'Enter' || event.key === ' ') && selectedTool) {
      event.preventDefault()
      commitKeyboardDraft(cursor)
      return
    }
    if (event.key.toLowerCase() === 'r' && isWorkstationTool(selectedTool)) {
      event.preventDefault()
      onRotate()
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      keyboardAnchorRef.current = null
      clearDraft()
      onCancelTool()
      return
    }
    if (event.key.toLowerCase() === 'z' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault()
      onUndo()
    }
  }

  useEffect(() => {
    if (selectedTool) mapRef.current?.focus()
  }, [selectedTool])

  const cursorStyle: CSSProperties = {
    gridColumn: `${cursor.x + 1}`,
    gridRow: `${cursor.y + 1}`,
  }

  const previewEndpoint = preview?.cells.at(-1) ?? hoverCell ?? cursor
  const cursorBoundary = boundaryAt(layout, cursor)
  const cursorWorkstation = workstationAt(layout, cursor)
  const cursorRoom = roomByCell.get(keyFor(cursor))
  const cursorContents = cursorBoundary
    ? cursorBoundary.kind === 'door' ? 'Door.' : 'Wall.'
    : cursorWorkstation
      ? `${cursorWorkstation.label}.`
      : cursorRoom
        ? `Room ${cursorRoom.id.replace('room-', '')} floor.`
        : 'Open lunar ground.'
  const cursorStatus = [
    `Column ${cursor.x + 1}, row ${cursor.y + 1}.`,
    cursorContents,
    selectedTool && preview
      ? preview.valid
        ? `Valid ${preview.label}.`
        : `Invalid placement. ${preview.error ?? ''}`
      : '',
  ].filter(Boolean).join(' ')

  return (
    <>
      <p className="sr-only" id="construction-grid-help">
        Choose a build tool, then point and drag on the map. Arrow keys move the grid cursor.
        Space starts and finishes a wall line. Enter places an object. R rotates. Escape cancels.
      </p>
      <p aria-atomic="true" aria-live="polite" className="sr-only" id="construction-grid-status" role="status">
        {cursorStatus}
      </p>
      <div
        aria-describedby="construction-grid-help construction-grid-status"
        aria-label={`Freeform construction grid, ${layout.width} columns by ${layout.height} rows. ${rooms.length} ${rooms.length === 1 ? 'room' : 'rooms'}.`}
        aria-roledescription="freeform tile construction grid"
        className={`construction-map ${selectedTool ? 'tool-active' : 'pan-active'}`}
        data-grid-height={layout.height}
        data-grid-width={layout.width}
        onContextMenu={(event) => {
          event.preventDefault()
          onCancelTool()
        }}
        onKeyDown={handleKeyboard}
        onPointerCancel={cancelPointer}
        onPointerDown={beginPointer}
        onPointerLeave={() => {
          if (pointerIdRef.current === null) setHoverCell(null)
        }}
        onPointerMove={movePointer}
        onPointerUp={finishPointer}
        ref={mapRef}
        role="group"
        style={{
          gridTemplateColumns: `repeat(${layout.width}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${layout.height}, minmax(0, 1fr))`,
        }}
        tabIndex={0}
      >
        {Array.from({ length: layout.width * layout.height }, (_, index) => {
          const x = index % layout.width
          const y = Math.floor(index / layout.width)
          return (
            <span
              aria-hidden="true"
              className="construction-cell"
              data-construction-cell
              data-grid-x={x}
              data-grid-y={y}
              key={`terrain-${x}-${y}`}
              style={{ gridColumn: `${x + 1}`, gridRow: `${y + 1}` }}
            />
          )
        })}

        {rooms.flatMap((room) => room.cells.map((cell) => (
          <span
            aria-hidden="true"
            className="construction-room-floor"
            data-grid-x={cell.x}
            data-grid-y={cell.y}
            data-room-id={room.id}
            key={`${room.id}-${cell.x}-${cell.y}`}
            style={{ gridColumn: `${cell.x + 1}`, gridRow: `${cell.y + 1}` }}
          />
        )))}

        {layout.boundaries.map((boundary) => {
          const connection = getBoundaryConnection(layout, boundary)
          return (
            <span
              aria-hidden="true"
              className={`construction-boundary boundary-${boundary.kind} ${connection.className} ${boundary.kind === 'door' ? `door-${getBoundaryDoorAxis(connection.mask)}` : ''}`}
              data-boundary-connection={connection.name}
              data-boundary-mask={connection.mask}
              data-connect-east={connection.mask & BOUNDARY_CONNECTION_BITS.east ? 'true' : undefined}
              data-connect-north={connection.mask & BOUNDARY_CONNECTION_BITS.north ? 'true' : undefined}
              data-connect-south={connection.mask & BOUNDARY_CONNECTION_BITS.south ? 'true' : undefined}
              data-connect-west={connection.mask & BOUNDARY_CONNECTION_BITS.west ? 'true' : undefined}
              data-grid-x={boundary.x}
              data-grid-y={boundary.y}
              data-tile-kind={boundary.kind}
              key={`boundary-${boundary.x}-${boundary.y}`}
              style={{ gridColumn: `${boundary.x + 1}`, gridRow: `${boundary.y + 1}` }}
            >
              <i />
            </span>
          )
        })}

        {layout.workstations.map((workstation) => {
          const kind = workstation.type as WorkstationKind
          const spec = WORKSTATION_SPECS[kind]
          const footprint = getWorkstationFootprintSize(workstation)
          if (!spec) return null
          return (
            <span
              aria-label={`${workstation.label}, ${footprint.width} by ${footprint.height} tiles`}
              className={`construction-workstation workstation-${kind}`}
              data-grid-height={footprint.height}
              data-grid-width={footprint.width}
              data-grid-x={workstation.origin.x}
              data-grid-y={workstation.origin.y}
              data-workstation-id={workstation.id}
              data-workstation-kind={kind}
              key={workstation.id}
              role="img"
              style={{
                gridColumn: `${workstation.origin.x + 1} / span ${footprint.width}`,
                gridRow: `${workstation.origin.y + 1} / span ${footprint.height}`,
              }}
            >
              <span className="workstation-art"><GameIcon name={spec.icon} /></span>
              <strong>{spec.shortLabel}</strong>
              <small>{footprint.width}×{footprint.height}</small>
            </span>
          )
        })}

        <span aria-label="Amina Okafor" className="construction-pawn pawn-amina" role="img">
          <PawnSprite accent="#a75b4c" initials="AO" size="compact" variant="umber" />
          <small className="construction-pawn-label">Amina</small>
        </span>
        <span aria-label="Mateo Alvarez" className="construction-pawn pawn-mateo" role="img">
          <PawnSprite accent="#527b7d" initials="MA" size="compact" variant="gold" />
          <small className="construction-pawn-label">Mateo</small>
        </span>

        {rooms.map((room) => {
          const labelCell = room.cells[Math.floor(room.cells.length / 2)]
          return (
            <span
              aria-hidden="true"
              className="construction-room-label"
              key={`label-${room.id}`}
              style={{ gridColumn: `${labelCell.x + 1}`, gridRow: `${labelCell.y + 1}` }}
            >
              Room {room.id.replace('room-', '')} · {room.area}
            </span>
          )
        })}

        {selectedTool && preview?.cells
          .filter((cell) => isInConstructionBounds(cell, layout))
          .map((cell) => {
            const connection = previewBoundaryLayout
              ? getBoundaryConnection(previewBoundaryLayout, cell)
              : null
            const boundaryPreview = connection && (selectedTool === 'wall' || selectedTool === 'door')
            return (
              <span
                aria-hidden="true"
                className={`construction-preview ${preview.valid ? 'valid' : 'invalid'} preview-${selectedTool} ${boundaryPreview ? `construction-boundary boundary-${selectedTool} ${connection.className} ${selectedTool === 'door' ? `door-${getBoundaryDoorAxis(connection.mask)}` : ''}` : ''}`}
                data-boundary-connection={connection?.name}
                data-boundary-mask={connection?.mask}
                data-connect-east={connection && connection.mask & BOUNDARY_CONNECTION_BITS.east ? 'true' : undefined}
                data-connect-north={connection && connection.mask & BOUNDARY_CONNECTION_BITS.north ? 'true' : undefined}
                data-connect-south={connection && connection.mask & BOUNDARY_CONNECTION_BITS.south ? 'true' : undefined}
                data-connect-west={connection && connection.mask & BOUNDARY_CONNECTION_BITS.west ? 'true' : undefined}
                data-grid-x={cell.x}
                data-grid-y={cell.y}
                data-preview-kind={selectedTool}
                key={`preview-${cell.x}-${cell.y}`}
                style={{ gridColumn: `${cell.x + 1}`, gridRow: `${cell.y + 1}` }}
              >
                {boundaryPreview && <i />}
              </span>
            )
          })}

        <span aria-hidden="true" className="construction-cursor" style={cursorStyle} />

        {selectedTool && preview && previewEndpoint && (
          <span
            aria-hidden="true"
            className={`construction-draft-label ${preview.valid ? '' : 'invalid'}`}
            style={{ gridColumn: `${previewEndpoint.x + 1}`, gridRow: `${previewEndpoint.y + 1}` }}
          >
            {preview.error ?? preview.label}
          </span>
        )}

        <span aria-hidden="true" className="construction-north">N<i /></span>
        <span aria-hidden="true" className="construction-scale">20 m</span>
        <span aria-hidden="true" className="construction-grid-shade" />
      </div>
    </>
  )
}
