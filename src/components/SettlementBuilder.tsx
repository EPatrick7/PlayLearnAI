import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react'
import {
  detectRooms,
  eraseAt,
  getWorkstationCells,
  isInConstructionBounds,
  offsetStarterPoint,
  removeWorkstation,
  type ConstructionLayout,
  type ConstructionResult,
  type DetectedRoom,
  type GridPoint,
  type WorkstationRotation,
} from '../game/construction'
import {
  BOUNDARY_SPECS,
  WORKSTATION_SPECS,
  categoryLabels,
  isWorkstationTool,
  type BuildCategory,
  type ConstructionTool,
} from '../game/constructionCatalog'
import {
  availableConstructionStock,
  carriedConstructionMaterial,
  projectConstructionOrders,
  type ConstructionOrder,
} from '../game/constructionJobs'
import {
  previewConstructionWorkerRoute,
  type RoutableConstructionOrder,
} from '../game/constructionWorkerRouting'
import { constructionSemanticEvaCells } from '../game/constructionHazards'
import { findConstructionPath } from '../game/constructionPathfinding'
import { canBeginOperations } from '../game/settlement'
import { analyzeConstructionPressure } from '../game/pressureTopology'
import { useColonyStore } from '../game/store'
import type { Priority } from '../game/types'
import { AgentLinkPanel, type AgentLinkStatus } from './AgentLinkPanel'
import { ConstructionClockControls } from './ConstructionClockControls'
import { ConstructionMap } from './ConstructionMap'
import {
  ConstructionWorkerPicker,
  type ConstructionWorkerOption,
} from './ConstructionWorkerPicker'
import {
  buildConstructionQueue,
  type ConstructionQueueCommand,
} from './constructionQueue'
import { GameIcon, type GameIconName } from './GameIcon'
import { PawnSprite } from './PawnSprite'
import { TileStackPicker } from './TileStackPicker'
import {
  buildMapInspection,
  constructionOrderPresentation,
  type MapInspectable,
  type MapInspectionStat,
  type MapTileInspection,
} from './mapInspection'

interface ToolDefinition {
  id: ConstructionTool
  label: string
  detail: string
  icon: GameIconName
}

const categoryIcons: Record<BuildCategory, GameIconName> = {
  structure: 'habitat',
  furniture: 'bed',
  production: 'gear',
  power: 'power',
  orders: 'work',
}

const toolsByCategory: Record<BuildCategory, ToolDefinition[]> = {
  structure: [
    { id: 'wall', label: 'Wall', detail: 'Drag a 1-tile line', icon: 'wall' },
    { id: 'door', label: 'Door', detail: 'Replace one wall tile · airlock at vacuum · hatch between rooms', icon: 'door' },
  ],
  furniture: [
    {
      id: 'bed',
      label: WORKSTATION_SPECS.bed.label,
      detail: WORKSTATION_SPECS.bed.description,
      icon: WORKSTATION_SPECS.bed.icon,
    },
    {
      id: 'storage-rack',
      label: WORKSTATION_SPECS['storage-rack'].label,
      detail: WORKSTATION_SPECS['storage-rack'].description,
      icon: WORKSTATION_SPECS['storage-rack'].icon,
    },
  ],
  production: [
    {
      id: 'life-support',
      label: WORKSTATION_SPECS['life-support'].label,
      detail: WORKSTATION_SPECS['life-support'].description,
      icon: WORKSTATION_SPECS['life-support'].icon,
    },
    {
      id: 'research-bench',
      label: WORKSTATION_SPECS['research-bench'].label,
      detail: WORKSTATION_SPECS['research-bench'].description,
      icon: WORKSTATION_SPECS['research-bench'].icon,
    },
  ],
  power: [
    {
      id: 'solar-array',
      label: WORKSTATION_SPECS['solar-array'].label,
      detail: WORKSTATION_SPECS['solar-array'].description,
      icon: WORKSTATION_SPECS['solar-array'].icon,
    },
    {
      id: 'battery-bank',
      label: WORKSTATION_SPECS['battery-bank'].label,
      detail: WORKSTATION_SPECS['battery-bank'].description,
      icon: WORKSTATION_SPECS['battery-bank'].icon,
    },
  ],
  orders: [
    { id: 'erase', label: 'Deconstruct', detail: 'Click or drag to remove', icon: 'minus' },
  ],
}

const toolName = (tool: ConstructionTool | null) => {
  if (!tool) return 'Select'
  if (tool === 'wall') return 'Wall'
  if (tool === 'door') return 'Door'
  if (tool === 'erase') return 'Deconstruct'
  return WORKSTATION_SPECS[tool].label
}

const instructionFor = (tool: ConstructionTool | null) => {
  if (!tool) return 'Select: inspect tiles · drag to move · wheel or pinch to zoom.'
  if (tool === 'wall') return 'Wall: drag a tile line. Colonists build each blueprint.'
  if (tool === 'door') return 'Door: choose a wall tile. Exterior doors become airlocks.'
  if (tool === 'erase') return 'Deconstruct: click or drag built objects.'
  return `${WORKSTATION_SPECS[tool].label}: choose a tile; rotate if needed.`
}

const gestureFor = (tool: ConstructionTool) => (
  tool === 'wall' || tool === 'erase'
    ? 'Drag a tile line'
    : tool === 'door'
      ? 'Choose a wall tile'
      : 'Choose a tile · rotate as needed'
)

interface SettlementBuilderProps {
  agentLinkStatus?: AgentLinkStatus
  constructionCompletionSummary?: string | null
  constructionCompletionToast?: string | null
  musicControl?: ReactNode
  onConstructionQueued?: () => void
  onExit?: () => void
}

interface ArchitectSelection {
  cellKey: string
  itemKey: string | null
}

const pointKey = ({ x, y }: GridPoint) => `${x}:${y}`

const cardinalOffsets: readonly GridPoint[] = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
]

const distanceBetween = (left: GridPoint, right: GridPoint) =>
  Math.abs(left.x - right.x) + Math.abs(left.y - right.y)

const preferredExteriorDoorCell = ({
  layout,
  orders,
  room,
  stockpile,
  targetCells = [],
}: {
  layout: ConstructionLayout
  orders: readonly ConstructionOrder[]
  room: DetectedRoom | null
  stockpile: GridPoint
  targetCells?: readonly GridPoint[]
}): GridPoint | null => {
  if (!room) return null
  const roomCells = new Set(room.cells.map(pointKey))
  const everyRoomCell = new Set(detectRooms(layout).flatMap((candidate) => (
    candidate.cells.map(pointKey)
  )))
  const occupiedInterior = new Set([
    ...layout.workstations.flatMap((workstation) => getWorkstationCells(workstation).map(pointKey)),
    ...orders.flatMap((order) => (
      order.status !== 'complete' && order.target.construct
        ? order.target.cells.map(pointKey)
        : []
    )),
  ])

  const candidates = layout.boundaries.flatMap((boundary) => {
    if (boundary.kind !== 'wall') return []
    return cardinalOffsets.flatMap((offset) => {
      const interior = { x: boundary.x + offset.x, y: boundary.y + offset.y }
      if (!roomCells.has(pointKey(interior)) || occupiedInterior.has(pointKey(interior))) return []
      const exterior = { x: boundary.x - offset.x, y: boundary.y - offset.y }
      if (
        !isInConstructionBounds(exterior, layout)
        || everyRoomCell.has(pointKey(exterior))
        || !findConstructionPath(layout, stockpile, [exterior])
      ) return []
      return [{ cell: { x: boundary.x, y: boundary.y }, interior }]
    })
  })

  return candidates
    .sort((left, right) => {
      const leftDistance = targetCells.length > 0
        ? Math.min(...targetCells.map((cell) => distanceBetween(left.interior, cell)))
        : 0
      const rightDistance = targetCells.length > 0
        ? Math.min(...targetCells.map((cell) => distanceBetween(right.interior, cell)))
        : 0
      return leftDistance - rightDistance
        || left.cell.y - right.cell.y
        || left.cell.x - right.cell.x
    })[0]?.cell ?? null
}

const materialAmount = (value: number) => {
  const rounded = Math.round(value * 10) / 10
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}

const toolMaterialCost = (tool: ConstructionTool) => {
  if (tool === 'erase') return 0
  if (tool === 'wall' || tool === 'door') return BOUNDARY_SPECS[tool].materialCost
  return WORKSTATION_SPECS[tool].materialCost
}

const categoryForTool = (tool: ConstructionTool): BuildCategory => {
  if (tool === 'wall' || tool === 'door') return 'structure'
  if (tool === 'erase') return 'orders'
  return WORKSTATION_SPECS[tool].category
}

const tileSurfaceIcon = (surfaceKind: string): GameIconName => {
  if (surfaceKind === 'wall') return 'wall'
  if (surfaceKind === 'door') return 'door'
  if (surfaceKind === 'floor' || surfaceKind === 'corridor') return 'floor'
  return 'map'
}

const pressureLabel = (atmosphere: 'yes' | 'low' | 'no' | 'exterior') => {
  if (atmosphere === 'yes') return 'Nominal'
  if (atmosphere === 'low') return 'Low'
  return 'Vacuum'
}

