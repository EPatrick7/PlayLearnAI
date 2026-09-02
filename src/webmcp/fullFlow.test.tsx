import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { offsetStarterPoint } from '../game/construction'
import { canBeginOperations } from '../game/settlement'
import { useColonyStore } from '../game/store'
import {
  LANDING_WEB_MCP_TOOL_NAMES,
  OPERATIONS_WEB_MCP_TOOL_NAMES,
  useWebMcpTools,
} from './registerTools'

interface Envelope {
  runId: string
  worldRevision: number
  settlementPhase: string
  next: string
}

interface MutationResult extends Envelope {
  ok: boolean
  code: string
}

interface ConstructionInspection extends Envelope {
  readyForFirstShift: boolean
  construction: {
    speed: number
    openOrderCount: number
    material: { stored: number; available: number }
  }
}

interface PlanInspection extends Envelope {
  plan: { revision: number; status: string; actions: Array<{ id: string }> }
  validation: { valid: boolean } | null
  review: { kind: 'draft' | 'supervising' | 'awaiting_verification' | 'verified' }
}

const registeredTools = new Map<string, WebMCP.ModelContextTool>()
const originalModelContextDescriptor = Object.getOwnPropertyDescriptor(document, 'modelContext')

// The browser host can omit the execution options or provide an empty object,
// despite webmcp-types currently declaring a required cancellation signal.
type HostExecute = (
  input: Record<string, unknown>,
  options?: Partial<WebMCP.ToolExecuteCallbackOptions> | null,
) => unknown

const executeCallback = async <T,>(
  tool: WebMCP.ModelContextTool,
  input: Record<string, unknown>,
  options?: Partial<WebMCP.ToolExecuteCallbackOptions> | null,
): Promise<T> => {
  let result: unknown
  await act(async () => {
    result = await (tool.execute as HostExecute)(input, options)
  })
  expect(result).toMatchObject({ content: [{ type: 'text' }] })
  const textResult = result as { content: Array<{ type: 'text'; text: string }> }
  return JSON.parse(textResult.content[0].text) as T
}

const executeTool = <T,>(
  name: string,
  input: Record<string, unknown>,
  options?: Partial<WebMCP.ToolExecuteCallbackOptions> | null,
) => {
  const tool = registeredTools.get(name)
  expect(tool, `${name} should be registered`).toBeDefined()
  return executeCallback<T>(tool!, input, options)
}

const expectedState = (state: Envelope) => ({
  expectedRunId: state.runId,
  expectedWorldRevision: state.worldRevision,
})

const starterPoint = (x: number, y: number) => offsetStarterPoint({ x, y })

