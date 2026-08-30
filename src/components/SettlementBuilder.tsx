import { useEffect, useMemo, useRef, useState } from 'react'
import {
  detectRooms,
  eraseAt,
  removeWorkstation,
  type ConstructionResult,
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
  projectConstructionOrders,
} from '../game/constructionJobs'
import { canBeginOperations } from '../game/settlement'
import { useColonyStore } from '../game/store'
import type { Priority } from '../game/types'
import { ConstructionMap } from './ConstructionMap'
import { GameIcon, type GameIconName } from './GameIcon'
import { TileStackPicker } from './TileStackPicker'
import {
  buildMapInspection,
  constructionPhaseSummary,
  type MapInspectable,
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
    { id: 'door', label: 'Door', detail: 'Replace one wall tile', icon: 'door' },
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
  if (!tool) return 'Pan'
  if (tool === 'wall') return 'Wall'
  if (tool === 'door') return 'Door'
  if (tool === 'erase') return 'Deconstruct'
  return WORKSTATION_SPECS[tool].label
}

const instructionFor = (tool: ConstructionTool | null) => {
  if (!tool) return 'Move / Select: drag the map to look around or select something to inspect it.'
  if (tool === 'wall') return 'Drag a one-tile wall line · hold at an edge to continue.'
  if (tool === 'door') return 'Tap or click an existing wall tile.'
  if (tool === 'erase') return 'Tap or drag to deconstruct · hold at an edge to continue.'
  return `${WORKSTATION_SPECS[tool].description} · click or tap to place · touch-drag or Space/middle-drag pans · R rotates.`
}

interface SettlementBuilderProps {
  onExit?: () => void
}

interface ArchitectSelection {
  cellKey: string
  itemKey: string | null
}

const pointKey = ({ x, y }: GridPoint) => `${x}:${y}`

const materialAmount = (value: number) => {
  const rounded = Math.round(value * 10) / 10
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}