const inspectionStatIcon = (label: string): GameIconName => {
  if (label === 'Health') return 'shield'
  if (label === 'Fatigue') return 'clock'
  if (label === 'Role' || label === 'Builder') return 'crew'
  if (label === 'Task' || label === 'Status' || label === 'Operation') return 'work'
  if (label === 'Cargo' || label === 'Materials' || label === 'On pallet' || label === 'Reserved' || label === 'Available') return 'storage'
  if (label === 'Progress') return 'activity'
  if (label === 'Priority') return 'plan'
  if (label === 'Footprint' || label === 'Tile') return 'map'
  if (label === 'Rotation') return 'reset'
  if (label === 'Room' || label === 'Area') return 'habitat'
  if (label === 'Pressure') return 'atmosphere'
  if (label === 'Contents') return 'inspect'
  if (label === 'Connection') return 'corridor'
  return 'gear'
}

const compactInspectionStats = (item: MapInspectable): MapInspectionStat[] => {
  if (item.kind === 'crew') {
    return item.stats.filter((stat) => stat.label !== 'Role')
  }
  if (item.kind === 'blueprint') {
    const compact = item.stats.filter((stat) => (
      stat.label !== 'Status' && stat.label !== 'Priority' && stat.label !== 'Builder'
    ))
    const order = ['Progress', 'Builder', 'Materials', 'Operation']
    return [...compact].sort((left, right) => (
      order.indexOf(left.label) - order.indexOf(right.label)
    ))
  }
  if (item.kind === 'boundary') {
    return item.stats.filter((stat) => stat.label !== 'Tile')
  }
  if (item.kind === 'workstation') {
    return item.stats.filter((stat) => stat.label !== 'Room')
  }
  return item.stats
}

const inspectionHeaderLine = (item: MapInspectable) => {
  if (item.kind !== 'crew') return item.subtitle
  const role = item.stats.find((stat) => stat.label === 'Role')?.value
  return [item.subtitle, role].filter(Boolean).join(' · ')
}

