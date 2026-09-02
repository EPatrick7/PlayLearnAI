export const LEGACY_CONSTRUCTION_GRID_WIDTH = 24 as const
export const LEGACY_CONSTRUCTION_GRID_HEIGHT = 18 as const
export const CONSTRUCTION_GRID_WIDTH = 36 as const
export const CONSTRUCTION_GRID_HEIGHT = 27 as const
export const PRESET_LAYOUT_OFFSET = { x: 6, y: 5 } as const
export const STARTER_LAYOUT_OFFSET = { x: 12, y: 4 } as const
export const CONSTRUCTION_GRID = {
  width: CONSTRUCTION_GRID_WIDTH,
  height: CONSTRUCTION_GRID_HEIGHT,
} as const

export type BoundaryKind = 'wall' | 'door'
export type WorkstationRotation = 0 | 90 | 180 | 270

export interface GridPoint {
  x: number
  y: number
}

export const offsetPresetPoint = <T extends GridPoint>(point: T): T => ({
  ...point,
  x: point.x + PRESET_LAYOUT_OFFSET.x,
  y: point.y + PRESET_LAYOUT_OFFSET.y,
})

export const offsetStarterPoint = <T extends GridPoint>(point: T): T => ({
  ...point,
  x: point.x + STARTER_LAYOUT_OFFSET.x,
  y: point.y + STARTER_LAYOUT_OFFSET.y,
})

export interface GridSize {
  width: number
  height: number
}

export interface BoundaryCell extends GridPoint {
  kind: BoundaryKind
}

export interface WorkstationPlacementInput {
  id: string
  type: string
  label?: string
  origin: GridPoint
  size: GridSize
  rotation?: WorkstationRotation
}

export interface WorkstationPlacement {
  id: string
  type: string
  label: string
  origin: GridPoint
  size: GridSize
  rotation: WorkstationRotation
}

export interface ConstructionLayout {
  width: number
  height: number
  boundaries: BoundaryCell[]
  workstations: WorkstationPlacement[]
}

export type ConstructionSuccessCode =
  | 'painted'
  | 'erased'
  | 'workstation_placed'
  | 'workstation_moved'
  | 'workstation_rotated'
  | 'workstation_removed'

export type ConstructionFailureCode =
  | 'invalid_coordinate'
  | 'invalid_line'
  | 'out_of_bounds'
  | 'occupied'
  | 'door_requires_wall'
  | 'invalid_workstation'
  | 'duplicate_workstation_id'
  | 'workstation_not_found'

export type ConstructionResult =
  | {
      ok: true
      code: ConstructionSuccessCode
      layout: ConstructionLayout
      affectedCells: GridPoint[]
      workstationId?: string
    }
  | {
      ok: false
      code: ConstructionFailureCode
      layout: ConstructionLayout
      affectedCells: []
      error: string
      conflictingCell?: GridPoint
      workstationId?: string
    }

export interface WorkstationPlacementValidation {
  valid: boolean
  cells: GridPoint[]
  code?: Extract<
    ConstructionFailureCode,
    'invalid_coordinate' | 'out_of_bounds' | 'occupied' | 'invalid_workstation'
  >
  error?: string
  conflictingCell?: GridPoint
  conflictingWorkstationId?: string
}

export type CellOccupant =
  | { kind: 'boundary'; boundary: BoundaryCell }
  | { kind: 'workstation'; workstation: WorkstationPlacement }
  | null

export interface DetectedRoom {
  id: string
  cells: GridPoint[]
  area: number
  bounds: GridPoint & GridSize
  doorCells: GridPoint[]
}

const cardinalNeighbors = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
] as const

const rotations: WorkstationRotation[] = [0, 90, 180, 270]

const pointKey = ({ x, y }: GridPoint) => `${x}:${y}`

const isIntegerPoint = (point: GridPoint) =>
  Number.isInteger(point.x) && Number.isInteger(point.y)

const comparePoints = (left: GridPoint, right: GridPoint) =>
  left.y - right.y || left.x - right.x

const sortPoints = (points: GridPoint[]) => [...points].sort(comparePoints)

const uniquePoints = (points: GridPoint[]) => {
  const byKey = new Map<string, GridPoint>()
  points.forEach((point) => byKey.set(pointKey(point), { ...point }))
  return sortPoints([...byKey.values()])
}

const sortBoundaries = (boundaries: BoundaryCell[]) =>
  [...boundaries].sort(comparePoints)

