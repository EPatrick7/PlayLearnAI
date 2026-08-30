import {
  detectRooms,
  getWorkstationCells,
  getWorkstationFootprintSize,
  type ConstructionLayout,
  type GridPoint,
} from '../game/construction'
import { getBoundaryConnection, getBoundaryDoorAxis } from '../game/boundaryConnections'
import {
  WORKSTATION_SPECS,
  type WorkstationKind,
} from '../game/constructionCatalog'
import {
  carriedConstructionMaterial,
  constructionMaterialAccountedFor,
  type ConstructionOrder,
} from '../game/constructionJobs'
import type {
  CrewMember,
  Equipment,
  ModuleState,
  WorkOrder,
} from '../game/types'
import type { GameIconName } from './GameIcon'
import {
  crewPawnPresentation,
  type CrewPawnPresentation,
} from './crewPawnPresentation'

export type MapInspectableKind =
  | 'crew'
  | 'equipment'
  | 'work'
  | 'stockpile'
  | 'blueprint'
  | 'workstation'
  | 'boundary'

export interface MapInspectionStat {
  label: string
  value: string
}

export interface MapInspectable {
  key: string
  kind: MapInspectableKind
  id: string
  label: string
  subtitle: string
  detail: string
  icon: GameIconName
  portrait?: CrewPawnPresentation
  cell: GridPoint
  stats: MapInspectionStat[]
}

export type MapSurfaceKind =
  | 'terrain'
  | 'floor'
  | 'wall'
  | 'door'
  | 'corridor'
  | 'solar'
  | 'landing-pad'

export interface MapTileInspection {
  key: string
  cell: GridPoint
  surfaceKind: MapSurfaceKind
  surfaceLabel: string
  surfaceDetail: string
  roomId: string | null
  roomLabel: string | null
  roomArea: number | null
  moduleId: string | null
  moduleName: string | null
  atmosphere: ModuleState['atmosphere'] | 'exterior'
  contents: MapInspectable[]
  focusedItem: MapInspectable | null
}

export interface MapEntityCells {
  crew: Map<string, GridPoint>
  equipment: Map<string, GridPoint>
  work: Map<string, GridPoint>
}

export interface BuildMapInspectionInput {
  width: number
  height: number
  modules: ModuleState[]
  crew: CrewMember[]
  equipment: Equipment[]
  workOrders: WorkOrder[]
  entityCells: MapEntityCells
  constructionLayout?: ConstructionLayout | null
  /**
   * Construction designations that should be inspectable on the map. Complete
   * orders are intentionally ignored because their completed target is already
   * represented by `constructionLayout`.
   */
  constructionOrders?: readonly ConstructionOrder[]
  /** Whether construction simulation is currently paused. */
  constructionPaused?: boolean
  /** Optional display-name override for workers referenced by construction orders. */
  constructionCrewNames?: ReadonlyMap<string, string>
  /** Physical pickup point for worker-built construction material. */
  constructionStockpile?: {
    cell: GridPoint
    stored: number
    reserved: number
    available: number
  } | null
}

const pointKey = ({ x, y }: GridPoint) => `${x}:${y}`

const words = (value: string) => value.replaceAll('_', ' ').replaceAll('-', ' ')

const titleCase = (value: string) => words(value)
  .split(' ')
  .filter(Boolean)
  .map((word) => word[0].toUpperCase() + word.slice(1))
  .join(' ')

const equipmentIcons: Record<Equipment['type'], GameIconName> = {
  eva_suit: 'evaSuit',
  engineering_kit: 'engineeringKit',
  medical_kit: 'medicalKit',
  rover: 'rover',
}

const workIcons: Record<WorkOrder['type'], GameIconName> = {
  seal_breach: 'breach',
  repressurize_lab: 'atmosphere',
  research: 'research',
  clean_solar: 'solar',
}

const inspectableOrder: Record<MapInspectableKind, number> = {
  crew: 0,
  work: 1,
  equipment: 2,
  stockpile: 3,
  blueprint: 4,
  workstation: 5,
  boundary: 6,
}

const clampRatio = (value: number) => Number.isFinite(value)
  ? Math.min(1, Math.max(0, value))
  : 0

