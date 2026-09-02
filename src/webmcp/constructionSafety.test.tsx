import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CONSTRUCTION_GRID_HEIGHT, CONSTRUCTION_GRID_WIDTH } from '../game/construction'
import { useColonyStore } from '../game/store'
import { useWebMcpTools } from './registerTools'

interface ToolResult {
  ok: boolean
  code: string
  error?: string
  runId: string
  worldRevision: number
  commandId: string
  orderIds: string[]
  construction: {
    orders: Array<{
      id: string
      assignedCrewId: string | null
      forcedCrewId: string | null
    }>
    crew: Array<{
      crewId: string
      name: string
      available: boolean
      unavailableReason: string | null
      assignedOrderIds: string[]
    }>
  }
}

const registeredTools = new Map<string, WebMCP.ModelContextTool>()
const originalModelContextDescriptor = Object.getOwnPropertyDescriptor(document, 'modelContext')

const registerTool = vi.fn(async (
  tool: WebMCP.ModelContextTool,
  options?: WebMCP.ModelContextRegisterToolOptions,
) => {
  registeredTools.set(tool.name, tool)
  options?.signal?.addEventListener('abort', () => {
    if (registeredTools.get(tool.name) === tool) registeredTools.delete(tool.name)
  }, { once: true })
})

// Real hosts may omit the cancellation signal even though webmcp-types requires it.
const executeTool = async (
  name: string,
  input: unknown,
  options: { signal?: AbortSignal } = {},
): Promise<ToolResult> => {
  const tool = registeredTools.get(name)
  expect(tool, `${name} should have registered`).toBeDefined()
  const result = await tool!.execute(
    input as Parameters<WebMCP.ModelContextTool['execute']>[0],
    options as Parameters<WebMCP.ModelContextTool['execute']>[1],
  )
  expect(result).toMatchObject({ content: [{ type: 'text' }] })
  const text = (result as { content: Array<{ type: string; text: string }> }).content[0].text
  return JSON.parse(text) as ToolResult
}

const currentGuard = () => {
  const state = useColonyStore.getState()
  return { expectedRunId: state.runId, expectedWorldRevision: state.worldRevision }
}

const queueWall = async () => {
  const result = await executeTool('place_construction_blueprint', {
    ...currentGuard(),
    kind: 'wall',
    start: { x: 12, y: 9 },
    end: { x: 14, y: 9 },
  })
  expect(result).toMatchObject({ ok: true, code: 'queued' })
  expect(result.orderIds).toHaveLength(3)
  return result
}

const snapshot = () => JSON.stringify(useColonyStore.getState())

beforeEach(async () => {
  localStorage.clear()
  useColonyStore.getState().resetColony()
  registeredTools.clear()
  registerTool.mockClear()
  Object.defineProperty(document, 'modelContext', {
    configurable: true,
    value: { registerTool } as unknown as WebMCP.ModelContext,
  })
  const hook = renderHook(() => useWebMcpTools())
  await waitFor(() => expect(hook.result.current).toBe('ready'))
})

afterEach(() => {
  cleanup()
  if (originalModelContextDescriptor) {
    Object.defineProperty(document, 'modelContext', originalModelContextDescriptor)
  } else {
    Reflect.deleteProperty(document, 'modelContext')
  }
})

