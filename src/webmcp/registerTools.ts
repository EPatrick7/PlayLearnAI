import { useMemo } from 'react'
import Ajv from 'ajv'
import {
  CONSTRUCTION_GRID_HEIGHT,
  CONSTRUCTION_GRID_WIDTH,
  eraseLine,
  paintBoundaryLine,
  placeWorkstation,
  type GridPoint,
  type WorkstationRotation,
} from '../game/construction'
import {
  WORKSTATION_SPECS,
  type WorkstationKind,
} from '../game/constructionCatalog'
import {
  availableConstructionStock,
  projectConstructionOrders,
} from '../game/constructionJobs'
import {
  analyzeConstructionPressure,
  constructionEnvironmentAt,
} from '../game/pressureTopology'
import { canBeginOperations } from '../game/settlement'
import { constructionCrewUnavailableReason, useColonyStore } from '../game/store'
import { useToolRegistration, type ToolRegistrationStatus } from './useToolRegistration'
import { skillKeys, workOrderIds } from '../game/types'
import type {
  ConstructionSpeed,
  PlanActionInput,
  Priority,
  SkillKey,
  StopCondition,
  WorkOrderId,
} from '../game/types'

export type WebMcpStatus = ToolRegistrationStatus

// Some real hosts pass an execution context without a signal (or no context).
// Preserve cancellation when supplied without inventing host cancellation support.
type SiteTool = Omit<WebMCP.ModelContextTool, 'execute'> & {
  execute: (
    input: Record<string, unknown>,
    options?: { signal?: AbortSignal } | null,
  ) => WebMCP.MaybePromise<unknown>
}

export const OPERATIONAL_WEB_MCP_TOOL_NAMES = [
  'inspect_moonbase',
  'query_crew_and_equipment',
  'inspect_operations_plan',
  'stage_operations_plan',
  'edit_operations_plan',
  'commit_operations_plan',
  'advance_until',
  'verify_operations_plan',
] as const

export const CONSTRUCTION_WEB_MCP_TOOL_NAMES = [
  'inspect_construction',
  'place_construction_blueprint',
  'manage_construction',
] as const

export const LANDING_WEB_MCP_TOOL_NAMES = [
  ...CONSTRUCTION_WEB_MCP_TOOL_NAMES,
  'begin_first_shift',
] as const

export const OPERATIONS_WEB_MCP_TOOL_NAMES = [
  ...OPERATIONAL_WEB_MCP_TOOL_NAMES,
  ...CONSTRUCTION_WEB_MCP_TOOL_NAMES,
] as const

export const WEB_MCP_TOOL_COUNTS = {
  landing: LANDING_WEB_MCP_TOOL_NAMES.length,
  operations: OPERATIONS_WEB_MCP_TOOL_NAMES.length,
} as const

const workstationKinds = Object.keys(WORKSTATION_SPECS) as WorkstationKind[]
const constructionSpeeds: ConstructionSpeed[] = [0, 1, 2, 3]
const priorities: Priority[] = [1, 2, 3, 4, 5]

const textResult = (value: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
})

const stateResult = (value: Record<string, unknown>, next: string) => {
  const state = useColonyStore.getState()
  return textResult({
    ...value,
    runId: state.runId,
    settlementPhase: state.settlement.phase,
    worldRevision: state.worldRevision,
    next,
  })
}

const expectedRunIdSchema = { type: 'string', minLength: 1 }

const mutationGuard = (expectedRunId: string, signal?: AbortSignal) => {
  const state = useColonyStore.getState()
  if (expectedRunId !== state.runId) {
    return stateResult(
      {
        ok: false,
        code: 'stale_run',
        expectedRunId,
        currentRunId: state.runId,
      },
      'Inspect the current run again and retry with its runId. Never reuse a mutation from an earlier reset run.',
    )
  }
  return signal?.aborted
    ? stateResult(
        { ok: false, code: 'cancelled' },
        'The request was cancelled before mutation; inspect the unchanged state before retrying.',
      )
    : null
}

const operationsRequired = () => {
  const state = useColonyStore.getState()
  return state.settlement.phase === 'operations'
    ? null
    : stateResult(
        { ok: false, code: 'operations_not_started' },
        'Finish the construction objective and use begin_first_shift before inspecting or changing incident operations.',
      )
}

const pointSchema = {
  type: 'object',
  properties: {
    x: { type: 'integer', minimum: 0, maximum: CONSTRUCTION_GRID_WIDTH - 1 },
    y: { type: 'integer', minimum: 0, maximum: CONSTRUCTION_GRID_HEIGHT - 1 },
  },
  required: ['x', 'y'],
  additionalProperties: false,
}

const stopConditionSchema = {
  type: 'object',
  properties: {
    kind: {
      type: 'string',
      enum: [
        'objective_complete',
        'oxygen_below',
        'battery_below',
        'critical_alert',
        'work_order_complete',
      ],
    },
    thresholdHours: { type: 'number' },
    thresholdKwh: { type: 'number' },
    workOrderId: { type: 'string', enum: workOrderIds },
  },
  required: ['kind'],
  additionalProperties: false,
}

const effectiveGeneration = () => {
  const { power } = useColonyStore.getState()
  return power.solarGenerationKw * (1 - power.dustDeratePercent / 100)
}

const workOrderView = (
  order: ReturnType<typeof useColonyStore.getState>['workOrders'][number],
) => ({
  id: order.id,
  label: order.label,
  detail: order.detail,
  status: order.status,
  location: order.location,
  priority: order.priority,
  skill: { name: order.requiredSkill, minimum: order.minimumSkill },
  requiredEquipment: order.requiredEquipment,
  hazard: order.hazard,
  prerequisites: order.prerequisiteIds,
  progress: { hours: order.progressHours, requiredHours: order.durationHours },
  assignedCrewIds: order.assignedCrewIds,
  reservedEquipmentIds: order.reservedEquipmentIds,
})

