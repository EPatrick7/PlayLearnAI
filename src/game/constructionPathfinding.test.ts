import { describe, expect, it } from 'vitest'
import {
  createConstructionLayout,
  type BoundaryCell,
  type ConstructionLayout,
  type GridPoint,
  type WorkstationPlacement,
} from './construction'
import { createStarterConstruction } from './constructionCatalog'
import type { ConstructionOrder } from './constructionJobs'
import {
  findConstructionApproachPath,
  findConstructionOrderApproachPath,
  findConstructionPath,
  findConstructionPressureReturnPath,
  getConstructionApproachCells,
  isConstructionCellWalkable,
} from './constructionPathfinding'

const layoutWith = (
  boundaries: BoundaryCell[] = [],
  workstations: WorkstationPlacement[] = [],
): ConstructionLayout => ({
  ...createConstructionLayout(),
  boundaries,
  workstations,
})

const rack = (
  origin: GridPoint,
  size = { width: 2, height: 2 },
): WorkstationPlacement => ({
  id: `rack-${origin.x}-${origin.y}`,
  type: 'storage-rack',
  label: 'Storage rack',
  origin,
  size,
  rotation: 0,
})

const wallOrder = (cell: GridPoint): ConstructionOrder => ({
  id: 'wall-order',
  commandId: 'wall-command',
  sequence: 1,
  priority: 3,
  operation: 'construct',
  status: 'hauling',
  block: null,
  assignedCrewId: 'builder',
  target: {
    kind: 'boundary',
    cells: [{ ...cell }],
    construct: { ...cell, kind: 'wall' },
    deconstruct: null,
  },
  materials: { required: 1, reserved: 1, delivered: 0, recoverable: 0 },
  work: { required: 1, completed: 0 },
})

const pointKey = ({ x, y }: GridPoint) => `${x}:${y}`