/** Matches the combined hauling/building progress shown on construction ghosts. */
export const constructionOrderProgress = (order: ConstructionOrder) => {
  const haulingShare = order.materials.required > 0 ? 0.35 : 0
  const hauling = order.materials.required > 0
    ? clampRatio(constructionMaterialAccountedFor(order) / order.materials.required) * haulingShare
    : 0
  const building = order.work.required > 0
    ? clampRatio(order.work.completed / order.work.required) * (1 - haulingShare)
    : 1 - haulingShare
  return Math.round(clampRatio(hauling + building) * 100)
}

export const constructionOrderPresentation = (order: ConstructionOrder) => {
  if (order.target.kind === 'boundary') {
    const boundary = order.target.construct ?? order.target.deconstruct
    const subject = boundary?.kind === 'door' ? 'Door' : 'Wall'
    return {
      icon: boundary?.kind === 'door' ? 'door' as const : 'wall' as const,
      label: order.operation === 'deconstruct' ? `Deconstruct ${subject.toLowerCase()}` : `${subject} blueprint`,
      detail: order.operation === 'deconstruct'
        ? `Remove the ${subject.toLowerCase()} on this tile.`
        : order.operation === 'replace'
          ? `Replace the existing structure with a ${subject.toLowerCase()}.`
          : `Build a one-tile ${subject.toLowerCase()}.`,
    }
  }

  const workstation = order.target.construct ?? order.target.deconstruct
  const kind = workstation?.type as WorkstationKind | undefined
  const spec = kind ? WORKSTATION_SPECS[kind] : undefined
  const subject = workstation?.label ?? spec?.label ?? 'Workstation'
  return {
    icon: spec?.icon ?? 'work' as const,
    label: order.operation === 'deconstruct' ? `Deconstruct ${subject}` : `${subject} blueprint`,
    detail: order.operation === 'deconstruct'
      ? `Remove the complete ${subject.toLowerCase()} footprint.`
      : order.operation === 'replace'
        ? `Replace the existing ${subject.toLowerCase()}.`
        : spec?.description ?? `Build ${subject}.`,
  }
}

export const constructionOrderActivity = (
  order: ConstructionOrder,
  constructionPaused = false,
) => {
  if (order.block?.kind === 'no_path') return 'No route'
  if (order.block?.kind === 'carrier_unavailable') return 'Carrier unavailable'
  if (order.block?.kind === 'prerequisite') return 'Waiting on prerequisite'
  if (order.block?.kind === 'insufficient_materials') return 'Needs material'
  if (order.status === 'blocked') return 'Blocked'
  if (constructionPaused) return 'Paused'
  if (!order.assignedCrewId && order.forcedCrewId) return 'Waiting for assigned builder'
  if (!order.assignedCrewId) return 'Waiting for builder'
  if (order.travelPhase === 'to_stockpile') return 'Collecting material'
  if (order.travelPhase === 'to_site') return 'Walking to site'
  if (order.travelPhase === 'at_site' && order.status === 'hauling') return 'Delivering material'
  if (order.status === 'hauling') return 'Hauling'
  return 'Building'
}

export const constructionPhaseSummary = (
  orders: readonly ConstructionOrder[],
) => {
  const phaseCounts = new Map<string, number>()
  orders.forEach((order) => {
    if (!order.assignedCrewId) return
    const phase = order.block?.kind === 'no_path'
      ? 'no route'
      : order.block?.kind === 'carrier_unavailable'
        ? 'carrier unavailable'
        : order.travelPhase === 'to_stockpile'
      ? 'collecting material'
      : order.travelPhase === 'to_site'
        ? 'walking to site'
        : order.travelPhase === 'at_site' && order.status === 'hauling'
          ? 'delivering material'
          : order.status === 'hauling'
            ? 'hauling'
            : 'building'
    phaseCounts.set(phase, (phaseCounts.get(phase) ?? 0) + 1)
  })
  return [
    'carrier unavailable',
    'no route',
    'collecting material',
    'walking to site',
    'delivering material',
    'hauling',
    'building',
  ]
    .flatMap((phase) => {
      const count = phaseCounts.get(phase) ?? 0
      return count > 0 ? [`${count} ${phase}`] : []
    })
    .join(' · ')
}

const formatConstructionAmount = (value: number) => {
  if (!Number.isFinite(value)) return '0'
  const rounded = Math.round(value * 10) / 10
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}