const moonbaseBrief = () => {
  const state = useColonyStore.getState()
  return {
    base: state.baseName,
    seed: state.seed,
    time: {
      missionDay: state.missionDay,
      hour: state.hour,
      elapsedHours: state.elapsedHours,
    },
    scenarioStatus: state.scenarioStatus,
    objective: state.objective,
    reserves: {
      ...state.reserves,
      declaredOxygenFloorHours: state.operationsPlan.objective
        ? state.operationsPlan.constraints.oxygenFloorHours
        : state.objective.recommendedOxygenFloorHours,
    },
    power: {
      ...state.power,
      effectiveGenerationKw: effectiveGeneration(),
      netKw: effectiveGeneration() - state.power.demandKw,
    },
    laboratory: state.lab,
    dust: {
      ...state.dust,
      startsInHours: Math.max(0, state.dust.startsAtHour - state.elapsedHours),
    },
    research: state.research,
    alerts: state.alerts,
    workOrders: state.workOrders.map(workOrderView),
    operationsPlan: {
      id: state.operationsPlan.id,
      status: state.operationsPlan.status,
      revision: state.operationsPlan.revision,
      basedOnWorldRevision: state.operationsPlan.basedOnWorldRevision,
      actionCount: state.operationsPlan.actions.length,
    },
    workflow: {
      phase: state.learning.currentPhase,
      coaching: state.learning.coaching,
    },
  }
}

const currentVerification = () => {
  const state = useColonyStore.getState()
  return state.verification?.verifiedAtWorldRevision === state.worldRevision &&
    state.verification.verifiedAtHour === state.elapsedHours
    ? state.verification
    : null
}

const operationsPlanSnapshot = () => {
  const state = useColonyStore.getState()
  const plan = state.operationsPlan
  if (plan.status === 'draft') {
    const validation = state.validatePlan()
    return {
      plan,
      validation,
      review: { kind: 'draft' as const, validation },
    }
  }

  const verification = currentVerification()
  if (plan.status === 'completed') {
    return verification
      ? {
          plan,
          validation: null,
          review: {
            kind: 'verified' as const,
            lastAdvance: state.lastAdvance,
            verification,
          },
        }
      : {
          plan,
          validation: null,
          review: {
            kind: 'awaiting_verification' as const,
            lastAdvance: state.lastAdvance,
          },
        }
  }

  return {
    plan,
    validation: null,
    review: {
      kind: 'supervising' as const,
      lastAdvance: state.lastAdvance,
      ...(verification ? { checkpointVerification: verification } : {}),
    },
  }
}

const operationsPlanNext = (
  snapshot: ReturnType<typeof operationsPlanSnapshot>,
) => {
  if (snapshot.review.kind === 'draft') {
    const blockers = snapshot.review.validation.issues.filter(
      (issue) => issue.severity === 'error',
    ).length
    return blockers > 0
      ? `Resolve the ${blockers} draft ${blockers === 1 ? 'blocker' : 'blockers'}, then inspect the plan again.`
      : 'Review the proposed changes with the human, then inspect once more and commit using the fresh revisions.'
  }
  if (snapshot.review.kind === 'supervising') {
    return 'The plan is committed. Advance only within its declared horizon and stop condition; inspect or verify any checkpoint before deciding to continue.'
  }
  if (snapshot.review.kind === 'awaiting_verification') {
    return 'The plan reached its declared stop and the outcome is preserved. Verify it now; do not stage, clear, or recommit this completed plan.'
  }

  const state = useColonyStore.getState()
  if (state.scenarioStatus === 'objective_complete') {
    return 'The completed outcome is verified. Preserve the evidence or let the human start the next incident from the visible game.'
  }
  return snapshot.review.verification.status === 'success'
    ? 'This milestone is verified. Open a fresh bounded plan before continuing the incident.'
    : 'Review the visible residual risks, then open a fresh bounded plan before continuing.'
}

const constructionView = () => {
  const state = useColonyStore.getState()
  const { constructionOrders, constructionSpeed, layout } = state.settlement
  const projection = projectConstructionOrders(layout, constructionOrders)
  const pressure = analyzeConstructionPressure(projection.layout)
  const completedPressure = analyzeConstructionPressure(layout)
  const visibleCrew = state.settlement.phase === 'landing' ? state.crew.slice(0, 2) : state.crew
  const availableStock = availableConstructionStock(
    state.reserves.constructionStock,
    constructionOrders,
  )
  const openOrders = constructionOrders.filter((order) => order.status !== 'complete')

  return {
    grid: { width: layout.width, height: layout.height },
    completedLayout: layout,
    projectedLayout: projection.layout,
    projectionIssues: projection.issues,
    rooms: pressure.rooms.map((room) => ({
      id: room.id,
      area: room.area,
      bounds: room.bounds,
      doorCells: room.doorCells,
    })),
    doors: pressure.doors.map((door) => ({
      cell: door.cell,
      axis: door.axis,
      role: door.role,
      roomIds: door.roomIds,
      suitRequired: door.role === 'exterior_airlock',
    })),
    construction: {
      speed: constructionSpeed,
      stockpile: state.settlement.constructionStockpile,
      material: {
        stored: state.reserves.constructionStock,
        reserved: Math.max(0, state.reserves.constructionStock - availableStock),
        available: availableStock,
      },
      openOrderCount: openOrders.length,
      commands: [...new Set(openOrders.map((order) => order.commandId))],
      orders: constructionOrders.map((order) => ({
        id: order.id,
        commandId: order.commandId,
        sequence: order.sequence,
        priority: order.priority,
        operation: order.operation,
        status: order.status,
        block: order.block,
        assignedCrewId: order.assignedCrewId,
        forcedCrewId: order.forcedCrewId ?? null,
        prerequisiteOrderIds: order.prerequisiteOrderIds ?? [],
        target: order.target,
        materials: order.materials,
        work: order.work,
      })),
      crew: state.settlement.constructionCrew.filter((position) => (
        visibleCrew.some((member) => member.id === position.crewId)
      )).map((position) => {
        const member = visibleCrew.find((candidate) => candidate.id === position.crewId)!
        const unavailableReason = constructionCrewUnavailableReason(state, member.id)
        const environment = constructionEnvironmentAt(
          layout,
          completedPressure,
          position.cell,
        )
        return {
          ...position,
          name: member.name,
          available: unavailableReason === null,
          unavailableReason,
          assignedOrderIds: openOrders.filter((order) => (
            order.assignedCrewId === member.id || order.forcedCrewId === member.id
          )).map((order) => order.id),
          environment,
          equippedEvaSuitId: member.equippedEvaSuitId ?? null,
          breathing: environment === 'pressurized'
            ? 'room_air'
            : member.equippedEvaSuitId
              ? 'eva_suit'
              : 'unprotected_vacuum',
        }
      }),
    },
    availableWorkstations: workstationKinds.map((kind) => ({
      ...WORKSTATION_SPECS[kind],
    })),
    readyForFirstShift: canBeginOperations(state),
  }
}