describe('construction pathfinding', () => {
  it('treats walls and workstation footprints as solid while doors remain walkable', () => {
    const layout = layoutWith(
      [
        { x: 2, y: 2, kind: 'wall' },
        { x: 3, y: 2, kind: 'door' },
      ],
      [rack({ x: 5, y: 4 })],
    )

    expect(isConstructionCellWalkable(layout, { x: 1, y: 1 })).toBe(true)
    expect(isConstructionCellWalkable(layout, { x: 2, y: 2 })).toBe(false)
    expect(isConstructionCellWalkable(layout, { x: 3, y: 2 })).toBe(true)
    expect(isConstructionCellWalkable(layout, { x: 5, y: 4 })).toBe(false)
    expect(isConstructionCellWalkable(layout, { x: 6, y: 5 })).toBe(false)
    expect(isConstructionCellWalkable(layout, { x: -1, y: 0 })).toBe(false)
    expect(isConstructionCellWalkable(layout, { x: 1.5, y: 2 })).toBe(false)
  })

  it('finds a shortest cardinal path without crossing a wall', () => {
    const layout = layoutWith([{ x: 2, y: 2, kind: 'wall' }])
    const route = findConstructionPath(layout, { x: 1, y: 2 }, [{ x: 3, y: 2 }])

    expect(route?.path).toEqual([
      { x: 1, y: 2 },
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 3, y: 1 },
      { x: 3, y: 2 },
    ])
    route?.path.forEach((cell, index, path) => {
      expect(isConstructionCellWalkable(layout, cell)).toBe(true)
      if (index === 0) return
      const previous = path[index - 1]
      expect(Math.abs(previous.x - cell.x) + Math.abs(previous.y - cell.y)).toBe(1)
    })
  })

  it('uses stable tie-breaking independent of destination input order', () => {
    const layout = createConstructionLayout()
    const start = { x: 2, y: 2 }
    const goals = [{ x: 1, y: 1 }, { x: 3, y: 1 }]

    const forward = findConstructionPath(layout, start, goals)
    const reversed = findConstructionPath(layout, start, [...goals].reverse())

    expect(forward).toEqual(reversed)
    expect(forward?.path).toEqual([
      { x: 2, y: 2 },
      { x: 2, y: 1 },
      { x: 3, y: 1 },
    ])
  })

  it('returns only the walkable outside perimeter of a multi-tile target', () => {
    const layout = layoutWith([
      { x: 5, y: 4, kind: 'wall' },
      { x: 6, y: 4, kind: 'door' },
      { x: 4, y: 5, kind: 'wall' },
    ])
    const target = [
      { x: 5, y: 5 },
      { x: 6, y: 5 },
      { x: 5, y: 6 },
      { x: 6, y: 6 },
    ]

    expect(getConstructionApproachCells(layout, target)).toEqual([
      { x: 6, y: 4 },
      { x: 7, y: 5 },
      { x: 4, y: 6 },
      { x: 7, y: 6 },
      { x: 5, y: 7 },
      { x: 6, y: 7 },
    ])
  })

  it('routes a worker to an adjacent approach cell rather than onto the blueprint', () => {
    const layout = createConstructionLayout()
    const target = { x: 8, y: 8 }
    const order = wallOrder(target)
    const route = findConstructionOrderApproachPath(layout, { x: 5, y: 8 }, order)

    expect(route?.destination).toEqual({ x: 7, y: 8 })
    expect(route?.path.at(-1)).toEqual(route?.destination)
    expect(route?.path.map(pointKey)).not.toContain(pointKey(target))
    expect(
      Math.abs(route!.destination.x - target.x) +
      Math.abs(route!.destination.y - target.y),
    ).toBe(1)
  })

  it('treats unfinished footprints as temporary solids while allowing a pawn to step out', () => {
    const layout = createConstructionLayout()
    const reserved = [{ x: 2, y: 2 }, { x: 3, y: 2 }]
    const route = findConstructionPath(
      layout,
      { x: 2, y: 2 },
      [{ x: 4, y: 2 }],
      { transientBlockedCells: reserved },
    )

    expect(route?.path[0]).toEqual({ x: 2, y: 2 })
    expect(route?.path.slice(1).map(pointKey)).not.toContain('2:2')
    expect(route?.path.map(pointKey)).not.toContain('3:2')
    expect(getConstructionApproachCells(
      layout,
      [{ x: 4, y: 2 }],
      { transientBlockedCells: reserved },
    )).not.toContainEqual({ x: 3, y: 2 })
  })

  it('can route to the perimeter of an existing workstation for deconstruction', () => {
    const workstation = rack({ x: 8, y: 8 })
    const layout = layoutWith([], [workstation])
    const targetCells = [
      { x: 8, y: 8 },
      { x: 9, y: 8 },
      { x: 8, y: 9 },
      { x: 9, y: 9 },
    ]
    const route = findConstructionApproachPath(layout, { x: 5, y: 8 }, targetCells)

    expect(route?.destination).toEqual({ x: 7, y: 8 })
    expect(route?.path.every((cell) => isConstructionCellWalkable(layout, cell))).toBe(true)
  })

  it('returns null for a blocked start, unreachable target, or invalid target', () => {
    const barrier = Array.from({ length: 24 }, (_, x): BoundaryCell => ({
      x,
      y: 1,
      kind: 'wall',
    }))
    const layout = layoutWith(barrier)

    expect(findConstructionPath(layout, { x: 0, y: 1 }, [{ x: 0, y: 2 }])).toBeNull()
    expect(findConstructionPath(layout, { x: 0, y: 0 }, [{ x: 0, y: 2 }])).toBeNull()
    expect(findConstructionApproachPath(layout, { x: 0, y: 0 }, [{ x: -1, y: 0 }])).toBeNull()
  })

  it('honors a hard visit ceiling and never examines more than the grid area', () => {
    const layout = createConstructionLayout()

    expect(findConstructionPath(
      layout,
      { x: 0, y: 0 },
      [{ x: 2, y: 0 }],
      { maxVisitedCells: 2 },
    )).toBeNull()

    const route = findConstructionPath(
      layout,
      { x: 0, y: 0 },
      [{ x: 23, y: 17 }],
      { maxVisitedCells: Number.POSITIVE_INFINITY },
    )
    expect(route?.visitedCellCount).toBeLessThanOrEqual(layout.width * layout.height)
  })

  it('does not mutate its layout, start, or target inputs', () => {
    const layout = layoutWith([{ x: 2, y: 2, kind: 'door' }], [rack({ x: 6, y: 6 })])
    const start = { x: 1, y: 1 }
    const targets = [{ x: 4, y: 4 }, { x: 4, y: 5 }]
    const before = JSON.stringify({ layout, start, targets })

    findConstructionApproachPath(layout, start, targets)

    expect(JSON.stringify({ layout, start, targets })).toBe(before)
  })

  it('requires EVA and crosses the valid exterior airlock at a pressure boundary', () => {
    const layout = createStarterConstruction()
    const start = { x: 6, y: 10 }
    const exterior = { x: 8, y: 10 }

    expect(findConstructionPath(layout, start, [exterior], { hasEvaSuit: false }))
      .toBeNull()
    const suited = findConstructionPath(layout, start, [exterior], { hasEvaSuit: true })
    expect(suited?.path).toContainEqual({ x: 7, y: 9 })
  })

  it('keeps an interior pressure door traversable without EVA', () => {
    const boundaries: BoundaryCell[] = []
    for (let x = 2; x <= 10; x += 1) {
      boundaries.push({ x, y: 2, kind: 'wall' }, { x, y: 6, kind: 'wall' })
    }
    for (let y = 3; y <= 5; y += 1) {
      boundaries.push({ x: 2, y, kind: 'wall' })
      boundaries.push({ x: 6, y, kind: y === 4 ? 'door' : 'wall' })
      boundaries.push({ x: 10, y, kind: 'wall' })
    }
    const layout = layoutWith(boundaries)

    expect(findConstructionPath(
      layout,
      { x: 5, y: 4 },
      [{ x: 7, y: 4 }],
      { hasEvaSuit: false },
    )?.path).toEqual([
      { x: 5, y: 4 },
      { x: 6, y: 4 },
      { x: 7, y: 4 },
    ])
  })

  it('blocks a shell breach shortcut and routes suited return through the airlock', () => {
    const layout = createStarterConstruction()
    layout.boundaries = layout.boundaries.filter((boundary) => (
      boundary.x !== 7 || boundary.y !== 10
    ))

    const route = findConstructionPath(
      layout,
      { x: 6, y: 10 },
      [{ x: 8, y: 10 }],
      { hasEvaSuit: true },
    )
    expect(route?.path).toEqual([
      { x: 6, y: 10 },
      { x: 6, y: 9 },
      { x: 7, y: 9 },
      { x: 8, y: 9 },
      { x: 8, y: 10 },
    ])
    expect(route?.path).not.toContainEqual({ x: 7, y: 10 })
    expect(findConstructionPressureReturnPath(
      createStarterConstruction(),
      { x: 8, y: 10 },
    )?.path).toContainEqual({ x: 7, y: 9 })
  })
})
