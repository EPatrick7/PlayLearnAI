import { beforeEach, describe, expect, it } from 'vitest'
import {
  paintBoundaryCell,
  placeWorkstation,
} from './construction'
import { deriveConstructionOrders } from './constructionJobs'
import { isConstructionCellWalkable } from './constructionPathfinding'
import { createInitialState, MOONBASE_SEED } from './seed'
import {
  advanceSimulation,
  commitOperationsPlan,
  recordLearningEvidence,
  removePlanAction,
  setPlanBrief,
  stagePlanAction,
  validateOperationsPlan,
  verifyOperationsPlan,
} from './simulation'
import { useColonyStore } from './store'
import type { MoonbaseState, PlanActionInput } from './types'

const brief = {
  objective: 'restore_lab_and_research_sintering' as const,
  constraints: { oxygenFloorHours: 12, protectedCrewIds: ['crew-jonah-reed'] },
  horizonHours: 12,
  stopCondition: { kind: 'objective_complete' as const },
}

const coreActions: PlanActionInput[] = [
  { kind: 'assign_crew', crewId: 'crew-mateo-alvarez', workOrderId: 'work-seal-lab' },
  { kind: 'reserve_equipment', equipmentId: 'equipment-eva-01', workOrderId: 'work-seal-lab' },
  { kind: 'reserve_equipment', equipmentId: 'equipment-engineering-01', workOrderId: 'work-seal-lab' },
  { kind: 'assign_crew', crewId: 'crew-soo-jin-park', workOrderId: 'work-repressurize-lab' },
  { kind: 'reserve_equipment', equipmentId: 'equipment-engineering-02', workOrderId: 'work-repressurize-lab' },
  { kind: 'assign_crew', crewId: 'crew-leila-haddad', workOrderId: 'work-research-sintering' },
]

const dustActions: PlanActionInput[] = [
  { kind: 'assign_crew', crewId: 'crew-nia-kimani', workOrderId: 'work-clean-solar' },
  { kind: 'reserve_equipment', equipmentId: 'equipment-eva-02', workOrderId: 'work-clean-solar' },
  { kind: 'reserve_equipment', equipmentId: 'equipment-rover-01', workOrderId: 'work-clean-solar' },
]

const stage = (source: MoonbaseState, actions: PlanActionInput[]) =>
  actions.reduce((state, action) => stagePlanAction(state, action, 'agent')[0], source)

const makePlan = (includeDustMitigation = true) => {
  let state = createInitialState()
  state = setPlanBrief(state, brief, 'agent')[0]
  return stage(state, includeDustMitigation ? [...coreActions, ...dustActions] : coreActions)
}

const assignActiveConstruction = (source: MoonbaseState, crewId: string) => {
  const [order] = deriveConstructionOrders(
    source.settlement.layout,
    paintBoundaryCell(source.settlement.layout, { x: 12, y: 9 }, 'wall'),
    { commandId: 'active-wall', sequenceStart: source.settlement.constructionSequence },
  )
  return {
    ...source,
    settlement: {
      ...source.settlement,
      constructionOrders: [{
        ...order,
        status: 'building' as const,
        assignedCrewId: crewId,
        travelPhase: 'to_site' as const,
      }],
    },
  }
}

describe('Moonbase domain seed', () => {
  it('resets to the same six-crew lunar incident every time', () => {
    const first = createInitialState()
    const second = createInitialState()

    expect(first).toEqual(second)
    expect(first.seed).toBe(MOONBASE_SEED)
    expect(first.crew).toHaveLength(6)
    expect(first.modules).toHaveLength(8)
    expect(first.map).toEqual({ width: 24, height: 18 })
    expect(first.workOrders.map((order) => order.id)).toEqual([
      'work-seal-lab',
      'work-repressurize-lab',
      'work-research-sintering',
      'work-clean-solar',
    ])
  })

  it('starts with a breached vacuum lab, a dust deadline, and six physical equipment objects', () => {
    const state = createInitialState()

    expect(state.lab).toMatchObject({ atmosphere: 'no', breached: true, sealed: false })
    expect(state.dust).toMatchObject({ startsAtHour: 3, active: false, mitigated: false })
    expect(state.equipment).toHaveLength(6)
    expect(state.equipment.every((item) => item.location && item.reservedForWorkOrderId === null)).toBe(true)
    expect(state.workOrders.find((order) => order.id === 'work-repressurize-lab')?.prerequisiteIds).toEqual([
      'work-seal-lab',
    ])
    expect(state.workOrders.find((order) => order.id === 'work-research-sintering')?.prerequisiteIds).toEqual([
      'work-repressurize-lab',
    ])
  })
})

