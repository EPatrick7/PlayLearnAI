import {
  getWorkstationCells,
  isInConstructionBounds,
  type ConstructionLayout,
  type GridPoint,
} from './construction'
import type { ConstructionOrder } from './constructionJobs'

export interface ConstructionRoute {
  /** The shortest route, including both the start and destination cells. */
  path: GridPoint[]
  destination: GridPoint
  /** Number of unique grid cells examined or queued by the search. */
  visitedCellCount: number
}

export interface ConstructionPathfindingOptions {
  /**
   * Hard ceiling on unique cells considered. Defaults to the grid area, so a
   * search can never expand forever even when its destination is unreachable.
   */
  maxVisitedCells?: number
  /**
   * Cells reserved by unfinished construction footprints. They behave as
   * temporary solids while routing, but a pawn already standing on one may
   * step off it so older saves and simultaneous assignments can recover.
   */
  transientBlockedCells?: readonly GridPoint[]
}

const cardinalDirections: readonly GridPoint[] = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
]

const pointKey = ({ x, y }: GridPoint) => `${x}:${y}`

const comparePoints = (left: GridPoint, right: GridPoint) =>
  left.y - right.y || left.x - right.x

const clonePoint = ({ x, y }: GridPoint): GridPoint => ({ x, y })

const uniqueSortedInBoundsPoints = (
  layout: ConstructionLayout,
  points: readonly GridPoint[],
) => {
  const byKey = new Map<string, GridPoint>()
  points.forEach((point) => {
    if (isInConstructionBounds(point, layout)) {
      byKey.set(pointKey(point), clonePoint(point))
    }
  })
  return [...byKey.values()].sort(comparePoints)
}

const blockedCellKeys = (layout: ConstructionLayout) => {
  const blocked = new Set(
    layout.boundaries
      .filter((boundary) => boundary.kind === 'wall')
      .filter((boundary) => isInConstructionBounds(boundary, layout))
      .map(pointKey),
  )

  layout.workstations.forEach((workstation) => {
    getWorkstationCells(workstation).forEach((cell) => {
      if (isInConstructionBounds(cell, layout)) blocked.add(pointKey(cell))
    })
  })

  return blocked
}

const routeBlockedCellKeys = (
  layout: ConstructionLayout,
  transientBlockedCells: readonly GridPoint[] | undefined,
) => {
  const blocked = blockedCellKeys(layout)
  transientBlockedCells?.forEach((cell) => {
    if (isInConstructionBounds(cell, layout)) blocked.add(pointKey(cell))
  })
  return blocked
}

const visitLimit = (
  layout: ConstructionLayout,
  requested: number | undefined,
) => {
  const area = layout.width * layout.height
  if (requested === undefined || requested === Number.POSITIVE_INFINITY) return area
  if (!Number.isFinite(requested)) return 0
  return Math.max(0, Math.min(area, Math.floor(requested)))
}

const reconstructPath = (
  destination: GridPoint,
  parentByKey: ReadonlyMap<string, GridPoint | null>,
) => {
  const reversed: GridPoint[] = []
  let cursor: GridPoint | null = destination

  while (cursor) {
    reversed.push(clonePoint(cursor))
    cursor = parentByKey.get(pointKey(cursor)) ?? null
  }

  return reversed.reverse()
}

/**
 * Walls and workstation footprints are solid. Doors and empty floor are
 * walkable. Out-of-bounds and fractional coordinates are never walkable.
 */
export const isConstructionCellWalkable = (
  layout: ConstructionLayout,
  point: GridPoint,
) => isInConstructionBounds(point, layout) && !blockedCellKeys(layout).has(pointKey(point))

/**
 * Returns the open perimeter cells from which a colonist can work on any cell
 * in a construction target. Multi-tile target cells are excluded even when
 * they are not built yet, keeping workers outside the future footprint.
 */
export const getConstructionApproachCells = (
  layout: ConstructionLayout,
  targetCells: readonly GridPoint[],
  options: ConstructionPathfindingOptions = {},
): GridPoint[] => {
  const normalizedTargets = uniqueSortedInBoundsPoints(layout, targetCells)
  const targetKeys = new Set(normalizedTargets.map(pointKey))
  const blocked = routeBlockedCellKeys(layout, options.transientBlockedCells)
  const approaches = new Map<string, GridPoint>()

  normalizedTargets.forEach((target) => {
    cardinalDirections.forEach((direction) => {
      const candidate = {
        x: target.x + direction.x,
        y: target.y + direction.y,
      }
      const key = pointKey(candidate)
      if (
        isInConstructionBounds(candidate, layout) &&
        !targetKeys.has(key) &&
        !blocked.has(key)
      ) {
        approaches.set(key, candidate)
      }
    })
  })

  return [...approaches.values()].sort(comparePoints)
}

/**
 * Finds a shortest cardinal route from an open start to any open destination.
 * Equal paths are stable: cells expand north, east, south, then west. Goal
 * input order does not affect the result.
 */
export const findConstructionPath = (
  layout: ConstructionLayout,
  start: GridPoint,
  destinations: readonly GridPoint[],
  options: ConstructionPathfindingOptions = {},
): ConstructionRoute | null => {
  const physicallyBlocked = blockedCellKeys(layout)
  const blocked = routeBlockedCellKeys(layout, options.transientBlockedCells)
  const startKey = pointKey(start)
  const destinationKeys = new Set(
    uniqueSortedInBoundsPoints(layout, destinations)
      .filter((point) => !blocked.has(pointKey(point)))
      .map(pointKey),
  )
  const limit = visitLimit(layout, options.maxVisitedCells)

  if (
    limit === 0 ||
    !isInConstructionBounds(start, layout) ||
    physicallyBlocked.has(startKey) ||
    destinationKeys.size === 0
  ) return null

  const queue: GridPoint[] = [clonePoint(start)]
  const parentByKey = new Map<string, GridPoint | null>([[startKey, null]])
  let queueIndex = 0

  while (queueIndex < queue.length) {
    const current = queue[queueIndex]
    queueIndex += 1
    const currentKey = pointKey(current)

    if (destinationKeys.has(currentKey)) {
      return {
        path: reconstructPath(current, parentByKey),
        destination: clonePoint(current),
        visitedCellCount: parentByKey.size,
      }
    }

    cardinalDirections.forEach((direction) => {
      if (parentByKey.size >= limit) return
      const neighbor = {
        x: current.x + direction.x,
        y: current.y + direction.y,
      }
      const neighborKey = pointKey(neighbor)
      if (
        !parentByKey.has(neighborKey) &&
        isInConstructionBounds(neighbor, layout) &&
        !blocked.has(neighborKey)
      ) {
        parentByKey.set(neighborKey, clonePoint(current))
        queue.push(neighbor)
      }
    })
  }

  return null
}

export const findConstructionApproachPath = (
  layout: ConstructionLayout,
  start: GridPoint,
  targetCells: readonly GridPoint[],
  options: ConstructionPathfindingOptions = {},
) => findConstructionPath(
  layout,
  start,
  getConstructionApproachCells(layout, targetCells, options),
  options,
)

export const findConstructionOrderApproachPath = (
  layout: ConstructionLayout,
  start: GridPoint,
  order: Pick<ConstructionOrder, 'target'>,
  options: ConstructionPathfindingOptions = {},
) => findConstructionApproachPath(layout, start, order.target.cells, options)