const sortWorkstations = (workstations: WorkstationPlacement[]) =>
  [...workstations].sort((left, right) => left.id.localeCompare(right.id))

const successful = (
  code: ConstructionSuccessCode,
  layout: ConstructionLayout,
  affectedCells: GridPoint[],
  workstationId?: string,
): ConstructionResult => ({
  ok: true,
  code,
  layout,
  affectedCells: uniquePoints(affectedCells),
  ...(workstationId ? { workstationId } : {}),
})

const failed = (
  layout: ConstructionLayout,
  code: ConstructionFailureCode,
  error: string,
  options: { conflictingCell?: GridPoint; workstationId?: string } = {},
): ConstructionResult => ({
  ok: false,
  code,
  layout,
  affectedCells: [],
  error,
  ...options,
})

export const createConstructionLayout = (): ConstructionLayout => ({
  width: CONSTRUCTION_GRID_WIDTH,
  height: CONSTRUCTION_GRID_HEIGHT,
  boundaries: [],
  workstations: [],
})

export const isInConstructionBounds = (
  point: GridPoint,
  layout: Pick<ConstructionLayout, 'width' | 'height'> = CONSTRUCTION_GRID,
) =>
  isIntegerPoint(point) &&
  point.x >= 0 &&
  point.y >= 0 &&
  point.x < layout.width &&
  point.y < layout.height

/**
 * Rasterizes a drag along its dominant cardinal axis, including the start and
 * snapped end. Horizontal wins an exact diagonal tie, matching builder tools
 * that infer intent from a freehand pointer drag.
 */
export const cellsOnConstructionLine = (
  start: GridPoint,
  end: GridPoint,
): GridPoint[] | null => {
  if (!isIntegerPoint(start) || !isIntegerPoint(end)) return null

  const deltaX = end.x - start.x
  const deltaY = end.y - start.y
  const absoluteX = Math.abs(deltaX)
  const absoluteY = Math.abs(deltaY)
  const horizontal = absoluteX >= absoluteY
  const steps = horizontal ? absoluteX : absoluteY
  const stepX = horizontal ? Math.sign(deltaX) : 0
  const stepY = horizontal ? 0 : Math.sign(deltaY)
  return Array.from({ length: steps + 1 }, (_, index) => ({
    x: start.x + stepX * index,
    y: start.y + stepY * index,
  }))
}

export const getWorkstationFootprintSize = (
  workstation: Pick<WorkstationPlacement, 'size' | 'rotation'>,
): GridSize =>
  workstation.rotation === 90 || workstation.rotation === 270
    ? { width: workstation.size.height, height: workstation.size.width }
    : { ...workstation.size }

export const getWorkstationCells = (
  workstation: Pick<WorkstationPlacement, 'origin' | 'size' | 'rotation'>,
): GridPoint[] => {
  const footprint = getWorkstationFootprintSize(workstation)
  if (
    !Number.isSafeInteger(footprint.width) ||
    !Number.isSafeInteger(footprint.height) ||
    footprint.width <= 0 ||
    footprint.height <= 0 ||
    footprint.width > CONSTRUCTION_GRID_WIDTH ||
    footprint.height > CONSTRUCTION_GRID_HEIGHT
  ) {
    return []
  }
  return Array.from({ length: footprint.width * footprint.height }, (_, index) => ({
    x: workstation.origin.x + (index % footprint.width),
    y: workstation.origin.y + Math.floor(index / footprint.width),
  }))
}

export const boundaryAt = (
  layout: ConstructionLayout,
  point: GridPoint,
): BoundaryCell | undefined =>
  layout.boundaries.find((boundary) => boundary.x === point.x && boundary.y === point.y)

export const workstationAt = (
  layout: ConstructionLayout,
  point: GridPoint,
): WorkstationPlacement | undefined =>
  layout.workstations.find((workstation) =>
    getWorkstationCells(workstation).some(
      (cell) => cell.x === point.x && cell.y === point.y,
    ),
  )

export const occupantAt = (layout: ConstructionLayout, point: GridPoint): CellOccupant => {
  const boundary = boundaryAt(layout, point)
  if (boundary) return { kind: 'boundary', boundary }
  const workstation = workstationAt(layout, point)
  return workstation ? { kind: 'workstation', workstation } : null
}