describe('Operations Plan staging and validation', () => {
  it('keeps plan edits staged and revisioned without changing the world', () => {
    const initial = createInitialState()
    const [briefed] = setPlanBrief(initial, brief)
    const [staged, stagedResult] = stagePlanAction(briefed, coreActions[0])

    expect(staged.worldRevision).toBe(initial.worldRevision)
    expect(staged.operationsPlan.revision).toBe(initial.operationsPlan.revision + 2)
    expect(stagedResult.actionId).toBeDefined()
    expect(staged.crew.find((member) => member.id === 'crew-mateo-alvarez')?.taskId).toBeNull()

    const [edited, removeResult] = removePlanAction(staged, stagedResult.actionId!)
    expect(removeResult.ok).toBe(true)
    expect(edited.operationsPlan.actions).toHaveLength(0)
    expect(edited.operationsPlan.revision).toBe(staged.operationsPlan.revision + 1)
  })

  it('rejects a superficially complete recovery plan that ignores the dust-driven power loss', () => {
    const state = makePlan(false)
    const validation = validateOperationsPlan(state)

    expect(validation.valid).toBe(false)
    expect(validation.preview.estimatedCompletionHours).toBe(10)
    expect(validation.preview.projectedBatteryKwh).toBe(0)
    expect(validation.issues).toContainEqual(
      expect.objectContaining({ code: 'power_projection', severity: 'error', targetId: 'work-clean-solar' }),
    )
  })

  it('previews a safe, complete parallel response when crew and equipment are explicit', () => {
    const state = makePlan()
    const validation = validateOperationsPlan(state)

    expect(validation.valid).toBe(true)
    expect(validation.issues.filter((issue) => issue.severity === 'error')).toHaveLength(0)
    expect(validation.preview).toMatchObject({
      estimatedCompletionHours: 10,
      projectedOxygenHours: expect.any(Number),
      projectedBatteryKwh: expect.any(Number),
    })
    expect(validation.preview.projectedOxygenHours).toBeGreaterThanOrEqual(12)
    expect(validation.preview.projectedBatteryKwh).toBeGreaterThan(0)
  })

  it('rejects incident assignment of a colonist already claimed by active construction', () => {
    const planned = makePlan()
    expect(validateOperationsPlan(planned).valid).toBe(true)

    const conflicted = assignActiveConstruction(planned, 'crew-mateo-alvarez')
    const validation = validateOperationsPlan(conflicted)
    const conflict = validation.issues.find((candidate) => (
      candidate.code === 'crew_conflict' && candidate.targetId === 'crew-mateo-alvarez'
    ))

    expect(validation.valid).toBe(false)
    expect(conflict).toMatchObject({
      severity: 'error',
      message: 'Mateo Alvarez is already assigned to wall blueprint at tile 13, 10. Finish or cancel that construction order before assigning incident work.',
    })
  })

  it('atomically refuses commit when construction claims a staged colonist', () => {
    const planned = makePlan()
    const conflicted = assignActiveConstruction(planned, 'crew-mateo-alvarez')
    const sourceSnapshot = structuredClone(conflicted)
    const [unchanged, result] = commitOperationsPlan(
      conflicted,
      conflicted.worldRevision,
      conflicted.operationsPlan.revision,
      'agent',
    )

    expect(result).toMatchObject({ ok: false, code: 'invalid_plan' })
    expect(result.validation.issues).toContainEqual(expect.objectContaining({
      code: 'crew_conflict',
      targetId: 'crew-mateo-alvarez',
    }))
    expect(unchanged.operationsPlan.status).toBe('draft')
    expect(unchanged.workOrders.find((order) => order.id === 'work-seal-lab')?.assignedCrewIds)
      .toEqual([])
    expect(unchanged.settlement.constructionOrders[0].assignedCrewId)
      .toBe('crew-mateo-alvarez')
    expect(conflicted).toEqual(sourceSnapshot)
  })

  it('fails stale world and plan revision commits cleanly', () => {
    const state = makePlan()
    const stalePlan = commitOperationsPlan(
      state,
      state.worldRevision,
      state.operationsPlan.revision - 1,
      'agent',
    )[1]
    expect(stalePlan).toMatchObject({ ok: false, code: 'stale_plan' })

    const [changedWorld] = advanceSimulation(state, 1)
    const staleWorld = commitOperationsPlan(
      changedWorld,
      changedWorld.worldRevision,
      changedWorld.operationsPlan.revision,
      'agent',
    )[1]
    expect(staleWorld).toMatchObject({ ok: false, code: 'stale_world' })
    expect(changedWorld.operationsPlan.basedOnWorldRevision).not.toBe(changedWorld.worldRevision)
  })
})

