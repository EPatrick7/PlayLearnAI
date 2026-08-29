import { useEffect, useMemo, useState } from 'react'
import { GameIcon, type GameIconName } from './components/GameIcon'
import { MoonbaseMap } from './components/MoonbaseMap'
import { SettlementBuilder } from './components/SettlementBuilder'
import { useColonyStore } from './game/store'
import type {
  Equipment,
  PlanAction,
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

type DockTab = 'work' | 'crew' | 'gear' | 'plan' | 'log'
type Selection =
  | { kind: 'module'; id: string }
  | { kind: 'crew'; id: string }
  | { kind: 'equipment'; id: string }
  | { kind: 'work'; id: WorkOrderId }

const formatClock = (hour: number) => `${String(hour).padStart(2, '0')}:00`
const formatLocation = (location: string) => location
  .split('-')
  .map((word) => word[0].toUpperCase() + word.slice(1))
  .join(' ')
const statusLabel = (status: string) => status.split('_').join(' ')
const initials = (name: string) => name.split(' ').map((part) => part[0]).join('')

const stopConditionLabel = (condition: StopCondition | null) => {
  if (!condition) return 'Not set'
  if (condition.kind === 'objective_complete') return 'Objective complete'
  if (condition.kind === 'critical_alert') return 'Critical alert'
  if (condition.kind === 'oxygen_below') return `O₂ below ${condition.thresholdHours}h`
  if (condition.kind === 'battery_below') return `Battery below ${condition.thresholdKwh} kWh`
  return `Complete ${condition.workOrderId.replace('work-', '').replaceAll('-', ' ')}`
}

const actionDescription = (
  action: PlanAction,
  crew: ReturnType<typeof useColonyStore.getState>['crew'],
  equipment: ReturnType<typeof useColonyStore.getState>['equipment'],
  workOrders: WorkOrder[],
) => {
  const order = workOrders.find((candidate) => candidate.id === action.workOrderId)
  if (action.kind === 'assign_crew') {
    return `${crew.find((member) => member.id === action.crewId)?.name ?? action.crewId} → ${order?.label ?? action.workOrderId}`
  }
  if (action.kind === 'reserve_equipment') {
    return `${equipment.find((item) => item.id === action.equipmentId)?.name ?? action.equipmentId} → ${order?.label ?? action.workOrderId}`
  }
  return `${order?.label ?? action.workOrderId} priority ${action.priority}`
}

const equipmentIcon = (item: Equipment): GameIconName => {
  if (item.type === 'rover') return 'map'
  if (item.type === 'medical_kit') return 'shield'
  return 'gear'
}

const dockItems: Array<{ id: DockTab; label: string; icon: GameIconName }> = [
  { id: 'work', label: 'Work', icon: 'work' },
  { id: 'crew', label: 'Crew', icon: 'crew' },
  { id: 'gear', label: 'Gear', icon: 'gear' },
  { id: 'plan', label: 'Plan', icon: 'plan' },
  { id: 'log', label: 'Log', icon: 'log' },
]

function App() {
  const colony = useColonyStore()
  const webMcpStatus = useWebMcpTools()
  const [activeTab, setActiveTab] = useState<DockTab>('work')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [selectedOrderId, setSelectedOrderId] = useState<WorkOrderId>('work-seal-lab')
  const [selection, setSelection] = useState<Selection>({ kind: 'module', id: 'module-laboratory' })

  const plan = colony.operationsPlan
  const validation = colony.validatePlan()
  const isDraft = plan.status === 'draft'
  const hasCommittedPlan = plan.baseline !== null
  const selectedOrder = colony.workOrders.find((order) => order.id === selectedOrderId) ?? colony.workOrders[0]
  const selectedModuleId = selection.kind === 'module' ? selection.id : null
  const selectedCrewId = selection.kind === 'crew' ? selection.id : null
  const selectedEquipmentId = selection.kind === 'equipment' ? selection.id : null
  const selectedModule = colony.modules.find((module) => module.id === selectedModuleId)
  const selectedCrew = colony.crew.find((member) => member.id === selectedCrewId)
  const selectedEquipment = colony.equipment.find((item) => item.id === selectedEquipmentId)
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

  const effectiveSolar = colony.power.solarGenerationKw * (1 - colony.power.dustDeratePercent / 100)
  const objectiveChecks = [
    colony.lab.atmosphere === 'yes' && colony.lab.sealed,
    colony.research.status === 'complete',
    colony.reserves.minimumOxygenHours >= plan.constraints.oxygenFloorHours,
  ]
  const objectiveProgress = objectiveChecks.filter(Boolean).length

  useEffect(() => {
    const closeDrawer = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrawerOpen(false)
    }
    window.addEventListener('keydown', closeDrawer)
    return () => window.removeEventListener('keydown', closeDrawer)
  }, [])

  if (colony.settlement.phase !== 'operations') {
    return <SettlementBuilder />
  }

  const openTab = (tab: DockTab) => {
    if (drawerOpen && activeTab === tab) {
      setDrawerOpen(false)
      return
    }
    setActiveTab(tab)
    setDrawerOpen(true)
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

  const selectWorkOrder = (workOrderId: WorkOrderId, open = true) => {
    setSelectedOrderId(workOrderId)
    setSelection({ kind: 'work', id: workOrderId })
    setActiveTab('work')
    if (open) setDrawerOpen(true)
    colony.recordLearningEvidence('ground', `Inspected ${colony.workOrders.find((order) => order.id === workOrderId)?.label ?? workOrderId} and its dependencies.`, 'manual')
  }

  const inspectModule = (moduleId: string) => {
    const module = colony.modules.find((candidate) => candidate.id === moduleId)
    setSelection({ kind: 'module', id: moduleId })
    colony.recordLearningEvidence(
      'ground',
      `Inspected ${module?.name ?? moduleId}: atmosphere ${module?.atmosphere ?? 'unknown'}, condition ${module?.condition ?? 'unknown'}%.`,
      'manual',
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

  const stageRecommendedResponse = () => {
    if (!isDraft) return
    colony.clearPlan()
    colony.setPlanBrief({
      objective: colony.objective.id,
      constraints: { oxygenFloorHours: 12, protectedCrewIds: [] },
      horizonHours: 12,
      stopCondition: { kind: 'objective_complete' },
    })
    const actions: Array<{ kind: 'assign_crew'; crewId: string; workOrderId: WorkOrderId } | { kind: 'reserve_equipment'; equipmentId: string; workOrderId: WorkOrderId }> = [
      { kind: 'assign_crew', crewId: 'crew-mateo-alvarez', workOrderId: 'work-seal-lab' },
      { kind: 'reserve_equipment', equipmentId: 'equipment-eva-01', workOrderId: 'work-seal-lab' },
      { kind: 'reserve_equipment', equipmentId: 'equipment-engineering-01', workOrderId: 'work-seal-lab' },
      { kind: 'assign_crew', crewId: 'crew-soo-jin-park', workOrderId: 'work-repressurize-lab' },
      { kind: 'reserve_equipment', equipmentId: 'equipment-engineering-02', workOrderId: 'work-repressurize-lab' },
      { kind: 'assign_crew', crewId: 'crew-leila-haddad', workOrderId: 'work-research-sintering' },
      { kind: 'assign_crew', crewId: 'crew-nia-kimani', workOrderId: 'work-clean-solar' },
      { kind: 'reserve_equipment', equipmentId: 'equipment-eva-02', workOrderId: 'work-clean-solar' },
      { kind: 'reserve_equipment', equipmentId: 'equipment-rover-01', workOrderId: 'work-clean-solar' },
    ]
    actions.forEach((action) => colony.stagePlanAction(action))
    colony.recordLearningEvidence('plan', 'Staged the recommended incident response for review.', 'manual')
    setActiveTab('plan')
    setDrawerOpen(true)
  }

  const setStopCondition = (kind: StopCondition['kind']) => {
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

  const selectionTitle = selectedModule?.name
    ?? selectedCrew?.name
    ?? selectedEquipment?.name
    ?? selectedOrder.label

  const selectedOrderPercent = Math.min(100, Math.round((selectedOrder.progressHours / selectedOrder.durationHours) * 100))

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
          <div className="resource-chip" title="Water reserve">
            <GameIcon name="water" /><span><small>Water</small><strong>{colony.reserves.waterDays.toFixed(1)}d</strong></span>
          </div>
          <div className="resource-chip" title="Food reserve">
            <GameIcon name="food" /><span><small>Food</small><strong>{colony.reserves.foodDays.toFixed(1)}d</strong></span>
          </div>
          <div className={`resource-chip ${colony.power.status}`} title="Solar generation and demand">
            <GameIcon name="power" /><span><small>Grid</small><strong>{effectiveSolar.toFixed(0)}/{colony.power.demandKw} kW</strong></span>
          </div>
          <div className="resource-chip resource-stock" title="Construction stock">
            <GameIcon name="gear" /><span><small>Materials</small><strong>{colony.reserves.constructionStock}</strong></span>
          </div>
        </section>

        <div className="mission-time">
          <span><small>Mission day</small><strong>{colony.missionDay}</strong></span>
          <span className="clock-value">{formatClock(colony.hour)}</span>
          <span className={`agent-link ${webMcpStatus}`} title="WebMCP Site Tool registration status"><i />Agent link</span>
          <button aria-label={`Reset deterministic seed ${colony.seed}`} className="icon-button" onClick={() => colony.resetColony()} title={`Reset seed ${colony.seed}`} type="button"><GameIcon name="reset" /></button>
        </div>
      </header>

      <main className="world-stage">
        <MoonbaseMap
          constructionLayout={colony.settlement.layout}
          crew={colony.crew}
          dustActive={colony.dust.active}
          equipment={colony.equipment}
          height={colony.map.height}
          modules={colony.modules}
          onInspectModule={inspectModule}
          onSelectCrew={(crewId) => setSelection({ kind: 'crew', id: crewId })}
          onSelectEquipment={(equipmentId) => setSelection({ kind: 'equipment', id: equipmentId })}
          onSelectWorkOrder={(workOrderId) => selectWorkOrder(workOrderId)}
          plan={plan}
          selectedCrewId={selectedCrewId}
          selectedEquipmentId={selectedEquipmentId}
          selectedModuleId={selectedModuleId ?? ''}
          selectedWorkOrderId={selection.kind === 'work' ? selection.id : selectedOrderId}
          width={colony.map.width}
          workOrders={colony.workOrders}
        />

        <section className="colonist-strip" aria-label="Colony crew">
          {colony.crew.map((member) => (
            <button
              aria-label={`${member.name}, ${member.role}. ${member.status}. Health ${Math.round(member.health)} percent.`}
              className={`colonist-card ${member.status} ${selectedCrewId === member.id ? 'selected' : ''}`}
              key={member.id}
              onClick={() => {
                setSelection({ kind: 'crew', id: member.id })
                setActiveTab('crew')
              }}
              onDoubleClick={() => openTab('crew')}
              title={`${member.name}, ${member.role}. ${member.status}. Health ${Math.round(member.health)}%.`}
              type="button"
            >
              <span className="portrait" style={{ '--health': `${member.health}%` } as React.CSSProperties}>
                <i className="portrait-head">{initials(member.name)}</i>
                <i className="portrait-status" />
              </span>
              <span><strong>{member.name.split(' ')[0]}</strong><small>{member.taskId ? 'On task' : member.status}</small></span>
            </button>
          ))}
        </section>

        <section className={`incident-card ${colony.scenarioStatus}`} aria-label="Current objective">
          <div className="incident-heading">
            <span className="incident-icon"><GameIcon name={colony.scenarioStatus === 'objective_complete' ? 'check' : 'alert'} /></span>
            <span><small>{colony.scenarioStatus === 'objective_complete' ? 'Objective secured' : 'Priority incident'}</small><strong>Recover Kepler Laboratory</strong></span>
            <b>{objectiveProgress}/3</b>
          </div>
          <div className="objective-progress" aria-label={`${objectiveProgress} of 3 objective conditions complete`}><i style={{ width: `${(objectiveProgress / 3) * 100}%` }} /></div>
          <p>{colony.learning.completedLoops > 0 ? 'Recovery loop complete. Inspect the verified colony state.' : colony.learning.coaching}</p>
          <div className="learning-loop" aria-label={`Current supervision phase: ${colony.learning.currentPhase}`}>
            {(['ground', 'plan', 'supervise', 'verify'] as const).map((phase, index) => (
              <span className={`${colony.learning.currentPhase === phase ? 'current' : ''} ${colony.learning.achieved[phase] ? 'complete' : ''}`} key={phase} title={phase}>
                {colony.learning.achieved[phase] ? <GameIcon name="check" /> : index + 1}
              </span>
            ))}
          </div>
          {isDraft && <button className="text-action" onClick={stageRecommendedResponse} type="button"><GameIcon name="plan" />Stage a response</button>}
        </section>

        <section className="alert-stack" aria-label="Active alerts">
          {colony.alerts.slice(0, 3).map((alert) => (
            <button className={`world-alert ${alert.severity}`} key={alert.id} onClick={() => handleAlert(alert.title)} type="button">
              <span><GameIcon name={alert.severity === 'critical' ? 'alert' : 'warning'} /></span>
              <span><strong>{alert.title}</strong><small>{alert.detail}</small></span>
              <GameIcon name="chevron" />
            </button>
          ))}
        </section>

        <section className={`selection-inspector selection-${selection.kind}`} aria-live="polite">
          <div className="selection-heading">
            <span className="selection-kind"><GameIcon name={selection.kind === 'crew' ? 'crew' : selection.kind === 'equipment' ? 'gear' : selection.kind === 'work' ? 'work' : 'map'} /></span>
            <span><small>Selected {selection.kind}</small><strong>{selectionTitle}</strong></span>
          </div>
          {selectedModule && (
            <div className="selection-stats">
              <span><small>Atmosphere</small><strong className={`atmosphere-${selectedModule.atmosphere}`}>{selectedModule.atmosphere.toUpperCase()}</strong></span>
              <span><small>Condition</small><strong>{selectedModule.condition}%</strong></span>
              <span><small>Power</small><strong>P{selectedModule.powerPriority}</strong></span>
              <span><small>Crew</small><strong>{colony.crew.filter((member) => member.location === selectedModule.location).length}</strong></span>
            </div>
          )}
          {selectedCrew && (
            <div className="selection-stats">
              <span><small>Health</small><strong>{Math.round(selectedCrew.health)}%</strong></span>
              <span><small>Fatigue</small><strong>{Math.round(selectedCrew.fatigue)}%</strong></span>
              <span><small>Morale</small><strong>{Math.round(selectedCrew.morale)}%</strong></span>
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
        </section>

        <section className="time-controls" aria-label="Simulation controls">
          <span className={`sim-state ${hasCommittedPlan ? 'ready' : 'paused'}`}><i />{hasCommittedPlan ? 'Plan live' : 'Paused'}</span>
          <button disabled={!hasCommittedPlan || colony.scenarioStatus !== 'active'} onClick={() => colony.advanceTime({ hours: 1, stopCondition: plan.stopCondition ?? undefined })} title="Advance one hour" type="button"><GameIcon name="play" /><span>+1h</span></button>
          <button disabled={!hasCommittedPlan || colony.scenarioStatus !== 'active'} onClick={() => colony.advanceTime({ hours: plan.horizonHours || 4, stopCondition: plan.stopCondition ?? undefined })} title="Advance to the plan stop condition" type="button"><GameIcon name="fastForward" /><span>To stop</span></button>
          <button className="verify-control" disabled={!hasCommittedPlan || colony.elapsedHours === plan.baseline?.elapsedHours} onClick={() => colony.verifyPlan()} title="Verify the operation" type="button"><GameIcon name="verify" /><span>Verify</span></button>
        </section>

        {colony.dust.active && <div className="dust-status"><GameIcon name="dust" />Dust front active · solar derated {colony.power.dustDeratePercent}%</div>}

        {colony.verification && (
          <section className={`outcome-banner ${colony.verification.status}`} aria-live="polite">
            <span><GameIcon name={colony.verification.status === 'success' ? 'check' : 'warning'} /></span>
            <span><small>Verification {colony.verification.status}</small><strong>{colony.verification.summary}</strong></span>
            <button onClick={() => openTab('plan')} type="button">View evidence</button>
          </section>
        )}

        <section
          aria-hidden={!drawerOpen}
          aria-label={`${activeTab} command panel`}
          className={`command-sheet ${drawerOpen ? 'open' : ''}`}
          inert={!drawerOpen}
        >
          <header className="sheet-header">
            <span><GameIcon name={dockItems.find((item) => item.id === activeTab)?.icon ?? 'plan'} /><strong>{dockItems.find((item) => item.id === activeTab)?.label}</strong></span>
            <button aria-label="Close command panel" onClick={() => setDrawerOpen(false)} type="button"><GameIcon name="close" /></button>
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
                  {isDraft && <label className="priority-control">P<select aria-label="Work priority" onChange={(event) => stagePriority(Number(event.target.value) as Priority)} value={displayedPriority}>{[1, 2, 3, 4, 5].map((priority) => <option key={priority} value={priority}>{priority}</option>)}</select></label>}
                </header>
                <p>{selectedOrder.detail}</p>
                <div className="work-tags"><span><GameIcon name="crew" />{selectedOrder.requiredSkill} {selectedOrder.minimumSkill}+</span><span><GameIcon name="clock" />{selectedOrder.durationHours} hours</span><span className={`hazard-${selectedOrder.hazard}`}><GameIcon name="shield" />{selectedOrder.hazard}</span></div>
              </article>

              <div className="loadout-column">
                <header><span>Assign crew</span><small>Click to stage</small></header>
                <div className="loadout-scroll">
                  {[...colony.crew].sort((a, b) => b.skills[selectedOrder.requiredSkill] - a.skills[selectedOrder.requiredSkill]).map((member) => {
                    const staged = plan.actions.some((action) => action.kind === 'assign_crew' && action.crewId === member.id && action.workOrderId === selectedOrder.id)
                    const committed = selectedOrder.assignedCrewIds.includes(member.id)
                    const conflict = plan.actions.some((action) => action.kind === 'assign_crew' && action.crewId === member.id && action.workOrderId !== selectedOrder.id)
                    const qualified = member.skills[selectedOrder.requiredSkill] >= selectedOrder.minimumSkill
                    return (
                      <button className={`loadout-card ${staged || committed ? 'staged' : ''} ${!qualified ? 'unqualified' : ''}`} disabled={!isDraft || conflict || committed} key={member.id} onClick={() => stageCrew(member.id)} title={conflict ? 'Already staged for another order' : `${member.skills[selectedOrder.requiredSkill]} ${selectedOrder.requiredSkill}`} type="button">
                        <span className="mini-portrait">{initials(member.name)}</span>
                        <span><strong>{member.name}</strong><small>{member.role}</small></span>
                        <b>{selectedOrder.requiredSkill.slice(0, 3).toUpperCase()} {member.skills[selectedOrder.requiredSkill]}</b>
                        <i>{staged || committed ? <GameIcon name="check" /> : <GameIcon name="plus" />}</i>
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="loadout-column gear-loadout">
                <header><span>Required gear</span><small>{formatLocation(selectedOrder.location)}</small></header>
                <div className="loadout-scroll">
                  {requiredEquipment.length ? requiredEquipment.map((item) => {
                    const staged = plan.actions.some((action) => action.kind === 'reserve_equipment' && action.equipmentId === item.id && action.workOrderId === selectedOrder.id)
                    const committed = selectedOrder.reservedEquipmentIds.includes(item.id)
                    const conflict = plan.actions.some((action) => action.kind === 'reserve_equipment' && action.equipmentId === item.id && action.workOrderId !== selectedOrder.id)
                    return (
                      <button className={`loadout-card gear-card ${staged || committed ? 'staged' : ''}`} disabled={!isDraft || conflict || committed} key={item.id} onClick={() => stageEquipment(item.id)} title={conflict ? 'Already staged for another order' : item.name} type="button">
                        <span className="gear-symbol"><GameIcon name={equipmentIcon(item)} /></span>
                        <span><strong>{item.name}</strong><small>{formatLocation(item.location)} · {item.condition}%</small></span>
                        <i>{staged || committed ? <GameIcon name="check" /> : <GameIcon name="plus" />}</i>
                      </button>
                    )
                  }) : <div className="no-gear"><GameIcon name="check" /><span><strong>No gear needed</strong><small>Crew assignment only</small></span></div>}
                </div>
              </div>

              <div className="work-sheet-actions">
                {isDraft && <button className="smart-plan-button" onClick={stageRecommendedResponse} type="button"><GameIcon name="plan" /><span><strong>Stage response</strong><small>Recommended safe loadout</small></span></button>}
                <button className="primary-action" onClick={() => openTab('plan')} type="button"><span>Review plan</span><b>{plan.actions.length}</b><GameIcon name="chevron" /></button>
              </div>
            </div>
          )}

          {activeTab === 'crew' && (
            <div className="sheet-body roster-sheet">
              <div className="roster-grid">
                {colony.crew.map((member) => (
                  <button className={`roster-card ${selectedCrewId === member.id ? 'selected' : ''}`} key={member.id} onClick={() => setSelection({ kind: 'crew', id: member.id })} type="button">
                    <span className="large-portrait">{initials(member.name)}</span>
                    <span className="roster-copy"><small>{member.status}</small><strong>{member.name}</strong><em>{member.role}</em><p>{member.trait}</p></span>
                    <span className="vital-bars"><i><b style={{ width: `${member.health}%` }} /></i><small>HLT {Math.round(member.health)}</small><i className="fatigue"><b style={{ width: `${member.fatigue}%` }} /></i><small>FAT {Math.round(member.fatigue)}</small></span>
                    <span className="skill-grid">{Object.entries(member.skills).map(([skill, value]) => <i key={skill} title={skill}>{skill.slice(0, 3).toUpperCase()} <b>{value}</b></i>)}</span>
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
                    <button className={`inventory-card ${selectedEquipmentId === item.id ? 'selected' : ''} ${item.status}`} key={item.id} onClick={() => setSelection({ kind: 'equipment', id: item.id })} type="button">
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
            <div className="sheet-body plan-sheet">
              <section className="brief-controls">
                <header><span><small>Operations plan · R{plan.revision}</small><strong>Laboratory recovery</strong></span><b className={`plan-state ${plan.status}`}>{plan.status}</b></header>
                {isDraft ? (
                  <div className="brief-grid">
                    <label><span>O₂ reserve floor</span><div className="number-field"><input aria-label="O₂ reserve floor hours" max={colony.reserves.oxygenHours} min={8} onChange={(event) => updateBrief({ constraints: { ...plan.constraints, oxygenFloorHours: Number(event.target.value) } })} type="number" value={plan.constraints.oxygenFloorHours} /><i>hours</i></div></label>
                    <label><span>Protected crew</span><select aria-label="Protected crew" onChange={(event) => updateBrief({ constraints: { ...plan.constraints, protectedCrewIds: event.target.value ? [event.target.value] : [] } })} value={plan.constraints.protectedCrewIds[0] ?? ''}><option value="">None</option>{colony.crew.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
                    <label><span>Horizon</span><div className="segment-control">{[8, 10, 12].map((hours) => <button aria-label={`${hours} hour horizon`} className={plan.horizonHours === hours ? 'active' : ''} key={hours} onClick={() => updateBrief({ horizonHours: hours })} type="button">{hours}h</button>)}</div></label>
                    <label><span>Stop when</span><select aria-label="Stop condition" onChange={(event) => setStopCondition(event.target.value as StopCondition['kind'])} value={plan.stopCondition?.kind ?? ''}><option value="">Choose…</option><option value="objective_complete">Objective complete</option><option value="critical_alert">Critical alert</option><option value="oxygen_below">Oxygen floor reached</option><option value="battery_below">Battery below 12 kWh</option><option value="work_order_complete">Selected work completes</option></select></label>
                  </div>
                ) : <div className="committed-summary"><span><small>Floor</small>{plan.constraints.oxygenFloorHours}h O₂</span><span><small>Horizon</small>{plan.horizonHours}h</span><span><small>Stop</small>{stopConditionLabel(plan.stopCondition)}</span></div>}
              </section>

              <section className="staged-queue">
                <header><span>Staged actions</span><small>{plan.actions.length} total</small></header>
                <div>
                  {plan.actions.length ? plan.actions.map((action) => (
                    <article className="queue-action" key={action.id}><span className={`action-kind ${action.kind}`}>{action.kind === 'assign_crew' ? <GameIcon name="crew" /> : action.kind === 'reserve_equipment' ? <GameIcon name="gear" /> : <GameIcon name="work" />}</span><p>{actionDescription(action, colony.crew, colony.equipment, colony.workOrders)}</p>{isDraft && <button aria-label="Remove staged action" onClick={() => colony.removePlanAction(action.id)} type="button"><GameIcon name="close" /></button>}</article>
                  )) : <div className="empty-state"><GameIcon name="plan" /><span><strong>No actions staged</strong><small>Pick work, crew, and equipment—or stage the recommended response.</small></span></div>}
                </div>
              </section>

              {isDraft ? (
                <section className={`forecast-card ${validation.valid ? 'valid' : 'invalid'}`}>
                  <header><span className="forecast-symbol"><GameIcon name={validation.valid ? 'check' : 'warning'} /></span><span><small>{validation.valid ? 'Forecast clear' : `${validation.issues.filter((issue) => issue.severity === 'error').length} blockers`}</small><strong>{validation.valid ? 'Ready to commit' : 'Plan needs attention'}</strong></span></header>
                  <div className="forecast-values"><span><small>Finish</small><strong>{validation.preview.estimatedCompletionHours ?? '—'}h</strong></span><span><small>O₂ low</small><strong>{validation.preview.projectedOxygenHours.toFixed(1)}h</strong></span><span><small>Battery</small><strong>{validation.preview.projectedBatteryKwh.toFixed(0)} kWh</strong></span></div>
                  {validation.issues.length > 0 && <div className="issue-list">{validation.issues.slice(0, 4).map((issue) => <p className={issue.severity} key={`${issue.code}-${issue.actionId ?? issue.targetId ?? 'plan'}-${issue.message}`}><i />{issue.message}</p>)}</div>}
                </section>
              ) : (
                <section className="forecast-card valid execution-card">
                  <header><span className="forecast-symbol"><GameIcon name="check" /></span><span><small>{colony.scenarioStatus === 'objective_complete' ? 'Objective reached' : 'Execution active'}</small><strong>{colony.scenarioStatus === 'objective_complete' ? 'Recovery operation complete' : 'Committed plan in progress'}</strong></span></header>
                  <div className="forecast-values"><span><small>Work complete</small><strong>{colony.workOrders.filter((order) => order.status === 'complete').length}/{colony.workOrders.length}</strong></span><span><small>O₂ observed</small><strong>{colony.reserves.minimumOxygenHours.toFixed(1)}h</strong></span><span><small>Battery</small><strong>{colony.power.batteryKwh.toFixed(0)} kWh</strong></span></div>
                  <div className="issue-list"><p className="success"><i />The committed snapshot is preserved. Verify it against the objective and declared reserve floor.</p></div>
                </section>
              )}

              <section className="plan-actions">
                {isDraft ? <><button className="secondary-action" disabled={!plan.actions.length} onClick={() => colony.clearPlan()} type="button">Clear</button>{plan.basedOnWorldRevision !== colony.worldRevision && <button className="secondary-action" onClick={() => colony.rebasePlan()} type="button">Rebase</button>}<button className="smart-plan-button compact" onClick={stageRecommendedResponse} type="button"><GameIcon name="plan" /><span>Stage recommended</span></button><button className="commit-action" disabled={!validation.valid} onClick={commitPlan} type="button"><GameIcon name="check" /><span>Commit plan</span></button></> : <button className="secondary-action" onClick={() => colony.clearPlan()} type="button">Start next plan</button>}
              </section>

              {colony.verification && <section className={`verification-evidence ${colony.verification.status}`}><header><span><small>Outcome comparison</small><strong>{colony.verification.summary}</strong></span></header><div>{colony.verification.checks.map((check) => <span className={check.passed ? 'passed' : 'failed'} key={check.id} title={check.evidence}><GameIcon name={check.passed ? 'check' : 'alert'} />{check.label}</span>)}</div></section>}
            </div>
          )}

          {activeTab === 'log' && (
            <div className="sheet-body log-sheet">
              <header className="log-summary"><span><small>World revision</small><strong>R{colony.worldRevision}</strong></span><span><small>Plan revision</small><strong>R{plan.revision}</strong></span><span><small>Evidence</small><strong>{colony.learning.evidence.length}</strong></span><span><small>Last stop</small><strong>{colony.lastAdvance?.stopReason ? statusLabel(colony.lastAdvance.stopReason) : '—'}</strong></span></header>
              <div className="event-timeline">
                {colony.events.slice(0, 12).map((event) => <article className={`event-entry ${event.phase}`} key={event.id}><span className="event-time">D{event.missionDay} {formatClock(event.hour)}</span><i /><span><small>{event.phase} · {event.actor}</small><strong>{event.message}</strong></span></article>)}
              </div>
            </div>
          )}
        </section>

        <nav className="command-dock" aria-label="Colony commands">
          {dockItems.map((item) => (
            <button aria-expanded={drawerOpen && activeTab === item.id} className={`${activeTab === item.id && drawerOpen ? 'active' : ''}`} key={item.id} onClick={() => openTab(item.id)} type="button">
              <GameIcon name={item.icon} />
              <span>{item.label}</span>
              {item.id === 'plan' && plan.actions.length > 0 && <b>{plan.actions.length}</b>}
              {item.id === 'log' && colony.alerts.length > 0 && <b className="alert-badge">{colony.alerts.length}</b>}
            </button>
          ))}
        </nav>
      </main>
    </div>
  )
}

export default App
