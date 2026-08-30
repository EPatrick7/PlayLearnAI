import { useEffect, useMemo, useRef, useState } from 'react'
import {
  detectRooms,
  type ConstructionLayout,
  type ConstructionResult,
  type WorkstationRotation,
} from '../game/construction'
import {
  WORKSTATION_SPECS,
  categoryLabels,
  isWorkstationTool,
  type BuildCategory,
  type ConstructionTool,
} from '../game/constructionCatalog'
import { canBeginOperations } from '../game/settlement'
import { useColonyStore } from '../game/store'
import { ConstructionMap } from './ConstructionMap'
import { GameIcon, type GameIconName } from './GameIcon'

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
    { id: 'wall', label: 'Wall', detail: 'Drag a 1-tile line', icon: 'habitat' },
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
  if (!tool) return 'Drag the map to look around. Open Build when you want to construct.'
  if (tool === 'wall') return 'Drag across cells to draw a one-tile-thick wall run.'
  if (tool === 'door') return 'Click any existing wall tile to replace it with a door.'
  if (tool === 'erase') return 'Click or drag across anything to deconstruct it.'
  return `${WORKSTATION_SPECS[tool].description}. Point at the floor to place; R rotates.`
}

const sameLayout = (left: ConstructionLayout, right: ConstructionLayout) =>
  JSON.stringify(left) === JSON.stringify(right)