const normalizeWorkstation = (
  input: WorkstationPlacementInput,
): WorkstationPlacement | null => {
  const rotation = input.rotation ?? 0
  if (
    !input.id.trim() ||
    !input.type.trim() ||
    !isIntegerPoint(input.origin) ||
    !Number.isInteger(input.size.width) ||
    !Number.isInteger(input.size.height) ||
    input.size.width <= 0 ||
    input.size.height <= 0 ||
    !rotations.includes(rotation)
  ) {
    return null
  }

  return {
    id: input.id,
    type: input.type,
    label: input.label?.trim() || input.type,
    origin: { ...input.origin },
    size: { ...input.size },
    rotation,
  }
}

export const validateWorkstationPlacement = (
  layout: ConstructionLayout,
  input: WorkstationPlacementInput,
  ignoreWorkstationId?: string,
): WorkstationPlacementValidation => {
  const workstation = normalizeWorkstation(input)
  if (!workstation) {
    return {
      valid: false,
      cells: [],
      code: 'invalid_workstation',
      error: 'Workstations require an id, type, integer origin, positive integer size, and quarter-turn rotation.',
    }
  }

  const footprint = getWorkstationFootprintSize(workstation)
  if (footprint.width > layout.width || footprint.height > layout.height) {
    return {
      valid: false,
      cells: [],
      code: 'out_of_bounds',
      error: `Workstation ${workstation.id} is larger than the ${layout.width}x${layout.height} grid.`,
      conflictingCell: { ...workstation.origin },
    }
  }

  const cells = getWorkstationCells(workstation)
  const outOfBounds = cells.find((cell) => !isInConstructionBounds(cell, layout))
  if (outOfBounds) {
    return {
      valid: false,
      cells,
      code: 'out_of_bounds',
      error: `Workstation ${workstation.id} extends outside the ${layout.width}x${layout.height} grid.`,
      conflictingCell: outOfBounds,
    }
  }

  const boundaryConflict = cells.find((cell) => boundaryAt(layout, cell))
  if (boundaryConflict) {
    return {
      valid: false,
      cells,
      code: 'occupied',
      error: `Cell ${pointKey(boundaryConflict)} is occupied by a boundary.`,
      conflictingCell: boundaryConflict,
    }
  }

  for (const candidate of layout.workstations) {
    if (candidate.id === ignoreWorkstationId) continue
    const candidateCells = new Set(getWorkstationCells(candidate).map(pointKey))
    const overlap = cells.find((cell) => candidateCells.has(pointKey(cell)))
    if (overlap) {
      return {
        valid: false,
        cells,
        code: 'occupied',
        error: `Cell ${pointKey(overlap)} is occupied by workstation ${candidate.id}.`,
        conflictingCell: overlap,
        conflictingWorkstationId: candidate.id,
      }
    }
  }

  return { valid: true, cells }
}

export const paintBoundaryLine = (
  layout: ConstructionLayout,
  start: GridPoint,
  end: GridPoint,
  kind: BoundaryKind,
): ConstructionResult => {
  if (!isIntegerPoint(start) || !isIntegerPoint(end)) {
    return failed(layout, 'invalid_coordinate', 'Boundary coordinates must be integer grid cells.')
  }

  const cells = cellsOnConstructionLine(start, end)
  if (!cells) {
    return failed(
      layout,
      'invalid_line',
      'Boundary strokes could not be resolved to a cardinal grid line.',
    )
  }

  const outOfBounds = cells.find((cell) => !isInConstructionBounds(cell, layout))
  if (outOfBounds) {
    return failed(
      layout,
      'out_of_bounds',
      `Cell ${pointKey(outOfBounds)} is outside the ${layout.width}x${layout.height} grid.`,
      { conflictingCell: outOfBounds },
    )
  }

  const workstationConflict = cells.find((cell) => workstationAt(layout, cell))
  if (workstationConflict) {
    return failed(
      layout,
      'occupied',
      `Cell ${pointKey(workstationConflict)} is occupied by a workstation.`,
      {
        conflictingCell: workstationConflict,
        workstationId: workstationAt(layout, workstationConflict)?.id,
      },
    )
  }

  if (kind === 'door') {
    const missingWall = cells.find((cell) => boundaryAt(layout, cell)?.kind !== 'wall')
    if (missingWall) {
      return failed(
        layout,
        'door_requires_wall',
        `A door can only replace an existing wall at ${pointKey(missingWall)}.`,
        { conflictingCell: missingWall },
      )
    }
  }

  const boundaryByCell = new Map(
    layout.boundaries.map((boundary) => [pointKey(boundary), { ...boundary }]),
  )
  cells.forEach((cell) => boundaryByCell.set(pointKey(cell), { ...cell, kind }))

  return successful(
    'painted',
    {
      ...layout,
      boundaries: sortBoundaries([...boundaryByCell.values()]),
      workstations: [...layout.workstations],
    },
    cells,
  )
}

