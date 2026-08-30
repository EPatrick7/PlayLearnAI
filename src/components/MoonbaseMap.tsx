import {
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import {
  detectRooms,
  getWorkstationFootprintSize,
  isInConstructionBounds,
  type ConstructionLayout,
  type GridPoint,
} from '../game/construction'
import {
  WORKSTATION_SPECS,
  type WorkstationKind,
} from '../game/constructionCatalog'
import {
  carriedConstructionMaterial,
  projectConstructionOrders,
  type ConstructionOrder,
} from '../game/constructionJobs'
import type { ConstructionCrewPosition } from '../game/constructionWorkerRouting'
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
  constructionOrderActivity,
  constructionOrderProgress,
  describeMapTile,
  withFocusedMapItem,
  type MapInspectable,
  type MapTileInspection,
} from './mapInspection'
import { ModuleConnectors, ModuleTilemap } from './ModuleTilemap'
import { getModuleWalkableCells } from './moduleTileGeometry'
import { PawnSprite, type PawnSpriteVariant } from './PawnSprite'
import { TileStackPicker } from './TileStackPicker'
import { LunarTerrain } from './LunarTerrain'

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
  /** Unfinished worker-built designations shown over the completed layout. */
  constructionOrders?: readonly ConstructionOrder[]
  /** Physical colonist positions from the construction simulation. */
  constructionCrew?: readonly ConstructionCrewPosition[]
  /** Keeps worker and blueprint activity labels honest while time is stopped. */
  constructionPaused?: boolean
  terrainSeed?: number
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

const initials = (name: string) => name
  .split(/\s+/)
  .filter(Boolean)
  .map((part) => part[0])
  .join('')
  .slice(0, 2)
  .toUpperCase()

const materialAmount = (value: number) => {
  const rounded = Math.round(value * 10) / 10
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}

const constructionActivityIcon = (order: ConstructionOrder) => {
  if (order.block) return 'warning' as const
  if (order.travelPhase === 'to_stockpile') return 'storage' as const
  if (order.travelPhase === 'to_site') return 'map' as const
  return 'work' as const
}

const constructionOrderLabel = (order: ConstructionOrder) => {
  if (order.target.kind === 'boundary') {
    const boundary = order.target.construct ?? order.target.deconstruct
    const subject = boundary?.kind === 'door' ? 'Door' : 'Wall'
    return order.operation === 'deconstruct' ? `Deconstruct ${subject.toLowerCase()}` : subject
  }
  const workstation = order.target.construct ?? order.target.deconstruct
  return order.operation === 'deconstruct'
    ? `Deconstruct ${workstation?.label ?? 'workstation'}`
    : workstation?.label ?? 'Workstation'
}

