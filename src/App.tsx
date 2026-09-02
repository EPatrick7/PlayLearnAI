import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { GameIcon, type GameIconName } from './components/GameIcon'
import { BackgroundMusicProvider, MusicToggle } from './audio/BackgroundMusic'
import { AgentLinkPanel } from './components/AgentLinkPanel'
import { MissionArrival } from './components/MissionArrival'
import { MoonbaseMap } from './components/MoonbaseMap'
import type { MapTileInspection } from './components/mapInspection'
import { PawnSprite, type PawnSpriteVariant } from './components/PawnSprite'
import { ConstructionClockControls } from './components/ConstructionClockControls'
import { SettlementBuilder } from './components/SettlementBuilder'
import {
  buildConstructionQueue,
  type ConstructionQueueCommand,
} from './components/constructionQueue'
import type { ConstructionOrder } from './game/constructionJobs'
import { incidentProfileMetadataForSeed } from './game/incidentProfiles'
import { recommendedOperationsResponse } from './game/recommendedResponse'
import { useColonyStore } from './game/store'
import type {
  Equipment,
  GroundingEvidenceKind,
  PlanBriefInput,
  Priority,
  StopCondition,
  WorkOrder,
  WorkOrderId,
} from './game/types'
import { useWebMcpTools } from './webmcp/registerTools'
import './styles.css'
import './tilemap.css'
import './construction.css'
import './pawn.css'
import './colony-theme.css'

type DockTab = 'work' | 'crew' | 'gear' | 'plan' | 'log'
type Selection =
  | { kind: 'module'; id: string }
  | { kind: 'crew'; id: string }
  | { kind: 'equipment'; id: string }
  | { kind: 'work'; id: WorkOrderId }
  | { kind: 'tile'; tile: MapTileInspection }

const formatClock = (hour: number) => `${String(hour).padStart(2, '0')}:00`
const formatLocation = (location: string) => location
  .split('-')
  .map((word) => word[0].toUpperCase() + word.slice(1))
  .join(' ')
const statusLabel = (status: string) => status.split('_').join(' ')
const initials = (name: string) => name.split(' ').map((part) => part[0]).join('')

const stopConditionLabel = (condition: StopCondition | null, workOrders: WorkOrder[] = []) => {
  if (!condition) return 'Not set'
  if (condition.kind === 'objective_complete') return 'Objective complete'
  if (condition.kind === 'critical_alert') return 'Critical alert'
  if (condition.kind === 'oxygen_below') return `O₂ below ${condition.thresholdHours}h`
  if (condition.kind === 'battery_below') return `Battery below ${condition.thresholdKwh} kWh`
  if (condition.kind === 'work_order_complete') {
    const order = workOrders.find((candidate) => candidate.id === condition.workOrderId)
    return `Complete ${order?.label ?? condition.workOrderId.replace('work-', '').replaceAll('-', ' ')}`
  }
  return 'Invalid stop condition'
}

const equipmentIcon = (item: Equipment): GameIconName => {
  if (item.type === 'rover') return 'map'
  if (item.type === 'medical_kit') return 'shield'
  return 'gear'
}

const tileSurfaceIcon = (tile: MapTileInspection): GameIconName => {
  if (tile.focusedItem) return tile.focusedItem.icon
  if (tile.surfaceKind === 'wall') return 'wall'
  if (tile.surfaceKind === 'door') return 'door'
  if (tile.surfaceKind === 'floor' || tile.surfaceKind === 'corridor') return 'floor'
  if (tile.surfaceKind === 'solar') return 'solar'
  if (tile.surfaceKind === 'landing-pad') return 'landingPad'
  return 'map'
}

const dockItems: Array<{ id: DockTab; label: string; icon: GameIconName }> = [
  { id: 'work', label: 'Work', icon: 'work' },
  { id: 'crew', label: 'Crew', icon: 'crew' },
  { id: 'gear', label: 'Gear', icon: 'gear' },
  { id: 'plan', label: 'Plan', icon: 'plan' },
  { id: 'log', label: 'History', icon: 'log' },
]

const pawnVariants: PawnSpriteVariant[] = ['umber', 'gold', 'olive', 'rose', 'copper', 'slate']
const pawnAccents = ['#a75b4c', '#527b7d', '#68805f', '#8a6378', '#9a7046', '#596f7c']

const constructionCompletionSubject = (order: ConstructionOrder) => {
  if (order.target.kind === 'boundary') {
    const boundary = order.target.construct ?? order.target.deconstruct
    const subject = boundary?.kind === 'door' ? 'door' : 'wall'
    return order.operation === 'deconstruct' ? `${subject} removal` : subject
  }
  const workstation = order.target.construct ?? order.target.deconstruct
  const subject = workstation?.label.toLowerCase() ?? 'workstation'
  return order.operation === 'deconstruct' ? `${subject} removal` : subject
}

const completedConstructionMessage = (
  completedOrders: readonly ConstructionOrder[],
  builderNames: readonly string[],
) => {
  const subjects = completedOrders.map(constructionCompletionSubject)
  const oneSubject = subjects.length > 0 && subjects.every((subject) => subject === subjects[0])
  const completedLabel = oneSubject
    ? `${subjects.length} ${subjects[0]}${subjects.length === 1 ? '' : 's'}`
    : `${subjects.length} ${subjects.length === 1 ? 'blueprint' : 'blueprints'}`
  const builders = [...new Set(builderNames)]
  return `${completedLabel} completed${builders.length > 0 ? ` by ${builders.join(' + ')}` : ''}.`
}

export const MISSION_ARRIVAL_SESSION_KEY = 'playlearnai-mission-arrival-complete-v1'
export const MISSION_ARRIVAL_TEST_BYPASS_VALUE = 'test-bypass'
export const MISSION_ARRIVAL_RESET_PENDING_VALUE = 'reset-pending'