interface StopConditionInput {
  kind: StopCondition['kind']
  thresholdHours?: number
  thresholdKwh?: number
  workOrderId?: WorkOrderId
}

const parseStopCondition = (input: StopConditionInput): StopCondition | string => {
  if (input.kind === 'oxygen_below') {
    if (typeof input.thresholdHours !== 'number') {
      return 'oxygen_below requires thresholdHours.'
    }
    return { kind: input.kind, thresholdHours: input.thresholdHours }
  }
  if (input.kind === 'battery_below') {
    if (typeof input.thresholdKwh !== 'number') {
      return 'battery_below requires thresholdKwh.'
    }
    return { kind: input.kind, thresholdKwh: input.thresholdKwh }
  }
  if (input.kind === 'work_order_complete') {
    if (!input.workOrderId) return 'work_order_complete requires workOrderId.'
    return { kind: input.kind, workOrderId: input.workOrderId }
  }
  if (input.kind === 'objective_complete' || input.kind === 'critical_alert') {
    return { kind: input.kind }
  }
  return `Unknown stop condition: ${String(input.kind)}`
}

interface RawWorkAssignment {
  workOrderId: WorkOrderId
  crewId: string
  equipmentIds?: string[]
  priority?: Priority
}

const expandWorkAssignments = (
  assignments: RawWorkAssignment[],
): PlanActionInput[] => assignments.flatMap((assignment) => [
  {
    kind: 'assign_crew' as const,
    crewId: assignment.crewId,
    workOrderId: assignment.workOrderId,
  },
  ...(assignment.equipmentIds ?? []).map((equipmentId) => ({
    kind: 'reserve_equipment' as const,
    equipmentId,
    workOrderId: assignment.workOrderId,
  })),
  ...(assignment.priority === undefined ? [] : [{
    kind: 'set_priority' as const,
    priority: assignment.priority,
    workOrderId: assignment.workOrderId,
  }]),
])

type ConstructionPlacementInput =
  | {
      expectedRunId: string
      expectedWorldRevision: number
      kind: 'wall' | 'door' | 'deconstruct'
      start: GridPoint
      end: GridPoint
    }
  | {
      expectedRunId: string
      expectedWorldRevision: number
      kind: 'workstation'
      workstationType: WorkstationKind
      origin: GridPoint
      rotation?: WorkstationRotation
      workstationId?: string
      label?: string
    }

type ManageConstructionInput =
  | {
      expectedRunId: string
      expectedWorldRevision?: number
      action: 'set_speed'
      speed: 0
    }
  | {
      expectedRunId: string
      expectedWorldRevision: number
      action: 'set_speed'
      speed: Exclude<ConstructionSpeed, 0>
    }
  | {
      expectedRunId: string
      expectedWorldRevision: number
      action: 'cancel_command'
      commandId: string
    }
  | {
      expectedRunId: string
      expectedWorldRevision: number
      action: 'cancel_order'
      orderId: string
    }
  | {
      expectedRunId: string
      expectedWorldRevision: number
      action: 'set_command_priority'
      commandId: string
      priority: Priority
    }
  | {
      expectedRunId: string
      expectedWorldRevision: number
      action: 'assign_builder'
      orderId: string
      crewId: string | null
    }
  | {
      expectedRunId: string
      expectedWorldRevision: number
      action: 'set_order_priority'
      orderId: string
      priority: Priority
    }

const staleWorldResult = (expectedWorldRevision: number) => {
  const state = useColonyStore.getState()
  return expectedWorldRevision === state.worldRevision
    ? null
    : stateResult(
        {
          ok: false,
          code: 'stale_world',
          expectedWorldRevision,
          currentWorldRevision: state.worldRevision,
        },
        'Pause construction with manage_construction (set_speed, speed 0) if workers are moving, then inspect again and retry using the latest world revision.',
      )
}

