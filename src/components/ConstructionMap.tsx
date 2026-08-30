import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
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
import type { ConstructionOrder } from '../game/constructionJobs'
import type { CrewMember } from '../game/types'
import {
  BOUNDARY_CONNECTION_BITS,
  getBoundaryConnection,
  getBoundaryDoorAxis,
} from '../game/boundaryConnections'
import { GameIcon } from './GameIcon'
import { PawnSprite } from './PawnSprite'

interface ConstructionMapProps {
  layout: ConstructionLayout
  planningLayout?: ConstructionLayout
  constructionOrders?: readonly ConstructionOrder[]
  crew?: readonly CrewMember[]
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

interface ZoomAnchor {
  clientX: number
  clientY: number
  mapX: number
  mapY: number
}

const MIN_ZOOM = 0.7
const MAX_ZOOM = 1.8
const ZOOM_STEP = 0.1

const clampZoom = (zoom: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))

const constructionProgress = (order: ConstructionOrder) => {
  const haulingShare = order.materials.required > 0 ? 0.35 : 0
  const hauling = order.materials.required > 0
    ? Math.min(1, order.materials.delivered / order.materials.required) * haulingShare
    : 0
  const building = order.work.required > 0
    ? Math.min(1, order.work.completed / order.work.required) * (1 - haulingShare)
    : 1 - haulingShare
  return Math.round(Math.min(1, hauling + building) * 100)
}

const constructionOrderLabel = (order: ConstructionOrder) => {
  if (order.target.kind === 'boundary') {
    const boundary = order.target.construct ?? order.target.deconstruct
    return order.operation === 'deconstruct'
      ? `Deconstruct ${boundary?.kind ?? 'boundary'}`
      : boundary?.kind === 'door' ? 'Door' : 'Wall'
  }
  const workstation = order.target.construct ?? order.target.deconstruct
  return order.operation === 'deconstruct'
    ? `Deconstruct ${workstation?.label ?? 'workstation'}`
    : workstation?.label ?? 'Workstation'
}