const fallbackCrewName = (crewId: string) => titleCase(crewId.replace(/^crew-/, ''))

const modulesAtCell = (modules: ModuleState[], cell: GridPoint) => modules
  .filter((module) => (
    cell.x >= module.position.x
    && cell.x < module.position.x + module.position.width
    && cell.y >= module.position.y
    && cell.y < module.position.y + module.position.height
  ))

const moduleAtCell = (modules: ModuleState[], cell: GridPoint) => modulesAtCell(modules, cell)
  .sort((left, right) => (
    left.position.width * left.position.height - right.position.width * right.position.height
  ))[0] ?? null

const pressureModuleAtCell = (modules: ModuleState[], cell: GridPoint) => modulesAtCell(modules, cell)
  .filter((module) => module.type !== 'corridor')
  .sort((left, right) => (
    right.position.width * right.position.height - left.position.width * left.position.height
  ))[0] ?? null

const legacySurface = (module: ModuleState, cell: GridPoint): Pick<
  MapTileInspection,
  'surfaceKind' | 'surfaceLabel' | 'surfaceDetail'
> => {
  if (module.type === 'solar_battery_skid') {
    return {
      surfaceKind: 'solar',
      surfaceLabel: 'Solar service deck',
      surfaceDetail: 'Exterior power equipment foundation',
    }
  }
  if (module.type === 'landing_pad') {
    return {
      surfaceKind: 'landing-pad',
      surfaceLabel: 'Landing pad',
      surfaceDetail: 'Exterior reinforced landing surface',
    }
  }

  const localX = cell.x - module.position.x
  const localY = cell.y - module.position.y
  const perimeter = localX === 0
    || localY === 0
    || localX === module.position.width - 1
    || localY === module.position.height - 1
  if (module.type === 'corridor' && !perimeter) {
    return {
      surfaceKind: 'corridor',
      surfaceLabel: 'Pressure corridor',
      surfaceDetail: 'Interior transit floor',
    }
  }
  if (perimeter) {
    return {
      surfaceKind: 'wall',
      surfaceLabel: 'Composite wall',
      surfaceDetail: 'One-tile pressure shell',
    }
  }
  return {
    surfaceKind: 'floor',
    surfaceLabel: module.atmosphere === 'yes' ? 'Pressurized floor' : 'Habitat floor',
    surfaceDetail: module.atmosphere === 'yes' ? 'Interior habitable surface' : 'Interior unpressurized surface',
  }
}

const addInspectable = (
  tiles: Map<string, MapTileInspection>,
  cell: GridPoint,
  inspectable: Omit<MapInspectable, 'cell'>,
) => {
  const tile = tiles.get(pointKey(cell))
  if (!tile || tile.contents.some((candidate) => candidate.key === inspectable.key)) return
  tile.contents.push({ ...inspectable, cell: { ...cell } })
}

export const withFocusedMapItem = (
  tile: MapTileInspection,
  focusedItem: MapInspectable | null,
): MapTileInspection => ({
  ...tile,
  cell: { ...tile.cell },
  contents: [...tile.contents],
  focusedItem,
})