export const paintBoundaryCell = (
  layout: ConstructionLayout,
  point: GridPoint,
  kind: BoundaryKind,
) => paintBoundaryLine(layout, point, point, kind)

export const eraseLine = (
  layout: ConstructionLayout,
  start: GridPoint,
  end: GridPoint,
): ConstructionResult => {
  if (!isIntegerPoint(start) || !isIntegerPoint(end)) {
    return failed(layout, 'invalid_coordinate', 'Erase coordinates must be integer grid cells.')
  }

  const cells = cellsOnConstructionLine(start, end)
  if (!cells) {
    return failed(
      layout,
      'invalid_line',
      'Erase strokes could not be resolved to a cardinal grid line.',
    )
  }

  const outOfBounds = cells.find((cell) => !isInConstructionBounds(cell, layout))
  if (outOfBounds) {
    return failed(
      layout,
      'out_of_bounds',
      `Cell ${pointKey(outOfBounds)} is outside the ${layout.width}x${layout.height} grid.`,
      { conflictingCell: outOfBounds },
    )
  }

  const erasedKeys = new Set(cells.map(pointKey))
  const removedWorkstationIds = new Set(
    layout.workstations
      .filter((workstation) =>
        getWorkstationCells(workstation).some((cell) => erasedKeys.has(pointKey(cell))),
      )
      .map((workstation) => workstation.id),
  )
  const removedWorkstationCells = layout.workstations
    .filter((workstation) => removedWorkstationIds.has(workstation.id))
    .flatMap(getWorkstationCells)

  return successful(
    'erased',
    {
      ...layout,
      boundaries: layout.boundaries
        .filter((boundary) => !erasedKeys.has(pointKey(boundary)))
        .map((boundary) => ({ ...boundary })),
      workstations: layout.workstations
        .filter((workstation) => !removedWorkstationIds.has(workstation.id))
        .map((workstation) => ({
          ...workstation,
          origin: { ...workstation.origin },
          size: { ...workstation.size },
        })),
    },
    [...cells, ...removedWorkstationCells],
  )
}

export const eraseAt = (layout: ConstructionLayout, point: GridPoint) =>
  eraseLine(layout, point, point)

export const placeWorkstation = (
  layout: ConstructionLayout,
  input: WorkstationPlacementInput,
): ConstructionResult => {
  if (layout.workstations.some((workstation) => workstation.id === input.id)) {
    return failed(
      layout,
      'duplicate_workstation_id',
      `Workstation id ${input.id} is already placed.`,
      { workstationId: input.id },
    )
  }

  const normalized = normalizeWorkstation(input)
  if (!normalized) {
    return failed(
      layout,
      'invalid_workstation',
      'Workstations require an id, type, integer origin, positive integer size, and quarter-turn rotation.',
      { workstationId: input.id },
    )
  }

  const validation = validateWorkstationPlacement(layout, normalized)
  if (!validation.valid) {
    return failed(layout, validation.code!, validation.error!, {
      conflictingCell: validation.conflictingCell,
      workstationId: input.id,
    })
  }

  return successful(
    'workstation_placed',
    {
      ...layout,
      boundaries: [...layout.boundaries],
      workstations: sortWorkstations([...layout.workstations, normalized]),
    },
    validation.cells,
    normalized.id,
  )
}

export const moveWorkstation = (
  layout: ConstructionLayout,
  workstationId: string,
  origin: GridPoint,
): ConstructionResult => {
  const existing = layout.workstations.find((workstation) => workstation.id === workstationId)
  if (!existing) {
    return failed(
      layout,
      'workstation_not_found',
      `Workstation ${workstationId} is not placed.`,
      { workstationId },
    )
  }

  const candidate: WorkstationPlacement = { ...existing, origin: { ...origin } }
  const validation = validateWorkstationPlacement(layout, candidate, workstationId)
  if (!validation.valid) {
    return failed(layout, validation.code!, validation.error!, {
      conflictingCell: validation.conflictingCell,
      workstationId,
    })
  }

  const oldCells = getWorkstationCells(existing)
  return successful(
    'workstation_moved',
    {
      ...layout,
      boundaries: [...layout.boundaries],
      workstations: sortWorkstations(
        layout.workstations.map((workstation) =>
          workstation.id === workstationId ? candidate : workstation,
        ),
      ),
    },
    [...oldCells, ...validation.cells],
    workstationId,
  )
}

