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
} from 'react'
import {
  boundaryAt,
  cellsOnConstructionLine,
  detectRooms,
  eraseLine,
  getWorkstationCells,
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
  BOUNDARY_SPECS,
  WORKSTATION_SPECS,
  isWorkstationTool,
  type ConstructionTool,
  type WorkstationKind,
} from '../game/constructionCatalog'
import {
  carriedConstructionMaterial,
  constructionMaterialAccountedFor,
  type ConstructionOrder,
} from '../game/constructionJobs'
import type { CrewMember } from '../game/types'
import {
  BOUNDARY_CONNECTION_BITS,
  getBoundaryConnection,
  getBoundaryDoorAxis,
} from '../game/boundaryConnections'
import { GameIcon } from './GameIcon'
import {
  constructionOrderActivity,
  type MapTileInspection,
} from './mapInspection'
import { PawnSprite } from './PawnSprite'

interface ConstructionMapProps {
  layout: ConstructionLayout
  planningLayout?: ConstructionLayout
  focusTarget?: {
    cell: GridPoint
    requestId: number
  } | null
  constructionOrders?: readonly ConstructionOrder[]
  constructionPaused?: boolean
  constructionStock?: number
  constructionStockpile?: GridPoint | null
  crew?: readonly CrewMember[]
  crewCells?: ReadonlyMap<string, GridPoint>
  selectedTool: ConstructionTool | null
  rotation: WorkstationRotation
  onApply: (result: ConstructionResult, label: string) => void
  onCancelTool: () => void
  onError: (message: string) => void
  onRotate: () => void
  onUndo: () => void
  onInspectCell?: (
    cell: GridPoint,
    anchor: PointerPosition,
    preferredItemKey?: string | null,
  ) => void
  selectedCell?: GridPoint | null
  overlapCounts?: ReadonlyMap<string, number>
  inspectionByCell?: ReadonlyMap<string, MapTileInspection>
}

interface DraftPreview {
  cells: GridPoint[]
  valid: boolean
  label: string
  warning: string | null
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
const PAN_DRAG_THRESHOLD = 6
const TOUCH_PAN_DRAG_THRESHOLD = 12
const KEYBOARD_PAN_STEP = 48
const MAX_WHEEL_ZOOM_DELTA = 240
const EDGE_PAN_ZONE = 56
const EDGE_PAN_MIN_SPEED = 180
const EDGE_PAN_MAX_SPEED = 900
const EDGE_PAN_MAX_FRAME_SECONDS = 0.05

const clampZoom = (zoom: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))

const isEditableTarget = (target: EventTarget | null) => (
  target instanceof HTMLButtonElement ||
  target instanceof HTMLInputElement ||
  target instanceof HTMLSelectElement ||
  target instanceof HTMLTextAreaElement ||
  (target instanceof HTMLElement && target.isContentEditable)
)