const workerVariants = ['umber', 'gold', 'olive', 'rose', 'copper', 'slate'] as const
const workerAccents = ['#a75b4c', '#527b7d', '#68805f', '#8a6378', '#9a7046', '#596f7c']

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
  planningLayout = layout,
  constructionOrders = [],
  crew = [],
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
  const panPointerIdRef = useRef<number | null>(null)
  const panLastPointRef = useRef<PointerPosition | null>(null)
  const zoomAnchorRef = useRef<ZoomAnchor | null>(null)
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
  const [isPanning, setIsPanning] = useState(false)
  const [zoom, setZoom] = useState(1)
  const rooms = useMemo(() => detectRooms(layout), [layout])
  const plannedRooms = useMemo(() => detectRooms(planningLayout), [planningLayout])

  const roomByCell = useMemo(() => {
    const map = new Map<string, (typeof rooms)[number]>()
    plannedRooms.forEach((room) => room.cells.forEach((cell) => map.set(keyFor(cell), room)))
    return map
  }, [plannedRooms])

  const openOrders = useMemo(
    () => constructionOrders.filter((order) => order.status !== 'complete'),
    [constructionOrders],
  )

  const assignedOrderByCrew = useMemo(() => {
    const byCrew = new Map<string, ConstructionOrder>()
    openOrders.forEach((order) => {
      if (order.assignedCrewId && !byCrew.has(order.assignedCrewId)) {
        byCrew.set(order.assignedCrewId, order)
      }
    })
    return byCrew
  }, [openOrders])

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

  const scrollContainer = () => mapRef.current?.closest<HTMLElement>('.construction-map-scroll') ?? null

  const beginPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    panPointerIdRef.current = event.pointerId
    panLastPointRef.current = { x: event.clientX, y: event.clientY }
    setIsPanning(true)
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  const endPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (panPointerIdRef.current !== event.pointerId) return false
    panPointerIdRef.current = null
    panLastPointRef.current = null
    setIsPanning(false)
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    return true
  }

  const setZoomAround = (nextZoom: number, clientX: number, clientY: number) => {
    const map = mapRef.current
    if (!map) return
    const rect = map.getBoundingClientRect()
    zoomAnchorRef.current = {
      clientX,
      clientY,
      mapX: rect.width ? (clientX - rect.left) / rect.width : 0.5,
      mapY: rect.height ? (clientY - rect.top) / rect.height : 0.5,
    }
    setZoom(clampZoom(nextZoom))
  }

  const zoomFromViewportCenter = (direction: -1 | 1) => {
    const container = scrollContainer()
    if (!container) return
    const rect = container.getBoundingClientRect()
    setZoomAround(
      Math.round((zoom + direction * ZOOM_STEP) * 10) / 10,
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
    )
  }

  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (event.deltaY === 0) return
    event.preventDefault()
    const factor = Math.exp(-event.deltaY * 0.0015)
    setZoomAround(zoom * factor, event.clientX, event.clientY)
  }

  useLayoutEffect(() => {
    const anchor = zoomAnchorRef.current
    const map = mapRef.current
    const container = scrollContainer()
    if (!anchor || !map || !container) return
    zoomAnchorRef.current = null
    const rect = map.getBoundingClientRect()
    container.scrollLeft += rect.left + rect.width * anchor.mapX - anchor.clientX
    container.scrollTop += rect.top + rect.height * anchor.mapY - anchor.clientY
  }, [zoom])

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
      const outOfBounds = cells.some((cell) => !isInConstructionBounds(cell, planningLayout))
      const occupied = selectedTool === 'wall'
        ? cells.some((cell) => Boolean(workstationAt(planningLayout, cell)))
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
      const valid = boundaryAt(planningLayout, point)?.kind === 'wall'
      return {
        cells: [point],
        valid,
        label: 'Door · 1 tile',
        error: valid ? null : 'Door needs an existing wall tile.',
      }
    }

    const input = workstationInput(selectedTool, point, rotation)
    const validation = validateWorkstationPlacement(planningLayout, input)
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
  }, [cursor, draftTool, dragEnd, dragStart, hoverCell, indoorFootprintError, planningLayout, rotation, selectedTool])

  const previewBoundaryLayout = useMemo<ConstructionLayout | null>(() => {
    if (!preview || (selectedTool !== 'wall' && selectedTool !== 'door')) return null
    const boundaries = new Map(
      planningLayout.boundaries.map((boundary) => [keyFor(boundary), boundary]),
    )
    preview.cells
      .filter((cell) => isInConstructionBounds(cell, planningLayout))
      .forEach((cell) => boundaries.set(keyFor(cell), { ...cell, kind: selectedTool }))
    return { ...planningLayout, boundaries: [...boundaries.values()] }
  }, [planningLayout, preview, selectedTool])

  const commitAt = (point: GridPoint) => {
    if (!selectedTool) return
    if (selectedTool === 'wall') {
      const start = dragStartRef.current ?? point
      onApply(paintBoundaryLine(planningLayout, start, point, 'wall'), 'Wall')
      return
    }
    if (selectedTool === 'erase') {
      const start = dragStartRef.current ?? point
      onApply(eraseLine(planningLayout, start, point), 'Deconstruct')
      return
    }
    if (selectedTool === 'door') {
      onApply(paintBoundaryCell(planningLayout, point, 'door'), 'Door')
      return
    }

    const id = nextWorkstationId(planningLayout, selectedTool)
    const input = workstationInput(selectedTool, point, rotation, id)
    const validation = validateWorkstationPlacement(planningLayout, input)
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
    onApply(placeWorkstation(planningLayout, input), WORKSTATION_SPECS[selectedTool].label)
  }

  const beginPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch') {
      touchPointsRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
      if (touchPointsRef.current.size >= 2) {
        event.preventDefault()
        clearDraft()
        panPointerIdRef.current = null
        panLastPointRef.current = null
        setIsPanning(true)
        touchPanCenterRef.current = touchCenter()
        event.currentTarget.setPointerCapture?.(event.pointerId)
        return
      }
    }
    const panButton = (!selectedTool && event.button === 0) || (selectedTool && event.button === 1)
    if (panButton) {
      beginPan(event)
      return
    }
    if (!selectedTool || event.button !== 0) return
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
        const container = scrollContainer()
        if (nextCenter && container) {
          container.scrollLeft -= nextCenter.x - touchPanCenterRef.current.x
          container.scrollTop -= nextCenter.y - touchPanCenterRef.current.y
          touchPanCenterRef.current = nextCenter
        }
        return
      }
    }
    if (panPointerIdRef.current === event.pointerId) {
      event.preventDefault()
      const previous = panLastPointRef.current
      const container = scrollContainer()
      if (previous && container) {
        container.scrollLeft -= event.clientX - previous.x
        container.scrollTop -= event.clientY - previous.y
      }
      panLastPointRef.current = { x: event.clientX, y: event.clientY }
      return
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
      if (touchPointsRef.current.size < 2) {
        touchPanCenterRef.current = null
        setIsPanning(false)
      }
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
      return
    }
    if (endPan(event)) return
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
    if (touchPointsRef.current.size < 2) {
      touchPanCenterRef.current = null
      setIsPanning(false)
    }
    endPan(event)
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
  const cursorOrder = openOrders.find((order) =>
    order.target.cells.some((cell) => cell.x === cursor.x && cell.y === cursor.y),
  )
  const cursorRoom = roomByCell.get(keyFor(cursor))
  const cursorContents = cursorBoundary
    ? cursorBoundary.kind === 'door' ? 'Door.' : 'Wall.'
    : cursorWorkstation
      ? `${cursorWorkstation.label}.`
      : cursorOrder
        ? `${constructionOrderLabel(cursorOrder)} blueprint, ${cursorOrder.status}.`
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
        aria-label="Construction map zoom controls"
        className="construction-zoom-controls"
        onPointerDown={(event) => event.stopPropagation()}
        role="group"
      >
        <button
          aria-label="Zoom out construction map"
          disabled={zoom <= MIN_ZOOM}
          onClick={() => zoomFromViewportCenter(-1)}
          title="Zoom out"
          type="button"
        >−</button>
        <span aria-label="Construction map zoom" className="construction-zoom-value">{Math.round(zoom * 100)}%</span>
        <button
          aria-label="Zoom in construction map"
          disabled={zoom >= MAX_ZOOM}
          onClick={() => zoomFromViewportCenter(1)}
          title="Zoom in"
          type="button"
        >+</button>
      </div>
      <div
        aria-describedby="construction-grid-help construction-grid-status"
        aria-label={`Freeform construction grid, ${layout.width} columns by ${layout.height} rows. ${rooms.length} ${rooms.length === 1 ? 'room' : 'rooms'}.`}
        aria-roledescription="freeform tile construction grid"
        className={`construction-map ${selectedTool ? 'tool-active' : 'pan-active'} ${isPanning ? 'is-panning' : ''}`}
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
        onWheel={handleWheel}
        ref={mapRef}
        role="group"
        style={{
          gridTemplateColumns: `repeat(${layout.width}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${layout.height}, minmax(0, 1fr))`,
          '--construction-zoom': zoom,
        } as CSSProperties}
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

        {openOrders.map((order) => {
          const progress = constructionProgress(order)
          if (order.target.kind === 'boundary') {
            const cell = order.target.cells[0]
            const boundary = order.target.construct ?? order.target.deconstruct
            if (!boundary) return null
            const connectionLayout = order.target.construct ? planningLayout : layout
            const connection = getBoundaryConnection(connectionLayout, cell)
            return (
              <span
                aria-label={`${constructionOrderLabel(order)} blueprint, ${order.status}, ${progress} percent`}
                className={`construction-blueprint construction-blueprint-boundary construction-boundary boundary-${boundary.kind} blueprint-${order.operation} status-${order.status} ${connection.className} ${boundary.kind === 'door' ? `door-${getBoundaryDoorAxis(connection.mask)}` : ''}`}
                data-boundary-connection={connection.name}
                data-boundary-mask={connection.mask}
                data-connect-east={connection.mask & BOUNDARY_CONNECTION_BITS.east ? 'true' : undefined}
                data-connect-north={connection.mask & BOUNDARY_CONNECTION_BITS.north ? 'true' : undefined}
                data-connect-south={connection.mask & BOUNDARY_CONNECTION_BITS.south ? 'true' : undefined}
                data-connect-west={connection.mask & BOUNDARY_CONNECTION_BITS.west ? 'true' : undefined}
                data-construction-order-id={order.id}
                data-construction-order-status={order.status}
                data-grid-x={cell.x}
                data-grid-y={cell.y}
                key={order.id}
                role="img"
                style={{ gridColumn: `${cell.x + 1}`, gridRow: `${cell.y + 1}` }}
              >
                <i />
                <b className="construction-job-progress"><i style={{ width: `${progress}%` }} /></b>
              </span>
            )
          }

          const workstation = order.target.construct ?? order.target.deconstruct
          if (!workstation) return null
          const kind = workstation.type as WorkstationKind
          const spec = WORKSTATION_SPECS[kind]
          const footprint = getWorkstationFootprintSize(workstation)
          return (
            <span
              aria-label={`${constructionOrderLabel(order)} blueprint, ${order.status}, ${progress} percent`}
              className={`construction-blueprint construction-blueprint-workstation blueprint-${order.operation} status-${order.status}`}
              data-construction-order-id={order.id}
              data-construction-order-status={order.status}
              data-grid-height={footprint.height}
              data-grid-width={footprint.width}
              data-grid-x={workstation.origin.x}
              data-grid-y={workstation.origin.y}
              key={order.id}
              role="img"
              style={{
                gridColumn: `${workstation.origin.x + 1} / span ${footprint.width}`,
                gridRow: `${workstation.origin.y + 1} / span ${footprint.height}`,
              }}
            >
              <span className="blueprint-workstation-art"><GameIcon name={spec?.icon ?? 'work'} /></span>
              <strong>{order.operation === 'deconstruct' ? 'Remove' : spec?.shortLabel ?? workstation.label}</strong>
              <small>{order.status === 'hauling' ? 'Hauling' : order.status === 'blocked' ? 'Blocked' : 'Building'}</small>
              <b className="construction-job-progress"><i style={{ width: `${progress}%` }} /></b>
            </span>
          )
        })}

        {!assignedOrderByCrew.has('crew-amina-okafor') && (
          <span aria-label="Amina Okafor, idle" className="construction-pawn pawn-amina" role="img">
            <PawnSprite accent="#a75b4c" initials="AO" size="compact" variant="umber" />
            <small className="construction-pawn-label">Amina</small>
          </span>
        )}
        {!assignedOrderByCrew.has('crew-mateo-alvarez') && (
          <span aria-label="Mateo Alvarez, idle" className="construction-pawn pawn-mateo" role="img">
            <PawnSprite accent="#527b7d" initials="MA" size="compact" variant="gold" />
            <small className="construction-pawn-label">Mateo</small>
          </span>
        )}
        {[...assignedOrderByCrew.entries()].map(([crewId, order]) => {
          const memberIndex = Math.max(0, crew.findIndex((member) => member.id === crewId))
          const member = crew[memberIndex]
          const cell = order.target.cells[0]
          const name = member?.name ?? crewId
          const workerInitials = name.split(' ').map((part) => part[0]).join('').slice(0, 2)
          return (
            <span
              aria-label={`${name}, ${order.status} ${constructionOrderLabel(order)}`}
              className={`construction-pawn construction-worker worker-${order.status}`}
              data-construction-worker-id={crewId}
              data-order-id={order.id}
              key={crewId}
              role="img"
              style={{ gridColumn: `${cell.x + 1}`, gridRow: `${cell.y + 1}` }}
            >
              <PawnSprite
                accent={workerAccents[memberIndex % workerAccents.length]}
                initials={workerInitials}
                showStatusDot
                size="compact"
                status="working"
                variant={workerVariants[memberIndex % workerVariants.length]}
              />
              <span className="construction-worker-task"><GameIcon name="work" /></span>
              <small className="construction-pawn-label">{name.split(' ')[0]}</small>
            </span>
          )
        })}

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
          .filter((cell) => isInConstructionBounds(cell, planningLayout))
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