function OperationsConstructionLayer({
  completedLayout,
  planningLayout,
  orders,
  paused,
}: {
  completedLayout: ConstructionLayout
  planningLayout: ConstructionLayout
  orders: readonly ConstructionOrder[]
  paused: boolean
}) {
  return orders.filter((order) => order.status !== 'complete').map((order) => {
    const progress = constructionOrderProgress(order)
    const activity = constructionOrderActivity(order, paused)

    if (order.target.kind === 'boundary') {
      const cell = order.target.cells[0]
      const boundary = order.target.construct ?? order.target.deconstruct
      if (!boundary) return null
      const connectionLayout = order.target.construct ? planningLayout : completedLayout
      const connection = getBoundaryConnection(connectionLayout, cell)
      const doorAxis = boundary.kind === 'door'
        ? getBoundaryDoorAxis(connection.mask)
        : null
      return (
        <span
          aria-label={`${constructionOrderLabel(order)} blueprint, ${activity}, ${progress} percent`}
          className={`operations-blueprint construction-blueprint construction-blueprint-boundary construction-boundary boundary-${boundary.kind} blueprint-${order.operation} status-${order.status} ${connection.className} ${doorAxis ? `door-airlock door-${doorAxis}` : ''}`}
          data-boundary-connection={connection.name}
          data-boundary-mask={connection.mask}
          data-connect-east={connection.mask & BOUNDARY_CONNECTION_BITS.east ? 'true' : undefined}
          data-connect-north={connection.mask & BOUNDARY_CONNECTION_BITS.north ? 'true' : undefined}
          data-connect-south={connection.mask & BOUNDARY_CONNECTION_BITS.south ? 'true' : undefined}
          data-connect-west={connection.mask & BOUNDARY_CONNECTION_BITS.west ? 'true' : undefined}
          data-construction-order-id={order.id}
          data-construction-order-status={order.status}
          data-door-axis={doorAxis ?? undefined}
          data-door-texture={doorAxis ? 'airlock' : undefined}
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
        className={`operations-blueprint construction-blueprint construction-blueprint-workstation blueprint-${order.operation} status-${order.status}`}
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
  })
}

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
        const doorAxis = boundary.kind === 'door'
          ? getBoundaryDoorAxis(connection.mask)
          : null
        return (
          <span
            aria-hidden="true"
            className={`construction-boundary boundary-${boundary.kind} ${connection.className} ${doorAxis ? `door-airlock door-${doorAxis}` : ''}`}
            data-boundary-connection={connection.name}
            data-boundary-mask={connection.mask}
            data-connect-east={connection.mask & BOUNDARY_CONNECTION_BITS.east ? 'true' : undefined}
            data-connect-north={connection.mask & BOUNDARY_CONNECTION_BITS.north ? 'true' : undefined}
            data-connect-south={connection.mask & BOUNDARY_CONNECTION_BITS.south ? 'true' : undefined}
            data-connect-west={connection.mask & BOUNDARY_CONNECTION_BITS.west ? 'true' : undefined}
            data-door-axis={doorAxis ?? undefined}
            data-door-texture={doorAxis ? 'airlock' : undefined}
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
  constructionOrders = [],
  constructionCrew = [],
  constructionPaused = false,
  terrainSeed = 240826,
}: MoonbaseMapProps) {
  const [rovingCellKey, setRovingCellKey] = useState('0:0')
  const [selectedCellKey, setSelectedCellKey] = useState<string | null>(null)
  const [stackPicker, setStackPicker] = useState<{
    tile: MapTileInspection
    trigger: HTMLElement | null
    preferredItemKey: string | null
  } | null>(null)
  const mapRef = useRef<HTMLDivElement>(null)
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

  const openConstructionOrders = constructionOrders.filter((order) => order.status !== 'complete')
  const constructionAssignmentByCrewId = new Map<string, ConstructionOrder>()
  openConstructionOrders.forEach((order) => {
    if (order.assignedCrewId && !constructionAssignmentByCrewId.has(order.assignedCrewId)) {
      constructionAssignmentByCrewId.set(order.assignedCrewId, order)
    }
  })
  const liveConstructionCrewCells = new Map<string, GridPoint>()
  if (constructionLayout) {
    constructionCrew.forEach((position) => {
      if (
        constructionAssignmentByCrewId.has(position.crewId)
        && isInConstructionBounds(position.cell, constructionLayout)
      ) {
        liveConstructionCrewCells.set(position.crewId, { ...position.cell })
      }
    })
  }

  const customMarkerCells = new Map<string, GridPoint>()
  if (constructionLayout) {
    const occupied = new Set(
      [...liveConstructionCrewCells.values()].map((cell) => `${cell.x}:${cell.y}`),
    )
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

    crew.forEach((member, index) => {
      const liveCell = liveConstructionCrewCells.get(member.id)
      if (liveCell) customMarkerCells.set(`crew:${member.id}`, liveCell)
      else allocateMarker(`crew:${member.id}`, member.location, index)
    })
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
    liveConstructionCrewCells.get(member.id)
      ?? markerCell(`crew:${member.id}`, member.location, locationOrdinal(crew, index)),
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
    constructionOrders,
    constructionPaused,
    constructionCrewNames: new Map(crew.map((member) => [member.id, member.name])),
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
  const constructionPlanningLayout = constructionLayout
    ? projectConstructionOrders(constructionLayout, constructionOrders).layout
    : null
  const placementSummary = buildingLabel
    ? ` ${compatibleBuildSites.length} compatible build sockets.`
    : ''
  const customRoomCount = constructionLayout ? detectRooms(constructionLayout).length : null
  const constructionSummary = openConstructionOrders.length > 0
    ? ` ${openConstructionOrders.length} active construction ${openConstructionOrders.length === 1 ? 'blueprint' : 'blueprints'}.`
    : ''
  const accessibleSummary = `${customRoomCount === null ? `${inspectableModules.length} base areas` : `${customRoomCount} player-built rooms`}, ${crew.length} crew, ${equipment.length} equipment items, and ${workOrders.length} work orders.${constructionSummary}${placementSummary}${dustActive ? ' Dust front active.' : ''}`

  const dispatchInspectable = (tile: MapTileInspection, item: MapInspectable) => {
    setSelectedCellKey(tile.key)
    setRovingCellKey(tile.key)
    if (
      item.kind === 'crew'
      && constructionAssignmentByCrewId.has(item.id)
      && onInspectTile
    ) {
      onInspectTile(withFocusedMapItem(tile, item))
    } else if (item.kind === 'crew' && onSelectCrew) {
      onSelectCrew(item.id)
    } else if (item.kind === 'equipment' && onSelectEquipment) {
      onSelectEquipment(item.id)
    } else if (item.kind === 'work' && onSelectWorkOrder) {
      onSelectWorkOrder(item.id as WorkOrderId)
    } else {
      onInspectTile?.(withFocusedMapItem(tile, item))
    }
  }

  const activateTile = (
    tile: MapTileInspection,
    trigger: HTMLElement | null,
    preferredItemKey: string | null = null,
  ) => {
    setSelectedCellKey(tile.key)
    setRovingCellKey(tile.key)
    if (tile.contents.length > 1) {
      setStackPicker({ tile, trigger, preferredItemKey })
      return
    }
    setStackPicker(null)
    const preferredItem = preferredItemKey
      ? tile.contents.find((item) => item.key === preferredItemKey) ?? null
      : null
    const item = preferredItem ?? tile.contents[0] ?? null
    if (item) {
      dispatchInspectable(tile, item)
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
      <LunarTerrain dustActive={dustActive} height={height} seed={terrainSeed} width={width} />
      <div className="map-grid" aria-hidden="true" />
      {constructionLayout && <FreeformOperationsLayer layout={constructionLayout} />}
      {constructionLayout && constructionPlanningLayout && openConstructionOrders.length > 0 && (
        <OperationsConstructionLayer
          completedLayout={constructionLayout}
          orders={openConstructionOrders}
          paused={constructionPaused}
          planningLayout={constructionPlanningLayout}
        />
      )}
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
        const cell = workCells.get(order.id)
        const inspectionTile = cell ? inspectionByCell.get(`${cell.x}:${cell.y}`) : null
        const inspectable = inspectionTile?.contents.find((candidate) => (
          candidate.kind === 'work' && candidate.id === order.id
        )) ?? null
        const stacked = Boolean(inspectionTile && inspectionTile.contents.length > 1)
        return (
          <button
            aria-expanded={stacked ? stackPicker?.tile.key === inspectionTile?.key : undefined}
            aria-haspopup={stacked ? 'dialog' : undefined}
            aria-label={`Select work order ${order.label}. ${words(order.status)} at ${module.name}. Priority ${order.priority}. ${progress} percent complete${staged ? '. Routed in the current plan' : ''}.${stacked ? ` ${inspectionTile!.contents.length} things share this tile; activate to choose.` : ''}`}
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
              if (inspectionTile && inspectable) {
                activateTile(inspectionTile, event.currentTarget, inspectable.key)
              } else {
                onSelectWorkOrder?.(order.id)
              }
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
        const constructionOrder = constructionAssignmentByCrewId.get(member.id)
        const constructionActivity = constructionOrder
          ? constructionOrderActivity(constructionOrder, constructionPaused)
          : null
        const constructionActivityClass = constructionActivity
          ?.toLowerCase()
          .replaceAll(' ', '-') ?? null
        const carriedMaterial = constructionOrder?.materials.carriedByCrewId === member.id
          ? carriedConstructionMaterial(constructionOrder)
          : 0
        const activelyConstructing = Boolean(
          constructionOrder && !constructionPaused && !constructionOrder.block,
        )
        const cell = crewCells.get(member.id)
        const inspectionTile = cell ? inspectionByCell.get(`${cell.x}:${cell.y}`) : null
        const inspectable = inspectionTile?.contents.find((candidate) => (
          candidate.kind === 'crew' && candidate.id === member.id
        )) ?? null
        const stacked = Boolean(inspectionTile && inspectionTile.contents.length > 1)
        const selectionLabel = constructionOrder
          ? `Select ${member.name}, ${member.role}. ${constructionActivity}, ${constructionOrderLabel(constructionOrder)}${carriedMaterial > 0 ? `, carrying ${materialAmount(carriedMaterial)} construction material` : ''}. Health ${member.health} percent, fatigue ${member.fatigue} percent.`
          : `Select ${member.name}, ${member.role}. ${words(member.status)} in ${module.name}. Health ${member.health} percent, fatigue ${member.fatigue} percent.`
        return (
          <button
            aria-expanded={stacked ? stackPicker?.tile.key === inspectionTile?.key : undefined}
            aria-haspopup={stacked ? 'dialog' : undefined}
            aria-label={`${selectionLabel}${stacked ? ` ${inspectionTile!.contents.length} things share this tile; activate to choose.` : ''}`}
            aria-pressed={selectedCrewId == null ? undefined : selected}
            className={[
              'crew-marker',
              'crew-pawn',
              'map-token',
              member.status,
              constructionOrder ? 'operations-construction-worker' : '',
              constructionActivityClass ? `worker-${constructionActivityClass}` : '',
              carriedMaterial > 0 ? 'worker-carrying' : '',
              selected ? 'selected' : '',
            ].filter(Boolean).join(' ')}
            key={member.id}
            data-construction-worker-id={constructionOrder ? member.id : undefined}
            data-construction-worker-state={constructionActivityClass ?? undefined}
            data-grid-x={crewCells.get(member.id)?.x}
            data-grid-y={crewCells.get(member.id)?.y}
            data-order-id={constructionOrder?.id}
            onClick={(event) => {
              event.stopPropagation()
              if (inspectionTile && inspectable) {
                activateTile(inspectionTile, event.currentTarget, inspectable.key)
              } else {
                onSelectCrew?.(member.id)
              }
            }}
            style={markerPosition(crewCells.get(member.id) ?? markerCell(`crew:${member.id}`, member.location, ordinal))}
            title={`${member.name} — ${constructionActivity ?? words(member.status)}`}
            type="button"
          >
            <PawnSprite
              accent={pawnAccents[index % pawnAccents.length]}
              initials={initials(member.name)}
              showStatusDot
              status={activelyConstructing ? 'working' : member.status}
              variant={pawnVariants[index % pawnVariants.length]}
            />
            {constructionOrder && (
              <span aria-hidden="true" className="operations-worker-task">
                <GameIcon name={constructionActivityIcon(constructionOrder)} />
              </span>
            )}
            {carriedMaterial > 0 && (
              <span aria-hidden="true" className="operations-worker-cargo">
                <GameIcon name="storage" /><b>{materialAmount(carriedMaterial)}</b>
              </span>
            )}
            <span className="map-token-label crew-label">{member.name.split(' ')[0]}</span>
          </button>
        )
      })}

      {equipment.map((item, index) => {
        const ordinal = locationOrdinal(equipment, index)
        const selected = selectedEquipmentId === item.id
        const module = moduleAt(item.location)
        const presentation = equipmentPresentation[item.type]
        const cell = equipmentCells.get(item.id)
        const inspectionTile = cell ? inspectionByCell.get(`${cell.x}:${cell.y}`) : null
        const inspectable = inspectionTile?.contents.find((candidate) => (
          candidate.kind === 'equipment' && candidate.id === item.id
        )) ?? null
        const stacked = Boolean(inspectionTile && inspectionTile.contents.length > 1)
        return (
          <button
            aria-expanded={stacked ? stackPicker?.tile.key === inspectionTile?.key : undefined}
            aria-haspopup={stacked ? 'dialog' : undefined}
            aria-label={`Select ${item.name}. ${words(item.status)} in ${module.name}. Condition ${item.condition} percent${item.reservedForWorkOrderId ? `. Reserved for ${item.reservedForWorkOrderId}` : ''}.${stacked ? ` ${inspectionTile!.contents.length} things share this tile; activate to choose.` : ''}`}
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
              if (inspectionTile && inspectable) {
                activateTile(inspectionTile, event.currentTarget, inspectable.key)
              } else {
                onSelectEquipment?.(item.id)
              }
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
            <GameIcon name="inspect" />
            <span>{tile.contents.length}</span>
          </button>
        ))}

      {stackPicker && (
        <TileStackPicker
          gridHeight={height}
          gridWidth={width}
          onClose={() => setStackPicker(null)}
          onSelectItem={dispatchInspectable}
          onSelectSurface={(tile) => onInspectTile?.(withFocusedMapItem(tile, null))}
          preferredItemKey={stackPicker.preferredItemKey}
          tile={stackPicker.tile}
          trigger={stackPicker.trigger}
        />
      )}

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
