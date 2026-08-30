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
  availableConstructionStock,
  cancelConstructionCommand,
  cancelConstructionOrder,
  deriveConstructionOrders,
  migrateV5ConstructionOrders,
  normalizePersistedConstructionOrders,
  projectConstructionOrders,
  rebuildConstructionOrderPrerequisites,
  reserveConstructionMaterials,
  returnedConstructionMaterials,
  type ConstructionOrder,
  type LegacyConstructionOrderV5,
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
) => {
  const derived = deriveConstructionOrders(source, result, {
    commandId,
    priority: 2,
    sequenceStart,
  })
  return reserveConstructionMaterials(derived, 100).orders
}

const advance = (
  layout: ConstructionLayout,
  orders: ConstructionOrder[],
  ticks: number,
) => {
  let state = { layout, orders, constructionStock: 100 }
  for (let tick = 0; tick < ticks; tick += 1) {
    state = advanceConstructionOrders(
      state.layout,
      state.orders,
      [{ id: 'amina', engineeringRate: 1 }],
      { constructionStock: state.constructionStock },
    )
  }
  return state
}

const projectRoomShell = (source: ConstructionLayout) => {
  let layout = layoutFrom(
    paintBoundaryLine(source, { x: 4, y: 4 }, { x: 9, y: 4 }, 'wall'),
  )
  layout = layoutFrom(
    paintBoundaryLine(layout, { x: 4, y: 9 }, { x: 9, y: 9 }, 'wall'),
  )
  layout = layoutFrom(
    paintBoundaryLine(layout, { x: 4, y: 5 }, { x: 4, y: 8 }, 'wall'),
  )
  return paintBoundaryLine(layout, { x: 9, y: 5 }, { x: 9, y: 8 }, 'wall')
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
      { constructionStock: 100 },
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
      { constructionStock: partial.constructionStock },
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

describe('construction order prerequisites', () => {
  it('keeps a P5 indoor life-support job inert until every P3 shell and door prerequisite completes', () => {
    const completed = createConstructionLayout()
    const wallOrders = deriveConstructionOrders(
      completed,
      projectRoomShell(completed),
      {
        commandId: 'p3-shell',
        priority: 3,
        sequenceStart: 0,
        completedLayout: completed,
        prerequisiteOrders: [],
      },
    )
    const wallProjection = projectConstructionOrders(completed, wallOrders).layout
    const doorOrders = deriveConstructionOrders(
      wallProjection,
      paintBoundaryCell(wallProjection, { x: 6, y: 4 }, 'door'),
      {
        commandId: 'p3-door',
        priority: 3,
        sequenceStart: wallOrders.length,
        completedLayout: completed,
        prerequisiteOrders: wallOrders,
      },
    )
    const shellOrders = [...wallOrders, ...doorOrders]
    const enclosedProjection = projectConstructionOrders(completed, shellOrders).layout
    const [lifeSupportOrder] = deriveConstructionOrders(
      enclosedProjection,
      placeWorkstation(enclosedProjection, {
        id: 'p5-life-support',
        type: 'life-support',
        label: 'P5 life support',
        origin: { x: 5, y: 5 },
        size: { width: 2, height: 2 },
      }),
      {
        commandId: 'p5-life-support',
        priority: 5,
        sequenceStart: shellOrders.length,
        completedLayout: completed,
        prerequisiteOrders: shellOrders,
      },
    )

    expect(doorOrders[0].prerequisiteOrderIds).toEqual(['p3-shell:2'])
    const cornerKeys = new Set(['4:4', '9:4', '4:9', '9:9'])
    const executableShellOrders = shellOrders.filter((order) =>
      order.target.kind !== 'boundary' ||
      !cornerKeys.has(`${order.target.cells[0].x}:${order.target.cells[0].y}`),
    )
    expect(lifeSupportOrder.prerequisiteOrderIds).toEqual(
      executableShellOrders.map((order) => order.id),
    )

    const constrained = reserveConstructionMaterials(
      [...shellOrders, lifeSupportOrder],
      4,
    )
    expect(constrained.orders.at(-1)).toMatchObject({
      status: 'blocked',
      block: { kind: 'prerequisite' },
      materials: { reserved: 0 },
    })
    expect(constrained.orders.filter(
      (order) => order.commandId === 'p3-shell' && order.materials.reserved === 1,
    )).toHaveLength(4)

    const cascade = cancelConstructionOrder(
      completed,
      [...shellOrders, lifeSupportOrder],
      'p3-shell:1',
    )
    expect(cascade.cancelledOrderIds).toEqual([
      'p3-shell:1',
      'p5-life-support:21',
    ])
    expect(cascade.projection.valid).toBe(true)

    let state = {
      layout: completed,
      orders: reserveConstructionMaterials(
        [...shellOrders, lifeSupportOrder],
        100,
      ).orders,
      constructionStock: 100,
    }
    expect(state.orders.at(-1)).toMatchObject({
      status: 'blocked',
      block: { kind: 'prerequisite' },
      assignedCrewId: null,
      materials: { reserved: 0, delivered: 0 },
      work: { completed: 0 },
    })

    for (let tick = 0; tick < 100; tick += 1) {
      const lifeSupport = state.orders.find((order) => order.id === lifeSupportOrder.id)!
      const ordersById = new Map(state.orders.map((order) => [order.id, order]))
      const prerequisitesComplete = lifeSupport.prerequisiteOrderIds!.every(
        (id) => ordersById.get(id)?.status === 'complete',
      )
      if (!prerequisitesComplete) {
        expect(lifeSupport).toMatchObject({
          status: 'blocked',
          block: { kind: 'prerequisite' },
          assignedCrewId: null,
          materials: { reserved: 0, delivered: 0 },
          work: { completed: 0 },
        })
      }
      if (lifeSupport.status === 'complete') break

      state = advanceConstructionOrders(
        state.layout,
        state.orders,
        [{ id: 'priority-builder', engineeringRate: 10, haulingRate: 10 }],
        { constructionStock: state.constructionStock },
      )
    }

    const finishedLifeSupport = state.orders.find(
      (order) => order.id === lifeSupportOrder.id,
    )!
    const finalOrdersById = new Map(state.orders.map((order) => [order.id, order]))
    expect(finishedLifeSupport.status).toBe('complete')
    expect(finishedLifeSupport.prerequisiteOrderIds!.every(
      (id) => finalOrdersById.get(id)?.status === 'complete',
    )).toBe(true)
    expect(state.layout.workstations.map((workstation) => workstation.id)).toContain(
      'p5-life-support',
    )
  })

  it('rebuilds missing dependency edges when upgrading a projected legacy queue', () => {
    const completed = createConstructionLayout()
    const wallOrders = deriveConstructionOrders(
      completed,
      projectRoomShell(completed),
      { commandId: 'legacy-shell', sequenceStart: 0 },
    )
    const wallProjection = projectConstructionOrders(completed, wallOrders).layout
    const doorOrders = deriveConstructionOrders(
      wallProjection,
      paintBoundaryCell(wallProjection, { x: 6, y: 4 }, 'door'),
      {
        commandId: 'legacy-door',
        sequenceStart: wallOrders.length,
      },
    )
    const legacyShell = [...wallOrders, ...doorOrders]
    const enclosedProjection = projectConstructionOrders(completed, legacyShell).layout
    const [legacyLifeSupport] = deriveConstructionOrders(
      enclosedProjection,
      placeWorkstation(enclosedProjection, {
        id: 'legacy-life-support',
        type: 'life-support',
        label: 'Legacy life support',
        origin: { x: 5, y: 5 },
        size: { width: 2, height: 2 },
      }),
      {
        commandId: 'legacy-life-support',
        priority: 5,
        sequenceStart: legacyShell.length,
      },
    )

    expect(legacyLifeSupport.prerequisiteOrderIds).toEqual([])
    const rebuilt = rebuildConstructionOrderPrerequisites(
      completed,
      [...legacyShell, legacyLifeSupport],
      100,
    )
    const lifeSupport = rebuilt.orders.find(
      (order) => order.id === legacyLifeSupport.id,
    )!

    expect(lifeSupport.prerequisiteOrderIds?.length).toBeGreaterThan(0)
    expect(lifeSupport).toMatchObject({
      status: 'blocked',
      block: { kind: 'prerequisite' },
      assignedCrewId: null,
      materials: { reserved: 0 },
    })
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

    const hauled = advanceConstructionOrders(
      completed,
      orders,
      [
        { id: 'zoe', engineeringRate: 3 },
        { id: 'amina', engineeringRate: 1 },
      ],
      { constructionStock: 100 },
    )
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

    const built = advanceConstructionOrders(
      hauled.layout,
      hauled.orders,
      [
        { id: 'zoe', engineeringRate: 3 },
        { id: 'amina', engineeringRate: 1 },
      ],
      { constructionStock: hauled.constructionStock },
    )
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
      { constructionStock: partial.constructionStock },
    )
    expect(finished.orders[0].status).toBe('complete')
    expect(finished.layout.workstations.map((item) => item.id)).toEqual(['rack'])
  })
})

