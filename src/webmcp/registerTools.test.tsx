import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useColonyStore } from '../game/store'
import { useWebMcpTools } from './registerTools'

const expectedToolNames = [
  'inspect_moonbase',
  'query_crew_and_equipment',
  'inspect_operations_plan',
  'stage_operations_plan',
  'edit_operations_plan',
  'commit_operations_plan',
  'advance_until',
  'verify_operations_plan',
]

const goldenActions = [
  { kind: 'assign_crew', crewId: 'crew-mateo-alvarez', workOrderId: 'work-seal-lab' },
  { kind: 'reserve_equipment', equipmentId: 'equipment-eva-01', workOrderId: 'work-seal-lab' },
  { kind: 'reserve_equipment', equipmentId: 'equipment-engineering-01', workOrderId: 'work-seal-lab' },
  { kind: 'assign_crew', crewId: 'crew-soo-jin-park', workOrderId: 'work-repressurize-lab' },
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
    void options
    registeredTools.set(tool.name, tool)
  },
)

const installModelContext = () => {
  Object.defineProperty(document, 'modelContext', {
    configurable: true,
    value: { registerTool } as unknown as WebMCP.ModelContext,
  })
}

const executeTool = async <T,>(name: string, input: Record<string, unknown>): Promise<T> => {
  const tool = registeredTools.get(name)
  expect(tool, `${name} should have registered`).toBeDefined()

  const result = await tool!.execute(input, { signal: new AbortController().signal })
  expect(result).toMatchObject({ content: [{ type: 'text' }] })
  return JSON.parse((result as TextToolResult).content[0].text) as T
}

const registerMoonbaseTools = async () => {
  const hook = renderHook(() => useWebMcpTools())
  await waitFor(() => expect(hook.result.current).toBe('ready'))
  return hook
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
  it('registers exactly eight tools and drives the shared Zustand store through verified success', async () => {
    const hook = await registerMoonbaseTools()

    expect(registerTool).toHaveBeenCalledTimes(8)
    expect([...registeredTools.keys()]).toEqual(expectedToolNames)
    expect(
      registerTool.mock.calls.every(([, options]) => options?.signal instanceof AbortSignal),
    ).toBe(true)

    const inspection = await executeTool<{
      worldRevision: number
      operationsPlan: { revision: number; actionCount: number }
      laboratory: { atmosphere: string; breached: boolean }
      workflow: { phase: string }
    }>('inspect_moonbase', { focus: 'lab recovery, dust timing, crew, and equipment' })

    expect(inspection).toMatchObject({
      worldRevision: 1,
      operationsPlan: { revision: 1, actionCount: 0 },
      laboratory: { atmosphere: 'no', breached: true },
      workflow: { phase: 'plan' },
    })
    expect(useColonyStore.getState().learning.achieved.ground).toBe(true)

    const staged = await executeTool<{
      ok: boolean
      worldRevision: number
      plan: { revision: number; status: string; actions: unknown[] }
      validation: { valid: boolean; planRevision: number }
    }>('stage_operations_plan', {
      expectedWorldRevision: inspection.worldRevision,
      expectedPlanRevision: inspection.operationsPlan.revision,
      brief: {
        oxygenFloorHours: 12,
        protectedCrewIds: ['crew-jonah-reed'],
        horizonHours: 12,
        stopCondition: { kind: 'objective_complete' },
      },
      actions: goldenActions,
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

    const registrationSignals = registerTool.mock.calls.map(([, options]) => options?.signal)
    hook.unmount()
    expect(registrationSignals.every((signal) => signal?.aborted)).toBe(true)
  })

  it('rejects a stale plan revision without partially staging changes', async () => {
    await registerMoonbaseTools()
    const before = useColonyStore.getState()

    const result = await executeTool<{
      ok: boolean
      code: string
      currentWorldRevision: number
      currentPlanRevision: number
      next: string
    }>('stage_operations_plan', {
      expectedWorldRevision: before.worldRevision,
      expectedPlanRevision: before.operationsPlan.revision + 1,
      actions: [goldenActions[0]],
    })

    expect(result).toEqual({
      ok: false,
      code: 'stale_revision',
      currentWorldRevision: before.worldRevision,
      currentPlanRevision: before.operationsPlan.revision,
      next: 'Inspect the Operations Plan again before editing it.',
    })
    expect(useColonyStore.getState().operationsPlan).toEqual(before.operationsPlan)
    expect(useColonyStore.getState().crew).toEqual(before.crew)
  })
})
