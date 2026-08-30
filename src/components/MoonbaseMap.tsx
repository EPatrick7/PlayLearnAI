import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { createPortal } from 'react-dom'
import {
  detectRooms,
  getWorkstationFootprintSize,
  type ConstructionLayout,
  type GridPoint,
} from '../game/construction'
import {
  WORKSTATION_SPECS,
  type WorkstationKind,
} from '../game/constructionCatalog'
import {
  BOUNDARY_CONNECTION_BITS,
  getBoundaryConnection,
  getBoundaryDoorAxis,
} from '../game/boundaryConnections'
import type {
  CrewMember,
  Equipment,
  LocationId,
  ModuleState,
  OperationsPlan,
  WorkOrder,
  WorkOrderId,
} from '../game/types'
import { GameIcon, type GameIconName } from './GameIcon'
import {
  buildMapInspection,
  describeMapTile,
  withFocusedMapItem,
  type MapInspectable,
  type MapTileInspection,
} from './mapInspection'
import { ModuleConnectors, ModuleTilemap } from './ModuleTilemap'
import { getModuleWalkableCells } from './moduleTileGeometry'
import { PawnSprite, type PawnSpriteVariant } from './PawnSprite'

export interface MoonbaseMapProps {
  width: number
  height: number
  modules: ModuleState[]
  crew: CrewMember[]
  equipment: Equipment[]
  workOrders: WorkOrder[]
  plan: OperationsPlan
  dustActive: boolean
  selectedModuleId: string
  selectedCrewId?: string | null
  selectedEquipmentId?: string | null
  selectedWorkOrderId?: WorkOrderId | null
  onInspectModule: (moduleId: string) => void
  onSelectCrew?: (crewId: string) => void
  onSelectEquipment?: (equipmentId: string) => void
  onSelectWorkOrder?: (workOrderId: WorkOrderId) => void
  onInspectTile?: (tile: MapTileInspection) => void
  buildSites?: Array<{
    id: string
    label: string
    moduleId: string | null
    compatible?: boolean
    position: { x: number; y: number; width: number; height: number }
  }>
  buildingLabel?: string | null
  buildingPreview?: Pick<ModuleState, 'name' | 'type' | 'location' | 'atmosphere'> | null
  previewSiteId?: string | null
  onChooseBuildSite?: (siteId: string) => void
  constructionLayout?: ConstructionLayout | null
}

interface ModulePresentation {
  code: string
  icon: GameIconName
}

interface MapRoute {
  id: string
  kind: 'crew' | 'equipment'
  sourceLocation: LocationId
  destinationLocation: LocationId
  label: string
}

const modulePresentation: Record<ModuleState['type'], ModulePresentation> = {
  habitat: { code: 'HAB', icon: 'habitat' },
  corridor: { code: 'LINK', icon: 'corridor' },
  life_support: { code: 'ECLSS', icon: 'lifeSupport' },
  storage: { code: 'STORE', icon: 'storage' },
  laboratory: { code: 'LAB', icon: 'laboratory' },
  airlock: { code: 'LOCK', icon: 'airlock' },
  solar_battery_skid: { code: 'PWR', icon: 'solar' },
  landing_pad: { code: 'PAD', icon: 'landingPad' },
}

const equipmentPresentation: Record<Equipment['type'], { code: string; icon: GameIconName }> = {
  eva_suit: { code: 'EVA', icon: 'evaSuit' },
  engineering_kit: { code: 'ENG', icon: 'engineeringKit' },
  medical_kit: { code: 'MED', icon: 'medicalKit' },
  rover: { code: 'RVR', icon: 'rover' },
}

const workOrderPresentation: Record<WorkOrder['type'], { label: string; icon: GameIconName }> = {
  seal_breach: { label: 'Seal', icon: 'breach' },
  repressurize_lab: { label: 'Pressure', icon: 'atmosphere' },
  research: { label: 'Research', icon: 'research' },
  clean_solar: { label: 'Clean', icon: 'solar' },
}

const pawnVariants: PawnSpriteVariant[] = ['umber', 'gold', 'olive', 'rose', 'copper', 'slate']
const pawnAccents = ['#a75b4c', '#527b7d', '#68805f', '#8a6378', '#9a7046', '#596f7c']

const isExterior = (module: ModuleState) =>
  module.type === 'solar_battery_skid' || module.type === 'landing_pad'

const words = (value: string) => value.replaceAll('_', ' ').replaceAll('-', ' ')

const mapTileIcon = (tile: MapTileInspection): GameIconName => {
  if (tile.surfaceKind === 'wall') return 'wall'
  if (tile.surfaceKind === 'door') return 'door'
  if (tile.surfaceKind === 'floor' || tile.surfaceKind === 'corridor') return 'floor'
  if (tile.surfaceKind === 'solar') return 'solar'
  if (tile.surfaceKind === 'landing-pad') return 'landingPad'
  return 'map'
}

const initials = (name: string) => name
  .split(/\s+/)
  .filter(Boolean)
  .map((part) => part[0])
  .join('')
  .slice(0, 2)
  .toUpperCase()