const goldenActions = [
  { kind: 'assign_crew', crewId: 'crew-mateo-alvarez', workOrderId: 'work-seal-lab' },
  { kind: 'reserve_equipment', equipmentId: 'equipment-eva-01', workOrderId: 'work-seal-lab' },
  { kind: 'reserve_equipment', equipmentId: 'equipment-engineering-01', workOrderId: 'work-seal-lab' },
  { kind: 'assign_crew', crewId: 'crew-soo-jin-park', workOrderId: 'work-repressurize-lab' },
  { kind: 'reserve_equipment', equipmentId: 'equipment-eva-03', workOrderId: 'work-repressurize-lab' },
  { kind: 'reserve_equipment', equipmentId: 'equipment-engineering-02', workOrderId: 'work-repressurize-lab' },
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

beforeEach(() => {
  localStorage.clear()
  useColonyStore.getState().resetColony()
  registeredTools.clear()
  Object.defineProperty(document, 'modelContext', {
    configurable: true,
    value: {
      registerTool: async (
        tool: WebMCP.ModelContextTool,
        options?: WebMCP.ModelContextRegisterToolOptions,
      ) => {
        if (options?.signal?.aborted) return
        registeredTools.set(tool.name, tool)
        options?.signal?.addEventListener('abort', () => {
          if (registeredTools.get(tool.name) === tool) registeredTools.delete(tool.name)
        }, { once: true })
      },
    },
  })
})

afterEach(() => {
  cleanup()
  if (originalModelContextDescriptor) {
    Object.defineProperty(document, 'modelContext', originalModelContextDescriptor)
  } else {
    Reflect.deleteProperty(document, 'modelContext')
  }
})

describe('WebMCP first landing through verified operations', () => {
  it('builds with real workers, replaces the live catalog, and completes the plan without host signals', async () => {
    const hook = renderHook(() => useWebMcpTools())
    await waitFor(() => expect(hook.result.current).toBe('ready'))
    expect([...registeredTools.keys()]).toEqual([...LANDING_WEB_MCP_TOOL_NAMES])
    expect(registeredTools.size).toBe(4)

    const initial = await executeTool<ConstructionInspection>('inspect_construction', {})
    expect(initial).toMatchObject({
      settlementPhase: 'landing',
      readyForFirstShift: false,
      construction: { openOrderCount: 0, material: { stored: 30, available: 30 } },
    })
    const paused = await executeTool<MutationResult>('manage_construction', {
      ...expectedState(initial), action: 'set_speed', speed: 0,
    }, {})
    expect(paused).toMatchObject({ ok: true, code: 'speed_changed' })

    const cancelledBlueprint = await executeTool<MutationResult & { commandId: string }>(
      'place_construction_blueprint', {
        ...expectedState(paused),
        kind: 'wall',
        start: starterPoint(9, 6),
        end: starterPoint(9, 6),
      },
    )
    expect(cancelledBlueprint.ok).toBe(true)
    const prioritized = await executeTool<MutationResult>('manage_construction', {
      ...expectedState(cancelledBlueprint),
      action: 'set_command_priority', commandId: cancelledBlueprint.commandId, priority: 5,
    }, {})
    expect(prioritized).toMatchObject({ ok: true, code: 'priority_changed' })
    const pausedSnapshot = JSON.stringify(useColonyStore.getState())
    act(() => { useColonyStore.getState().advanceConstruction(1) })
    expect(JSON.stringify(useColonyStore.getState())).toBe(pausedSnapshot)

    const stale = await executeTool<MutationResult>('manage_construction', {
      ...expectedState(cancelledBlueprint),
      action: 'cancel_command', commandId: cancelledBlueprint.commandId,
    })
    expect(stale).toMatchObject({ ok: false, code: 'stale_world' })
    expect(JSON.stringify(useColonyStore.getState())).toBe(pausedSnapshot)
    let current = await executeTool<MutationResult>('manage_construction', {
      ...expectedState(prioritized),
      action: 'cancel_command', commandId: cancelledBlueprint.commandId,
    }, {})
    expect(current).toMatchObject({ ok: true, code: 'command_cancelled' })

    // Expand east from the real starter habitat. Ten boundary cells and the
    // four-material life support fit the untouched thirty-material stock.
    // The starter door becomes an interior door; starter-relative (8,7) remains an exterior exit.
    // Build that exit before closing the shell so crew always have an airlock.
    const blueprints = [
      { kind: 'wall', start: starterPoint(8, 7), end: starterPoint(11, 7) },
      { kind: 'door', start: starterPoint(8, 7), end: starterPoint(8, 7) },
      { kind: 'wall', start: starterPoint(11, 8), end: starterPoint(11, 9) },
      { kind: 'wall', start: starterPoint(8, 10), end: starterPoint(11, 10) },
      {
        kind: 'workstation', workstationType: 'life-support',
        workstationId: 'first-shift-life-support', origin: starterPoint(9, 8), rotation: 0,
      },
    ]
    for (const blueprint of blueprints) {
      current = await executeTool<MutationResult>('place_construction_blueprint', {
        ...expectedState(current), ...blueprint,
      }, {})
      expect(current, JSON.stringify(blueprint)).toMatchObject({ ok: true, code: 'queued' })
    }
    expect(useColonyStore.getState().settlement.layout.workstations).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'first-shift-life-support' })]),
    )
    const beforeCompletion = await executeTool<MutationResult>('begin_first_shift', expectedState(current))
    expect(beforeCompletion).toMatchObject({ ok: false, code: 'not_ready' })
    expect(registeredTools.size).toBe(4)

    current = await executeTool<MutationResult>('manage_construction', {
      ...expectedState(current), action: 'set_speed', speed: 1,
    })
    expect(current.ok).toBe(true)
    let constructionTicks = 0
    act(() => {
      // This is the same elapsed-time path used by the live build, without
      // timers or direct writes to layouts, stock, equipment, or readiness.
      while (!canBeginOperations(useColonyStore.getState()) && constructionTicks < 300) {
        useColonyStore.getState().advanceConstruction(1)
        constructionTicks += 1
      }
    })
    const ready = await executeTool<ConstructionInspection>('inspect_construction', {})
    expect(ready, JSON.stringify(ready))
      .toMatchObject({ readyForFirstShift: true, construction: { openOrderCount: 0 } })
    expect(constructionTicks).toBeGreaterThan(0)
    expect(constructionTicks).toBeLessThan(300)
    expect(useColonyStore.getState().settlement.layout.workstations).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'first-shift-life-support' })]),
    )
    expect(useColonyStore.getState().elapsedHours).toBe(0)

    const started = await executeTool<MutationResult>('begin_first_shift', expectedState(ready), {})
    expect(started).toMatchObject({ ok: true, code: 'operations_started', settlementPhase: 'operations' })
    await waitFor(() => {
      expect(hook.result.current).toBe('ready')
      expect([...registeredTools.keys()]).toEqual([...OPERATIONS_WEB_MCP_TOOL_NAMES])
    })
    expect(registeredTools.size).toBe(11)

    const inspected = await executeTool<Envelope>('inspect_moonbase', {
      expectedRunId: started.runId, focus: 'lab recovery and approaching dust',
    })
    const resources = await executeTool<Envelope & {
      crew: Array<{ id: string }>
      equipment: Array<{ id: string }>
    }>('query_crew_and_equipment', {
      expectedRunId: inspected.runId, workOrderId: 'work-seal-lab',
    }, {})
    expect(resources.crew).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'crew-mateo-alvarez' }),
    ]))
    expect(resources.equipment).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'equipment-eva-01' }),
    ]))
    const draft = await executeTool<PlanInspection>('inspect_operations_plan', {})
    const unstagedSnapshot = JSON.stringify(useColonyStore.getState())
    const rejectedStage = await executeTool<MutationResult>('stage_operations_plan', {
      ...expectedState(draft),
      expectedPlanRevision: draft.plan.revision + 1,
      assignments: goldenAssignments,
    }, {})
    expect(rejectedStage).toMatchObject({ ok: false, code: 'stale_revision' })
    expect(JSON.stringify(useColonyStore.getState())).toBe(unstagedSnapshot)

    const staged = await executeTool<MutationResult & PlanInspection>('stage_operations_plan', {
      ...expectedState(draft),
      expectedPlanRevision: draft.plan.revision,
      protectedCrewIds: ['crew-jonah-reed'],
      assignments: goldenAssignments,
    })
    expect(staged).toMatchObject({ ok: true, plan: { status: 'draft' }, validation: { valid: true } })
    expect(staged.plan.actions).toHaveLength(goldenActions.length)
    const removed = await executeTool<MutationResult & PlanInspection>('edit_operations_plan', {
      expectedRunId: staged.runId,
      expectedPlanRevision: staged.plan.revision,
      operation: 'remove_actions',
      actionIds: [staged.plan.actions[0].id],
    }, null)
    expect(removed).toMatchObject({ ok: true, plan: { status: 'draft' } })
    expect(removed.plan.actions).toHaveLength(goldenActions.length - 1)
    const rebased = await executeTool<MutationResult & PlanInspection>('edit_operations_plan', {
      expectedRunId: removed.runId,
      expectedPlanRevision: removed.plan.revision,
      operation: 'rebase',
    }, {})
    expect(rebased.ok).toBe(true)
    const restaged = await executeTool<MutationResult & PlanInspection>('stage_operations_plan', {
      ...expectedState(rebased),
      expectedPlanRevision: rebased.plan.revision,
      mode: 'replace',
      protectedCrewIds: ['crew-jonah-reed'],
      assignments: goldenAssignments,
    })
    expect(restaged).toMatchObject({ ok: true, validation: { valid: true } })
    const freshPlan = await executeTool<PlanInspection>('inspect_operations_plan', {}, {})
    const committed = await executeTool<MutationResult>('commit_operations_plan', {
      ...expectedState(freshPlan), expectedPlanRevision: freshPlan.plan.revision,
    }, {})
    expect(committed).toMatchObject({ ok: true, code: 'committed' })

    const advanced = await executeTool<MutationResult & {
      stopReason: string
      advancedHours: number
      state: { laboratory: { atmosphere: string }; research: { status: string } }
    }>('advance_until', { ...expectedState(committed), hours: 12 })
    expect(advanced).toMatchObject({
      ok: true,
      stopReason: 'objective_complete',
      state: { laboratory: { atmosphere: 'yes' }, research: { status: 'complete' } },
    })
    expect(advanced.advancedHours).toBeGreaterThan(0)
    expect(advanced.advancedHours).toBeLessThanOrEqual(12)
    const stoppedPlan = await executeTool<PlanInspection>('inspect_operations_plan', {})
    expect(stoppedPlan).toMatchObject({
      plan: { status: 'completed' },
      validation: null,
      review: { kind: 'awaiting_verification' },
    })
    expect(stoppedPlan.next).toContain('Verify it now')
    expect(JSON.stringify(stoppedPlan)).not.toContain('closed_work_order')
    const verified = await executeTool<MutationResult & {
      verification: { status: string; checks: Array<{ passed: boolean }>; residualRisks: string[] }
      workflow: { completedLoops: number }
    }>('verify_operations_plan', expectedState(advanced), {})
    expect(verified).toMatchObject({
      ok: true, verification: { status: 'success', residualRisks: [] }, workflow: { completedLoops: 1 },
    })
    expect(verified.verification.checks.every((check) => check.passed)).toBe(true)
    expect(useColonyStore.getState().verification?.status).toBe('success')

    const verifiedPlan = await executeTool<PlanInspection>('inspect_operations_plan', {})
    expect(verifiedPlan).toMatchObject({
      plan: { status: 'completed' },
      validation: null,
      review: { kind: 'verified' },
    })
    const cleared = await executeTool<MutationResult & PlanInspection>('edit_operations_plan', {
      expectedRunId: verifiedPlan.runId,
      expectedPlanRevision: verifiedPlan.plan.revision,
      operation: 'clear',
    }, null)
    expect(cleared).toMatchObject({ ok: true, plan: { status: 'draft', actions: [] } })

    const retainedVerification = registeredTools.get('verify_operations_plan')!
    act(() => { useColonyStore.getState().resetColony() })
    await waitFor(() => expect([...registeredTools.keys()]).toEqual([...LANDING_WEB_MCP_TOOL_NAMES]))
    expect(registeredTools.size).toBe(4)
    const resetSnapshot = JSON.stringify(useColonyStore.getState())
    const resetInspection = await executeTool<ConstructionInspection>('inspect_construction', {})
    expect(resetInspection.runId).not.toBe(verified.runId)
    const retainedResult = await executeCallback<MutationResult>(retainedVerification, {
      expectedRunId: verified.runId,
      expectedWorldRevision: resetInspection.worldRevision,
    }, {})
    expect(retainedResult).toMatchObject({ ok: false, code: 'stale_run', settlementPhase: 'landing' })
    expect(JSON.stringify(useColonyStore.getState())).toBe(resetSnapshot)

    hook.unmount()
    expect(registeredTools.size).toBe(0)
  }, 10000)
})