export function SettlementBuilder({
  agentLinkStatus = 'unavailable',
  constructionCompletionSummary = null,
  constructionCompletionToast = null,
  musicControl,
  onConstructionQueued,
  onExit,
}: SettlementBuilderProps) {
  const colony = useColonyStore()
  const layout = colony.settlement.layout
  const constructionOrders = colony.settlement.constructionOrders
  const projection = useMemo(
    () => projectConstructionOrders(layout, constructionOrders),
    [constructionOrders, layout],
  )
  const openOrders = constructionOrders.filter((order) => order.status !== 'complete')
  const latestSequenceByCommand = new Map<string, number>()
  constructionOrders.forEach((order) => {
    if (order.status === 'complete') return
    latestSequenceByCommand.set(
      order.commandId,
      Math.max(latestSequenceByCommand.get(order.commandId) ?? -1, order.sequence),
    )
  })
  const undoableCommandIds = [...latestSequenceByCommand.entries()]
    .sort((left, right) => left[1] - right[1] || left[0].localeCompare(right[0]))
    .map(([commandId]) => commandId)
  const undoCount = undoableCommandIds.length
  const availableStock = availableConstructionStock(
    colony.reserves.constructionStock,
    constructionOrders,
  )
  const reservedStock = Math.max(0, colony.reserves.constructionStock - availableStock)
  const [buildOpen, setBuildOpen] = useState(false)
  const [category, setCategory] = useState<BuildCategory>('structure')
  const [selectedTool, setSelectedTool] = useState<ConstructionTool | null>(null)
  const [toolActivationId, setToolActivationId] = useState(0)
  const [rotation, setRotation] = useState<WorkstationRotation>(0)
  const [announcement, setAnnouncement] = useState('Build freely. Rooms need walls and one door.')
  const [toastVisible, setToastVisible] = useState(false)
  const simulationSpeed = colony.settlement.constructionSpeed
  const constructionQueue = useMemo(() => buildConstructionQueue(constructionOrders, {
    paused: simulationSpeed === 0,
    crewNames: new Map(colony.crew.map((member) => [member.id, member.name])),
  }), [colony.crew, constructionOrders, simulationSpeed])
  const strongestQueueStatus = constructionQueue.reduce<ConstructionQueueCommand | null>(
    (strongest, command) => (
      !strongest || command.statusRank < strongest.statusRank ? command : strongest
    ),
    null,
  )
  const constructionQueueCommandKey = constructionQueue
    .map((command) => command.commandId)
    .join('|')
  const [selection, setSelection] = useState<ArchitectSelection | null>(null)
  const [stackSnapshot, setStackSnapshot] = useState<MapTileInspection | null>(null)
  const [stackTrigger, setStackTrigger] = useState<HTMLElement | null>(null)
  const [stackPreferredItemKey, setStackPreferredItemKey] = useState<string | null>(null)
  const [builderPickerOrderId, setBuilderPickerOrderId] = useState<string | null>(null)
  const [builderPickerTrigger, setBuilderPickerTrigger] = useState<HTMLElement | null>(null)
  const [constructionQueueOpen, setConstructionQueueOpen] = useState(false)
  const [mapFocusTarget, setMapFocusTarget] = useState<{
    cell: GridPoint
    requestId: number
  } | null>(null)
  const constructionQueueTriggerRef = useRef<HTMLButtonElement>(null)
  const constructionQueueRowRefs = useRef<Array<HTMLButtonElement | null>>([])
  const buildMenuTriggerRef = useRef<HTMLButtonElement>(null)
  const mapFocusRequestIdRef = useRef(0)
  const toggleBuildMenu = useCallback(() => {
    setConstructionQueueOpen(false)
    setBuildOpen((current) => {
      if (!current) {
        setSelection(null)
        setStackSnapshot(null)
        setStackTrigger(null)
        setStackPreferredItemKey(null)
      }
      return !current
    })
  }, [])
  const visibleCrew = useMemo(
    () => colony.settlement.phase === 'landing' ? colony.crew.slice(0, 2) : colony.crew,
    [colony.crew, colony.settlement.phase],
  )
  const crewCells = useMemo(
    () => {
      const visibleCrewIds = new Set(visibleCrew.map((member) => member.id))
      return new Map(
        colony.settlement.constructionCrew
          .filter((position) => visibleCrewIds.has(position.crewId))
          .map((position) => [position.crewId, position.cell]),
      )
    },
    [colony.settlement.constructionCrew, visibleCrew],
  )
  const rooms = useMemo(() => detectRooms(layout), [layout])
  const reachableRoomIds = useMemo(() => {
    const stockpile = colony.settlement.constructionStockpile
    const crewCanReachStockpile = [...crewCells.values()].some((cell) => (
      findConstructionPath(layout, cell, [stockpile]) !== null
    ))
    if (!crewCanReachStockpile) return new Set<string>()
    return new Set(rooms
      .filter((room) => findConstructionPath(layout, stockpile, room.cells) !== null)
      .map((room) => room.id))
  }, [colony.settlement.constructionStockpile, crewCells, layout, rooms])
  const roomIdByCell = useMemo(() => new Map(
    rooms.flatMap((room) => room.cells.map((cell) => [pointKey(cell), room.id] as const)),
  ), [rooms])
  const starterRoomId = useMemo(() => {
    const starterWorkstationCells = new Set(layout.workstations
      .filter((workstation) => workstation.id.startsWith('starter-bunk-'))
      .flatMap((workstation) => getWorkstationCells(workstation).map(pointKey)))
    return rooms.find((room) => (
      room.cells.some((cell) => starterWorkstationCells.has(pointKey(cell)))
    ))?.id
      ?? roomIdByCell.get(pointKey(offsetStarterPoint({ x: 5, y: 9 })))
      ?? roomIdByCell.get(pointKey({ x: 5, y: 9 }))
      ?? null
  }, [layout.workstations, roomIdByCell, rooms])
  const inaccessibleExpansionRoom = rooms.find((room) => (
    room.id !== starterRoomId && !reachableRoomIds.has(room.id)
  )) ?? null
  const reachableExpansionRoom = rooms.find((room) => (
    room.id !== starterRoomId && reachableRoomIds.has(room.id)
  )) ?? null
  const guideAccessDoorCell = useMemo(() => preferredExteriorDoorCell({
    layout,
    orders: constructionOrders,
    room: inaccessibleExpansionRoom ?? reachableExpansionRoom,
    stockpile: colony.settlement.constructionStockpile,
  }), [
    colony.settlement.constructionStockpile,
    constructionOrders,
    inaccessibleExpansionRoom,
    layout,
    reachableExpansionRoom,
  ])
  const hasReachableExpansionRoom = rooms.some((room) => (
    room.id !== starterRoomId && reachableRoomIds.has(room.id)
  ))
  const readyForShift = canBeginOperations(colony)
  const wallCanBecomeRoomDoor = useMemo(() => {
    if (rooms.length >= 2) return false
    return layout.boundaries.some((boundary, boundaryIndex) => {
      if (boundary.kind !== 'wall') return false
      const candidate = {
        ...layout,
        boundaries: layout.boundaries.map((cell, index) => (
          index === boundaryIndex ? { ...cell, kind: 'door' as const } : cell
        )),
      }
      return detectRooms(candidate).length > rooms.length
    })
  }, [layout, rooms.length])
  const hasReachableEnclosedLifeSupport = useMemo(() => layout.workstations.some((workstation) => {
    if (workstation.type !== 'life-support') return false
    const cells = getWorkstationCells(workstation)
    return rooms.some((room) => {
      if (!reachableRoomIds.has(room.id)) return false
      const roomCells = new Set(room.cells.map(pointKey))
      return cells.every((cell) => roomCells.has(pointKey(cell)))
    })
  }), [layout.workstations, reachableRoomIds, rooms])
  const hasExteriorAirlock = useMemo(() => analyzeConstructionPressure(layout).doors.some((door) => (
    door.role === 'exterior_airlock' && door.roomIds.length === 1
  )), [layout])
  const firstShiftStep = colony.settlement.phase === 'operations'
    ? null
    : openOrders.length > 0
      ? 'building'
      : rooms.length < 2
        ? wallCanBecomeRoomDoor ? 'door' : 'room'
        : !hasReachableExpansionRoom
          ? 'access-door'
          : !hasReachableEnclosedLifeSupport
            ? 'life-support'
            : !hasExteriorAirlock
              ? 'access-door'
            : readyForShift
              ? 'ready'
              : 'building'
  const semanticEvaCells = useMemo(() => (
    colony.settlement.phase === 'operations'
      ? constructionSemanticEvaCells(colony.modules, layout, colony.lab.atmosphere)
      : []
  ), [colony.lab.atmosphere, colony.modules, colony.settlement.phase, layout])
  const inspectionByCell = useMemo(() => buildMapInspection({
    width: layout.width,
    height: layout.height,
    modules: [],
    crew: visibleCrew,
    equipment: [],
    workOrders: [],
    entityCells: {
      crew: new Map(crewCells),
      equipment: new Map(),
      work: new Map(),
    },
    constructionLayout: layout,
    evaRequiredCells: semanticEvaCells,
    constructionOrders,
    constructionPaused: simulationSpeed === 0,
    constructionCrewNames: new Map(colony.crew.map((member) => [member.id, member.name])),
    constructionStockpile: {
      cell: colony.settlement.constructionStockpile,
      stored: colony.reserves.constructionStock,
      reserved: reservedStock,
      available: availableStock,
    },
  }), [
    availableStock,
    colony.crew,
    colony.reserves.constructionStock,
    colony.settlement.constructionStockpile,
    constructionOrders,
    crewCells,
    layout,
    reservedStock,
    semanticEvaCells,
    simulationSpeed,
    visibleCrew,
  ])
  const selectedCrewCellKey = selection?.itemKey?.startsWith('crew:')
    ? [...inspectionByCell.entries()].find(([, tile]) =>
        tile.contents.some((item) => item.key === selection.itemKey),
      )?.[0] ?? null
    : null
  const resolvedSelectionCellKey = selectedCrewCellKey ?? selection?.cellKey ?? null
  const selectedTile = resolvedSelectionCellKey
    ? inspectionByCell.get(resolvedSelectionCellKey) ?? null
    : null
  const directlySelectedItem = selectedTile && selection?.itemKey
    ? selectedTile.contents.find((item) => item.key === selection.itemKey) ?? null
    : null
  const completedSelectionOrder = !directlySelectedItem && selection?.itemKey?.startsWith('blueprint:')
    ? constructionOrders.find((order) => order.id === selection.itemKey!.slice('blueprint:'.length))
    : null
  const completedSelectionKey = completedSelectionOrder?.status === 'complete' && completedSelectionOrder.target.construct
    ? completedSelectionOrder.target.kind === 'boundary'
      ? `boundary:${pointKey(completedSelectionOrder.target.construct)}`
      : `workstation:${completedSelectionOrder.target.construct.id}`
    : null
  const selectedItem = directlySelectedItem ?? (completedSelectionKey
    ? selectedTile?.contents.find((item) => item.key === completedSelectionKey) ?? null
    : null)
  const selectedBlueprint = selectedItem?.kind === 'blueprint'
    ? constructionOrders.find((order) => order.id === selectedItem.id) ?? null
    : null
  const selectedItemStats = selectedItem ? compactInspectionStats(selectedItem) : []
  const selectedItemContext = selectedBlueprint?.block
    ? selectedItem?.detail ?? selectedBlueprint.block.message
    : selectedItem && (
      selectedItem.kind === 'equipment'
      || selectedItem.kind === 'work'
      || selectedItem.kind === 'stockpile'
      || selectedItem.kind === 'workstation'
    ) ? selectedItem.detail : null
  const selectedBlueprintAssignmentBlocked = Boolean(
    selectedBlueprint && (
      selectedBlueprint.block?.kind === 'no_path'
      || selectedBlueprint.block?.kind === 'target_changed'
      || selectedBlueprint.block?.kind === 'carrier_unavailable'
    ),
  )
  const selectedBlueprintAssignmentBlockLabel = selectedBlueprint?.block?.kind === 'no_path'
    ? 'No route to this blueprint'
    : selectedBlueprint?.block?.kind === 'target_changed'
      ? 'Blueprint target changed'
      : selectedBlueprint?.block?.kind === 'carrier_unavailable'
        ? 'Material carrier unavailable'
        : null
  const selectedBlueprintInaccessibleRoomId = useMemo(() => {
    if (selectedBlueprint?.block?.kind !== 'no_path') return null
    const targetRoomIds = new Set(selectedBlueprint.target.cells
      .map((cell) => roomIdByCell.get(pointKey(cell)))
      .filter((roomId): roomId is string => Boolean(roomId)))
    return targetRoomIds.size === 1
      && selectedBlueprint.target.cells.every((cell) => roomIdByCell.has(pointKey(cell)))
      && !reachableRoomIds.has([...targetRoomIds][0])
      ? [...targetRoomIds][0]
      : null
  }, [reachableRoomIds, roomIdByCell, selectedBlueprint])
  const selectedBlueprintNeedsAccessDoor = Boolean(selectedBlueprintInaccessibleRoomId)
  const selectedBlueprintAccessDoorCell = useMemo(() => preferredExteriorDoorCell({
    layout,
    orders: constructionOrders,
    room: rooms.find((room) => room.id === selectedBlueprintInaccessibleRoomId) ?? null,
    stockpile: colony.settlement.constructionStockpile,
    targetCells: selectedBlueprint?.target.cells,
  }), [
    colony.settlement.constructionStockpile,
    constructionOrders,
    layout,
    rooms,
    selectedBlueprint,
    selectedBlueprintInaccessibleRoomId,
  ])
  const builderPickerOrder = builderPickerOrderId
    && !selectedBlueprintAssignmentBlocked
    && selectedBlueprint?.id === builderPickerOrderId
    ? constructionOrders.find((order) => (
        order.id === builderPickerOrderId && order.status !== 'complete'
      )) ?? null
    : null
  const selectedCrewId = selectedItem?.kind === 'crew' ? selectedItem.id : null
  const selectedCrewConstructionOrder = selectedCrewId
    ? constructionOrders.find((order) => (
        order.status !== 'complete' &&
        (order.forcedCrewId === selectedCrewId || order.assignedCrewId === selectedCrewId)
      )) ?? null
    : null
  const selectedBuilderCrewId = selectedBlueprint?.forcedCrewId
    ?? selectedBlueprint?.assignedCrewId
    ?? null
  const selectedBuilder = selectedBuilderCrewId
    ? colony.crew.find((member) => member.id === selectedBuilderCrewId) ?? null
    : null
  const selectedBlueprintHasCargo = Boolean(
    selectedBlueprint && carriedConstructionMaterial(selectedBlueprint) > 0,
  )
  const constructionWorkerOptions = useMemo<ConstructionWorkerOption[]>(() => {
    if (!builderPickerOrder) return []
    const routableOrders: RoutableConstructionOrder[] = constructionOrders.map((order) => ({
      ...order,
      travelPhase: order.travelPhase ?? 'idle',
    }))
    const routableTarget = routableOrders.find((order) => order.id === builderPickerOrder.id)
    if (!routableTarget) return []
    const targetCarrierId = carriedConstructionMaterial(builderPickerOrder) > 0
      ? builderPickerOrder.materials.carriedByCrewId ?? null
      : null
    const terminalReason = builderPickerOrder.block?.kind === 'target_changed'
      ? 'Blueprint target changed — place it again'
      : builderPickerOrder.block?.kind === 'carrier_unavailable'
        ? builderPickerOrder.block.message
        : builderPickerOrder.block?.kind === 'prerequisite'
          ? 'Waiting for prerequisite construction'
          : builderPickerOrder.block?.kind === 'insufficient_materials'
            ? 'Needs construction material first'
            : null

    return visibleCrew.map((member) => {
      const crewIndex = colony.crew.findIndex((candidate) => candidate.id === member.id)
      const activeIncident = colony.workOrders.find((order) => (
        order.status !== 'complete' && order.assignedCrewIds.includes(member.id)
      ))
      const carriedElsewhere = constructionOrders.find((order) => (
        order.id !== builderPickerOrder.id &&
        order.status !== 'complete' &&
        carriedConstructionMaterial(order) > 0 &&
        order.materials.carriedByCrewId === member.id
      ))
      const otherConstruction = constructionOrders.find((order) => (
        order.id !== builderPickerOrder.id &&
        order.status !== 'complete' &&
        (order.forcedCrewId === member.id || order.assignedCrewId === member.id)
      ))
      const crewCell = crewCells.get(member.id)
      const canUseEvaSuit = Boolean(
        member.equippedEvaSuitId || colony.equipment.some((item) => (
          item.type === 'eva_suit' &&
          item.condition >= 65 &&
          !item.reservedForWorkOrderId &&
          (!item.assignedCrewId || item.assignedCrewId === member.id)
        )),
      )
      const route = crewCell
        ? previewConstructionWorkerRoute({
            layout,
            orders: routableOrders,
            order: routableTarget,
            stockpile: colony.settlement.constructionStockpile,
            crewCell,
            hasEvaSuit: canUseEvaSuit,
            evaRequiredCells: semanticEvaCells,
          })
        : null
      const unavailable = terminalReason
        ?? (member.health <= 0 ? 'Incapacitated' : null)
        ?? (member.status === 'resting' ? 'Resting' : null)
        ?? (member.taskId || activeIncident
          ? `Assigned to ${activeIncident?.label ?? 'incident work'}`
          : null)
        ?? (targetCarrierId && targetCarrierId !== member.id
          ? 'Another colonist must finish this material delivery'
          : null)
        ?? (carriedElsewhere
          ? 'Carrying material to another blueprint — finish delivery first'
          : null)
        ?? (!crewCell ? 'No map position' : null)
        ?? (route && !route.reachable ? 'No route to this blueprint' : null)
      const manuallyAssigned = builderPickerOrder.forcedCrewId === member.id
      const automaticallyWorking = !builderPickerOrder.forcedCrewId &&
        builderPickerOrder.assignedCrewId === member.id
      const badge = unavailable
        ? 'Unavailable' as const
        : manuallyAssigned
          ? 'Assigned' as const
          : automaticallyWorking
            ? 'Working' as const
            : otherConstruction
              ? 'Reassign' as const
              : 'Available' as const
      const detail = unavailable
        ?? (manuallyAssigned
          ? builderPickerOrder.assignedCrewId === member.id
            ? 'Manually assigned to this blueprint'
            : 'Priority held — waiting to resume'
          : automaticallyWorking
            ? 'Working this blueprint automatically'
            : otherConstruction
              ? `${constructionOrderPresentation(otherConstruction).label} · will reassign`
              : route?.phase === 'to_stockpile'
                ? 'Will collect material, then walk to site'
                : 'Ready to walk to this site')
      return {
        member,
        crewIndex: Math.max(0, crewIndex),
        available: !unavailable,
        badge,
        detail,
        routeSteps: route?.steps ?? null,
      }
    })
  }, [
    builderPickerOrder,
    colony.crew,
    colony.equipment,
    colony.settlement.constructionStockpile,
    colony.workOrders,
    constructionOrders,
    crewCells,
    layout,
    semanticEvaCells,
    visibleCrew,
  ])
  const selectedRemovalQueued = Boolean(selectedTile && selectedItem && constructionOrders.some((order) => {
    if (order.status === 'complete' || !order.target.deconstruct) return false
    if (selectedItem.kind === 'boundary' && order.target.kind === 'boundary') {
      return pointKey(order.target.cells[0]) === selectedTile.key
    }
    if (selectedItem.kind === 'workstation' && order.target.kind === 'workstation') {
      return order.target.deconstruct.id === selectedItem.id
    }
    return false
  }))
  const overlapCounts = useMemo(() => new Map(
    [...inspectionByCell.entries()]
      .filter(([, tile]) => tile.contents.length > 1)
      .map(([key, tile]) => [key, tile.contents.length]),
  ), [inspectionByCell])

  const announce = (message: string) => {
    setAnnouncement(message)
    setToastVisible(true)
  }

  const closeConstructionQueue = useCallback((restoreFocus = true) => {
    setConstructionQueueOpen(false)
    if (restoreFocus) {
      window.requestAnimationFrame(() => constructionQueueTriggerRef.current?.focus())
    }
  }, [])

  const closeInspectionStack = useCallback(() => {
    setStackSnapshot(null)
    setStackTrigger(null)
    setStackPreferredItemKey(null)
  }, [])

  const closeBuilderPicker = useCallback(() => {
    setBuilderPickerOrderId(null)
    setBuilderPickerTrigger(null)
  }, [])

  const toggleConstructionQueue = () => {
    if (constructionQueue.length === 0) return
    if (constructionQueueOpen) {
      closeConstructionQueue()
      return
    }
    setBuildOpen(false)
    setSelection(null)
    setStackSnapshot(null)
    setStackTrigger(null)
    setStackPreferredItemKey(null)
    setConstructionQueueOpen(true)
  }

  const focusConstructionOrder = (
    order: ConstructionOrder,
    message = `${constructionOrderPresentation(order).label} selected.`,
  ) => {
    const targetCell = order.target.cells[0]
    setConstructionQueueOpen(false)
    setBuildOpen(false)
    setSelectedTool(null)
    setStackSnapshot(null)
    setStackTrigger(null)
    setStackPreferredItemKey(null)
    setSelection({
      cellKey: pointKey(targetCell),
      itemKey: `blueprint:${order.id}`,
    })
    mapFocusRequestIdRef.current += 1
    setMapFocusTarget({
      cell: { ...targetCell },
      requestId: mapFocusRequestIdRef.current,
    })
    announce(message)
  }

  const inspectConstructionCommand = (command: ConstructionQueueCommand) => {
    const order = constructionOrders.find((candidate) => candidate.id === command.targetOrderId)
    if (!order) return
    focusConstructionOrder(
      order,
      `${command.label} selected · ${command.activity.toLowerCase()}.`,
    )
  }

  const handleConstructionQueueKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    let nextIndex: number | null = null
    if (event.key === 'ArrowDown') nextIndex = (index + 1) % constructionQueue.length
    if (event.key === 'ArrowUp') nextIndex = (index - 1 + constructionQueue.length) % constructionQueue.length
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = constructionQueue.length - 1
    if (nextIndex === null) return
    event.preventDefault()
    constructionQueueRowRefs.current[nextIndex]?.focus()
  }

  useEffect(() => {
    if (!constructionQueueOpen) return
    if (constructionQueue.length === 0) {
      const frame = window.requestAnimationFrame(() => closeConstructionQueue())
      return () => window.cancelAnimationFrame(frame)
    }
    const activeElement = document.activeElement
    if (constructionQueueRowRefs.current.some((row) => row === activeElement)) return
    constructionQueueRowRefs.current[0]?.focus()
  }, [
    closeConstructionQueue,
    constructionQueue.length,
    constructionQueueCommandKey,
    constructionQueueOpen,
  ])

  const openInspectionStack = (
    tile: MapTileInspection,
    trigger: HTMLElement | null,
    preferredItemKey: string | null = null,
    preserveSelection = false,
  ) => {
    setConstructionQueueOpen(false)
    setBuildOpen(false)
    if (!preserveSelection) setSelection(null)
    setStackTrigger(trigger)
    setStackSnapshot(tile)
    setStackPreferredItemKey(preferredItemKey)
  }

  const inspectCell = (
    cell: GridPoint,
    anchor: { x: number; y: number },
    preferredItemKey?: string | null,
  ) => {
    const cellKey = pointKey(cell)
    const tile = inspectionByCell.get(cellKey)
    if (!tile) return
    setConstructionQueueOpen(false)
    setBuildOpen(false)
    const preferredItem = preferredItemKey
      ? tile.contents.find((item) => item.key === preferredItemKey) ?? null
      : null
    const trigger = (typeof document.elementFromPoint === 'function'
      ? document.elementFromPoint(anchor.x, anchor.y)?.closest<HTMLElement>(
          '[data-inspect-item-key], [data-construction-cell]',
        )
      : null) ?? document.querySelector<HTMLElement>(
      `[data-construction-cell][data-grid-x="${cell.x}"][data-grid-y="${cell.y}"]`,
    )
    if (tile.contents.length > 1) {
      openInspectionStack(tile, trigger, preferredItem?.key ?? null)
      return
    }
    if (preferredItem) {
      setStackSnapshot(null)
      setStackTrigger(null)
      setStackPreferredItemKey(null)
      setSelection({ cellKey, itemKey: preferredItem.key })
      setAnnouncement(`${preferredItem.label} selected.`)
      return
    }
    setStackSnapshot(null)
    setStackTrigger(null)
    setStackPreferredItemKey(null)
    const item = tile.contents[0] ?? null
    setSelection({ cellKey, itemKey: item?.key ?? null })
    setAnnouncement(`${item?.label ?? tile.surfaceLabel} selected.`)
  }

  const selectInspection = (tileKey: string, item: MapInspectable | null) => {
    setSelection({ cellKey: tileKey, itemKey: item?.key ?? null })
    const tile = inspectionByCell.get(tileKey)
    setAnnouncement(`${item?.label ?? tile?.surfaceLabel ?? 'Tile'} selected.`)
  }

  const applyConstruction = (result: ConstructionResult, label: string) => {
    if (!result.ok) {
      announce(result.error)
      return
    }
    const queued = colony.queueConstruction(result)
    if (!queued.ok) {
      announce(queued.error ?? 'That blueprint could not be queued.')
      return
    }
    if (queued.commandId && queued.orderIds.length > 0) {
      onConstructionQueued?.()
      const blockedCount = queued.blockedOrderIds?.length ?? 0
      const count = queued.orderIds.length
      const deconstruction = label === 'Deconstruct'
      const subject = deconstruction
        ? `deconstruction ${count === 1 ? 'order' : 'orders'}`
        : `${label.toLowerCase()} ${count === 1 ? 'blueprint' : 'blueprints'}`
      announce(blockedCount > 0
        ? `${count} ${subject} placed · ${blockedCount} ${blockedCount === 1 ? 'is' : 'are'} waiting for material. Colonists build funded blueprints.`
        : deconstruction
          ? `${count} ${subject} placed. Colonists will carry out the ${count === 1 ? 'order' : 'orders'}.`
          : `${count} ${subject} placed. Colonists will haul materials and complete the ${count === 1 ? 'blueprint' : 'blueprints'}.`)
    } else {
      announce('Pending blueprint cancelled.')
    }
  }

  const undo = () => {
    const commandId = undoableCommandIds.at(-1)
    if (!commandId) {
      announce('Nothing to undo yet.')
      return
    }
    const cancelled = colony.cancelConstructionCommand(commandId)
    announce(cancelled.length > 0
      ? `Cancelled ${cancelled.length} unfinished ${cancelled.length === 1 ? 'job' : 'jobs'}.`
      : 'Nothing unfinished remains in that placement.')
  }

  const cancelSelectedBlueprint = () => {
    if (!selectedBlueprint) return
    const cancelled = colony.cancelConstructionOrder(selectedBlueprint.id)
    if (!cancelled) {
      announce('That blueprint is no longer waiting for work.')
      return
    }
    const remainingOrderIds = new Set(
      useColonyStore.getState().settlement.constructionOrders.map((order) => order.id),
    )
    const cancelledCount = constructionOrders.filter((order) => (
      order.status !== 'complete' && !remainingOrderIds.has(order.id)
    )).length
    setSelection(selectedTile ? { cellKey: selectedTile.key, itemKey: null } : null)
    announce(cancelledCount <= 1
      ? 'Blueprint cancelled. Collected material returned to storage.'
      : `Blueprint and ${cancelledCount - 1} dependent ${cancelledCount === 2 ? 'job' : 'jobs'} cancelled. Collected material returned to storage.`)
  }

  const changeSelectedPriority = (change: -1 | 1) => {
    if (!selectedBlueprint) return
    const priority = Math.min(5, Math.max(1, selectedBlueprint.priority + change)) as Priority
    const changed = colony.setConstructionOrderPriority(selectedBlueprint.id, priority)
    if (changed) {
      announce(`${selectedItem?.label ?? 'Blueprint'} set to priority ${priority}.`)
    }
  }

  const openBuilderPicker = (trigger: HTMLElement) => {
    if (!selectedBlueprint || selectedBlueprintAssignmentBlocked) return
    setConstructionQueueOpen(false)
    setBuildOpen(false)
    setStackSnapshot(null)
    setStackTrigger(null)
    setStackPreferredItemKey(null)
    setBuilderPickerOrderId(selectedBlueprint.id)
    setBuilderPickerTrigger(trigger)
  }

  const chooseConstructionBuilder = (crewId: string | null) => {
    if (!builderPickerOrder) return
    const result = colony.setConstructionOrderBuilder(builderPickerOrder.id, crewId)
    if (!result.ok) {
      announce(result.error ?? 'That builder cannot take this blueprint right now.')
      return
    }
    const member = crewId
      ? colony.crew.find((candidate) => candidate.id === crewId) ?? null
      : null
    announce(member
      ? `${member.name} will prioritize this ${constructionOrderPresentation(builderPickerOrder).label.toLowerCase()}.`
      : `${constructionOrderPresentation(builderPickerOrder).label} returned to automatic assignment.`)
  }

  const inspectSelectedBuilder = () => {
    if (!selectedBuilder) return
    const cell = crewCells.get(selectedBuilder.id)
    if (!cell) return
    setSelection({ cellKey: pointKey(cell), itemKey: `crew:${selectedBuilder.id}` })
    mapFocusRequestIdRef.current += 1
    setMapFocusTarget({ cell: { ...cell }, requestId: mapFocusRequestIdRef.current })
    announce(`${selectedBuilder.name} selected.`)
  }

  const deconstructSelectedItem = () => {
    if (!selectedTile || !selectedItem) return
    if (selectedItem.kind === 'boundary') {
      applyConstruction(eraseAt(projection.layout, selectedTile.cell), 'Deconstruct')
    } else if (selectedItem.kind === 'workstation') {
      applyConstruction(removeWorkstation(projection.layout, selectedItem.id), 'Deconstruct')
    } else {
      return
    }
    setSelection(null)
  }

  const rotate = () => {
    setRotation((current) => ((current + 90) % 360) as WorkstationRotation)
    announce(`${toolName(selectedTool)} rotated.`)
  }

  const cancelTool = useCallback(() => {
    const cancelledTool = selectedTool
    setSelectedTool(null)
    setAnnouncement(cancelledTool
      ? `Select mode. ${toolName(cancelledTool)} designator stopped.`
      : 'Select mode active.')
    setToastVisible(true)
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>('.construction-map')?.focus({ preventScroll: true })
    })
  }, [selectedTool])

  const activateTool = (
    tool: ConstructionTool,
    nextRotation: WorkstationRotation = 0,
    message?: string,
  ) => {
    setConstructionQueueOpen(false)
    setSelection(null)
    setStackSnapshot(null)
    setStackTrigger(null)
    setStackPreferredItemKey(null)
    setToolActivationId((current) => current + 1)
    setSelectedTool(tool)
    setRotation(nextRotation)
    setBuildOpen(false)
    announce(message ?? `${toolName(tool)} ready. ${tool === 'wall' || tool === 'erase' ? 'Drag to draw.' : 'Click or tap to place.'}`)
  }

  const chooseTool = (tool: ConstructionTool) => {
    activateTool(tool, selectedTool === tool ? rotation : 0)
  }

  const activateExteriorDoor = (
    message = 'Door ready. Replace an exterior wall beside open floor so colonists can reach the room.',
    preferredCell: GridPoint | null = null,
  ) => {
    setCategory('structure')
    activateTool('door', 0, message)
    if (preferredCell) {
      mapFocusRequestIdRef.current += 1
      setMapFocusTarget({
        cell: { ...preferredCell },
        requestId: mapFocusRequestIdRef.current,
      })
    }
  }

  const chooseCategory = (nextCategory: BuildCategory) => {
    setConstructionQueueOpen(false)
    setSelection(null)
    setStackSnapshot(null)
    setStackTrigger(null)
    setStackPreferredItemKey(null)
    setCategory(nextCategory)
    setBuildOpen(true)
    announce(selectedTool
      ? `${categoryLabels[nextCategory]} tools open. ${toolName(selectedTool)} blueprint remains active.`
      : `${categoryLabels[nextCategory]} blueprint tools open.`)
  }

  const resetSettlement = () => {
    if (!window.confirm('Start over with the tiny landing habitat?')) return
    colony.resetColony()
    onConstructionQueued?.()
    setConstructionQueueOpen(false)
    setBuildOpen(false)
    setCategory('structure')
    setSelectedTool(null)
    setRotation(0)
    announce('New tiny landing started.')
  }

  const startFirstShift = () => {
    const result = colony.beginOperations()
    if (!result.ok) announce(result.error ?? 'The settlement is not ready yet.')
  }

  const copySelectedItem = () => {
    if (!selectedTile || !selectedItem) return

    let copiedTool: ConstructionTool | null = null
    let copiedRotation: WorkstationRotation = 0
    if (selectedItem.kind === 'boundary') {
      copiedTool = layout.boundaries.find(
        (boundary) => boundary.x === selectedTile.cell.x && boundary.y === selectedTile.cell.y,
      )?.kind ?? null
    } else if (selectedItem.kind === 'workstation') {
      const workstation = layout.workstations.find((candidate) => candidate.id === selectedItem.id)
      const workstationTool = workstation?.type as ConstructionTool | undefined
      if (workstation && workstationTool && isWorkstationTool(workstationTool)) {
        copiedTool = workstationTool
        copiedRotation = workstation.rotation
      }
    }

    if (!copiedTool) return
    setCategory(categoryForTool(copiedTool))
    activateTool(
      copiedTool,
      copiedRotation,
      `${toolName(copiedTool)} copied. ${copiedTool === 'wall' ? 'Drag to draw.' : 'Click or tap to place.'}`,
    )
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>('.construction-map')?.focus()
    })
  }

  const runFirstShiftStep = () => {
    if (constructionQueue.length > 0) {
      toggleConstructionQueue()
      return
    }
    if (firstShiftStep === 'room') {
      setCategory('structure')
      activateTool(
        'wall',
        0,
        'Wall ready. Enclose a second room, then replace one wall tile with a door.',
      )
      return
    }
    if (firstShiftStep === 'door') {
      setCategory('structure')
      activateTool(
        'door',
        0,
        'Door ready. Replace one wall tile in the closed shell.',
      )
      return
    }
    if (firstShiftStep === 'access-door') {
      activateExteriorDoor(
        guideAccessDoorCell
          ? 'Airlock ready. The cursor is on a clear exterior wall; press Enter or choose another wall beside open floor.'
          : 'Airlock ready. Replace an exterior wall beside open floor so suited colonists and construction material can reach the expansion.',
        guideAccessDoorCell,
      )
      return
    }
    if (firstShiftStep === 'life-support') {
      setCategory('production')
      activateTool(
        'life-support',
        0,
        'Life support ready. Place it inside an enclosed room.',
      )
      return
    }
    if (firstShiftStep === 'ready') startFirstShift()
  }

  useEffect(() => {
    const keyboardShortcuts = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLSelectElement ||
        (event.target instanceof HTMLElement && event.target.isContentEditable)
      ) return

      if (event.key === 'Escape') {
        event.preventDefault()
        if (constructionQueueOpen) {
          closeConstructionQueue()
        } else if (stackSnapshot) {
          closeInspectionStack()
        } else if (builderPickerOrder) {
          closeBuilderPicker()
        } else if (selectedTool) {
          cancelTool()
        } else if (buildOpen) {
          setBuildOpen(false)
        } else if (selection) {
          setSelection(null)
          setAnnouncement('Selection cleared.')
          setToastVisible(true)
        } else if (onExit) {
          onExit()
        }
        return
      }

      if (builderPickerOrder) return
      if (event.key.toLowerCase() === 'b' && !event.ctrlKey && !event.metaKey) {
        event.preventDefault()
        toggleBuildMenu()
        if (constructionQueueOpen) {
          window.requestAnimationFrame(() => buildMenuTriggerRef.current?.focus())
        }
        return
      }
    }
    window.addEventListener('keydown', keyboardShortcuts)
    return () => window.removeEventListener('keydown', keyboardShortcuts)
  }, [
    buildOpen,
    builderPickerOrder,
    cancelTool,
    closeBuilderPicker,
    closeConstructionQueue,
    closeInspectionStack,
    constructionQueueOpen,
    onExit,
    selectedTool,
    selection,
    stackSnapshot,
    toggleBuildMenu,
  ])

  useEffect(() => {
    if (!toastVisible) return
    const timeout = window.setTimeout(() => setToastVisible(false), 3200)
    return () => window.clearTimeout(timeout)
  }, [announcement, toastVisible])

  const activeTools = toolsByCategory[category]
  const selectedToolDefinition = selectedTool
    ? Object.values(toolsByCategory).flat().find((tool) => tool.id === selectedTool)
    : null
  const nextRotation = (rotation + 90) % 360
  const toolInstruction = selectedTool
    ? instructionFor(selectedTool)
    : buildOpen
      ? 'Choose a designator, then place it on the map.'
      : readyForShift
        ? 'Your first expansion is habitable. Begin the first shift when you are ready.'
      : instructionFor(null)
  const firstShiftGuide = firstShiftStep === 'room'
    ? {
        ariaLabel: 'Expand the habitat with the Wall designator',
        compactTitle: 'Expand · Wall',
        detail: 'Amina and Mateo are ready. Draw walls east of the existing door to enclose one new room.',
        icon: 'wall' as const,
        title: 'Expand the habitat',
      }
    : firstShiftStep === 'door'
      ? {
          ariaLabel: 'Connect the new room with the Door designator',
          compactTitle: 'Connect · Door',
          detail: 'Replace the shared wall with a door so crew can enter.',
          icon: 'door' as const,
          title: 'Connect the rooms',
        }
      : firstShiftStep === 'access-door'
        ? {
            ariaLabel: 'Add an exterior airlock for suited colonist access',
            compactTitle: 'Add · Airlock',
            detail: 'Place a door on an exterior wall for suited crew and cargo.',
            icon: 'door' as const,
            title: 'Add an airlock',
          }
        : firstShiftStep === 'life-support'
          ? {
              ariaLabel: 'Place Life support inside an enclosed room',
              compactTitle: 'Life support',
              detail: 'Place Life Support inside the new enclosed room.',
              icon: 'lifeSupport' as const,
              title: 'Make it habitable',
            }
      : firstShiftStep === 'building'
        ? {
            ariaLabel: constructionQueue.length > 0
              ? `${constructionQueueOpen ? 'Close' : 'Open'} construction queue, ${constructionQueue.length} ${constructionQueue.length === 1 ? 'placement' : 'placements'}, ${openOrders.length} ${openOrders.length === 1 ? 'job' : 'jobs'}`
              : 'Construction work must finish before the first shift',
            compactTitle: `Queue · ${openOrders.length} ${openOrders.length === 1 ? 'job' : 'jobs'}`,
            detail: openOrders.length > 0
              ? `Workers finish ${openOrders.length} ${openOrders.length === 1 ? 'job' : 'jobs'} · ${strongestQueueStatus?.activity ?? 'waiting for a builder'}.`
              : 'Finish or cancel all construction before beginning the first shift.',
            icon: 'work' as const,
            title: `First shift · ${openOrders.length} ${openOrders.length === 1 ? 'job' : 'jobs'} open`,
          }
        : firstShiftStep === 'ready'
          ? {
              ariaLabel: 'Begin first shift',
              compactTitle: 'Begin shift',
            detail: 'The expansion is sealed, accessible, and ready for crew.',
              icon: 'play' as const,
              title: 'First shift ready',
            }
          : null

  return (
    <div className="game-shell construction-shell">
      <header className="construction-topbar">
        <div className="construction-brand" aria-label="Shackleton construction mode">
          <span className="brand-mark"><i />PL</span>
          <span><small>Architect</small><strong>Shackleton</strong></span>
        </div>

        <div className="construction-status sr-only" aria-label="Settlement layout status">
          <span><small>Rooms</small><strong>{rooms.length}</strong></span>
          <span><small>Objects</small><strong>{layout.workstations.length}</strong></span>
          <span className="status-crew"><small>Settlers</small><strong>{visibleCrew.length}</strong></span>
        </div>

        <div className="construction-top-actions">
          {musicControl}
          <AgentLinkPanel
            className="construction-agent-link"
            settlementPhase={colony.settlement.phase}
            status={agentLinkStatus}
          />
          {onExit && (
            <button aria-label="Return to colony" className="construction-exit-action" onClick={onExit} title="Return to colony" type="button">
              <GameIcon name="chevron" /><span>Colony</span>
            </button>
          )}
          {!onExit && (
            <button aria-label="Reset construction map" className="construction-reset-action" onClick={resetSettlement} title="Start over" type="button">
              <GameIcon name="reset" />
            </button>
          )}
        </div>
      </header>

      <main
        className={`construction-stage ${constructionQueueOpen ? 'queue-open' : ''} ${builderPickerOrder ? 'builder-picker-open' : ''}`}
        inert={builderPickerOrder ? true : undefined}
      >
        {constructionQueueOpen && (
          <button
            aria-hidden="true"
            className="construction-queue-backdrop"
            onClick={() => closeConstructionQueue()}
            tabIndex={-1}
            type="button"
          />
        )}
        <section
          aria-label="Construction status"
          className={`construction-job-hud ${constructionQueueOpen ? 'queue-open' : ''}`}
        >
          <button
            aria-controls={constructionQueue.length > 0 ? 'construction-queue' : undefined}
            aria-disabled={constructionQueue.length === 0 && !firstShiftGuide}
            aria-expanded={constructionQueue.length > 0 ? constructionQueueOpen : undefined}
            aria-haspopup={constructionQueue.length > 0 ? 'dialog' : undefined}
            aria-label={firstShiftGuide?.ariaLabel ?? (constructionQueue.length > 0
              ? `${constructionQueueOpen ? 'Close' : 'Open'} construction queue, ${constructionQueue.length} ${constructionQueue.length === 1 ? 'placement' : 'placements'}, ${openOrders.length} ${openOrders.length === 1 ? 'job' : 'jobs'}`
              : 'No construction jobs queued')}
            className={`construction-job-summary construction-queue-trigger ${constructionQueue.length === 0 && !firstShiftGuide ? 'queue-empty' : ''} ${firstShiftStep ? `first-shift-${firstShiftStep}` : ''}`}
            onClick={firstShiftGuide ? runFirstShiftStep : toggleConstructionQueue}
            ref={constructionQueueTriggerRef}
            type="button"
          >
            <GameIcon name={firstShiftGuide?.icon ?? (openOrders.length > 0 ? 'work' : 'check')} />
            <span>
              <strong>
                <span className="construction-queue-label-full">{firstShiftGuide?.title ?? (openOrders.length > 0
                  ? `${constructionQueue.length} ${constructionQueue.length === 1 ? 'placement' : 'placements'} · ${openOrders.length} ${openOrders.length === 1 ? 'job' : 'jobs'}`
                  : constructionCompletionSummary
                    ? 'Construction complete'
                    : 'No blueprints')}</span>
                <span aria-hidden="true" className="construction-queue-label-compact">{firstShiftGuide?.compactTitle ?? (openOrders.length > 0
                  ? `Queue · ${openOrders.length} ${openOrders.length === 1 ? 'job' : 'jobs'}`
                  : constructionCompletionSummary
                    ? 'Queue · Complete'
                    : 'Queue · Empty')}</span>
              </strong>
              <small>{firstShiftGuide?.detail ?? (openOrders.length > 0
                ? strongestQueueStatus?.activity ?? 'Waiting for a builder'
                : constructionCompletionSummary ?? (selectedTool || buildOpen
                  ? toolInstruction
                  : 'Place one to begin.'))}</small>
              {firstShiftGuide && openOrders.length === 0 && (
                <span className="sr-only">No blueprints.</span>
              )}
              {firstShiftGuide && constructionCompletionSummary && (
                <span className="sr-only">
                  Construction complete<span aria-hidden="true">Queue · Complete</span>{constructionCompletionSummary}
                </span>
              )}
            </span>
            {(constructionQueue.length > 0 || firstShiftGuide) && (
              <GameIcon className="construction-queue-chevron" name="chevron" />
            )}
          </button>
          <span className="construction-material-summary" title={`${materialAmount(colony.reserves.constructionStock)} material physically in storage`}>
            <GameIcon name="storage" />
            <span><strong>{materialAmount(availableStock)} free</strong><small>{materialAmount(reservedStock)} reserved</small></span>
          </span>
          <ConstructionClockControls
            onChange={colony.setConstructionSpeed}
            speed={simulationSpeed}
          />

          {constructionQueueOpen && (
            <section
              aria-labelledby="construction-queue-title"
              aria-modal="false"
              className="construction-queue-popover"
              id="construction-queue"
              role="dialog"
            >
              <header className="construction-queue-heading">
                <span className="construction-queue-heading-icon"><GameIcon name="plan" /></span>
                <span>
                  <strong id="construction-queue-title">Construction queue</strong>
                  <small>Choose a placement to inspect</small>
                </span>
                <button aria-label="Close construction queue" onClick={() => closeConstructionQueue()} type="button">
                  <GameIcon name="close" />
                </button>
              </header>
              <ol className="construction-queue-list">
                {constructionQueue.map((command, index) => (
                  <li key={command.commandId}>
                    <button
                      aria-describedby={`construction-queue-detail-${index}`}
                      aria-label={`${command.label}, ${command.activity}, ${command.priorityLabel}, ${command.progress}% complete. Inspect on tile ${command.targetCell.x + 1}, ${command.targetCell.y + 1}`}
                      className="construction-queue-row"
                      data-queue-tone={command.tone}
                      onClick={() => inspectConstructionCommand(command)}
                      onKeyDown={(event) => handleConstructionQueueKeyDown(event, index)}
                      ref={(element) => {
                        constructionQueueRowRefs.current[index] = element
                      }}
                      title={command.detail}
                      type="button"
                    >
                      <span className="construction-queue-target-icon"><GameIcon name={command.icon} /></span>
                      <span className="construction-queue-row-copy">
                        <span className="construction-queue-row-title">
                          <strong>{command.label}</strong>
                          <em>{command.priorityLabel}</em>
                        </span>
                        <span className="construction-queue-row-status">
                          <i />
                          <strong>{command.activity}</strong>
                        </span>
                        <span className="construction-queue-row-metrics">
                          <span><GameIcon name="work" />{command.completedJobs}/{command.totalJobs} complete</span>
                          {command.materialRequired > 0 && (
                            <span><GameIcon name="storage" />{materialAmount(command.materialAllocated)}/{materialAmount(command.materialRequired)} material</span>
                          )}
                          {command.salvageRemaining > 0 && (
                            <span><GameIcon name="gear" />+{materialAmount(command.salvageRemaining)} salvage</span>
                          )}
                        </span>
                        <span
                          aria-label={`${command.progress}% complete`}
                          aria-valuemax={100}
                          aria-valuemin={0}
                          aria-valuenow={command.progress}
                          className="construction-queue-progress"
                          role="progressbar"
                        >
                          <i style={{ width: `${command.progress}%` }} />
                        </span>
                      </span>
                      <span className="construction-queue-jump">
                        <small>{command.targetCell.x + 1},{command.targetCell.y + 1}</small>
                        <GameIcon name="chevron" />
                      </span>
                      <span className="sr-only" id={`construction-queue-detail-${index}`}>
                        {command.detail}
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </section>
        {firstShiftStep === 'ready' && (
          <section
            aria-labelledby="first-shift-promotion-title"
            className="first-shift-promotion"
          >
            <span aria-hidden="true" className="first-shift-promotion-icon">
              <GameIcon name="check" />
            </span>
            <span className="first-shift-promotion-copy">
              <small>Settlement ready</small>
              <strong id="first-shift-promotion-title">Begin the first shift</strong>
              <span>2 rooms · exterior airlock · life support · crew safely inside</span>
            </span>
            <button onClick={startFirstShift} type="button">
              <GameIcon name="play" />
              <span>Begin operations</span>
              <GameIcon name="chevron" />
            </button>
          </section>
        )}
        <div className="construction-map-scroll" inert={constructionQueueOpen ? true : undefined}>
          <ConstructionMap
            constructionPaused={simulationSpeed === 0}
            constructionOrders={constructionOrders}
            constructionStock={colony.reserves.constructionStock}
            constructionStockpile={colony.settlement.constructionStockpile}
            crew={visibleCrew}
            crewCells={crewCells}
            evaRequiredCells={semanticEvaCells}
            focusTarget={mapFocusTarget}
            inspectionByCell={inspectionByCell}
            layout={layout}
            onApply={applyConstruction}
            onCancelTool={cancelTool}
            onError={announce}
            onInspectCell={inspectCell}
            onRotate={rotate}
            onUndo={undo}
            overlapCounts={overlapCounts}
            planningLayout={projection.layout}
            rotation={rotation}
            selectedCell={selectedTile?.cell ?? stackSnapshot?.cell ?? null}
            selectedTool={constructionQueueOpen ? null : selectedTool}
            stackOpenCell={stackSnapshot?.cell ?? null}
            terrainSeed={colony.settlement.terrainSeed ?? colony.seed}
            toolActivationId={toolActivationId}
          />
        </div>

        {selectedTile && (
          <section
            aria-label={`${selectedItem?.label ?? selectedTile.surfaceLabel} inspector`}
            className={`selection-inspector construction-selection-inspector ${selectedItem ? `selection-${selectedItem.kind}` : 'selection-surface'}`}
            data-inspected-kind={selectedItem?.kind ?? 'surface'}
          >
            <div className="selection-heading">
              <span className={`selection-kind ${selectedItem?.portrait ? 'selection-kind-pawn' : ''}`}>
                {selectedItem?.portrait
                  ? <PawnSprite {...selectedItem.portrait} size="compact" />
                  : <GameIcon name={selectedItem?.icon ?? tileSurfaceIcon(selectedTile.surfaceKind)} />}
              </span>
              <span>
                <strong>{selectedItem?.label ?? selectedTile.surfaceLabel}</strong>
                <small>{selectedItem
                  ? inspectionHeaderLine(selectedItem)
                  : `${selectedTile.roomLabel ?? 'Exterior'} · Tile ${selectedTile.cell.x + 1}, ${selectedTile.cell.y + 1}`}</small>
              </span>
              <span className="selection-heading-actions">
                {selectedTile.contents.length > 1 && (
                  <button
                    aria-expanded={stackSnapshot?.key === selectedTile.key}
                    aria-haspopup="dialog"
                    aria-label={`Choose ${selectedTile.contents.length} overlapping items on this tile`}
                    className="selection-stack-button"
                    onClick={(event) => openInspectionStack(
                      selectedTile,
                      event.currentTarget,
                      selectedItem?.key ?? null,
                      true,
                    )}
                    title="Choose another item on this tile"
                    type="button"
                  >
                    <GameIcon name="inspect" /><b>{selectedTile.contents.length}</b>
                  </button>
                )}
                <button aria-label="Close inspector" className="inspector-close" onClick={() => setSelection(null)} type="button">
                  <GameIcon name="close" />
                </button>
              </span>
            </div>

            {selectedItemContext && (
              <p className="selection-context">
                <GameIcon name={selectedItem?.icon ?? tileSurfaceIcon(selectedTile.surfaceKind)} />
                {selectedItemContext}
              </p>
            )}

            {selectedItem ? (
              selectedItemStats.length > 0 && <div className="selection-stats tile-selection-stats">
                {selectedItemStats.map((stat) => (
                  <span data-stat-label={stat.label} key={stat.label}>
                    <GameIcon name={inspectionStatIcon(stat.label)} />
                    <small>{stat.label}</small>
                    <strong>{stat.value}</strong>
                  </span>
                ))}
              </div>
            ) : (
              <div className="selection-stats tile-selection-stats">
                <span><GameIcon name="atmosphere" /><small>Pressure</small><strong>{pressureLabel(selectedTile.atmosphere)}</strong></span>
                <span><GameIcon name="inspect" /><small>Contents</small><strong>{selectedTile.contents.length === 0 ? 'Empty' : selectedTile.contents.length}</strong></span>
              </div>
            )}

            {selectedItem && (
              <p className="selection-location">
                <GameIcon name="map" />
                <span>{selectedTile.roomLabel ?? 'Exterior'}</span>
                <i />
                <span>{selectedTile.cell.x + 1}, {selectedTile.cell.y + 1}</span>
              </p>
            )}

            {selectedBlueprintNeedsAccessDoor && (
              <div className="construction-inspector-actions construction-inspector-single-action">
                <button
                  aria-label="Activate Door designator to add exterior access"
                  className="construction-copy-action"
                  onClick={() => activateExteriorDoor(
                    selectedBlueprintAccessDoorCell
                      ? 'Airlock ready. The cursor is on a safe exterior wall that opens onto clear floor; press Enter to place it.'
                      : 'Airlock ready. Choose an exterior wall beside open floor, not directly behind this blueprint.',
                    selectedBlueprintAccessDoorCell,
                  )}
                  type="button"
                >
                  <GameIcon name="door" /><span>Add exterior airlock</span>
                </button>
              </div>
            )}

            {selectedBlueprint && (
              <div className="construction-builder-row">
                <button
                  aria-label={selectedBuilder
                    ? `Inspect ${selectedBuilder.name}`
                    : 'No builder currently assigned'}
                  className="construction-builder-link"
                  disabled={!selectedBuilder}
                  onClick={inspectSelectedBuilder}
                  type="button"
                >
                  <span><GameIcon name="crew" /></span>
                  <span>
                    <small>Builder</small>
                    <strong>{selectedBuilder?.name ?? (selectedBlueprintAssignmentBlocked ? 'Unavailable' : 'Automatic')}</strong>
                    <em>{selectedBlueprintAssignmentBlockLabel ?? (selectedBlueprint.forcedCrewId
                      ? selectedBlueprint.assignedCrewId === selectedBlueprint.forcedCrewId
                        ? 'Assigned manually · active'
                        : 'Assigned manually · waiting'
                      : selectedBlueprint.assignedCrewId
                        ? 'Automatic · currently working'
                        : 'Automatic · waiting for builder')}</em>
                  </span>
                </button>
                <button
                  aria-expanded={selectedBlueprintAssignmentBlocked
                    ? undefined
                    : builderPickerOrder?.id === selectedBlueprint.id}
                  aria-haspopup={selectedBlueprintAssignmentBlocked ? undefined : 'dialog'}
                  aria-label={selectedBlueprintAssignmentBlocked
                    ? `Builder assignment unavailable. ${selectedBlueprint.block?.message ?? 'Resolve this blueprint blocker first.'}`
                    : `${selectedBlueprint.forcedCrewId ? 'Change' : 'Assign'} builder for ${selectedItem?.label ?? 'blueprint'}`}
                  className="construction-builder-trigger"
                  disabled={selectedBlueprintAssignmentBlocked}
                  onClick={(event) => openBuilderPicker(event.currentTarget)}
                  title={selectedBlueprintAssignmentBlocked
                    ? selectedBlueprint.block?.message
                    : undefined}
                  type="button"
                >
                  <GameIcon name={selectedBlueprint.forcedCrewId ? 'crew' : 'plus'} />
                  <span>{selectedBlueprintAssignmentBlocked
                    ? 'Blocked'
                    : selectedBlueprint.forcedCrewId ? 'Change' : 'Assign'}</span>
                  <GameIcon name="chevron" />
                </button>
              </div>
            )}

            {selectedBlueprint && (
              <div className="construction-inspector-actions">
                <span className="construction-priority-stepper">
                  <small>
                    <span className="construction-priority-label-full">Blueprint priority</span>
                    <span aria-hidden="true" className="construction-priority-label-compact">Priority</span>
                  </small>
                  <span>
                    <button aria-label="Lower blueprint priority" disabled={selectedBlueprint.priority <= 1} onClick={() => changeSelectedPriority(-1)} type="button"><GameIcon name="minus" /></button>
                    <strong>P{selectedBlueprint.priority}</strong>
                    <button aria-label="Raise blueprint priority" disabled={selectedBlueprint.priority >= 5} onClick={() => changeSelectedPriority(1)} type="button"><GameIcon name="plus" /></button>
                  </span>
                </span>
                <button className="construction-destructive-action" onClick={cancelSelectedBlueprint} type="button">
                  <GameIcon name="close" /><span>Cancel blueprint</span>
                </button>
              </div>
            )}

            {selectedCrewConstructionOrder && (
              <div className="construction-inspector-actions construction-inspector-single-action">
                <button
                  className="construction-jump-action"
                  onClick={() => focusConstructionOrder(
                    selectedCrewConstructionOrder,
                    `${constructionOrderPresentation(selectedCrewConstructionOrder).label} selected for ${selectedItem?.label ?? 'colonist'}.`,
                  )}
                  type="button"
                >
                  <GameIcon name="map" />
                  <span>Jump to {constructionOrderPresentation(selectedCrewConstructionOrder).label}</span>
                  <GameIcon name="chevron" />
                </button>
              </div>
            )}

            {selectedItem && (selectedItem.kind === 'boundary' || selectedItem.kind === 'workstation') && (
              <div className="construction-inspector-actions construction-inspector-single-action">
                <button className="construction-copy-action" onClick={copySelectedItem} type="button">
                  <GameIcon name="copy" /><span>Copy</span>
                </button>
                <button
                  className="construction-destructive-action"
                  disabled={selectedRemovalQueued}
                  onClick={deconstructSelectedItem}
                  type="button"
                >
                  <GameIcon name="minus" /><span>{selectedRemovalQueued ? 'Removal queued' : 'Deconstruct'}</span>
                </button>
              </div>
            )}
          </section>
        )}

        <div
          className={`construction-controls ${buildOpen ? 'catalog-open' : ''} ${selectedTool ? 'active-tool' : ''}`}
          inert={constructionQueueOpen ? true : undefined}
        >
          <nav aria-label="Construction modes" className="construction-category-bar">
            <button
              aria-label="Build menu"
              aria-keyshortcuts="B"
              aria-pressed={buildOpen}
              className="architect-button"
              onClick={toggleBuildMenu}
              ref={buildMenuTriggerRef}
              type="button"
            >
              <GameIcon name="work" /><span>Build</span><small>B</small>
            </button>

            {selectedTool && !buildOpen && (
              <button
                aria-label={`Return to Select mode from ${toolName(selectedTool)}`}
                className="pan-button"
                onClick={cancelTool}
                title="Select tiles and move the camera"
                type="button"
              >
                <GameIcon name="inspect" /><span>Select</span>
              </button>
            )}

            {!buildOpen && isWorkstationTool(selectedTool) && (
              <button aria-label={`Rotate ${toolName(selectedTool)} to ${nextRotation}°`} className="rotate-tool" onClick={rotate} type="button">
                <GameIcon name="rotate" /><span>Rotate</span><small>→ {nextRotation}°</small>
              </button>
            )}

            {buildOpen && (Object.keys(categoryLabels) as BuildCategory[]).map((categoryId) => (
              <button
                aria-pressed={category === categoryId}
                className={category === categoryId ? 'selected' : ''}
                key={categoryId}
                onClick={() => chooseCategory(categoryId)}
                type="button"
              >
                <GameIcon name={categoryIcons[categoryId]} />
                <span>{categoryLabels[categoryId]}</span>
              </button>
            ))}

            {!buildOpen && selectedTool && (
              <span className="active-tool-summary">
                <GameIcon name={selectedToolDefinition?.icon ?? 'work'} />
                <span><strong>{toolName(selectedTool)}</strong><small>BLUEPRINT · {gestureFor(selectedTool)}</small></span>
              </span>
            )}

            {!buildOpen && !selectedTool && (
              <span className="active-tool-summary select-mode-summary">
                <GameIcon name="inspect" />
                <span><strong>Select</strong><small>Click/tap inspect · drag map</small></span>
              </span>
            )}

            {!buildOpen && undoCount > 0 && (
              <button aria-label="Undo last construction order" className="undo-tool" onClick={undo} type="button">
                <GameIcon name="reset" /><span>Undo</span>
              </button>
            )}

          </nav>

          {buildOpen && (
            <section aria-label={`${categoryLabels[category]} build tools`} className="construction-tool-tray">
              {selectedTool && (
                <div aria-label={`${toolName(selectedTool)} blueprint active`} className="construction-designator-strip" role="group">
                  <span className="construction-designator-summary">
                    <GameIcon name={selectedToolDefinition?.icon ?? 'work'} />
                    <span><small>Active blueprint</small><strong>{toolName(selectedTool)} · {gestureFor(selectedTool)}</strong></span>
                  </span>
                  {isWorkstationTool(selectedTool) && (
                    <button aria-label={`Rotate ${toolName(selectedTool)} to ${nextRotation}°`} onClick={rotate} type="button">
                      <GameIcon name="rotate" /><span>Rotate</span>
                    </button>
                  )}
                  <button
                    aria-label={`Return to Select mode from ${toolName(selectedTool)}`}
                    className="cancel-tool"
                    onClick={cancelTool}
                    type="button"
                  >
                    <GameIcon name="inspect" /><span>Select</span>
                  </button>
                </div>
              )}
              <div className="construction-tool-list">
                {activeTools.map((tool) => (
                  <button
                    aria-label={`${tool.label}: ${tool.detail}. ${toolMaterialCost(tool.id) > 0 ? `${toolMaterialCost(tool.id)} construction material` : 'No material cost'}`}
                    aria-pressed={selectedTool === tool.id}
                    className={selectedTool === tool.id ? 'selected' : ''}
                    key={tool.id}
                    onClick={() => chooseTool(tool.id)}
                    type="button"
                  >
                    <span><GameIcon name={tool.icon} /></span>
                    <strong>{tool.label}</strong>
                    <em className="construction-tool-cost">
                      {toolMaterialCost(tool.id) > 0
                        ? <><GameIcon name="gear" />{toolMaterialCost(tool.id)}{tool.id === 'wall' ? ' / tile' : ''}</>
                        : 'No material'}
                    </em>
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>

        <div aria-atomic="true" aria-live="polite" className={`construction-toast ${toastVisible || constructionCompletionToast ? 'visible' : ''}`}>
          {constructionCompletionToast ?? announcement}
        </div>

        {stackSnapshot && (
          <TileStackPicker
            gridHeight={layout.height}
            gridWidth={layout.width}
            onClose={closeInspectionStack}
            onSelectItem={(tile, item) => selectInspection(tile.key, item)}
            onSelectSurface={(tile) => selectInspection(tile.key, null)}
            tile={stackSnapshot}
            trigger={stackTrigger}
            preferredItemKey={stackPreferredItemKey}
          />
        )}

        {builderPickerOrder && (
          <ConstructionWorkerPicker
            automaticAvailable={!selectedBlueprintHasCargo}
            automaticDetail={selectedBlueprintHasCargo
              ? 'Finish the current material delivery before switching'
              : 'Best available colonist takes this job'}
            onClose={closeBuilderPicker}
            onSelect={chooseConstructionBuilder}
            options={constructionWorkerOptions}
            orderLabel={constructionOrderPresentation(builderPickerOrder).label}
            selectedCrewId={builderPickerOrder.forcedCrewId ?? null}
            trigger={builderPickerTrigger}
          />
        )}
      </main>
    </div>
  )
}
