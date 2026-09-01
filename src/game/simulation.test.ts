import { beforeEach, describe, expect, it } from 'vitest'
import {
  paintBoundaryCell,
  paintBoundaryLine,
  placeWorkstation,
  type ConstructionResult,
} from './construction'
import { deriveConstructionOrders } from './constructionJobs'
import { isConstructionCellWalkable } from './constructionPathfinding'
import { createInitialState, MOONBASE_SEED } from './seed'
import {
  advanceSimulation,
  clearOperationsPlan,
  commitOperationsPlan,
  deriveAlerts,
  recordLearningEvidence,
  rebaseOperationsPlan,
  removePlanAction,
  removePlanActionsBatch,
  setPlanBrief,
  stageOperationsPlanBatch,
  stagePlanAction,
  validateOperationsPlan,
  verifyOperationsPlan,
} from './simulation'
import { useColonyStore } from './store'
import type { MoonbaseState, PlanActionInput, WorkOrderId } from './types'

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
  { kind: 'reserve_equipment', equipmentId: 'equipment-eva-03', workOrderId: 'work-repressurize-lab' },
  { kind: 'reserve_equipment', equipmentId: 'equipment-engineering-02', workOrderId: 'work-repressurize-lab' },
  { kind: 'assign_crew', crewId: 'crew-leila-haddad', workOrderId: 'work-research-sintering' },
]

const dustActions: PlanActionInput[] = [
  { kind: 'assign_crew', crewId: 'crew-nia-kimani', workOrderId: 'work-clean-solar' },
  { kind: 'reserve_equipment', equipmentId: 'equipment-eva-02', workOrderId: 'work-clean-solar' },
  { kind: 'reserve_equipment', equipmentId: 'equipment-rover-01', workOrderId: 'work-clean-solar' },
]

const sealActions = coreActions.filter((action) => action.workOrderId === 'work-seal-lab')

const milestoneBrief = (workOrderId: WorkOrderId) => ({
  ...brief,
  stopCondition: { kind: 'work_order_complete' as const, workOrderId },
})

const stage = (source: MoonbaseState, actions: PlanActionInput[]) =>
  actions.reduce((state, action) => stagePlanAction(state, action, 'agent')[0], source)

const createOperationsState = (): MoonbaseState => {
  const state = createInitialState()
  return {
    ...state,
    settlement: { ...state.settlement, phase: 'operations' as const },
  }
}

const groundResponse = (source: MoonbaseState) => {
  const telemetry = recordLearningEvidence(
    source,
    'ground',
    'Inspected incident telemetry and dependencies.',
    'agent',
    { groundingKind: 'incident_telemetry' },
  )
  return recordLearningEvidence(
    telemetry,
    'ground',
    'Compared crew and localized equipment.',
    'agent',
    { groundingKind: 'crew_equipment_comparison' },
  )
}

