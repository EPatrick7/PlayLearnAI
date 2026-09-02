import { describe, expect, it } from 'vitest'
import {
  createConstructionLayout,
  detectRooms,
  getWorkstationCells,
  isInConstructionBounds,
  type GridPoint,
  type WorkstationPlacement,
} from './construction'
import { createStarterConstruction } from './constructionCatalog'
import { deriveConstructionCrewCells } from './constructionCrew'
import type { ConstructionOrder } from './constructionJobs'
import type { CrewMember } from './types'

const member = (id: string): CrewMember => ({
  id,
  name: id,
  role: 'Builder',
  trait: 'Steady',
  status: 'idle',
  health: 100,
  fatigue: 0,
  morale: 100,
  location: 'habitat',
  taskId: null,
  skills: { engineering: 5, science: 1, medicine: 1, operations: 1 },
})

const workstationOrder = (
  id: string,
  assignedCrewId: string | null,
  cells: GridPoint[],
  sequence = 1,
): ConstructionOrder => {
  const workstation: WorkstationPlacement = {
    id: `${id}-target`,
    type: 'storage-rack',
    label: 'Storage rack',
    origin: { ...cells[0] },
    size: { width: Math.max(1, cells.length), height: 1 },
    rotation: 0,
  }
  return {
    id,
    commandId: id,
    sequence,
    priority: 3,
    operation: 'construct',
    status: 'building',
    block: null,
    assignedCrewId,
    target: {
      kind: 'workstation',
      cells: cells.map((cell) => ({ ...cell })),
      construct: workstation,
      deconstruct: null,
    },
    materials: { required: cells.length, reserved: cells.length, delivered: cells.length, recoverable: 0 },
    work: { required: cells.length, completed: 0 },
  }
}

const cellKey = ({ x, y }: GridPoint) => `${x}:${y}`

describe('deriveConstructionCrewCells', () => {
  it('places every idle crew member on a unique, walkable room-floor cell first', () => {
    const layout = createStarterConstruction()
    const crew = ['delta', 'alpha', 'charlie', 'bravo'].map(member)

    const cells = deriveConstructionCrewCells(layout, crew, [])
    const roomFloor = new Set(detectRooms(layout).flatMap((room) => room.cells).map(cellKey))
    const occupied = new Set([
      ...layout.boundaries.map(cellKey),
      ...layout.workstations.flatMap((workstation) => getWorkstationCells(workstation).map(cellKey)),
    ])

    expect([...cells.keys()]).toEqual(['alpha', 'bravo', 'charlie', 'delta'])
    expect(cells.size).toBe(crew.length)
    expect(new Set([...cells.values()].map(cellKey))).toHaveLength(crew.length)
    cells.forEach((cell) => {
      expect(isInConstructionBounds(cell, layout)).toBe(true)
      expect(roomFloor.has(cellKey(cell))).toBe(true)
      expect(occupied.has(cellKey(cell))).toBe(false)
    })
  })

  it('puts assigned workers on the first target cell and keeps idle crew off job sites', () => {
    const layout = createStarterConstruction()
    const target = [{ x: 5, y: 8 }, { x: 5, y: 9 }]
    const orders = [workstationOrder('rack-job', 'worker', target)]

    const cells = deriveConstructionCrewCells(
      layout,
      [member('worker'), member('idle-a'), member('idle-b')],
      orders,
    )

    expect(cells.get('worker')).toEqual(target[0])
    expect(target).not.toContainEqual(cells.get('idle-a'))
    expect(target).not.toContainEqual(cells.get('idle-b'))
    expect(new Set([...cells.values()].map(cellKey))).toHaveLength(3)
  })

  it('is stable across crew and order array reordering', () => {
    const layout = createStarterConstruction()
    const crew = [member('worker-b'), member('idle'), member('worker-a')]
    const orders = [
      workstationOrder('later', 'worker-b', [{ x: 14, y: 5 }], 8),
      workstationOrder('earlier', 'worker-a', [{ x: 12, y: 4 }, { x: 13, y: 4 }], 2),
    ]

    const forward = deriveConstructionCrewCells(layout, crew, orders)
    const reversed = deriveConstructionCrewCells(layout, [...crew].reverse(), [...orders].reverse())

    expect([...forward.entries()]).toEqual([...reversed.entries()])
    expect(forward.get('worker-a')).toEqual({ x: 12, y: 4 })
    expect(forward.get('worker-b')).toEqual({ x: 14, y: 5 })
  })

  it('falls back to unique, center-near open cells when no room exists', () => {
    const layout = createConstructionLayout()
    const crew = [member('c'), member('a'), member('b')]

    const cells = deriveConstructionCrewCells(layout, crew, [])

    expect(cells.size).toBe(3)
    expect(new Set([...cells.values()].map(cellKey))).toHaveLength(3)
    cells.forEach((cell) => expect(isInConstructionBounds(cell, layout)).toBe(true))
    const centerX = (layout.width - 1) / 2
    const centerY = (layout.height - 1) / 2
    expect(Math.max(...[...cells.values()].map((cell) => Math.abs(cell.x - centerX))))
      .toBeLessThanOrEqual(1.5)
    expect(Math.max(...[...cells.values()].map((cell) => Math.abs(cell.y - centerY))))
      .toBeLessThanOrEqual(1)
  })

  it('ignores invalid or completed assignments while still returning an in-bounds cell', () => {
    const layout = createConstructionLayout()
    const completed = workstationOrder('complete', 'idle', [{ x: 4, y: 4 }])
    completed.status = 'complete'
    const invalid = workstationOrder('invalid', 'idle', [{ x: 99, y: 99 }], 0)

    const cells = deriveConstructionCrewCells(layout, [member('idle')], [completed, invalid])

    expect(cells.get('idle')).not.toEqual({ x: 4, y: 4 })
    expect(isInConstructionBounds(cells.get('idle')!, layout)).toBe(true)
  })
})