const toolMaterialCost = (tool: ConstructionTool) => {
  if (tool === 'erase') return 0
  if (tool === 'wall' || tool === 'door') return BOUNDARY_SPECS[tool].materialCost
  return WORKSTATION_SPECS[tool].materialCost
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

export function SettlementBuilder({ onExit }: SettlementBuilderProps) {
  const colony = useColonyStore()
  const layout = colony.settlement.layout
  const constructionOrders = colony.settlement.constructionOrders
  const projection = useMemo(
    () => projectConstructionOrders(layout, constructionOrders),
    [constructionOrders, layout],
  )
  const openOrders = constructionOrders.filter((order) => order.status !== 'complete')
  const assignedBuilders = new Set(
    openOrders.map((order) => order.assignedCrewId).filter(Boolean),
  ).size
  const materialBlockedOrders = openOrders.filter(
    (order) => order.block?.kind === 'insufficient_materials',
  )
  const routeBlockedOrders = openOrders.filter(
    (order) => order.block?.kind === 'no_path',
  )
  const unavailableCarrierOrders = openOrders.filter(
    (order) => order.block?.kind === 'carrier_unavailable',
  )
  const prerequisiteBlockedOrders = openOrders.filter(
    (order) => order.block?.kind === 'prerequisite',
  )
  const assignedOrders = openOrders.filter((order) => order.assignedCrewId)
  const activeConstructionSummary = constructionPhaseSummary(assignedOrders)
  const availableStock = availableConstructionStock(
    colony.reserves.constructionStock,
    constructionOrders,
  )
  const reservedStock = Math.max(0, colony.reserves.constructionStock - availableStock)
  const [buildOpen, setBuildOpen] = useState(false)
  const [category, setCategory] = useState<BuildCategory>('structure')
  const [selectedTool, setSelectedTool] = useState<ConstructionTool | null>(null)
  const [parkedTool, setParkedTool] = useState<ConstructionTool | null>(null)
  const [rotation, setRotation] = useState<WorkstationRotation>(0)
  const [announcement, setAnnouncement] = useState('Build freely. Rooms are enclosed shapes with at least one door.')
  const [toastVisible, setToastVisible] = useState(false)
  const simulationSpeed = colony.settlement.constructionSpeed
  const [undoCount, setUndoCount] = useState(0)
  const [selection, setSelection] = useState<ArchitectSelection | null>(null)
  const [stackSnapshot, setStackSnapshot] = useState<MapTileInspection | null>(null)
  const [stackTrigger, setStackTrigger] = useState<HTMLElement | null>(null)
  const undoStack = useRef<string[]>([])
  const rooms = useMemo(() => detectRooms(layout), [layout])
  const readyForShift = canBeginOperations(colony)
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
  const selectedBlueprintCommandOrders = selectedBlueprint
    ? constructionOrders.filter((order) => (
        order.status !== 'complete' && order.commandId === selectedBlueprint.commandId
      ))
    : []
  const selectedBlueprintCommandCount = selectedBlueprintCommandOrders.length
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

  const inspectCell = (cell: GridPoint, anchor: { x: number; y: number }) => {
    const cellKey = pointKey(cell)
    const tile = inspectionByCell.get(cellKey)
    if (!tile) return
    setBuildOpen(false)
    const trigger = (typeof document.elementFromPoint === 'function'
      ? document.elementFromPoint(anchor.x, anchor.y)?.closest<HTMLElement>('[data-construction-cell]')
      : null) ?? document.querySelector<HTMLElement>(
      `[data-construction-cell][data-grid-x="${cell.x}"][data-grid-y="${cell.y}"]`,
    )
    if (tile.contents.length > 1) {
      setSelection(null)
      setStackTrigger(trigger)
      setStackSnapshot(tile)
      return
    }
    setStackSnapshot(null)
    setStackTrigger(null)
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
      undoStack.current = [...undoStack.current.slice(-19), queued.commandId]
      setUndoCount(undoStack.current.length)
      const blockedCount = queued.blockedOrderIds?.length ?? 0
      announce(blockedCount > 0
        ? `${label} queued · ${blockedCount} ${blockedCount === 1 ? 'job needs' : 'jobs need'} material. Use Move / Select to edit blueprints.`
        : `${label} blueprint queued · ${queued.orderIds.length} ${queued.orderIds.length === 1 ? 'job' : 'jobs'}. Use Move / Select to edit blueprints.`)
    } else {
      announce('Pending blueprint cancelled.')
    }
  }

  const undo = () => {
    const commandId = undoStack.current.at(-1)
    if (!commandId) {
      announce('Nothing to undo yet.')
      return
    }
    undoStack.current = undoStack.current.slice(0, -1)
    setUndoCount(undoStack.current.length)
    const cancelled = colony.cancelConstructionCommand(commandId)
    announce(cancelled.length > 0
      ? `Cancelled ${cancelled.length} unfinished ${cancelled.length === 1 ? 'job' : 'jobs'}.`
      : 'Nothing unfinished remains in that placement.')
  }

  const pruneUndoCommand = (commandId: string) => {
    const nextStack = undoStack.current.filter((candidate) => candidate !== commandId)
    if (nextStack.length === undoStack.current.length) return
    undoStack.current = nextStack
    setUndoCount(nextStack.length)
  }

  const cancelSelectedBlueprint = () => {
    if (!selectedBlueprint) return
    const cancelled = colony.cancelConstructionCommand(selectedBlueprint.commandId)
    if (cancelled.length === 0) {
      announce('Nothing unfinished remains in that placement.')
      return
    }
    pruneUndoCommand(selectedBlueprint.commandId)
    setSelection(selectedTile ? { cellKey: selectedTile.key, itemKey: null } : null)
    announce(cancelled.length === 1
      ? 'Blueprint cancelled. Collected material returned to storage.'
      : `${cancelled.length}-job placement cancelled. Collected material returned to storage.`)
  }

  const changeSelectedPriority = (change: -1 | 1) => {
    if (!selectedBlueprint) return
    const priority = Math.min(5, Math.max(1, selectedBlueprint.priority + change)) as Priority
    const changedCount = colony.setConstructionCommandPriority(
      selectedBlueprint.commandId,
      priority,
    )
    if (changedCount > 0) {
      announce(selectedBlueprintCommandCount === 1
        ? `${selectedItem?.label ?? 'Blueprint'} set to priority ${priority}.`
        : `${selectedBlueprintCommandCount}-job placement set to priority ${priority}.`)
    }
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

  const cancelTool = () => {
    setSelectedTool(null)
    setParkedTool(null)
    announce('Placement stopped. Move / Select mode.')
  }

  const togglePan = () => {
    if (selectedTool) {
      setParkedTool(selectedTool)
      setSelectedTool(null)
      announce(`Move / Select active. ${toolName(selectedTool)} is ready to continue from the toolbar.`)
      return
    }
    if (parkedTool) {
      setSelectedTool(parkedTool)
      setParkedTool(null)
      announce(`${toolName(parkedTool)} placement active.`)
      return
    }
    announce('Move / Select mode.')
  }

  const chooseTool = (tool: ConstructionTool) => {
    setSelection(null)
    setStackSnapshot(null)
    setStackTrigger(null)
    if (selectedTool === tool) {
      cancelTool()
      return
    }
    setSelectedTool(tool)
    setParkedTool(null)
    setRotation(0)
    setBuildOpen(false)
    announce(`${toolName(tool)} selected.`)
  }

  const chooseCategory = (nextCategory: BuildCategory) => {
    setSelection(null)
    setStackSnapshot(null)
    setStackTrigger(null)
    if (nextCategory !== category && selectedTool) {
      setParkedTool(selectedTool)
      setSelectedTool(null)
    }
    setCategory(nextCategory)
    setBuildOpen(true)
    announce(nextCategory !== category && selectedTool
      ? `${toolName(selectedTool)} placement off while you browse ${categoryLabels[nextCategory]}.`
      : `${categoryLabels[nextCategory]} tools open.`)
  }

  const resetSettlement = () => {
    if (!window.confirm('Start over with the tiny landing habitat?')) return
    colony.resetColony()
    undoStack.current = []
    setUndoCount(0)
    setBuildOpen(false)
    setCategory('structure')
    setSelectedTool(null)
    setParkedTool(null)
    setRotation(0)
    announce('New tiny landing started.')
  }

  const startFirstShift = () => {
    const result = colony.beginOperations()
    if (!result.ok) announce(result.error ?? 'The settlement is not ready yet.')
  }

  useEffect(() => {
    const keyboardShortcuts = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLSelectElement ||
        (event.target instanceof HTMLElement && event.target.isContentEditable)
      ) return
      if (event.key.toLowerCase() === 'b' && !event.ctrlKey && !event.metaKey) {
        event.preventDefault()
        setBuildOpen((current) => {
          if (!current) {
            setSelection(null)
            setStackSnapshot(null)
            setStackTrigger(null)
          }
          return !current
        })
      }
      if (event.key === 'Escape') {
        if (selection) {
          setSelection(null)
          setAnnouncement('Move / Select mode.')
          setToastVisible(true)
        } else if (selectedTool || parkedTool) {
          setSelectedTool(null)
          setParkedTool(null)
          setAnnouncement('Move / Select mode.')
          setToastVisible(true)
        } else if (buildOpen) {
          setBuildOpen(false)
        } else if (onExit) {
          onExit()
        }
      }
    }
    window.addEventListener('keydown', keyboardShortcuts)
    return () => window.removeEventListener('keydown', keyboardShortcuts)
  }, [buildOpen, onExit, parkedTool, selectedTool, selection])

  useEffect(() => {
    if (!toastVisible) return
    const timeout = window.setTimeout(() => setToastVisible(false), 3200)
    return () => window.clearTimeout(timeout)
  }, [announcement, toastVisible])

  useEffect(() => {
    if (undoStack.current.length === 0) return
    const unfinishedCommands = new Set(
      constructionOrders
        .filter((order) => order.status !== 'complete')
        .map((order) => order.commandId),
    )
    const nextStack = undoStack.current.filter((commandId) => unfinishedCommands.has(commandId))
    if (nextStack.length === undoStack.current.length) return
    undoStack.current = nextStack
    setUndoCount(nextStack.length)
  }, [constructionOrders])

  const activeTools = toolsByCategory[category]
  const currentTool = selectedTool ?? parkedTool
  const currentToolDefinition = currentTool
    ? Object.values(toolsByCategory).flat().find((tool) => tool.id === currentTool)
    : null
  const nextRotation = (rotation + 90) % 360
  const toolInstruction = selectedTool
    ? instructionFor(selectedTool)
    : parkedTool
      ? `Move / Select active · drag to pan or inspect · continue ${toolName(parkedTool)} when ready.`
    : buildOpen
      ? 'Pick a tool. Walls and objects are placed cell by cell—there are no room templates.'
      : readyForShift
        ? 'Your first expansion is habitable. Begin the first shift when you are ready.'
      : 'Drag/WASD/wheel to pan · Ctrl/⌘-wheel or pinch to zoom · B opens Architect.'

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
          {readyForShift && (
            <button aria-label="Begin first shift" onClick={startFirstShift} title="Open colony operations" type="button">
              <GameIcon name="play" /><span>Begin shift</span>
            </button>
          )}
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

      <main className="construction-stage">
        <section aria-label="Construction status" className="construction-job-hud">
          <span className="construction-job-summary">
            <GameIcon name={openOrders.length > 0 ? 'work' : 'check'} />
            <span>
              <strong>{openOrders.length > 0 ? `${openOrders.length} queued` : 'No blueprints'}</strong>
              <small>{openOrders.length > 0
                ? unavailableCarrierOrders.length > 0
                  ? `${unavailableCarrierOrders.length} ${unavailableCarrierOrders.length === 1 ? 'carrier is' : 'carriers are'} unavailable`
                  : routeBlockedOrders.length > 0
                  ? `${routeBlockedOrders.length} ${routeBlockedOrders.length === 1 ? 'blueprint has' : 'blueprints have'} no route`
                  : prerequisiteBlockedOrders.length > 0
                    ? `${prerequisiteBlockedOrders.length} waiting on earlier construction`
                    : materialBlockedOrders.length > 0
                    ? `${materialBlockedOrders.length} ${materialBlockedOrders.length === 1 ? 'job needs' : 'jobs need'} material`
                    : simulationSpeed === 0
                      ? 'Construction paused'
                      : colony.settlement.phase === 'operations'
                        ? 'Ready for mission advance · return to colony to move crews'
                      : assignedBuilders > 0
                        ? activeConstructionSummary
                        : 'Waiting for a builder'
                : toolInstruction}</small>
            </span>
          </span>
          <span className="construction-material-summary" title={`${materialAmount(colony.reserves.constructionStock)} material physically in storage`}>
            <GameIcon name="storage" />
            <span><strong>{materialAmount(availableStock)} free</strong><small>{materialAmount(reservedStock)} reserved</small></span>
          </span>
          {colony.settlement.phase === 'landing' ? (
            <div aria-label="Construction speed" className="construction-speed-controls" role="group">
              <button aria-label="Pause construction" aria-pressed={simulationSpeed === 0} onClick={() => colony.setConstructionSpeed(0)} type="button">Ⅱ</button>
              {([1, 2, 3] as const).map((speed) => (
                <button aria-label={`${speed} times construction speed`} aria-pressed={simulationSpeed === speed} key={speed} onClick={() => colony.setConstructionSpeed(speed)} type="button">{speed}×</button>
              ))}
            </div>
          ) : (
            <div aria-label="Construction scheduling" className="construction-speed-controls construction-mission-controls" role="group">
              <button aria-label="Pause construction" aria-pressed={simulationSpeed === 0} onClick={() => colony.setConstructionSpeed(0)} type="button">Ⅱ</button>
              <button aria-label="Resume construction on mission advance" aria-pressed={simulationSpeed > 0} onClick={() => colony.setConstructionSpeed(1)} type="button">▶</button>
            </div>
          )}
        </section>
        <div className="construction-map-scroll">
          <ConstructionMap
            constructionPaused={simulationSpeed === 0}
            constructionOrders={constructionOrders}
            constructionStock={colony.reserves.constructionStock}
            constructionStockpile={colony.settlement.constructionStockpile}
            crew={visibleCrew}
            crewCells={crewCells}
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
            selectedTool={selectedTool}
          />
        </div>

        {selectedTile && (
          <section
            aria-label={`${selectedItem?.label ?? selectedTile.surfaceLabel} inspector`}
            className={`selection-inspector construction-selection-inspector ${selectedItem ? `selection-${selectedItem.kind}` : 'selection-surface'}`}
            data-inspected-kind={selectedItem?.kind ?? 'surface'}
          >
            <div className="selection-heading">
              <span className="selection-kind">
                <GameIcon name={selectedItem?.icon ?? tileSurfaceIcon(selectedTile.surfaceKind)} />
              </span>
              <span>
                <small>{selectedItem ? selectedItem.subtitle : `Tile ${selectedTile.cell.x + 1}, ${selectedTile.cell.y + 1}`}</small>
                <strong>{selectedItem?.label ?? selectedTile.surfaceLabel}</strong>
              </span>
              <button aria-label="Close inspector" className="inspector-close" onClick={() => setSelection(null)} type="button">
                <GameIcon name="close" />
              </button>
            </div>

            <p className="selection-context">
              <GameIcon name={selectedItem?.icon ?? tileSurfaceIcon(selectedTile.surfaceKind)} />
              {selectedItem?.detail ?? selectedTile.surfaceDetail}
            </p>

            {selectedItem ? (
              <div className="selection-stats tile-selection-stats">
                {selectedItem.stats.map((stat) => (
                  <span key={stat.label}><small>{stat.label}</small><strong>{stat.value}</strong></span>
                ))}
              </div>
            ) : (
              <div className="selection-stats tile-selection-stats">
                <span><small>Surface</small><strong>{selectedTile.surfaceLabel}</strong></span>
                <span><small>Room</small><strong>{selectedTile.roomLabel ?? 'Exterior'}</strong></span>
                <span><small>Contents</small><strong>{selectedTile.contents.length}</strong></span>
                <span><small>Pressure</small><strong>{pressureLabel(selectedTile.atmosphere)}</strong></span>
              </div>
            )}

            <dl className="selection-details">
              <div><dt>Coordinates</dt><dd>Column {selectedTile.cell.x + 1} · Row {selectedTile.cell.y + 1}</dd></div>
              <div><dt>Area</dt><dd>{selectedTile.roomLabel ?? 'Lunar exterior'}</dd></div>
              <div><dt>Surface</dt><dd>{selectedTile.surfaceLabel}</dd></div>
              <div><dt>On tile</dt><dd>{selectedTile.contents.length === 0 ? 'Nothing' : `${selectedTile.contents.length} ${selectedTile.contents.length === 1 ? 'thing' : 'things'}`}</dd></div>
            </dl>

            {selectedBlueprint && (
              <div className="construction-inspector-actions">
                <span className="construction-priority-stepper">
                  <small>{selectedBlueprintCommandCount > 1
                    ? `Placement priority · ${selectedBlueprintCommandCount} jobs`
                    : 'Blueprint priority'}</small>
                  <span>
                    <button aria-label="Lower blueprint priority" disabled={selectedBlueprint.priority <= 1} onClick={() => changeSelectedPriority(-1)} type="button"><GameIcon name="minus" /></button>
                    <strong>P{selectedBlueprint.priority}</strong>
                    <button aria-label="Raise blueprint priority" disabled={selectedBlueprint.priority >= 5} onClick={() => changeSelectedPriority(1)} type="button"><GameIcon name="plus" /></button>
                  </span>
                </span>
                <button className="construction-destructive-action" onClick={cancelSelectedBlueprint} type="button">
                  <GameIcon name="close" /><span>{selectedBlueprintCommandCount > 1
                    ? `Cancel placement · ${selectedBlueprintCommandCount} jobs`
                    : 'Cancel blueprint'}</span>
                </button>
              </div>
            )}

            {selectedItem && (selectedItem.kind === 'boundary' || selectedItem.kind === 'workstation') && (
              <div className="construction-inspector-actions construction-inspector-single-action">
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

        <div className={`construction-controls ${buildOpen ? 'catalog-open' : ''} ${currentTool ? 'active-tool' : ''}`}>
          <nav aria-label="Construction modes" className="construction-category-bar">
            <button
              aria-label="Build menu"
              aria-keyshortcuts="B"
              aria-pressed={buildOpen}
              className="architect-button"
              onClick={() => {
                setBuildOpen((current) => {
                  if (!current) {
                    setSelection(null)
                    setStackSnapshot(null)
                    setStackTrigger(null)
                  }
                  return !current
                })
              }}
              type="button"
            >
              <GameIcon name="work" /><span>Build</span><small>B</small>
            </button>

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

            {!buildOpen && currentTool && (
              <span className="active-tool-summary">
                <GameIcon name={currentToolDefinition?.icon ?? 'work'} />
                <span><strong>{toolName(currentTool)}</strong><small>{toolInstruction}</small></span>
              </span>
            )}

            {!buildOpen && undoCount > 0 && (
              <button aria-label="Undo last construction order" className="undo-tool" onClick={undo} type="button">
                <GameIcon name="reset" /><span>Undo</span>
              </button>
            )}

            {!buildOpen && isWorkstationTool(selectedTool) && (
              <button aria-label={`Rotate ${toolName(selectedTool)} to ${nextRotation}°`} className="rotate-tool" onClick={rotate} type="button">
                <GameIcon name="reset" /><span>Rotate</span><small>→ {nextRotation}°</small>
              </button>
            )}

            {!buildOpen && currentTool && (
              <button
                aria-label={parkedTool ? `Continue placing ${toolName(parkedTool)}` : 'Move / Select'}
                className="pan-button"
                onClick={togglePan}
                type="button"
              >
                <GameIcon name={parkedTool ? 'play' : 'map'} /><span>{parkedTool ? `Continue ${toolName(parkedTool)}` : 'Move / Select'}</span>
              </button>
            )}

            {!buildOpen && currentTool && (
              <button aria-label={`Stop placing ${toolName(currentTool)}`} className="cancel-tool" onClick={cancelTool} type="button">
                <GameIcon name="close" /><span>Stop placing</span>
              </button>
            )}
          </nav>

          {buildOpen && (
            <section aria-label={`${categoryLabels[category]} build tools`} className="construction-tool-tray">
              {(currentTool || undoCount > 0) && (
                <div className="construction-designator-strip">
                  {currentTool && (
                    <span className="construction-designator-summary">
                      <GameIcon name={currentToolDefinition?.icon ?? 'work'} />
                      <span>
                        <small>{parkedTool ? 'Move / Select active' : 'Active designator'}</small>
                        <strong>{toolName(currentTool)}</strong>
                      </span>
                    </span>
                  )}
                  {undoCount > 0 && (
                    <button aria-label="Undo last construction order" className="undo-tool" onClick={undo} type="button">
                      <GameIcon name="reset" /><span>Undo</span>
                    </button>
                  )}
                  {isWorkstationTool(selectedTool) && (
                    <button aria-label={`Rotate ${toolName(selectedTool)} to ${nextRotation}°`} className="rotate-tool" onClick={rotate} type="button">
                      <GameIcon name="reset" /><span>Rotate</span>
                    </button>
                  )}
                  {currentTool && (
                    <button
                      aria-label={parkedTool ? `Continue placing ${toolName(parkedTool)}` : 'Move / Select'}
                      className="pan-button"
                      onClick={togglePan}
                      type="button"
                    >
                      <GameIcon name={parkedTool ? 'play' : 'map'} /><span>{parkedTool ? `Continue ${toolName(parkedTool)}` : 'Move / Select'}</span>
                    </button>
                  )}
                  {currentTool && (
                    <button aria-label={`Stop placing ${toolName(currentTool)}`} className="cancel-tool" onClick={cancelTool} type="button">
                      <GameIcon name="close" /><span>Stop placing</span>
                    </button>
                  )}
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
                    <small>{tool.detail}</small>
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

        <div aria-atomic="true" aria-live="polite" className={`construction-toast ${toastVisible ? 'visible' : ''}`}>
          {announcement}
        </div>

        {stackSnapshot && (
          <TileStackPicker
            gridHeight={layout.height}
            gridWidth={layout.width}
            onClose={() => {
              setStackSnapshot(null)
              setStackTrigger(null)
            }}
            onSelectItem={(tile, item) => selectInspection(tile.key, item)}
            onSelectSurface={(tile) => selectInspection(tile.key, null)}
            tile={stackSnapshot}
            trigger={stackTrigger}
          />
        )}
      </main>
    </div>
  )
}
