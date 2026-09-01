import {
  boundaryAt,
  detectRooms,
  isInConstructionBounds,
  type ConstructionLayout,
  type DetectedRoom,
  type GridPoint,
} from './construction'
import {
  getBoundaryConnectionMask,
  getBoundaryDoorAxis,
  type BoundaryDoorAxis,
} from './boundaryConnections'

export type ConstructionDoorRole = 'pressure_door' | 'exterior_airlock' | 'invalid'
export type ConstructionEnvironment = 'pressurized' | 'airlock' | 'vacuum'

export interface ConstructionDoorPressureConnection {
  cell: GridPoint
  axis: BoundaryDoorAxis
  role: ConstructionDoorRole
  roomIds: string[]
  passageCells: GridPoint[]
  /** Room on each passage side; unlike roomIds this preserves side identity. */
  passageRoomIds: [string | null, string | null]
}

export interface ConstructionPressureTopology {
  rooms: DetectedRoom[]
  roomByCell: ReadonlyMap<string, DetectedRoom>
  doors: ConstructionDoorPressureConnection[]
  doorByCell: ReadonlyMap<string, ConstructionDoorPressureConnection>
  /** Open shell cells that would bypass a pressure door or exterior airlock. */
  breachCells: GridPoint[]
  breachCellKeys: ReadonlySet<string>
}

const pointKey = ({ x, y }: GridPoint) => `${x}:${y}`

const PRESSURE_TOPOLOGY_CACHE_LIMIT = 48
const pressureTopologyCache = new Map<string, ConstructionPressureTopology>()

const topologyCacheKey = (layout: ConstructionLayout) => [
  `${layout.width}x${layout.height}`,
  ...layout.boundaries
    .map((boundary) => `${boundary.x}:${boundary.y}:${boundary.kind}`)
    .sort((left, right) => left.localeCompare(right)),
].join('|')

const cardinalDirections: readonly GridPoint[] = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
]

const comparePoints = (left: GridPoint, right: GridPoint) =>
  left.y - right.y || left.x - right.x

const roomMap = (rooms: readonly DetectedRoom[]) => {
  const byCell = new Map<string, DetectedRoom>()
  rooms.forEach((room) => {
    room.cells.forEach((cell) => byCell.set(pointKey(cell), room))
  })
  return byCell
}

/**
 * A one-cell opening in an otherwise enclosing boundary is a pressure breach,
 * not an alternate doorway. Testing the candidate as a synthetic door lets the
 * existing room detector prove that closing that exact cell restores a room.
 */
const detectPressureBreachCells = (
  layout: ConstructionLayout,
  roomByCell: ReadonlyMap<string, DetectedRoom>,
) => {
  const boundaryKeys = new Set(layout.boundaries.map(pointKey))
  const candidates: GridPoint[] = []

  for (let y = 0; y < layout.height; y += 1) {
    for (let x = 0; x < layout.width; x += 1) {
      const cell = { x, y }
      const key = pointKey(cell)
      if (boundaryKeys.has(key) || roomByCell.has(key)) continue
      const boundaryNeighbors = cardinalDirections
        .map((direction) => ({ x: x + direction.x, y: y + direction.y }))
        .filter((neighbor) => boundaryKeys.has(pointKey(neighbor)))
      // A missing shell tile leaves two boundary-run endpoints. Parallel room
      // walls beside an ordinary floor cell each retain degree two and must not
      // be mistaken for a breach in a narrow room or corridor.
      if (
        boundaryNeighbors.length !== 2 ||
        boundaryNeighbors.some((neighbor) => cardinalDirections.filter((direction) => (
          boundaryKeys.has(pointKey({
            x: neighbor.x + direction.x,
            y: neighbor.y + direction.y,
          }))
        )).length > 1)
      ) continue

      const repairedRooms = detectRooms({
        ...layout,
        boundaries: [...layout.boundaries, { ...cell, kind: 'door' }],
      })
      const repairedRoomByCell = roomMap(repairedRooms)
      const closesNewRoom = cardinalDirections.some((direction) => {
        const neighborKey = pointKey({ x: x + direction.x, y: y + direction.y })
        return repairedRoomByCell.has(neighborKey) && !roomByCell.has(neighborKey)
      })
      if (closesNewRoom) candidates.push(cell)
    }
  }

  return candidates.sort(comparePoints)
}

const passageCellsForDoor = (
  layout: ConstructionLayout,
  cell: GridPoint,
  axis: BoundaryDoorAxis,
) => (axis === 'horizontal'
  ? [
      { x: cell.x, y: cell.y - 1 },
      { x: cell.x, y: cell.y + 1 },
    ]
  : [
      { x: cell.x - 1, y: cell.y },
      { x: cell.x + 1, y: cell.y },
    ])
  .filter((candidate) => isInConstructionBounds(candidate, layout))

/**
 * Derives pressure behavior without changing the persisted wall/door format.
 * A straight door with different rooms on its two passage sides is an interior
 * pressure door. Exactly one room and one exterior side forms the compact,
 * one-tile airlock used by this simulation; ambiguous geometry is invalid.
 */
