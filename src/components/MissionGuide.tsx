import type { LearningPhase, LearningState } from '../game/types'

const phases: Array<{ id: LearningPhase; label: string; short: string }> = [
  { id: 'ground', label: 'Ground', short: 'Read live evidence' },
  { id: 'plan', label: 'Plan', short: 'Bound the response' },
  { id: 'supervise', label: 'Supervise', short: 'Watch execution' },
  { id: 'verify', label: 'Verify', short: 'Compare outcome' },
]

const manualNextStep: Record<LearningPhase, string> = {
  ground: 'Inspect the breached laboratory, then compare crew and equipment.',
  plan: 'Select a work order and stage a qualified crew member plus required gear.',
  supervise: 'Commit the valid plan and advance only a small observation window.',
  verify: 'Run verification and compare fresh evidence with the oxygen floor.',
}

export function MissionGuide({ learning }: { learning: LearningState }) {
  const nextStep = learning.completedLoops > 0
    ? 'Loop complete. Reset the seed to test another plan, or inspect the verified end state.'
    : manualNextStep[learning.currentPhase]

  return (
    <section className="panel guide-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Operating discipline</span>
          <h2>Supervision loop</h2>
        </div>
        <span className="evidence-count">{learning.evidence.length} signals</span>
      </div>

      <div className="phase-list" aria-label={`Current learning phase: ${learning.currentPhase}`}>
        {phases.map((phase, index) => {
          const complete = learning.achieved[phase.id]
          const current = learning.currentPhase === phase.id
          return (
            <div className={`phase-step ${complete ? 'complete' : ''} ${current ? 'current' : ''}`} key={phase.id}>
              <span>{complete ? '✓' : index + 1}</span>
              <div>
                <strong>{phase.label}</strong>
                <small>{phase.short}</small>
              </div>
            </div>
          )
        })}
      </div>

      <div className="guide-callout">
        <span className="eyebrow">Next move</span>
        <p>{nextStep}</p>
      </div>
      <p className="guide-coaching">{learning.coaching}</p>
    </section>
  )
}
