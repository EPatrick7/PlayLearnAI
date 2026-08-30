import { describe, expect, it } from 'vitest'
import {
  boundaryAt,
  createConstructionLayout,
  eraseAt,
  getWorkstationCells,
  occupantAt,
  paintBoundaryCell,
  paintBoundaryLine,
  placeWorkstation,
  type ConstructionLayout,
  type ConstructionResult,
} from './construction'
import {
  advanceConstructionOrders,
  cancelConstructionCommand,
  deriveConstructionOrders,
  projectConstructionOrders,
  type ConstructionOrder,
} from './constructionJobs'

const layoutFrom = (result: ConstructionResult) => {
  if (!result.ok) throw new Error(`${result.code}: ${result.error}`)
  return result.layout
}

const queue = (
  source: ConstructionLayout,
  result: ConstructionResult,
  commandId: string,
  sequenceStart = 0,
) =>
  deriveConstructionOrders(source, result, {
    commandId,
    priority: 2,
    sequenceStart,
  })

const advance = (
  layout: ConstructionLayout,
  orders: ConstructionOrder[],
  ticks: number,
) => {
  let state = { layout, orders }
  for (let tick = 0; tick < ticks; tick += 1) {
    state = advanceConstructionOrders(
      state.layout,
      state.orders,
      [{ id: 'amina', engineeringRate: 1 }],
    )
  }
  return state
}

describe('construction order derivation and projection', () => {
  it('keeps painted walls ghost-only and creates one persisted job per tile', () => {
    const completed = createConstructionLayout()
    const projectedResult = paintBoundaryLine(
      completed,
      { x: 2, y: 3 },
      { x: 5, y: 3 },
      'wall',
    )
    const completedSnapshot = structuredClone(completed)

    const orders = queue(completed, projectedResult, 'wall-drag')

    expect(completed).toEqual(completedSnapshot)
    expect(completed.boundaries).toEqual([])
    expect(orders).toHaveLength(4)
    expect(orders.map((order) => order.id)).toEqual([
      'wall-drag:0',
      'wall-drag:1',
      'wall-drag:2',
      'wall-drag:3',
    ])
    expect(orders.map((order) => order.target.cells)).toEqual([
      [{ x: 2, y: 3 }],
      [{ x: 3, y: 3 }],
      [{ x: 4, y: 3 }],
      [{ x: 5, y: 3 }],
    ])
    expect(orders.every((order) => order.status === 'hauling')).toBe(true)
    expect(orders.every((order) => order.materials.required === 1)).toBe(true)

    const projection = projectConstructionOrders(completed, orders)
    expect(projection.valid).toBe(true)
    expect(projection.layout.boundaries).toEqual(projectedResult.layout.boundaries)
    expect(completed.boundaries).toEqual([])
  })

  it('queues a multi-tile workstation as one atomic ghost and reserves its footprint', () => {
    const completed = createConstructionLayout()
    const projectedResult = placeWorkstation(completed, {
      id: 'research-1',
      type: 'research-bench',
      label: 'Research bench',
      origin: { x: 6, y: 4 },
      size: { width: 3, height: 2 },
      rotation: 0,
    })

    const orders = queue(completed, projectedResult, 'bench-click')
    expect(orders).toHaveLength(1)
    expect(orders[0]).toMatchObject({
      operation: 'construct',
      status: 'hauling',
      materials: { required: 6, delivered: 0 },
      work: { required: 6, completed: 0 },
      target: { kind: 'workstation' },
    })
    expect(orders[0].target.cells).toHaveLength(6)
    expect(completed.workstations).toEqual([])

    const projection = projectConstructionOrders(completed, orders)
    expect(projection.valid).toBe(true)
    expect(projection.layout.workstations).toHaveLength(1)
    expect(getWorkstationCells(projection.layout.workstations[0])).toHaveLength(6)

    const occupiedWall = paintBoundaryCell(projection.layout, { x: 7, y: 5 }, 'wall')
    expect(occupiedWall).toMatchObject({
      ok: false,
      code: 'occupied',
      conflictingCell: { x: 7, y: 5 },
    })
  })

  it('retains completed structures until their deconstruction work finishes', () => {
    const initial = layoutFrom(
      paintBoundaryCell(createConstructionLayout(), { x: 8, y: 7 }, 'wall'),
    )
    const projectedResult = eraseAt(initial, { x: 8, y: 7 })
    const orders = queue(initial, projectedResult, 'remove-wall')

    expect(orders).toHaveLength(1)
    expect(orders[0]).toMatchObject({
      operation: 'deconstruct',
      status: 'building',
      materials: { required: 0, delivered: 0 },
      target: {
        construct: null,
        deconstruct: { x: 8, y: 7, kind: 'wall' },
      },
    })
    expect(boundaryAt(initial, { x: 8, y: 7 })).toBeDefined()
    expect(projectConstructionOrders(initial, orders).layout.boundaries).toEqual([])

    const partial = advanceConstructionOrders(
      initial,
      orders.map((order) => ({
        ...order,
        work: { ...order.work, required: 2 },
      })),
      [{ id: 'amina', engineeringRate: 1 }],
    )
    expect(partial.orders[0]).toMatchObject({
      status: 'building',
      assignedCrewId: 'amina',
      work: { required: 2, completed: 1 },
    })
    expect(boundaryAt(partial.layout, { x: 8, y: 7 })).toBeDefined()

    const finished = advanceConstructionOrders(
      partial.layout,
      partial.orders,
      [{ id: 'amina', engineeringRate: 1 }],
    )
    expect(finished.orders[0]).toMatchObject({
      status: 'complete',
      assignedCrewId: null,
      work: { required: 2, completed: 2 },
    })
    expect(boundaryAt(finished.layout, { x: 8, y: 7 })).toBeUndefined()
  })

  it('cancels an entire command while preserving finished work and recomputing ghosts', () => {
    const completed = createConstructionLayout()
    const wallResult = paintBoundaryLine(
      completed,
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      'wall',
    )
    const wallOrders = queue(completed, wallResult, 'walls')
    const wallProjection = projectConstructionOrders(completed, wallOrders)
    const benchResult = placeWorkstation(wallProjection.layout, {
      id: 'bench',
      type: 'research-bench',
      origin: { x: 5, y: 5 },
      size: { width: 2, height: 2 },
    })
    const benchOrders = queue(wallProjection.layout, benchResult, 'bench', 2)

    const cancelled = cancelConstructionCommand(
      completed,
      [...wallOrders, ...benchOrders],
      'walls',
    )
    expect(cancelled.cancelledOrderIds).toEqual(['walls:0', 'walls:1'])
    expect(cancelled.orders.map((order) => order.commandId)).toEqual(['bench'])
    expect(cancelled.projection.valid).toBe(true)
    expect(cancelled.projection.layout.boundaries).toEqual([])
    expect(cancelled.projection.layout.workstations.map((item) => item.id)).toEqual([
      'bench',
    ])
  })
})