export const analyzeConstructionPressure = (
  layout: ConstructionLayout,
): ConstructionPressureTopology => {
  const cacheKey = topologyCacheKey(layout)
  const cached = pressureTopologyCache.get(cacheKey)
  if (cached) {
    pressureTopologyCache.delete(cacheKey)
    pressureTopologyCache.set(cacheKey, cached)
    return cached
  }
  const rooms = detectRooms(layout)
  const roomByCell = roomMap(rooms)
  const breachCells = detectPressureBreachCells(layout, roomByCell)
  const breachCellKeys = new Set(breachCells.map(pointKey))
  const structuralLayout = breachCells.length === 0
    ? layout
    : {
        ...layout,
        boundaries: [
          ...layout.boundaries,
          ...breachCells.map((cell) => ({ ...cell, kind: 'wall' as const })),
        ],
      }
  const structuralRooms = breachCells.length === 0 ? rooms : detectRooms(structuralLayout)
  const structuralRoomByCell = roomMap(structuralRooms)

  const doors = layout.boundaries.flatMap((boundary) => {
    if (boundary.kind !== 'door') return []
    const connectionMask = getBoundaryConnectionMask(structuralLayout, boundary)
    const axis = getBoundaryDoorAxis(connectionMask)
    const passageCells = passageCellsForDoor(layout, boundary, axis)
    const sideRoomIds = passageCells.map(
      (cell) => structuralRoomByCell.get(pointKey(cell))?.id ?? null,
    )
    const passageRoomIds: [string | null, string | null] = [
      sideRoomIds[0] ?? null,
      sideRoomIds[1] ?? null,
    ]
    const roomIds = [...new Set(
      passageRoomIds.filter((roomId): roomId is string => Boolean(roomId)),
    )]
    const straightBoundaryRun = connectionMask === 5 || connectionMask === 10
    const hasTwoPassageSides = passageCells.length === 2
    const [firstRoomId, secondRoomId] = passageRoomIds
    const role: ConstructionDoorRole = !straightBoundaryRun || !hasTwoPassageSides
      ? 'invalid'
      : firstRoomId && secondRoomId && firstRoomId !== secondRoomId
        ? 'pressure_door'
        : Boolean(firstRoomId) !== Boolean(secondRoomId)
          ? 'exterior_airlock'
          : 'invalid'
    return [{
      cell: { x: boundary.x, y: boundary.y },
      axis,
      role,
      roomIds,
      passageCells,
      passageRoomIds,
    }]
  })
  const doorByCell = new Map(doors.map((door) => [pointKey(door.cell), door]))
  const topology = { rooms, roomByCell, doors, doorByCell, breachCells, breachCellKeys }
  pressureTopologyCache.set(cacheKey, topology)
  if (pressureTopologyCache.size > PRESSURE_TOPOLOGY_CACHE_LIMIT) {
    pressureTopologyCache.delete(pressureTopologyCache.keys().next().value!)
  }
  return topology
}

export const constructionDoorConnectionAt = (
  topology: ConstructionPressureTopology,
  cell: GridPoint,
) => topology.doorByCell.get(pointKey(cell)) ?? null

export const constructionEnvironmentAt = (
  layout: ConstructionLayout,
  topology: ConstructionPressureTopology,
  cell: GridPoint,
): ConstructionEnvironment => {
  if (!isInConstructionBounds(cell, layout)) return 'vacuum'
  const boundary = boundaryAt(layout, cell)
  if (boundary?.kind === 'wall') return 'vacuum'
  const door = topology.doorByCell.get(pointKey(cell))
  if (door) {
    if (door.role === 'pressure_door') return 'pressurized'
    if (door.role === 'exterior_airlock') return 'airlock'
    return 'vacuum'
  }
  return topology.roomByCell.has(pointKey(cell)) ? 'pressurized' : 'vacuum'
}

export const constructionCellIsPressureBreach = (
  topology: ConstructionPressureTopology,
  cell: GridPoint,
) => topology.breachCellKeys.has(pointKey(cell))

/** A pressure boundary may change environment only through a valid airlock tile. */
export const constructionPressureStepAllowed = (
  layout: ConstructionLayout,
  topology: ConstructionPressureTopology,
  from: GridPoint,
  to: GridPoint,
) => {
  if (
    constructionCellIsPressureBreach(topology, from) ||
    constructionCellIsPressureBreach(topology, to)
  ) return false
  const fromEnvironment = constructionEnvironmentAt(layout, topology, from)
  const toEnvironment = constructionEnvironmentAt(layout, topology, to)
  return !(
    (fromEnvironment === 'pressurized' && toEnvironment === 'vacuum') ||
    (fromEnvironment === 'vacuum' && toEnvironment === 'pressurized')
  )
}

export const constructionCellRequiresEva = (
  layout: ConstructionLayout,
  topology: ConstructionPressureTopology,
  cell: GridPoint,
) => constructionEnvironmentAt(layout, topology, cell) !== 'pressurized'