const constructionProgress = (order: ConstructionOrder) => {
  const haulingShare = order.materials.required > 0 ? 0.35 : 0
  const hauling = order.materials.required > 0
    ? Math.min(1, constructionMaterialAccountedFor(order) / order.materials.required) * haulingShare
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

const constructionActivityIcon = (order: ConstructionOrder) => {
  if (order.block) return 'warning' as const
  if (order.travelPhase === 'to_stockpile') return 'storage' as const
  if (order.travelPhase === 'to_site') return 'map' as const
  return 'work' as const
}

const workerVariants = ['umber', 'gold', 'olive', 'rose', 'copper', 'slate'] as const
const workerAccents = ['#a75b4c', '#527b7d', '#68805f', '#8a6378', '#9a7046', '#596f7c']

const keyFor = (point: GridPoint) => `${point.x}:${point.y}`

const materialAmount = (value: number) => {
  const rounded = Math.round(value * 10) / 10
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}

const pointFromElement = (element: Element | null): GridPoint | null => {
  const cell = element?.closest<HTMLElement>('[data-construction-cell]')
  if (!cell) return null
  const x = Number(cell.dataset.gridX)
  const y = Number(cell.dataset.gridY)
  return Number.isInteger(x) && Number.isInteger(y) ? { x, y } : null
}

const gridPointFromElement = (element: Element | null): GridPoint | null => {
  const target = element?.closest<HTMLElement>('[data-grid-x][data-grid-y]')
  if (!target) return null
  const x = Number(target.dataset.gridX)
  const y = Number(target.dataset.gridY)
  return Number.isInteger(x) && Number.isInteger(y) ? { x, y } : null
}

const inspectItemKeyFromElement = (element: Element | null) =>
  element?.closest<HTMLElement>('[data-inspect-item-key]')?.dataset.inspectItemKey ?? null

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
  focusTarget = null,
  constructionOrders = [],
  constructionPaused = false,
  constructionStock = 0,
  constructionStockpile = null,
  crew = [],
  crewCells = new Map(),
  selectedTool,
  rotation,
  onApply,
  onCancelTool,
  onError,
  onRotate,
  onUndo,
  onInspectCell,
  selectedCell = null,
  overlapCounts = new Map(),
  inspectionByCell = new Map(),
}: ConstructionMapProps) {
  const mapRef = useRef<HTMLDivElement>(null)
  const surfaceRef = useRef<HTMLDivElement>(null)
  const pointerIdRef = useRef<number | null>(null)
  const panPointerIdRef = useRef<number | null>(null)
  const panLastPointRef = useRef<PointerPosition | null>(null)
  const panStartPointRef = useRef<PointerPosition | null>(null)
  const panStartCellRef = useRef<GridPoint | null>(null)
  const panPointerTypeRef = useRef('mouse')
  const panStartInspectItemKeyRef = useRef<string | null>(null)
  const panButtonRef = useRef<number | null>(null)
  const panMovedRef = useRef(false)
  const panInspectsStationaryPointerRef = useRef(true)
  const cameraInitializedRef = useRef(false)
  const handledFocusRequestRef = useRef<number | null>(null)
  const zoomAnchorRef = useRef<ZoomAnchor | null>(null)
  const zoomRef = useRef(1)
  const dragStartRef = useRef<GridPoint | null>(null)
  const dragEndRef = useRef<GridPoint | null>(null)
  const draftPointerStartRef = useRef<PointerPosition | null>(null)
  const draftDraggingRef = useRef(false)
  const cancelledDraftPointerIdRef = useRef<number | null>(null)
  const keyboardAnchorRef = useRef<GridPoint | null>(null)
  const spacePressedRef = useRef(false)
  const touchPointsRef = useRef(new Map<number, PointerPosition>())
  const touchPanCenterRef = useRef<PointerPosition | null>(null)
  const touchPinchDistanceRef = useRef<number | null>(null)
  const touchPinchZoomRef = useRef(1)
  const touchGestureFrameRef = useRef<number | null>(null)
  const edgePanPointerRef = useRef<PointerPosition | null>(null)
  const edgePanFrameRef = useRef<number | null>(null)
  const edgePanLastTimestampRef = useRef<number | null>(null)
  const edgePanStepRef = useRef<(timestamp: number) => void>(() => undefined)
  const [hoverCell, setHoverCell] = useState<GridPoint | null>({ x: 8, y: 9 })
  const [dragStart, setDragStart] = useState<GridPoint | null>(null)
  const [dragEnd, setDragEnd] = useState<GridPoint | null>(null)
  const [draftTool, setDraftTool] = useState<ConstructionTool | null>(null)
  const [cursor, setCursor] = useState<GridPoint>({ x: 8, y: 9 })
  const [isPanning, setIsPanning] = useState(false)
  const [isEdgePanning, setIsEdgePanning] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [previewLabelAnchor, setPreviewLabelAnchor] = useState<{
    horizontal: 'start' | 'end'
    vertical: 'above' | 'below'
  }>({ horizontal: 'start', vertical: 'above' })
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
    return pointAtClient({ x: event.clientX, y: event.clientY })
      ?? gridPointFromElement(event.target as Element)
  }

  const scrollContainer = () => mapRef.current?.closest<HTMLElement>('.construction-map-scroll') ?? null

  const pointAtClient = ({ x, y }: PointerPosition) => {
    const map = mapRef.current
    const bounds = map?.getBoundingClientRect()
    if (bounds && bounds.width > 0 && bounds.height > 0) {
      if (x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom) {
        return null
      }
      return {
        x: Math.min(
          layout.width - 1,
          Math.max(0, Math.floor(((x - bounds.left) / bounds.width) * layout.width)),
        ),
        y: Math.min(
          layout.height - 1,
          Math.max(0, Math.floor(((y - bounds.top) / bounds.height) * layout.height)),
        ),
      }
    }
    return typeof document.elementFromPoint === 'function'
      ? pointFromElement(document.elementFromPoint(x, y))
      : null
  }

  const stopEdgePan = useCallback(() => {
    edgePanPointerRef.current = null
    edgePanLastTimestampRef.current = null
    if (edgePanFrameRef.current !== null) {
      cancelAnimationFrame(edgePanFrameRef.current)
      edgePanFrameRef.current = null
    }
    setIsEdgePanning(false)
  }, [])

  const edgePanVelocity = (position: number, start: number, end: number) => {
    if (position < start || position > end) return 0
    const distanceFromStart = position - start
    const distanceFromEnd = end - position
    const proximity = distanceFromStart < EDGE_PAN_ZONE
      ? -(EDGE_PAN_ZONE - distanceFromStart) / EDGE_PAN_ZONE
      : distanceFromEnd < EDGE_PAN_ZONE
        ? (EDGE_PAN_ZONE - distanceFromEnd) / EDGE_PAN_ZONE
        : 0
    if (proximity === 0) return 0
    const speed = EDGE_PAN_MIN_SPEED +
      (EDGE_PAN_MAX_SPEED - EDGE_PAN_MIN_SPEED) * Math.abs(proximity)
    return Math.sign(proximity) * speed
  }

  const scheduleEdgePan = () => {
    if (edgePanFrameRef.current !== null) return
    edgePanFrameRef.current = requestAnimationFrame((timestamp) => edgePanStepRef.current(timestamp))
  }

  const runEdgePanFrame = (timestamp: number) => {
    edgePanFrameRef.current = null
    const pointer = edgePanPointerRef.current
    const container = scrollContainer()
    const isLineDraft = selectedTool === 'wall' || selectedTool === 'erase'
    if (
      !pointer ||
      !container ||
      !isLineDraft ||
      !draftDraggingRef.current ||
      pointerIdRef.current === null
    ) {
      setIsEdgePanning(false)
      return
    }

    const previousTimestamp = edgePanLastTimestampRef.current
    edgePanLastTimestampRef.current = timestamp
    if (previousTimestamp === null) {
      scheduleEdgePan()
      return
    }

    const viewport = container.getBoundingClientRect()
    if (viewport.width <= 0 || viewport.height <= 0) {
      setIsEdgePanning(false)
      return
    }
    const frameSeconds = Math.min(
      EDGE_PAN_MAX_FRAME_SECONDS,
      Math.max(0, (timestamp - previousTimestamp) / 1000),
    )
    const mapBounds = mapRef.current?.getBoundingClientRect()
    let deltaX = edgePanVelocity(pointer.x, viewport.left, viewport.right) * frameSeconds
    let deltaY = edgePanVelocity(pointer.y, viewport.top, viewport.bottom) * frameSeconds
    if (mapBounds && mapBounds.width > 0 && mapBounds.height > 0) {
      if (deltaX > 0) deltaX = Math.min(deltaX, Math.max(0, mapBounds.right - pointer.x))
      else if (deltaX < 0) deltaX = Math.max(deltaX, Math.min(0, mapBounds.left - pointer.x))
      if (deltaY > 0) deltaY = Math.min(deltaY, Math.max(0, mapBounds.bottom - pointer.y))
      else if (deltaY < 0) deltaY = Math.max(deltaY, Math.min(0, mapBounds.top - pointer.y))
    }
    if (deltaX === 0 && deltaY === 0) {
      edgePanLastTimestampRef.current = null
      setIsEdgePanning(false)
      return
    }

    const previousLeft = container.scrollLeft
    const previousTop = container.scrollTop
    container.scrollLeft += deltaX
    container.scrollTop += deltaY
    const moved = container.scrollLeft !== previousLeft || container.scrollTop !== previousTop
    setIsEdgePanning(moved)
    if (!moved) {
      edgePanLastTimestampRef.current = null
      return
    }

    const point = pointAtClient(pointer)
    if (point) {
      dragEndRef.current = point
      setHoverCell(point)
      setDragEnd(point)
    }
    scheduleEdgePan()
  }

  useLayoutEffect(() => {
    edgePanStepRef.current = runEdgePanFrame
  })

  const clearDraft = () => {
    stopEdgePan()
    pointerIdRef.current = null
    dragStartRef.current = null
    dragEndRef.current = null
    draftPointerStartRef.current = null
    draftDraggingRef.current = false
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

  const touchDistance = () => {
    const [first, second] = [...touchPointsRef.current.values()]
    if (!first || !second) return null
    return Math.hypot(second.x - first.x, second.y - first.y)
  }

  const revealKeyboardCell = (point: GridPoint) => {
    const container = scrollContainer()
    const cell = mapRef.current?.querySelector<HTMLElement>(
      `[data-construction-cell][data-grid-x="${point.x}"][data-grid-y="${point.y}"]`,
    )
    if (!container || !cell) return

    const viewport = container.getBoundingClientRect()
    const cellBounds = cell.getBoundingClientRect()
    if (viewport.width <= 0 || viewport.height <= 0 || cellBounds.width <= 0 || cellBounds.height <= 0) return

    const inset = Math.min(24, viewport.width / 4, viewport.height / 4)
    const leftEdge = viewport.left + inset
    const rightEdge = viewport.right - inset
    const topEdge = viewport.top + inset
    const bottomEdge = viewport.bottom - inset

    if (cellBounds.left < leftEdge) container.scrollLeft += cellBounds.left - leftEdge
    else if (cellBounds.right > rightEdge) container.scrollLeft += cellBounds.right - rightEdge

    if (cellBounds.top < topEdge) container.scrollTop += cellBounds.top - topEdge
    else if (cellBounds.bottom > bottomEdge) container.scrollTop += cellBounds.bottom - bottomEdge
  }

  const panCameraBy = (deltaX: number, deltaY: number) => {
    const container = scrollContainer()
    if (!container) return
    container.scrollLeft += deltaX
    container.scrollTop += deltaY
  }

  const updatePreviewLabelAnchor = useCallback((clientX: number, clientY: number) => {
    const viewport = mapRef.current
      ?.closest<HTMLElement>('.construction-map-scroll')
      ?.getBoundingClientRect()
    const right = viewport?.right ?? window.innerWidth
    const top = viewport?.top ?? 0
    const bottom = viewport?.bottom ?? window.innerHeight
    const next = {
      horizontal: clientX > right - 210 ? 'end' as const : 'start' as const,
      vertical: clientY < top + 70 || clientY > bottom
        ? 'below' as const
        : 'above' as const,
    }
    setPreviewLabelAnchor((current) => (
      current.horizontal === next.horizontal && current.vertical === next.vertical
        ? current
        : next
    ))
  }, [])

  const beginPan = (
    event: ReactPointerEvent<HTMLDivElement>,
    inspectStationaryPointer = true,
    panButton = event.button,
  ) => {
    event.preventDefault()
    mapRef.current?.focus({ preventScroll: true })
    panPointerIdRef.current = event.pointerId
    panLastPointRef.current = { x: event.clientX, y: event.clientY }
    panStartPointRef.current = { x: event.clientX, y: event.clientY }
    panStartCellRef.current = pointerPoint(event)
    panPointerTypeRef.current = event.pointerType
    panButtonRef.current = panButton
    panStartInspectItemKeyRef.current = inspectStationaryPointer
      ? inspectItemKeyFromElement(event.target as Element)
      : null
    panMovedRef.current = false
    panInspectsStationaryPointerRef.current = inspectStationaryPointer
    setIsPanning(true)
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  const endPan = (
    event: ReactPointerEvent<HTMLDivElement>,
    inspectStationaryPointer = panInspectsStationaryPointerRef.current,
  ) => {
    if (panPointerIdRef.current !== event.pointerId) return false
    const clicked = !panMovedRef.current
    const completedPanButton = panButtonRef.current
    const completedPanMoved = panMovedRef.current
    const inspectedCell = clicked
      ? panStartCellRef.current ?? pointerPoint(event)
      : null
    const preferredItemKey = panStartInspectItemKeyRef.current
    panPointerIdRef.current = null
    panLastPointRef.current = null
    panStartPointRef.current = null
    panStartCellRef.current = null
    panPointerTypeRef.current = 'mouse'
    panButtonRef.current = null
    panStartInspectItemKeyRef.current = null
    panMovedRef.current = false
    panInspectsStationaryPointerRef.current = true
    setIsPanning(false)
    if (completedPanButton === 2 && !completedPanMoved && selectedTool) {
      onCancelTool()
    }
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    if (inspectStationaryPointer && clicked && inspectedCell && onInspectCell) {
      setCursor(inspectedCell)
      setHoverCell(inspectedCell)
      if (preferredItemKey) {
        onInspectCell(
          inspectedCell,
          { x: event.clientX, y: event.clientY },
          preferredItemKey,
        )
      } else {
        onInspectCell(inspectedCell, { x: event.clientX, y: event.clientY })
      }
    }
    return true
  }

  const centerMapInViewport = useCallback(() => {
    const container = scrollContainer()
    const map = mapRef.current
    if (!container || !map) return
    const occupiedCells = [
      ...layout.boundaries,
      ...layout.workstations.flatMap(getWorkstationCells),
    ]
    const focus = occupiedCells.length > 0
      ? {
          x: occupiedCells.reduce((sum, cell) => sum + cell.x, 0) / occupiedCells.length,
          y: occupiedCells.reduce((sum, cell) => sum + cell.y, 0) / occupiedCells.length,
        }
      : { x: (layout.width - 1) / 2, y: (layout.height - 1) / 2 }
    const focusLeft = map.offsetLeft + ((focus.x + 0.5) / layout.width) * map.offsetWidth
    const focusTop = map.offsetTop + ((focus.y + 0.5) / layout.height) * map.offsetHeight
    container.scrollLeft = Math.max(0, focusLeft - container.clientWidth / 2)
    container.scrollTop = Math.max(0, focusTop - container.clientHeight / 2)
  }, [layout])

  const centerCellInViewport = useCallback((point: GridPoint) => {
    const map = mapRef.current
    const container = map?.closest<HTMLElement>('.construction-map-scroll') ?? null
    const cell = map?.querySelector<HTMLElement>(
      `[data-construction-cell][data-grid-x="${point.x}"][data-grid-y="${point.y}"]`,
    )
    if (!container || !cell) return

    const viewport = container.getBoundingClientRect()
    const cellBounds = cell.getBoundingClientRect()
    if (viewport.width <= 0 || viewport.height <= 0 || cellBounds.width <= 0 || cellBounds.height <= 0) return

    container.scrollLeft += cellBounds.left + cellBounds.width / 2
      - (viewport.left + viewport.width / 2)
    container.scrollTop += cellBounds.top + cellBounds.height / 2
      - (viewport.top + viewport.height / 2)
  }, [])

  const resetView = () => {
    zoomAnchorRef.current = null
    zoomRef.current = 1
    setZoom(1)
    requestAnimationFrame(() => requestAnimationFrame(centerMapInViewport))
  }

  const setZoomAround = useCallback((nextZoom: number, clientX: number, clientY: number) => {
    const map = mapRef.current
    if (!map) return
    const clampedZoom = clampZoom(nextZoom)
    if (clampedZoom === zoomRef.current) return
    const rect = map.getBoundingClientRect()
    const anchorClientX = rect.width > 0
      ? Math.min(rect.right, Math.max(rect.left, clientX))
      : clientX
    const anchorClientY = rect.height > 0
      ? Math.min(rect.bottom, Math.max(rect.top, clientY))
      : clientY
    zoomAnchorRef.current = {
      clientX: anchorClientX,
      clientY: anchorClientY,
      mapX: rect.width ? (anchorClientX - rect.left) / rect.width : 0.5,
      mapY: rect.height ? (anchorClientY - rect.top) / rect.height : 0.5,
    }
    zoomRef.current = clampedZoom
    setZoom(clampedZoom)
  }, [])

  const applyPendingTouchGesture = () => {
    touchGestureFrameRef.current = null
    const previousCenter = touchPanCenterRef.current
    const nextCenter = touchCenter()
    const nextDistance = touchDistance()
    const container = scrollContainer()
    if (!previousCenter || !nextCenter || !container) return

    container.scrollLeft -= nextCenter.x - previousCenter.x
    container.scrollTop -= nextCenter.y - previousCenter.y
    touchPanCenterRef.current = nextCenter
    if (
      nextDistance &&
      touchPinchDistanceRef.current &&
      Math.abs(nextDistance - touchPinchDistanceRef.current) >= 2
    ) {
      setZoomAround(
        touchPinchZoomRef.current * (nextDistance / touchPinchDistanceRef.current),
        nextCenter.x,
        nextCenter.y,
      )
    }
  }

  const cancelPendingTouchGesture = () => {
    if (touchGestureFrameRef.current === null) return
    cancelAnimationFrame(touchGestureFrameRef.current)
    touchGestureFrameRef.current = null
  }

  const flushPendingTouchGesture = () => {
    if (touchGestureFrameRef.current === null) return
    cancelPendingTouchGesture()
    applyPendingTouchGesture()
  }

  const zoomFromViewportCenter = (direction: -1 | 1) => {
    const container = scrollContainer()
    if (!container) return
    const rect = container.getBoundingClientRect()
    setZoomAround(
      Math.round((zoomRef.current + direction * ZOOM_STEP) * 10) / 10,
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
    )
  }

  useEffect(() => {
    const surface = surfaceRef.current
    if (!surface) return
    const handleWheel = (event: WheelEvent) => {
      if (event.deltaX === 0 && event.deltaY === 0) return

      const container = mapRef.current?.closest<HTMLElement>('.construction-map-scroll') ?? null
      if (!container) return
      const lineHeight = 16
      const pageHeight = container.clientHeight || 600
      const wheelDelta = event.deltaY !== 0 ? event.deltaY : event.deltaX
      const normalizedDelta = event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? wheelDelta * lineHeight
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? wheelDelta * pageHeight
          : wheelDelta

      if (normalizedDelta === 0) return
      event.preventDefault()
      const boundedDelta = Math.min(
        MAX_WHEEL_ZOOM_DELTA,
        Math.max(-MAX_WHEEL_ZOOM_DELTA, normalizedDelta),
      )
      const factor = Math.exp(-boundedDelta * 0.0015)
      setZoomAround(zoomRef.current * factor, event.clientX, event.clientY)
    }
    surface.addEventListener('wheel', handleWheel, { passive: false })
    return () => surface.removeEventListener('wheel', handleWheel)
  }, [setZoomAround])

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

  useLayoutEffect(() => {
    if (
      !focusTarget ||
      handledFocusRequestRef.current === focusTarget.requestId ||
      !isInConstructionBounds(focusTarget.cell, layout)
    ) return

    handledFocusRequestRef.current = focusTarget.requestId
    const point = { ...focusTarget.cell }
    setCursor(point)
    setHoverCell(point)
    mapRef.current?.focus({ preventScroll: true })
    centerCellInViewport(point)
  }, [centerCellInViewport, focusTarget, layout])

  useLayoutEffect(() => {
    if (cameraInitializedRef.current) return
    cameraInitializedRef.current = true
    if (handledFocusRequestRef.current !== null) return
    const frame = requestAnimationFrame(() => {
      if (handledFocusRequestRef.current === null) centerMapInViewport()
    })
    return () => cancelAnimationFrame(frame)
  }, [centerMapInViewport])

  useEffect(() => {
    if (selectedTool === 'wall' || selectedTool === 'erase') return stopEdgePan
    edgePanPointerRef.current = null
    edgePanLastTimestampRef.current = null
    if (edgePanFrameRef.current !== null) {
      cancelAnimationFrame(edgePanFrameRef.current)
      edgePanFrameRef.current = null
    }
    return stopEdgePan
  }, [selectedTool, stopEdgePan])

  useEffect(() => {
    const abandonGestures = () => {
      edgePanPointerRef.current = null
      edgePanLastTimestampRef.current = null
      if (edgePanFrameRef.current !== null) {
        cancelAnimationFrame(edgePanFrameRef.current)
        edgePanFrameRef.current = null
      }
      pointerIdRef.current = null
      dragStartRef.current = null
      dragEndRef.current = null
      draftPointerStartRef.current = null
      draftDraggingRef.current = false
      cancelledDraftPointerIdRef.current = null
      keyboardAnchorRef.current = null
      panPointerIdRef.current = null
      panLastPointRef.current = null
      panStartPointRef.current = null
      panStartCellRef.current = null
      panPointerTypeRef.current = 'mouse'
      panButtonRef.current = null
      panStartInspectItemKeyRef.current = null
      panMovedRef.current = false
      touchPointsRef.current.clear()
      touchPanCenterRef.current = null
      touchPinchDistanceRef.current = null
      if (touchGestureFrameRef.current !== null) {
        cancelAnimationFrame(touchGestureFrameRef.current)
        touchGestureFrameRef.current = null
      }
      spacePressedRef.current = false
      setDragStart(null)
      setDragEnd(null)
      setDraftTool(null)
      setIsPanning(false)
      setIsEdgePanning(false)
    }
    window.addEventListener('blur', abandonGestures)
    return () => window.removeEventListener('blur', abandonGestures)
  }, [])

  const indoorFootprintWarning = useCallback((kind: WorkstationKind, cells: GridPoint[]) => {
    if (!WORKSTATION_SPECS[kind].indoor) return null
    const roomIds = cells.map((cell) => roomByCell.get(keyFor(cell))?.id ?? null)
    const firstRoom = roomIds[0]
    return firstRoom && roomIds.every((roomId) => roomId === firstRoom)
      ? null
      : 'Placeable · inactive until enclosed'
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
          ? `Wall · ${cells.length} ${cells.length === 1 ? 'tile' : 'tiles'} · ${cells.length * BOUNDARY_SPECS.wall.materialCost} material`
          : `Deconstruct · ${cells.length} ${cells.length === 1 ? 'tile' : 'tiles'}`,
        warning: null,
        error: outOfBounds ? 'Outside the construction grid.' : occupied ? 'A workstation occupies this wall line.' : null,
      }
    }

    if (selectedTool === 'door') {
      const valid = boundaryAt(planningLayout, point)?.kind === 'wall'
      return {
        cells: [point],
        valid,
        label: `Door · 1 tile · ${BOUNDARY_SPECS.door.materialCost} material`,
        warning: null,
        error: valid ? null : 'Door needs an existing wall tile.',
      }
    }

    const input = workstationInput(selectedTool, point, rotation)
    const validation = validateWorkstationPlacement(planningLayout, input)
    const indoorWarning = validation.valid
      ? indoorFootprintWarning(selectedTool, validation.cells)
      : null
    const footprint = getWorkstationFootprintSize({
      size: input.size,
      rotation,
    })
    return {
      cells: validation.cells,
      valid: validation.valid,
      label: `${WORKSTATION_SPECS[selectedTool].label} · ${footprint.width}×${footprint.height} · ${WORKSTATION_SPECS[selectedTool].materialCost} material`,
      warning: indoorWarning,
      error: validation.error ?? null,
    }
  }, [cursor, draftTool, dragEnd, dragStart, hoverCell, indoorFootprintWarning, planningLayout, rotation, selectedTool])

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
        cancelledDraftPointerIdRef.current = null
        panPointerIdRef.current = null
        panLastPointRef.current = null
        panStartPointRef.current = null
        panStartCellRef.current = null
        panPointerTypeRef.current = 'touch'
        panStartInspectItemKeyRef.current = null
        setIsPanning(true)
        touchPanCenterRef.current = touchCenter()
        touchPinchDistanceRef.current = touchDistance()
        touchPinchZoomRef.current = zoomRef.current
        event.currentTarget.setPointerCapture?.(event.pointerId)
        return
      }
    }
    const temporarySpacePan = (
      event.pointerType !== 'touch' &&
      event.button === 0 &&
      spacePressedRef.current
    )
    if (temporarySpacePan) {
      clearDraft()
      beginPan(event, false)
      return
    }
    if (event.button === 1) {
      beginPan(event, false)
      return
    }
    if (
      event.button === 2 ||
      (event.button === 0 && event.ctrlKey && event.pointerType !== 'touch')
    ) {
      beginPan(event, false, 2)
      return
    }
    if (!selectedTool && event.button === 0) {
      beginPan(event, true)
      return
    }
    if (!selectedTool || event.button !== 0) return
    const point = pointerPoint(event)
    if (!point) {
      beginPan(event, false)
      return
    }
    event.preventDefault()
    updatePreviewLabelAnchor(event.clientX, event.clientY)
    pointerIdRef.current = event.pointerId
    draftPointerStartRef.current = { x: event.clientX, y: event.clientY }
    cancelledDraftPointerIdRef.current = null
    draftDraggingRef.current = false
    edgePanPointerRef.current = { x: event.clientX, y: event.clientY }
    edgePanLastTimestampRef.current = null
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
    if (selectedTool) updatePreviewLabelAnchor(event.clientX, event.clientY)
    if (event.pointerType === 'touch' && touchPointsRef.current.has(event.pointerId)) {
      touchPointsRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
      if (touchPanCenterRef.current) {
        event.preventDefault()
        if (touchGestureFrameRef.current === null) {
          touchGestureFrameRef.current = requestAnimationFrame(applyPendingTouchGesture)
        }
        return
      }
    }
    const touchDraftStart = draftPointerStartRef.current
    const isSinglePlacementTouch = (
      event.pointerType === 'touch' &&
      pointerIdRef.current === event.pointerId &&
      selectedTool !== 'wall' &&
      selectedTool !== 'erase'
    )
    if (
      isSinglePlacementTouch &&
      touchDraftStart &&
      Math.hypot(
        event.clientX - touchDraftStart.x,
        event.clientY - touchDraftStart.y,
      ) >= TOUCH_PAN_DRAG_THRESHOLD
    ) {
      event.preventDefault()
      clearDraft()
      beginPan(event, false)
      panStartPointRef.current = touchDraftStart
      panMovedRef.current = true
      const container = scrollContainer()
      if (container) {
        container.scrollLeft -= event.clientX - touchDraftStart.x
        container.scrollTop -= event.clientY - touchDraftStart.y
      }
      panLastPointRef.current = { x: event.clientX, y: event.clientY }
      return
    }
    if (panPointerIdRef.current === event.pointerId) {
      event.preventDefault()
      const previous = panLastPointRef.current
      const start = panStartPointRef.current
      const container = scrollContainer()
      if (!panMovedRef.current && start) {
        const dragThreshold = panPointerTypeRef.current === 'touch'
          ? TOUCH_PAN_DRAG_THRESHOLD
          : PAN_DRAG_THRESHOLD
        if (Math.hypot(event.clientX - start.x, event.clientY - start.y) < dragThreshold) {
          return
        }
        panMovedRef.current = true
      }
      if (previous && container) {
        container.scrollLeft -= event.clientX - previous.x
        container.scrollTop -= event.clientY - previous.y
      }
      panLastPointRef.current = { x: event.clientX, y: event.clientY }
      return
    }
    if (pointerIdRef.current === event.pointerId) {
      edgePanPointerRef.current = { x: event.clientX, y: event.clientY }
      const lineDraft = selectedTool === 'wall' || selectedTool === 'erase'
      const lineDragThreshold = event.pointerType === 'touch'
        ? TOUCH_PAN_DRAG_THRESHOLD
        : PAN_DRAG_THRESHOLD
      if (
        lineDraft &&
        touchDraftStart &&
        Math.hypot(
          event.clientX - touchDraftStart.x,
          event.clientY - touchDraftStart.y,
        ) >= lineDragThreshold
      ) {
        draftDraggingRef.current = true
        scheduleEdgePan()
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
    const wasCancelledDraft = cancelledDraftPointerIdRef.current === event.pointerId
    if (wasCancelledDraft) cancelledDraftPointerIdRef.current = null
    const wasTouchPan = event.pointerType === 'touch' && touchPanCenterRef.current !== null
    if (wasTouchPan) flushPendingTouchGesture()
    if (event.pointerType === 'touch') touchPointsRef.current.delete(event.pointerId)
    if (wasCancelledDraft) {
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
      return
    }
    if (wasTouchPan) {
      if (touchPointsRef.current.size < 2) {
        touchPanCenterRef.current = null
        touchPinchDistanceRef.current = null
        const remainingTouch = touchPointsRef.current.entries().next().value as
          | [number, PointerPosition]
          | undefined
        if (remainingTouch) {
          const [pointerId, point] = remainingTouch
          panPointerIdRef.current = pointerId
          panLastPointRef.current = point
          panStartPointRef.current = point
          panStartCellRef.current = null
          panPointerTypeRef.current = 'touch'
          panButtonRef.current = 0
          panStartInspectItemKeyRef.current = null
          panMovedRef.current = false
          panInspectsStationaryPointerRef.current = false
        } else {
          setIsPanning(false)
        }
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
    if (cancelledDraftPointerIdRef.current === event.pointerId) {
      cancelledDraftPointerIdRef.current = null
    }
    if (event.pointerType === 'touch') touchPointsRef.current.delete(event.pointerId)
    cancelPendingTouchGesture()
    if (touchPointsRef.current.size < 2) {
      touchPanCenterRef.current = null
      touchPinchDistanceRef.current = null
      setIsPanning(false)
    }
    if (panPointerIdRef.current === event.pointerId) panButtonRef.current = null
    endPan(event, false)
    if (pointerIdRef.current !== null) onError('Draft cancelled.')
    clearDraft()
  }

  const losePointerCapture = (event: ReactPointerEvent<HTMLDivElement>) => {
    const ownsDraft = pointerIdRef.current === event.pointerId
    const ownsPan = panPointerIdRef.current === event.pointerId
    const ownsTouch = touchPointsRef.current.has(event.pointerId)
    const ownsCancelledDraft = cancelledDraftPointerIdRef.current === event.pointerId
    if (!ownsDraft && !ownsPan && !ownsTouch && !ownsCancelledDraft) return
    if (ownsCancelledDraft) cancelledDraftPointerIdRef.current = null
    touchPointsRef.current.delete(event.pointerId)
    cancelPendingTouchGesture()
    touchPanCenterRef.current = null
    touchPinchDistanceRef.current = null
    panPointerIdRef.current = null
    panLastPointRef.current = null
    panStartPointRef.current = null
    panStartCellRef.current = null
    panPointerTypeRef.current = 'mouse'
    panButtonRef.current = null
    panStartInspectItemKeyRef.current = null
    panMovedRef.current = false
    setIsPanning(false)
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

  const activateKeyboardCursor = () => {
    if (selectedTool) {
      commitKeyboardDraft(cursor)
      return
    }
    if (!onInspectCell) return
    const cell = mapRef.current?.querySelector<HTMLElement>(
      `[data-construction-cell][data-grid-x="${cursor.x}"][data-grid-y="${cursor.y}"]`,
    )
    const rect = cell?.getBoundingClientRect()
    onInspectCell(cursor, {
      x: rect ? rect.left + rect.width / 2 : 0,
      y: rect ? rect.top + rect.height / 2 : 0,
    })
  }

  const handleKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (isEditableTarget(event.target)) return
    const cursorMovement: Record<string, GridPoint> = {
      ArrowUp: { x: 0, y: -1 },
      ArrowRight: { x: 1, y: 0 },
      ArrowDown: { x: 0, y: 1 },
      ArrowLeft: { x: -1, y: 0 },
    }
    const cameraMovement: Record<string, GridPoint> = {
      w: { x: 0, y: -1 },
      d: { x: 1, y: 0 },
      s: { x: 0, y: 1 },
      a: { x: -1, y: 0 },
    }
    const cameraDirection = cameraMovement[event.key.toLowerCase()]
    if (cameraDirection && !event.altKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault()
      panCameraBy(
        cameraDirection.x * KEYBOARD_PAN_STEP,
        cameraDirection.y * KEYBOARD_PAN_STEP,
      )
      return
    }
    const movement = cursorMovement[event.key]
    if (movement && !event.altKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault()
      const next = {
        x: Math.min(layout.width - 1, Math.max(0, cursor.x + movement.x)),
        y: Math.min(layout.height - 1, Math.max(0, cursor.y + movement.y)),
      }
      setCursor(next)
      setHoverCell(next)
      revealKeyboardCell(next)
      if (keyboardAnchorRef.current && draftTool === selectedTool) setDragEnd(next)
      return
    }
    if (event.key === ' ' || event.code === 'Space') {
      event.preventDefault()
      if (!event.repeat) {
        spacePressedRef.current = true
      }
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      activateKeyboardCursor()
      return
    }
    if (event.key.toLowerCase() === 'r' && isWorkstationTool(selectedTool)) {
      event.preventDefault()
      onRotate()
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      spacePressedRef.current = false
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

  const handleKeyboardRelease = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (isEditableTarget(event.target)) return
    if (event.key !== ' ' && event.code !== 'Space') return
    event.preventDefault()
    spacePressedRef.current = false
  }

  const clearSpaceGesture = () => {
    spacePressedRef.current = false
  }

  useEffect(() => {
    if (selectedTool) mapRef.current?.focus({ preventScroll: true })
  }, [selectedTool])

  const cursorStyle: CSSProperties = {
    gridColumn: `${cursor.x + 1}`,
    gridRow: `${cursor.y + 1}`,
  }

  const previewEndpoint = preview?.cells.at(-1) ?? hoverCell ?? cursor
  const positionPreviewLabelAtEndpoint = useCallback(() => {
    if (!selectedTool || !previewEndpoint) return
    const cell = mapRef.current?.querySelector<HTMLElement>(
      `[data-construction-cell][data-grid-x="${previewEndpoint.x}"][data-grid-y="${previewEndpoint.y}"]`,
    )
    const bounds = cell?.getBoundingClientRect()
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) return
    updatePreviewLabelAnchor(
      bounds.left + bounds.width / 2,
      bounds.top + bounds.height / 2,
    )
  }, [previewEndpoint, selectedTool, updatePreviewLabelAnchor])

  useLayoutEffect(positionPreviewLabelAtEndpoint, [positionPreviewLabelAtEndpoint])

  useEffect(() => {
    const container = scrollContainer()
    window.addEventListener('resize', positionPreviewLabelAtEndpoint)
    window.visualViewport?.addEventListener('resize', positionPreviewLabelAtEndpoint)
    container?.addEventListener('scroll', positionPreviewLabelAtEndpoint, { passive: true })
    return () => {
      window.removeEventListener('resize', positionPreviewLabelAtEndpoint)
      window.visualViewport?.removeEventListener('resize', positionPreviewLabelAtEndpoint)
      container?.removeEventListener('scroll', positionPreviewLabelAtEndpoint)
    }
  }, [positionPreviewLabelAtEndpoint])

  const previewLabelStyle: CSSProperties | undefined = previewEndpoint
    ? {
        gridColumn: `${previewEndpoint.x + 1}`,
        gridRow: `${previewEndpoint.y + 1}`,
        justifySelf: previewLabelAnchor.horizontal,
        transform: `translate(${previewLabelAnchor.horizontal === 'end' ? '-6px' : '6px'}, ${previewLabelAnchor.vertical === 'below' ? '6px' : 'calc(-100% - 4px)'})`,
      }
    : undefined
  const cursorBoundary = boundaryAt(layout, cursor)
  const cursorWorkstation = workstationAt(layout, cursor)
  const cursorOrder = openOrders.find((order) =>
    order.target.cells.some((cell) => cell.x === cursor.x && cell.y === cursor.y),
  )
  const cursorRoom = roomByCell.get(keyFor(cursor))
  const cursorInspection = inspectionByCell.get(keyFor(cursor))
  const inspectableLabels = cursorInspection?.contents.map((item) => item.label) ?? []
  const cursorContents = inspectableLabels.length > 1
    ? `${inspectableLabels.length} inspectable items: ${inspectableLabels.join(', ')}. Press Enter to choose.`
    : inspectableLabels.length === 1
      ? `${inspectableLabels[0]}. ${cursorInspection?.contents[0]?.subtitle ?? ''}. Press Enter to inspect.`
      : cursorOrder
        ? `${constructionOrderLabel(cursorOrder)} blueprint, ${cursorOrder.block?.message ?? constructionOrderActivity(cursorOrder, constructionPaused)}.`
        : cursorBoundary
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
        ? preview.warning
          ? `${preview.label}. ${preview.warning}.`
          : `Valid ${preview.label}.`
        : `Invalid placement. ${preview.error ?? ''}`
      : '',
  ].filter(Boolean).join(' ')

  return (
    <>
      <p className="sr-only" id="construction-grid-help">
        Choose a build tool, then point and drag on the map. W A S D pans the camera; Arrow
        keys move the grid cursor. Right-drag, middle-drag, or hold Space and left-drag to pan
        without leaving the active tool. On touch, tap doors and workstations to place them, or drag
        those tools to pan. Drag wall and deconstruction lines, and use two fingers to pan or
        pinch while drawing. Every wheel input zooms around the pointer. Drag
        a wall or deconstruction line to a screen edge to keep drawing while the camera
        scrolls. Enter places an object or starts and finishes a wall line. R rotates. Escape
        cancels.
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
          aria-label="Center construction map"
          onClick={resetView}
          title="Center map and reset zoom"
          type="button"
        >⌂</button>
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
        className={`construction-camera-surface ${selectedTool ? 'tool-active' : 'pan-active'} ${isPanning ? 'is-panning' : ''} ${isEdgePanning ? 'is-edge-panning' : ''}`}
        onContextMenu={(event) => {
          event.preventDefault()
        }}
        onLostPointerCapture={losePointerCapture}
        onPointerCancel={cancelPointer}
        onPointerDown={beginPointer}
        onPointerLeave={() => {
          if (pointerIdRef.current === null) setHoverCell(null)
        }}
        onPointerMove={movePointer}
        onPointerUp={finishPointer}
        ref={surfaceRef}
        style={{ '--construction-zoom': zoom } as CSSProperties}
      >
      <div
        aria-describedby="construction-grid-help construction-grid-status"
        aria-keyshortcuts="ArrowUp ArrowRight ArrowDown ArrowLeft W A S D Enter Space R Escape Control+Z Meta+Z"
        aria-label={`Freeform construction grid, ${layout.width} columns by ${layout.height} rows. ${rooms.length} ${rooms.length === 1 ? 'room' : 'rooms'}.`}
        aria-roledescription="freeform tile construction grid"
        className={`construction-map ${selectedTool ? 'tool-active' : 'pan-active'} ${isPanning ? 'is-panning' : ''} ${isEdgePanning ? 'is-edge-panning' : ''}`}
        data-grid-height={layout.height}
        data-grid-width={layout.width}
        onBlur={clearSpaceGesture}
        onKeyDown={handleKeyboard}
        onKeyUp={handleKeyboardRelease}
        ref={mapRef}
        role="group"
        style={{
          gridTemplateColumns: `repeat(${layout.width}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${layout.height}, minmax(0, 1fr))`,
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
              className={`construction-boundary construction-inspect-target boundary-${boundary.kind} ${connection.className} ${boundary.kind === 'door' ? `door-${getBoundaryDoorAxis(connection.mask)}` : ''}`}
              data-boundary-connection={connection.name}
              data-boundary-mask={connection.mask}
              data-connect-east={connection.mask & BOUNDARY_CONNECTION_BITS.east ? 'true' : undefined}
              data-connect-north={connection.mask & BOUNDARY_CONNECTION_BITS.north ? 'true' : undefined}
              data-connect-south={connection.mask & BOUNDARY_CONNECTION_BITS.south ? 'true' : undefined}
              data-connect-west={connection.mask & BOUNDARY_CONNECTION_BITS.west ? 'true' : undefined}
              data-grid-x={boundary.x}
              data-grid-y={boundary.y}
              data-inspect-item-key={`boundary:${keyFor(boundary)}`}
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
              className={`construction-workstation construction-inspect-target workstation-${kind}`}
              data-grid-height={footprint.height}
              data-grid-width={footprint.width}
              data-grid-x={workstation.origin.x}
              data-grid-y={workstation.origin.y}
              data-inspect-item-key={`workstation:${workstation.id}`}
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

        {constructionStockpile && (
          <span
            aria-label={`Construction pallet, ${Math.round(constructionStock * 10) / 10} material on hand`}
            className="construction-stockpile construction-inspect-target"
            data-grid-x={constructionStockpile.x}
            data-grid-y={constructionStockpile.y}
            data-inspect-item-key="stockpile:construction-material"
            role="img"
            style={{
              gridColumn: `${constructionStockpile.x + 1}`,
              gridRow: `${constructionStockpile.y + 1}`,
            }}
          >
            <GameIcon name="storage" />
            <strong>{Math.round(constructionStock * 10) / 10}</strong>
          </span>
        )}

        {openOrders.map((order) => {
          const progress = constructionProgress(order)
          const activity = constructionOrderActivity(order, constructionPaused)
          if (order.target.kind === 'boundary') {
            const cell = order.target.cells[0]
            const boundary = order.target.construct ?? order.target.deconstruct
            if (!boundary) return null
            const connectionLayout = order.target.construct ? planningLayout : layout
            const connection = getBoundaryConnection(connectionLayout, cell)
            return (
              <span
                aria-label={`${constructionOrderLabel(order)} blueprint, ${activity}, ${progress} percent`}
                className={`construction-blueprint construction-blueprint-boundary construction-inspect-target construction-boundary boundary-${boundary.kind} blueprint-${order.operation} status-${order.status} ${connection.className} ${boundary.kind === 'door' ? `door-${getBoundaryDoorAxis(connection.mask)}` : ''}`}
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
                data-inspect-item-key={`blueprint:${order.id}`}
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
              aria-label={`${constructionOrderLabel(order)} blueprint, ${activity}, ${progress} percent`}
              className={`construction-blueprint construction-blueprint-workstation construction-inspect-target blueprint-${order.operation} status-${order.status}`}
              data-construction-order-id={order.id}
              data-construction-order-status={order.status}
              data-grid-height={footprint.height}
              data-grid-width={footprint.width}
              data-grid-x={workstation.origin.x}
              data-grid-y={workstation.origin.y}
              data-inspect-item-key={`blueprint:${order.id}`}
              key={order.id}
              role="img"
              style={{
                gridColumn: `${workstation.origin.x + 1} / span ${footprint.width}`,
                gridRow: `${workstation.origin.y + 1} / span ${footprint.height}`,
              }}
            >
              <span className="blueprint-workstation-art"><GameIcon name={spec?.icon ?? 'work'} /></span>
              <strong>{order.operation === 'deconstruct' ? 'Remove' : spec?.shortLabel ?? workstation.label}</strong>
              <small>{activity}</small>
              <b className="construction-job-progress"><i style={{ width: `${progress}%` }} /></b>
            </span>
          )
        })}

        {crew.map((member, memberIndex) => {
          const order = assignedOrderByCrew.get(member.id)
          const activity = order ? constructionOrderActivity(order, constructionPaused) : null
          const activityClass = activity?.toLowerCase().replaceAll(' ', '-') ?? 'idle'
          const carriedMaterial = order && order.materials.carriedByCrewId === member.id
            ? carriedConstructionMaterial(order)
            : 0
          const workerActive = Boolean(
            order && !constructionPaused && !order.block,
          )
          const showWorkerTask = Boolean(order && (workerActive || order.block))
          const cell = crewCells.get(member.id)
          if (!cell) return null
          const name = member.name
          const workerInitials = name.split(' ').map((part) => part[0]).join('').slice(0, 2)
          return (
            <span
              aria-label={order
                ? `${name}, ${activity}, ${constructionOrderLabel(order)}${carriedMaterial > 0 ? `, carrying ${materialAmount(carriedMaterial)} material` : ''}`
                : `${name}, ${member.status}`}
              className={`construction-pawn construction-inspect-target ${order ? `construction-worker worker-${activityClass}` : 'construction-idle-pawn'} ${carriedMaterial > 0 ? 'worker-carrying' : ''}`}
              data-construction-worker-id={order ? member.id : undefined}
              data-construction-worker-state={order ? activityClass : undefined}
              data-crew-id={member.id}
              data-grid-x={cell.x}
              data-grid-y={cell.y}
              data-inspect-item-key={`crew:${member.id}`}
              data-order-id={order?.id}
              key={member.id}
              role="img"
              style={{
                left: `calc(${cell.x + 0.5} * var(--construction-cell-size))`,
                position: 'absolute',
                top: `calc(${cell.y + 0.5} * var(--construction-cell-size))`,
              }}
            >
              <PawnSprite
                accent={workerAccents[memberIndex % workerAccents.length]}
                initials={workerInitials}
                showStatusDot={!order || workerActive}
                size="compact"
                status={workerActive ? 'working' : member.status}
                variant={workerVariants[memberIndex % workerVariants.length]}
              />
              {order && showWorkerTask && (
                <span className="construction-worker-task">
                  <GameIcon name={constructionActivityIcon(order)} />
                </span>
              )}
              {carriedMaterial > 0 && (
                <span aria-hidden="true" className="construction-worker-cargo">
                  <GameIcon name="storage" /><b>{materialAmount(carriedMaterial)}</b>
                </span>
              )}
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
                className={`construction-preview ${preview.valid ? 'valid' : 'invalid'} ${preview.warning ? 'warning' : ''} preview-${selectedTool} ${boundaryPreview ? `construction-boundary boundary-${selectedTool} ${connection.className} ${selectedTool === 'door' ? `door-${getBoundaryDoorAxis(connection.mask)}` : ''}` : ''}`}
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
            className={`construction-draft-label ${preview.valid ? '' : 'invalid'} ${preview.warning ? 'warning' : ''}`}
            style={previewLabelStyle}
          >
            <span>{preview.error ?? preview.label}</span>
            {preview.warning && <small><GameIcon name="warning" />{preview.warning}</small>}
          </span>
        )}

        {selectedCell && (
          <span
            aria-hidden="true"
            className="construction-selection-cell"
            data-grid-x={selectedCell.x}
            data-grid-y={selectedCell.y}
            style={{ gridColumn: `${selectedCell.x + 1}`, gridRow: `${selectedCell.y + 1}` }}
          />
        )}

        {[...overlapCounts.entries()].map(([cellKey, count]) => {
          if (count < 2) return null
          const [x, y] = cellKey.split(':').map(Number)
          const labels = inspectionByCell.get(cellKey)?.contents.map((item) => item.label) ?? []
          return (
            <button
              aria-haspopup="dialog"
              aria-hidden={selectedTool ? 'true' : undefined}
              aria-label={`Choose ${count} overlapping items on column ${x + 1}, row ${y + 1}${labels.length > 0 ? `: ${labels.join(', ')}` : ''}`}
              className="construction-stack-count"
              data-construction-cell
              data-grid-x={x}
              data-grid-y={y}
              key={`stack-count-${cellKey}`}
              onClick={(event) => {
                event.stopPropagation()
                if (selectedTool || !onInspectCell) return
                const bounds = event.currentTarget.getBoundingClientRect()
                const cell = { x, y }
                setCursor(cell)
                setHoverCell(cell)
                onInspectCell(cell, {
                  x: bounds.left + bounds.width / 2,
                  y: bounds.top + bounds.height / 2,
                })
              }}
              onPointerDown={(event) => {
                if (!selectedTool) event.stopPropagation()
              }}
              style={{ gridColumn: `${x + 1}`, gridRow: `${y + 1}` }}
              tabIndex={selectedTool ? -1 : 0}
              title={`Choose from ${count} things here`}
              type="button"
            >
              <GameIcon name="inspect" />
              <b>{count}</b>
            </button>
          )
        })}

        <span aria-hidden="true" className="construction-north">N<i /></span>
        <span aria-hidden="true" className="construction-scale">20 m</span>
        <span aria-hidden="true" className="construction-grid-shade" />
      </div>
      {isEdgePanning && (
        <span aria-hidden="true" className="construction-edge-pan-indicator">
          <GameIcon name="map" /> Camera scrolling
        </span>
      )}
      </div>
    </>
  )
}