export const buildMapInspection = ({
  width,
  height,
  modules,
  crew,
  equipment,
  workOrders,
  entityCells,
  constructionLayout = null,
  constructionOrders = [],
  constructionPaused = false,
  constructionCrewNames = new Map<string, string>(),
  constructionStockpile = null,
}: BuildMapInspectionInput): Map<string, MapTileInspection> => {
  const rooms = constructionLayout ? detectRooms(constructionLayout) : []
  const roomByCell = new Map(
    rooms.flatMap((room) => room.cells.map((cell) => [pointKey(cell), room] as const)),
  )
  const tiles = new Map<string, MapTileInspection>()

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const cell = { x, y }
      const module = moduleAtCell(modules, cell)
      const room = roomByCell.get(pointKey(cell)) ?? null
      const roomAtmosphere = room
        ? pressureModuleAtCell(modules, cell)?.atmosphere ?? 'no'
        : null
      const surface = constructionLayout
        ? room
          ? roomAtmosphere === 'yes'
            ? {
                surfaceKind: 'floor' as const,
                surfaceLabel: 'Pressurized floor',
                surfaceDetail: 'Sealed player-built room',
              }
            : roomAtmosphere === 'low'
              ? {
                  surfaceKind: 'floor' as const,
                  surfaceLabel: 'Low-pressure floor',
                  surfaceDetail: 'Player-built room below nominal pressure',
                }
              : {
                  surfaceKind: 'floor' as const,
                  surfaceLabel: 'Vacuum floor',
                  surfaceDetail: 'Unpressurized player-built room',
                }
          : {
              surfaceKind: 'terrain' as const,
              surfaceLabel: 'Lunar regolith',
              surfaceDetail: 'Exterior surveyed ground',
            }
        : module
          ? legacySurface(module, cell)
          : {
              surfaceKind: 'terrain' as const,
              surfaceLabel: 'Lunar regolith',
              surfaceDetail: 'Exterior surveyed ground',
            }

      tiles.set(pointKey(cell), {
        key: pointKey(cell),
        cell,
        ...surface,
        roomId: room?.id ?? null,
        roomLabel: room ? `Room ${room.id.replace('room-', '')}` : null,
        roomArea: room?.area ?? null,
        moduleId: module?.id ?? null,
        moduleName: module?.name ?? null,
        atmosphere: room ? roomAtmosphere ?? 'no' : module?.atmosphere ?? 'exterior',
        contents: [],
        focusedItem: null,
      })
    }
  }

  if (constructionLayout) {
    constructionLayout.boundaries.forEach((boundary) => {
      const tile = tiles.get(pointKey(boundary))
      if (!tile) return
      const connection = getBoundaryConnection(constructionLayout, boundary)
      const doorAxis = boundary.kind === 'door' ? getBoundaryDoorAxis(connection.mask) : null
      const boundaryLabel = boundary.kind === 'door' ? 'Pressure door' : 'Composite wall'
      const boundaryDetail = boundary.kind === 'door'
        ? `${titleCase(doorAxis ?? 'horizontal')} pressure seal`
        : `${titleCase(connection.name)} pressure shell`
      addInspectable(tiles, boundary, {
        key: `boundary:${pointKey(boundary)}`,
        kind: 'boundary',
        id: pointKey(boundary),
        label: boundaryLabel,
        subtitle: `Structure · ${titleCase(connection.name)}`,
        detail: boundaryDetail,
        icon: boundary.kind === 'door' ? 'door' : 'wall',
        stats: [
          { label: 'Type', value: boundary.kind === 'door' ? 'Door' : 'Wall' },
          { label: 'Connection', value: titleCase(connection.name) },
          { label: 'Tile', value: `${boundary.x + 1}, ${boundary.y + 1}` },
        ],
      })
    })

    constructionLayout.workstations.forEach((workstation) => {
      const kind = workstation.type as WorkstationKind
      const spec = WORKSTATION_SPECS[kind]
      if (!spec) return
      const footprint = getWorkstationFootprintSize(workstation)
      const workstationCells = getWorkstationCells(workstation)
      const roomIds = workstationCells.map((cell) => roomByCell.get(pointKey(cell))?.id ?? null)
      const roomId = roomIds[0]
      const fitsOneRoom = Boolean(roomId && roomIds.every((candidate) => candidate === roomId))
      const operationalState = spec.indoor
        ? fitsOneRoom ? 'Ready indoors' : 'Needs enclosed room'
        : 'Exterior rated'
      workstationCells.forEach((cell) => {
        const tile = tiles.get(pointKey(cell))
        addInspectable(tiles, cell, {
          key: `workstation:${workstation.id}`,
          kind: 'workstation',
          id: workstation.id,
          label: workstation.label,
          subtitle: `Workstation · ${footprint.width}×${footprint.height}`,
          detail: spec.indoor && !fitsOneRoom
            ? `${spec.description} · Built outdoors; unusable until enclosed.`
            : spec.description,
          icon: spec.icon,
          stats: [
            { label: 'Footprint', value: `${footprint.width}×${footprint.height}` },
            { label: 'Rotation', value: `${workstation.rotation}°` },
            { label: 'Room', value: tile?.roomLabel ?? 'Exterior' },
            { label: 'Operation', value: operationalState },
          ],
        })
      })
    })
  }

  const crewNamesById = new Map(crew.map((member) => [member.id, member.name]))
  constructionCrewNames.forEach((name, crewId) => crewNamesById.set(crewId, name))
  const constructionAssignmentByCrewId = new Map<string, ConstructionOrder>()

  constructionOrders
    .filter((order) => order.status !== 'complete')
    .forEach((order) => {
      if (order.assignedCrewId && !constructionAssignmentByCrewId.has(order.assignedCrewId)) {
        constructionAssignmentByCrewId.set(order.assignedCrewId, order)
      }
      if (order.forcedCrewId && !constructionAssignmentByCrewId.has(order.forcedCrewId)) {
        constructionAssignmentByCrewId.set(order.forcedCrewId, order)
      }
      const presentation = constructionOrderPresentation(order)
      const activity = constructionOrderActivity(order, constructionPaused)
      const progress = constructionOrderProgress(order)
      const forcedBuilder = order.forcedCrewId
        ? crewNamesById.get(order.forcedCrewId) ?? fallbackCrewName(order.forcedCrewId)
        : null
      const builder = forcedBuilder
        ? order.assignedCrewId === order.forcedCrewId
          ? `${forcedBuilder} · manual`
          : `Waiting for ${forcedBuilder} · manual`
        : order.assignedCrewId
          ? `${crewNamesById.get(order.assignedCrewId) ?? fallbackCrewName(order.assignedCrewId)} · automatic`
          : 'Automatic · unassigned'
      const carried = carriedConstructionMaterial(order)
      const carrier = order.materials.carriedByCrewId
        ? crewNamesById.get(order.materials.carriedByCrewId) ??
          fallbackCrewName(order.materials.carriedByCrewId)
        : null
      const targetSpec = order.target.kind === 'workstation' && order.target.construct
        ? WORKSTATION_SPECS[order.target.construct.type as WorkstationKind]
        : null
      const targetRoomIds = targetSpec?.indoor
        ? order.target.cells.map((cell) => roomByCell.get(pointKey(cell))?.id ?? null)
        : []
      const targetFitsRoom = Boolean(
        targetRoomIds[0] && targetRoomIds.every((roomId) => roomId === targetRoomIds[0]),
      )
      const blueprintOperation = targetSpec
        ? targetSpec.indoor
          ? targetFitsRoom ? 'Ready indoors' : 'Inactive until enclosed'
          : 'Exterior rated'
        : null
      const materials = order.materials.required > 0
        ? [
            `${formatConstructionAmount(constructionMaterialAccountedFor(order))} / ${formatConstructionAmount(order.materials.required)} supplied`,
            carried > 0
              ? `${formatConstructionAmount(carried)} carried by ${carrier ?? 'colonist'}`
              : '',
            order.materials.delivered > 0
              ? `${formatConstructionAmount(order.materials.delivered)} delivered at site`
              : '',
            order.materials.reserved > 0
              ? `${formatConstructionAmount(order.materials.reserved)} reserved at pallet`
              : '',
          ].filter(Boolean).join(' · ')
        : order.materials.recoverable > 0
          ? `${formatConstructionAmount(order.materials.recoverable)} recoverable`
          : 'Not required'

      order.target.cells.forEach((cell) => addInspectable(tiles, cell, {
        key: `blueprint:${order.id}`,
        kind: 'blueprint',
        id: order.id,
        label: presentation.label,
        subtitle: `Blueprint · ${activity} · P${order.priority}`,
        detail: order.block?.message ?? (
          blueprintOperation === 'Inactive until enclosed'
            ? `${presentation.detail} · Placeable outdoors, but unusable until enclosed.`
            : presentation.detail
        ),
        icon: presentation.icon,
        stats: [
          { label: 'Status', value: activity },
          { label: 'Progress', value: `${progress}%` },
          { label: 'Materials', value: materials },
          { label: 'Priority', value: `P${order.priority}` },
          { label: 'Builder', value: builder },
          ...(blueprintOperation
            ? [{ label: 'Operation', value: blueprintOperation }]
            : []),
        ],
      }))
    })

  if (constructionStockpile) {
    addInspectable(tiles, constructionStockpile.cell, {
      key: 'stockpile:construction-material',
      kind: 'stockpile',
      id: 'construction-material',
      label: 'Construction pallet',
      subtitle: 'Stockpile · Material pickup',
      detail: 'Builders collect reserved construction material here before walking to a blueprint.',
      icon: 'storage',
      stats: [
        { label: 'On pallet', value: formatConstructionAmount(constructionStockpile.stored) },
        { label: 'Reserved', value: formatConstructionAmount(constructionStockpile.reserved) },
        { label: 'Available', value: formatConstructionAmount(constructionStockpile.available) },
      ],
    })
  }

  crew.forEach((member, memberIndex) => {
    const cell = entityCells.crew.get(member.id)
    if (!cell) return
    const constructionAssignment = constructionAssignmentByCrewId.get(member.id)
    const constructionPresentation = constructionAssignment
      ? constructionOrderPresentation(constructionAssignment)
      : null
    const constructionActivity = constructionAssignment
      ? constructionOrderActivity(constructionAssignment, constructionPaused)
      : null
    const carried = constructionAssignment &&
      constructionAssignment.materials.carriedByCrewId === member.id
      ? carriedConstructionMaterial(constructionAssignment)
      : 0
    addInspectable(tiles, cell, {
      key: `crew:${member.id}`,
      kind: 'crew',
      id: member.id,
      label: member.name,
      subtitle: `Colonist · ${constructionActivity ?? titleCase(member.status)}`,
      detail: constructionPresentation
        ? `${member.role} · ${constructionAssignment?.forcedCrewId === member.id ? 'Manual priority' : constructionActivity}: ${constructionPresentation.label}${carried > 0 ? ` · Carrying ${formatConstructionAmount(carried)} material` : ''}`
        : member.role,
      icon: 'crew',
      portrait: crewPawnPresentation(member, memberIndex),
      stats: [
        { label: 'Health', value: `${Math.round(member.health)}%` },
        { label: 'Fatigue', value: `${Math.round(member.fatigue)}%` },
        { label: 'Role', value: member.role },
        ...(constructionPresentation
          ? [{
              label: 'Task',
              value: constructionAssignment?.forcedCrewId === member.id
                ? `Manual · ${constructionPresentation.label}`
                : constructionPresentation.label,
            }]
          : []),
        ...(carried > 0
          ? [{ label: 'Cargo', value: `${formatConstructionAmount(carried)} construction material` }]
          : []),
      ],
    })
  })

  equipment.forEach((item) => {
    const cell = entityCells.equipment.get(item.id)
    if (!cell) return
    addInspectable(tiles, cell, {
      key: `equipment:${item.id}`,
      kind: 'equipment',
      id: item.id,
      label: item.name,
      subtitle: `Equipment · ${titleCase(item.status)}`,
      detail: `${titleCase(item.type)} at ${titleCase(item.location)}`,
      icon: equipmentIcons[item.type],
      stats: [
        { label: 'Condition', value: `${item.condition}%` },
        { label: 'Status', value: titleCase(item.status) },
        { label: 'Location', value: titleCase(item.location) },
      ],
    })
  })

  workOrders.forEach((order) => {
    const cell = entityCells.work.get(order.id)
    if (!cell) return
    const progress = Math.min(100, Math.round((order.progressHours / order.durationHours) * 100))
    addInspectable(tiles, cell, {
      key: `work:${order.id}`,
      kind: 'work',
      id: order.id,
      label: order.label,
      subtitle: `Work order · ${titleCase(order.status)}`,
      detail: order.detail,
      icon: workIcons[order.type],
      stats: [
        { label: 'Progress', value: `${progress}%` },
        { label: 'Priority', value: `P${order.priority}` },
        { label: 'Duration', value: `${order.durationHours}h` },
      ],
    })
  })

  tiles.forEach((tile) => {
    tile.contents.sort((left, right) => (
      inspectableOrder[left.kind] - inspectableOrder[right.kind]
      || left.label.localeCompare(right.label)
      || left.key.localeCompare(right.key)
    ))
  })

  return tiles
}

export const describeMapTile = (tile: MapTileInspection) => {
  const coordinates = `Column ${tile.cell.x + 1}, row ${tile.cell.y + 1}`
  if (tile.contents.length === 0) {
    return `${coordinates}. ${tile.surfaceLabel}. Empty tile.`
  }
  const labels = tile.contents.map((item) => item.label).join(', ')
  return `${coordinates}. ${tile.contents.length} ${tile.contents.length === 1 ? 'item' : 'items'}: ${labels}. ${tile.surfaceLabel}.`
}
