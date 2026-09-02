import { describe, expect, it } from 'vitest'
import { createStarterConstruction } from './constructionCatalog'
import { findConstructionPath } from './constructionPathfinding'
import {
  offsetStarterPoint,
  type BoundaryCell,
  type ConstructionLayout,
} from './construction'
import {
  analyzeConstructionPressure,
  constructionCellRequiresEva,
  constructionDoorConnectionAt,
  constructionEnvironmentAt,
} from './pressureTopology'

const twoRoomLayout = (): ConstructionLayout => {
  const boundaries: BoundaryCell[] = []
  for (let x = 2; x <= 10; x += 1) {
    boundaries.push({ x, y: 2, kind: 'wall' }, { x, y: 6, kind: 'wall' })
  }
  for (let y = 3; y <= 5; y += 1) {
    boundaries.push({ x: 2, y, kind: 'wall' })
    boundaries.push({ x: 6, y, kind: y === 4 ? 'door' : 'wall' })
    boundaries.push({ x: 10, y, kind: 'wall' })
  }
  return { width: 24, height: 18, boundaries, workstations: [] }
}

describe('construction pressure topology', () => {
  it('classifies the starter exit as an exterior airlock', () => {
    const layout = createStarterConstruction()
    const topology = analyzeConstructionPressure(layout)
    const door = constructionDoorConnectionAt(topology, offsetStarterPoint({ x: 7, y: 9 }))

    expect(topology.rooms).toHaveLength(1)
    expect(door).toMatchObject({
      axis: 'vertical',
      role: 'exterior_airlock',
      roomIds: ['room-1'],
      passageRoomIds: ['room-1', null],
    })
    expect(constructionEnvironmentAt(layout, topology, offsetStarterPoint({ x: 6, y: 9 })))
      .toBe('pressurized')
    expect(constructionEnvironmentAt(layout, topology, offsetStarterPoint({ x: 7, y: 9 })))
      .toBe('airlock')
    expect(constructionEnvironmentAt(layout, topology, offsetStarterPoint({ x: 8, y: 9 })))
      .toBe('vacuum')
  })

  it('keeps a door between two enclosed rooms as an interior pressure door', () => {
    const layout = twoRoomLayout()
    const topology = analyzeConstructionPressure(layout)
    const door = constructionDoorConnectionAt(topology, { x: 6, y: 4 })

    expect(topology.rooms).toHaveLength(2)
    expect(door).toMatchObject({
      axis: 'vertical',
      role: 'pressure_door',
      roomIds: ['room-1', 'room-2'],
    })
    expect(constructionCellRequiresEva(layout, topology, { x: 6, y: 4 })).toBe(false)
  })

  it('routes the landed crew through the airlock before reaching lunar exterior', () => {
    const layout = createStarterConstruction()
    const topology = analyzeConstructionPressure(layout)
    const route = findConstructionPath(
      layout,
      offsetStarterPoint({ x: 6, y: 9 }),
      [offsetStarterPoint({ x: 8, y: 9 })],
    )

    expect(route?.path).toContainEqual(offsetStarterPoint({ x: 7, y: 9 }))
    expect(route?.path.filter((cell) => constructionCellRequiresEva(layout, topology, cell)))
      .toEqual([
        offsetStarterPoint({ x: 7, y: 9 }),
        offsetStarterPoint({ x: 8, y: 9 }),
      ])
  })

  it('does not promote ambiguous or same-room doors to exterior airlocks', () => {
    const boundaries: BoundaryCell[] = []
    for (let x = 2; x <= 10; x += 1) {
      boundaries.push({ x, y: 2, kind: 'wall' }, { x, y: 8, kind: 'wall' })
    }
    for (let y = 3; y <= 7; y += 1) {
      boundaries.push({ x: 2, y, kind: 'wall' }, { x: 10, y, kind: 'wall' })
    }
    boundaries.push(
      { x: 6, y: 4, kind: 'wall' },
      { x: 6, y: 5, kind: 'door' },
      { x: 6, y: 6, kind: 'wall' },
      { x: 8, y: 5, kind: 'door' },
    )
    const layout: ConstructionLayout = {
      width: 24,
      height: 18,
      boundaries,
      workstations: [],
    }
    const topology = analyzeConstructionPressure(layout)

    expect(constructionDoorConnectionAt(topology, { x: 6, y: 5 })).toMatchObject({
      role: 'invalid',
      passageRoomIds: ['room-1', 'room-1'],
    })
    expect(constructionDoorConnectionAt(topology, { x: 8, y: 5 })).toMatchObject({
      role: 'invalid',
    })
    expect(topology.doors).not.toContainEqual(expect.objectContaining({
      cell: { x: 8, y: 5 },
      role: 'exterior_airlock',
    }))
  })

  it('identifies a shell breach while preserving the structural exterior airlock', () => {
    const layout = createStarterConstruction()
    const breach = offsetStarterPoint({ x: 7, y: 10 })
    layout.boundaries = layout.boundaries.filter((boundary) => (
      boundary.x !== breach.x || boundary.y !== breach.y
    ))
    const topology = analyzeConstructionPressure(layout)

    expect(topology.rooms).toHaveLength(0)
    expect(topology.breachCells).toEqual([breach])
    expect(constructionDoorConnectionAt(
      topology,
      offsetStarterPoint({ x: 7, y: 9 }),
    )).toMatchObject({
      role: 'exterior_airlock',
      passageRoomIds: ['room-1', null],
    })
  })
})