function FreeformOperationsLayer({ layout }: { layout: ConstructionLayout }) {
  const rooms = detectRooms(layout)
  return (
    <>
      {rooms.flatMap((room) => room.cells.map((cell) => (
        <span
          aria-hidden="true"
          className="construction-room-floor"
          data-grid-x={cell.x}
          data-grid-y={cell.y}
          data-operations-room-id={room.id}
          key={`operations-${room.id}-${cell.x}-${cell.y}`}
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
            data-freeform-boundary={boundary.kind}
            data-grid-x={boundary.x}
            data-grid-y={boundary.y}
            key={`operations-boundary-${boundary.x}-${boundary.y}`}
            style={{ gridColumn: `${boundary.x + 1}`, gridRow: `${boundary.y + 1}` }}
          >
            <i />
          </span>
        )
      })}

      {layout.workstations.map((workstation) => {
        const kind = workstation.type as WorkstationKind
        const spec = WORKSTATION_SPECS[kind]
        if (!spec) return null
        const footprint = getWorkstationFootprintSize(workstation)
        return (
          <span
            aria-label={`${workstation.label}, ${footprint.width} by ${footprint.height} tiles`}
            className={`construction-workstation workstation-${kind}`}
            data-freeform-workstation={kind}
            data-grid-height={footprint.height}
            data-grid-width={footprint.width}
            data-grid-x={workstation.origin.x}
            data-grid-y={workstation.origin.y}
            key={`operations-workstation-${workstation.id}`}
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

      {rooms.map((room) => {
        const labelCell = room.cells[Math.floor(room.cells.length / 2)]
        return (
          <span
            aria-hidden="true"
            className="construction-room-label"
            key={`operations-label-${room.id}`}
            style={{ gridColumn: `${labelCell.x + 1}`, gridRow: `${labelCell.y + 1}` }}
          >
            Room {room.id.replace('room-', '')} · {room.area}
          </span>
        )
      })}
    </>
  )
}

function MapTerrain({ width, height, dustActive }: { width: number; height: number; dustActive: boolean }) {
  const viewWidth = width * 100
  const viewHeight = height * 100
  const dustSpecks = Array.from({ length: 34 }, (_, index) => ({
    x: (index * 193 + 47) % viewWidth,
    y: (index * 311 + 89) % viewHeight,
    radius: 2 + (index % 4),
  }))

  return (
    <svg
      aria-hidden="true"
      className="map-terrain"
      preserveAspectRatio="none"
      style={{ inset: 0, pointerEvents: 'none', position: 'absolute', width: '100%', height: '100%', zIndex: 0 }}
      viewBox={`0 0 ${viewWidth} ${viewHeight}`}
    >
      <defs>
        <radialGradient id="lunar-ground" cx="47%" cy="38%" r="75%">
          <stop offset="0" stopColor="#777a74" />
          <stop offset=".5" stopColor="#5f635f" />
          <stop offset="1" stopColor="#464c49" />
        </radialGradient>
        <radialGradient id="crater-well" cx="38%" cy="34%" r="64%">
          <stop offset="0" stopColor="#3b403d" />
          <stop offset=".58" stopColor="#4b504c" />
          <stop offset=".72" stopColor="#878981" />
          <stop offset="1" stopColor="#555a56" stopOpacity="0" />
        </radialGradient>
        <pattern id="survey-grid" height="100" patternUnits="userSpaceOnUse" width="100">
          <path d="M100 0H0V100" fill="none" stroke="#bdd1d2" strokeOpacity=".11" strokeWidth="2" />
          <circle cx="4" cy="4" fill="#d6e0de" opacity=".13" r="2" />
        </pattern>
        <linearGradient id="dust-band" x1="0" x2="1">
          <stop offset="0" stopColor="#a4845f" stopOpacity="0" />
          <stop offset=".45" stopColor="#c29c6f" stopOpacity=".22" />
          <stop offset=".7" stopColor="#917252" stopOpacity=".1" />
          <stop offset="1" stopColor="#a4845f" stopOpacity="0" />
        </linearGradient>
      </defs>

      <rect fill="url(#lunar-ground)" fillOpacity=".42" height={viewHeight} width={viewWidth} />
      <path className="terrain-ridge ridge-north" d={`M0 180 C310 80 480 250 760 135 S1300 110 1580 210 S2050 155 ${viewWidth} 70`} />
      <path className="terrain-ridge ridge-south" d={`M0 ${viewHeight - 180} C360 ${viewHeight - 360} 590 ${viewHeight - 90} 920 ${viewHeight - 230} S1650 ${viewHeight - 130} ${viewWidth} ${viewHeight - 280}`} />
      <ellipse cx={viewWidth * 0.11} cy={viewHeight * 0.16} fill="url(#crater-well)" rx="145" ry="92" />
      <ellipse cx={viewWidth * 0.89} cy={viewHeight * 0.74} fill="url(#crater-well)" rx="190" ry="125" />
      <ellipse cx={viewWidth * 0.71} cy={viewHeight * 0.18} fill="url(#crater-well)" rx="65" ry="46" />
      <g className="surface-rocks" fill="#a5aca8" opacity=".22">
        <path d={`M${viewWidth * 0.18} ${viewHeight * 0.7}l22-25 31 18-13 29Z`} />
        <path d={`M${viewWidth * 0.77} ${viewHeight * 0.52}l18-20 26 12-5 25Z`} />
        <path d={`M${viewWidth * 0.36} ${viewHeight * 0.12}l13-13 19 9-7 16Z`} />
      </g>
      <rect fill="url(#survey-grid)" height={viewHeight} width={viewWidth} />

      {dustActive && (
        <g className="dust-front-graphic">
          <path d={`M-300 0H${viewWidth * 0.45}L${viewWidth * 0.75} ${viewHeight}H0Z`} fill="url(#dust-band)" />
          <g className="dust-specks" fill="#d0ab79" opacity=".36">
            {dustSpecks.map((speck, index) => (
              <circle cx={speck.x} cy={speck.y} key={index} r={speck.radius} />
            ))}
          </g>
        </g>
      )}
    </svg>
  )
}

function MapRoutes({
  routes,
  modules,
  width,
  height,
}: {
  routes: MapRoute[]
  modules: ModuleState[]
  width: number
  height: number
}) {
  if (routes.length === 0) return null

  const centerFor = (location: LocationId) => {
    const module = modules.find((candidate) => candidate.location === location) ?? modules[0]
    return {
      x: (module.position.x + module.position.width / 2) * 100,
      y: (module.position.y + module.position.height / 2) * 100,
    }
  }

  return (
    <svg
      aria-hidden="true"
      className="map-routes"
      preserveAspectRatio="none"
      style={{ inset: 0, pointerEvents: 'none', position: 'absolute', width: '100%', height: '100%', zIndex: 4 }}
      viewBox={`0 0 ${width * 100} ${height * 100}`}
    >
      <defs>
        <marker id="route-arrow-crew" markerHeight="8" markerWidth="8" orient="auto" refX="7" refY="4">
          <path d="M0 0 8 4 0 8Z" fill="#61d5c3" />
        </marker>
        <marker id="route-arrow-equipment" markerHeight="8" markerWidth="8" orient="auto" refX="7" refY="4">
          <path d="M0 0 8 4 0 8Z" fill="#edbd70" />
        </marker>
      </defs>
      {routes.map((route, index) => {
        const from = centerFor(route.sourceLocation)
        const to = centerFor(route.destinationLocation)
        const laneOffset = (index % 3 - 1) * 10
        const elbowX = from.x + (to.x - from.x) * 0.48 + laneOffset
        const path = `M ${from.x} ${from.y + laneOffset} H ${elbowX} V ${to.y + laneOffset} H ${to.x}`
        return (
          <g className={`map-route route-${route.kind}`} key={route.id}>
            <title>{route.label}</title>
            <path className="route-shadow" d={path} fill="none" stroke="#071115" strokeOpacity=".75" strokeWidth="13" />
            <path
              className="route-line"
              d={path}
              fill="none"
              markerEnd={`url(#route-arrow-${route.kind})`}
              stroke={route.kind === 'crew' ? '#61d5c3' : '#edbd70'}
              strokeDasharray="16 12"
              strokeLinecap="round"
              strokeWidth="6"
            />
            <circle className="route-origin" cx={from.x} cy={from.y + laneOffset} fill="#101d21" r="10" stroke={route.kind === 'crew' ? '#61d5c3' : '#edbd70'} strokeWidth="4" />
          </g>
        )
      })}
    </svg>
  )
}

export function MoonbaseMap({
  width,
  height,
  modules,
  crew,
  equipment,
  workOrders,
  plan,
  dustActive,
  selectedModuleId,
  selectedCrewId,
  selectedEquipmentId,
  selectedWorkOrderId,
  onInspectModule,
  onSelectCrew,
  onSelectEquipment,
  onSelectWorkOrder,
  onInspectTile,
  buildSites = [],
  buildingLabel = null,
  buildingPreview = null,
  previewSiteId = null,
  onChooseBuildSite,
  constructionLayout = null,
}: MoonbaseMapProps) {
  const [rovingCellKey, setRovingCellKey] = useState('0:0')
  const [selectedCellKey, setSelectedCellKey] = useState<string | null>(null)
  const [stackPicker, setStackPicker] = useState<{
    tile: MapTileInspection
    trigger: HTMLElement | null
    placement: CSSProperties
  } | null>(null)
  const mapRef = useRef<HTMLDivElement>(null)
  const stackPickerRef = useRef<HTMLElement>(null)
  const activePlan = plan.status !== 'completed'
  const plannedWorkIds = new Set<WorkOrderId>(
    activePlan ? plan.actions.map((action) => action.workOrderId) : [],
  )
  workOrders.forEach((order) => {
    if (order.status === 'queued' || order.status === 'active' || order.status === 'paused') {
      plannedWorkIds.add(order.id)
    }
  })

  const plannedLocations = new Set(
    workOrders.filter((order) => plannedWorkIds.has(order.id)).map((order) => order.location),
  )

  const moduleAt = (location: LocationId) =>
    modules.find((candidate) => candidate.location === location) ?? modules[0]

  const customMarkerCells = new Map<string, GridPoint>()
  if (constructionLayout) {
    const occupied = new Set<string>()
    const boundaryCells = new Set(
      constructionLayout.boundaries.map((boundary) => `${boundary.x}:${boundary.y}`),
    )
    const roomCells = detectRooms(constructionLayout).flatMap((room) => room.cells)
    const openCells = Array.from(
      { length: constructionLayout.width * constructionLayout.height },
      (_, index) => ({
        x: index % constructionLayout.width,
        y: Math.floor(index / constructionLayout.width),
      }),
    ).filter((cell) => !boundaryCells.has(`${cell.x}:${cell.y}`))
    const fallbackCells = [...roomCells, ...openCells]

    const allocateMarker = (
      key: string,
      location: LocationId,
      preferredOffset: number,
    ) => {
      const preferred = getModuleWalkableCells(moduleAt(location))
      const offset = preferred.length > 0 ? preferredOffset % preferred.length : 0
      const candidates = [
        ...preferred.slice(offset),
        ...preferred.slice(0, offset),
        ...fallbackCells,
      ]
      const seen = new Set<string>()
      const cell = candidates.find((candidate) => {
        const cellKey = `${candidate.x}:${candidate.y}`
        if (seen.has(cellKey)) return false
        seen.add(cellKey)
        return !occupied.has(cellKey)
      })
      if (!cell) return
      occupied.add(`${cell.x}:${cell.y}`)
      customMarkerCells.set(key, cell)
    }

    crew.forEach((member, index) => allocateMarker(`crew:${member.id}`, member.location, index))
    equipment.forEach((item, index) => allocateMarker(
      `equipment:${item.id}`,
      item.location,
      crew.length + index,
    ))
    workOrders.forEach((order, index) => allocateMarker(
      `work:${order.id}`,
      order.location,
      crew.length + equipment.length + index,
    ))
  }

  const markerCell = (
    markerKey: string,
    location: LocationId,
    index: number,
    lane = 0,
  ): GridPoint => {
    const module = moduleAt(location)
    const walkableCells = getModuleWalkableCells(module)
    const slot = Math.max(0, index + lane * 2)
    return customMarkerCells.get(markerKey)
      ?? walkableCells[slot % Math.max(1, walkableCells.length)]
      ?? { x: module.position.x, y: module.position.y }
  }

  const markerPosition = (cell: GridPoint): CSSProperties => ({
    gridColumn: `${cell.x + 1} / span 1`,
    gridRow: `${cell.y + 1} / span 1`,
    pointerEvents: 'auto',
    zIndex: 50,
  })

  const locationOrdinal = <T extends { location: LocationId }>(items: T[], itemIndex: number) =>
    items.slice(0, itemIndex).filter((item) => item.location === items[itemIndex].location).length

  const locationPopulation = (location: LocationId) =>
    crew.filter((member) => member.location === location).length

  const crewCells = new Map(crew.map((member, index) => [
    member.id,
    markerCell(`crew:${member.id}`, member.location, locationOrdinal(crew, index)),
  ]))
  const equipmentCells = new Map(equipment.map((item, index) => [
    item.id,
    markerCell(
      `equipment:${item.id}`,
      item.location,
      locationOrdinal(equipment, index) + locationPopulation(item.location),
      1,
    ),
  ]))
  const workCells = new Map(workOrders.map((order, index) => [
    order.id,
    markerCell(
      `work:${order.id}`,
      order.location,
      locationOrdinal(workOrders, index) + locationPopulation(order.location),
      2,
    ),
  ]))

  const inspectionByCell = buildMapInspection({
    width,
    height,
    modules,
    crew,
    equipment,
    workOrders,
    entityCells: {
      crew: crewCells,
      equipment: equipmentCells,
      work: workCells,
    },
    constructionLayout,
  })

  const routesById = new Map<string, MapRoute>()
  if (activePlan) {
    plan.actions.forEach((action) => {
      const order = workOrders.find((candidate) => candidate.id === action.workOrderId)
      if (!order || action.kind === 'set_priority') return
      if (action.kind === 'assign_crew') {
        const member = crew.find((candidate) => candidate.id === action.crewId)
        if (!member) return
        routesById.set(`crew-${member.id}-${order.id}`, {
          id: `crew-${member.id}-${order.id}`,
          kind: 'crew',
          sourceLocation: member.location,
          destinationLocation: order.location,
          label: `${member.name} to ${order.label}`,
        })
        return
      }
      const item = equipment.find((candidate) => candidate.id === action.equipmentId)
      if (!item) return
      routesById.set(`equipment-${item.id}-${order.id}`, {
        id: `equipment-${item.id}-${order.id}`,
        kind: 'equipment',
        sourceLocation: item.location,
        destinationLocation: order.location,
        label: `${item.name} to ${order.label}`,
      })
    })
  }

  workOrders.filter((order) => order.status === 'queued' || order.status === 'active').forEach((order) => {
    order.assignedCrewIds.forEach((crewId) => {
      const member = crew.find((candidate) => candidate.id === crewId)
      if (!member) return
      routesById.set(`crew-${member.id}-${order.id}`, {
        id: `crew-${member.id}-${order.id}`,
        kind: 'crew',
        sourceLocation: member.location,
        destinationLocation: order.location,
        label: `${member.name} to ${order.label}`,
      })
    })
    order.reservedEquipmentIds.forEach((equipmentId) => {
      const item = equipment.find((candidate) => candidate.id === equipmentId)
      if (!item) return
      routesById.set(`equipment-${item.id}-${order.id}`, {
        id: `equipment-${item.id}-${order.id}`,
        kind: 'equipment',
        sourceLocation: item.location,
        destinationLocation: order.location,
        label: `${item.name} to ${order.label}`,
      })
    })
  })

  const routes = [...routesById.values()].filter((route) => route.sourceLocation !== route.destinationLocation)
  const vacantBuildSites = buildSites.filter((site) => !site.moduleId)
  const compatibleBuildSites = buildingLabel
    ? vacantBuildSites.filter((site) => site.compatible !== false)
    : []
  const inspectableModules = modules.filter((module) => module.type !== 'corridor')
  const previewSite = vacantBuildSites.find((site) => site.id === previewSiteId && site.compatible !== false)
  const ghostModule: ModuleState | null = previewSite && buildingPreview ? {
    id: 'module-build-preview',
    name: buildingPreview.name,
    type: buildingPreview.type,
    location: buildingPreview.location,
    position: previewSite.position,
    atmosphere: buildingPreview.atmosphere,
    condition: 100,
    powerPriority: 1,
    breached: false,
  } : null
  const placementSummary = buildingLabel
    ? ` ${compatibleBuildSites.length} compatible build sockets.`
    : ''
  const customRoomCount = constructionLayout ? detectRooms(constructionLayout).length : null
  const accessibleSummary = `${customRoomCount === null ? `${inspectableModules.length} base areas` : `${customRoomCount} player-built rooms`}, ${crew.length} crew, ${equipment.length} equipment items, and ${workOrders.length} work orders.${placementSummary}${dustActive ? ' Dust front active.' : ''}`

  const closeStackPicker = (restoreFocus = true) => {
    const trigger = stackPicker?.trigger
    setStackPicker(null)
    if (restoreFocus) trigger?.focus()
  }

  const dispatchInspectable = (tile: MapTileInspection, item: MapInspectable) => {
    const trigger = stackPicker?.trigger
    setSelectedCellKey(tile.key)
    setRovingCellKey(tile.key)
    setStackPicker(null)
    if (item.kind === 'crew' && onSelectCrew) {
      onSelectCrew(item.id)
    } else if (item.kind === 'equipment' && onSelectEquipment) {
      onSelectEquipment(item.id)
    } else if (item.kind === 'work' && onSelectWorkOrder) {
      onSelectWorkOrder(item.id as WorkOrderId)
    } else {
      onInspectTile?.(withFocusedMapItem(tile, item))
    }
    if (trigger) requestAnimationFrame(() => trigger.isConnected && trigger.focus())
  }

  const activateTile = (tile: MapTileInspection, trigger: HTMLElement | null) => {
    setSelectedCellKey(tile.key)
    setRovingCellKey(tile.key)
    if (tile.contents.length > 1) {
      const bounds = trigger?.getBoundingClientRect()
      const anchorRight = tile.cell.x >= Math.floor(width * 0.62)
      const anchorBottom = tile.cell.y >= Math.floor(height * 0.56)
      setStackPicker({
        tile,
        trigger,
        placement: {
          ...(anchorRight
            ? { right: Math.max(8, window.innerWidth - (bounds?.right ?? 0) + 10) }
            : { left: Math.max(8, (bounds?.left ?? 0) + 10) }),
          ...(anchorBottom
            ? { bottom: Math.max(8, window.innerHeight - (bounds?.top ?? 0) + 10) }
            : { top: Math.max(8, (bounds?.bottom ?? 0) + 10) }),
        },
      })
      return
    }
    setStackPicker(null)
    if (tile.contents.length === 1) {
      dispatchInspectable(tile, tile.contents[0])
      return
    }
    onInspectTile?.(withFocusedMapItem(tile, null))
  }

  const moveGridFocus = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    cell: GridPoint,
  ) => {
    let next: GridPoint
    if (event.key === 'ArrowLeft') next = { x: Math.max(0, cell.x - 1), y: cell.y }
    else if (event.key === 'ArrowRight') next = { x: Math.min(width - 1, cell.x + 1), y: cell.y }
    else if (event.key === 'ArrowUp') next = { x: cell.x, y: Math.max(0, cell.y - 1) }
    else if (event.key === 'ArrowDown') next = { x: cell.x, y: Math.min(height - 1, cell.y + 1) }
    else if (event.key === 'Home') next = { x: 0, y: cell.y }
    else if (event.key === 'End') next = { x: width - 1, y: cell.y }
    else return

    event.preventDefault()
    const nextKey = `${next.x}:${next.y}`
    setRovingCellKey(nextKey)
    mapRef.current?.querySelector<HTMLElement>(
      `[data-map-cell][data-grid-x="${next.x}"][data-grid-y="${next.y}"]`,
    )?.focus()
  }

  const handleStackPickerKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      closeStackPicker()
      return
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    const choices = [...(stackPickerRef.current?.querySelectorAll<HTMLButtonElement>(
      '.tile-stack-item, .tile-stack-surface',
    ) ?? [])]
    if (choices.length === 0) return
    event.preventDefault()
    const currentIndex = Math.max(0, choices.indexOf(document.activeElement as HTMLButtonElement))
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
    if (!stackPicker) return
    const frame = requestAnimationFrame(() => {
      stackPickerRef.current?.querySelector<HTMLButtonElement>('.tile-stack-item')?.focus()
    })
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (stackPickerRef.current?.contains(event.target as Node)) return
      setStackPicker(null)
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('pointerdown', closeOnOutsidePointer)
    }
  }, [stackPicker])

  return (
    <div
      aria-label={`Top-down interactive map of Shackleton Base. ${accessibleSummary}`}
      aria-roledescription="colony tile map"
      className={`moonbase-map ${constructionLayout ? 'freeform-operations' : ''} ${dustActive ? 'dust-active' : ''}`}
      data-custom-layout={constructionLayout ? 'true' : undefined}
      data-grid-height={height}
      data-grid-width={width}
      ref={mapRef}
      role="group"
      style={{
        gridTemplateColumns: `repeat(${width}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${height}, minmax(0, 1fr))`,
      }}
    >
      <MapTerrain dustActive={dustActive} height={height} width={width} />
      <div className="map-grid" aria-hidden="true" />
      {constructionLayout && <FreeformOperationsLayer layout={constructionLayout} />}
      <MapRoutes height={height} modules={modules} routes={routes} width={width} />

      {vacantBuildSites.flatMap((site) => {
        const compatible = Boolean(buildingLabel && site.compatible !== false)
        const previewed = compatible && previewSiteId === site.id
        return Array.from({ length: site.position.width * site.position.height }, (_, index) => {
          const localX = index % site.position.width
          const localY = Math.floor(index / site.position.width)
          const gridX = site.position.x + localX
          const gridY = site.position.y + localY
          const perimeter =
            localX === 0 ||
            localY === 0 ||
            localX === site.position.width - 1 ||
            localY === site.position.height - 1
          return (
            <span
              aria-hidden="true"
              className={[
                'build-site-tile',
                perimeter ? 'build-site-edge' : 'build-site-interior',
                compatible ? 'placement-ready' : '',
                previewed ? 'previewed' : '',
              ].filter(Boolean).join(' ')}
              data-build-site-id={site.id}
              data-grid-x={gridX}
              data-grid-y={gridY}
              key={`${site.id}-tile-${localX}-${localY}`}
              style={{
                gridColumn: `${gridX + 1}`,
                gridRow: `${gridY + 1}`,
                zIndex: 1,
              }}
            />
          )
        })
      })}

      {compatibleBuildSites.map((site) => {
        const previewed = previewSiteId === site.id
        return (
          <button
            aria-label={previewed
              ? `${buildingLabel} preview at ${site.label}. Selected build socket.`
              : `Preview ${buildingLabel} at ${site.label}`}
            className={[
              'build-site',
              'build-site-select-target',
              'placement-ready',
              previewed ? 'previewed' : '',
            ].filter(Boolean).join(' ')}
            data-grid-height={site.position.height}
            data-grid-width={site.position.width}
            data-grid-x={site.position.x}
            data-grid-y={site.position.y}
            key={site.id}
            onClick={() => onChooseBuildSite?.(site.id)}
            style={{
              gridColumn: `${site.position.x + 1} / span ${site.position.width}`,
              gridRow: `${site.position.y + 1} / span ${site.position.height}`,
            }}
            type="button"
          >
            <span className="build-site-label">
              <GameIcon name={previewed ? 'check' : 'plus'} size={16} />
              <strong>{previewed ? 'Selected' : site.label}</strong>
              <small>{previewed ? 'Confirm below' : buildingLabel}</small>
            </span>
          </button>
        )
      })}

      {ghostModule && (
        <ModuleTilemap
          ghost
          module={ghostModule}
          modules={modules}
          planned={false}
          selected={false}
        />
      )}

      {!constructionLayout && <ModuleConnectors modules={modules} />}

      {!constructionLayout && modules.map((module) => (
        <ModuleTilemap
          key={`${module.id}-tilemap`}
          module={module}
          modules={modules}
          planned={plannedLocations.has(module.location)}
          selected={selectedModuleId === module.id}
        />
      ))}

      {inspectableModules.map((module) => {
        const exterior = isExterior(module)
        const planned = plannedLocations.has(module.location)
        const moduleCrew = crew.filter((member) => member.location === module.location)
        const moduleEquipment = equipment.filter((item) => item.location === module.location)
        const moduleOrders = workOrders.filter((order) => order.location === module.location && order.status !== 'complete')
        const selected = selectedModuleId === module.id
        const presentation = modulePresentation[module.type]
        const pressureLabel = exterior ? 'exterior' : module.atmosphere === 'yes' ? 'pressurized' : module.atmosphere === 'low' ? 'low pressure' : 'vacuum'

        return (
          <button
            aria-label={`Inspect ${module.name}. ${pressureLabel}. Condition ${module.condition} percent${module.breached ? '. Hull breach open' : ''}. ${moduleCrew.length} crew, ${moduleEquipment.length} equipment, ${moduleOrders.length} open work orders.`}
            aria-pressed={selected}
            className={[
              'base-module',
              'module-select-target',
              `module-${module.type}`,
              exterior ? 'exterior' : `atmosphere-${module.atmosphere}`,
              module.breached ? 'breached' : '',
              planned ? 'planned' : '',
              selected ? 'selected' : '',
            ].filter(Boolean).join(' ')}
            key={module.id}
            onClick={() => onInspectModule(module.id)}
            style={{
              background: 'transparent',
              border: 0,
              boxShadow: 'none',
              gridColumn: `${module.position.x + 1} / span ${module.position.width}`,
              gridRow: `${module.position.y + 1} / span ${module.position.height}`,
              zIndex: 51,
            }}
            type="button"
          >
            <span className="module-caption">
              <span className="module-code"><GameIcon name={presentation.icon} size={11} />{presentation.code}</span>
              <strong>{module.name}</strong>
            </span>

            <span aria-hidden="true" className={`module-condition condition-${module.condition < 65 ? 'critical' : module.condition < 85 ? 'worn' : 'good'}`}>
              <span style={{ width: `${module.condition}%` }} />
            </span>

            <span className={`atmosphere-badge atmosphere-${module.atmosphere}`}>
              <GameIcon name="atmosphere" size={10} />
              <small>{pressureLabel}</small>
            </span>

            {module.breached && (
              <span aria-hidden="true" className="breach-marker breach-graphic">
                <GameIcon name="breach" size="100%" />
                <i className="breach-pulse-ring" />
              </span>
            )}

            {planned && (
              <span className="planned-tag"><GameIcon name="plan" size={8} /> routed</span>
            )}
          </button>
        )
      })}

      <div
        aria-colcount={width}
        aria-label="Inspectable colony tiles"
        aria-rowcount={height}
        className="map-tile-hit-layer"
        role="grid"
        style={{ gridTemplateRows: `repeat(${height}, minmax(0, 1fr))` }}
      >
        {Array.from({ length: height }, (_, row) => (
          <div
            className="map-tile-row"
            key={`map-row-${row}`}
            role="row"
            style={{
              gridRow: `${row + 1}`,
              gridTemplateColumns: `repeat(${width}, minmax(0, 1fr))`,
            }}
          >
            {Array.from({ length: width }, (_, column) => inspectionByCell.get(`${column}:${row}`))
              .filter((tile): tile is MapTileInspection => Boolean(tile))
              .map((tile) => {
                const selected = selectedCellKey === tile.key
                const stackOpen = stackPicker?.tile.key === tile.key
                return (
                  <button
                    aria-colindex={tile.cell.x + 1}
                    aria-expanded={tile.contents.length > 1 ? stackOpen : undefined}
                    aria-haspopup={tile.contents.length > 1 ? 'dialog' : undefined}
                    aria-label={describeMapTile(tile)}
                    aria-rowindex={tile.cell.y + 1}
                    className={[
                      'map-tile-target',
                      tile.contents.length > 0 ? 'has-items' : '',
                      tile.contents.length > 1 ? 'has-stack' : '',
                      selected ? 'is-selected' : '',
                      stackOpen ? 'is-stack-open' : '',
                    ].filter(Boolean).join(' ')}
                    data-grid-x={tile.cell.x}
                    data-grid-y={tile.cell.y}
                    data-map-cell="true"
                    key={`map-cell-${tile.key}`}
                    onClick={(event) => activateTile(tile, event.currentTarget)}
                    onFocus={() => setRovingCellKey(tile.key)}
                    onKeyDown={(event) => moveGridFocus(event, tile.cell)}
                    role="gridcell"
                    style={{ gridColumn: `${tile.cell.x + 1}` }}
                    tabIndex={rovingCellKey === tile.key ? 0 : -1}
                    title={tile.contents.length > 1
                      ? `${tile.contents.length} things here — click to choose`
                      : describeMapTile(tile)}
                    type="button"
                  />
                )
              })}
          </div>
        ))}
      </div>

      {workOrders.map((order, index) => {
        const presentation = workOrderPresentation[order.type]
        const ordinal = locationOrdinal(workOrders, index)
        const selected = selectedWorkOrderId === order.id
        const staged = plannedWorkIds.has(order.id)
        const module = moduleAt(order.location)
        const progress = Math.min(100, Math.round((order.progressHours / order.durationHours) * 100))
        return (
          <button
            aria-label={`Select work order ${order.label}. ${words(order.status)} at ${module.name}. Priority ${order.priority}. ${progress} percent complete${staged ? '. Routed in the current plan' : ''}.`}
            aria-pressed={selectedWorkOrderId == null ? undefined : selected}
            className={[
              'work-hotspot',
              `order-${order.type}`,
              `status-${order.status}`,
              staged ? 'staged' : '',
              selected ? 'selected' : '',
            ].filter(Boolean).join(' ')}
            key={order.id}
            data-grid-x={workCells.get(order.id)?.x}
            data-grid-y={workCells.get(order.id)?.y}
            onClick={(event) => {
              event.stopPropagation()
              const cell = workCells.get(order.id)
              const tile = cell ? inspectionByCell.get(`${cell.x}:${cell.y}`) : null
              const item = tile?.contents.find((candidate) => (
                candidate.kind === 'work' && candidate.id === order.id
              ))
              if (tile && item) dispatchInspectable(tile, item)
              else onSelectWorkOrder?.(order.id)
            }}
            style={markerPosition(workCells.get(order.id) ?? markerCell(`work:${order.id}`, order.location, ordinal + locationPopulation(order.location), 2))}
            title={`${order.label} — ${words(order.status)}`}
            type="button"
          >
            <span aria-hidden="true" className="hotspot-pulse" />
            <GameIcon name={presentation.icon} size={15} />
            <span aria-hidden="true" className="hotspot-index">{index + 1}</span>
            <span className="map-token-label">{presentation.label}</span>
            <span aria-hidden="true" className="hotspot-progress"><i style={{ width: `${progress}%` }} /></span>
          </button>
        )
      })}

      {crew.map((member, index) => {
        const ordinal = locationOrdinal(crew, index)
        const selected = selectedCrewId === member.id
        const module = moduleAt(member.location)
        return (
          <button
            aria-label={`Select ${member.name}, ${member.role}. ${words(member.status)} in ${module.name}. Health ${member.health} percent, fatigue ${member.fatigue} percent.`}
            aria-pressed={selectedCrewId == null ? undefined : selected}
            className={[
              'crew-marker',
              'crew-pawn',
              'map-token',
              member.status,
              selected ? 'selected' : '',
            ].filter(Boolean).join(' ')}
            key={member.id}
            data-grid-x={crewCells.get(member.id)?.x}
            data-grid-y={crewCells.get(member.id)?.y}
            onClick={(event) => {
              event.stopPropagation()
              const cell = crewCells.get(member.id)
              const tile = cell ? inspectionByCell.get(`${cell.x}:${cell.y}`) : null
              const item = tile?.contents.find((candidate) => (
                candidate.kind === 'crew' && candidate.id === member.id
              ))
              if (tile && item) dispatchInspectable(tile, item)
              else onSelectCrew?.(member.id)
            }}
            style={markerPosition(crewCells.get(member.id) ?? markerCell(`crew:${member.id}`, member.location, ordinal))}
            title={`${member.name} — ${words(member.status)}`}
            type="button"
          >
            <PawnSprite
              accent={pawnAccents[index % pawnAccents.length]}
              initials={initials(member.name)}
              showStatusDot
              status={member.status}
              variant={pawnVariants[index % pawnVariants.length]}
            />
            <span className="map-token-label crew-label">{member.name.split(' ')[0]}</span>
          </button>
        )
      })}

      {equipment.map((item, index) => {
        const ordinal = locationOrdinal(equipment, index)
        const selected = selectedEquipmentId === item.id
        const module = moduleAt(item.location)
        const presentation = equipmentPresentation[item.type]
        return (
          <button
            aria-label={`Select ${item.name}. ${words(item.status)} in ${module.name}. Condition ${item.condition} percent${item.reservedForWorkOrderId ? `. Reserved for ${item.reservedForWorkOrderId}` : ''}.`}
            aria-pressed={selectedEquipmentId == null ? undefined : selected}
            className={[
              'equipment-marker',
              'equipment-token',
              'map-token',
              item.status,
              `equipment-${item.type}`,
              selected ? 'selected' : '',
            ].filter(Boolean).join(' ')}
            key={item.id}
            data-grid-x={equipmentCells.get(item.id)?.x}
            data-grid-y={equipmentCells.get(item.id)?.y}
            onClick={(event) => {
              event.stopPropagation()
              const cell = equipmentCells.get(item.id)
              const tile = cell ? inspectionByCell.get(`${cell.x}:${cell.y}`) : null
              const inspectable = tile?.contents.find((candidate) => (
                candidate.kind === 'equipment' && candidate.id === item.id
              ))
              if (tile && inspectable) dispatchInspectable(tile, inspectable)
              else onSelectEquipment?.(item.id)
            }}
            style={markerPosition(equipmentCells.get(item.id) ?? markerCell(`equipment:${item.id}`, item.location, ordinal + locationPopulation(item.location), 1))}
            title={`${item.name} — ${words(item.status)} at ${module.name}`}
            type="button"
          >
            <span aria-hidden="true" className="equipment-plate">
              <GameIcon name={presentation.icon} size={15} />
              <i className="equipment-status-dot" />
            </span>
            <span aria-hidden="true" className="equipment-code">{presentation.code}</span>
            <span className="map-token-label equipment-label">{item.name}</span>
          </button>
        )
      })}

      {[...inspectionByCell.values()]
        .filter((tile) => tile.contents.length > 1)
        .map((tile) => (
          <button
            aria-expanded={stackPicker?.tile.key === tile.key}
            aria-haspopup="dialog"
            aria-label={`Choose ${tile.contents.length} overlapping items on column ${tile.cell.x + 1}, row ${tile.cell.y + 1}: ${tile.contents.map((item) => item.label).join(', ')}`}
            className="tile-stack-trigger"
            data-grid-x={tile.cell.x}
            data-grid-y={tile.cell.y}
            key={`stack-trigger-${tile.key}`}
            onClick={(event) => {
              event.stopPropagation()
              activateTile(tile, event.currentTarget)
            }}
            style={{
              gridColumn: `${tile.cell.x + 1}`,
              gridRow: `${tile.cell.y + 1}`,
              zIndex: 60,
            }}
            title={`Choose from ${tile.contents.length} things here`}
            type="button"
          >
            {tile.contents.length}
          </button>
        ))}

      {stackPicker && createPortal((
        <section
          aria-labelledby="tile-stack-title"
          className={[
            'tile-stack-popover',
            'portal-layer',
            stackPicker.tile.cell.x >= Math.floor(width * 0.62) ? 'anchor-right' : 'anchor-left',
            stackPicker.tile.cell.y >= Math.floor(height * 0.56) ? 'anchor-bottom' : 'anchor-top',
          ].join(' ')}
          data-grid-x={stackPicker.tile.cell.x}
          data-grid-y={stackPicker.tile.cell.y}
          onKeyDown={handleStackPickerKeyDown}
          ref={stackPickerRef}
          role="dialog"
          style={stackPicker.placement}
        >
          <header className="tile-stack-header">
            <span className="tile-stack-heading-icon"><GameIcon name="inspect" /></span>
            <span>
              <small>Tile {String(stackPicker.tile.cell.x + 1).padStart(2, '0')} · {String(stackPicker.tile.cell.y + 1).padStart(2, '0')}</small>
              <strong id="tile-stack-title">Choose an item</strong>
              <em>{stackPicker.tile.contents.length} things here</em>
            </span>
            <button
              aria-label="Close item picker"
              className="tile-stack-close"
              onClick={() => closeStackPicker()}
              type="button"
            >
              <GameIcon name="close" />
            </button>
          </header>

          <div className="tile-stack-list">
            {stackPicker.tile.contents.map((item) => (
              <button
                className={`tile-stack-item stack-kind-${item.kind}`}
                key={item.key}
                onClick={() => dispatchInspectable(stackPicker.tile, item)}
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

          <button
            className="tile-stack-surface"
            onClick={() => {
              const trigger = stackPicker.trigger
              setStackPicker(null)
              onInspectTile?.(withFocusedMapItem(stackPicker.tile, null))
              requestAnimationFrame(() => trigger?.isConnected && trigger.focus())
            }}
            type="button"
          >
            <span className="tile-stack-item-icon"><GameIcon name={mapTileIcon(stackPicker.tile)} /></span>
            <span className="tile-stack-item-copy">
              <strong>{stackPicker.tile.surfaceLabel}</strong>
              <small>{stackPicker.tile.roomLabel ?? 'Exterior'} · Inspect tile surface</small>
            </span>
            <GameIcon className="tile-stack-chevron" name="chevron" />
          </button>
        </section>
      ), document.body)}

      {dustActive && (
        <div aria-hidden="true" className="dust-warning-flag">
          <GameIcon name="dust" size={13} />
          <span>Dust front</span>
        </div>
      )}

      <div className="map-north" aria-hidden="true"><span>N</span><i /></div>
      <div className="map-scale" aria-hidden="true"><i />20 m</div>
    </div>
  )
}