function GameApplication({ onReplayArrival }: { onReplayArrival: () => void }) {
  const colony = useColonyStore()
  const webMcpStatus = useWebMcpTools()
  const [activeTab, setActiveTab] = useState<DockTab>('work')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [architectOpen, setArchitectOpen] = useState(false)
  const [constructionCompletionSummary, setConstructionCompletionSummary] = useState<string | null>(null)
  const [constructionCompletionToast, setConstructionCompletionToast] = useState<string | null>(null)
  const [incidentExpanded, setIncidentExpanded] = useState(false)
  const [incidentAnnouncement, setIncidentAnnouncement] = useState<{
    message: string
    runId: string
  } | null>(null)
  const [selectedOrderId, setSelectedOrderId] = useState<WorkOrderId>('work-seal-lab')
  const [selection, setSelection] = useState<Selection | null>(null)
  const operationsMapViewportRef = useRef<HTMLDivElement>(null)
  const operationsMapCenteredRef = useRef(false)
  const commandSheetHeadingRef = useRef<HTMLHeadingElement>(null)
  const verificationEvidenceRef = useRef<HTMLDivElement>(null)
  const focusVerificationEvidenceRef = useRef(false)
  const dockButtonRefs = useRef<Partial<Record<DockTab, HTMLButtonElement | null>>>({})
  const constructionCompletionReceipt = useRef(new Map<string, {
    order: ConstructionOrder
    builderName: string | null
  }>())
  const plan = colony.operationsPlan
  const nextIncidentProfile = incidentProfileMetadataForSeed(colony.seed + 1)
  const canStartNextIncident = colony.learning.completedLoops > 0
  const validation = colony.validatePlan()
  const isDraft = plan.status === 'draft'
  const hasCommittedPlan = plan.baseline !== null
  const selectedOrder = colony.workOrders.find((order) => order.id === selectedOrderId) ?? colony.workOrders[0]
  const declaredMilestoneId = plan.stopCondition?.kind === 'work_order_complete'
    ? plan.stopCondition.workOrderId
    : null
  const declaredMilestoneOrder = declaredMilestoneId
    ? colony.workOrders.find((order) => order.id === declaredMilestoneId)
    : null
  const milestoneChoiceLabel = declaredMilestoneOrder
    ? `Milestone · ${declaredMilestoneOrder.label}`
    : `Selected work completes · ${selectedOrder.label}`
  const recommendedResponse = recommendedOperationsResponse(colony)
  const recommendedResponseDetail = recommendedResponse?.detail ?? 'Recovery already complete'
  const verificationIsCurrent =
    colony.verification?.verifiedAtWorldRevision === colony.worldRevision &&
    colony.verification.verifiedAtHour === colony.elapsedHours
  const planStateLabel = isDraft
    ? 'Draft'
    : plan.status === 'committed'
      ? 'Running'
      : verificationIsCurrent
        ? 'Verified'
        : 'Ready to verify'
  const completedOutcomeTitle = colony.scenarioStatus === 'objective_complete'
    ? 'Recovery operation complete'
    : declaredMilestoneOrder
      ? `${declaredMilestoneOrder.label} complete`
      : plan.status === 'completed'
        ? `Plan stopped · ${statusLabel(colony.lastAdvance?.stopReason ?? 'declared_stop')}`
        : 'Committed plan in progress'
  const completedAdvanceLabels = colony.lastAdvance?.completedWorkOrderIds
    .map((orderId) => colony.workOrders.find((order) => order.id === orderId)?.label)
    .filter((label): label is string => Boolean(label)) ?? []
  const supervisionSummary = colony.lastAdvance
    ? `${colony.lastAdvance.advancedHours}h advanced · ${completedAdvanceLabels.length > 0
      ? `${completedAdvanceLabels.join(', ')} complete.`
      : 'Work continues.'}`
    : 'Plan in progress.'
  const canAdvancePlan = plan.status === 'committed' && colony.scenarioStatus === 'active'
  const selectedModuleId = selection?.kind === 'module' ? selection.id : null
  const selectedCrewId = selection?.kind === 'crew' ? selection.id : null
  const selectedEquipmentId = selection?.kind === 'equipment' ? selection.id : null
  const selectedModule = colony.modules.find((module) => module.id === selectedModuleId)
  const selectedCrew = colony.crew.find((member) => member.id === selectedCrewId)
  const selectedEquipment = colony.equipment.find((item) => item.id === selectedEquipmentId)
  const selectedTile = selection?.kind === 'tile' ? selection.tile : null
  const selectedTileItem = selectedTile?.focusedItem ?? null
  const stagedPriorityAction = plan.actions.find(
    (action) => action.kind === 'set_priority' && action.workOrderId === selectedOrder.id,
  )
  const displayedPriority = stagedPriorityAction?.kind === 'set_priority'
    ? stagedPriorityAction.priority
    : selectedOrder.priority

  const requiredEquipment = useMemo(
    () => colony.equipment.filter((item) => selectedOrder.requiredEquipment.includes(item.type)),
    [colony.equipment, selectedOrder.requiredEquipment],
  )
  const plannedTasks = colony.workOrders.flatMap((order) => {
    const actions = plan.actions.filter((action) => action.workOrderId === order.id)
    if (actions.length === 0) return []
    const crewNames: string[] = []
    const gearNames: string[] = []
    let priority: number | null = null
    actions.forEach((action) => {
      if (action.kind === 'assign_crew') {
        crewNames.push(colony.crew.find((member) => member.id === action.crewId)?.name.split(' ')[0] ?? action.crewId)
      } else if (action.kind === 'reserve_equipment') {
        gearNames.push(colony.equipment.find((item) => item.id === action.equipmentId)?.name ?? action.equipmentId)
      } else {
        priority = action.priority
      }
    })
    return [{
      actionIds: actions.map((action) => action.id),
      detail: [crewNames.join(' + '), gearNames.join(' + '), priority ? `P${priority}` : ''].filter(Boolean).join(' · '),
      id: order.id,
      label: order.label,
    }]
  })

  const effectiveSolar = colony.power.solarGenerationKw * (1 - colony.power.dustDeratePercent / 100)
  const objectiveChecklist = [
    { complete: colony.lab.atmosphere === 'yes' && colony.lab.sealed, label: 'Seal and pressurize lab' },
    { complete: colony.research.status === 'complete', label: 'Complete sintering research' },
    { complete: colony.reserves.minimumOxygenHours >= plan.constraints.oxygenFloorHours, label: `Keep O₂ above ${plan.constraints.oxygenFloorHours}h` },
  ]
  const objectiveProgress = objectiveChecklist.filter((check) => check.complete).length
  const constructionSpeed = colony.settlement.constructionSpeed
  const unfinishedConstructionCount = colony.settlement.constructionOrders.filter(
    (order) => order.status !== 'complete',
  ).length
  const colonyConstructionQueue = useMemo(() => buildConstructionQueue(
    colony.settlement.constructionOrders,
    {
      paused: constructionSpeed === 0,
      crewNames: new Map(colony.crew.map((member) => [member.id, member.name])),
    },
  ), [colony.crew, colony.settlement.constructionOrders, constructionSpeed])
  const colonyConstructionStatus = colonyConstructionQueue.reduce<ConstructionQueueCommand | null>(
    (strongest, command) => (
      !strongest || command.statusRank < strongest.statusRank ? command : strongest
    ),
    null,
  )

  const restoreDockFocus = useCallback((tab: DockTab) => {
    window.requestAnimationFrame(() => dockButtonRefs.current[tab]?.focus())
  }, [])

  const closeCommandDrawer = useCallback((restoreFocus = true) => {
    const tabToRestore = activeTab
    setDrawerOpen(false)
    if (restoreFocus) restoreDockFocus(tabToRestore)
  }, [activeTab, restoreDockFocus])

  const openTab = useCallback((tab: DockTab) => {
    if (drawerOpen && activeTab === tab) {
      closeCommandDrawer()
      return
    }
    setActiveTab(tab)
    setIncidentExpanded(false)
    setDrawerOpen(true)
  }, [activeTab, closeCommandDrawer, drawerOpen])

  const revealEvidence = useCallback(() => {
    focusVerificationEvidenceRef.current = true
    setActiveTab('plan')
    setIncidentExpanded(false)
    setDrawerOpen(true)
  }, [])

  const clearConstructionCompletion = () => {
    constructionCompletionReceipt.current.clear()
    setConstructionCompletionSummary(null)
    setConstructionCompletionToast(null)
  }

  useEffect(() => {
    if (constructionSpeed === 0 || unfinishedConstructionCount === 0) return
    const interval = window.setInterval(() => {
      const state = useColonyStore.getState()
      const speed = state.settlement.constructionSpeed
      if (speed === 0) return
      const orderContext = new Map(state.settlement.constructionOrders.map((order) => [
        order.id,
        {
          order,
          builderName: order.assignedCrewId
            ? state.crew.find((member) => member.id === order.assignedCrewId)?.name ?? null
            : null,
        },
      ]))
      const advanced = state.advanceConstruction(speed * 0.135)
      if (advanced.completedOrderIds.length === 0) return
      advanced.completedOrderIds.forEach((orderId) => {
        const context = orderContext.get(orderId)
        if (context) constructionCompletionReceipt.current.set(orderId, context)
      })
      const completedContexts = [...constructionCompletionReceipt.current.values()]
      if (completedContexts.length === 0) return
      const completedOrders = completedContexts.map((context) => context.order)
      const builderNames = completedContexts.flatMap((context) => (
        context.builderName ? [context.builderName] : []
      ))
      const message = completedConstructionMessage(completedOrders, builderNames)
      setConstructionCompletionSummary(message)
      setConstructionCompletionToast(message)
    }, 180)
    return () => window.clearInterval(interval)
  }, [constructionSpeed, unfinishedConstructionCount])

  useEffect(() => {
    if (!constructionCompletionToast) return
    const timeout = window.setTimeout(() => setConstructionCompletionToast(null), 3200)
    return () => window.clearTimeout(timeout)
  }, [constructionCompletionToast])

  useEffect(() => {
    if (colony.settlement.phase !== 'operations' || architectOpen) {
      operationsMapCenteredRef.current = false
      return
    }
    const centerActiveBaseOnNarrowScreens = () => {
      const viewport = operationsMapViewportRef.current
      if (!viewport || operationsMapCenteredRef.current) return
      const laboratory = colony.modules.find((module) => module.id === colony.lab.moduleId)
      if (!laboratory) return
      const cellSize = 40
      const targetX = (laboratory.position.x + laboratory.position.width / 2) * cellSize
      const targetY = (laboratory.position.y + laboratory.position.height / 2) * cellSize
      viewport.scrollLeft = Math.max(0, targetX - viewport.clientWidth / 2)
      viewport.scrollTop = Math.max(0, targetY - viewport.clientHeight / 2)
      operationsMapCenteredRef.current = true
    }
    let frame = window.requestAnimationFrame(centerActiveBaseOnNarrowScreens)
    const recenterAfterResize = () => {
      operationsMapCenteredRef.current = false
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(centerActiveBaseOnNarrowScreens)
    }
    window.addEventListener('resize', recenterAfterResize)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', recenterAfterResize)
    }
  }, [architectOpen, colony.lab.moduleId, colony.modules, colony.settlement.phase])

  useEffect(() => {
    const closeDrawer = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && drawerOpen) {
        event.preventDefault()
        closeCommandDrawer()
      }
      const target = event.target
      const editing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      if (
        event.key.toLowerCase() === 'b' &&
        !event.ctrlKey &&
        !event.metaKey &&
        !editing &&
        colony.settlement.phase === 'operations'
      ) {
        event.preventDefault()
        setDrawerOpen(false)
        setArchitectOpen(true)
      }
    }
    window.addEventListener('keydown', closeDrawer)
    return () => window.removeEventListener('keydown', closeDrawer)
  }, [closeCommandDrawer, colony.settlement.phase, drawerOpen])

  useEffect(() => {
    if (!drawerOpen || colony.settlement.phase !== 'operations' || architectOpen) return
    const frame = window.requestAnimationFrame(() => {
      if (
        focusVerificationEvidenceRef.current &&
        activeTab === 'plan' &&
        verificationEvidenceRef.current
      ) {
        focusVerificationEvidenceRef.current = false
        verificationEvidenceRef.current.scrollIntoView?.({ block: 'nearest' })
        verificationEvidenceRef.current.focus()
        return
      }
      commandSheetHeadingRef.current?.focus()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [activeTab, architectOpen, colony.settlement.phase, drawerOpen])

  if (colony.settlement.phase !== 'operations') {
    return (
      <SettlementBuilder
        agentLinkStatus={webMcpStatus}
        constructionCompletionSummary={constructionCompletionSummary}
        constructionCompletionToast={constructionCompletionToast}
        musicControl={<MusicToggle className="construction-music-action" />}
        onConstructionQueued={clearConstructionCompletion}
      />
    )
  }

  if (architectOpen) {
    return (
      <SettlementBuilder
        agentLinkStatus={webMcpStatus}
        constructionCompletionSummary={constructionCompletionSummary}
        constructionCompletionToast={constructionCompletionToast}
        musicControl={<MusicToggle className="construction-music-action" />}
        onConstructionQueued={clearConstructionCompletion}
        onExit={() => setArchitectOpen(false)}
      />
    )
  }

  const defaultStopCondition = (): StopCondition => ({ kind: 'objective_complete' })

  const ensureBrief = () => {
    if (plan.objective && plan.stopCondition) return
    colony.setPlanBrief({
      objective: colony.objective.id,
      constraints: plan.constraints,
      horizonHours: plan.horizonHours || 12,
      stopCondition: plan.stopCondition ?? defaultStopCondition(),
    })
  }

  const updateBrief = (patch: Partial<PlanBriefInput>) => {
    colony.setPlanBrief({
      objective: colony.objective.id,
      constraints: patch.constraints ?? plan.constraints,
      horizonHours: patch.horizonHours ?? (plan.horizonHours || 12),
      stopCondition: patch.stopCondition ?? plan.stopCondition ?? defaultStopCondition(),
    })
  }

  const recordInspectionEvidence = (
    detail: string,
    groundingKind: GroundingEvidenceKind,
    completesPhase?: boolean,
  ) => {
    const currentPhase = useColonyStore.getState().learning.currentPhase
    if (currentPhase !== 'ground') {
      colony.recordLearningEvidence(
        currentPhase,
        detail,
        'manual',
        { completesPhase: false },
      )
      return
    }
    colony.recordLearningEvidence('ground', detail, 'manual', {
      groundingKind,
      ...(completesPhase === undefined ? {} : { completesPhase }),
    })
  }

  const selectWorkOrder = (workOrderId: WorkOrderId, open = true) => {
    setIncidentExpanded(false)
    setSelectedOrderId(workOrderId)
    setSelection({ kind: 'work', id: workOrderId })
    setActiveTab('work')
    if (open) setDrawerOpen(true)
    recordInspectionEvidence(
      `Inspected ${colony.workOrders.find((order) => order.id === workOrderId)?.label ?? workOrderId} and its dependencies.`,
      'incident_telemetry',
    )
  }

  const inspectModule = (moduleId: string) => {
    setIncidentExpanded(false)
    const module = colony.modules.find((candidate) => candidate.id === moduleId)
    setSelection({ kind: 'module', id: moduleId })
    recordInspectionEvidence(
      `Inspected ${module?.name ?? moduleId}: atmosphere ${module?.atmosphere ?? 'unknown'}, condition ${module?.condition ?? 'unknown'}%.`,
      'incident_telemetry',
    )
  }

  const inspectCrew = (crewId: string) => {
    setIncidentExpanded(false)
    const member = colony.crew.find((candidate) => candidate.id === crewId)
    const qualified = Boolean(
      member && member.skills[selectedOrder.requiredSkill] >= selectedOrder.minimumSkill,
    )
    setSelection({ kind: 'crew', id: crewId })
    setDrawerOpen(false)
    recordInspectionEvidence(
      `${member?.name ?? crewId} has ${member?.skills[selectedOrder.requiredSkill] ?? 0} ${selectedOrder.requiredSkill}; ${qualified ? 'qualified' : `needs ${selectedOrder.minimumSkill}`} for ${selectedOrder.label}.`,
      'crew_equipment_comparison',
      qualified ? undefined : false,
    )
  }

  const inspectEquipment = (equipmentId: string) => {
    setIncidentExpanded(false)
    const item = colony.equipment.find((candidate) => candidate.id === equipmentId)
    setSelection({ kind: 'equipment', id: equipmentId })
    setDrawerOpen(false)
    recordInspectionEvidence(
      `Checked ${item?.name ?? equipmentId}'s condition and availability. Choose a qualified responder to finish this step.`,
      'crew_equipment_comparison',
      false,
    )
  }

  const inspectMapTile = (tile: MapTileInspection) => {
    setIncidentExpanded(false)
    setSelection({ kind: 'tile', tile })
    setDrawerOpen(false)
    recordInspectionEvidence(
      `Inspected tile ${tile.cell.x + 1},${tile.cell.y + 1}: ${tile.focusedItem?.label ?? tile.surfaceLabel}.`,
      'incident_telemetry',
    )
  }

  const stageCrew = (crewId: string) => {
    if (!isDraft) return
    ensureBrief()
    const existing = plan.actions.find(
      (action) => action.kind === 'assign_crew' && action.crewId === crewId && action.workOrderId === selectedOrder.id,
    )
    if (existing) colony.removePlanAction(existing.id)
    else colony.stagePlanAction({ kind: 'assign_crew', crewId, workOrderId: selectedOrder.id })
  }

  const stageEquipment = (equipmentId: string) => {
    if (!isDraft) return
    ensureBrief()
    const existing = plan.actions.find(
      (action) => action.kind === 'reserve_equipment' && action.equipmentId === equipmentId && action.workOrderId === selectedOrder.id,
    )
    if (existing) colony.removePlanAction(existing.id)
    else colony.stagePlanAction({ kind: 'reserve_equipment', equipmentId, workOrderId: selectedOrder.id })
  }

  const stagePriority = (priority: Priority) => {
    if (!isDraft) return
    ensureBrief()
    const existing = plan.actions.find(
      (action) => action.kind === 'set_priority' && action.workOrderId === selectedOrder.id,
    )
    if (existing) colony.removePlanAction(existing.id)
    colony.stagePlanAction({ kind: 'set_priority', workOrderId: selectedOrder.id, priority })
  }

  const clearPlannedTask = (actionIds: string[]) => {
    actionIds.forEach((actionId) => colony.removePlanAction(actionId))
  }

  const stageRecommendedResponse = () => {
    if (!isDraft || !recommendedResponse) return
    const current = useColonyStore.getState()
    const staged = current.stagePlanBatch({
      expectedRunId: current.runId,
      expectedWorldRevision: current.worldRevision,
      expectedPlanRevision: current.operationsPlan.revision,
      mode: 'replace',
      brief: {
        objective: current.objective.id,
        constraints: { oxygenFloorHours: 12, protectedCrewIds: [] },
        horizonHours: recommendedResponse.horizonHours,
        stopCondition: recommendedResponse.stopCondition,
      },
      actions: recommendedResponse.actions,
    }, 'manual')
    if (!staged.ok) {
      setIncidentAnnouncement({
        message: `The example was not staged: ${staged.error ?? 'inspect the current plan and try again.'}`,
        runId: current.runId,
      })
    } else {
      setIncidentAnnouncement(null)
    }
    setActiveTab('plan')
    setDrawerOpen(true)
  }

  const setStopCondition = (kind: StopCondition['kind'] | '') => {
    if (!kind) return
    let stopCondition: StopCondition
    if (kind === 'oxygen_below') stopCondition = { kind, thresholdHours: plan.constraints.oxygenFloorHours }
    else if (kind === 'battery_below') stopCondition = { kind, thresholdKwh: 12 }
    else if (kind === 'work_order_complete') stopCondition = { kind, workOrderId: selectedOrder.id }
    else stopCondition = { kind }
    updateBrief({ stopCondition })
  }

  const commitPlan = () => {
    const latest = useColonyStore.getState()
    latest.commitPlan(latest.worldRevision, latest.operationsPlan.revision)
  }

  const handleAlert = (title: string) => {
    if (title.toLowerCase().includes('dust')) {
      selectWorkOrder('work-clean-solar', false)
    } else {
      selectWorkOrder('work-seal-lab', false)
    }
  }

  const hasCurrentTelemetryEvidence = colony.learning.evidence.some((entry) => (
    entry.phase === 'ground' &&
    entry.learningLoop === colony.learning.completedLoops &&
    entry.groundingKind === 'incident_telemetry'
  ))

  const tutorialStep = verificationIsCurrent
    ? {
        action: 'Review evidence',
        detail: 'The live result now matches the plan. The operating loop is complete.',
        icon: 'verify' as const,
        id: 'complete' as const,
        number: 6,
        title: 'Outcome verified',
      }
    : plan.status === 'completed' || colony.scenarioStatus === 'objective_complete'
      ? {
          action: 'Verify outcome',
          detail: 'Compare the live colony with the safety limits you approved.',
          icon: 'verify' as const,
          id: 'review' as const,
          number: 6,
          title: 'Check the result',
        }
      : plan.status === 'committed'
        ? {
            action: 'Run plan',
            detail: 'Advance to the declared stop; the simulation pauses if a safeguard trips.',
            icon: 'fastForward' as const,
            id: 'run' as const,
            number: 5,
            title: 'Supervise execution',
          }
        : isDraft && plan.actions.length > 0
          ? {
              action: 'Review plan',
              detail: 'Check assignments, reserves, and the stopping rule before work begins.',
              icon: 'plan' as const,
              id: 'approve' as const,
              number: 4,
              title: 'Approve the safeguards',
            }
          : !colony.learning.achieved.ground && !hasCurrentTelemetryEvidence
            ? {
                action: 'Inspect breach',
                detail: 'Read the laboratory pressure and condition before assigning anyone.',
                icon: 'inspect' as const,
                id: 'inspect' as const,
                number: 1,
                title: 'See what changed',
              }
            : !colony.learning.achieved.ground
              ? {
                  action: 'Choose responder',
                  detail: `Find a crew member with ${selectedOrder.requiredSkill} ${selectedOrder.minimumSkill} or higher.`,
                  icon: 'crew' as const,
                  id: 'responder' as const,
                  number: 2,
                  title: 'Match skill to risk',
                }
              : {
                  action: 'Build response',
                  detail: 'Assign crew and required gear, or inspect the recommended response first.',
                  icon: 'work' as const,
                  id: 'assign' as const,
                  number: 3,
                  title: 'Create a safe plan',
                }

  const continueTutorial = () => {
    setIncidentExpanded(false)
    if (tutorialStep.id === 'inspect') {
      inspectModule('module-laboratory')
      return
    }
    openTab(tutorialStep.id === 'responder' ? 'crew' : tutorialStep.id === 'assign' ? 'work' : 'plan')
  }

  const resetRun = () => {
    if (!window.confirm('Reset this Moonbase run and replay the Aquila arrival?')) return
    setDrawerOpen(false)
    setSelection(null)
    clearConstructionCompletion()
    onReplayArrival()
  }

  const startNextIncidentRun = () => {
    if (useColonyStore.getState().learning.completedLoops <= 0) return
    const confirmed = window.confirm(
      `Start the ${nextIncidentProfile.name} incident? ` +
      'The current incident plan and progress will be replaced. ' +
      'Your built settlement will be preserved.',
    )
    if (!confirmed) return

    if (!colony.startNextIncident()) {
      setIncidentAnnouncement({
        message: 'The next incident could not start. The current incident remains unchanged.',
        runId: colony.runId,
      })
      return
    }

    const nextState = useColonyStore.getState()
    const startedProfile = incidentProfileMetadataForSeed(nextState.seed)
    setDrawerOpen(false)
    setSelection(null)
    setConstructionCompletionToast(null)
    setIncidentAnnouncement({
      message: `${startedProfile.name} started. Incident plan and progress were replaced; the built settlement was preserved.`,
      runId: nextState.runId,
    })
  }

  const selectionTitle = selection?.kind === 'module'
    ? selectedModule?.name ?? selection.id
    : selection?.kind === 'crew'
      ? selectedCrew?.name ?? selection.id
      : selection?.kind === 'equipment'
        ? selectedEquipment?.name ?? selection.id
        : selection?.kind === 'work'
          ? selectedOrder.label
          : selection?.kind === 'tile'
            ? selectedTileItem?.label ?? selection.tile.surfaceLabel
            : ''
  const selectionKindLabel = selection?.kind === 'tile'
    ? selectedTileItem?.kind === 'boundary'
      ? 'Structure'
      : selectedTileItem?.kind === 'workstation'
        ? 'Workstation'
        : selectedTileItem?.kind === 'blueprint'
          ? 'Blueprint'
          : selectedTileItem?.kind === 'crew'
            ? 'Colonist'
            : selectedTileItem?.kind === 'equipment'
              ? 'Equipment'
              : selectedTileItem?.kind === 'work'
                ? 'Work order'
                : selectedTileItem?.kind === 'stockpile'
                  ? 'Stockpile'
                  : 'Tile'
    : selection?.kind ?? ''
  const selectionIcon: GameIconName = selection?.kind === 'crew'
    ? 'crew'
    : selection?.kind === 'equipment'
      ? selectedEquipment ? equipmentIcon(selectedEquipment) : 'gear'
      : selection?.kind === 'work'
        ? 'work'
        : selection?.kind === 'tile' && selectedTile
          ? tileSurfaceIcon(selectedTile)
          : 'map'

  const selectedOrderPercent = Math.min(100, Math.round((selectedOrder.progressHours / selectedOrder.durationHours) * 100))
  const missionFailed = colony.scenarioStatus === 'failed'
  const objectiveTitle = missionFailed
    ? 'Oxygen depleted'
    : colony.scenarioStatus === 'objective_complete'
      ? 'Laboratory recovered'
      : 'Recover the laboratory'

  return (
    <div className={`game-shell scenario-${colony.scenarioStatus}`}>
      <header className="game-topbar">
        <button className="brand-lockup" onClick={() => { inspectModule('module-habitat'); setDrawerOpen(false) }} type="button">
          <span className="brand-mark"><i />PL</span>
          <span><small>PlayLearnAI</small><strong>Shackleton Relay</strong></span>
        </button>

        <section className="resource-rack" aria-label="Colony resources">
          <div className={`resource-chip ${colony.reserves.oxygenHours <= plan.constraints.oxygenFloorHours + 4 ? 'warning' : 'nominal'}`} title="Oxygen reserve">
            <GameIcon name="oxygen" /><span><small>Oxygen</small><strong>{colony.reserves.oxygenHours.toFixed(1)}h</strong></span>
          </div>
          <div className={`resource-chip ${colony.power.status}`} title="Solar generation and demand">
            <GameIcon name="power" /><span><small>Grid</small><strong>{effectiveSolar.toFixed(0)}/{colony.power.demandKw} kW</strong></span>
          </div>
        </section>

        <div className="mission-time">
          <span><small>Mission day</small><strong>{colony.missionDay}</strong></span>
          <span className="clock-value">{formatClock(colony.hour)}</span>
          <MusicToggle className="icon-button" />
          <AgentLinkPanel
            learningPhase={colony.learning.currentPhase}
            settlementPhase={colony.settlement.phase}
            status={webMcpStatus}
          />
          <button aria-label="Restart mission" className="icon-button" onClick={resetRun} title="Restart mission" type="button"><GameIcon name="reset" /></button>
        </div>
      </header>

      <main className="world-stage">
        <div
          aria-label="Scrollable colony map viewport"
          className="operations-map-scroll"
          ref={operationsMapViewportRef}
          role="region"
        >
          <MoonbaseMap
            constructionCrew={colony.settlement.constructionCrew}
            constructionLayout={colony.settlement.layout}
            constructionOrders={colony.settlement.constructionOrders}
            constructionPaused={colony.settlement.constructionSpeed === 0}
            crew={colony.crew}
            dustActive={colony.dust.active}
            equipment={colony.equipment}
            height={colony.map.height}
            modules={colony.modules}
            onInspectModule={(moduleId) => {
              inspectModule(moduleId)
              setDrawerOpen(false)
            }}
            onInspectTile={inspectMapTile}
            onSelectCrew={inspectCrew}
            onSelectEquipment={inspectEquipment}
            onSelectWorkOrder={(workOrderId) => {
              selectWorkOrder(workOrderId, false)
              setDrawerOpen(false)
            }}
            plan={plan}
            selectedCrewId={selectedCrewId}
            selectedEquipmentId={selectedEquipmentId}
            selectedModuleId={selectedModuleId ?? ''}
            selectedWorkOrderId={selection?.kind === 'work' ? selection.id : null}
            terrainSeed={colony.settlement.terrainSeed ?? colony.seed}
            width={colony.map.width}
            workOrders={colony.workOrders}
          />
        </div>

        <section
          className={`colonist-strip ${drawerOpen && activeTab === 'crew' ? 'expanded' : ''}`}
          aria-label="Colony crew"
        >
            {colony.crew.map((member, index) => (
              <button
                aria-label={`${member.name}, ${member.role}. ${member.status}. Health ${Math.round(member.health)} percent.`}
                className={`colonist-card ${member.status} ${selectedCrewId === member.id ? 'selected' : ''}`}
                key={member.id}
                onClick={() => setSelection({ kind: 'crew', id: member.id })}
                title={`${member.name}, ${member.role}. ${member.status}. Health ${Math.round(member.health)}%.`}
                type="button"
              >
                <span className="portrait" style={{ '--health': `${member.health}%` } as React.CSSProperties}>
                  <PawnSprite
                    accent={pawnAccents[index % pawnAccents.length]}
                    initials={initials(member.name)}
                    showStatusDot
                    size="compact"
                    status={member.status}
                    suited={Boolean(member.equippedEvaSuitId)}
                    variant={pawnVariants[index % pawnVariants.length]}
                  />
                </span>
                <span><strong>{member.name.split(' ')[0]}</strong><small>{member.taskId ? 'On task' : member.status}</small></span>
              </button>
            ))}
        </section>

        <section className={`incident-card ${colony.scenarioStatus} ${incidentExpanded ? 'expanded' : 'collapsed'}`} aria-label="Current objective">
          <div className="incident-heading">
            <span className="incident-icon"><GameIcon name={colony.scenarioStatus === 'objective_complete' ? 'check' : 'alert'} /></span>
            <span><small>{missionFailed ? 'Mission failed' : colony.scenarioStatus === 'objective_complete' ? 'Objective complete' : 'Mission objective'}</small><strong>{objectiveTitle}</strong></span>
            <b>{objectiveProgress}/3</b>
            <button
              aria-controls="incident-detail-panel"
              aria-expanded={incidentExpanded}
              aria-label={incidentExpanded ? 'Collapse priority order' : 'Expand priority order'}
              className="incident-toggle"
              onClick={() => setIncidentExpanded((expanded) => !expanded)}
              type="button"
            >
              <GameIcon name="chevron" />
            </button>
          </div>
          <div
            aria-label={missionFailed ? 'Tutorial paused' : `Tutorial step ${tutorialStep.number} of 6`}
            className={`tutorial-next ${missionFailed ? 'failed' : `tutorial-${tutorialStep.id}`}`}
          >
            <span className="tutorial-step-number"><small>{missionFailed ? 'Guide' : 'Step'}</small><b>{missionFailed ? '—' : `${tutorialStep.number}/6`}</b></span>
            <span className="tutorial-step-copy">
              <strong>{missionFailed ? 'Recover the mission' : tutorialStep.title}</strong>
              <small>{missionFailed ? 'Restart from the one-habitat landing site.' : tutorialStep.detail}</small>
            </span>
            <button
              aria-label={missionFailed ? 'Restart mission' : tutorialStep.action}
              onClick={missionFailed ? resetRun : continueTutorial}
              title={missionFailed ? 'Restart mission' : tutorialStep.action}
              type="button"
            >
              <GameIcon name={missionFailed ? 'reset' : tutorialStep.icon} />
              <span>{missionFailed ? 'Restart' : tutorialStep.action}</span>
            </button>
          </div>
          <div className="incident-details" id="incident-detail-panel">
            <div className="objective-progress" aria-label={`${objectiveProgress} of 3 objective conditions complete`}><i style={{ width: `${(objectiveProgress / 3) * 100}%` }} /></div>
            <div className="objective-checklist" aria-label="Objective checklist">
              {objectiveChecklist.map((check) => (
                <span className={check.complete ? 'complete' : ''} key={check.label}>
                  <GameIcon name={check.complete ? 'check' : 'work'} />
                  {check.label}
                </span>
              ))}
            </div>
            {colony.alerts.length > 0 && (
              <div aria-label="Active alerts" className="incident-alerts" role="group">
                {colony.alerts.slice(0, 2).map((alert) => (
                  <button
                    aria-label={`${alert.title}. ${alert.detail}`}
                    className={alert.severity}
                    key={alert.id}
                    onClick={() => handleAlert(alert.title)}
                    type="button"
                  >
                    <GameIcon name={alert.severity === 'critical' ? 'alert' : 'warning'} />
                    <span>{alert.title}</span>
                    <GameIcon name="chevron" />
                  </button>
                ))}
              </div>
            )}
            {canStartNextIncident && (
              <button
                aria-label={`Start next incident. Next profile: ${nextIncidentProfile.name}. Built settlement preserved.`}
                className="incident-profile-next"
                onClick={startNextIncidentRun}
                type="button"
              >
                <GameIcon name="fastForward" />
                <span><strong>Next incident</strong><small>{nextIncidentProfile.name}</small></span>
                <GameIcon name="chevron" />
              </button>
            )}
            {incidentAnnouncement?.runId === colony.runId && (
              <p className="incident-profile-announcement" role="status">
                {incidentAnnouncement.message}
              </p>
            )}
          </div>
        </section>

        {selection && !drawerOpen && <section
          aria-label={`${selectionTitle} inspector`}
          aria-live="polite"
          className={`selection-inspector selection-${selection.kind}`}
          data-inspected-kind={selectedTileItem?.kind}
        >
          <div className="selection-heading">
            <span className="selection-kind"><GameIcon name={selectionIcon} /></span>
            <span><small>{selectionKindLabel}</small><strong>{selectionTitle}</strong></span>
            <button aria-label="Close inspector" className="inspector-close" onClick={() => setSelection(null)} type="button"><GameIcon name="close" /></button>
          </div>
          {selection.kind === 'module' && selectedModule && (
            <p className="selection-context"><GameIcon name="habitat" />{statusLabel(selectedModule.type)} · {selectedModule.atmosphere === 'yes' ? 'Pressurized' : selectedModule.atmosphere === 'low' ? 'Low pressure' : 'Vacuum'}</p>
          )}
          {selection.kind === 'crew' && selectedCrew && (
            <p className="selection-context"><GameIcon name="crew" />{selectedCrew.role} · {statusLabel(selectedCrew.status)}</p>
          )}
          {selection.kind === 'equipment' && selectedEquipment && (
            <p className="selection-context"><GameIcon name={equipmentIcon(selectedEquipment)} />{statusLabel(selectedEquipment.type)} · {statusLabel(selectedEquipment.status)}</p>
          )}
          {selection.kind === 'work' && (
            <p className="selection-context"><GameIcon name="work" />{selectedOrder.detail}</p>
          )}
          {selectedTile && (
            <p className="selection-context"><GameIcon name={tileSurfaceIcon(selectedTile)} />{selectedTileItem?.detail ?? selectedTile.surfaceDetail} · Tile {selectedTile.cell.x + 1}, {selectedTile.cell.y + 1}</p>
          )}
          {selectedModule && (
            <div className="selection-stats">
              <span><small>Atmosphere</small><strong className={`atmosphere-${selectedModule.atmosphere}`}>{selectedModule.atmosphere.toUpperCase()}</strong></span>
              <span><small>Condition</small><strong>{selectedModule.condition}%</strong></span>
              <span><small>Power</small><strong>P{selectedModule.powerPriority}</strong></span>
              <span><small>Crew</small><strong>{colony.crew.filter((member) => member.location === selectedModule.location).length}</strong></span>
              {selectedModule.id === 'module-laboratory' &&
                tutorialStep.id === 'responder' && (
                  <button className="inspector-action" onClick={continueTutorial} type="button">
                    Choose responder <GameIcon name="chevron" />
                  </button>
                )}
            </div>
          )}
          {selectedCrew && (
            <div className="selection-stats">
              <span><small>Health</small><strong>{Math.round(selectedCrew.health)}%</strong></span>
              <span><small>Fatigue</small><strong>{Math.round(selectedCrew.fatigue)}%</strong></span>
              <span><small>Location</small><strong>{formatLocation(selectedCrew.location)}</strong></span>
            </div>
          )}
          {selectedEquipment && (
            <div className="selection-stats">
              <span><small>Status</small><strong>{statusLabel(selectedEquipment.status)}</strong></span>
              <span><small>Condition</small><strong>{selectedEquipment.condition}%</strong></span>
              <span><small>Location</small><strong>{formatLocation(selectedEquipment.location)}</strong></span>
            </div>
          )}
          {selection.kind === 'work' && (
            <div className="selection-stats">
              <span><small>Status</small><strong>{statusLabel(selectedOrder.status)}</strong></span>
              <span><small>Progress</small><strong>{selectedOrderPercent}%</strong></span>
              <span><small>Duration</small><strong>{selectedOrder.durationHours}h</strong></span>
              <button className="inspector-action" onClick={() => openTab('work')} type="button">Open work <GameIcon name="chevron" /></button>
            </div>
          )}
          {selectedTile && selectedTileItem && (
            <div className="selection-stats tile-selection-stats">
              {selectedTileItem.stats.map((stat) => (
                <span key={stat.label}><small>{stat.label}</small><strong>{stat.value}</strong></span>
              ))}
            </div>
          )}
          {selectedTile && !selectedTileItem && (
            <div className="selection-stats tile-selection-stats">
              <span><small>Surface</small><strong>{selectedTile.surfaceLabel}</strong></span>
              <span><small>Room</small><strong>{selectedTile.roomLabel ?? 'Exterior'}</strong></span>
              <span><small>Contents</small><strong>{selectedTile.contents.length}</strong></span>
              <span><small>Pressure</small><strong>{selectedTile.atmosphere === 'yes' ? 'Nominal' : selectedTile.atmosphere === 'low' ? 'Low' : 'Vacuum'}</strong></span>
            </div>
          )}
        </section>}

        {!drawerOpen && unfinishedConstructionCount > 0 && (
          <section
            aria-label="Simulation controls"
            className="time-controls has-construction-clock"
          >
            <button
              aria-label={unfinishedConstructionCount > 0
                ? `Open Architect, ${unfinishedConstructionCount} unfinished construction ${unfinishedConstructionCount === 1 ? 'job' : 'jobs'}. ${colonyConstructionStatus?.activity ?? 'Waiting for a builder'}.`
                : 'Open Architect. No unfinished construction jobs.'}
              className="world-construction-status"
              onClick={() => {
                setDrawerOpen(false)
                setArchitectOpen(true)
              }}
              title="Open Architect and inspect construction"
              type="button"
            >
              <GameIcon name="work" />
              {unfinishedConstructionCount > 0 && (
                <b aria-hidden="true" className="world-construction-count">{unfinishedConstructionCount}</b>
              )}
              <span>
                <strong>{unfinishedConstructionCount > 0
                  ? `${unfinishedConstructionCount} build ${unfinishedConstructionCount === 1 ? 'job' : 'jobs'}`
                  : 'No build jobs'}</strong>
                <small>{colonyConstructionStatus?.activity ?? 'Open Architect to build'}</small>
              </span>
            </button>
            <ConstructionClockControls
              className="world-construction-speed"
              label="Construction speed"
              onChange={colony.setConstructionSpeed}
              speed={constructionSpeed}
            />
          </section>
        )}

        {colony.verification && verificationIsCurrent && !(drawerOpen && activeTab === 'plan') && (
          <section className={`outcome-banner ${colony.verification.status}`} aria-live="polite">
            <span><GameIcon name={colony.verification.status === 'success' ? 'check' : 'warning'} /></span>
            <span><small>Verification {colony.verification.status}</small><strong>{colony.verification.summary}</strong></span>
            <button onClick={revealEvidence} type="button">View evidence</button>
          </section>
        )}

        <section
          aria-hidden={!drawerOpen}
          aria-labelledby={`command-sheet-title-${activeTab}`}
          className={`command-sheet ${drawerOpen ? 'open' : ''}`}
          id="colony-command-sheet"
          inert={!drawerOpen}
        >
          <header className="sheet-header">
            <span>
              <GameIcon name={dockItems.find((item) => item.id === activeTab)?.icon ?? 'plan'} />
              <h2
                className="sheet-title"
                id={`command-sheet-title-${activeTab}`}
                ref={commandSheetHeadingRef}
                tabIndex={-1}
              >
                {dockItems.find((item) => item.id === activeTab)?.label}
              </h2>
            </span>
            {unfinishedConstructionCount > 0 && (
              <ConstructionClockControls
                className="sheet-construction-speed"
                label="Construction speed"
                onChange={colony.setConstructionSpeed}
                speed={constructionSpeed}
              />
            )}
            <button aria-label="Close command panel" onClick={() => closeCommandDrawer()} type="button"><GameIcon name="close" /></button>
          </header>

          {activeTab === 'work' && (
            <div className="sheet-body work-sheet">
              <div className="work-chain" aria-label="Incident work chain">
                {colony.workOrders.map((order, index) => {
                  const percent = Math.min(100, Math.round((order.progressHours / order.durationHours) * 100))
                  const configured = plan.actions.some((action) => action.workOrderId === order.id) || order.assignedCrewIds.length > 0
                  return (
                    <button className={`work-node ${selectedOrder.id === order.id ? 'selected' : ''} ${order.status} ${configured ? 'configured' : ''}`} key={order.id} onClick={() => selectWorkOrder(order.id, false)} type="button">
                      <span className="work-node-index">{order.status === 'complete' ? <GameIcon name="check" /> : index + 1}</span>
                      <span><strong>{order.label}</strong><small>{statusLabel(order.status)} · {order.durationHours}h</small><i><b style={{ width: `${percent}%` }} /></i></span>
                      {index < colony.workOrders.length - 1 && index < 2 && <GameIcon name="chevron" />}
                    </button>
                  )
                })}
              </div>

              <article className="work-focus">
                <header>
                  <span><small>Selected order</small><strong>{selectedOrder.label}</strong></span>
                  {isDraft && <label className="priority-control">Priority<select aria-label="Work priority" onChange={(event) => stagePriority(Number(event.target.value) as Priority)} value={displayedPriority}>{[1, 2, 3, 4, 5].map((priority) => <option key={priority} value={priority}>{priority}{priority === 5 ? ' · highest' : ''}</option>)}</select></label>}
                </header>
                <p>{selectedOrder.detail}</p>
                <div className="work-tags"><span><GameIcon name="crew" />{selectedOrder.requiredSkill} {selectedOrder.minimumSkill}+</span><span><GameIcon name="clock" />{selectedOrder.durationHours} hours</span><span className={`hazard-${selectedOrder.hazard}`}><GameIcon name="shield" />{selectedOrder.hazard}</span></div>
              </article>

              <div className="loadout-column">
                <header><span>Assign crew</span><small>Best fit first</small></header>
                <div className="loadout-scroll">
                  {[...colony.crew].sort((a, b) => b.skills[selectedOrder.requiredSkill] - a.skills[selectedOrder.requiredSkill]).map((member, rank) => {
                    const crewIndex = Math.max(0, colony.crew.findIndex((candidate) => candidate.id === member.id))
                    const staged = plan.actions.some((action) => action.kind === 'assign_crew' && action.crewId === member.id && action.workOrderId === selectedOrder.id)
                    const committed = selectedOrder.assignedCrewIds.includes(member.id)
                    const conflict = plan.actions.some((action) => action.kind === 'assign_crew' && action.crewId === member.id && action.workOrderId !== selectedOrder.id)
                    const qualified = member.skills[selectedOrder.requiredSkill] >= selectedOrder.minimumSkill
                    return (
                      <button aria-pressed={staged || committed} className={`loadout-card ${staged || committed ? 'staged' : ''} ${!qualified ? 'unqualified' : ''}`} disabled={!isDraft || conflict || committed} key={member.id} onClick={() => stageCrew(member.id)} title={conflict ? 'Already staged for another order' : `${member.skills[selectedOrder.requiredSkill]} ${selectedOrder.requiredSkill}`} type="button">
                        <span className="mini-portrait">
                          <PawnSprite
                            accent={pawnAccents[crewIndex % pawnAccents.length]}
                            initials={initials(member.name)}
                            size="compact"
                            status={member.status}
                            suited={Boolean(member.equippedEvaSuitId)}
                            variant={pawnVariants[crewIndex % pawnVariants.length]}
                          />
                        </span>
                        <span><strong>{member.name}</strong><small>{member.role}</small></span>
                        <b>{rank === 0 ? 'Best · ' : ''}{selectedOrder.requiredSkill.slice(0, 3).toUpperCase()} {member.skills[selectedOrder.requiredSkill]}</b>
                        <i>{staged || committed ? <GameIcon name="check" /> : <GameIcon name="plus" />}</i>
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="loadout-column gear-loadout">
                <header><span>Required gear</span><small>{requiredEquipment.length ? 'Choose one of each' : formatLocation(selectedOrder.location)}</small></header>
                <div className="loadout-scroll">
                  {requiredEquipment.length ? requiredEquipment.map((item) => {
                    const staged = plan.actions.some((action) => action.kind === 'reserve_equipment' && action.equipmentId === item.id && action.workOrderId === selectedOrder.id)
                    const committed = selectedOrder.reservedEquipmentIds.includes(item.id)
                    const conflict = plan.actions.some((action) => action.kind === 'reserve_equipment' && action.equipmentId === item.id && action.workOrderId !== selectedOrder.id)
                    const serviceable = item.condition >= 65
                    return (
                      <button aria-pressed={staged || committed} className={`loadout-card gear-card ${staged || committed ? 'staged' : ''} ${!serviceable ? 'unserviceable' : ''}`} disabled={!isDraft || conflict || committed || !serviceable} key={item.id} onClick={() => stageEquipment(item.id)} title={!serviceable ? 'Below the 65% incident-work condition floor' : conflict ? 'Already staged for another order' : item.name} type="button">
                        <span className="gear-symbol"><GameIcon name={equipmentIcon(item)} /></span>
                        <span><strong>{item.name}</strong><small>{formatLocation(item.location)} · {item.condition}%{!serviceable ? ' · service required' : ''}</small></span>
                        <i>{staged || committed ? <GameIcon name="check" /> : <GameIcon name="plus" />}</i>
                      </button>
                    )
                  }) : <div className="no-gear"><GameIcon name="check" /><span><strong>No gear needed</strong><small>Crew assignment only</small></span></div>}
                </div>
              </div>

              <div className="work-sheet-actions">
                {isDraft && <button className="smart-plan-button" disabled={!recommendedResponse} onClick={stageRecommendedResponse} title={recommendedResponseDetail} type="button"><GameIcon name="plan" /><span><strong>Use recommended plan</strong><small>Assign crew and gear</small></span></button>}
                <button className="primary-action" onClick={() => openTab('plan')} type="button"><span>Review plan</span><b>{plan.actions.length}</b><GameIcon name="chevron" /></button>
              </div>
            </div>
          )}

          {activeTab === 'crew' && (
            <div className="sheet-body roster-sheet">
              <div className="roster-grid">
                {colony.crew.map((member, index) => (
                    <button aria-pressed={selectedCrewId === member.id} className={`roster-card ${selectedCrewId === member.id ? 'selected' : ''}`} key={member.id} onClick={() => inspectCrew(member.id)} type="button">
                    <span className="large-portrait">
                      <PawnSprite
                        accent={pawnAccents[index % pawnAccents.length]}
                        initials={initials(member.name)}
                        showStatusDot
                        status={member.status}
                        suited={Boolean(member.equippedEvaSuitId)}
                        variant={pawnVariants[index % pawnVariants.length]}
                      />
                    </span>
                    <span className="roster-copy"><small>{member.status}</small><strong>{member.name}</strong><em>{member.role} · {selectedOrder.requiredSkill.slice(0, 3).toUpperCase()} {member.skills[selectedOrder.requiredSkill]}{member.skills[selectedOrder.requiredSkill] >= selectedOrder.minimumSkill ? ' · Qualified' : ''}</em></span>
                    <span className="vital-bars"><i><b style={{ width: `${member.health}%` }} /></i><small>Health {Math.round(member.health)}</small><i className="fatigue"><b style={{ width: `${member.fatigue}%` }} /></i><small>Fatigue {Math.round(member.fatigue)}</small></span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'gear' && (
            <div className="sheet-body gear-sheet">
              <div className="gear-grid">
                {colony.equipment.map((item) => {
                  const stagedAction = plan.actions.find((action) => action.kind === 'reserve_equipment' && action.equipmentId === item.id)
                  const order = stagedAction ? colony.workOrders.find((candidate) => candidate.id === stagedAction.workOrderId) : null
                  return (
                    <button aria-pressed={selectedEquipmentId === item.id} className={`inventory-card ${selectedEquipmentId === item.id ? 'selected' : ''} ${item.status}`} key={item.id} onClick={() => inspectEquipment(item.id)} type="button">
                      <span className="inventory-art"><GameIcon name={equipmentIcon(item)} /></span>
                      <span><small>{statusLabel(item.status)}</small><strong>{item.name}</strong><em>{formatLocation(item.location)}</em></span>
                      <span className="condition-meter"><i><b style={{ width: `${item.condition}%` }} /></i>{item.condition}%</span>
                      {order && <span className="reserved-tag">→ {order.label}</span>}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {activeTab === 'plan' && (
            <div className={`sheet-body plan-sheet plan-${plan.status} ${verificationIsCurrent ? 'plan-verified' : ''}`}>
              <section className="brief-controls">
                <header><span><small>Mission plan</small><strong>Laboratory recovery</strong></span><b className={`plan-state ${plan.status}`}>{planStateLabel}</b></header>
                {isDraft ? (
                  <details className="plan-safeguards">
                    <summary>
                      <span><strong>Safety limits</strong><small>{plan.constraints.oxygenFloorHours}h O₂ · {plan.horizonHours || 12}h max · {stopConditionLabel(plan.stopCondition, colony.workOrders)}</small></span>
                      <GameIcon name="chevron" />
                    </summary>
                    <div className="brief-grid">
                      <label><span>O₂ minimum</span><div className="number-field"><input aria-label="O₂ reserve floor hours" max={colony.reserves.oxygenHours} min={8} onChange={(event) => updateBrief({ constraints: { ...plan.constraints, oxygenFloorHours: Number(event.target.value) } })} type="number" value={plan.constraints.oxygenFloorHours} /><i>hours</i></div></label>
                      <label><span>Protect crew</span><select aria-label="Protected crew" onChange={(event) => updateBrief({ constraints: { ...plan.constraints, protectedCrewIds: event.target.value ? [event.target.value] : [] } })} value={plan.constraints.protectedCrewIds[0] ?? ''}><option value="">None</option>{colony.crew.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
                      <label><span>Time limit</span><div className="segment-control">{[8, 10, 12].map((hours) => <button aria-label={`${hours} hour horizon`} className={plan.horizonHours === hours ? 'active' : ''} key={hours} onClick={() => updateBrief({ horizonHours: hours })} type="button">{hours}h</button>)}</div></label>
                      <label><span>Stop at</span><select aria-label="Stop condition" onChange={(event) => setStopCondition(event.target.value as StopCondition['kind'] | '')} value={plan.stopCondition?.kind ?? ''}><option disabled value="">Choose…</option><option value="objective_complete">Objective complete</option><option value="critical_alert">Critical alert</option><option value="oxygen_below">Oxygen floor reached</option><option value="battery_below">Battery below 12 kWh</option><option value="work_order_complete">{milestoneChoiceLabel}</option></select></label>
                    </div>
                  </details>
                ) : <div className="committed-summary"><span><small>Floor</small>{plan.constraints.oxygenFloorHours}h O₂</span><span><small>Horizon</small>{plan.horizonHours}h</span><span><small>Stop</small>{stopConditionLabel(plan.stopCondition, colony.workOrders)}</span></div>}
              </section>

              {isDraft && recommendedResponse && plan.actions.length === 0 && (
                <section className="plan-recommendation">
                  <span className="forecast-symbol"><GameIcon name="plan" /></span>
                  <span><small>Recommended response</small><strong>{recommendedResponse.detail}</strong><p>{recommendedResponse.rationale}</p></span>
                  <button onClick={stageRecommendedResponse} type="button">Stage it <GameIcon name="chevron" /></button>
                </section>
              )}

              <section className="staged-queue">
                <header><span>{isDraft ? 'Assignments' : 'Completed tasks'}</span><small>{plannedTasks.length} {plannedTasks.length === 1 ? 'task' : 'tasks'}</small></header>
                <div>
                  {plannedTasks.length ? plannedTasks.map((task) => (
                    <article className="queue-action plan-task" key={task.id}>
                      <span className="action-kind"><GameIcon name="work" /></span>
                      <p><strong>{task.label}</strong><small>{task.detail}</small></p>
                      {isDraft && <button aria-label={`Remove ${task.label} from plan`} onClick={() => clearPlannedTask(task.actionIds)} type="button"><GameIcon name="close" /></button>}
                    </article>
                  )) : <div className="empty-state"><GameIcon name="plan" /><span><strong>No assignments yet</strong><small>Choose Work or use the recommended plan.</small></span></div>}
                </div>
              </section>

              {isDraft ? (
                <section className={`forecast-card ${validation.valid ? 'valid' : 'invalid'}`}>
                  <header><span className="forecast-symbol"><GameIcon name={validation.valid ? 'check' : 'warning'} /></span><span><small>{validation.valid ? 'Safety check passed' : 'Next step'}</small><strong>{validation.valid ? 'Ready to start' : plan.actions.length === 0 ? 'Add an assignment' : `${validation.issues.filter((issue) => issue.severity === 'error').length} issues to fix`}</strong></span></header>
                  {(validation.valid || plan.actions.length > 0) && <div className="forecast-values"><span><small>Finish</small><strong>{validation.preview.estimatedCompletionHours ?? '—'}h</strong></span><span><small>Lowest O₂</small><strong>{validation.preview.projectedOxygenHours.toFixed(1)}h</strong></span><span><small>Battery</small><strong>{validation.preview.projectedBatteryKwh.toFixed(0)} kWh</strong></span></div>}
                  {plan.actions.length > 0 && validation.issues.length > 0 && <div className="issue-list">{validation.issues.slice(0, 3).map((issue) => <p className={issue.severity} key={`${issue.code}-${issue.actionId ?? issue.targetId ?? 'plan'}-${issue.message}`}><i />{issue.message}</p>)}</div>}
                </section>
              ) : (
                <section className="forecast-card valid execution-card">
                  <header><span className="forecast-symbol"><GameIcon name="check" /></span><span><small>{verificationIsCurrent ? 'Outcome verified' : colony.scenarioStatus === 'objective_complete' ? 'Objective reached' : plan.status === 'completed' ? 'Ready to verify' : 'Execution active'}</small><strong>{completedOutcomeTitle}</strong></span></header>
                  <div className="forecast-values"><span><small>Work complete</small><strong>{colony.workOrders.filter((order) => order.status === 'complete').length}/{colony.workOrders.length}</strong></span><span><small>O₂ observed</small><strong>{colony.reserves.minimumOxygenHours.toFixed(1)}h</strong></span><span><small>Battery</small><strong>{colony.power.batteryKwh.toFixed(0)} kWh</strong></span></div>
                  <div className="issue-list"><p className="success"><i />{
                    verificationIsCurrent
                      ? colony.verification?.status === 'success'
                        ? 'No remaining risk found.'
                        : 'Review the remaining risks below.'
                      : plan.status === 'completed' || colony.scenarioStatus === 'objective_complete'
                        ? 'Verify before continuing.'
                        : supervisionSummary
                  }</p></div>
                  {colony.verification && verificationIsCurrent && (
                    <div
                      aria-label="Verification evidence"
                      className={`verification-details ${colony.verification.status}`}
                      ref={verificationEvidenceRef}
                      tabIndex={-1}
                    >
                      <header><small>Evidence from the live outcome</small><strong>{colony.verification.summary}</strong></header>
                      <div className="verification-checks">
                        {colony.verification.checks.map((check) => (
                          <article className={check.passed ? 'passed' : 'failed'} key={check.id}>
                            <GameIcon name={check.passed ? 'check' : 'alert'} />
                            <span><strong>{check.label}</strong><small>{check.evidence}</small></span>
                          </article>
                        ))}
                      </div>
                      <div className="verification-risks">
                        <strong>Remaining risks</strong>
                        {colony.verification.residualRisks.length > 0
                          ? colony.verification.residualRisks.map((risk) => <p key={risk}>{risk}</p>)
                          : <p>None observed at this checkpoint.</p>}
                      </div>
                    </div>
                  )}
                </section>
              )}

              <section className="plan-actions">
                {isDraft ? (
                  <>
                    <button className="secondary-action" disabled={!plan.actions.length} onClick={() => colony.clearPlan()} type="button">Clear</button>
                    {plan.basedOnWorldRevision !== colony.worldRevision && <button className="secondary-action" onClick={() => colony.rebasePlan()} type="button">Rebase</button>}
                    <button aria-label="Start plan" className="commit-action" disabled={!validation.valid} onClick={commitPlan} type="button"><GameIcon name="check" /><span>Start plan</span></button>
                  </>
                ) : (
                  <>
                    {plan.status === 'completed' ? (
                      <>
                        <header className="plan-execution-heading">
                          <strong>{verificationIsCurrent ? 'Outcome verified' : 'Outcome ready'}</strong>
                          <small>{verificationIsCurrent ? 'Evidence recorded below' : 'Review the result'}</small>
                        </header>
                        {!verificationIsCurrent ? (
                          <button
                            className="plan-time-action plan-verify-action"
                            onClick={() => colony.verifyPlan()}
                            title="Verify the operation"
                            type="button"
                          >
                            <GameIcon name="verify" />
                            <span><strong>Verify outcome</strong><small>Compare against the plan</small></span>
                          </button>
                        ) : colony.scenarioStatus === 'objective_complete' ? (
                          <button
                            className="plan-time-action plan-next-incident-action"
                            disabled={!canStartNextIncident}
                            onClick={startNextIncidentRun}
                            type="button"
                          >
                            <GameIcon name="fastForward" />
                            <span><strong>Start next incident</strong><small>Built settlement is preserved</small></span>
                          </button>
                        ) : (
                          <button
                            className="plan-time-action"
                            onClick={() => colony.clearPlan()}
                            type="button"
                          >
                            <GameIcon name="plan" />
                            <span><strong>Start next plan</strong><small>Open a fresh bounded response</small></span>
                          </button>
                        )}
                      </>
                    ) : (
                      <>
                        <header className="plan-execution-heading">
                          <strong>Plan time</strong>
                          <small>Advance within the committed safeguards</small>
                        </header>
                        <button
                          className="plan-time-action plan-run-action"
                          disabled={!canAdvancePlan}
                          onClick={() => colony.advanceTime({ hours: plan.horizonHours || 4, stopCondition: plan.stopCondition ?? undefined })}
                          title="Advance to the plan stop condition"
                          type="button"
                        >
                          <GameIcon name="fastForward" />
                          <span><strong>Run to stop</strong><small>{stopConditionLabel(plan.stopCondition, colony.workOrders)}</small></span>
                        </button>
                        <button
                          className="plan-time-action"
                          disabled={!canAdvancePlan}
                          onClick={() => colony.advanceTime({ hours: 1, stopCondition: plan.stopCondition ?? undefined })}
                          title="Advance one hour"
                          type="button"
                        >
                          <GameIcon name="clock" />
                          <span><strong>Advance 1 hour</strong><small>Optional checkpoint</small></span>
                        </button>
                        <button
                          className="plan-time-action plan-verify-action"
                          disabled={!hasCommittedPlan || colony.elapsedHours === plan.baseline?.elapsedHours || verificationIsCurrent}
                          onClick={() => colony.verifyPlan()}
                          title="Verify the operation"
                          type="button"
                        >
                          <GameIcon name="verify" />
                          <span><strong>Verify checkpoint</strong><small>Compare before continuing</small></span>
                        </button>
                      </>
                    )}
                  </>
                )}
              </section>
            </div>
          )}

          {activeTab === 'log' && (
            <div className="sheet-body log-sheet">
              <header className="log-summary"><span><small>Mission day</small><strong>{colony.missionDay}</strong></span><span><small>Time</small><strong>{formatClock(colony.hour)}</strong></span><span><small>Events</small><strong>{colony.events.length}</strong></span><span><small>Last stop</small><strong>{colony.lastAdvance?.stopReason ? statusLabel(colony.lastAdvance.stopReason) : '—'}</strong></span></header>
              <div className="event-timeline">
                {colony.events.slice(0, 12).map((event) => <article className={`event-entry ${event.phase}`} key={event.id}><span className="event-time">D{event.missionDay} {formatClock(event.hour)}</span><i /><span><small>{statusLabel(event.phase)}</small><strong>{event.message}</strong></span></article>)}
              </div>
            </div>
          )}
        </section>

        <nav className="command-dock" aria-label="Colony commands">
          <button
            aria-keyshortcuts="B"
            onClick={() => {
              setDrawerOpen(false)
              setArchitectOpen(true)
            }}
            title={constructionCompletionSummary
              ? `Construction complete: ${constructionCompletionSummary}`
              : 'Open Architect'}
            type="button"
          >
            <GameIcon name="habitat" />
            <span>Build</span>
            {constructionCompletionSummary && unfinishedConstructionCount === 0 && (
              <b aria-hidden="true" className="construction-complete-badge">✓</b>
            )}
          </button>
          {dockItems.map((item) => (
            <button
              aria-controls="colony-command-sheet"
              aria-expanded={drawerOpen && activeTab === item.id}
              className={`${activeTab === item.id && drawerOpen ? 'active' : ''}`}
              key={item.id}
              onClick={() => openTab(item.id)}
              ref={(button) => {
                dockButtonRefs.current[item.id] = button
              }}
              type="button"
            >
              <GameIcon name={item.icon} />
              <span>{item.label}</span>
              {item.id === 'plan' && plan.status === 'completed' && (
                <b
                  aria-label={verificationIsCurrent ? 'Plan verified' : 'Plan ready to verify'}
                  className={verificationIsCurrent ? 'plan-complete-badge' : 'plan-verify-badge'}
                >{verificationIsCurrent ? '✓' : '!'}</b>
              )}
              {item.id === 'plan' && plan.status !== 'completed' && plan.actions.length > 0 && <b>{plan.actions.length}</b>}
            </button>
          ))}
        </nav>
      </main>
    </div>
  )
}

function App() {
  const hasSavedMission = useColonyStore((state) => (
    state.settlement.phase === 'operations' ||
    state.worldRevision > 1 ||
    state.settlement.constructionOrders.length > 0
  ))
  const savedMissionDay = useColonyStore((state) => state.missionDay)
  const savedSettlementPhase = useColonyStore((state) => state.settlement.phase)
  const savedScenarioStatus = useColonyStore((state) => state.scenarioStatus)
  const savedMissionLabel = savedSettlementPhase !== 'operations'
    ? 'Complete the first expansion'
    : savedScenarioStatus === 'objective_complete'
      ? 'Laboratory recovery complete'
      : savedScenarioStatus === 'failed'
        ? 'Colony needs a restart'
        : 'Recover the damaged laboratory'
  const [replayPending, setReplayPending] = useState(() => {
    if (typeof window === 'undefined') return false
    try {
      return window.sessionStorage.getItem(MISSION_ARRIVAL_SESSION_KEY) ===
        MISSION_ARRIVAL_RESET_PENDING_VALUE
    } catch {
      return false
    }
  })
  const [arrivalComplete, setArrivalComplete] = useState(() => {
    if (typeof window === 'undefined') return false
    try {
      const savedArrival = window.sessionStorage.getItem(MISSION_ARRIVAL_SESSION_KEY)
      return savedArrival === 'complete' ||
        (savedArrival === MISSION_ARRIVAL_TEST_BYPASS_VALUE && import.meta.env.MODE === 'test')
    } catch {
      return false
    }
  })

  const completeArrival = useCallback(() => {
    try {
      window.sessionStorage.setItem(MISSION_ARRIVAL_SESSION_KEY, 'complete')
    } catch {
      // A private or embedded browser can deny session storage; the in-memory gate still works.
    }
    setReplayPending(false)
    setArrivalComplete(true)
  }, [])

  const replayArrival = useCallback(() => {
    try {
      window.sessionStorage.setItem(
        MISSION_ARRIVAL_SESSION_KEY,
        MISSION_ARRIVAL_RESET_PENDING_VALUE,
      )
    } catch {
      // Keep the replay available in memory even when storage is unavailable.
    }
    setReplayPending(true)
    setArrivalComplete(false)
  }, [])

  const prepareNewMission = useCallback(() => {
    useColonyStore.getState().resetColony()
    try {
      // The one-room landing settlement is installed before the cinematic.
      // Arrival hands the player directly into the guided first expansion.
      window.sessionStorage.setItem(MISSION_ARRIVAL_SESSION_KEY, 'complete')
    } catch {
      // The in-memory cutscene can still complete when session storage is unavailable.
    }
    setReplayPending(false)
  }, [])

  return (
    <BackgroundMusicProvider>
      {arrivalComplete ? (
        <GameApplication onReplayArrival={replayArrival} />
      ) : (
        <MissionArrival
          hasSavedMission={hasSavedMission && !replayPending}
          onComplete={completeArrival}
          onPrepareNewMission={prepareNewMission}
          savedMissionDay={savedMissionDay}
          savedMissionLabel={savedMissionLabel}
        />
      )}
    </BackgroundMusicProvider>
  )
}

export default App
