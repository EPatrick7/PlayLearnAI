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
import type {
  CrewMember,
  Equipment,
  ModuleState,
  WorkOrder,
} from '../game/types'
import type { GameIconName } from './GameIcon'

export type MapInspectableKind =
  | 'crew'
  | 'equipment'
  | 'work'
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

interface BuildMapInspectionInput {
  width: number
  height: number
  modules: ModuleState[]
  crew: CrewMember[]
  equipment: Equipment[]
  workOrders: WorkOrder[]
  entityCells: MapEntityCells
  constructionLayout?: ConstructionLayout | null
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
  workstation: 3,
  boundary: 4,
}

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
        ? pressureModuleAtCell(modules, cell)?.atmosphere ?? 'yes'
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
        atmosphere: room ? roomAtmosphere ?? 'yes' : module?.atmosphere ?? 'exterior',
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
      tile.surfaceKind = boundary.kind
      tile.surfaceLabel = boundary.kind === 'door' ? 'Pressure door' : 'Composite wall'
      tile.surfaceDetail = boundary.kind === 'door'
        ? `${titleCase(doorAxis ?? 'horizontal')} pressure seal`
        : `${titleCase(connection.name)} pressure shell`
      addInspectable(tiles, boundary, {
        key: `boundary:${pointKey(boundary)}`,
        kind: 'boundary',
        id: pointKey(boundary),
        label: tile.surfaceLabel,
        subtitle: `Structure · ${titleCase(connection.name)}`,
        detail: tile.surfaceDetail,
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
      getWorkstationCells(workstation).forEach((cell) => {
        const tile = tiles.get(pointKey(cell))
        addInspectable(tiles, cell, {
          key: `workstation:${workstation.id}`,
          kind: 'workstation',
          id: workstation.id,
          label: workstation.label,
          subtitle: `Workstation · ${footprint.width}×${footprint.height}`,
          detail: spec.description,
          icon: spec.icon,
          stats: [
            { label: 'Footprint', value: `${footprint.width}×${footprint.height}` },
            { label: 'Rotation', value: `${workstation.rotation}°` },
            { label: 'Room', value: tile?.roomLabel ?? 'Exterior' },
          ],
        })
      })
    })
  }

  crew.forEach((member) => {
    const cell = entityCells.crew.get(member.id)
    if (!cell) return
    addInspectable(tiles, cell, {
      key: `crew:${member.id}`,
      kind: 'crew',
      id: member.id,
      label: member.name,
      subtitle: `Colonist · ${titleCase(member.status)}`,
      detail: member.role,
      icon: 'crew',
      stats: [
        { label: 'Health', value: `${Math.round(member.health)}%` },
        { label: 'Fatigue', value: `${Math.round(member.fatigue)}%` },
        { label: 'Role', value: member.role },
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