describe('committed Moonbase simulation', () => {
  const commitGoldenPlan = () => {
    const state = makePlan()
    const [committed, result] = commitOperationsPlan(
      state,
      state.worldRevision,
      state.operationsPlan.revision,
      'agent',
    )
    expect(result.ok).toBe(true)
    return committed
  }

  it('atomically assigns crew and reserves equipment without teleporting it', () => {
    const state = makePlan()
    const roverBefore = state.equipment.find((item) => item.id === 'equipment-rover-01')!
    const committed = commitGoldenPlan()
    const roverAfter = committed.equipment.find((item) => item.id === roverBefore.id)!

    expect(committed.operationsPlan.status).toBe('committed')
    expect(committed.operationsPlan.baseline?.worldRevision).toBe(committed.worldRevision)
    expect(committed.lab).toMatchObject({ atmosphere: 'no', breached: true })
    expect(roverAfter).toMatchObject({
      location: roverBefore.location,
      status: 'reserved',
      reservedForWorkOrderId: 'work-clean-solar',
    })
    expect(committed.crew.find((member) => member.id === 'crew-nia-kimani')).toMatchObject({
      status: 'assigned',
      taskId: 'work-clean-solar',
    })
  })

  it('executes retrieval, sealing, repressurization, research, and dust mitigation deterministically', () => {
    const committed = commitGoldenPlan()
    const [finished, result] = advanceSimulation(committed, { hours: 99 }, 'agent')

    expect(result.boundedHours).toBe(12)
    expect(result.advancedHours).toBe(10)
    expect(result.stopReason).toBe('objective_complete')
    expect(result.completedWorkOrderIds).toEqual([
      'work-seal-lab',
      'work-clean-solar',
      'work-repressurize-lab',
      'work-research-sintering',
    ])
    expect(finished.lab).toEqual({
      moduleId: 'module-laboratory',
      atmosphere: 'yes',
      breached: false,
      sealed: true,
    })
    expect(finished.dust).toMatchObject({ active: true, mitigated: true })
    expect(finished.research).toMatchObject({
      status: 'complete',
      progressHours: 3,
      unlocks: ['production-microwave-sintering'],
    })
    expect(finished.scenarioStatus).toBe('objective_complete')
    expect(finished.reserves.minimumOxygenHours).toBeGreaterThanOrEqual(12)
    expect(finished.power.status).not.toBe('critical')
    expect(finished.power).toMatchObject({ demandKw: 18, status: 'surplus' })

    const rover = finished.equipment.find((item) => item.id === 'equipment-rover-01')!
    expect(rover).toMatchObject({ location: 'solar-skid', status: 'available', reservedForWorkOrderId: null })

    const [unchanged, repeatedAdvance] = advanceSimulation(finished, { hours: 4 }, 'agent')
    expect(repeatedAdvance).toMatchObject({ advancedHours: 0, stopReason: 'objective_complete' })
    expect(unchanged.elapsedHours).toBe(finished.elapsedHours)
  })

  it('stops before a committed oxygen floor would be crossed', () => {
    const committed = commitGoldenPlan()
    committed.reserves.oxygenHours = 12.5
    committed.reserves.minimumOxygenHours = 12.5
    const [stopped, result] = advanceSimulation(committed, { hours: 4 }, 'agent')

    expect(result).toMatchObject({ advancedHours: 0, stopped: true, stopReason: 'oxygen_floor' })
    expect(stopped.reserves.oxygenHours).toBe(12.5)
    expect(stopped.elapsedHours).toBe(committed.elapsedHours)
  })

  it('verifies the actual outcome and records the full Ground → Plan → Supervise → Verify loop', () => {
    let state = recordLearningEvidence(
      createInitialState(),
      'ground',
      'Inspected the breach, oxygen leak, dust forecast, crew, and equipment locations.',
      'agent',
    )
    state = setPlanBrief(state, brief, 'agent')[0]
    state = stage(state, [...coreActions, ...dustActions])
    state = commitOperationsPlan(state, state.worldRevision, state.operationsPlan.revision, 'agent')[0]
    state = advanceSimulation(state, { hours: 12 }, 'agent')[0]
    const [verified, result] = verifyOperationsPlan(state, 'agent')

    expect(result.status).toBe('success')
    expect(result.checks.every((check) => check.passed)).toBe(true)
    expect(result.residualRisks).toHaveLength(0)
    expect(verified.learning.completedLoops).toBe(1)
    expect(verified.learning.achieved).toEqual({ ground: true, plan: true, supervise: true, verify: true })
    expect(verified.events[0]).toMatchObject({ phase: 'verified', actor: 'agent' })
  })
})