export const rotateWorkstation = (
  layout: ConstructionLayout,
  workstationId: string,
  rotation?: WorkstationRotation,
): ConstructionResult => {
  const existing = layout.workstations.find((workstation) => workstation.id === workstationId)
  if (!existing) {
    return failed(
      layout,
      'workstation_not_found',
      `Workstation ${workstationId} is not placed.`,
      { workstationId },
    )
  }

  const currentIndex = rotations.indexOf(existing.rotation)
  const nextRotation = rotation ?? rotations[(currentIndex + 1) % rotations.length]
  const candidate: WorkstationPlacement = { ...existing, rotation: nextRotation }
  const validation = validateWorkstationPlacement(layout, candidate, workstationId)
  if (!validation.valid) {
    return failed(layout, validation.code!, validation.error!, {
      conflictingCell: validation.conflictingCell,
      workstationId,
    })
  }

  const oldCells = getWorkstationCells(existing)
  return successful(
    'workstation_rotated',
    {
      ...layout,
      boundaries: [...layout.boundaries],
      workstations: sortWorkstations(
        layout.workstations.map((workstation) =>
          workstation.id === workstationId ? candidate : workstation,
        ),
      ),
    },
    [...oldCells, ...validation.cells],
    workstationId,
  )
}

export const removeWorkstation = (
  layout: ConstructionLayout,
  workstationId: string,
): ConstructionResult => {
  const existing = layout.workstations.find((workstation) => workstation.id === workstationId)
  if (!existing) {
    return failed(
      layout,
      'workstation_not_found',
      `Workstation ${workstationId} is not placed.`,
      { workstationId },
    )
  }

  return successful(
    'workstation_removed',
    {
      ...layout,
      boundaries: [...layout.boundaries],
      workstations: layout.workstations.filter(
        (workstation) => workstation.id !== workstationId,
      ),
    },
    getWorkstationCells(existing),
    workstationId,
  )
}

const openNeighbors = (
  point: GridPoint,
  layout: ConstructionLayout,
  boundaryKeys: Set<string>,
) =>
  cardinalNeighbors
    .map((offset) => ({ x: point.x + offset.x, y: point.y + offset.y }))
    .filter(
      (neighbor) =>
        isInConstructionBounds(neighbor, layout) && !boundaryKeys.has(pointKey(neighbor)),
    )

const floodOpenRegion = (
  seed: GridPoint,
  layout: ConstructionLayout,
  boundaryKeys: Set<string>,
  visited: Set<string>,
) => {
  const cells: GridPoint[] = []
  const queue: GridPoint[] = [seed]
  visited.add(pointKey(seed))

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const point = queue[cursor]
    cells.push(point)
    for (const neighbor of openNeighbors(point, layout, boundaryKeys)) {
      const key = pointKey(neighbor)
      if (visited.has(key)) continue
      visited.add(key)
      queue.push(neighbor)
    }
  }

  return sortPoints(cells)
}

/**
 * Finds cardinally connected open regions that cannot reach a map-edge open cell.
 * Walls and doors both block flood fill; an enclosed region is promoted to a room
 * only when one of its cells is cardinally adjacent to a door boundary cell.
 */
