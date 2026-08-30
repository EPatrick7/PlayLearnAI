import { describe, expect, it } from 'vitest'
import {
  createConstructionLayout,
  paintBoundaryCell,
  type BoundaryCell,
} from './construction'
import {
  deriveConstructionOrders,
  type ConstructionOrder,
} from './constructionJobs'
import {
  advanceConstructionWorkerSimulation,
  advanceConstructionWorkerSimulationFixedStep,
  type ConstructionWorkerSimulationInput,
} from './constructionWorkerSimulation'

const wallOrder = () => {
  const layout = createConstructionLayout()
  return deriveConstructionOrders(
    layout,
    paintBoundaryCell(layout, { x: 5, y: 1 }, 'wall'),
    { commandId: 'wall', sequenceStart: 1 },
  )[0]
}

const inputFor = (
  order: ConstructionOrder,
  elapsed: number,
  overrides: Partial<ConstructionWorkerSimulationInput> = {},
): ConstructionWorkerSimulationInput => ({
  layout: createConstructionLayout(),
  orders: [order],
  constructionStock: 4,
  stockpile: { x: 1, y: 1 },
  crewPositions: [{ crewId: 'builder', cell: { x: 0, y: 1 }, moveCredit: 0 }],
  workers: [{
    id: 'builder',
    canConstruct: true,
    movementRate: 2,
    engineeringRate: 1,
    haulingRate: 1,
  }],
  elapsed,
  ...overrides,
})