describe('Moonbase Zustand store', () => {
  beforeEach(() => useColonyStore.getState().resetColony())

  it('exposes the same revisioned commands and performs a deterministic reset', () => {
    const initial = useColonyStore.getState()
    const edit = initial.setPlanBrief(brief)

    expect(edit.ok).toBe(true)
    expect(useColonyStore.getState().operationsPlan.revision).toBe(2)
    useColonyStore.getState().resetMoonbase()
    const reset = useColonyStore.getState()
    expect(reset.seed).toBe(MOONBASE_SEED)
    expect(reset.worldRevision).toBe(1)
    expect(reset.operationsPlan.revision).toBe(1)
    expect(reset.operationsPlan.actions).toHaveLength(0)
    expect(typeof reset.commitPlan).toBe('function')
  })

  it('drives the same golden path through the public store action contract', () => {
    useColonyStore.getState().recordLearningEvidence('ground', 'Inspected live Moonbase telemetry.', 'agent')
    expect(useColonyStore.getState().setPlanBrief(brief, 'agent').ok).toBe(true)
    for (const action of [...coreActions, ...dustActions]) {
      expect(useColonyStore.getState().stagePlanAction(action, 'agent').ok).toBe(true)
    }

    const staged = useColonyStore.getState()
    expect(staged.validatePlan().valid).toBe(true)
    expect(staged.commitPlan(staged.worldRevision, staged.operationsPlan.revision, 'agent').ok).toBe(true)
    const advance = useColonyStore.getState().advanceTime({ hours: 12 }, 'agent')
    const verification = useColonyStore.getState().verifyPlan('agent')

    expect(advance).toMatchObject({ advancedHours: 10, stopReason: 'objective_complete' })
    expect(verification.status).toBe('success')
    expect(useColonyStore.getState().learning.completedLoops).toBe(1)
  })

  it('never dispatches a resting colonist to a construction order', () => {
    const initial = useColonyStore.getState()
    useColonyStore.setState({
      crew: initial.crew.map((member) => member.id === 'crew-mateo-alvarez'
        ? { ...member, status: 'resting' as const }
        : member),
    })
    const queued = useColonyStore.getState().queueConstruction(
      paintBoundaryCell(initial.settlement.layout, { x: 12, y: 9 }, 'wall'),
    )

    expect(queued.ok).toBe(true)
    useColonyStore.getState().advanceConstruction(0.25)
    expect(useColonyStore.getState().settlement.constructionOrders[0].assignedCrewId)
      .toBe('crew-amina-okafor')
  })

  it('never self-completes a blueprint when every builder is unavailable', () => {
    const target = { x: 12, y: 9 }
    const initial = useColonyStore.getState()
    useColonyStore.setState({
      crew: initial.crew.map((member) => ({ ...member, status: 'resting' as const })),
    })
    const queued = useColonyStore.getState().queueConstruction(
      paintBoundaryCell(initial.settlement.layout, target, 'wall'),
    )

    expect(queued.ok).toBe(true)
    const summary = useColonyStore.getState().advanceConstruction(100)
    const state = useColonyStore.getState()
    expect(summary.completedOrderIds).toEqual([])
    expect(state.settlement.constructionOrders[0]).toMatchObject({
      assignedCrewId: null,
      work: { completed: 0 },
    })
    expect(state.settlement.layout.boundaries).not.toContainEqual({ ...target, kind: 'wall' })
  })

  it('keeps crew assigned to a non-complete work order out of construction dispatch', () => {
    const initial = useColonyStore.getState()
    useColonyStore.setState({
      crew: initial.crew.map((member) => member.id === 'crew-mateo-alvarez'
        ? { ...member, status: 'idle' as const, taskId: null }
        : member),
      workOrders: initial.workOrders.map((order) => order.id === 'work-seal-lab'
        ? { ...order, assignedCrewIds: ['crew-mateo-alvarez'] }
        : order),
    })
    const queued = useColonyStore.getState().queueConstruction(
      paintBoundaryCell(initial.settlement.layout, { x: 12, y: 9 }, 'wall'),
    )

    expect(queued.ok).toBe(true)
    useColonyStore.getState().advanceConstruction(0.25)
    expect(useColonyStore.getState().settlement.constructionOrders[0].assignedCrewId)
      .toBe('crew-amina-okafor')
  })

  it('rejects construction over the material pallet instead of teleporting its stock', () => {
    const initial = useColonyStore.getState()
    const originalStockpile = { ...initial.settlement.constructionStockpile }
    const lifeSupport = placeWorkstation(initial.settlement.layout, {
      id: 'stockpile-overlap-life-support',
      type: 'life-support',
      label: 'Stockpile overlap life support',
      origin: originalStockpile,
      size: { width: 2, height: 2 },
      rotation: 0,
    })

    expect(lifeSupport.ok).toBe(true)
    const queued = useColonyStore.getState().queueConstruction(lifeSupport)
    expect(queued).toMatchObject({
      ok: false,
      orderIds: [],
      error: expect.stringContaining('construction pallet'),
    })

    const rejected = useColonyStore.getState()
    const workstation = rejected.settlement.layout.workstations.find(
      (candidate) => candidate.id === 'stockpile-overlap-life-support',
    )
    expect(workstation).toBeUndefined()
    expect(rejected.settlement.constructionOrders).toEqual([])
    expect(rejected.settlement.constructionStockpile).toEqual(originalStockpile)
    expect(isConstructionCellWalkable(
      rejected.settlement.layout,
      rejected.settlement.constructionStockpile,
    )).toBe(true)

    expect(rejected.queueConstruction(
      paintBoundaryCell(rejected.settlement.layout, { x: 12, y: 9 }, 'wall'),
    ).ok).toBe(true)
    rejected.advanceConstruction(0.25)
    expect(useColonyStore.getState().settlement.constructionOrders.at(-1)).toMatchObject({
      assignedCrewId: expect.any(String),
      block: null,
    })
  })
})