export const detectRooms = (layout: ConstructionLayout): DetectedRoom[] => {
  const boundaryByKey = new Map(
    layout.boundaries.map((boundary) => [pointKey(boundary), boundary]),
  )
  const boundaryKeys = new Set(boundaryByKey.keys())
  const exteriorVisited = new Set<string>()

  const edgeSeeds: GridPoint[] = []
  for (let x = 0; x < layout.width; x += 1) {
    edgeSeeds.push({ x, y: 0 }, { x, y: layout.height - 1 })
  }
  for (let y = 1; y < layout.height - 1; y += 1) {
    edgeSeeds.push({ x: 0, y }, { x: layout.width - 1, y })
  }

  for (const seed of uniquePoints(edgeSeeds)) {
    const key = pointKey(seed)
    if (boundaryKeys.has(key) || exteriorVisited.has(key)) continue
    floodOpenRegion(seed, layout, boundaryKeys, exteriorVisited)
  }

  const enclosedVisited = new Set<string>()
  const candidates: Omit<DetectedRoom, 'id'>[] = []

  for (let y = 0; y < layout.height; y += 1) {
    for (let x = 0; x < layout.width; x += 1) {
      const seed = { x, y }
      const key = pointKey(seed)
      if (
        boundaryKeys.has(key) ||
        exteriorVisited.has(key) ||
        enclosedVisited.has(key)
      ) {
        continue
      }

      const cells = floodOpenRegion(seed, layout, boundaryKeys, enclosedVisited)
      const adjacentDoors = new Map<string, GridPoint>()
      cells.forEach((cell) => {
        cardinalNeighbors.forEach((offset) => {
          const neighbor = { x: cell.x + offset.x, y: cell.y + offset.y }
          const boundary = boundaryByKey.get(pointKey(neighbor))
          if (boundary?.kind === 'door') {
            adjacentDoors.set(pointKey(boundary), { x: boundary.x, y: boundary.y })
          }
        })
      })

      if (adjacentDoors.size === 0) continue

      const minX = Math.min(...cells.map((cell) => cell.x))
      const maxX = Math.max(...cells.map((cell) => cell.x))
      const minY = Math.min(...cells.map((cell) => cell.y))
      const maxY = Math.max(...cells.map((cell) => cell.y))
      candidates.push({
        cells,
        area: cells.length,
        bounds: {
          x: minX,
          y: minY,
          width: maxX - minX + 1,
          height: maxY - minY + 1,
        },
        doorCells: sortPoints([...adjacentDoors.values()]),
      })
    }
  }

  return candidates
    .sort((left, right) => comparePoints(left.cells[0], right.cells[0]))
    .map((room, index) => ({ id: `room-${index + 1}`, ...room }))
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

/**
 * Guards the persisted construction boundary before it reaches rendering or
 * room detection. Invalid or overlapping layouts are replaced by the seed.
 */
export const isConstructionLayout = (value: unknown): value is ConstructionLayout => {
  if (!isRecord(value)) return false
  if (
    value.width !== CONSTRUCTION_GRID_WIDTH ||
    value.height !== CONSTRUCTION_GRID_HEIGHT ||
    !Array.isArray(value.boundaries) ||
    !Array.isArray(value.workstations)
  ) {
    return false
  }

  const occupiedCells = new Set<string>()
  for (const candidate of value.boundaries) {
    if (
      !isRecord(candidate) ||
      typeof candidate.x !== 'number' ||
      typeof candidate.y !== 'number' ||
      (candidate.kind !== 'wall' && candidate.kind !== 'door')
    ) {
      return false
    }
    const point = { x: candidate.x, y: candidate.y }
    const key = pointKey(point)
    if (!isInConstructionBounds(point) || occupiedCells.has(key)) return false
    occupiedCells.add(key)
  }

  const workstationIds = new Set<string>()
  for (const candidate of value.workstations) {
    if (
      !isRecord(candidate) ||
      typeof candidate.id !== 'string' ||
      typeof candidate.type !== 'string' ||
      typeof candidate.label !== 'string' ||
      !isRecord(candidate.origin) ||
      typeof candidate.origin.x !== 'number' ||
      typeof candidate.origin.y !== 'number' ||
      !isRecord(candidate.size) ||
      typeof candidate.size.width !== 'number' ||
      typeof candidate.size.height !== 'number' ||
      typeof candidate.rotation !== 'number'
    ) {
      return false
    }

    const workstation = normalizeWorkstation({
      id: candidate.id,
      type: candidate.type,
      label: candidate.label,
      origin: { x: candidate.origin.x, y: candidate.origin.y },
      size: { width: candidate.size.width, height: candidate.size.height },
      rotation: candidate.rotation as WorkstationRotation,
    })
    if (!workstation || workstationIds.has(workstation.id)) return false
    workstationIds.add(workstation.id)

    const footprint = getWorkstationFootprintSize(workstation)
    if (footprint.width > CONSTRUCTION_GRID_WIDTH || footprint.height > CONSTRUCTION_GRID_HEIGHT) {
      return false
    }

    for (const cell of getWorkstationCells(workstation)) {
      const key = pointKey(cell)
      if (!isInConstructionBounds(cell) || occupiedCells.has(key)) return false
      occupiedCells.add(key)
    }
  }

  return true
}
