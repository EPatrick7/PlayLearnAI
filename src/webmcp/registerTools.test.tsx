import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CONSTRUCTION_GRID_HEIGHT,
  CONSTRUCTION_GRID_WIDTH,
  offsetStarterPoint,
} from '../game/construction'
import { createInitialState } from '../game/seed'
import { constructModule } from '../game/settlement'
import { useColonyStore } from '../game/store'
import {
  LANDING_WEB_MCP_TOOL_NAMES,
  OPERATIONS_WEB_MCP_TOOL_NAMES,
  WEB_MCP_TOOL_COUNTS,
  useWebMcpTools,
} from './registerTools'

const goldenActions = [
  { kind: 'assign_crew', crewId: 'crew-mateo-alvarez', workOrderId: 'work-seal-lab' },
  { kind: 'reserve_equipment', equipmentId: 'equipment-eva-01', workOrderId: 'work-seal-lab' },
  { kind: 'reserve_equipment', equipmentId: 'equipment-engineering-01', workOrderId: 'work-seal-lab' },
  { kind: 'assign_crew', crewId: 'crew-soo-jin-park', workOrderId: 'work-repressurize-lab' },
  {
    kind: 'reserve_equipment',
    equipmentId: 'equipment-eva-03',
    workOrderId: 'work-repressurize-lab',
  },
  {
    kind: 'reserve_equipment',
    equipmentId: 'equipment-engineering-02',
    workOrderId: 'work-repressurize-lab',
  },
  { kind: 'assign_crew', crewId: 'crew-leila-haddad', workOrderId: 'work-research-sintering' },
  { kind: 'assign_crew', crewId: 'crew-nia-kimani', workOrderId: 'work-clean-solar' },
  { kind: 'reserve_equipment', equipmentId: 'equipment-eva-02', workOrderId: 'work-clean-solar' },
  { kind: 'reserve_equipment', equipmentId: 'equipment-rover-01', workOrderId: 'work-clean-solar' },
]

const goldenAssignments = [
  {
    workOrderId: 'work-seal-lab',
    crewId: 'crew-mateo-alvarez',
    equipmentIds: ['equipment-eva-01', 'equipment-engineering-01'],
  },
  {
    workOrderId: 'work-repressurize-lab',
    crewId: 'crew-soo-jin-park',
    equipmentIds: ['equipment-eva-03', 'equipment-engineering-02'],
  },
  { workOrderId: 'work-research-sintering', crewId: 'crew-leila-haddad' },
  {
    workOrderId: 'work-clean-solar',
    crewId: 'crew-nia-kimani',
    equipmentIds: ['equipment-eva-02', 'equipment-rover-01'],
  },
]

interface TextToolResult {
  content: Array<{ type: 'text'; text: string }>
}

const registeredTools = new Map<string, WebMCP.ModelContextTool>()
const originalModelContextDescriptor = Object.getOwnPropertyDescriptor(document, 'modelContext')

const registerTool = vi.fn(
  async (
    tool: WebMCP.ModelContextTool,
    options?: WebMCP.ModelContextRegisterToolOptions,
  ) => {
    registeredTools.set(tool.name, tool)
    const unregister = () => {
      if (registeredTools.get(tool.name) === tool) registeredTools.delete(tool.name)
    }
    if (options?.signal?.aborted) unregister()
    else options?.signal?.addEventListener('abort', unregister, { once: true })
  },
)

const installModelContext = () => {
  Object.defineProperty(document, 'modelContext', {
    configurable: true,
    value: { registerTool } as unknown as WebMCP.ModelContext,
  })
}

const executeTool = async <T,>(
  name: string,
  input: Record<string, unknown>,
  signal = new AbortController().signal,
): Promise<T> => {
  const tool = registeredTools.get(name)
  expect(tool, `${name} should have registered`).toBeDefined()

  const result = await tool!.execute(input, { signal })
  expect(result).toMatchObject({ content: [{ type: 'text' }] })
  return JSON.parse((result as TextToolResult).content[0].text) as T
}

const registerMoonbaseTools = async () => {
  const hook = renderHook(() => useWebMcpTools())
  await waitFor(() => expect(hook.result.current).toBe('ready'))
  return hook
}

const establishReadyStore = () => {
  const builds = [
    ['solar_battery_skid', 'site-power-east'],
    ['life_support', 'site-bay-northwest'],
    ['airlock', 'site-bay-southeast'],
    ['laboratory', 'site-bay-northeast'],
    ['storage', 'site-bay-southwest'],
  ] as const
  const current = useColonyStore.getState()
  let state = createInitialState(current.seed)
  builds.forEach(([blueprintId, siteId]) => {
    const [nextState, result] = constructModule(state, blueprintId, siteId, 'agent')
    expect(result.ok).toBe(true)
    state = nextState
  })
  useColonyStore.setState((store) => ({ ...store, ...state }))
  expect(useColonyStore.getState().settlement.phase).toBe('ready')
}