describe('deterministic worker construction', () => {
  it('assigns sorted workers by priority and sequence, then hauls and builds', () => {
    const completed = createConstructionLayout()
    const projectedResult = paintBoundaryLine(
      completed,
      { x: 3, y: 2 },
      { x: 4, y: 2 },
      'wall',
    )
    const orders = queue(completed, projectedResult, 'two-walls')

    const hauled = advanceConstructionOrders(completed, orders, [
      { id: 'zoe', engineeringRate: 3 },
      { id: 'amina', engineeringRate: 1 },
    ])
    expect(hauled.layout.boundaries).toEqual([])
    expect(hauled.orders).toMatchObject([
      {
        status: 'building',
        assignedCrewId: 'zoe',
        materials: { required: 1, delivered: 1 },
        work: { completed: 0 },
      },
      {
        status: 'building',
        assignedCrewId: 'amina',
        materials: { required: 1, delivered: 1 },
        work: { completed: 0 },
      },
    ])

    const built = advanceConstructionOrders(hauled.layout, hauled.orders, [
      { id: 'zoe', engineeringRate: 3 },
      { id: 'amina', engineeringRate: 1 },
    ])
    expect(built.completedOrderIds).toEqual(['two-walls:0', 'two-walls:1'])
    expect(built.orders.every((order) => order.status === 'complete')).toBe(true)
    expect(built.layout.boundaries).toEqual(projectedResult.layout.boundaries)
  })

  it('does not expose a workstation in the completed layout during hauling or work', () => {
    const completed = createConstructionLayout()
    const projectedResult = placeWorkstation(completed, {
      id: 'rack',
      type: 'storage-rack',
      origin: { x: 10, y: 6 },
      size: { width: 2, height: 2 },
    })
    const orders = queue(completed, projectedResult, 'rack')

    const partial = advance(completed, orders, 7)
    expect(partial.orders[0]).toMatchObject({
      status: 'building',
      materials: { required: 4, delivered: 4 },
      work: { required: 4, completed: 3 },
    })
    expect(partial.layout.workstations).toEqual([])
    expect(occupantAt(partial.layout, { x: 10, y: 6 })).toBeNull()

    const finished = advanceConstructionOrders(
      partial.layout,
      partial.orders,
      [{ id: 'amina', engineeringRate: 1 }],
    )
    expect(finished.orders[0].status).toBe('complete')
    expect(finished.layout.workstations.map((item) => item.id)).toEqual(['rack'])
  })
})