const constructionTools = (): SiteTool[] => [
  {
    name: 'inspect_construction',
    description:
      'Inspect only the settlement construction domain: completed and projected layout, rooms, material, workers, queue, speed, and first-shift readiness. This never reveals the later operational incident.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    execute: () => {
      const phase = useColonyStore.getState().settlement.phase
      const view = constructionView()
      const next = view.projectionIssues.length > 0
        ? 'Resolve invalid queued work with manage_construction, then inspect again.'
        : phase === 'operations'
          ? view.construction.openOrderCount > 0
            ? 'Operations are active; use manage_construction to adjust the live queue, speed, priority, or cancellation.'
            : 'Operations are active; use place_construction_blueprint to expand the settlement or inspect another operational domain.'
          : view.construction.openOrderCount > 0
            ? 'Finish or cancel every open construction order before beginning the first shift; use manage_construction to adjust the live queue.'
          : view.readyForFirstShift
            ? 'Construction is ready; use begin_first_shift with this world revision.'
            : 'Place walls, a door, and Life Support with place_construction_blueprint; keep construction speed above zero so colonists can finish them.'
      return stateResult(view, next)
    },
  },
  {
    name: 'place_construction_blueprint',
    description:
      'Queue one typed wall, door, deconstruction line, or catalog workstation against the inspected run and projected layout. Supply its runId and world revision; the same validators and worker queue as the visible builder are used.',
    inputSchema: {
      type: 'object',
      oneOf: [
        ...(['wall', 'door', 'deconstruct'] as const).map((kind) => ({
          type: 'object',
          properties: {
            expectedRunId: expectedRunIdSchema,
            expectedWorldRevision: { type: 'integer', minimum: 1 },
            kind: { const: kind },
            start: pointSchema,
            end: pointSchema,
          },
          required: ['expectedRunId', 'expectedWorldRevision', 'kind', 'start', 'end'],
          additionalProperties: false,
        })),
        {
          type: 'object',
          properties: {
            expectedRunId: expectedRunIdSchema,
            expectedWorldRevision: { type: 'integer', minimum: 1 },
            kind: { const: 'workstation' },
            workstationType: { type: 'string', enum: workstationKinds },
            origin: pointSchema,
            rotation: { type: 'integer', enum: [0, 90, 180, 270], default: 0 },
            workstationId: { type: 'string', minLength: 1 },
            label: { type: 'string', minLength: 1 },
          },
          required: [
            'expectedRunId',
            'expectedWorldRevision',
            'kind',
            'workstationType',
            'origin',
          ],
          additionalProperties: false,
        },
      ],
    },
    execute: (rawInput, options) => {
      const signal = options?.signal
      const input = rawInput as ConstructionPlacementInput
      const guarded = mutationGuard(input.expectedRunId, signal)
      if (guarded) return guarded
      const stale = staleWorldResult(input.expectedWorldRevision)
      if (stale) return stale

      const before = useColonyStore.getState()
      const projection = projectConstructionOrders(
        before.settlement.layout,
        before.settlement.constructionOrders,
      )
      if (!projection.valid) {
        return stateResult(
          { ok: false, code: 'invalid_projection', issues: projection.issues },
          'Cancel or complete the invalid queued construction before placing another blueprint.',
        )
      }

      const result = input.kind === 'workstation'
        ? (() => {
            const spec = WORKSTATION_SPECS[input.workstationType]
            return placeWorkstation(projection.layout, {
              id: input.workstationId?.trim() ||
                `webmcp-${input.workstationType}-${before.settlement.constructionSequence}`,
              type: input.workstationType,
              label: input.label?.trim() || spec.label,
              origin: input.origin,
              size: { width: spec.width, height: spec.height },
              rotation: input.rotation ?? 0,
            })
          })()
        : input.kind === 'deconstruct'
          ? eraseLine(projection.layout, input.start, input.end)
          : paintBoundaryLine(projection.layout, input.start, input.end, input.kind)

      if (!result.ok) {
        return stateResult(
          {
            ok: false,
            code: result.code,
            error: result.error,
            conflictingCell: result.conflictingCell,
            workstationId: result.workstationId,
          },
          'Inspect the projected construction layout, choose unobstructed in-bounds integer cells, and retry.',
        )
      }

      const cancelled = mutationGuard(input.expectedRunId, signal)
      if (cancelled) return cancelled
      const queued = useColonyStore.getState().queueConstruction(result)
      return stateResult(
        {
          ...queued,
          code: queued.ok ? 'queued' : 'queue_rejected',
          affectedCells: result.affectedCells,
          workstationId: result.workstationId,
        },
        queued.ok
          ? 'Use inspect_construction to review dependencies and material; use manage_construction to adjust speed, priority, or cancellation.'
          : 'Inspect construction and resolve the reported queue conflict before retrying.',
      )
    },
  },
  {
    name: 'manage_construction',
    description:
      'Manage the shared construction queue: speed, cancellation, priority, or assign_builder (crewId null restores Automatic). Pause with set_speed speed 0 before editing a moving queue; pausing requires only the current runId and is safe even when worker ticks have changed the world revision. All other actions require the latest inspected world revision. Inspect again after pausing. Builder assignment uses the same availability, dependency, and material-carrier checks as the visible picker.',
    inputSchema: {
      type: 'object',
      oneOf: [
        {
          type: 'object',
          properties: {
            expectedRunId: expectedRunIdSchema,
            expectedWorldRevision: { type: 'integer', minimum: 1 },
            action: { const: 'set_speed' },
            speed: { type: 'integer', const: 0 },
          },
          required: ['expectedRunId', 'action', 'speed'],
          additionalProperties: false,
        },
        {
          type: 'object',
          properties: {
            expectedRunId: expectedRunIdSchema,
            expectedWorldRevision: { type: 'integer', minimum: 1 },
            action: { const: 'set_speed' },
            speed: { type: 'integer', enum: constructionSpeeds.filter((speed) => speed !== 0) },
          },
          required: ['expectedRunId', 'expectedWorldRevision', 'action', 'speed'],
          additionalProperties: false,
        },
        {
          type: 'object',
          properties: {
            expectedRunId: expectedRunIdSchema,
            expectedWorldRevision: { type: 'integer', minimum: 1 },
            action: { const: 'assign_builder' },
            orderId: { type: 'string', minLength: 1 },
            crewId: { type: ['string', 'null'], minLength: 1 },
          },
          required: ['expectedRunId', 'expectedWorldRevision', 'action', 'orderId', 'crewId'],
          additionalProperties: false,
        },
        ...(['cancel_command', 'set_command_priority'] as const).map((action) => ({
          type: 'object',
          properties: {
            expectedRunId: expectedRunIdSchema,
            expectedWorldRevision: { type: 'integer', minimum: 1 },
            action: { const: action },
            commandId: { type: 'string', minLength: 1 },
            ...(action === 'set_command_priority'
              ? { priority: { type: 'integer', enum: priorities } }
              : {}),
          },
          required: [
            'expectedWorldRevision',
            'expectedRunId',
            'action',
            'commandId',
            ...(action === 'set_command_priority' ? ['priority'] : []),
          ],
          additionalProperties: false,
        })),
        ...(['cancel_order', 'set_order_priority'] as const).map((action) => ({
          type: 'object',
          properties: {
            expectedRunId: expectedRunIdSchema,
            expectedWorldRevision: { type: 'integer', minimum: 1 },
            action: { const: action },
            orderId: { type: 'string', minLength: 1 },
            ...(action === 'set_order_priority'
              ? { priority: { type: 'integer', enum: priorities } }
              : {}),
          },
          required: [
            'expectedWorldRevision',
            'expectedRunId',
            'action',
            'orderId',
            ...(action === 'set_order_priority' ? ['priority'] : []),
          ],
          additionalProperties: false,
        })),
      ],
    },
    execute: (rawInput, options) => {
      const signal = options?.signal
      const input = rawInput as ManageConstructionInput
      const guarded = mutationGuard(input.expectedRunId, signal)
      if (guarded) return guarded
      // Pausing does not consume stale layout/queue data. It must remain possible
      // while the live simulation advances between an agent's inspection and call.
      if (!(input.action === 'set_speed' && input.speed === 0)) {
        const stale = staleWorldResult(input.expectedWorldRevision!)
        if (stale) return stale
      }

      const store = useColonyStore.getState()
      if (input.action === 'set_speed') {
        const changed = store.setConstructionSpeed(input.speed)
        return stateResult(
          {
            ok: changed || store.settlement.constructionSpeed === input.speed,
            code: changed ? 'speed_changed' : 'speed_unchanged',
            speed: useColonyStore.getState().settlement.constructionSpeed,
          },
          input.speed === 0
            ? 'Construction is paused; set speed to 1, 2, or 3 when the queue should resume.'
            : 'Construction is running; inspect the queue again after colonists have progressed the blueprints.',
        )
      }

      if (input.action === 'assign_builder') {
        const result = store.setConstructionOrderBuilder(input.orderId, input.crewId)
        return stateResult(
          { ...result, code: result.ok ? 'builder_assigned' : 'assignment_rejected' },
          result.ok
            ? 'Inspect the queue to confirm the builder preference; resume construction when ready.'
            : 'Resolve the reported builder availability, prerequisite, or material-carrier constraint before retrying.',
        )
      }

      if (input.action === 'cancel_command') {
        const cancelledOrderIds = store.cancelConstructionCommand(input.commandId)
        return stateResult(
          {
            ok: cancelledOrderIds.length > 0,
            code: cancelledOrderIds.length > 0 ? 'command_cancelled' : 'not_found',
            commandId: input.commandId,
            cancelledOrderIds,
          },
          'Inspect construction again to confirm the projected layout and returned material.',
        )
      }

      if (input.action === 'cancel_order') {
        const cancelled = store.cancelConstructionOrder(input.orderId)
        return stateResult(
          {
            ok: cancelled,
            code: cancelled ? 'order_cancelled' : 'not_found',
            orderId: input.orderId,
          },
          'Inspect construction again because dependent blueprints may also have been cancelled.',
        )
      }

      if (input.action === 'set_command_priority') {
        const changedOrderCount = store.setConstructionCommandPriority(
          input.commandId,
          input.priority,
        )
        return stateResult(
          {
            ok: changedOrderCount > 0,
            code: changedOrderCount > 0 ? 'priority_changed' : 'not_changed',
            commandId: input.commandId,
            priority: input.priority,
            changedOrderCount,
          },
          'Inspect construction to review the reprioritized command and any material reallocation.',
        )
      }

      const changed = store.setConstructionOrderPriority(input.orderId, input.priority)
      return stateResult(
        {
          ok: changed,
          code: changed ? 'priority_changed' : 'not_changed',
          orderId: input.orderId,
          priority: input.priority,
        },
        'Inspect construction to review the reprioritized order and any material reallocation.',
      )
    },
  },
]

