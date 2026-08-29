import type { CSSProperties } from 'react'
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
import { ModuleConnectors, ModuleTilemap } from './ModuleTilemap'
import { getModuleWalkableCells } from './moduleTileGeometry'

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

const constructionDoorAxis = (layout: ConstructionLayout, point: GridPoint) => {
  const hasBoundary = (x: number, y: number) => layout.boundaries.some(
    (boundary) => boundary.x === x && boundary.y === y,
  )
  const horizontal = hasBoundary(point.x - 1, point.y) || hasBoundary(point.x + 1, point.y)
  const vertical = hasBoundary(point.x, point.y - 1) || hasBoundary(point.x, point.y + 1)
  return horizontal && !vertical ? 'horizontal' : 'vertical'
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

      {layout.boundaries.map((boundary) => (
        <span
          aria-hidden="true"
          className={`construction-boundary boundary-${boundary.kind} ${boundary.kind === 'door' ? `door-${constructionDoorAxis(layout, boundary)}` : ''}`}
          data-freeform-boundary={boundary.kind}
          data-grid-x={boundary.x}
          data-grid-y={boundary.y}
          key={`operations-boundary-${boundary.x}-${boundary.y}`}
          style={{ gridColumn: `${boundary.x + 1}`, gridRow: `${boundary.y + 1}` }}
        >
          <i />
        </span>
      ))}

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
  buildSites = [],
  buildingLabel = null,
  buildingPreview = null,
  previewSiteId = null,
  onChooseBuildSite,
  constructionLayout = null,
}: MoonbaseMapProps) {
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

  const markerPosition = (
    markerKey: string,
    location: LocationId,
    index: number,
    lane = 0,
  ): CSSProperties => {
    const module = moduleAt(location)
    const walkableCells = getModuleWalkableCells(module)
    const slot = Math.max(0, index + lane * 2)
    const cell = customMarkerCells.get(markerKey) ?? walkableCells[slot % walkableCells.length]
    return {
      gridColumn: `${cell.x + 1} / span 1`,
      gridRow: `${cell.y + 1} / span 1`,
      pointerEvents: 'auto',
      zIndex: 50,
    }
  }

  const locationOrdinal = <T extends { location: LocationId }>(items: T[], itemIndex: number) =>
    items.slice(0, itemIndex).filter((item) => item.location === items[itemIndex].location).length

  const locationPopulation = (location: LocationId) =>
    crew.filter((member) => member.location === location).length

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

  return (
    <div
      aria-label={`Top-down interactive map of Shackleton Base. ${accessibleSummary}`}
      aria-roledescription="colony tile map"
      className={`moonbase-map ${constructionLayout ? 'freeform-operations' : ''} ${dustActive ? 'dust-active' : ''}`}
      data-custom-layout={constructionLayout ? 'true' : undefined}
      data-grid-height={height}
      data-grid-width={width}
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
              zIndex: constructionLayout
                ? 40 - Math.min(30, module.position.width * module.position.height)
                : 4,
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
            onClick={() => {
              onInspectModule(module.id)
              onSelectWorkOrder?.(order.id)
            }}
            style={markerPosition(`work:${order.id}`, order.location, ordinal + locationPopulation(order.location), 2)}
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
            onClick={() => {
              onInspectModule(module.id)
              onSelectCrew?.(member.id)
            }}
            style={markerPosition(`crew:${member.id}`, member.location, ordinal)}
            title={`${member.name} — ${words(member.status)}`}
            type="button"
          >
            <span aria-hidden="true" className="pawn-shadow" />
            <span aria-hidden="true" className="pawn-portrait">
              <GameIcon name="pawn" size={14} />
              <i className="pawn-status-dot" />
            </span>
            <span aria-hidden="true" className="pawn-initials">{initials(member.name)}</span>
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
            onClick={() => {
              onInspectModule(module.id)
              onSelectEquipment?.(item.id)
            }}
            style={markerPosition(`equipment:${item.id}`, item.location, ordinal + locationPopulation(item.location), 1)}
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
