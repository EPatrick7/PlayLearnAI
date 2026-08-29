import { useMemo, useState } from 'react'
import { MissionGuide } from './components/MissionGuide'
import { MoonbaseMap } from './components/MoonbaseMap'
import { useColonyStore } from './game/store'
import type {
  PlanAction,
  PlanBriefInput,
  Priority,
  StopCondition,
  WorkOrder,
  WorkOrderId,
} from './game/types'
import { useWebMcpTools } from './webmcp/registerTools'
import './styles.css'

const formatClock = (hour: number) => `${String(hour).padStart(2, '0')}:00`
const formatLocation = (location: string) => location.split('-').map((word) => word[0].toUpperCase() + word.slice(1)).join(' ')
const statusLabel = (status: string) => status.split('_').join(' ')

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
    return `Assign ${crew.find((member) => member.id === action.crewId)?.name ?? action.crewId} to ${order?.label ?? action.workOrderId}`
  }
  if (action.kind === 'reserve_equipment') {
    return `Reserve ${equipment.find((item) => item.id === action.equipmentId)?.name ?? action.equipmentId} for ${order?.label ?? action.workOrderId}`
  }
  return `Set ${order?.label ?? action.workOrderId} to priority ${action.priority}`
}

function App() {
  const colony = useColonyStore()
  const webMcpStatus = useWebMcpTools()
  const [selectedOrderId, setSelectedOrderId] = useState<WorkOrderId>('work-seal-lab')
  const [selectedModuleId, setSelectedModuleId] = useState('module-laboratory')

  const selectedOrder = colony.workOrders.find((order) => order.id === selectedOrderId) ?? colony.workOrders[0]
  const selectedModule = colony.modules.find((module) => module.id === selectedModuleId) ?? colony.modules[0]
  const validation = colony.validatePlan()
  const plan = colony.operationsPlan
  const stagedPriorityAction = plan.actions.find(
    (action) => action.kind === 'set_priority' && action.workOrderId === selectedOrder.id,
  )
  const displayedPriority = stagedPriorityAction?.kind === 'set_priority'
    ? stagedPriorityAction.priority
    : selectedOrder.priority
  const isDraft = plan.status === 'draft'
  const hasCommittedPlan = plan.baseline !== null

  const requiredEquipment = useMemo(
    () => colony.equipment.filter((item) => selectedOrder.requiredEquipment.includes(item.type)),
    [colony.equipment, selectedOrder.requiredEquipment],
  )

  const effectiveSolar = colony.power.solarGenerationKw * (1 - colony.power.dustDeratePercent / 100)
  const dustCountdown = Math.max(0, colony.dust.startsAtHour - colony.elapsedHours)

  const updateBrief = (patch: Partial<PlanBriefInput>) => {
    const currentStop: StopCondition = plan.stopCondition ?? {
      kind: 'work_order_complete',
      workOrderId: selectedOrder.id,
    }
    colony.setPlanBrief({
      objective: colony.objective.id,
      constraints: patch.constraints ?? plan.constraints,
      horizonHours: patch.horizonHours ?? (plan.horizonHours || 6),
      stopCondition: patch.stopCondition ?? currentStop,
    })
  }

  const stageCrew = (crewId: string) => {
    const existing = plan.actions.find(
      (action) => action.kind === 'assign_crew' && action.crewId === crewId && action.workOrderId === selectedOrder.id,
    )
    if (existing) colony.removePlanAction(existing.id)
    else colony.stagePlanAction({ kind: 'assign_crew', crewId, workOrderId: selectedOrder.id })
  }

  const stageEquipment = (equipmentId: string) => {
    const existing = plan.actions.find(
      (action) => action.kind === 'reserve_equipment' && action.equipmentId === equipmentId && action.workOrderId === selectedOrder.id,
    )
    if (existing) colony.removePlanAction(existing.id)
    else colony.stagePlanAction({ kind: 'reserve_equipment', equipmentId, workOrderId: selectedOrder.id })
  }

  const stagePriority = (priority: Priority) => {
    const existing = plan.actions.find(
      (action) => action.kind === 'set_priority' && action.workOrderId === selectedOrder.id,
    )
    if (existing) colony.removePlanAction(existing.id)
    colony.stagePlanAction({ kind: 'set_priority', workOrderId: selectedOrder.id, priority })
  }

  const inspectModule = (moduleId: string) => {
    const module = colony.modules.find((candidate) => candidate.id === moduleId)
    setSelectedModuleId(moduleId)
    colony.recordLearningEvidence(
      'ground',
      `Inspected ${module?.name ?? moduleId}: atmosphere ${module?.atmosphere ?? 'unknown'}, condition ${module?.condition ?? 'unknown'}%.`,
      'manual',
    )
  }

  const setStopCondition = (kind: StopCondition['kind']) => {
    let stopCondition: StopCondition
    if (kind === 'oxygen_below') {
      stopCondition = { kind, thresholdHours: plan.constraints.oxygenFloorHours || colony.objective.recommendedOxygenFloorHours }
    } else if (kind === 'battery_below') {
      stopCondition = { kind, thresholdKwh: 12 }
    } else if (kind === 'work_order_complete') {
      stopCondition = { kind, workOrderId: selectedOrder.id }
    } else {
      stopCondition = { kind }
    }
    updateBrief({ stopCondition })
  }

  const verificationTone = colony.verification?.status ?? 'not-ready'

  return (
    <div className={`app-shell scenario-${colony.scenarioStatus}`}>
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true"><span>PL</span></div>
          <div>
            <span className="eyebrow">PlayLearnAI</span>
            <h1>MOONBASE</h1>
          </div>
        </div>

        <div className="mission-clock">
          <span>Mission day {colony.missionDay}</span>
          <strong>{formatClock(colony.hour)}</strong>
          <small>Shackleton south rim</small>
        </div>

        <div className="topbar-actions">
          <div className={`mcp-badge ${webMcpStatus}`} title="WebMCP Site Tool registration status">
            <i /> Site Tools {webMcpStatus}
          </div>
          <button className="button ghost" onClick={() => colony.resetColony()} type="button">
            Reset seed {colony.seed}
          </button>
        </div>
      </header>

      <section className="telemetry-strip" aria-label="Live moonbase telemetry">
        <div className={`telemetry-card ${colony.reserves.oxygenHours <= plan.constraints.oxygenFloorHours + 4 ? 'warning' : ''}`}>
          <span>Oxygen margin</span>
          <strong>{colony.reserves.oxygenHours.toFixed(1)} h</strong>
          <small>observed low {colony.reserves.minimumOxygenHours} h</small>
        </div>
        <div className="telemetry-card">
          <span>Water / food</span>
          <strong>{colony.reserves.waterDays.toFixed(1)}d / {colony.reserves.foodDays.toFixed(1)}d</strong>
          <small>{colony.crew.length} crew aboard</small>
        </div>
        <div className={`telemetry-card power-${colony.power.status}`}>
          <span>Power</span>
          <strong>{effectiveSolar.toFixed(0)} / {colony.power.demandKw} kW</strong>
          <small>battery {colony.power.batteryKwh.toFixed(0)} kWh</small>
        </div>
        <div className={`telemetry-card atmosphere-${colony.lab.atmosphere}`}>
          <span>Laboratory</span>
          <strong>{colony.lab.atmosphere.toUpperCase()}</strong>
          <small>{colony.lab.breached ? 'breach open' : colony.lab.sealed ? 'hull sealed' : 'repair pending'}</small>
        </div>
        <div className={`telemetry-card ${colony.dust.active ? 'critical' : 'warning'}`}>
          <span>Dust front</span>
          <strong>{colony.dust.active ? 'ACTIVE' : `T−${dustCountdown} h`}</strong>
          <small>{colony.dust.mitigated ? 'arrays prepared' : `${colony.dust.baseDeratePercent}% forecast loss`}</small>
        </div>
        <div className="telemetry-card">
          <span>World revision</span>
          <strong>R{colony.worldRevision}</strong>
          <small>plan R{plan.revision}</small>
        </div>
      </section>

      <main className="command-layout">
        <aside className="left-rail">
          <section className="panel objective-panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">Showcase incident</span>
                <h2>Recover the laboratory</h2>
              </div>
              <span className={`scenario-pill ${colony.scenarioStatus}`}>{statusLabel(colony.scenarioStatus)}</span>
            </div>
            <p>{colony.objective.summary}</p>
            <ul className={`criteria-list ${colony.scenarioStatus === 'objective_complete' ? 'complete' : ''}`}>
              {colony.objective.successCriteria.map((criterion) => <li key={criterion}>{criterion}</li>)}
            </ul>
          </section>

          <section className="panel alerts-panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">Live conditions</span>
                <h2>Alerts</h2>
              </div>
              <span className="count-badge">{colony.alerts.length}</span>
            </div>
            <div className="alert-list">
              {colony.alerts.map((alert) => (
                <article className={`alert-item ${alert.severity}`} key={alert.id}>
                  <span className="alert-symbol" aria-hidden="true">{alert.severity === 'critical' ? '!' : alert.severity === 'warning' ? '▲' : '·'}</span>
                  <div><strong>{alert.title}</strong><p>{alert.detail}</p></div>
                </article>
              ))}
            </div>
          </section>

          <section className="panel work-panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">Response chain</span>
                <h2>Work orders</h2>
              </div>
            </div>
            <div className="work-order-list">
              {colony.workOrders.map((order, index) => {
                const percent = Math.min(100, Math.round((order.progressHours / order.durationHours) * 100))
                return (
                  <button
                    className={`work-order-card ${selectedOrder.id === order.id ? 'selected' : ''} ${order.status}`}
                    key={order.id}
                    onClick={() => {
                      setSelectedOrderId(order.id)
                      colony.recordLearningEvidence('ground', `Inspected work order ${order.label} and its dependencies.`, 'manual')
                    }}
                    type="button"
                  >
                    <span className="order-index">{String(index + 1).padStart(2, '0')}</span>
                    <div>
                      <span className="order-title"><strong>{order.label}</strong><i>{statusLabel(order.status)}</i></span>
                      <small>{order.requiredSkill} {order.minimumSkill}+ · {order.hazard}</small>
                      <span className="progress-track"><i style={{ width: `${percent}%` }} /></span>
                    </div>
                  </button>
                )
              })}
            </div>
          </section>
        </aside>

        <section className="center-stage">
          <section className="panel map-panel">
            <div className="panel-heading map-heading">
              <div>
                <span className="eyebrow">Shared operational picture</span>
                <h2>{colony.baseName}</h2>
              </div>
              <div className="map-legend" aria-label="Map legend">
                <span><i className="legend-safe" /> pressurized</span>
                <span><i className="legend-vacuum" /> vacuum</span>
                <span><i className="legend-plan" /> staged</span>
              </div>
            </div>
            <MoonbaseMap
              crew={colony.crew}
              dustActive={colony.dust.active}
              equipment={colony.equipment}
              height={colony.map.height}
              modules={colony.modules}
              onInspectModule={inspectModule}
              plan={plan}
              selectedModuleId={selectedModule.id}
              width={colony.map.width}
              workOrders={colony.workOrders}
            />
            <div className="map-inspector">
              <div>
                <span className="eyebrow">Selected module</span>
                <strong>{selectedModule.name}</strong>
              </div>
              <dl>
                <div><dt>Atmosphere</dt><dd>{selectedModule.atmosphere.toUpperCase()}</dd></div>
                <div><dt>Condition</dt><dd>{selectedModule.condition}%</dd></div>
                <div><dt>Power priority</dt><dd>P{selectedModule.powerPriority}</dd></div>
                <div><dt>Occupants</dt><dd>{colony.crew.filter((member) => member.location === selectedModule.location).length}</dd></div>
              </dl>
            </div>
          </section>

          <section className="panel activity-panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">Observed → planned → changed → verified</span>
                <h2>Activity history</h2>
              </div>
              <span className="revision-label">WORLD R{colony.worldRevision}</span>
            </div>
            <div className="activity-list">
              {colony.events.slice(0, 8).map((event) => (
                <article className={`activity-entry ${event.phase}`} key={event.id}>
                  <span className="activity-time">D{event.missionDay} {formatClock(event.hour)}</span>
                  <i aria-hidden="true" />
                  <div><strong>{event.phase}</strong><p>{event.message}</p></div>
                  <small>{event.actor}</small>
                </article>
              ))}
            </div>
          </section>
        </section>

        <aside className="right-rail">
          <MissionGuide learning={colony.learning} />

          <section className="panel planner-panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">Shared artifact · revision {plan.revision}</span>
                <h2>Operations Plan</h2>
              </div>
              <span className={`plan-status ${plan.status}`}>{plan.status}</span>
            </div>

            {isDraft ? (
              <div className="plan-brief">
                <label>
                  <span>O₂ reserve floor</span>
                  <div className="input-suffix">
                    <input
                      max={colony.reserves.oxygenHours}
                      min={8}
                      onChange={(event) => updateBrief({
                        constraints: { ...plan.constraints, oxygenFloorHours: Number(event.target.value) },
                      })}
                      type="number"
                      value={plan.constraints.oxygenFloorHours}
                    />
                    <i>hours</i>
                  </div>
                </label>
                <label>
                  <span>Protected crew</span>
                  <select
                    onChange={(event) => updateBrief({
                      constraints: {
                        ...plan.constraints,
                        protectedCrewIds: event.target.value ? [event.target.value] : [],
                      },
                    })}
                    value={plan.constraints.protectedCrewIds[0] ?? ''}
                  >
                    <option value="">None</option>
                    {colony.crew.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
                  </select>
                </label>
                <label>
                  <span>Time horizon</span>
                  <div className="input-suffix">
                    <input
                      max={12}
                      min={1}
                      onChange={(event) => updateBrief({ horizonHours: Number(event.target.value) })}
                      type="number"
                      value={plan.horizonHours}
                    />
                    <i>hours</i>
                  </div>
                </label>
                <label>
                  <span>Stop condition</span>
                  <select onChange={(event) => setStopCondition(event.target.value as StopCondition['kind'])} value={plan.stopCondition?.kind ?? ''}>
                    <option disabled value="">Choose…</option>
                    <option value="work_order_complete">Selected work completes</option>
                    <option value="oxygen_below">Oxygen floor reached</option>
                    <option value="battery_below">Battery below 12 kWh</option>
                    <option value="critical_alert">Critical alert</option>
                    <option value="objective_complete">Objective complete</option>
                  </select>
                </label>
              </div>
            ) : (
              <div className="committed-brief">
                <span><small>Objective</small>Restore lab + finish research</span>
                <span><small>Floor</small>{plan.constraints.oxygenFloorHours} h O₂</span>
                <span><small>Stop</small>{stopConditionLabel(plan.stopCondition)}</span>
              </div>
            )}

            <div className="selected-work">
              <div className="selected-work-heading">
                <div>
                  <span className="eyebrow">Selected order</span>
                  <strong>{selectedOrder.label}</strong>
                </div>
                {isDraft && (
                  <label className="priority-select">
                    <span>P</span>
                    <select onChange={(event) => stagePriority(Number(event.target.value) as Priority)} value={displayedPriority}>
                      {[1, 2, 3, 4, 5].map((priority) => <option key={priority} value={priority}>{priority}</option>)}
                    </select>
                  </label>
                )}
              </div>
              <p>{selectedOrder.detail}</p>
              <div className="requirement-row">
                <span>{selectedOrder.requiredSkill} {selectedOrder.minimumSkill}+</span>
                <span>{selectedOrder.requiredEquipment.length ? selectedOrder.requiredEquipment.map(statusLabel).join(', ') : 'no equipment'}</span>
              </div>
            </div>

            {isDraft && (
              <>
                <div className="assignment-section">
                  <div className="subheading"><span>Crew</span><small>stage assignment</small></div>
                  <div className="crew-list">
                    {[...colony.crew]
                      .sort((a, b) => b.skills[selectedOrder.requiredSkill] - a.skills[selectedOrder.requiredSkill])
                      .map((member) => {
                        const staged = plan.actions.some(
                          (action) => action.kind === 'assign_crew' && action.crewId === member.id && action.workOrderId === selectedOrder.id,
                        )
                        const protectedCrew = plan.constraints.protectedCrewIds.includes(member.id)
                        return (
                          <button
                            className={`crew-row ${staged ? 'staged' : ''} ${protectedCrew ? 'protected' : ''}`}
                            key={member.id}
                            onClick={() => stageCrew(member.id)}
                            type="button"
                          >
                            <span className="crew-avatar">{member.name.split(' ').map((part) => part[0]).join('')}</span>
                            <span className="crew-name"><strong>{member.name}</strong><small>{member.role} · FAT {Math.round(member.fatigue)}</small></span>
                            <span className="skill-chip">{selectedOrder.requiredSkill.slice(0, 3).toUpperCase()} {member.skills[selectedOrder.requiredSkill]}</span>
                            <i>{staged ? '−' : '+'}</i>
                          </button>
                        )
                      })}
                  </div>
                </div>

                <div className="assignment-section">
                  <div className="subheading"><span>Required gear</span><small>{formatLocation(selectedOrder.location)}</small></div>
                  {requiredEquipment.length ? (
                    <div className="equipment-list">
                      {requiredEquipment.map((item) => {
                        const staged = plan.actions.some(
                          (action) => action.kind === 'reserve_equipment' && action.equipmentId === item.id && action.workOrderId === selectedOrder.id,
                        )
                        return (
                          <button className={`equipment-row ${staged ? 'staged' : ''}`} key={item.id} onClick={() => stageEquipment(item.id)} type="button">
                            <span><strong>{item.name}</strong><small>{formatLocation(item.location)} · {item.condition}%</small></span>
                            <i>{staged ? 'staged −' : 'stage +'}</i>
                          </button>
                        )
                      })}
                    </div>
                  ) : <p className="empty-note">This order requires crew time only.</p>}
                </div>
              </>
            )}

            <div className="draft-section">
              <div className="subheading"><span>Plan actions</span><small>{plan.actions.length} staged</small></div>
              {plan.actions.length ? (
                <div className="draft-action-list">
                  {plan.actions.map((action) => (
                    <div className="draft-action" key={action.id}>
                      <span>{action.kind === 'assign_crew' ? 'CREW' : action.kind === 'reserve_equipment' ? 'GEAR' : 'PRTY'}</span>
                      <p>{actionDescription(action, colony.crew, colony.equipment, colony.workOrders)}</p>
                      {isDraft && <button aria-label="Remove staged action" onClick={() => colony.removePlanAction(action.id)} type="button">×</button>}
                    </div>
                  ))}
                </div>
              ) : <p className="empty-note">Select an order, then stage crew and any required equipment.</p>}
            </div>

            {isDraft && (
              <div className={`validation-box ${validation.valid ? 'valid' : 'invalid'}`}>
                <div><strong>{validation.valid ? 'Plan ready' : `${validation.issues.filter((issue) => issue.severity === 'error').length} blockers`}</strong><span>projects {validation.preview.projectedOxygenHours.toFixed(1)} h O₂</span></div>
                {validation.issues.slice(0, 3).map((issue) => (
                  <p
                    className={issue.severity}
                    key={`${issue.code}-${issue.actionId ?? issue.targetId ?? 'plan'}-${issue.message}`}
                  >
                    {issue.message}
                  </p>
                ))}
              </div>
            )}

            <div className="planner-actions">
              {isDraft ? (
                <>
                  <button className="button ghost" disabled={!plan.actions.length} onClick={() => colony.clearPlan()} type="button">Clear</button>
                  {plan.basedOnWorldRevision !== colony.worldRevision && <button className="button ghost" onClick={() => colony.rebasePlan()} type="button">Rebase</button>}
                  <button
                    className="button primary"
                    disabled={!validation.valid}
                    onClick={() => colony.commitPlan(colony.worldRevision, plan.revision)}
                    type="button"
                  >
                    Commit plan
                  </button>
                </>
              ) : (
                <button className="button ghost" onClick={() => colony.clearPlan()} type="button">Start next plan</button>
              )}
            </div>
          </section>

          <section className="panel time-panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">Bounded execution</span>
                <h2>Simulation control</h2>
              </div>
              <span className={`power-dot ${colony.power.status}`} />
            </div>
            <p>Advance in small windows. The simulation stops on the committed threshold or a critical exception.</p>
            <div className="time-actions">
              <button className="button secondary" disabled={!hasCommittedPlan || colony.scenarioStatus !== 'active'} onClick={() => colony.advanceTime({ hours: 1, stopCondition: plan.stopCondition ?? undefined })} type="button">+1 hour</button>
              <button className="button secondary" disabled={!hasCommittedPlan || colony.scenarioStatus !== 'active'} onClick={() => colony.advanceTime({ hours: plan.horizonHours || 4, stopCondition: plan.stopCondition ?? undefined })} type="button">To stop</button>
              <button className="button verify" disabled={!hasCommittedPlan || colony.elapsedHours === plan.baseline?.elapsedHours} onClick={() => colony.verifyPlan()} type="button">Verify</button>
            </div>

            {colony.verification && (
              <div className={`verification-card ${verificationTone}`}>
                <div><span className="eyebrow">Outcome comparison</span><strong>{colony.verification.summary}</strong></div>
                <div className="verification-checks">
                  {colony.verification.checks.map((check) => (
                    <span className={check.passed ? 'passed' : 'failed'} key={check.id} title={check.evidence}>
                      <i>{check.passed ? '✓' : '!'}</i>{check.label}
                    </span>
                  ))}
                </div>
                {colony.verification.residualRisks.length > 0 && <p>Residual: {colony.verification.residualRisks.join(' · ')}</p>}
              </div>
            )}
          </section>
        </aside>
      </main>

      <footer className="app-footer">
        <p><strong>One state, two control surfaces.</strong> Manual controls and Site Tools call the same revision-checked operations layer.</p>
        <span>POC · deterministic seed {colony.seed}</span>
      </footer>
    </div>
  )
}

export default App