const beginFirstShiftTool = (): SiteTool => ({
  name: 'begin_first_shift',
  description:
    'Begin the operational incident only after two enclosed rooms and Life Support are completed, a usable exterior airlock remains, every construction order is finished or cancelled, and all colonists are back in pressurized rooms. Inspect readyForFirstShift before calling with the current runId and world revision.',
  inputSchema: {
    type: 'object',
    properties: {
      expectedRunId: expectedRunIdSchema,
      expectedWorldRevision: { type: 'integer', minimum: 1 },
    },
    required: ['expectedRunId', 'expectedWorldRevision'],
    additionalProperties: false,
  },
  execute: (rawInput, options) => {
    const signal = options?.signal
    const input = rawInput as { expectedRunId: string; expectedWorldRevision: number }
    const guarded = mutationGuard(input.expectedRunId, signal)
    if (guarded) return guarded
    const stale = staleWorldResult(input.expectedWorldRevision)
    if (stale) return stale
    const result = useColonyStore.getState().beginOperations('agent')
    return stateResult(
      { ...result },
      result.ok
        ? 'The first shift is active. Inspect the newly registered operational tools before staging a response.'
        : `${result.error ?? 'The settlement is not ready for its first shift.'} Inspect construction again before retrying.`,
    )
  },
})

