import {
  detectRooms,
  getWorkstationCells,
  isInConstructionBounds,
  type ConstructionLayout,
  type GridPoint,
} from './construction'
import type { ConstructionOrder } from './constructionJobs'
import type { CrewMember } from './types'

const pointKey = ({ x, y }: GridPoint) => `${x}:${y}`

const compareIds = (left: string, right: string) =>
  left < right ? -1 : left > right ? 1 : 0

const comparePoints = (left: GridPoint, right: GridPoint) =>
  left.y - right.y || left.x - right.x

const clonePoint = ({ x, y }: GridPoint): GridPoint => ({ x, y })

const squaredDistance = (left: GridPoint, right: GridPoint) => {
  const deltaX = left.x - right.x
  const deltaY = left.y - right.y
  return deltaX * deltaX + deltaY * deltaY
}

const allGridCells = (layout: ConstructionLayout) =>
  Array.from({ length: layout.width * layout.height }, (_, index) => ({
    x: index % layout.width,
    y: Math.floor(index / layout.width),
  }))

const occupiedLayoutCells = (layout: ConstructionLayout) => new Set([
  ...layout.boundaries.map(pointKey),
  ...layout.workstations.flatMap((workstation) =>
    getWorkstationCells(workstation).map(pointKey),
  ),
])

const distanceToClosest = (point: GridPoint, anchors: readonly GridPoint[]) =>
  anchors.reduce(
    (closest, anchor) => Math.min(closest, squaredDistance(point, anchor)),
    Number.POSITIVE_INFINITY,
  )

/**
 * Derives presentation cells for the construction-map crew layer without
 * mutating layout, crew, or job state.
 *
 * Active builders occupy the first cell of their earliest assigned order.
 * Everyone else is placed deterministically by crew id: usable room floors
 * first, then unobstructed exterior cells nearest the base. Idle positions do
 * not overlap another crew cell or an unfinished construction target when a
 * safe alternative exists.
 */
export const deriveConstructionCrewCells = (
  layout: ConstructionLayout,
  crew: readonly CrewMember[],
  orders: readonly ConstructionOrder[],
): Map<string, GridPoint> => {
  const crewIds = new Set(crew.map((member) => member.id))
  const sortedCrew = [...crew].sort((left, right) => compareIds(left.id, right.id))
  const sortedOpenOrders = [...orders]
    .filter((order) => order.status !== 'complete' && order.assignedCrewId)
    .sort((left, right) => left.sequence - right.sequence || compareIds(left.id, right.id))

  const assignedCells = new Map<string, GridPoint>()
  sortedOpenOrders.forEach((order) => {
    const crewId = order.assignedCrewId
    const target = order.target.cells[0]
    if (
      !crewId ||
      !crewIds.has(crewId) ||
      assignedCells.has(crewId) ||
      !target ||
      !isInConstructionBounds(target, layout)
    ) return
    assignedCells.set(crewId, clonePoint(target))
  })

  const occupied = occupiedLayoutCells(layout)
  const unfinishedTargets = new Set(
    orders
      .filter((order) => order.status !== 'complete')
      .flatMap((order) => order.target.cells)
      .filter((cell) => isInConstructionBounds(cell, layout))
      .map(pointKey),
  )
  const used = new Set([...assignedCells.values()].map(pointKey))

  const roomCells = detectRooms(layout)
    .flatMap((room) => room.cells)
    .filter((cell) => {
      const key = pointKey(cell)
      return !occupied.has(key) && !unfinishedTargets.has(key)
    })
    .sort(comparePoints)
  const roomCellKeys = new Set(roomCells.map(pointKey))
  const mapCenter = {
    x: (layout.width - 1) / 2,
    y: (layout.height - 1) / 2,
  }
  const anchors = roomCells.length > 0 ? roomCells : [mapCenter]

  const safeOpenCells = allGridCells(layout)
    .filter((cell) => {
      const key = pointKey(cell)
      return !occupied.has(key) && !roomCellKeys.has(key) && !unfinishedTargets.has(key)
    })
    .sort((left, right) =>
      distanceToClosest(left, anchors) - distanceToClosest(right, anchors) ||
      comparePoints(left, right),
    )

  // If construction designations cover every otherwise-safe fallback cell,
  // still prefer an unobstructed tile over a built obstacle.
  const designatedOpenCells = allGridCells(layout)
    .filter((cell) => {
      const key = pointKey(cell)
      return !occupied.has(key) && !roomCellKeys.has(key) && unfinishedTargets.has(key)
    })
    .sort((left, right) =>
      distanceToClosest(left, anchors) - distanceToClosest(right, anchors) ||
      comparePoints(left, right),
    )

  const preferredCells = [...roomCells, ...safeOpenCells, ...designatedOpenCells]
  const everyCell = allGridCells(layout).sort((left, right) =>
    squaredDistance(left, mapCenter) - squaredDistance(right, mapCenter) ||
    comparePoints(left, right),
  )
  const result = new Map<string, GridPoint>()

  sortedCrew.forEach((member, index) => {
    const assigned = assignedCells.get(member.id)
    if (assigned) {
      result.set(member.id, clonePoint(assigned))
      return
    }

    const safeCell = preferredCells.find((cell) => !used.has(pointKey(cell)))
    const lastResort = everyCell.find((cell) => !used.has(pointKey(cell)))
      ?? everyCell[index % everyCell.length]
      ?? { x: 0, y: 0 }
    const cell = safeCell ?? lastResort
    result.set(member.id, clonePoint(cell))
    used.add(pointKey(cell))
  })

  return result
}