const makePlan = (includeDustMitigation = true) => {
  let state = createOperationsState()
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

const openStoreOperations = () => {
  const current = useColonyStore.getState()
  useColonyStore.setState({
    settlement: { ...current.settlement, phase: 'operations' },
  })
}

describe('Moonbase domain seed', () => {
  it('resets to the same six-crew lunar incident every time', () => {
    const first = createInitialState()
    const second = createInitialState()

    expect(first).toEqual({ ...second, runId: first.runId })
    expect(first.runId).not.toBe(second.runId)
    expect(first.runId).not.toContain(String(first.seed))
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
    expect(state.equipment).toHaveLength(7)
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
  it('applies a complete brief and action batch to one isolated candidate', () => {
    const initial = createOperationsState()
    const initialSnapshot = structuredClone(initial)
    const [staged, result] = stageOperationsPlanBatch(initial, {
      expectedRunId: initial.runId,
      expectedWorldRevision: initial.worldRevision,
      expectedPlanRevision: initial.operationsPlan.revision,
      mode: 'replace',
      brief,
      actions: coreActions,
    }, 'agent')

    expect(result).toMatchObject({
      ok: true,
      code: 'staged',
      worldRevision: initial.worldRevision,
      editResults: coreActions.map((_, actionIndex) => ({ ok: true, actionIndex })),
    })
    expect(staged.operationsPlan).toMatchObject({
      status: 'draft',
      objective: brief.objective,
      actions: expect.arrayContaining(coreActions.map((action) => expect.objectContaining(action))),
    })
    expect(staged.operationsPlan.revision).toBe(
      initial.operationsPlan.revision + 2 + coreActions.length,
    )
    expect(initial).toEqual(initialSnapshot)
  })

  it('returns the byte-for-byte source when any batch edit fails', () => {
    const planned = makePlan()
    const committed = {
      ...planned,
      operationsPlan: { ...planned.operationsPlan, status: 'committed' as const },
    }
    const snapshot = structuredClone(committed)
    const [unchanged, result] = stageOperationsPlanBatch(committed, {
      expectedRunId: committed.runId,
      expectedWorldRevision: committed.worldRevision,
      expectedPlanRevision: committed.operationsPlan.revision,
      brief,
      actions: [coreActions[0]],
    }, 'agent')

    expect(result).toMatchObject({
      ok: false,
      code: 'edit_failed',
      failedStage: 'brief',
      error: expect.stringContaining('already committed'),
    })
    expect(unchanged).toBe(committed)
    expect(unchanged).toEqual(snapshot)
  })

  it('removes multiple draft actions atomically', () => {
    const initial = createOperationsState()
    const planned = stage(initial, coreActions.slice(0, 2))
    const [firstAction, secondAction] = planned.operationsPlan.actions
    const snapshot = structuredClone(planned)

    const [unchanged, rejected] = removePlanActionsBatch(planned, {
      expectedRunId: planned.runId,
      expectedPlanRevision: planned.operationsPlan.revision,
      actionIds: [firstAction.id, 'missing-action'],
    }, 'agent')

    expect(rejected).toMatchObject({
      ok: false,
      code: 'edit_failed',
      failures: [{
        actionIndex: 1,
        actionId: 'missing-action',
        error: 'Unknown plan action: missing-action',
      }],
    })
    expect(unchanged).toBe(planned)
    expect(unchanged).toEqual(snapshot)

    const [removed, accepted] = removePlanActionsBatch(planned, {
      expectedRunId: planned.runId,
      expectedPlanRevision: planned.operationsPlan.revision,
      actionIds: [firstAction.id, secondAction.id],
    }, 'agent')

    expect(accepted).toMatchObject({
      ok: true,
      code: 'removed',
      planRevision: planned.operationsPlan.revision + 2,
    })
    expect(accepted.editResults).toHaveLength(2)
    expect(removed.operationsPlan.actions).toHaveLength(0)
    expect(planned).toEqual(snapshot)
  })

  it('keeps plan edits staged and revisioned without changing the world', () => {
    const initial = createOperationsState()
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

  it('rejects an unknown runtime stop kind instead of treating it as valid', () => {
    const state = makePlan()
    const malformed: MoonbaseState = {
      ...state,
      operationsPlan: {
        ...state.operationsPlan,
        stopCondition: { kind: '' } as unknown as MoonbaseState['operationsPlan']['stopCondition'],
      },
    }

    expect(validateOperationsPlan(malformed)).toMatchObject({
      valid: false,
      issues: expect.arrayContaining([
        expect.objectContaining({ code: 'missing_stop_condition', severity: 'error' }),
      ]),
    })
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

  it('transactionally stages and forecasts a bounded first milestone instead of the whole objective', () => {
    const initial = createOperationsState()
    const [planned, batch] = stageOperationsPlanBatch(initial, {
      expectedRunId: initial.runId,
      expectedWorldRevision: initial.worldRevision,
      expectedPlanRevision: initial.operationsPlan.revision,
      brief: { ...milestoneBrief('work-seal-lab'), horizonHours: 3 },
      actions: [...sealActions, ...dustActions],
    }, 'agent')
    const validation = validateOperationsPlan(planned)

    expect(batch).toMatchObject({ ok: true, code: 'staged' })
    expect(validation.valid).toBe(true)
    expect(validation.preview).toMatchObject({
      estimatedCompletionHours: 3,
      projectedOxygenHours: expect.any(Number),
      projectedBatteryKwh: expect.any(Number),
    })
    expect(validation.issues).not.toContainEqual(expect.objectContaining({
      code: 'missing_crew',
      targetId: 'work-repressurize-lab',
    }))
    expect(validation.issues).not.toContainEqual(expect.objectContaining({
      code: 'missing_crew',
      targetId: 'work-research-sintering',
    }))
  })

  it('rejects unreachable prerequisites and objective work staged after the declared milestone', () => {
    const initial = createOperationsState()
    const [laterOnly] = stageOperationsPlanBatch(initial, {
      expectedRunId: initial.runId,
      expectedWorldRevision: initial.worldRevision,
      expectedPlanRevision: initial.operationsPlan.revision,
      brief: milestoneBrief('work-repressurize-lab'),
      actions: [{
        kind: 'assign_crew',
        crewId: 'crew-leila-haddad',
        workOrderId: 'work-research-sintering',
      }],
    }, 'agent')
    const laterOnlyValidation = validateOperationsPlan(laterOnly)

    expect(laterOnlyValidation.valid).toBe(false)
    expect(laterOnlyValidation.issues).toContainEqual(expect.objectContaining({
      code: 'milestone_scope',
      targetId: 'work-research-sintering',
    }))
    expect(laterOnlyValidation.issues).toContainEqual(expect.objectContaining({
      code: 'missing_crew',
      targetId: 'work-seal-lab',
    }))
    expect(laterOnlyValidation.issues).toContainEqual(expect.objectContaining({
      code: 'missing_crew',
      targetId: 'work-repressurize-lab',
    }))

    const [unreachableResearch] = stageOperationsPlanBatch(initial, {
      expectedRunId: initial.runId,
      expectedWorldRevision: initial.worldRevision,
      expectedPlanRevision: initial.operationsPlan.revision,
      brief: milestoneBrief('work-research-sintering'),
      actions: [{
        kind: 'assign_crew',
        crewId: 'crew-leila-haddad',
        workOrderId: 'work-research-sintering',
      }],
    }, 'agent')
    const unreachableValidation = validateOperationsPlan(unreachableResearch)

    expect(unreachableValidation.valid).toBe(false)
    expect(unreachableValidation.preview.estimatedCompletionHours).toBeNull()
    expect(unreachableValidation.issues).toContainEqual(expect.objectContaining({
      code: 'missing_crew',
      targetId: 'work-seal-lab',
    }))
    expect(unreachableValidation.issues).toContainEqual(expect.objectContaining({
      code: 'missing_crew',
      targetId: 'work-repressurize-lab',
    }))
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

  it('does not reserve an EVA suit while a construction worker is wearing it', () => {
    const planned = makePlan()
    const conflicted: MoonbaseState = {
      ...planned,
      crew: planned.crew.map((member) => member.id === 'crew-amina-okafor'
        ? { ...member, equippedEvaSuitId: 'equipment-eva-01' }
        : member),
      equipment: planned.equipment.map((item) => item.id === 'equipment-eva-01'
        ? {
            ...item,
            status: 'deployed',
            assignedCrewId: 'crew-amina-okafor',
            reservedForWorkOrderId: null,
          }
        : item),
    }

    expect(validateOperationsPlan(conflicted).issues).toContainEqual(
      expect.objectContaining({
        code: 'equipment_conflict',
        targetId: 'equipment-eva-01',
        message: expect.stringContaining('construction EVA'),
      }),
    )
  })

  it('reserves a manually prioritized colonist even while the live construction claim waits', () => {
    const planned = makePlan()
    const active = assignActiveConstruction(planned, 'crew-mateo-alvarez')
    const forcedWaiting = {
      ...active,
      settlement: {
        ...active.settlement,
        constructionOrders: active.settlement.constructionOrders.map((order) => ({
          ...order,
          assignedCrewId: null,
          forcedCrewId: 'crew-mateo-alvarez',
          travelPhase: 'idle' as const,
        })),
      },
    }

    expect(validateOperationsPlan(forcedWaiting).issues).toContainEqual(
      expect.objectContaining({
        code: 'crew_conflict',
        targetId: 'crew-mateo-alvarez',
      }),
    )

    const automatic = {
      ...forcedWaiting,
      settlement: {
        ...forcedWaiting.settlement,
        constructionOrders: forcedWaiting.settlement.constructionOrders.map((order) => ({
          ...order,
          forcedCrewId: null,
        })),
      },
    }
    expect(validateOperationsPlan(automatic).valid).toBe(true)
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

describe('Operations phase integrity', () => {
  it('keeps plan and simulation commands inert until operations begin', () => {
    const landing = createInitialState()
    const snapshot = structuredClone(landing)
    const guardedEdits = [
      setPlanBrief(landing, brief, 'agent'),
      stagePlanAction(landing, coreActions[0], 'agent'),
      removePlanAction(landing, 'plan-action-001', 'agent'),
      rebaseOperationsPlan(landing, 'agent'),
      clearOperationsPlan(landing, 'agent'),
    ]

    for (const [returnedState, result] of guardedEdits) {
      expect(returnedState).toBe(landing)
      expect(result).toMatchObject({
        ok: false,
        planRevision: landing.operationsPlan.revision,
        error: expect.stringContaining('begin operations'),
      })
    }

    const validation = validateOperationsPlan(landing)
    expect(validation.valid).toBe(false)
    expect(validation.issues).toContainEqual(expect.objectContaining({
      code: 'operations_not_ready',
      severity: 'error',
    }))

    const [commitState, commit] = commitOperationsPlan(
      landing,
      landing.worldRevision,
      landing.operationsPlan.revision,
      'agent',
    )
    expect(commitState).toBe(landing)
    expect(commit).toMatchObject({ ok: false, code: 'invalid_plan' })
    expect(commit.validation.issues).toContainEqual(expect.objectContaining({ code: 'operations_not_ready' }))

    const [advanceState, advance] = advanceSimulation(landing, { hours: 4 }, 'agent')
    expect(advanceState).toBe(landing)
    expect(advance).toMatchObject({
      advancedHours: 0,
      stopped: true,
      stopReason: 'operations_not_ready',
      worldRevision: landing.worldRevision,
    })

    const [verificationState, verification] = verifyOperationsPlan(landing, 'agent')
    expect(verificationState).toBe(landing)
    expect(verification.status).toBe('not_ready')
    expect(landing).toEqual(snapshot)
  })

  it('does not award verification evidence before a supervised advance', () => {
    const planned = makePlan()
    const [committed, commit] = commitOperationsPlan(
      planned,
      planned.worldRevision,
      planned.operationsPlan.revision,
      'agent',
    )
    expect(commit.ok).toBe(true)
    const snapshot = structuredClone(committed)

    const [unchanged, verification] = verifyOperationsPlan(committed, 'agent')

    expect(verification.status).toBe('not_ready')
    expect(unchanged).toBe(committed)
    expect(committed).toEqual(snapshot)
    expect(unchanged.verification).toBeNull()
    expect(unchanged.learning.achieved.verify).toBe(false)
    expect(unchanged.learning.evidence).toEqual(snapshot.learning.evidence)
    expect(unchanged.events).toEqual(snapshot.events)
  })
})

describe('committed Moonbase simulation', () => {
  const commitGoldenPlan = () => {
    let state = groundResponse(createOperationsState())
    state = setPlanBrief(state, brief, 'agent')[0]
    state = stage(state, [...coreActions, ...dustActions])
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
    expect(rover).toMatchObject({ location: 'airlock', status: 'available', reservedForWorkOrderId: null })
    expect(finished.crew.filter((member) => member.equippedEvaSuitId)).toEqual([])

    const [unchanged, repeatedAdvance] = advanceSimulation(finished, { hours: 4 }, 'agent')
    expect(repeatedAdvance).toMatchObject({ advancedHours: 0, stopReason: 'objective_complete' })
    expect(unchanged.elapsedHours).toBe(finished.elapsedHours)
  })

  it('seals an EVA suit before vacuum work and returns crew through the airlock before doffing', () => {
    const committed = commitGoldenPlan()
    const [arrived, arrival] = advanceSimulation(committed, { hours: 1 }, 'agent')
    const mateoAtBreach = arrived.crew.find((member) => member.id === 'crew-mateo-alvarez')!

    expect(arrival.advancedHours).toBe(1)
    expect(mateoAtBreach).toMatchObject({
      location: 'laboratory',
      equippedEvaSuitId: 'equipment-eva-01',
      taskId: 'work-seal-lab',
    })
    expect(arrived.events.some((event) => event.message.includes(
      'crossed the pressure boundary in EVA suits',
    ))).toBe(true)

    const [sealed] = advanceSimulation(arrived, { hours: 2 }, 'agent')
    const mateoSafe = sealed.crew.find((member) => member.id === 'crew-mateo-alvarez')!
    expect(mateoSafe).toMatchObject({
      location: 'airlock',
      equippedEvaSuitId: null,
      taskId: null,
    })
    expect(sealed.events.some((event) => event.message.includes(
      'returned through South Airlock and doffed EVA gear',
    ))).toBe(true)
  })

  it('keeps Supervise active at a one-hour checkpoint until a declared stop is reached', () => {
    const committed = commitGoldenPlan()

    const [checkpoint, firstAdvance] = advanceSimulation(committed, { hours: 1 }, 'agent')
    expect(firstAdvance).toMatchObject({ advancedHours: 1, stopped: false, stopReason: null })
    expect(checkpoint.learning).toMatchObject({
      currentPhase: 'supervise',
      achieved: { ground: true, plan: true, supervise: false, verify: false },
      coaching: expect.stringContaining('Inspect what changed'),
    })
    expect(checkpoint.learning.evidence[0]).toMatchObject({
      phase: 'supervise',
      detail: expect.stringContaining('checkpoint reached'),
    })

    const [stopped, finalAdvance] = advanceSimulation(checkpoint, { hours: 12 }, 'agent')
    expect(finalAdvance.stopped).toBe(true)
    expect(stopped.learning).toMatchObject({
      currentPhase: 'verify',
      achieved: { ground: true, plan: true, supervise: true, verify: false },
    })
  })

  it('requires telemetry and a crew-equipment comparison to complete typed Ground evidence', () => {
    const initial = createOperationsState()
    const untyped = recordLearningEvidence(
      initial,
      'ground',
      'Looked around the incident.',
      'agent',
    )
    expect(untyped.learning).toMatchObject({
      currentPhase: 'ground',
      achieved: { ground: false },
    })
    const telemetry = recordLearningEvidence(
      untyped,
      'ground',
      'Inspected incident pressure, oxygen, power, and dependencies.',
      'agent',
      { groundingKind: 'incident_telemetry' },
    )
    expect(telemetry.learning).toMatchObject({
      currentPhase: 'ground',
      achieved: { ground: false },
      coaching: expect.stringContaining('compare crew and equipment'),
    })

    const duplicateTelemetry = recordLearningEvidence(
      telemetry,
      'ground',
      'Inspected incident telemetry again.',
      'agent',
      { groundingKind: 'incident_telemetry' },
    )
    expect(duplicateTelemetry.learning.achieved.ground).toBe(false)

    const compared = recordLearningEvidence(
      duplicateTelemetry,
      'ground',
      'Compared crew skills, fatigue, and available equipment.',
      'agent',
      { groundingKind: 'crew_equipment_comparison' },
    )
    expect(compared.learning).toMatchObject({
      currentPhase: 'plan',
      achieved: { ground: true },
    })
    expect(compared.learning.evidence.slice(0, 3).map((entry) => entry.groundingKind))
      .toEqual([
        'crew_equipment_comparison',
        'incident_telemetry',
        'incident_telemetry',
      ])
  })

  it('does not backfill skipped phases with evidence gathered after the outcome', () => {
    let state = makePlan()
    state = commitOperationsPlan(
      state,
      state.worldRevision,
      state.operationsPlan.revision,
      'agent',
    )[0]
    state = advanceSimulation(state, { hours: 12 }, 'agent')[0]
    state = verifyOperationsPlan(state, 'agent')[0]

    expect(state.learning).toMatchObject({
      currentPhase: 'ground',
      completedLoops: 0,
      achieved: { ground: false, plan: false, supervise: false, verify: false },
    })

    state = groundResponse(state)
    expect(state.learning).toMatchObject({
      currentPhase: 'plan',
      completedLoops: 0,
      achieved: { ground: true, plan: false, supervise: false, verify: false },
    })
  })

  it('requires one EVA suit for every crew member assigned to exposed work', () => {
    const planned = makePlan()
    const repressurize = planned.workOrders.find((order) => (
      order.id === 'work-repressurize-lab'
    ))!
    repressurize.assignedCrewIds = ['crew-soo-jin-park', 'crew-mateo-alvarez']
    planned.operationsPlan.actions.push({
      id: 'action-extra-repressurize-crew',
      kind: 'assign_crew',
      crewId: 'crew-mateo-alvarez',
      workOrderId: 'work-repressurize-lab',
    })

    const validation = validateOperationsPlan(planned)
    expect(validation.issues).toContainEqual(expect.objectContaining({
      code: 'missing_equipment',
      targetId: 'work-repressurize-lab',
      message: expect.stringContaining('one reserved EVA suit per exposed crew member'),
    }))
  })

  it('raises a critical breathing alert for an unsuited construction pawn in lunar vacuum', () => {
    const state = createOperationsState()
    state.settlement.constructionCrew = state.settlement.constructionCrew.map((position) => (
      position.crewId === 'crew-amina-okafor'
        ? { ...position, cell: { x: 8, y: 9 } }
        : position
    ))

    expect(deriveAlerts(state)).toContainEqual(expect.objectContaining({
      id: 'alert-unprotected-crew',
      severity: 'critical',
      detail: expect.stringContaining('Amina Okafor'),
    }))
  })

  it('stops before a committed oxygen floor would be crossed', () => {
    const committed = commitGoldenPlan()
    committed.reserves.oxygenHours = 12.5
    committed.reserves.minimumOxygenHours = 12.5
    const [stopped, result] = advanceSimulation(committed, { hours: 4 }, 'agent')

    expect(result).toMatchObject({ advancedHours: 0, stopped: true, stopReason: 'oxygen_floor' })
    expect(stopped.operationsPlan.status).toBe('completed')
    expect(stopped.reserves.oxygenHours).toBe(12.5)
    expect(stopped.elapsedHours).toBe(committed.elapsedHours)

    const [blockedClear, clearBeforeVerification] = clearOperationsPlan(stopped, 'agent')
    expect(clearBeforeVerification).toMatchObject({
      ok: false,
      error: 'Verify the supervised outcome before opening a new Operations Plan.',
    })
    expect(blockedClear).toBe(stopped)

    const [verified, verification] = verifyOperationsPlan(stopped, 'agent')
    expect(verification.status).toBe('failure')
    expect(verified.verification).toEqual(verification)
    expect(clearOperationsPlan(verified, 'agent')[1].ok).toBe(true)
  })

  it('completes a committed threshold stop and refuses to burn time afterward', () => {
    let planned = makePlan()
    planned = setPlanBrief(planned, {
      ...brief,
      stopCondition: { kind: 'oxygen_below', thresholdHours: 31 },
    }, 'agent')[0]
    expect(validateOperationsPlan(planned).valid).toBe(true)
    const [committed, commit] = commitOperationsPlan(
      planned,
      planned.worldRevision,
      planned.operationsPlan.revision,
      'agent',
    )
    expect(commit.ok).toBe(true)

    const [stopped, result] = advanceSimulation(committed, { hours: 4 }, 'agent')
    expect(result).toMatchObject({ advancedHours: 1, stopReason: 'oxygen_below' })
    expect(stopped.operationsPlan.status).toBe('completed')
    const snapshot = structuredClone(stopped)

    const [unchanged, repeated] = advanceSimulation(stopped, { hours: 4 }, 'agent')
    expect(repeated).toMatchObject({ advancedHours: 0, stopReason: 'oxygen_below' })
    expect(unchanged).toBe(stopped)
    expect(unchanged).toEqual(snapshot)
    expect(verifyOperationsPlan(stopped, 'agent')[1].status).toBe('failure')
  })

  it('keeps an optional observation threshold resumable', () => {
    const committed = commitGoldenPlan()
    const [checkpoint, result] = advanceSimulation(committed, {
      hours: 4,
      stopCondition: { kind: 'oxygen_below', thresholdHours: 31 },
    }, 'agent')

    expect(result).toMatchObject({ advancedHours: 1, stopReason: 'oxygen_below' })
    expect(checkpoint.operationsPlan.status).toBe('committed')
    expect(checkpoint.learning.achieved.supervise).toBe(false)
  })

  it('lets the committed horizon win when an optional checkpoint fires on the final hour', () => {
    const committed = commitGoldenPlan()
    committed.operationsPlan.horizonHours = 1
    const [stopped, result] = advanceSimulation(committed, {
      hours: 4,
      stopCondition: { kind: 'oxygen_below', thresholdHours: 31 },
    }, 'agent')

    expect(result).toMatchObject({ advancedHours: 1, stopReason: 'horizon_reached' })
    expect(stopped.operationsPlan.status).toBe('completed')
    expect(stopped.learning.achieved.supervise).toBe(true)
  })

  it('verifies the actual outcome and records the full Ground → Plan → Supervise → Verify loop', () => {
    let state = groundResponse(createOperationsState())
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

    const eventCount = verified.events.length
    const evidenceCount = verified.learning.evidence.length
    const [unchanged, repeated] = verifyOperationsPlan(verified, 'agent')
    expect(repeated).toEqual(result)
    expect(unchanged).toBe(verified)
    expect(unchanged.events).toHaveLength(eventCount)
    expect(unchanged.learning.evidence).toHaveLength(evidenceCount)
    expect(unchanged.learning.completedLoops).toBe(1)

    const nextTelemetry = recordLearningEvidence(
      unchanged,
      'ground',
      'Inspected the fresh post-verification state.',
      'agent',
      { groundingKind: 'incident_telemetry' },
    )
    expect(nextTelemetry.learning).toMatchObject({
      completedLoops: 1,
      currentPhase: 'ground',
      achieved: { ground: false, plan: false, supervise: false, verify: false },
    })
    const nextGround = recordLearningEvidence(
      nextTelemetry,
      'ground',
      'Compared crew and gear for the next loop.',
      'agent',
      { groundingKind: 'crew_equipment_comparison' },
    )
    expect(nextGround.learning).toMatchObject({
      completedLoops: 1,
      currentPhase: 'plan',
      achieved: { ground: true, plan: false, supervise: false, verify: false },
      coaching: expect.stringContaining('Stage an objective'),
    })
  })

  it('verifies an independent solar-mitigation milestone without claiming the recovery objective', () => {
    const initial = createOperationsState()
    const [planned] = stageOperationsPlanBatch(initial, {
      expectedRunId: initial.runId,
      expectedWorldRevision: initial.worldRevision,
      expectedPlanRevision: initial.operationsPlan.revision,
      brief: milestoneBrief('work-clean-solar'),
      actions: dustActions,
    }, 'agent')
    expect(validateOperationsPlan(planned)).toMatchObject({
      valid: true,
      preview: { estimatedCompletionHours: 3 },
    })

    const [committed, commit] = commitOperationsPlan(
      planned,
      planned.worldRevision,
      planned.operationsPlan.revision,
      'agent',
    )
    expect(commit.ok).toBe(true)
    const [advanced, advance] = advanceSimulation(committed, { hours: 12 }, 'agent')
    expect(advance).toMatchObject({ advancedHours: 3, stopReason: 'work_order_complete' })

    const [verified, verification] = verifyOperationsPlan(advanced, 'agent')
    expect(verification).toMatchObject({ status: 'success', objectiveMet: false })
    expect(verified.lab).toMatchObject({ breached: true, atmosphere: 'no' })
    expect(verified.events[0].targetIds).toEqual(['operations-plan-001', 'work-clean-solar'])
  })

  it('never lets a per-call stop override bypass the committed milestone', () => {
    const initial = createOperationsState()
    const [planned] = stageOperationsPlanBatch(initial, {
      expectedRunId: initial.runId,
      expectedWorldRevision: initial.worldRevision,
      expectedPlanRevision: initial.operationsPlan.revision,
      brief: milestoneBrief('work-seal-lab'),
      actions: sealActions,
    }, 'agent')
    const [committed, commit] = commitOperationsPlan(
      planned,
      planned.worldRevision,
      planned.operationsPlan.revision,
      'agent',
    )
    expect(commit.ok).toBe(true)

    const [stopped, advance] = advanceSimulation(committed, {
      hours: 12,
      stopCondition: { kind: 'objective_complete' },
    }, 'agent')

    expect(advance).toMatchObject({
      advancedHours: 3,
      stopReason: 'work_order_complete',
      completedWorkOrderIds: ['work-seal-lab'],
    })
    expect(stopped.operationsPlan.status).toBe('completed')
    expect(stopped.lab).toMatchObject({ sealed: true, atmosphere: 'no' })
    expect(stopped.research.status).toBe('blocked')
  })

  it('preserves a supervised result until it has been verified', () => {
    const initial = groundResponse(createOperationsState())
    const [planned] = stageOperationsPlanBatch(initial, {
      expectedRunId: initial.runId,
      expectedWorldRevision: initial.worldRevision,
      expectedPlanRevision: initial.operationsPlan.revision,
      brief: milestoneBrief('work-seal-lab'),
      actions: sealActions,
    }, 'agent')
    const [committed, commit] = commitOperationsPlan(
      planned,
      planned.worldRevision,
      planned.operationsPlan.revision,
      'agent',
    )
    expect(commit.ok).toBe(true)
    const [advanced] = advanceSimulation(committed, { hours: 12 }, 'agent')
    expect(advanced.operationsPlan.status).toBe('completed')

    const [preserved, blockedClear] = clearOperationsPlan(advanced, 'agent')
    expect(preserved).toBe(advanced)
    expect(blockedClear).toMatchObject({
      ok: false,
      planRevision: advanced.operationsPlan.revision,
      error: 'Verify the supervised outcome before opening a new Operations Plan.',
    })

    const [verified, verification] = verifyOperationsPlan(advanced, 'agent')
    expect(verification.status).toBe('success')
    const [cleared, acceptedClear] = clearOperationsPlan(verified, 'agent')
    expect(acceptedClear.ok).toBe(true)
    expect(cleared.operationsPlan).toMatchObject({ status: 'draft', baseline: null })
    expect(cleared.verification).toBeNull()
    expect(cleared.learning.completedLoops).toBe(1)
  })

  it('supports a safe three-loop seal, repressurize, and research recovery', () => {
    const runMilestone = (
      source: MoonbaseState,
      workOrderId: WorkOrderId,
      actions: PlanActionInput[],
    ) => {
      const [planned, batch] = stageOperationsPlanBatch(source, {
        expectedRunId: source.runId,
        expectedWorldRevision: source.worldRevision,
        expectedPlanRevision: source.operationsPlan.revision,
        mode: 'replace',
        brief: milestoneBrief(workOrderId),
        actions,
      }, 'agent')
      expect(batch).toMatchObject({ ok: true, code: 'staged' })
      expect(validateOperationsPlan(planned).valid).toBe(true)

      const [committed, commit] = commitOperationsPlan(
        planned,
        planned.worldRevision,
        planned.operationsPlan.revision,
        'agent',
      )
      expect(commit.ok).toBe(true)
      const [advanced, advance] = advanceSimulation(committed, { hours: 12 }, 'agent')
      expect(advance.stopReason).toBe(
        workOrderId === 'work-research-sintering' ? 'objective_complete' : 'work_order_complete',
      )
      expect(advanced.operationsPlan.status).toBe('completed')
      const [unchanged, repeatedAdvance] = advanceSimulation(advanced, { hours: 12 }, 'agent')
      expect(repeatedAdvance).toMatchObject({
        advancedHours: 0,
        stopReason: workOrderId === 'work-research-sintering' ? 'objective_complete' : 'work_order_complete',
      })
      expect(unchanged.elapsedHours).toBe(advanced.elapsedHours)
      expect(unchanged.worldRevision).toBe(advanced.worldRevision)
      const [verified, verification] = verifyOperationsPlan(advanced, 'agent')
      expect(verification.status).toBe('success')
      expect(verification.checks.every((check) => check.passed)).toBe(true)
      return { state: verified, verification }
    }

    const sealed = runMilestone(
      createOperationsState(),
      'work-seal-lab',
      [...sealActions, ...dustActions],
    )
    expect(sealed.state.lab).toMatchObject({ breached: false, sealed: true, atmosphere: 'no' })
    expect(sealed.verification.objectiveMet).toBe(false)
    expect(sealed.verification.checks).toContainEqual(expect.objectContaining({
      id: 'milestone',
      passed: true,
    }))
    expect(sealed.verification.summary).toContain('overall laboratory recovery continues')
    expect(sealed.verification.residualRisks).toContainEqual(expect.stringContaining('Overall recovery continues'))
    expect(sealed.state.events[0].targetIds).toEqual(['operations-plan-001', 'work-seal-lab'])

    const repressurized = runMilestone(sealed.state, 'work-repressurize-lab', [
      { kind: 'assign_crew', crewId: 'crew-mateo-alvarez', workOrderId: 'work-repressurize-lab' },
      {
        kind: 'reserve_equipment',
        equipmentId: 'equipment-eva-03',
        workOrderId: 'work-repressurize-lab',
      },
      {
        kind: 'reserve_equipment',
        equipmentId: 'equipment-engineering-01',
        workOrderId: 'work-repressurize-lab',
      },
    ])
    expect(repressurized.state.lab.atmosphere).toBe('yes')
    expect(repressurized.verification.objectiveMet).toBe(false)
    expect(repressurized.verification.summary).toContain('overall laboratory recovery continues')

    const researched = runMilestone(repressurized.state, 'work-research-sintering', [{
      kind: 'assign_crew',
      crewId: 'crew-leila-haddad',
      workOrderId: 'work-research-sintering',
    }])
    expect(researched.state.scenarioStatus).toBe('objective_complete')
    expect(researched.verification.objectiveMet).toBe(true)
    expect(researched.verification.summary).toContain('laboratory recovery succeeded')
  })
})

describe('Moonbase Zustand store', () => {
  beforeEach(() => useColonyStore.getState().resetColony())

  it('exposes the same revisioned commands and performs a deterministic reset', () => {
    openStoreOperations()
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

  it('publishes a successful plan batch through one store action', () => {
    openStoreOperations()
    const before = useColonyStore.getState()
    const result = before.stagePlanBatch({
      expectedRunId: before.runId,
      expectedWorldRevision: before.worldRevision,
      expectedPlanRevision: before.operationsPlan.revision,
      brief,
      actions: coreActions,
    }, 'agent')
    const after = useColonyStore.getState()

    expect(result).toMatchObject({ ok: true, code: 'staged' })
    expect(after.operationsPlan.revision).toBe(result.planRevision)
    expect(after.operationsPlan.actions).toHaveLength(coreActions.length)
    expect(after.events).toHaveLength(before.events.length + 1 + coreActions.length)
  })

  it('does not publish a failed store batch', () => {
    openStoreOperations()
    const draft = useColonyStore.getState()
    useColonyStore.setState({
      operationsPlan: { ...draft.operationsPlan, status: 'committed' },
    })
    const before = useColonyStore.getState()
    const snapshot = JSON.stringify(before)
    const result = before.stagePlanBatch({
      expectedRunId: before.runId,
      expectedWorldRevision: before.worldRevision,
      expectedPlanRevision: before.operationsPlan.revision,
      brief,
      actions: coreActions,
    }, 'agent')

    expect(result).toMatchObject({ ok: false, code: 'edit_failed', failedStage: 'brief' })
    expect(JSON.stringify(useColonyStore.getState())).toBe(snapshot)
  })

  it('drives the same golden path through the public store action contract', () => {
    openStoreOperations()
    useColonyStore.getState().recordLearningEvidence(
      'ground',
      'Inspected live Moonbase telemetry.',
      'agent',
      { groundingKind: 'incident_telemetry' },
    )
    useColonyStore.getState().recordLearningEvidence(
      'ground',
      'Compared crew and localized equipment.',
      'agent',
      { groundingKind: 'crew_equipment_comparison' },
    )
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

  it('rejects Terra\'s self-blocking life support footprint before queue mutation', () => {
    const layoutFrom = (result: ConstructionResult) => {
      if (!result.ok) throw new Error(result.error)
      return result.layout
    }
    const initial = useColonyStore.getState()
    let layout = layoutFrom(
      paintBoundaryLine(initial.settlement.layout, { x: 8, y: 7 }, { x: 10, y: 7 }, 'wall'),
    )
    layout = layoutFrom(paintBoundaryCell(layout, { x: 8, y: 7 }, 'door'))
    layout = layoutFrom(paintBoundaryLine(layout, { x: 11, y: 8 }, { x: 11, y: 10 }, 'wall'))
    layout = layoutFrom(paintBoundaryLine(layout, { x: 8, y: 11 }, { x: 10, y: 11 }, 'wall'))
    useColonyStore.setState({
      settlement: {
        ...initial.settlement,
        layout,
        constructionOrders: [],
        constructionStockpile: { x: 8, y: 6 },
        constructionCrew: initial.settlement.constructionCrew.map((position) => (
          position.crewId === 'crew-amina-okafor'
            ? { ...position, cell: { x: 10, y: 6 } }
            : position.crewId === 'crew-mateo-alvarez'
              ? { ...position, cell: { x: 6, y: 9 } }
              : position
        )),
      },
    })
    const placement = placeWorkstation(layout, {
      id: 'terra-life-support',
      type: 'life-support',
      label: 'Life support',
      origin: { x: 8, y: 8 },
      size: { width: 2, height: 2 },
      rotation: 0,
    })
    expect(placement.ok).toBe(true)
    const before = JSON.stringify(useColonyStore.getState())

    expect(useColonyStore.getState().queueConstruction(placement)).toMatchObject({
      ok: false,
      orderIds: [],
      error: expect.stringContaining('floor immediately inside each working door clear'),
    })
    expect(JSON.stringify(useColonyStore.getState())).toBe(before)
  })
})