const enterOperations = () => {
  establishReadyStore()
  expect(useColonyStore.getState().beginOperations('agent')).toMatchObject({
    ok: true,
    code: 'operations_started',
  })
}

const expectStateEnvelope = (value: {
  runId?: string
  settlementPhase?: string
  worldRevision?: number
  next?: string
}) => {
  expect(value.runId).toBe(useColonyStore.getState().runId)
  expect(value.settlementPhase).toBe(useColonyStore.getState().settlement.phase)
  expect(value.worldRevision).toBe(useColonyStore.getState().worldRevision)
  expect(value.next).toEqual(expect.any(String))
  expect(value.next!.length).toBeGreaterThan(0)
}

beforeEach(() => {
  localStorage.clear()
  useColonyStore.getState().resetColony()
  registeredTools.clear()
  registerTool.mockClear()
  installModelContext()
})

afterEach(() => {
  cleanup()
  if (originalModelContextDescriptor) {
    Object.defineProperty(document, 'modelContext', originalModelContextDescriptor)
  } else {
    Reflect.deleteProperty(document, 'modelContext')
  }
})

describe('Moonbase WebMCP registration', () => {
  it('registers the exact landing catalog with strict schemas and no incident leak', async () => {
    const hook = await registerMoonbaseTools()

    expect(WEB_MCP_TOOL_COUNTS).toEqual({ landing: 4, operations: 11 })
    expect(registerTool).toHaveBeenCalledTimes(WEB_MCP_TOOL_COUNTS.landing)
    expect([...registeredTools.keys()]).toEqual([...LANDING_WEB_MCP_TOOL_NAMES])
    expect(registeredTools.has('inspect_moonbase')).toBe(false)
    expect(registeredTools.has('stage_operations_plan')).toBe(false)

    const placementSchema = registeredTools.get('place_construction_blueprint')!
      .inputSchema as { oneOf: Array<Record<string, unknown>> }
    expect(placementSchema.oneOf).toHaveLength(4)
    placementSchema.oneOf.forEach((variant) => {
      expect(variant.additionalProperties).toBe(false)
      expect(variant).toMatchObject({
        properties: { expectedRunId: { type: 'string' } },
        required: expect.arrayContaining(['expectedRunId']),
      })
    })
    expect(placementSchema.oneOf[0]).toMatchObject({
      properties: {
        expectedWorldRevision: { type: 'integer' },
        start: {
          properties: { x: { type: 'integer' }, y: { type: 'integer' } },
          additionalProperties: false,
        },
      },
    })

    const inspection = await executeTool<{
      runId: string
      settlementPhase: string
      worldRevision: number
      next: string
      construction: { speed: number; openOrderCount: number }
    }>('inspect_construction', {})
    expectStateEnvelope(inspection)
    expect(inspection).toMatchObject({
      settlementPhase: 'landing',
      construction: { speed: 1, openOrderCount: 0 },
    })
    expect(inspection.runId).toMatch(/^moonbase-run-[a-z0-9]{16,}$/i)
    expect(inspection.runId).not.toContain(String(useColonyStore.getState().seed))
    const serialized = JSON.stringify(inspection)
    expect(serialized).not.toContain('work-seal-lab')
    expect(serialized).not.toContain('laboratory')
    expect(serialized).not.toContain('alerts')
    expect(serialized).not.toContain('dust')

    hook.unmount()
  })

  it('queues typed wall, door, workstation, and deconstruction work and manages it', async () => {
    await registerMoonbaseTools()

    const wall = await executeTool<{
      ok: boolean
      code: string
      commandId: string
      orderIds: string[]
      settlementPhase: string
      worldRevision: number
      next: string
    }>('place_construction_blueprint', {
      expectedRunId: useColonyStore.getState().runId,
      expectedWorldRevision: useColonyStore.getState().worldRevision,
      kind: 'wall',
      start: { x: 10, y: 1 },
      end: { x: 11, y: 1 },
    })
    expect(wall).toMatchObject({ ok: true, code: 'queued', settlementPhase: 'landing' })
    expect(wall.orderIds).toHaveLength(2)
    expectStateEnvelope(wall)

    const door = await executeTool<{ ok: boolean; code: string; worldRevision: number }>(
      'place_construction_blueprint',
      {
        expectedRunId: useColonyStore.getState().runId,
        expectedWorldRevision: wall.worldRevision,
        kind: 'door',
        start: { x: 10, y: 1 },
        end: { x: 10, y: 1 },
      },
    )
    expect(door).toMatchObject({ ok: true, code: 'queued' })

    const workstation = await executeTool<{
      ok: boolean
      commandId: string
      workstationId: string
      worldRevision: number
    }>('place_construction_blueprint', {
      expectedRunId: useColonyStore.getState().runId,
      expectedWorldRevision: door.worldRevision,
      kind: 'workstation',
      workstationType: 'solar-array',
      workstationId: 'agent-solar-array',
      origin: { x: CONSTRUCTION_GRID_WIDTH - 4, y: CONSTRUCTION_GRID_HEIGHT - 3 },
      rotation: 0,
    })
    expect(workstation).toMatchObject({
      ok: true,
      workstationId: 'agent-solar-array',
    })

    const deconstruction = await executeTool<{
      ok: boolean
      code: string
      worldRevision: number
    }>('place_construction_blueprint', {
      expectedRunId: useColonyStore.getState().runId,
      expectedWorldRevision: workstation.worldRevision,
      kind: 'deconstruct',
      start: offsetStarterPoint({ x: 3, y: 7 }),
      end: offsetStarterPoint({ x: 3, y: 7 }),
    })
    expect(deconstruction).toMatchObject({ ok: true, code: 'queued' })

    const queuedInspection = await executeTool<{ next: string }>('inspect_construction', {})
    expect(queuedInspection.next).toContain('Finish or cancel every open construction order')

    const prioritized = await executeTool<{
      ok: boolean
      changedOrderCount: number
      worldRevision: number
    }>('manage_construction', {
      expectedRunId: useColonyStore.getState().runId,
      expectedWorldRevision: deconstruction.worldRevision,
      action: 'set_command_priority',
      commandId: workstation.commandId,
      priority: 1,
    })
    expect(prioritized).toMatchObject({ ok: true, changedOrderCount: 1 })

    const paused = await executeTool<{
      ok: boolean
      speed: number
      worldRevision: number
    }>('manage_construction', {
      expectedRunId: useColonyStore.getState().runId,
      expectedWorldRevision: prioritized.worldRevision,
      action: 'set_speed',
      speed: 0,
    })
    expect(paused).toMatchObject({ ok: true, speed: 0 })
    expect(paused.worldRevision).toBe(prioritized.worldRevision + 1)

    const staleAfterSpeedChange = await executeTool<{
      ok: boolean
      code: string
      currentWorldRevision: number
    }>('manage_construction', {
      expectedRunId: useColonyStore.getState().runId,
      expectedWorldRevision: prioritized.worldRevision,
      action: 'cancel_command',
      commandId: workstation.commandId,
    })
    expect(staleAfterSpeedChange).toMatchObject({
      ok: false,
      code: 'stale_world',
      currentWorldRevision: paused.worldRevision,
    })

    const cancelled = await executeTool<{
      ok: boolean
      cancelledOrderIds: string[]
      settlementPhase: string
      worldRevision: number
      next: string
    }>('manage_construction', {
      expectedRunId: useColonyStore.getState().runId,
      expectedWorldRevision: paused.worldRevision,
      action: 'cancel_command',
      commandId: workstation.commandId,
    })
    expect(cancelled.ok).toBe(true)
    expect(cancelled.cancelledOrderIds).toHaveLength(1)
    expectStateEnvelope(cancelled)
    expect(
      useColonyStore.getState().settlement.constructionOrders.some(
        (order) => order.commandId === workstation.commandId && order.status !== 'complete',
      ),
    ).toBe(false)
  })

  it('rejects a retained mutation after reset even when its revisions match the new run', async () => {
    await registerMoonbaseTools()
    const retainedPlacement = registeredTools.get('place_construction_blueprint')!
    const oldState = useColonyStore.getState()
    const oldRunId = oldState.runId
    const oldWorldRevision = oldState.worldRevision

    useColonyStore.getState().resetColony()
    const resetState = useColonyStore.getState()
    expect(resetState.runId).not.toBe(oldRunId)
    expect(resetState.worldRevision).toBe(oldWorldRevision)
    expect(resetState.operationsPlan.revision).toBe(oldState.operationsPlan.revision)
    const before = JSON.stringify(resetState)

    const rawResult = await retainedPlacement.execute(
      {
        expectedRunId: oldRunId,
        expectedWorldRevision: oldWorldRevision,
        kind: 'wall',
        start: { x: 10, y: 1 },
        end: { x: 11, y: 1 },
      },
      { signal: new AbortController().signal },
    ) as TextToolResult
    const result = JSON.parse(rawResult.content[0].text) as {
      ok: boolean
      code: string
      runId: string
      currentRunId: string
    }

    expect(result).toMatchObject({
      ok: false,
      code: 'stale_run',
      runId: resetState.runId,
      currentRunId: resetState.runId,
    })
    expect(JSON.stringify(useColonyStore.getState())).toBe(before)
  })

  it('begins the first shift and reactively replaces landing tools with the operations catalog', async () => {
    establishReadyStore()
    const hook = await registerMoonbaseTools()
    const landingSignals = registerTool.mock.calls.map(([, options]) => options?.signal)
    expect([...registeredTools.keys()]).toEqual([...LANDING_WEB_MCP_TOOL_NAMES])

    const began = await executeTool<{
      ok: boolean
      code: string
      settlementPhase: string
      worldRevision: number
      next: string
    }>('begin_first_shift', {
      expectedRunId: useColonyStore.getState().runId,
      expectedWorldRevision: useColonyStore.getState().worldRevision,
    })
    expect(began).toMatchObject({
      ok: true,
      code: 'operations_started',
      settlementPhase: 'operations',
    })
    expectStateEnvelope(began)

    await waitFor(() => {
      expect(hook.result.current).toBe('ready')
      expect([...registeredTools.keys()]).toEqual([...OPERATIONS_WEB_MCP_TOOL_NAMES])
    })
    expect(registeredTools.has('begin_first_shift')).toBe(false)
    expect(landingSignals.every((signal) => signal?.aborted)).toBe(true)

    const operationalConstruction = await executeTool<{ next: string }>(
      'inspect_construction',
      {},
    )
    expect(operationalConstruction.next).toContain('Operations are active')
    expect(operationalConstruction.next).not.toContain('begin_first_shift')
  })

  it('guards a retained operational callback after returning to landing', async () => {
    enterOperations()
    const hook = await registerMoonbaseTools()
    const retainedInspection = registeredTools.get('inspect_moonbase')!
    const oldRunId = useColonyStore.getState().runId

    useColonyStore.getState().resetColony()
    await waitFor(() => {
      expect([...registeredTools.keys()]).toEqual([...LANDING_WEB_MCP_TOOL_NAMES])
    })

    const rawResult = await retainedInspection.execute(
      { expectedRunId: oldRunId },
      { signal: new AbortController().signal },
    ) as TextToolResult
    const guarded = JSON.parse(rawResult.content[0].text) as {
      ok: boolean
      code: string
      settlementPhase: string
      worldRevision: number
      next: string
    }
    expect(guarded).toMatchObject({
      ok: false,
      code: 'stale_run',
      settlementPhase: 'landing',
    })
    expectStateEnvelope(guarded)
    expect(JSON.stringify(guarded)).not.toContain('work-seal-lab')
    expect(JSON.stringify(guarded)).not.toContain('laboratory')

    hook.unmount()
  })

  it('registers exactly eleven operations tools and drives the shared Zustand store through verified success', async () => {
    enterOperations()
    const hook = await registerMoonbaseTools()

    expect(registerTool).toHaveBeenCalledTimes(WEB_MCP_TOOL_COUNTS.operations)
    expect([...registeredTools.keys()]).toEqual([...OPERATIONS_WEB_MCP_TOOL_NAMES])
    expect(
      registerTool.mock.calls.every(([, options]) => options?.signal instanceof AbortSignal),
    ).toBe(true)

    const moonbaseInspectionTool = registeredTools.get('inspect_moonbase')!
    const resourceQueryTool = registeredTools.get('query_crew_and_equipment')!
    expect(moonbaseInspectionTool.annotations).toMatchObject({ readOnlyHint: false })
    expect(resourceQueryTool.annotations).toMatchObject({ readOnlyHint: false })
    expect(moonbaseInspectionTool.description).toContain('Records the inspection')
    expect(moonbaseInspectionTool.description).toContain('inspect_operations_plan')
    expect(resourceQueryTool.description).toContain('persistent workflow evidence')
    expect(registeredTools.get('inspect_operations_plan')!.description).toContain(
      'according to its lifecycle',
    )
    expect(registeredTools.get('advance_until')!.description).toContain(
      'cannot replace the committed stop',
    )
    ;[
      'inspect_moonbase',
      'query_crew_and_equipment',
      'stage_operations_plan',
      'edit_operations_plan',
      'commit_operations_plan',
      'advance_until',
      'verify_operations_plan',
    ].forEach((toolName) => {
      const schema = registeredTools.get(toolName)!.inputSchema as {
        properties: Record<string, unknown>
        required: string[]
        additionalProperties: boolean
      }
      expect(schema.properties.expectedRunId).toMatchObject({ type: 'string' })
      expect(schema.required).toContain('expectedRunId')
      expect(schema.additionalProperties).toBe(false)
    })

    const inspection = await executeTool<{
      runId: string
      worldRevision: number
      operationsPlan: { revision: number; actionCount: number }
      laboratory: { atmosphere: string; breached: boolean }
      workflow: { phase: string }
    }>('inspect_moonbase', {
      expectedRunId: useColonyStore.getState().runId,
      focus: 'lab recovery, dust timing, crew, and equipment',
    })

    expect(inspection).toMatchObject({
      worldRevision: useColonyStore.getState().worldRevision,
      settlementPhase: 'operations',
      operationsPlan: { revision: 1, actionCount: 0 },
      laboratory: { atmosphere: 'no', breached: true },
      workflow: { phase: 'ground' },
    })
    expect(useColonyStore.getState().learning.achieved.ground).toBe(false)

    const crewOnly = await executeTool<{ equipment: unknown[] }>('query_crew_and_equipment', {
      expectedRunId: inspection.runId,
      workOrderId: 'work-seal-lab',
      includeEquipment: false,
    })
    expect(crewOnly.equipment).toEqual([])
    expect(useColonyStore.getState().learning.achieved.ground).toBe(false)

    const comparison = await executeTool<{
      workflow?: { phase: string }
      crew: Array<{ id: string }>
      equipment: Array<{ id: string }>
    }>('query_crew_and_equipment', {
      expectedRunId: inspection.runId,
      workOrderId: 'work-seal-lab',
    })
    expect(comparison.crew.length).toBeGreaterThan(0)
    expect(comparison.equipment.length).toBeGreaterThan(0)
    expect(useColonyStore.getState().learning).toMatchObject({
      currentPhase: 'plan',
      achieved: { ground: true },
    })

    const staged = await executeTool<{
      ok: boolean
      worldRevision: number
      plan: { revision: number; status: string; actions: unknown[] }
      validation: { valid: boolean; planRevision: number }
    }>('stage_operations_plan', {
      expectedRunId: inspection.runId,
      expectedWorldRevision: inspection.worldRevision,
      expectedPlanRevision: inspection.operationsPlan.revision,
      protectedCrewIds: ['crew-jonah-reed'],
      assignments: goldenAssignments,
    })

    const stagedStore = useColonyStore.getState()
    expect(staged).toMatchObject({
      ok: true,
      worldRevision: stagedStore.worldRevision,
      plan: { revision: stagedStore.operationsPlan.revision, status: 'draft' },
      validation: { valid: true, planRevision: stagedStore.operationsPlan.revision },
    })
    expect(staged.plan.actions).toHaveLength(goldenActions.length)
    expect(stagedStore.operationsPlan.actions).toHaveLength(goldenActions.length)

    const planInspection = await executeTool<{
      worldRevision: number
      plan: { revision: number; status: string }
      validation: { valid: boolean }
    }>('inspect_operations_plan', {})
    expect(planInspection).toMatchObject({
      worldRevision: stagedStore.worldRevision,
      plan: { revision: stagedStore.operationsPlan.revision, status: 'draft' },
      validation: { valid: true },
    })

    const committed = await executeTool<{
      ok: boolean
      code: string
      worldRevision: number
      planRevision: number
      currentPlan: { revision: number; status: string }
    }>('commit_operations_plan', {
      expectedRunId: useColonyStore.getState().runId,
      expectedWorldRevision: planInspection.worldRevision,
      expectedPlanRevision: planInspection.plan.revision,
    })

    const committedStore = useColonyStore.getState()
    expect(committed).toMatchObject({
      ok: true,
      code: 'committed',
      worldRevision: committedStore.worldRevision,
      planRevision: committedStore.operationsPlan.revision,
      currentPlan: { revision: committedStore.operationsPlan.revision, status: 'committed' },
    })
    expect(committedStore.crew.find((member) => member.id === 'crew-mateo-alvarez')).toMatchObject({
      status: 'assigned',
      taskId: 'work-seal-lab',
    })

    const checkpointInspection = await executeTool<{
      workflow: { phase: string }
    }>('inspect_moonbase', {
      expectedRunId: committedStore.runId,
      focus: 'one-hour checkpoint telemetry',
    })
    expect(checkpointInspection.workflow.phase).toBe('supervise')
    expect(useColonyStore.getState().learning).toMatchObject({
      currentPhase: 'supervise',
      achieved: { supervise: false },
      evidence: expect.arrayContaining([expect.objectContaining({ phase: 'supervise' })]),
    })

    const advanced = await executeTool<{
      ok: boolean
      advancedHours: number
      stopReason: string
      completedWorkOrderIds: string[]
      state: {
        worldRevision: number
        laboratory: { atmosphere: string; breached: boolean; sealed: boolean }
        research: { status: string }
      }
    }>('advance_until', {
      expectedRunId: useColonyStore.getState().runId,
      expectedWorldRevision: committed.worldRevision,
      hours: 12,
    })

    const advancedStore = useColonyStore.getState()
    expect(advanced).toMatchObject({
      ok: true,
      advancedHours: 10,
      stopReason: 'objective_complete',
      state: {
        worldRevision: advancedStore.worldRevision,
        laboratory: { atmosphere: 'yes', breached: false, sealed: true },
        research: { status: 'complete' },
      },
    })
    expect(advanced.completedWorkOrderIds).toEqual([
      'work-seal-lab',
      'work-clean-solar',
      'work-repressurize-lab',
      'work-research-sintering',
    ])
    expect(advancedStore.scenarioStatus).toBe('objective_complete')

    const verified = await executeTool<{
      ok: boolean
      verification: {
        status: string
        checks: Array<{ passed: boolean }>
        residualRisks: string[]
      }
      scenarioStatus: string
      workflow: { completedLoops: number }
    }>('verify_operations_plan', {
      expectedRunId: useColonyStore.getState().runId,
      expectedWorldRevision: advanced.state.worldRevision,
    })

    const verifiedStore = useColonyStore.getState()
    expect(verified).toMatchObject({
      ok: true,
      verification: { status: 'success', residualRisks: [] },
      scenarioStatus: 'objective_complete',
      workflow: { completedLoops: 1 },
    })
    expect(verified.verification.checks.every((check) => check.passed)).toBe(true)
    expect(verifiedStore.verification?.status).toBe('success')
    expect(verifiedStore.learning.completedLoops).toBe(1)

    const verifiedSnapshot = JSON.stringify(verifiedStore)
    const repeatedVerification = await executeTool<{
      verification: { status: string }
      workflow: { completedLoops: number }
    }>('verify_operations_plan', {
      expectedRunId: verifiedStore.runId,
      expectedWorldRevision: verifiedStore.worldRevision,
    })
    expect(repeatedVerification).toMatchObject({
      verification: { status: 'success' },
      workflow: { completedLoops: 1 },
    })
    expect(JSON.stringify(useColonyStore.getState())).toBe(verifiedSnapshot)

    const registrationSignals = registerTool.mock.calls.map(([, options]) => options?.signal)
    hook.unmount()
    expect(registrationSignals.every((signal) => signal?.aborted)).toBe(true)
  })

  it('rejects a stale plan revision without partially staging changes', async () => {
    enterOperations()
    await registerMoonbaseTools()
    const before = useColonyStore.getState()

    const result = await executeTool<{
      ok: boolean
      code: string
      currentWorldRevision: number
      currentPlanRevision: number
      next: string
    }>('stage_operations_plan', {
      expectedRunId: before.runId,
      expectedWorldRevision: before.worldRevision,
      expectedPlanRevision: before.operationsPlan.revision + 1,
      assignments: [goldenAssignments[0]],
    })

    expect(result).toEqual({
      ok: false,
      code: 'stale_revision',
      currentWorldRevision: before.worldRevision,
      currentPlanRevision: before.operationsPlan.revision,
      runId: before.runId,
      settlementPhase: 'operations',
      worldRevision: before.worldRevision,
      next: 'Inspect the Operations Plan again before editing it.',
    })
    expect(useColonyStore.getState().operationsPlan).toEqual(before.operationsPlan)
    expect(useColonyStore.getState().crew).toEqual(before.crew)
  })

  it('enforces a committed milestone when advance_until supplies a weaker override', async () => {
    enterOperations()
    await registerMoonbaseTools()
    const initial = useColonyStore.getState()

    const staged = await executeTool<{
      ok: boolean
      plan: { revision: number }
    }>('stage_operations_plan', {
      expectedRunId: initial.runId,
      expectedWorldRevision: initial.worldRevision,
      expectedPlanRevision: initial.operationsPlan.revision,
      horizonHours: 8,
      stopCondition: {
        kind: 'work_order_complete',
        workOrderId: 'work-seal-lab',
      },
      assignments: [goldenAssignments[0]],
    })
    expect(staged.ok).toBe(true)

    const committed = await executeTool<{ ok: boolean; worldRevision: number }>(
      'commit_operations_plan',
      {
        expectedRunId: initial.runId,
        expectedWorldRevision: initial.worldRevision,
        expectedPlanRevision: staged.plan.revision,
      },
    )
    expect(committed.ok).toBe(true)

    const advanced = await executeTool<{
      advancedHours: number
      stopReason: string
      state: { laboratory: { sealed: boolean; atmosphere: string } }
    }>('advance_until', {
      expectedRunId: initial.runId,
      expectedWorldRevision: committed.worldRevision,
      hours: 8,
      stopCondition: { kind: 'objective_complete' },
    })

    expect(advanced).toMatchObject({
      advancedHours: 3,
      stopReason: 'work_order_complete',
      state: { laboratory: { sealed: true, atmosphere: 'no' } },
    })
    expect(useColonyStore.getState().operationsPlan.status).toBe('completed')

    const completedInspection = await executeTool<{
      validation: null
      review: { kind: string }
      next: string
    }>('inspect_operations_plan', {})
    expect(completedInspection).toMatchObject({
      validation: null,
      review: { kind: 'awaiting_verification' },
    })
    expect(completedInspection.next).toContain('Verify it now')
    expect(completedInspection.next).not.toMatch(/stage or amend|before commit/i)
    expect(JSON.stringify(completedInspection)).not.toContain('closed_work_order')

    const beforeClear = JSON.stringify(useColonyStore.getState())
    const blockedClear = await executeTool<{
      ok: boolean
      results: Array<{ ok: boolean; error: string }>
    }>('edit_operations_plan', {
      expectedRunId: initial.runId,
      expectedPlanRevision: useColonyStore.getState().operationsPlan.revision,
      operation: 'clear',
    })
    expect(blockedClear).toMatchObject({
      ok: false,
      results: [{
        ok: false,
        error: 'Verify the supervised outcome before opening a new Operations Plan.',
      }],
    })
    expect(JSON.stringify(useColonyStore.getState())).toBe(beforeClear)

    const verification = await executeTool<{ verification: { status: string } }>(
      'verify_operations_plan', {
        expectedRunId: initial.runId,
        expectedWorldRevision: useColonyStore.getState().worldRevision,
      },
    )
    expect(verification.verification.status).toBe('success')
    const verifiedInspection = await executeTool<{
      validation: null
      review: { kind: string }
      next: string
    }>('inspect_operations_plan', {})
    expect(verifiedInspection).toMatchObject({
      validation: null,
      review: { kind: 'verified' },
    })
    expect(verifiedInspection.next).toContain('fresh bounded plan')
  })

  it('preserves a committed threshold stop and rejects another advance', async () => {
    enterOperations()
    await registerMoonbaseTools()
    const initial = useColonyStore.getState()

    const staged = await executeTool<{
      ok: boolean
      plan: { revision: number }
    }>('stage_operations_plan', {
      expectedRunId: initial.runId,
      expectedWorldRevision: initial.worldRevision,
      expectedPlanRevision: initial.operationsPlan.revision,
      stopCondition: { kind: 'oxygen_below', thresholdHours: 31 },
      assignments: goldenAssignments,
    })
    expect(staged.ok).toBe(true)

    const committed = await executeTool<{ ok: boolean; worldRevision: number }>(
      'commit_operations_plan',
      {
        expectedRunId: initial.runId,
        expectedWorldRevision: initial.worldRevision,
        expectedPlanRevision: staged.plan.revision,
      },
    )
    expect(committed.ok).toBe(true)

    const advanced = await executeTool<{
      ok: boolean
      advancedHours: number
      stopReason: string
      review: { kind: string }
      state: { worldRevision: number }
    }>('advance_until', {
      expectedRunId: initial.runId,
      expectedWorldRevision: committed.worldRevision,
      hours: 4,
    })
    expect(advanced).toMatchObject({
      ok: true,
      advancedHours: 1,
      stopReason: 'oxygen_below',
      review: { kind: 'awaiting_verification' },
    })

    const preserved = JSON.stringify(useColonyStore.getState())
    const repeated = await executeTool<{
      ok: boolean
      code: string
      review: { kind: string }
      next: string
    }>('advance_until', {
      expectedRunId: initial.runId,
      expectedWorldRevision: advanced.state.worldRevision,
      hours: 4,
    })
    expect(repeated).toMatchObject({
      ok: false,
      code: 'plan_completed',
      review: { kind: 'awaiting_verification' },
    })
    expect(repeated.next).toContain('Verify it now')
    expect(JSON.stringify(useColonyStore.getState())).toBe(preserved)

    const verified = await executeTool<{
      verification: { status: string }
      review: { kind: string }
    }>('verify_operations_plan', {
      expectedRunId: initial.runId,
      expectedWorldRevision: advanced.state.worldRevision,
    })
    expect(verified).toMatchObject({
      verification: { status: 'failure' },
      review: { kind: 'verified' },
    })
  })

  it('rejects a malformed work assignment at the schema boundary without changing the plan', async () => {
    enterOperations()
    await registerMoonbaseTools()
    const before = JSON.stringify(useColonyStore.getState())
    const state = useColonyStore.getState()

    const result = await executeTool<{ ok: boolean; code: string; error: string }>(
      'stage_operations_plan', {
      expectedRunId: state.runId,
      expectedWorldRevision: state.worldRevision,
      expectedPlanRevision: state.operationsPlan.revision,
      mode: 'replace',
      assignments: [
        { workOrderId: 'work-seal-lab' },
      ],
    })

    expect(result).toMatchObject({
      ok: false,
      code: 'invalid_input',
    })
    expect(result.error).toContain("must have required property 'crewId'")
    expect(JSON.stringify(useColonyStore.getState())).toBe(before)
  })

  it('rejects an unknown runtime stop kind without changing the shared plan', async () => {
    enterOperations()
    await registerMoonbaseTools()
    const state = useColonyStore.getState()
    const before = JSON.stringify(state)

    const result = await executeTool<{ ok: boolean; code: string; error: string }>(
      'stage_operations_plan',
      {
        expectedRunId: state.runId,
        expectedWorldRevision: state.worldRevision,
        expectedPlanRevision: state.operationsPlan.revision,
        horizonHours: 8,
        stopCondition: { kind: 'unexpected_stop' },
        assignments: [goldenAssignments[0]],
      },
    )

    expect(result).toMatchObject({
      ok: false,
      code: 'invalid_input',
    })
    expect(result.error).toContain('must be equal to one of the allowed values')
    expect(JSON.stringify(useColonyStore.getState())).toBe(before)
  })

  it('rejects a multi-action removal without publishing a partial edit', async () => {
    enterOperations()
    await registerMoonbaseTools()
    const initial = useColonyStore.getState()

    const staged = await executeTool<{
      ok: boolean
      plan: { revision: number; actions: Array<{ id: string }> }
    }>('stage_operations_plan', {
      expectedRunId: initial.runId,
      expectedWorldRevision: initial.worldRevision,
      expectedPlanRevision: initial.operationsPlan.revision,
      assignments: [{
        workOrderId: 'work-seal-lab',
        crewId: 'crew-mateo-alvarez',
        equipmentIds: ['equipment-eva-01'],
      }],
    })
    expect(staged.ok).toBe(true)

    const before = JSON.stringify(useColonyStore.getState())
    const result = await executeTool<{
      ok: boolean
      code: string
      failures: Array<{ actionIndex: number; actionId: string; error: string }>
    }>('edit_operations_plan', {
      expectedRunId: useColonyStore.getState().runId,
      expectedPlanRevision: staged.plan.revision,
      operation: 'remove_actions',
      actionIds: [staged.plan.actions[0].id, 'missing-action'],
    })

    expect(result).toMatchObject({
      ok: false,
      code: 'edit_failed',
      failures: [{
        actionIndex: 1,
        actionId: 'missing-action',
        error: 'Unknown plan action: missing-action',
      }],
    })
    expect(JSON.stringify(useColonyStore.getState())).toBe(before)
  })

  it('honors an aborted execution before atomically replacing the plan', async () => {
    enterOperations()
    await registerMoonbaseTools()
    const state = useColonyStore.getState()
    const before = JSON.stringify(state)
    const controller = new AbortController()
    controller.abort()

    const result = await executeTool<{ ok: boolean; code: string }>(
      'stage_operations_plan',
      {
        expectedRunId: state.runId,
        expectedWorldRevision: state.worldRevision,
        expectedPlanRevision: state.operationsPlan.revision,
        mode: 'replace',
        assignments: [goldenAssignments[0]],
      },
      controller.signal,
    )

    expect(result).toMatchObject({ ok: false, code: 'cancelled' })
    expect(JSON.stringify(useColonyStore.getState())).toBe(before)
  })

  it('honors cancellation before a workflow-recording inspection mutates evidence', async () => {
    enterOperations()
    await registerMoonbaseTools()
    const state = useColonyStore.getState()
    const before = JSON.stringify(state)
    const controller = new AbortController()
    controller.abort()

    const result = await executeTool<{ ok: boolean; code: string }>(
      'inspect_moonbase',
      { expectedRunId: state.runId, focus: 'cancelled inspection' },
      controller.signal,
    )

    expect(result).toMatchObject({ ok: false, code: 'cancelled' })
    expect(JSON.stringify(useColonyStore.getState())).toBe(before)
  })
})