describe('construction WebMCP host and mutation safety', () => {
  it('pauses moving workers with an older revision, then keeps the paused world unchanged', async () => {
    const queued = await queueWall()
    const beforeWorkers = snapshot()
    useColonyStore.getState().advanceConstruction(1)
    expect(useColonyStore.getState().worldRevision).toBeGreaterThan(queued.worldRevision)
    expect(snapshot()).not.toBe(beforeWorkers)

    const paused = await executeTool('manage_construction', {
      expectedRunId: queued.runId,
      expectedWorldRevision: queued.worldRevision,
      action: 'set_speed',
      speed: 0,
    })
    expect(paused).toMatchObject({ ok: true, code: 'speed_changed' })
    expect(useColonyStore.getState().settlement.constructionSpeed).toBe(0)

    const afterPause = snapshot()
    useColonyStore.getState().advanceConstruction(10)
    expect(snapshot()).toBe(afterPause)
    expect(await executeTool('manage_construction', {
      expectedRunId: queued.runId,
      action: 'set_speed',
      speed: 0,
    })).toMatchObject({ ok: true, code: 'speed_unchanged' })
    expect(snapshot()).toBe(afterPause)
  })

  it('accepts a pause callback with no options argument at all', async () => {
    const tool = registeredTools.get('manage_construction')!
    const result = await Reflect.apply(tool.execute, tool, [{
      expectedRunId: useColonyStore.getState().runId,
      action: 'set_speed',
      speed: 0,
    }])
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      ok: true,
      code: 'speed_changed',
    })
    expect(useColonyStore.getState().settlement.constructionSpeed).toBe(0)
  })

  it('keeps exact revision guards on every other construction mutation', async () => {
    const queued = await queueWall()
    const staleGuard = { expectedRunId: queued.runId, expectedWorldRevision: queued.worldRevision - 1 }
    const before = snapshot()
    const managementInputs = [
      { action: 'set_speed', speed: 2 },
      { action: 'cancel_command', commandId: queued.commandId },
      { action: 'cancel_order', orderId: queued.orderIds[0] },
      { action: 'set_command_priority', commandId: queued.commandId, priority: 5 },
      { action: 'set_order_priority', orderId: queued.orderIds[0], priority: 5 },
      { action: 'assign_builder', orderId: queued.orderIds[0], crewId: 'crew-amina-okafor' },
    ]
    for (const input of managementInputs) {
      expect(await executeTool('manage_construction', { ...staleGuard, ...input }))
        .toMatchObject({ ok: false, code: 'stale_world' })
      expect(snapshot()).toBe(before)
    }
    const placements = [
      { kind: 'wall', start: { x: 10, y: 1 }, end: { x: 11, y: 1 } },
      { kind: 'door', start: { x: 12, y: 9 }, end: { x: 12, y: 9 } },
      { kind: 'deconstruct', start: { x: 3, y: 7 }, end: { x: 3, y: 7 } },
      { kind: 'workstation', workstationType: 'solar-array', origin: { x: 14, y: 12 } },
    ]
    for (const input of placements) {
      expect(await executeTool('place_construction_blueprint', { ...staleGuard, ...input }))
        .toMatchObject({ ok: false, code: 'stale_world' })
      expect(snapshot()).toBe(before)
    }
  })

  it('never applies a pause from a stale run or a cancelled request', async () => {
    const oldRunId = useColonyStore.getState().runId
    useColonyStore.getState().resetColony()
    const before = snapshot()
    expect(await executeTool('manage_construction', {
      expectedRunId: oldRunId,
      action: 'set_speed',
      speed: 0,
    })).toMatchObject({ ok: false, code: 'stale_run' })
    expect(snapshot()).toBe(before)

    const controller = new AbortController()
    controller.abort()
    expect(await executeTool('manage_construction', {
      expectedRunId: useColonyStore.getState().runId,
      action: 'set_speed',
      speed: 0,
    }, { signal: controller.signal })).toMatchObject({ ok: false, code: 'cancelled' })
    expect(snapshot()).toBe(before)
  })

  it('exposes deployed worker names and availability and supports manual and automatic assignment', async () => {
    const queued = await queueWall()
    let inspection = await executeTool('inspect_construction', {})
    expect(inspection.construction.crew).toHaveLength(2)
    expect(inspection.construction.crew).toEqual(expect.arrayContaining([
      expect.objectContaining({
        crewId: 'crew-amina-okafor',
        name: 'Amina Okafor',
        available: true,
        unavailableReason: null,
        assignedOrderIds: [],
      }),
      expect.objectContaining({ crewId: 'crew-mateo-alvarez', name: 'Mateo Alvarez' }),
    ]))

    expect(await executeTool('manage_construction', {
      ...currentGuard(),
      action: 'assign_builder',
      orderId: queued.orderIds[0],
      crewId: 'crew-amina-okafor',
    })).toMatchObject({ ok: true, orderId: queued.orderIds[0], crewId: 'crew-amina-okafor' })

    inspection = await executeTool('inspect_construction', {})
    expect(inspection.construction.orders.find((order) => order.id === queued.orderIds[0]))
      .toMatchObject({ assignedCrewId: 'crew-amina-okafor', forcedCrewId: 'crew-amina-okafor' })
    expect(inspection.construction.crew.find((member) => member.crewId === 'crew-amina-okafor'))
      .toMatchObject({ assignedOrderIds: [queued.orderIds[0]] })

    expect(await executeTool('manage_construction', {
      ...currentGuard(),
      action: 'assign_builder',
      orderId: queued.orderIds[0],
      crewId: null,
    })).toMatchObject({ ok: true, orderId: queued.orderIds[0], crewId: null })
    inspection = await executeTool('inspect_construction', {})
    expect(inspection.construction.orders.find((order) => order.id === queued.orderIds[0]))
      .toMatchObject({ assignedCrewId: null, forcedCrewId: null })
  })

  it('rejects unavailable builders through the same assignment validator as the visible queue', async () => {
    const queued = await queueWall()
    for (const crewId of ['missing-crew', 'crew-leila-haddad']) {
      const before = snapshot()
      expect(await executeTool('manage_construction', {
        ...currentGuard(), action: 'assign_builder', orderId: queued.orderIds[0], crewId,
      })).toMatchObject({ ok: false, error: expect.stringContaining('not deployed') })
      expect(snapshot()).toBe(before)
    }

    const state = useColonyStore.getState()
    useColonyStore.setState({
      crew: state.crew.map((member) => member.id === 'crew-amina-okafor'
        ? { ...member, status: 'resting' as const }
        : member),
    })
    const before = snapshot()
    expect(await executeTool('manage_construction', {
      ...currentGuard(),
      action: 'assign_builder',
      orderId: queued.orderIds[0],
      crewId: 'crew-amina-okafor',
    })).toMatchObject({ ok: false, error: expect.stringContaining('resting') })
    expect(snapshot()).toBe(before)
    const inspection = await executeTool('inspect_construction', {})
    expect(inspection.construction.crew.find((member) => member.crewId === 'crew-amina-okafor'))
      .toMatchObject({ available: false, unavailableReason: expect.stringContaining('resting') })
  })

  it('preserves material ownership when a manual builder is carrying a delivery', async () => {
    const queued = await queueWall()
    const state = useColonyStore.getState()
    useColonyStore.setState({
      settlement: {
        ...state.settlement,
        constructionOrders: state.settlement.constructionOrders.map((order) => (
          order.id === queued.orderIds[0] ? {
            ...order,
            assignedCrewId: 'crew-mateo-alvarez',
            forcedCrewId: 'crew-mateo-alvarez',
            travelPhase: 'to_site' as const,
            materials: { ...order.materials, reserved: 0, carried: 1, carriedByCrewId: 'crew-mateo-alvarez' },
          } : order
        )),
      },
    })
    const before = snapshot()
    for (const crewId of ['crew-amina-okafor', null]) {
      expect(await executeTool('manage_construction', {
        ...currentGuard(), action: 'assign_builder', orderId: queued.orderIds[0], crewId,
      })).toMatchObject({ ok: false, error: expect.stringMatching(/deliver/i) })
      expect(snapshot()).toBe(before)
    }
  })

  it('changes command and individual priorities and cancels only the requested work', async () => {
    const queued = await queueWall()
    expect(await executeTool('manage_construction', {
      ...currentGuard(), action: 'set_command_priority', commandId: queued.commandId, priority: 5,
    })).toMatchObject({ ok: true, code: 'priority_changed', changedOrderCount: 3 })
    expect(useColonyStore.getState().settlement.constructionOrders.map((order) => order.priority))
      .toEqual([5, 5, 5])

    expect(await executeTool('manage_construction', {
      ...currentGuard(), action: 'set_order_priority', orderId: queued.orderIds[1], priority: 2,
    })).toMatchObject({ ok: true, code: 'priority_changed' })
    expect(useColonyStore.getState().settlement.constructionOrders.map((order) => order.priority))
      .toEqual([5, 2, 5])

    expect(await executeTool('manage_construction', {
      ...currentGuard(), action: 'cancel_order', orderId: queued.orderIds[1],
    })).toMatchObject({ ok: true, code: 'order_cancelled' })
    expect(useColonyStore.getState().settlement.constructionOrders.map((order) => order.id))
      .toEqual([queued.orderIds[0], queued.orderIds[2]])

    expect(await executeTool('manage_construction', {
      ...currentGuard(), action: 'cancel_command', commandId: queued.commandId,
    })).toMatchObject({ ok: true, code: 'command_cancelled' })
    expect(useColonyStore.getState().settlement.constructionOrders).toEqual([])
  })

  it('rejects malformed placement input without throwing when the host skips schema validation', async () => {
    const wall = {
      ...currentGuard(), kind: 'wall', start: { x: 10, y: 1 }, end: { x: 11, y: 1 },
    }
    const workstation = {
      ...currentGuard(), kind: 'workstation', workstationType: 'solar-array', origin: { x: 14, y: 12 },
    }
    const invalidInputs = [
      null,
      undefined,
      [],
      'wall',
      {},
      { ...wall, expectedRunId: '' },
      { ...wall, expectedWorldRevision: Number.NaN },
      { ...wall, expectedWorldRevision: -1 },
      { ...wall, kind: 'unknown' },
      { ...wall, start: undefined },
      { ...wall, start: null },
      { ...wall, end: {} },
      { ...wall, start: { x: '10', y: 1 } },
      { ...wall, start: { x: 10.5, y: 1 } },
      { ...wall, start: { x: -1, y: 1 } },
      { ...wall, start: { x: Number.POSITIVE_INFINITY, y: 1 } },
      { ...wall, end: { x: CONSTRUCTION_GRID_WIDTH, y: 1 } },
      { ...wall, end: { x: 10, y: CONSTRUCTION_GRID_HEIGHT } },
      { ...wall, end: { x: 1e100, y: 1 } },
      { ...wall, kind: 'deconstruct', end: { x: 1e100, y: 1 } },
      { ...wall, unexpected: true },
      { ...workstation, workstationType: 'unknown' },
      { ...workstation, origin: null },
      {
        ...workstation,
        origin: { x: CONSTRUCTION_GRID_WIDTH, y: CONSTRUCTION_GRID_HEIGHT },
      },
      { ...workstation, rotation: 45 },
      { ...workstation, label: 42 },
      { ...workstation, workstationId: [] },
    ]
    const before = snapshot()
    for (const input of invalidInputs) {
      expect(await executeTool('place_construction_blueprint', input))
        .toMatchObject({ ok: false, code: 'invalid_input' })
      expect(snapshot()).toBe(before)
    }
  })

  it('rejects malformed management input without mutating a live queue', async () => {
    const queued = await queueWall()
    const guard = currentGuard()
    const invalidInputs = [
      null,
      [],
      {},
      { ...guard, action: 'unknown', orderId: queued.orderIds[0], priority: 5 },
      { ...guard, action: 'set_speed', speed: -1 },
      { ...guard, action: 'set_speed', speed: 4 },
      { ...guard, action: 'set_speed', speed: '0' },
      { expectedRunId: guard.expectedRunId, action: 'set_speed', speed: 1 },
      { ...guard, expectedWorldRevision: '1', action: 'set_speed', speed: 0 },
      { ...guard, action: 'set_speed', speed: 0, extra: true },
      { ...guard, action: 'cancel_command', commandId: '' },
      { ...guard, action: 'cancel_order', orderId: null },
      { ...guard, action: 'set_command_priority', commandId: queued.commandId, priority: 6 },
      { ...guard, action: 'set_order_priority', orderId: queued.orderIds[0], priority: 2.5 },
      { ...guard, action: 'assign_builder', orderId: queued.orderIds[0] },
      { ...guard, action: 'assign_builder', orderId: queued.orderIds[0], crewId: '' },
      { ...guard, action: 'assign_builder', orderId: queued.orderIds[0], crewId: 123 },
    ]
    const before = snapshot()
    for (const input of invalidInputs) {
      expect(await executeTool('manage_construction', input))
        .toMatchObject({ ok: false, code: 'invalid_input' })
      expect(snapshot()).toBe(before)
    }
  })
})
