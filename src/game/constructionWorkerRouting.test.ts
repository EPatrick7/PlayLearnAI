import { describe, expect, it } from 'vitest'
import {
  createConstructionLayout,
  type BoundaryCell,
  type ConstructionLayout,
  type GridPoint,
  type WorkstationPlacement,
} from './construction'
import type { ConstructionOrder } from './constructionJobs'
import {
  advanceConstructionWorkerRouting,
  normalizeConstructionCrewPositions,
  normalizePersistedConstructionCrewPositions,
  normalizeConstructionStockpile,
  type ConstructionCrewPosition,
  type RoutableConstructionOrder,
} from './constructionWorkerRouting'

const layoutWith = (
  boundaries: BoundaryCell[] = [],
  workstations: WorkstationPlacement[] = [],
): ConstructionLayout => ({
  ...createConstructionLayout(),
  boundaries,
  workstations,
})

const wallOrder = (
  id: string,
  target: GridPoint,
  options: Partial<RoutableConstructionOrder> = {},
): RoutableConstructionOrder => ({
  id,
  commandId: id,
  sequence: 1,
  priority: 3,
  operation: 'construct',
  status: 'hauling',
  block: null,
  assignedCrewId: null,
  travelPhase: 'idle',
  prerequisiteOrderIds: [],
  target: {
    kind: 'boundary',
    cells: [{ ...target }],
    construct: { ...target, kind: 'wall' },
    deconstruct: null,
  },
  materials: { required: 1, reserved: 1, delivered: 0, recoverable: 0 },
  work: { required: 1, completed: 0 },
  ...options,
})

const route = (
  layout: ConstructionLayout,
  orders: RoutableConstructionOrder[],
  positions: ConstructionCrewPosition[],
  elapsed: number,
) => advanceConstructionWorkerRouting({
  layout,
  orders,
  crewPositions: positions,
  workers: [{ id: 'builder', movementRate: 2 }],
  stockpile: { x: 1, y: 1 },
  elapsed,
})