export function SettlementBuilder() {
  const colony = useColonyStore()
  const layout = colony.settlement.layout
  const [buildOpen, setBuildOpen] = useState(false)
  const [category, setCategory] = useState<BuildCategory>('structure')
  const [selectedTool, setSelectedTool] = useState<ConstructionTool | null>(null)
  const [parkedTool, setParkedTool] = useState<ConstructionTool | null>(null)
  const [rotation, setRotation] = useState<WorkstationRotation>(0)
  const [announcement, setAnnouncement] = useState('Build freely. Rooms are enclosed shapes with at least one door.')
  const [toastVisible, setToastVisible] = useState(false)
  const [undoCount, setUndoCount] = useState(0)
  const undoStack = useRef<ConstructionLayout[]>([])
  const rooms = useMemo(() => detectRooms(layout), [layout])
  const readyForShift = canBeginOperations(colony)

  const announce = (message: string) => {
    setAnnouncement(message)
    setToastVisible(true)
  }

  const applyConstruction = (result: ConstructionResult, label: string) => {
    if (!result.ok) {
      announce(result.error)
      return
    }
    if (sameLayout(result.layout, layout)) {
      announce('Nothing changed on those tiles.')
      return
    }

    const previousRoomCount = rooms.length
    const nextRooms = detectRooms(result.layout)
    undoStack.current = [...undoStack.current.slice(-19), structuredClone(layout)]
    setUndoCount(undoStack.current.length)
    colony.setConstructionLayout(result.layout)

    if (nextRooms.length > previousRoomCount) {
      const newest = nextRooms.at(-1)
      announce(`Room created · ${newest?.area ?? 0} floor tiles.`)
    } else if (nextRooms.length < previousRoomCount) {
      announce('Room opened to the surface.')
    } else if (result.code === 'workstation_placed') {
      announce(`${label} placed as a ${result.affectedCells.length}-tile object.`)
    } else if (label === 'Door') {
      announce('Door installed in the wall.')
    } else {
      announce(`${label} · ${result.affectedCells.length} ${result.affectedCells.length === 1 ? 'tile' : 'tiles'}.`)
    }
  }

  const undo = () => {
    const previous = undoStack.current.at(-1)
    if (!previous) {
      announce('Nothing to undo yet.')
      return
    }
    undoStack.current = undoStack.current.slice(0, -1)
    setUndoCount(undoStack.current.length)
    colony.setConstructionLayout(previous)
    announce('Last construction order undone.')
  }

  const rotate = () => {
    setRotation((current) => ((current + 90) % 360) as WorkstationRotation)
    announce(`${toolName(selectedTool)} rotated.`)
  }

  const cancelTool = () => {
    setSelectedTool(null)
    setParkedTool(null)
    announce('Pan mode.')
  }

  const togglePan = () => {
    if (selectedTool) {
      setParkedTool(selectedTool)
      setSelectedTool(null)
      announce(`${toolName(selectedTool)} paused. Pan the map, then resume it from the toolbar.`)
      return
    }
    if (parkedTool) {
      setSelectedTool(parkedTool)
      setParkedTool(null)
      announce(`${toolName(parkedTool)} resumed.`)
      return
    }
    announce('Pan mode.')
  }

  const chooseTool = (tool: ConstructionTool) => {
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
    setCategory(nextCategory)
    setSelectedTool(null)
    setParkedTool(null)
    setBuildOpen(true)
    announce(`${categoryLabels[nextCategory]} tools open.`)
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
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return
      if (event.key.toLowerCase() === 'b' && !event.ctrlKey && !event.metaKey) {
        event.preventDefault()
        setBuildOpen((current) => !current)
        setSelectedTool(null)
        setParkedTool(null)
      }
      if (event.key === 'Escape' && (selectedTool || parkedTool)) {
        setSelectedTool(null)
        setParkedTool(null)
        setAnnouncement('Pan mode.')
        setToastVisible(true)
      }
    }
    window.addEventListener('keydown', keyboardShortcuts)
    return () => window.removeEventListener('keydown', keyboardShortcuts)
  }, [parkedTool, selectedTool])

  useEffect(() => {
    if (!toastVisible) return
    const timeout = window.setTimeout(() => setToastVisible(false), 3200)
    return () => window.clearTimeout(timeout)
  }, [announcement, toastVisible])

  const activeTools = toolsByCategory[category]
  const currentTool = selectedTool ?? parkedTool
  const currentToolDefinition = currentTool
    ? Object.values(toolsByCategory).flat().find((tool) => tool.id === currentTool)
    : null
  const nextRotation = (rotation + 90) % 360
  const toolInstruction = selectedTool
    ? instructionFor(selectedTool)
    : parkedTool
      ? `${toolName(parkedTool)} is paused. Move around, then resume without choosing it again.`
    : buildOpen
      ? 'Pick a tool. Walls and objects are placed cell by cell—there are no room templates.'
      : readyForShift
        ? 'Your first expansion is habitable. Begin the first shift when you are ready.'
      : 'Build freely. A closed wall shape with a door becomes a room.'

  return (
    <div className="game-shell construction-shell">
      <header className="construction-topbar">
        <div className="construction-brand" aria-label="Shackleton construction mode">
          <span className="brand-mark"><i />PL</span>
          <span><small>Build mode</small><strong>Shackleton</strong></span>
        </div>

        <div className="construction-status sr-only" aria-label="Settlement layout status">
          <span><small>Rooms</small><strong>{rooms.length}</strong></span>
          <span><small>Objects</small><strong>{layout.workstations.length}</strong></span>
          <span className="status-crew"><small>Settlers</small><strong>2</strong></span>
        </div>

        <div className="construction-top-actions">
          {readyForShift && (
            <button aria-label="Begin first shift" onClick={startFirstShift} title="Open colony operations" type="button">
              <GameIcon name="play" /><span>Begin shift</span>
            </button>
          )}
          <button aria-label="Reset construction map" className="construction-reset-action" onClick={resetSettlement} title="Start over" type="button">
            <GameIcon name="reset" />
          </button>
        </div>
      </header>

      <main className="construction-stage">
        <div className="construction-map-scroll">
          <ConstructionMap
            layout={layout}
            onApply={applyConstruction}
            onCancelTool={cancelTool}
            onError={announce}
            onRotate={rotate}
            onUndo={undo}
            rotation={rotation}
            selectedTool={selectedTool}
          />
        </div>

        <div className={`construction-controls ${buildOpen ? 'catalog-open' : ''} ${currentTool ? 'active-tool' : ''}`}>
          <nav aria-label="Construction modes" className="construction-category-bar">
            <button
              aria-label="Build menu"
              aria-keyshortcuts="B"
              aria-pressed={buildOpen}
              className="architect-button"
              onClick={() => {
                setBuildOpen((current) => !current)
                setSelectedTool(null)
                setParkedTool(null)
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

            {undoCount > 0 && (
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
                aria-label={parkedTool ? `Resume ${toolName(parkedTool)} construction` : 'Pan'}
                aria-pressed={selectedTool === null}
                className="pan-button"
                onClick={togglePan}
                type="button"
              >
                <GameIcon name={parkedTool ? 'play' : 'map'} /><span>{parkedTool ? 'Resume' : 'Move'}</span>
              </button>
            )}

            {!buildOpen && currentTool && (
              <button aria-label="Cancel active construction tool" className="cancel-tool" onClick={cancelTool} type="button">
                <GameIcon name="close" /><span>Cancel</span>
              </button>
            )}
          </nav>

          {buildOpen && (
            <section aria-label={`${categoryLabels[category]} build tools`} className="construction-tool-tray">
              <div>
                {activeTools.map((tool) => (
                  <button
                    aria-label={`${tool.label}: ${tool.detail}`}
                    aria-pressed={selectedTool === tool.id}
                    className={selectedTool === tool.id ? 'selected' : ''}
                    key={tool.id}
                    onClick={() => chooseTool(tool.id)}
                    type="button"
                  >
                    <span><GameIcon name={tool.icon} /></span>
                    <strong>{tool.label}</strong>
                    <small>{tool.detail}</small>
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>

        <div aria-atomic="true" aria-live="polite" className={`construction-toast ${toastVisible ? 'visible' : ''}`}>
          {announcement}
        </div>
      </main>
    </div>
  )
}