describe('construction material ledger', () => {
  it('queues unfunded ghosts, reserves whole jobs deterministically, and never assigns blocked work', () => {
    const completed = createConstructionLayout()
    const result = paintBoundaryLine(
      completed,
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      'wall',
    )
    const derived = deriveConstructionOrders(completed, result, {
      commandId: 'limited-walls',
      priority: 2,
      sequenceStart: 0,
    })

    expect(derived).toMatchObject([
      {
        status: 'blocked',
        block: { kind: 'insufficient_materials' },
        materials: { required: 1, reserved: 0, delivered: 0, recoverable: 0 },
      },
      {
        status: 'blocked',
        block: { kind: 'insufficient_materials' },
        materials: { required: 1, reserved: 0, delivered: 0, recoverable: 0 },
      },
    ])
    expect(projectConstructionOrders(completed, derived).layout.boundaries).toHaveLength(2)

    const reservation = reserveConstructionMaterials(derived, 1)
    expect(reservation.availableStock).toBe(0)
    expect(reservation.reservedOrderIds).toEqual(['limited-walls:0'])
    expect(reservation.blockedOrderIds).toEqual(['limited-walls:1'])
    expect(reservation.orders).toMatchObject([
      {
        status: 'hauling',
        block: null,
        materials: { reserved: 1, delivered: 0 },
      },
      {
        status: 'blocked',
        block: { kind: 'insufficient_materials' },
        assignedCrewId: null,
        materials: { reserved: 0, delivered: 0 },
      },
    ])
    expect(availableConstructionStock(1, reservation.orders)).toBe(0)

    const advanced = advanceConstructionOrders(
      completed,
      reservation.orders,
      [
        { id: 'builder-a', engineeringRate: 1 },
        { id: 'builder-b', engineeringRate: 1 },
      ],
      { constructionStock: 1 },
    )
    expect(advanced.constructionStock).toBe(0)
    expect(advanced.orders[0]).toMatchObject({
      status: 'building',
      assignedCrewId: 'builder-a',
      materials: { reserved: 0, delivered: 1 },
    })
    expect(advanced.orders[1]).toMatchObject({
      status: 'blocked',
      assignedCrewId: null,
      materials: { reserved: 0, delivered: 0 },
    })
  })

  it('moves reserved material out of stock without overspending across workers', () => {
    const completed = createConstructionLayout()
    const result = paintBoundaryLine(
      completed,
      { x: 3, y: 3 },
      { x: 4, y: 3 },
      'wall',
    )
    const orders = reserveConstructionMaterials(
      deriveConstructionOrders(completed, result, {
        commandId: 'fractional-haul',
        sequenceStart: 0,
      }),
      2,
    ).orders

    const partial = advanceConstructionOrders(
      completed,
      orders,
      [
        { id: 'a', engineeringRate: 1, haulingRate: 0.5 },
        { id: 'b', engineeringRate: 1, haulingRate: 0.5 },
      ],
      { constructionStock: 2 },
    )
    expect(partial.constructionStock).toBe(1)
    expect(partial.orders.map((order) => order.materials)).toEqual([
      { required: 1, reserved: 0.5, delivered: 0.5, recoverable: 0 },
      { required: 1, reserved: 0.5, delivered: 0.5, recoverable: 0 },
    ])
    expect(availableConstructionStock(partial.constructionStock, partial.orders)).toBe(0)

    const delivered = advanceConstructionOrders(
      partial.layout,
      partial.orders,
      [
        { id: 'a', engineeringRate: 1, haulingRate: 2 },
        { id: 'b', engineeringRate: 1, haulingRate: 2 },
      ],
      { constructionStock: partial.constructionStock },
    )
    expect(delivered.constructionStock).toBe(0)
    expect(delivered.orders.every((order) => order.status === 'building')).toBe(true)
    expect(delivered.orders.every((order) => order.materials.delivered === 1)).toBe(true)
  })

  it('keeps insufficient jobs inert and automatically funds them when stock arrives', () => {
    const completed = createConstructionLayout()
    const result = paintBoundaryCell(completed, { x: 6, y: 6 }, 'wall')
    const orders = deriveConstructionOrders(completed, result, {
      commandId: 'waiting-wall',
    })

    const waiting = advanceConstructionOrders(
      completed,
      orders,
      [{ id: 'builder', engineeringRate: 10, haulingRate: 10 }],
      { constructionStock: 0 },
    )
    expect(waiting.orders[0]).toMatchObject({
      status: 'blocked',
      assignedCrewId: null,
      block: { kind: 'insufficient_materials' },
      materials: { delivered: 0, reserved: 0 },
      work: { completed: 0 },
    })

    const supplied = advanceConstructionOrders(
      waiting.layout,
      waiting.orders,
      [{ id: 'builder', engineeringRate: 10, haulingRate: 10 }],
      { constructionStock: 1 },
    )
    expect(supplied.orders[0]).toMatchObject({
      status: 'building',
      block: null,
      assignedCrewId: 'builder',
      materials: { delivered: 1, reserved: 0 },
    })
    expect(supplied.constructionStock).toBe(0)
  })

  it('returns only staged material when unfinished work is cancelled', () => {
    const completed = createConstructionLayout()
    const result = paintBoundaryCell(completed, { x: 7, y: 7 }, 'wall')
    const orders = reserveConstructionMaterials(
      deriveConstructionOrders(completed, result, { commandId: 'cancel-wall' }),
      1,
    ).orders

    expect(returnedConstructionMaterials(orders)).toBe(0)
    const partial = advanceConstructionOrders(
      completed,
      orders,
      [{ id: 'builder', engineeringRate: 1, haulingRate: 0.4 }],
      { constructionStock: 1 },
    )
    expect(partial.constructionStock).toBeCloseTo(0.6)
    expect(returnedConstructionMaterials(partial.orders)).toBeCloseTo(0.4)

    const cancelled = cancelConstructionCommand(
      partial.layout,
      partial.orders,
      'cancel-wall',
    )
    expect(cancelled.cancelledOrderIds).toEqual(['cancel-wall:0'])
    expect(cancelled.returnedMaterials).toBeCloseTo(0.4)
    expect(partial.constructionStock + cancelled.returnedMaterials).toBeCloseTo(1)
    expect(cancelled.projection.layout.boundaries).toEqual([])
  })

  it('cascade-cancels projected dependants when a prerequisite command or order is removed', () => {
    const completed = createConstructionLayout()
    const wallOrders = deriveConstructionOrders(
      completed,
      paintBoundaryCell(completed, { x: 8, y: 8 }, 'wall'),
      { commandId: 'prerequisite-wall', sequenceStart: 0 },
    )
    const withWall = projectConstructionOrders(completed, wallOrders).layout
    const doorOrders = deriveConstructionOrders(
      withWall,
      paintBoundaryCell(withWall, { x: 8, y: 8 }, 'door'),
      {
        commandId: 'dependent-door',
        sequenceStart: 1,
        completedLayout: completed,
        prerequisiteOrders: wallOrders,
      },
    )
    expect(doorOrders[0].prerequisiteOrderIds).toEqual(['prerequisite-wall:0'])
    const staged = [...wallOrders, ...doorOrders].map((order) => ({
      ...order,
      status: 'building' as const,
      block: null,
      materials: {
        ...order.materials,
        reserved: 0,
        delivered: order.materials.required,
      },
    }))
    expect(staged.every((order) => order.materials.delivered === 1)).toBe(true)

    const commandCancellation = cancelConstructionCommand(
      completed,
      staged,
      'prerequisite-wall',
    )
    expect(commandCancellation.cancelledOrderIds).toEqual([
      'prerequisite-wall:0',
      'dependent-door:1',
    ])
    expect(commandCancellation.orders).toEqual([])
    expect(commandCancellation.returnedMaterials).toBe(2)
    expect(commandCancellation.projection.valid).toBe(true)

    const orderCancellation = cancelConstructionOrder(
      completed,
      staged,
      'prerequisite-wall:0',
    )
    expect(orderCancellation.cancelledOrderIds).toEqual([
      'prerequisite-wall:0',
      'dependent-door:1',
    ])
    expect(orderCancellation.returnedMaterials).toBe(2)
  })

  it('recovers material only after successful deconstruction and funds waiting work', () => {
    const initial = layoutFrom(
      paintBoundaryCell(createConstructionLayout(), { x: 2, y: 2 }, 'wall'),
    )
    const removeResult = eraseAt(initial, { x: 2, y: 2 })
    const removeOrders = deriveConstructionOrders(initial, removeResult, {
      commandId: 'salvage-wall',
      sequenceStart: 0,
    })
    const removalProjection = projectConstructionOrders(initial, removeOrders)
    const buildResult = paintBoundaryCell(
      removalProjection.layout,
      { x: 3, y: 2 },
      'wall',
    )
    const buildOrders = deriveConstructionOrders(
      removalProjection.layout,
      buildResult,
      { commandId: 'reuse-wall', sequenceStart: 1 },
    )

    const advanced = advanceConstructionOrders(
      initial,
      [...removeOrders, ...buildOrders],
      [{ id: 'builder', engineeringRate: 1 }],
      { constructionStock: 0 },
    )
    expect(advanced.completedOrderIds).toEqual(['salvage-wall:0'])
    expect(advanced.recoveredMaterials).toBe(1)
    expect(advanced.constructionStock).toBe(1)
    expect(boundaryAt(advanced.layout, { x: 2, y: 2 })).toBeUndefined()
    expect(advanced.orders[1]).toMatchObject({
      status: 'hauling',
      block: null,
      materials: { required: 1, reserved: 1, delivered: 0 },
    })
    expect(advanced.blockedOrderIds).toEqual([])
  })

  it('charges the replacement target and salvages the old target atomically', () => {
    const initial = layoutFrom(
      paintBoundaryCell(createConstructionLayout(), { x: 4, y: 4 }, 'wall'),
    )
    const result = paintBoundaryCell(initial, { x: 4, y: 4 }, 'door')
    const orders = reserveConstructionMaterials(
      deriveConstructionOrders(initial, result, { commandId: 'replace-door' }),
      1,
    ).orders

    expect(orders[0]).toMatchObject({
      operation: 'replace',
      materials: { required: 1, reserved: 1, delivered: 0, recoverable: 1 },
    })
    const hauled = advanceConstructionOrders(
      initial,
      orders,
      [{ id: 'builder', engineeringRate: 1 }],
      { constructionStock: 1 },
    )
    expect(hauled.constructionStock).toBe(0)
    const built = advanceConstructionOrders(
      hauled.layout,
      hauled.orders,
      [{ id: 'builder', engineeringRate: 1 }],
      { constructionStock: hauled.constructionStock },
    )
    expect(built.orders[0].status).toBe('complete')
    expect(built.recoveredMaterials).toBe(1)
    expect(built.constructionStock).toBe(1)
    expect(boundaryAt(built.layout, { x: 4, y: 4 })?.kind).toBe('door')
  })

  it('holds staged material on a changed target until the player cancels', () => {
    const completed = createConstructionLayout()
    const result = paintBoundaryCell(completed, { x: 9, y: 9 }, 'wall')
    const orders = reserveConstructionMaterials(
      deriveConstructionOrders(completed, result, { commandId: 'blocked-wall' }),
      1,
    ).orders
    const hauled = advanceConstructionOrders(
      completed,
      orders,
      [{ id: 'builder', engineeringRate: 1 }],
      { constructionStock: 1 },
    )
    const changed = layoutFrom(placeWorkstation(completed, {
      id: 'conflict',
      type: 'bed',
      origin: { x: 9, y: 9 },
      size: { width: 1, height: 1 },
    }))
    const blocked = advanceConstructionOrders(
      changed,
      hauled.orders,
      [{ id: 'builder', engineeringRate: 10 }],
      { constructionStock: hauled.constructionStock },
    )

    expect(blocked.orders[0]).toMatchObject({
      status: 'blocked',
      assignedCrewId: null,
      block: { kind: 'target_changed' },
      materials: { delivered: 1, reserved: 0 },
    })
    const stillBlocked = advanceConstructionOrders(
      blocked.layout,
      blocked.orders,
      [{ id: 'builder', engineeringRate: 10 }],
      { constructionStock: 10 },
    )
    expect(stillBlocked.orders[0]).toMatchObject({
      status: 'blocked',
      assignedCrewId: null,
      block: { kind: 'target_changed' },
    })
    expect(cancelConstructionCommand(
      stillBlocked.layout,
      stillBlocked.orders,
      'blocked-wall',
    ).returnedMaterials).toBe(1)
  })

  it('uses explicit catalog cost instead of an arbitrary placement footprint', () => {
    const completed = createConstructionLayout()
    const result = placeWorkstation(completed, {
      id: 'compact-research',
      type: 'research-bench',
      origin: { x: 10, y: 4 },
      size: { width: 2, height: 2 },
    })
    const orders = deriveConstructionOrders(completed, result, {
      commandId: 'catalog-cost',
    })

    expect(orders[0]).toMatchObject({
      materials: { required: 6 },
      work: { required: 4 },
    })
  })

  it('migrates v5 cosmetic delivery without duplicating stock', () => {
    const completed = createConstructionLayout()
    const result = paintBoundaryCell(completed, { x: 11, y: 5 }, 'wall')
    const current = queue(completed, result, 'legacy-wall')
    const legacy = current.map(({ block, materials, ...order }) => {
      expect(block).toBeNull()
      return {
        ...order,
        status: 'building' as const,
        assignedCrewId: 'legacy-builder',
        materials: { required: materials.required, delivered: materials.required },
        work: { ...order.work, completed: 0.5 },
      }
    }) satisfies LegacyConstructionOrderV5[]

    const migrated = migrateV5ConstructionOrders(legacy, 1)
    expect(migrated.availableStock).toBe(0)
    expect(migrated.orders[0]).toMatchObject({
      status: 'hauling',
      assignedCrewId: null,
      block: null,
      materials: { required: 1, reserved: 1, delivered: 0, recoverable: 0 },
      work: { required: 1, completed: 0 },
    })

    const completedLegacy = [{
      ...legacy[0],
      status: 'complete' as const,
    }]
    const grandfathered = migrateV5ConstructionOrders(completedLegacy, 1)
    expect(grandfathered.availableStock).toBe(1)
    expect(grandfathered.orders[0]).toMatchObject({
      status: 'complete',
      materials: { reserved: 0, delivered: 1 },
    })
  })

  it('rebuilds persisted ledgers from valid targets and drops malformed records', () => {
    const completed = createConstructionLayout()
    const [source] = deriveConstructionOrders(
      completed,
      paintBoundaryCell(completed, { x: 12, y: 5 }, 'wall'),
      { commandId: 'persisted-wall', sequenceStart: 17 },
    )
    const corrupted = {
      ...source,
      priority: 99,
      operation: 'deconstruct',
      target: { ...source.target, cells: [{ x: 999, y: 999 }] },
      materials: {
        required: 999,
        reserved: 999,
        delivered: 999,
        recoverable: 999,
      },
      work: { required: 999, completed: 999 },
    }
    const missingLedger = {
      ...source,
      id: 'persisted-wall-without-ledger',
      sequence: 18,
      prerequisiteOrderIds: [
        source.id,
        source.id,
        'persisted-wall-without-ledger',
        'missing-order',
        42,
      ],
      materials: undefined,
      work: undefined,
    }
    const normalized = normalizePersistedConstructionOrders(
      [
        null,
        { id: 'bad-target', target: null },
        corrupted,
        corrupted,
        missingLedger,
      ],
      0,
    )

    expect(normalized.orders).toHaveLength(2)
    expect(normalized.orders[0]).toMatchObject({
      id: 'persisted-wall:17',
      prerequisiteOrderIds: [],
      priority: 5,
      operation: 'construct',
      status: 'blocked',
      materials: { required: 1, reserved: 0, delivered: 0, recoverable: 0 },
      work: { required: 1, completed: 0 },
      target: { cells: [{ x: 12, y: 5 }] },
    })
    expect(normalized.orders[1]).toMatchObject({
      id: 'persisted-wall-without-ledger',
      prerequisiteOrderIds: ['persisted-wall:17'],
      materials: { required: 1, reserved: 0, delivered: 0, recoverable: 0 },
      work: { required: 1, completed: 0 },
    })
    expect(returnedConstructionMaterials(normalized.orders)).toBe(0)

    const honest = normalizePersistedConstructionOrders([{
      ...source,
      status: 'building',
      materials: { ...source.materials, delivered: 1, reserved: 0 },
      work: { ...source.work, completed: 0.5 },
    }], 0)
    expect(honest.orders[0]).toMatchObject({
      status: 'building',
      materials: { required: 1, reserved: 0, delivered: 1, recoverable: 0 },
      work: { required: 1, completed: 0.5 },
    })
    expect(returnedConstructionMaterials(honest.orders)).toBe(1)
    expect(migrateV5ConstructionOrders([null], 1).orders).toEqual([])
  })
})