describe('construction worker routing', () => {
  it('repairs a stockpile cell that became obstructed', () => {
    const layout = layoutWith([{ x: 8, y: 9, kind: 'wall' }])

    expect(normalizeConstructionStockpile(layout, { x: 8, y: 9 })).toEqual({ x: 8, y: 8 })
    expect(normalizeConstructionStockpile(layout, { x: -1, y: 0 }, { x: 2, y: 2 }))
      .toEqual({ x: 2, y: 2 })
  })

  it('relocates an obstructed pallet locally instead of teleporting to the default', () => {
    const layout = layoutWith([{ x: 1, y: 1, kind: 'wall' }])

    expect(normalizeConstructionStockpile(layout, { x: 1, y: 1 }, { x: 8, y: 9 }))
      .toEqual({ x: 1, y: 0 })
  })

  it('relocates a pallet away from an unfinished construction footprint', () => {
    const layout = createConstructionLayout()

    expect(normalizeConstructionStockpile(
      layout,
      { x: 1, y: 1 },
      { x: 8, y: 9 },
      [{ x: 1, y: 1 }],
    )).toEqual({ x: 1, y: 0 })
  })

  it('relocates a pallet before pending walls isolate its walkable tile', () => {
    const layout = createConstructionLayout()
    const pendingRing = [
      { x: 5, y: 4 },
      { x: 6, y: 5 },
      { x: 5, y: 6 },
      { x: 4, y: 5 },
    ]

    expect(normalizeConstructionStockpile(
      layout,
      { x: 5, y: 5 },
      { x: 8, y: 9 },
      pendingRing,
    )).toEqual({ x: 5, y: 3 })
  })

  it('moves an obstructed pallet past a nearer sealed pocket into the connected work area', () => {
    const layout = layoutWith([
      { x: 5, y: 5, kind: 'wall' },
      { x: 5, y: 4, kind: 'wall' },
      { x: 5, y: 6, kind: 'wall' },
      { x: 6, y: 5, kind: 'wall' },
      { x: 3, y: 5, kind: 'wall' },
      { x: 4, y: 4, kind: 'wall' },
      { x: 4, y: 6, kind: 'wall' },
    ])

    expect(normalizeConstructionStockpile(layout, { x: 5, y: 5 }))
      .toEqual({ x: 5, y: 3 })
  })

  it('repairs missing and blocked persisted positions deterministically', () => {
    const layout = layoutWith([{ x: 1, y: 1, kind: 'wall' }])
    const source = [{ crewId: 'b', cell: { x: 1, y: 1 }, moveCredit: 5 }]
    const normalized = normalizeConstructionCrewPositions(
      layout,
      [{ id: 'b' }, { id: 'a' }],
      source,
      { x: 2, y: 1 },
    )

    expect(normalized.map((position) => position.crewId)).toEqual(['a', 'b'])
    expect(normalized.map((position) => position.cell)).toEqual([
      { x: 2, y: 1 },
      { x: 1, y: 0 },
    ])
    expect(normalized.every((position) => position.moveCredit === 0)).toBe(true)
  })

  it('drops malformed persisted crew records before normalization', () => {
    const normalized = normalizePersistedConstructionCrewPositions(
      createConstructionLayout(),
      [{ id: 'builder' }],
      [null, { crewId: 'builder', cell: { x: 'bad', y: 2 } }],
      { x: 1, y: 1 },
    )

    expect(normalized).toEqual([
      { crewId: 'builder', cell: { x: 1, y: 1 }, moveCredit: 0 },
    ])
  })

  it('visits the stockpile and target perimeter before exposing any work time', () => {
    const layout = createConstructionLayout()
    const order = wallOrder('wall', { x: 5, y: 1 })
    const start = [{ crewId: 'builder', cell: { x: 0, y: 1 }, moveCredit: 0 }]

    const first = route(layout, [order], start, 0.5)
    expect(first.orders[0]).toMatchObject({
      assignedCrewId: 'builder',
      travelPhase: 'to_site',
    })
    expect(first.crewPositions[0].cell).toEqual({ x: 1, y: 1 })
    expect(first.atSiteWorkers).toEqual([])

    const second = route(layout, first.orders, first.crewPositions, 1)
    expect(second.crewPositions[0].cell).toEqual({ x: 3, y: 1 })
    expect(second.atSiteWorkers).toEqual([])

    const arrived = route(layout, second.orders, second.crewPositions, 0.5)
    expect(arrived.orders[0].travelPhase).toBe('at_site')
    expect(arrived.crewPositions[0].cell).toEqual({ x: 4, y: 1 })
    expect(arrived.atSiteWorkers).toEqual([
      { crewId: 'builder', orderId: 'wall', availableWorkTime: 0 },
    ])
  })

  it('routes around walls, through doors, and never onto a workstation footprint', () => {
    const barriers: BoundaryCell[] = Array.from({ length: 5 }, (_, x) => ({
      x,
      y: 2,
      kind: x === 2 ? 'door' : 'wall',
    }))
    const workstation: WorkstationPlacement = {
      id: 'rack',
      type: 'storage-rack',
      label: 'Rack',
      origin: { x: 3, y: 3 },
      size: { width: 2, height: 2 },
      rotation: 0,
    }
    const layout = layoutWith(barriers, [workstation])
    const result = advanceConstructionWorkerRouting({
      layout,
      orders: [wallOrder('wall', { x: 5, y: 4 }, {
        status: 'building',
        materials: { required: 1, reserved: 0, delivered: 1, recoverable: 0 },
      })],
      crewPositions: [{ crewId: 'builder', cell: { x: 2, y: 1 }, moveCredit: 0 }],
      workers: [{ id: 'builder', movementRate: 20 }],
      stockpile: { x: 0, y: 0 },
      elapsed: 1,
    })

    expect(result.noPathOrderIds).toEqual([])
    expect(result.orders[0].travelPhase).toBe('at_site')
    expect(result.crewPositions[0].cell).not.toEqual({ x: 3, y: 3 })
    expect(result.crewPositions[0].cell).not.toEqual({ x: 4, y: 3 })
    expect(result.crewPositions[0].cell.y).toBeGreaterThanOrEqual(3)
  })

  it('never uses another unfinished wall footprint as a work position', () => {
    const first = wallOrder('first', { x: 5, y: 1 }, {
      status: 'building',
      assignedCrewId: 'alpha',
      travelPhase: 'at_site',
      materials: { required: 1, reserved: 0, delivered: 1, recoverable: 0 },
    })
    const second = wallOrder('second', { x: 6, y: 1 }, {
      sequence: 2,
      status: 'building',
      assignedCrewId: 'beta',
      travelPhase: 'at_site',
      materials: { required: 1, reserved: 0, delivered: 1, recoverable: 0 },
    })
    const result = advanceConstructionWorkerRouting({
      layout: createConstructionLayout(),
      orders: [first, second],
      crewPositions: [
        { crewId: 'alpha', cell: { x: 4, y: 1 }, moveCredit: 0 },
        { crewId: 'beta', cell: { x: 5, y: 1 }, moveCredit: 0 },
      ],
      workers: [
        { id: 'alpha', movementRate: 2 },
        { id: 'beta', movementRate: 2 },
      ],
      stockpile: { x: 1, y: 1 },
      elapsed: 1,
    })

    expect(result.crewPositions.find((position) => position.crewId === 'alpha')?.cell)
      .toEqual({ x: 4, y: 1 })
    expect(result.crewPositions.find((position) => position.crewId === 'beta')?.cell)
      .toEqual({ x: 5, y: 0 })
    expect(result.atSiteWorkers.map((arrival) => arrival.crewId)).toEqual(['alpha'])
    expect(result.orders.find((order) => order.id === 'second')).toMatchObject({
      assignedCrewId: 'beta',
      travelPhase: 'to_site',
    })
  })

  it('evacuates across contiguous blueprints when they are the only exit', () => {
    const first = wallOrder('first', { x: 1, y: 1 }, {
      status: 'blocked',
      block: { kind: 'prerequisite', message: 'Waiting.' },
      prerequisiteOrderIds: ['missing'],
    })
    const second = wallOrder('second', { x: 2, y: 1 }, {
      sequence: 2,
      status: 'blocked',
      block: { kind: 'prerequisite', message: 'Waiting.' },
      prerequisiteOrderIds: ['missing'],
    })
    const result = advanceConstructionWorkerRouting({
      layout: layoutWith([
        { x: 0, y: 1, kind: 'wall' },
        { x: 1, y: 0, kind: 'wall' },
        { x: 2, y: 0, kind: 'wall' },
        { x: 1, y: 2, kind: 'wall' },
        { x: 2, y: 2, kind: 'wall' },
      ]),
      orders: [first, second],
      crewPositions: [{ crewId: 'idle', cell: { x: 1, y: 1 }, moveCredit: 0 }],
      workers: [{ id: 'idle', movementRate: 2 }],
      stockpile: { x: 5, y: 5 },
      elapsed: 1,
    })

    expect(result.crewPositions[0].cell).toEqual({ x: 3, y: 1 })
    expect(result.orders.every((order) => order.assignedCrewId === null)).toBe(true)
  })

  it('evacuates a pawn before pending walls isolate its open tile', () => {
    const targets = [
      { x: 5, y: 4 },
      { x: 6, y: 5 },
      { x: 5, y: 6 },
      { x: 4, y: 5 },
    ]
    const orders = targets.map((target, index) => wallOrder(`ring-${index}`, target, {
      sequence: index + 1,
      status: 'blocked',
      block: { kind: 'prerequisite', message: 'Waiting.' },
      prerequisiteOrderIds: ['missing'],
    }))
    const result = advanceConstructionWorkerRouting({
      layout: createConstructionLayout(),
      orders,
      crewPositions: [{ crewId: 'idle', cell: { x: 5, y: 5 }, moveCredit: 0 }],
      workers: [{ id: 'idle', movementRate: 2 }],
      stockpile: { x: 5, y: 5 },
      elapsed: 1,
    })

    expect(result.crewPositions[0].cell).toEqual({ x: 5, y: 3 })
    expect(result.orders.every((order) => order.assignedCrewId === null)).toBe(true)
  })

  it('sends deconstruction directly to the site without a stockpile detour', () => {
    const target = { x: 5, y: 1 }
    const result = route(
      layoutWith([{ ...target, kind: 'wall' }]),
      [wallOrder('remove', target, {
        operation: 'deconstruct',
        status: 'building',
        target: {
          kind: 'boundary',
          cells: [target],
          construct: null,
          deconstruct: { ...target, kind: 'wall' },
        },
        materials: { required: 0, reserved: 0, delivered: 0, recoverable: 1 },
      })],
      [{ crewId: 'builder', cell: { x: 3, y: 1 }, moveCredit: 0 }],
      0.5,
    )

    expect(result.orders[0].travelPhase).toBe('at_site')
    expect(result.crewPositions[0].cell).toEqual({ x: 4, y: 1 })
  })

  it('keeps a valid sticky assignment even when a higher priority job appears', () => {
    const assigned = wallOrder('assigned', { x: 5, y: 1 }, {
      assignedCrewId: 'builder',
      travelPhase: 'to_site',
      priority: 1,
    })
    const urgent = wallOrder('urgent', { x: 7, y: 1 }, { priority: 5, sequence: 2 })
    const result = route(
      createConstructionLayout(),
      [assigned, urgent],
      [{ crewId: 'builder', cell: { x: 1, y: 1 }, moveCredit: 0 }],
      0,
    )

    expect(result.orders.find((order) => order.id === 'assigned')?.assignedCrewId).toBe('builder')
    expect(result.orders.find((order) => order.id === 'urgent')?.assignedCrewId).toBeNull()
  })

  it('dispatches the best construction worker before alphabetical crew order', () => {
    const result = advanceConstructionWorkerRouting({
      layout: createConstructionLayout(),
      orders: [wallOrder('wall', { x: 5, y: 1 })],
      crewPositions: [
        { crewId: 'alpha', cell: { x: 0, y: 0 }, moveCredit: 0 },
        { crewId: 'expert', cell: { x: 0, y: 1 }, moveCredit: 0 },
      ],
      workers: [
        { id: 'alpha', dispatchPriority: 1 },
        { id: 'expert', dispatchPriority: 5 },
      ],
      stockpile: { x: 1, y: 1 },
      elapsed: 0,
    })

    expect(result.orders[0].assignedCrewId).toBe('expert')
  })

  it('skips a higher-priority builder when another available builder can reach the site', () => {
    const barrier = Array.from({ length: 24 }, (_, x): BoundaryCell => ({
      x,
      y: 2,
      kind: 'wall',
    }))
    const result = advanceConstructionWorkerRouting({
      layout: layoutWith(barrier),
      orders: [wallOrder('wall', { x: 5, y: 4 }, {
        status: 'building',
        materials: { required: 1, reserved: 0, delivered: 1, recoverable: 0 },
      })],
      crewPositions: [
        { crewId: 'expert', cell: { x: 1, y: 1 }, moveCredit: 0 },
        { crewId: 'alpha', cell: { x: 3, y: 4 }, moveCredit: 0 },
      ],
      workers: [
        { id: 'expert', dispatchPriority: 5 },
        { id: 'alpha', dispatchPriority: 1 },
      ],
      stockpile: { x: 1, y: 1 },
      elapsed: 0,
    })

    expect(result.noPathOrderIds).toEqual([])
    expect(result.orders[0].assignedCrewId).toBe('alpha')
  })

  it('does not dispatch an order until every explicit prerequisite completes', () => {
    const prerequisite = wallOrder('shell', { x: 2, y: 2 }, {
      status: 'building',
      materials: { required: 1, reserved: 0, delivered: 1, recoverable: 0 },
    })
    const dependent = wallOrder('inside', { x: 5, y: 2 }, {
      priority: 5,
      sequence: 2,
      prerequisiteOrderIds: ['shell'],
    })
    const waiting = route(
      createConstructionLayout(),
      [prerequisite, dependent],
      [{ crewId: 'builder', cell: { x: 1, y: 1 }, moveCredit: 0 }],
      0,
    )

    expect(waiting.orders.find((order) => order.id === 'shell')?.assignedCrewId).toBe('builder')
    expect(waiting.orders.find((order) => order.id === 'inside')?.assignedCrewId).toBeNull()
  })

  it('reports an unreachable site and retries the same sticky assignment later', () => {
    const barrier = Array.from({ length: 24 }, (_, x): BoundaryCell => ({
      x,
      y: 2,
      kind: 'wall',
    }))
    const order = wallOrder('blocked', { x: 5, y: 4 }, {
      status: 'building',
      assignedCrewId: 'builder',
      travelPhase: 'to_site',
      materials: { required: 1, reserved: 0, delivered: 1, recoverable: 0 },
    })
    const result = route(
      layoutWith(barrier),
      [order],
      [{ crewId: 'builder', cell: { x: 1, y: 1 }, moveCredit: 0 }],
      1,
    )

    expect(result.noPathOrderIds).toEqual(['blocked'])
    expect(result.orders[0]).toMatchObject({
      assignedCrewId: null,
      travelPhase: 'idle',
    })
    expect(result.atSiteWorkers).toEqual([])

    const opened = layoutWith(barrier.map((cell) =>
      cell.x === 1 ? { ...cell, kind: 'door' as const } : cell,
    ))
    const retried = route(opened, result.orders, result.crewPositions, 3)
    expect(retried.noPathOrderIds).toEqual([])
    expect(retried.orders[0].travelPhase).toBe('at_site')
  })

  it('produces the same movement state when elapsed time is partitioned', () => {
    const layout = createConstructionLayout()
    const order = wallOrder('wall', { x: 10, y: 1 })
    const start = [{ crewId: 'builder', cell: { x: 0, y: 1 }, moveCredit: 0 }]
    const whole = route(layout, [order], start, 0.75)
    const half = route(layout, [order], start, 0.25)
    const partitioned = route(layout, half.orders, half.crewPositions, 0.5)

    expect(partitioned.crewPositions).toEqual(whole.crewPositions)
    expect(partitioned.orders).toEqual(whole.orders)
    expect(partitioned.atSiteWorkers).toEqual(whole.atSiteWorkers)
  })

  it('stops beside every cell of a multi-tile workstation and preserves inputs', () => {
    const workstation: WorkstationPlacement = {
      id: 'bench',
      type: 'research-bench',
      label: 'Research bench',
      origin: { x: 6, y: 5 },
      size: { width: 3, height: 2 },
      rotation: 0,
    }
    const order: RoutableConstructionOrder = {
      ...(wallOrder('bench', workstation.origin) as ConstructionOrder),
      target: {
        kind: 'workstation',
        cells: [
          { x: 6, y: 5 }, { x: 7, y: 5 }, { x: 8, y: 5 },
          { x: 6, y: 6 }, { x: 7, y: 6 }, { x: 8, y: 6 },
        ],
        construct: workstation,
        deconstruct: null,
      },
      status: 'building',
      materials: { required: 4, reserved: 0, delivered: 4, recoverable: 0 },
      travelPhase: 'idle',
      prerequisiteOrderIds: [],
    }
    const layout = createConstructionLayout()
    const positions = [{ crewId: 'builder', cell: { x: 2, y: 5 }, moveCredit: 0 }]
    const before = JSON.stringify({ layout, order, positions })
    const result = route(layout, [order], positions, 4)

    expect(result.crewPositions[0].cell).toEqual({ x: 5, y: 5 })
    expect(result.orders[0].travelPhase).toBe('at_site')
    expect(JSON.stringify({ layout, order, positions })).toBe(before)
  })
})