const operationsTools = (): SiteTool[] => [
  {
    name: OPERATIONAL_WEB_MCP_TOOL_NAMES[0],
    description:
      'Ground a Moonbase decision in live operational evidence. First obtain the current run ID from inspect_operations_plan or inspect_construction. Records the inspection in the persistent Ground → Plan → Supervise → Verify workflow, but does not advance time or change operational resources. Supply that run ID so a retained callback cannot write evidence into a reset run. Returns pressure, reserves, power, dust timing, research, alerts, dependencies, and plan status.',
    inputSchema: {
      type: 'object',
      properties: {
        expectedRunId: expectedRunIdSchema,
        focus: {
          type: 'string',
          description: 'Optional inspection intent recorded as workflow evidence.',
        },
      },
      required: ['expectedRunId'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false },
    execute: (rawInput, options) => {
      const signal = options?.signal
      const input = rawInput as { expectedRunId: string; focus?: string }
      const guarded = mutationGuard(input.expectedRunId, signal)
      if (guarded) return guarded
      const unavailable = operationsRequired()
      if (unavailable) return unavailable
      const store = useColonyStore.getState()
      const evidencePhase = store.learning.currentPhase
      store.recordLearningEvidence(
        evidencePhase,
        input.focus
          ? `Agent inspected the moonbase for: ${input.focus}`
          : 'Agent inspected the live moonbase brief.',
        'agent',
        evidencePhase === 'ground'
          ? { groundingKind: 'incident_telemetry' }
          : { completesPhase: false },
      )
      return stateResult(
        moonbaseBrief(),
        'Use query_crew_and_equipment and inspect_operations_plan before staging a bounded response.',
      )
    },
  },
  {
    name: OPERATIONAL_WEB_MCP_TOOL_NAMES[1],
    description:
      'Compare crew and localized equipment before staging assignments. Rank one skill, cap fatigue, or focus on one work order. Records the comparison as persistent workflow evidence, but does not change crew or equipment. Supply the run ID you inspected so evidence cannot cross a reset boundary.',
    inputSchema: {
      type: 'object',
      properties: {
        expectedRunId: expectedRunIdSchema,
        skill: { type: 'string', enum: skillKeys },
        maxFatigue: { type: 'number', minimum: 0, maximum: 100 },
        workOrderId: { type: 'string', enum: workOrderIds },
        includeEquipment: { type: 'boolean', default: true },
      },
      required: ['expectedRunId'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false },
    execute: (rawInput, options) => {
      const signal = options?.signal
      const input = rawInput as {
        expectedRunId: string
        skill?: SkillKey
        maxFatigue?: number
        workOrderId?: WorkOrderId
        includeEquipment?: boolean
      }
      const guarded = mutationGuard(input.expectedRunId, signal)
      if (guarded) return guarded
      const unavailable = operationsRequired()
      if (unavailable) return unavailable
      const store = useColonyStore.getState()
      const order = input.workOrderId
        ? store.workOrders.find((candidate) => candidate.id === input.workOrderId)
        : undefined
      const skill = input.skill ?? order?.requiredSkill
      let crew = [...store.crew]
      if (input.maxFatigue !== undefined) {
        crew = crew.filter((member) => member.fatigue <= input.maxFatigue!)
      }
      if (skill) crew.sort((a, b) => b.skills[skill] - a.skills[skill])
      const equipment = input.includeEquipment === false
        ? []
        : store.equipment.filter(
            (item) => !order || order.requiredEquipment.includes(item.type),
          )
      const comparedEquipment = input.includeEquipment !== false && equipment.length > 0
      const evidencePhase = store.learning.currentPhase
      store.recordLearningEvidence(
        evidencePhase,
        `Agent compared ${crew.length} crew${comparedEquipment
          ? order ? ` and gear for ${order.label}` : ' and localized gear'
          : order ? ` for ${order.label}` : ''
        }.`,
        'agent',
        evidencePhase === 'ground' && comparedEquipment
          ? { groundingKind: 'crew_equipment_comparison' }
          : { completesPhase: false },
      )
      return stateResult(
        {
          workOrder: order ? workOrderView(order) : null,
          crew: crew.map((member) => ({
            id: member.id,
            name: member.name,
            role: member.role,
            trait: member.trait,
            status: member.status,
            health: member.health,
            fatigue: member.fatigue,
            location: member.location,
            taskId: member.taskId,
            equippedEvaSuitId: member.equippedEvaSuitId ?? null,
            breathing: member.equippedEvaSuitId ? 'eva_suit' : 'local_atmosphere',
            relevantSkill: skill
              ? { name: skill, level: member.skills[skill] }
              : undefined,
          })),
          equipment,
        },
        'Use this evidence to stage the smallest safe plan, then inspect its validation before committing.',
      )
    },
  },
  {
    name: OPERATIONAL_WEB_MCP_TOOL_NAMES[2],
    description:
      'Inspect the shared Operations Plan according to its lifecycle. Drafts return validation for review; committed plans return supervision state; completed plans return a preserved outcome that must be verified. Use immediately before commit so draft revisions are current.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    execute: () => {
      const unavailable = operationsRequired()
      if (unavailable) return unavailable
      const snapshot = operationsPlanSnapshot()
      return stateResult(
        snapshot,
        operationsPlanNext(snapshot),
      )
    },
  },
  {
    name: OPERATIONAL_WEB_MCP_TOOL_NAMES[3],
    description:
      'Prepare a reviewable response from work-level assignments. Name one crew member and any gear for each work order; omitted safeguards use the live objective defaults. The assignments expand into the same visible shared draft atomically, and nothing executes until a separate revision-checked commit.',
    inputSchema: {
      type: 'object',
      properties: {
        expectedRunId: expectedRunIdSchema,
        expectedWorldRevision: { type: 'integer', minimum: 1 },
        expectedPlanRevision: { type: 'integer', minimum: 1 },
        mode: { type: 'string', enum: ['append', 'replace'], default: 'append' },
        oxygenFloorHours: { type: 'number', minimum: 1 },
        protectedCrewIds: {
          type: 'array',
          maxItems: 6,
          uniqueItems: true,
          items: { type: 'string' },
        },
        horizonHours: { type: 'integer', minimum: 1, maximum: 12 },
        stopCondition: stopConditionSchema,
        assignments: {
          type: 'array',
          minItems: 1,
          maxItems: 4,
          items: {
            type: 'object',
            properties: {
              workOrderId: { type: 'string', enum: workOrderIds },
              crewId: { type: 'string', minLength: 1 },
              equipmentIds: {
                type: 'array',
                maxItems: 3,
                uniqueItems: true,
                items: { type: 'string', minLength: 1 },
              },
              priority: { type: 'integer', enum: priorities },
            },
            required: ['workOrderId', 'crewId'],
            additionalProperties: false,
          },
        },
      },
      required: [
        'expectedRunId',
        'expectedWorldRevision',
        'expectedPlanRevision',
        'assignments',
      ],
      additionalProperties: false,
    },
    execute: (rawInput, options) => {
      const signal = options?.signal
      const input = rawInput as {
        expectedRunId: string
        expectedWorldRevision: number
        expectedPlanRevision: number
        mode?: 'append' | 'replace'
        oxygenFloorHours?: number
        protectedCrewIds?: string[]
        horizonHours?: number
        stopCondition?: StopConditionInput
        assignments: RawWorkAssignment[]
      }
      const guarded = mutationGuard(input.expectedRunId, signal)
      if (guarded) return guarded
      const unavailable = operationsRequired()
      if (unavailable) return unavailable
      const current = useColonyStore.getState()
      if (
        input.expectedWorldRevision !== current.worldRevision ||
        input.expectedPlanRevision !== current.operationsPlan.revision
      ) {
        return stateResult(
          {
            ok: false,
            code: 'stale_revision',
            currentWorldRevision: current.worldRevision,
            currentPlanRevision: current.operationsPlan.revision,
          },
          'Inspect the Operations Plan again before editing it.',
        )
      }

      const parsedActions = expandWorkAssignments(input.assignments)
      const parsedStop = parseStopCondition(
        input.stopCondition ?? { kind: 'objective_complete' },
      )
      if (typeof parsedStop === 'string') {
        return stateResult(
          { ok: false, code: 'invalid_stop_condition', error: parsedStop },
          'Correct the typed stop condition and retry against the same inspected revisions.',
        )
      }

      const precommitGuard = mutationGuard(input.expectedRunId, signal)
      if (precommitGuard) return precommitGuard
      const staged = useColonyStore.getState().stagePlanBatch({
        expectedRunId: input.expectedRunId,
        expectedWorldRevision: input.expectedWorldRevision,
        expectedPlanRevision: input.expectedPlanRevision,
        mode: input.mode,
        brief: {
          objective: current.objective.id,
          constraints: {
            oxygenFloorHours: input.oxygenFloorHours ?? current.objective.recommendedOxygenFloorHours,
            protectedCrewIds: input.protectedCrewIds ?? [],
          },
          horizonHours: input.horizonHours ?? 12,
          stopCondition: parsedStop,
        },
        actions: parsedActions,
      }, 'agent')
      const snapshot = operationsPlanSnapshot()
      return stateResult(
        {
          ...staged,
          resolvedBrief: snapshot.plan.objective
            ? {
                objective: snapshot.plan.objective,
                constraints: snapshot.plan.constraints,
                horizonHours: snapshot.plan.horizonHours,
                stopCondition: snapshot.plan.stopCondition,
              }
            : null,
          ...snapshot,
        },
        staged.ok
          ? operationsPlanNext(snapshot)
          : 'The complete staging batch was rejected without changing the shared plan; inspect it before retrying.',
      )
    },
  },
  {
    name: OPERATIONAL_WEB_MCP_TOOL_NAMES[4],
    description:
      'Perform the same plan edits available in the visible plan: remove draft actions, clear to a fresh draft, or rebase a draft onto the current world revision. A supervised plan cannot be cleared until its current outcome is verified. Supply the run ID and plan revision you inspected.',
    inputSchema: {
      type: 'object',
      properties: {
        expectedRunId: expectedRunIdSchema,
        expectedPlanRevision: { type: 'integer', minimum: 1 },
        operation: { type: 'string', enum: ['remove_actions', 'clear', 'rebase'] },
        actionIds: {
          type: 'array',
          maxItems: 16,
          uniqueItems: true,
          items: { type: 'string' },
        },
      },
      required: ['expectedRunId', 'expectedPlanRevision', 'operation'],
      additionalProperties: false,
    },
    execute: (rawInput, options) => {
      const signal = options?.signal
      const input = rawInput as {
        expectedRunId: string
        expectedPlanRevision: number
        operation: 'remove_actions' | 'clear' | 'rebase'
        actionIds?: string[]
      }
      const guarded = mutationGuard(input.expectedRunId, signal)
      if (guarded) return guarded
      const unavailable = operationsRequired()
      if (unavailable) return unavailable
      const current = useColonyStore.getState()
      if (input.expectedPlanRevision !== current.operationsPlan.revision) {
        return stateResult(
          {
            ok: false,
            code: 'stale_plan',
            currentPlanRevision: current.operationsPlan.revision,
          },
          'Inspect the Operations Plan again before editing it.',
        )
      }
      const precommitGuard = mutationGuard(input.expectedRunId, signal)
      if (precommitGuard) return precommitGuard
      if (input.operation === 'remove_actions') {
        const removal = useColonyStore.getState().removePlanActionsBatch({
          expectedRunId: input.expectedRunId,
          expectedPlanRevision: input.expectedPlanRevision,
          actionIds: input.actionIds ?? [],
        }, 'agent')
        const snapshot = operationsPlanSnapshot()
        return stateResult(
          {
            ...removal,
            results: removal.editResults,
            ...snapshot,
          },
          removal.ok
            ? operationsPlanNext(snapshot)
            : 'No plan actions were removed; inspect the shared draft before retrying.',
        )
      }
      const results = input.operation === 'clear'
        ? [current.clearPlan('agent')]
        : [current.rebasePlan('agent')]
      const snapshot = operationsPlanSnapshot()
      const ok = results.length > 0 && results.every((result) => result.ok)
      return stateResult(
        {
          ok,
          results,
          ...snapshot,
        },
        ok
          ? operationsPlanNext(snapshot)
          : results[0]?.error ?? operationsPlanNext(snapshot),
      )
    },
  },
  {
    name: OPERATIONAL_WEB_MCP_TOOL_NAMES[5],
    description:
      'Atomically commit the validated shared draft using the exact run, world, and plan revisions from the latest inspection. Stale or invalid plans execute nothing.',
    inputSchema: {
      type: 'object',
      properties: {
        expectedRunId: expectedRunIdSchema,
        expectedWorldRevision: { type: 'integer', minimum: 1 },
        expectedPlanRevision: { type: 'integer', minimum: 1 },
      },
      required: ['expectedRunId', 'expectedWorldRevision', 'expectedPlanRevision'],
      additionalProperties: false,
    },
    execute: (rawInput, options) => {
      const signal = options?.signal
      const input = rawInput as {
        expectedRunId: string
        expectedWorldRevision: number
        expectedPlanRevision: number
      }
      const guarded = mutationGuard(input.expectedRunId, signal)
      if (guarded) return guarded
      const unavailable = operationsRequired()
      if (unavailable) return unavailable
      const precommitGuard = mutationGuard(input.expectedRunId, signal)
      if (precommitGuard) return precommitGuard
      const result = useColonyStore.getState().commitPlan(
        input.expectedWorldRevision,
        input.expectedPlanRevision,
        'agent',
      )
      const snapshot = operationsPlanSnapshot()
      return stateResult(
        { ...result, currentPlan: snapshot.plan, ...snapshot },
        operationsPlanNext(snapshot),
      )
    },
  },
  {
    name: OPERATIONAL_WEB_MCP_TOOL_NAMES[6],
    description:
      'Advance a committed plan by at most twelve simulated hours. The committed safety floor, horizon, and stop condition are always enforced; an optional typed stop adds an earlier observation boundary and cannot replace the committed stop. Supply the run ID and world revision you inspected.',
    inputSchema: {
      type: 'object',
      properties: {
        expectedRunId: expectedRunIdSchema,
        expectedWorldRevision: { type: 'integer', minimum: 1 },
        hours: { type: 'integer', minimum: 1, maximum: 12 },
        stopCondition: stopConditionSchema,
      },
      required: ['expectedRunId', 'expectedWorldRevision', 'hours'],
      additionalProperties: false,
    },
    execute: (rawInput, options) => {
      const signal = options?.signal
      const input = rawInput as {
        expectedRunId: string
        expectedWorldRevision: number
        hours: number
        stopCondition?: StopConditionInput
      }
      const guarded = mutationGuard(input.expectedRunId, signal)
      if (guarded) return guarded
      const unavailable = operationsRequired()
      if (unavailable) return unavailable
      const current = useColonyStore.getState()
      if (input.expectedWorldRevision !== current.worldRevision) {
        return stateResult(
          { ok: false, code: 'stale_world', currentWorldRevision: current.worldRevision },
          'Inspect the live moonbase and committed plan before advancing time.',
        )
      }
      if (current.operationsPlan.status === 'draft') {
        return stateResult(
          { ok: false, code: 'plan_not_committed' },
          'Validate and commit the shared Operations Plan before advancing time.',
        )
      }
      if (current.operationsPlan.status === 'completed') {
        const snapshot = operationsPlanSnapshot()
        return stateResult(
          { ok: false, code: 'plan_completed', ...snapshot },
          operationsPlanNext(snapshot),
        )
      }
      const parsedStop = input.stopCondition
        ? parseStopCondition(input.stopCondition)
        : undefined
      if (typeof parsedStop === 'string') {
        return stateResult(
          { ok: false, code: 'invalid_stop_condition', error: parsedStop },
          'Correct the stop condition and retry against the current world revision.',
        )
      }
      const precommitGuard = mutationGuard(input.expectedRunId, signal)
      if (precommitGuard) return precommitGuard
      const result = current.advanceTime(
        { hours: input.hours, stopCondition: parsedStop },
        'agent',
      )
      const nextState = useColonyStore.getState()
      const snapshot = operationsPlanSnapshot()
      return stateResult(
        {
          ok: true,
          ...result,
          ...snapshot,
          state: {
            runId: nextState.runId,
            time: {
              missionDay: nextState.missionDay,
              hour: nextState.hour,
              elapsedHours: nextState.elapsedHours,
            },
            worldRevision: nextState.worldRevision,
            settlementPhase: nextState.settlement.phase,
            reserves: nextState.reserves,
            power: nextState.power,
            laboratory: nextState.lab,
            research: nextState.research,
            alerts: nextState.alerts,
          },
        },
        operationsPlanNext(snapshot),
      )
    },
  },
  {
    name: OPERATIONAL_WEB_MCP_TOOL_NAMES[7],
    description:
      'Compare fresh state with the committed objective, oxygen floor, stop condition, laboratory pressure, and power constraint. Supply the run ID and world revision you inspected. Verification records workflow evidence and returns explicit checks and residual risks.',
    inputSchema: {
      type: 'object',
      properties: {
        expectedRunId: expectedRunIdSchema,
        expectedWorldRevision: { type: 'integer', minimum: 1 },
      },
      required: ['expectedRunId', 'expectedWorldRevision'],
      additionalProperties: false,
    },
    execute: (rawInput, options) => {
      const signal = options?.signal
      const input = rawInput as { expectedRunId: string; expectedWorldRevision: number }
      const guarded = mutationGuard(input.expectedRunId, signal)
      if (guarded) return guarded
      const unavailable = operationsRequired()
      if (unavailable) return unavailable
      const current = useColonyStore.getState()
      if (input.expectedWorldRevision !== current.worldRevision) {
        return stateResult(
          { ok: false, code: 'stale_world', currentWorldRevision: current.worldRevision },
          'Inspect the live moonbase again before verifying the result.',
        )
      }
      const precommitGuard = mutationGuard(input.expectedRunId, signal)
      if (precommitGuard) return precommitGuard
      const verification = current.verifyPlan('agent')
      const state = useColonyStore.getState()
      const snapshot = operationsPlanSnapshot()
      return stateResult(
        {
          ok: verification.status !== 'not_ready',
          verification,
          scenarioStatus: state.scenarioStatus,
          workflow: state.learning,
          ...snapshot,
        },
        verification.status === 'not_ready'
          ? 'The outcome is not ready to verify. Commit and supervise a bounded plan first.'
          : operationsPlanNext(snapshot),
      )
    },
  },
]

// Validate at the application boundary as well as advertising schemas to hosts.
// Hosts differ in schema enforcement; malformed calls must never reach a mutation.
const schemaValidator = new Ajv({ allErrors: true, ownProperties: true })
const validatedTool = (tool: SiteTool): WebMCP.ModelContextTool => {
  const validate = schemaValidator.compile(tool.inputSchema ?? { type: 'object' })
  return {
    ...tool,
    execute: (input, options) => {
      if (!validate(input)) {
        return stateResult(
          {
            ok: false,
            code: 'invalid_input',
            error: schemaValidator.errorsText(validate.errors),
          },
          'Use the advertised input schema, inspect the current state, and retry. Nothing was changed.',
        )
      }
      return tool.execute(input, options)
    },
  }
}

const landingCatalog = [...constructionTools(), beginFirstShiftTool()].map(validatedTool)
const operationsCatalog = [...operationsTools(), ...constructionTools()].map(validatedTool)

export const useWebMcpTools = (): WebMcpStatus => {
  const phase = useColonyStore((state) => state.settlement.phase)
  const catalogKey = phase === 'operations' ? 'operations' : 'landing'
  const tools = useMemo(
    () => catalogKey === 'operations' ? operationsCatalog : landingCatalog,
    [catalogKey],
  )
  return useToolRegistration(tools, catalogKey)
}