describe('spatial construction worker simulation', () => {
  it('produces the same multi-job result for one large fixed-step advance or equivalent partitions', () => {
    const orders = [3, 5, 7, 9].map((x, index): ConstructionOrder => ({
      ...wallOrder(),
      id: `wall-${index + 1}`,
      commandId: `wall-${index + 1}`,
      sequence: index + 1,
      target: {
        kind: 'boundary',
        cells: [{ x, y: 1 }],
        construct: { x, y: 1, kind: 'wall' },
        deconstruct: null,
      },
    }))
    const input: ConstructionWorkerSimulationInput = {
      layout: createConstructionLayout(),
      orders,
      constructionStock: 4,
      stockpile: { x: 1, y: 1 },
      crewPositions: [{ crewId: 'builder', cell: { x: 1, y: 1 }, moveCredit: 0 }],
      workers: [{
        id: 'builder',
        canConstruct: true,
        movementRate: 20,
        engineeringRate: 10,
        haulingRate: 1,
      }],
      elapsed: 4,
    }

    const whole = advanceConstructionWorkerSimulationFixedStep(input)
    let partitioned = advanceConstructionWorkerSimulationFixedStep({ ...input, elapsed: 1 })
    for (let step = 1; step < 4; step += 1) {
      partitioned = advanceConstructionWorkerSimulationFixedStep({
        ...input,
        layout: partitioned.layout,
        orders: partitioned.orders,
        constructionStock: partitioned.constructionStock,
        stockpile: partitioned.stockpile,
        crewPositions: partitioned.crewPositions,
        elapsed: 1,
      })
    }

    expect(whole.orders.every((order) => order.status === 'complete')).toBe(true)
    expect(partitioned.layout).toEqual(whole.layout)
    expect(partitioned.orders).toEqual(whole.orders)
    expect(partitioned.constructionStock).toBe(whole.constructionStock)
    expect(partitioned.crewPositions).toEqual(whole.crewPositions)
  })

  it('produces the same completion for decimal time partitions', () => {
    const input = inputFor(wallOrder(), 3)
    const whole = advanceConstructionWorkerSimulationFixedStep(input)
    let partitioned = advanceConstructionWorkerSimulationFixedStep({ ...input, elapsed: 0.1 })
    for (let step = 1; step < 30; step += 1) {
      partitioned = advanceConstructionWorkerSimulationFixedStep({
        ...input,
        layout: partitioned.layout,
        orders: partitioned.orders,
        constructionStock: partitioned.constructionStock,
        stockpile: partitioned.stockpile,
        crewPositions: partitioned.crewPositions,
        elapsed: 0.1,
      })
    }

    expect(whole.orders[0].status).toBe('complete')
    expect(partitioned.layout).toEqual(whole.layout)
    expect(partitioned.orders).toEqual(whole.orders)
    expect(partitioned.constructionStock).toBe(whole.constructionStock)
    expect(partitioned.crewPositions).toEqual(whole.crewPositions)
  })

  it('does not consume stock or progress work before the builder reaches the site', () => {
    const order = wallOrder()
    const approachingPallet = advanceConstructionWorkerSimulation(inputFor(order, 0.25))

    expect(approachingPallet.crewPositions[0]).toMatchObject({
      cell: { x: 0, y: 1 },
      moveCredit: 0.5,
    })
    expect(approachingPallet.orders[0]).toMatchObject({
      travelPhase: 'to_stockpile' as const,
      materials: { delivered: 0, reserved: 1 },
      work: { completed: 0 },
    })
    expect(approachingPallet.constructionStock).toBe(4)

    const first = advanceConstructionWorkerSimulation(inputFor(
      approachingPallet.orders[0],
      0.25,
      {
        crewPositions: approachingPallet.crewPositions,
        constructionStock: approachingPallet.constructionStock,
      },
    ))

    expect(first.crewPositions[0].cell).toEqual({ x: 1, y: 1 })
    expect(first.orders[0]).toMatchObject({
      assignedCrewId: 'builder',
      travelPhase: 'to_site' as const,
      status: 'building',
      materials: {
        delivered: 0,
        reserved: 0,
        carried: 1,
        carriedByCrewId: 'builder',
      },
      work: { completed: 0 },
    })
    expect(first.constructionStock).toBe(3)
    expect(first.layout.boundaries).toEqual([])

    const second = advanceConstructionWorkerSimulation(inputFor(
      first.orders[0],
      1,
      { crewPositions: first.crewPositions, constructionStock: first.constructionStock },
    ))
    expect(second.crewPositions[0].cell).toEqual({ x: 3, y: 1 })
    expect(second.orders[0].work.completed).toBe(0)
    expect(second.constructionStock).toBe(3)
  })

  it('keeps picked-up cargo bound to its carrier when another builder becomes eligible', () => {
    const workers = [
      {
        id: 'alpha',
        canConstruct: true,
        movementRate: 2,
        engineeringRate: 1,
        haulingRate: 1,
      },
      {
        id: 'beta',
        canConstruct: true,
        movementRate: 2,
        engineeringRate: 1,
        haulingRate: 1,
      },
    ]
    const pickedUp = advanceConstructionWorkerSimulation({
      ...inputFor(wallOrder(), 0.5),
      crewPositions: [
        { crewId: 'alpha', cell: { x: 0, y: 1 }, moveCredit: 0 },
        { crewId: 'beta', cell: { x: 0, y: 2 }, moveCredit: 0 },
      ],
      workers,
    })

    expect(pickedUp.orders[0]).toMatchObject({
      assignedCrewId: 'alpha',
      travelPhase: 'to_site',
      materials: {
        delivered: 0,
        carried: 1,
        carriedByCrewId: 'alpha',
      },
    })
    expect(pickedUp.constructionStock).toBe(3)

    const carrierUnavailable = advanceConstructionWorkerSimulation({
      ...inputFor(pickedUp.orders[0], 0.25),
      crewPositions: pickedUp.crewPositions,
      constructionStock: pickedUp.constructionStock,
      workers: workers.map((worker) => (
        worker.id === 'alpha' ? { ...worker, canConstruct: false } : worker
      )),
    })

    expect(carrierUnavailable.orders[0]).toMatchObject({
      status: 'blocked',
      block: { kind: 'carrier_unavailable' },
      assignedCrewId: 'alpha',
      travelPhase: 'to_site',
      materials: {
        delivered: 0,
        carried: 1,
        carriedByCrewId: 'alpha',
      },
    })
    expect(carrierUnavailable.orders[0].assignedCrewId).not.toBe('beta')
    expect(carrierUnavailable.constructionStock).toBe(3)
    expect(carrierUnavailable.crewPositions).toEqual(pickedUp.crewPositions)

    const resumed = advanceConstructionWorkerSimulation({
      ...inputFor(carrierUnavailable.orders[0], 2.5),
      crewPositions: carrierUnavailable.crewPositions,
      constructionStock: carrierUnavailable.constructionStock,
      workers,
    })
    expect(resumed.orders[0]).toMatchObject({
      status: 'complete',
      assignedCrewId: null,
      materials: {
        delivered: 1,
        carried: 0,
        carriedByCrewId: null,
      },
    })
    expect(resumed.constructionStock).toBe(3)
  })

  it('unloads cargo immediately at the work perimeter even if the carrier cannot build', () => {
    const atSite: ConstructionOrder = {
      ...wallOrder(),
      status: 'building',
      block: null,
      assignedCrewId: 'alpha',
      travelPhase: 'at_site',
      materials: {
        required: 1,
        reserved: 0,
        delivered: 0,
        recoverable: 0,
        carried: 1,
        carriedByCrewId: 'alpha',
      },
    }
    const workers = [
      {
        id: 'alpha',
        canConstruct: false,
        movementRate: 2,
        engineeringRate: 1,
        haulingRate: 1,
      },
      {
        id: 'beta',
        canConstruct: true,
        movementRate: 2,
        engineeringRate: 1,
        haulingRate: 1,
      },
    ]
    const unloaded = advanceConstructionWorkerSimulation({
      ...inputFor(atSite, 0),
      crewPositions: [
        { crewId: 'alpha', cell: { x: 4, y: 1 }, moveCredit: 0 },
        { crewId: 'beta', cell: { x: 0, y: 2 }, moveCredit: 0 },
      ],
      workers,
    })

    expect(unloaded.orders[0]).toMatchObject({
      status: 'building',
      materials: {
        delivered: 1,
        carried: 0,
        carriedByCrewId: null,
      },
      work: { completed: 0 },
    })
    expect(unloaded.constructionStock).toBe(4)

    const reassigned = advanceConstructionWorkerSimulation({
      ...inputFor(unloaded.orders[0], 0),
      crewPositions: unloaded.crewPositions,
      constructionStock: unloaded.constructionStock,
      workers,
    })
    expect(reassigned.orders[0]).toMatchObject({
      assignedCrewId: 'beta',
      travelPhase: 'to_site',
      materials: { delivered: 1, carried: 0 },
    })
  })

  it('never tops up partial cargo unless the carrier actually reaches the pallet', () => {
    const partialCargo: ConstructionOrder = {
      ...wallOrder(),
      status: 'hauling',
      block: null,
      assignedCrewId: 'builder',
      travelPhase: 'to_site',
      materials: {
        required: 1,
        reserved: 0.6,
        delivered: 0,
        recoverable: 0,
        carried: 0.4,
        carriedByCrewId: 'builder',
      },
    }
    const result = advanceConstructionWorkerSimulation(inputFor(partialCargo, 0, {
      constructionStock: 0.6,
      crewPositions: [{ crewId: 'builder', cell: { x: 2, y: 1 }, moveCredit: 0 }],
    }))

    expect(result.crewPositions[0].cell).toEqual({ x: 2, y: 1 })
    expect(result.constructionStock).toBe(0.6)
    expect(result.orders[0]).toMatchObject({
      assignedCrewId: 'builder',
      travelPhase: 'to_site',
      materials: {
        reserved: 0.6,
        delivered: 0,
        carried: 0.4,
        carriedByCrewId: 'builder',
      },
    })
  })

  it('hauls at the perimeter, then builds and leaves the worker on a neighboring tile', () => {
    let state = advanceConstructionWorkerSimulation(inputFor(wallOrder(), 2))
    expect(state.crewPositions[0].cell).toEqual({ x: 4, y: 1 })
    expect(state.orders[0]).toMatchObject({
      status: 'building',
      travelPhase: 'at_site',
      materials: {
        delivered: 1,
        reserved: 0,
        carried: 0,
        carriedByCrewId: null,
      },
      work: { completed: 0 },
    })
    expect(state.constructionStock).toBe(3)

    state = advanceConstructionWorkerSimulation(inputFor(
      state.orders[0],
      1,
      {
        layout: state.layout,
        crewPositions: state.crewPositions,
        constructionStock: state.constructionStock,
      },
    ))
    expect(state.orders[0]).toMatchObject({
      status: 'complete',
      assignedCrewId: null,
      travelPhase: 'idle',
      materials: {
        delivered: 1,
        carried: 0,
        carriedByCrewId: null,
      },
    })
    expect(state.layout.boundaries).toContainEqual({ x: 5, y: 1, kind: 'wall' })
    expect(state.crewPositions[0].cell).toEqual({ x: 4, y: 1 })
  })

  it('moves a pallet and idle pawn out of a cell that becomes solid on the final job', () => {
    const order: ConstructionOrder = {
      ...wallOrder(),
      status: 'building',
      assignedCrewId: 'builder',
      travelPhase: 'at_site',
      target: {
        kind: 'boundary',
        cells: [{ x: 1, y: 1 }],
        construct: { x: 1, y: 1, kind: 'wall' },
        deconstruct: null,
      },
      materials: { required: 1, reserved: 0, delivered: 1, recoverable: 0 },
      work: { required: 1, completed: 0 },
    }
    const result = advanceConstructionWorkerSimulation({
      ...inputFor(order, 1),
      stockpile: { x: 1, y: 1 },
      crewPositions: [
        { crewId: 'builder', cell: { x: 0, y: 1 }, moveCredit: 0 },
        { crewId: 'idle', cell: { x: 1, y: 1 }, moveCredit: 0 },
      ],
      workers: [
        {
          id: 'builder',
          canConstruct: true,
          movementRate: 2,
          engineeringRate: 1,
          haulingRate: 1,
        },
        {
          id: 'idle',
          canConstruct: false,
          movementRate: 2,
          engineeringRate: 1,
          haulingRate: 1,
        },
      ],
    })

    expect(result.orders[0].status).toBe('complete')
    expect(result.stockpile).not.toEqual({ x: 1, y: 1 })
    expect(result.crewPositions.find((position) => position.crewId === 'idle')?.cell)
      .not.toEqual({ x: 1, y: 1 })
  })

  it('repairs a legacy pallet overlap before a builder collects material', () => {
    const legacyOrder: ConstructionOrder = {
      ...wallOrder(),
      target: {
        kind: 'boundary',
        cells: [{ x: 1, y: 1 }],
        construct: { x: 1, y: 1, kind: 'wall' },
        deconstruct: null,
      },
    }
    const repaired = advanceConstructionWorkerSimulation({
      ...inputFor(legacyOrder, 0),
      stockpile: { x: 1, y: 1 },
      crewPositions: [{ crewId: 'builder', cell: { x: 0, y: 1 }, moveCredit: 0 }],
    })

    expect(repaired.stockpile).toEqual({ x: 1, y: 0 })
    expect(repaired.noPathOrderIds).toEqual([])
    expect(repaired.orders[0]).toMatchObject({
      assignedCrewId: 'builder',
      travelPhase: 'to_stockpile',
      block: null,
    })
  })

  it('reroutes a second builder before an adjacent wall solidifies beneath them', () => {
    const first = wallOrder()
    const second: ConstructionOrder = {
      ...wallOrder(),
      id: 'wall-2',
      commandId: 'wall-2',
      sequence: 2,
      target: {
        kind: 'boundary',
        cells: [{ x: 6, y: 1 }],
        construct: { x: 6, y: 1, kind: 'wall' },
        deconstruct: null,
      },
    }
    const orders = [first, second].map((order, index): ConstructionOrder => ({
      ...order,
      status: 'building',
      assignedCrewId: index === 0 ? 'alpha' : 'beta',
      travelPhase: 'at_site',
      materials: { required: 1, reserved: 0, delivered: 1, recoverable: 0 },
      work: { required: 1, completed: 0 },
    }))
    const workers = [
      {
        id: 'alpha',
        canConstruct: true,
        movementRate: 2,
        engineeringRate: 1,
        haulingRate: 1,
      },
      {
        id: 'beta',
        canConstruct: true,
        movementRate: 2,
        engineeringRate: 1,
        haulingRate: 1,
      },
    ]
    const result = advanceConstructionWorkerSimulation({
      layout: createConstructionLayout(),
      orders,
      constructionStock: 4,
      stockpile: { x: 1, y: 1 },
      crewPositions: [
        { crewId: 'alpha', cell: { x: 4, y: 1 }, moveCredit: 0 },
        { crewId: 'beta', cell: { x: 5, y: 1 }, moveCredit: 0 },
      ],
      workers,
      elapsed: 1,
    })

    expect(result.orders.map((order) => order.status)).toEqual(['complete', 'building'])
    const beta = result.crewPositions.find((position) => position.crewId === 'beta')!
    expect(beta.cell).toEqual({ x: 5, y: 0 })
    expect(result.layout.boundaries).toContainEqual({ x: 5, y: 1, kind: 'wall' })
    expect(result.layout.boundaries).not.toContainEqual({ x: 6, y: 1, kind: 'wall' })

    let finished = result
    for (let tick = 0; tick < 2 && finished.orders.some(
      (order) => order.status !== 'complete',
    ); tick += 1) {
      finished = advanceConstructionWorkerSimulation({
        layout: finished.layout,
        orders: finished.orders,
        constructionStock: finished.constructionStock,
        stockpile: finished.stockpile,
        crewPositions: finished.crewPositions,
        workers,
        elapsed: 1,
      })
    }

    expect(finished.orders.every((order) => order.status === 'complete')).toBe(true)
    const wallCells = new Set(finished.layout.boundaries.map((cell) => `${cell.x}:${cell.y}`))
    expect(finished.crewPositions.every((position) =>
      !wallCells.has(`${position.cell.x}:${position.cell.y}`),
    )).toBe(true)
  })

  it('keeps unreachable cargo bound to its carrier and resumes that carrier when opened', () => {
    const barrier = Array.from({ length: 24 }, (_, x): BoundaryCell => ({
      x,
      y: 2,
      kind: 'wall',
    }))
    const order = {
      ...wallOrder(),
      status: 'building' as const,
      assignedCrewId: 'builder',
      materials: {
        required: 1,
        reserved: 0,
        delivered: 0,
        recoverable: 0,
        carried: 1,
        carriedByCrewId: 'builder',
      },
      travelPhase: 'to_site' as const,
      target: {
        kind: 'boundary' as const,
        cells: [{ x: 5, y: 4 }] as [{ x: number; y: number }],
        construct: { x: 5, y: 4, kind: 'wall' as const },
        deconstruct: null,
      },
    }
    const result = advanceConstructionWorkerSimulation(inputFor(order, 4, {
      layout: { ...createConstructionLayout(), boundaries: barrier },
      crewPositions: [{ crewId: 'builder', cell: { x: 1, y: 1 }, moveCredit: 0 }],
    }))

    expect(result.noPathOrderIds).toEqual([order.id])
    expect(result.orders[0].block).toMatchObject({ kind: 'no_path' })
    expect(result.orders[0].work.completed).toBe(0)
    expect(result.orders[0]).toMatchObject({
      status: 'blocked',
      assignedCrewId: 'builder',
      travelPhase: 'to_site',
      materials: {
        reserved: 0,
        delivered: 0,
        carried: 1,
        carriedByCrewId: 'builder',
      },
    })
    expect(result.layout.boundaries).toEqual(barrier)

    const opened = barrier.map((cell) =>
      cell.x === 1 ? { ...cell, kind: 'door' as const } : cell,
    )
    const retried = advanceConstructionWorkerSimulation(inputFor(
      result.orders[0],
      4,
      {
        layout: { ...createConstructionLayout(), boundaries: opened },
        crewPositions: result.crewPositions,
        constructionStock: result.constructionStock,
      },
    ))
    expect(retried.noPathOrderIds).toEqual([])
    expect(retried.orders[0].status).toBe('complete')
  })

  it('releases a former builder while keeping its persisted map position', () => {
    const order = { ...wallOrder(), assignedCrewId: 'builder' }
    const result = advanceConstructionWorkerSimulation(inputFor(order, 1, {
      workers: [{
        id: 'builder',
        canConstruct: false,
        movementRate: 2,
        engineeringRate: 1,
        haulingRate: 1,
      }],
    }))

    expect(result.orders[0].assignedCrewId).toBeNull()
    expect(result.crewPositions[0].cell).toEqual({ x: 0, y: 1 })
  })

  it('releases unreachable reservations so a reachable job can use constrained stock', () => {
    const barrier = Array.from({ length: 24 }, (_, x): BoundaryCell => ({
      x,
      y: 2,
      kind: 'wall',
    }))
    const unreachable: ConstructionOrder = {
      ...wallOrder(),
      id: 'unreachable',
      commandId: 'unreachable',
      priority: 5,
      target: {
        kind: 'boundary',
        cells: [{ x: 5, y: 4 }],
        construct: { x: 5, y: 4, kind: 'wall' },
        deconstruct: null,
      },
    }
    const reachable: ConstructionOrder = {
      ...wallOrder(),
      id: 'reachable',
      commandId: 'reachable',
      sequence: 2,
      priority: 3,
    }
    const first = advanceConstructionWorkerSimulation(inputFor(unreachable, 1, {
      layout: { ...createConstructionLayout(), boundaries: barrier },
      orders: [unreachable, reachable],
      constructionStock: 1,
      crewPositions: [{ crewId: 'builder', cell: { x: 1, y: 1 }, moveCredit: 0 }],
    }))

    expect(first.orders.find((order) => order.id === 'unreachable')).toMatchObject({
      status: 'blocked',
      block: { kind: 'no_path' },
      materials: { reserved: 0 },
    })
    expect(first.orders.find((order) => order.id === 'reachable')).toMatchObject({
      status: 'hauling',
      materials: { reserved: 1 },
    })

    const second = advanceConstructionWorkerSimulation({
      ...inputFor(reachable, 0.5),
      layout: first.layout,
      orders: first.orders,
      constructionStock: first.constructionStock,
      crewPositions: first.crewPositions,
    })
    expect(second.orders.find((order) => order.id === 'unreachable')?.block)
      .toMatchObject({ kind: 'no_path' })
    expect(second.orders.find((order) => order.id === 'reachable')?.assignedCrewId)
      .toBe('builder')
  })

  it('retries a no-route job when a reachable builder is freed by cancellation', () => {
    const barrier = Array.from({ length: 24 }, (_, x): BoundaryCell => ({
      x,
      y: 2,
      kind: 'wall',
    }))
    const unreachable: ConstructionOrder = {
      ...wallOrder(),
      id: 'waiting-right',
      commandId: 'waiting-right',
      priority: 5,
      status: 'building',
      target: {
        kind: 'boundary',
        cells: [{ x: 5, y: 4 }],
        construct: { x: 5, y: 4, kind: 'wall' },
        deconstruct: null,
      },
      materials: { required: 1, reserved: 0, delivered: 1, recoverable: 0 },
    }
    const occupyingBuilder: ConstructionOrder = {
      ...unreachable,
      id: 'occupied-right',
      commandId: 'occupied-right',
      sequence: 2,
      priority: 3,
      assignedCrewId: 'beta',
      travelPhase: 'at_site',
      target: {
        kind: 'boundary',
        cells: [{ x: 7, y: 4 }],
        construct: { x: 7, y: 4, kind: 'wall' },
        deconstruct: null,
      },
    }
    const workers = [
      {
        id: 'alpha',
        canConstruct: true,
        movementRate: 2,
        engineeringRate: 1,
        haulingRate: 1,
      },
      {
        id: 'beta',
        canConstruct: true,
        movementRate: 2,
        engineeringRate: 1,
        haulingRate: 1,
      },
    ]
    const first = advanceConstructionWorkerSimulation({
      layout: { ...createConstructionLayout(), boundaries: barrier },
      orders: [unreachable, occupyingBuilder],
      constructionStock: 4,
      stockpile: { x: 1, y: 1 },
      crewPositions: [
        { crewId: 'alpha', cell: { x: 1, y: 1 }, moveCredit: 0 },
        { crewId: 'beta', cell: { x: 6, y: 4 }, moveCredit: 0 },
      ],
      workers,
      elapsed: 0,
    })
    const blocked = first.orders.find((order) => order.id === unreachable.id)!
    expect(blocked.block).toMatchObject({ kind: 'no_path' })

    const retried = advanceConstructionWorkerSimulation({
      layout: first.layout,
      orders: [blocked],
      constructionStock: first.constructionStock,
      stockpile: first.stockpile,
      crewPositions: first.crewPositions,
      workers,
      elapsed: 0,
    })
    expect(retried.noPathOrderIds).toEqual([])
    expect(retried.orders[0]).toMatchObject({
      block: null,
      assignedCrewId: 'beta',
    })
  })

  it('retries a no-route job when a blocking blueprint is canceled', () => {
    const barrier = Array.from({ length: 24 }, (_, x): BoundaryCell => ({
      x,
      y: 2,
      kind: 'wall',
    })).filter((cell) => cell.x !== 1)
    const waiting: ConstructionOrder = {
      ...wallOrder(),
      id: 'waiting-beyond-gap',
      commandId: 'waiting-beyond-gap',
      priority: 5,
      target: {
        kind: 'boundary',
        cells: [{ x: 5, y: 4 }],
        construct: { x: 5, y: 4, kind: 'wall' },
        deconstruct: null,
      },
    }
    const blockingBlueprint: ConstructionOrder = {
      ...wallOrder(),
      id: 'blocking-gap',
      commandId: 'blocking-gap',
      sequence: 2,
      priority: 3,
      status: 'blocked',
      block: {
        kind: 'prerequisite',
        message: 'Waiting for a prerequisite that is not in this fixture.',
      },
      prerequisiteOrderIds: ['missing-prerequisite'],
      target: {
        kind: 'boundary',
        cells: [{ x: 1, y: 2 }],
        construct: { x: 1, y: 2, kind: 'wall' },
        deconstruct: null,
      },
    }
    const first = advanceConstructionWorkerSimulation({
      ...inputFor(waiting, 0),
      layout: { ...createConstructionLayout(), boundaries: barrier },
      orders: [waiting, blockingBlueprint],
      crewPositions: [{ crewId: 'builder', cell: { x: 1, y: 1 }, moveCredit: 0 }],
    })
    const blocked = first.orders.find((order) => order.id === waiting.id)!
    expect(blocked.block).toMatchObject({ kind: 'no_path' })
    expect(first.orders.find((order) => order.id === blockingBlueprint.id)?.assignedCrewId)
      .toBeNull()

    const retried = advanceConstructionWorkerSimulation({
      ...inputFor(blocked, 0),
      layout: first.layout,
      orders: [blocked],
      constructionStock: first.constructionStock,
      crewPositions: first.crewPositions,
    })

    expect(retried.noPathOrderIds).toEqual([])
    expect(retried.orders[0]).toMatchObject({
      block: null,
      assignedCrewId: 'builder',
    })
  })

  it('retries a no-route job after an evacuating builder reaches its side of a chokepoint', () => {
    const barrier = Array.from({ length: 24 }, (_, x): BoundaryCell => ({
      x,
      y: 2,
      kind: 'wall',
    })).filter((cell) => cell.x !== 1)
    barrier.push({ x: 1, y: 1, kind: 'wall' })
    const waiting: ConstructionOrder = {
      ...wallOrder(),
      id: 'waiting-south',
      commandId: 'waiting-south',
      priority: 5,
      status: 'building',
      materials: { required: 1, reserved: 0, delivered: 1, recoverable: 0 },
      target: {
        kind: 'boundary',
        cells: [{ x: 5, y: 4 }],
        construct: { x: 5, y: 4, kind: 'wall' },
        deconstruct: null,
      },
    }
    const blockingBlueprint: ConstructionOrder = {
      ...wallOrder(),
      id: 'blocked-gap',
      commandId: 'blocked-gap',
      sequence: 2,
      priority: 3,
      status: 'blocked',
      block: {
        kind: 'prerequisite',
        message: 'Waiting for a prerequisite that is not in this fixture.',
      },
      prerequisiteOrderIds: ['missing-prerequisite'],
      target: {
        kind: 'boundary',
        cells: [{ x: 1, y: 2 }],
        construct: { x: 1, y: 2, kind: 'wall' },
        deconstruct: null,
      },
    }
    const workers = [
      {
        id: 'alpha',
        canConstruct: true,
        movementRate: 2,
        engineeringRate: 1,
        haulingRate: 1,
      },
      {
        id: 'beta',
        canConstruct: true,
        movementRate: 2,
        engineeringRate: 1,
        haulingRate: 1,
      },
    ]
    const first = advanceConstructionWorkerSimulation({
      layout: { ...createConstructionLayout(), boundaries: barrier },
      orders: [waiting, blockingBlueprint],
      constructionStock: 4,
      stockpile: { x: 2, y: 1 },
      crewPositions: [
        { crewId: 'alpha', cell: { x: 1, y: 2 }, moveCredit: 0 },
        { crewId: 'beta', cell: { x: 2, y: 1 }, moveCredit: 0 },
      ],
      workers,
      elapsed: 1,
    })
    const blocked = first.orders.find((order) => order.id === waiting.id)!
    expect(blocked.block).toMatchObject({ kind: 'no_path' })
    expect(first.crewPositions.find((position) => position.crewId === 'alpha')?.cell)
      .toEqual({ x: 1, y: 3 })

    const retried = advanceConstructionWorkerSimulation({
      layout: first.layout,
      orders: first.orders,
      constructionStock: first.constructionStock,
      stockpile: first.stockpile,
      crewPositions: first.crewPositions,
      workers,
      elapsed: 0,
    })

    expect(retried.noPathOrderIds).toEqual([])
    expect(retried.orders.find((order) => order.id === waiting.id)).toMatchObject({
      block: null,
      assignedCrewId: 'alpha',
    })
  })
})
