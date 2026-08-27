import { useState } from 'react'
import type { LearningPhase, LearningState } from '../game/types'

const prompts: Record<LearningPhase, string> = {
  inspect:
    "Assess Emberdeep's three biggest risks. Use the colony tools, cite the evidence you found, and do not make any changes yet.",
  act:
    'Choose the single highest-leverage response. Explain your constraints, then make only the work-order and assignment changes needed. Protect injured or exhausted colonists.',
  verify:
    'Advance only two hours, then verify whether the intervention worked. Compare the evidence with your expectation, report side effects, and stop before taking another action.',
}

export const PromptCoach = ({ learning }: { learning: LearningState }) => {
  const [copied, setCopied] = useState(false)
  const prompt = prompts[learning.phase]

  const copyPrompt = async () => {
    await navigator.clipboard.writeText(prompt)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1400)
  }

  return (
    <section className="panel coach-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Delegation practice</span>
          <h2>Promptcraft loop</h2>
        </div>
        <div className="score-orb" aria-label={`Promptcraft score ${learning.score} out of 100`}>
          <strong>{learning.score}</strong>
          <small>/100</small>
        </div>
      </div>

      <div className="phase-track" aria-label={`Current phase: ${learning.phase}`}>
        {(['inspect', 'act', 'verify'] as LearningPhase[]).map((phase, index) => (
          <div className={`phase ${learning.phase === phase ? 'current' : ''}`} key={phase}>
            <span>{index + 1}</span>
            {phase}
          </div>
        ))}
      </div>

      <p className="coaching-copy">{learning.coaching}</p>
      <div className="suggested-prompt">
        <span className="eyebrow">Try this prompt</span>
        <p>“{prompt}”</p>
        <button className="text-button" onClick={copyPrompt} type="button">
          {copied ? 'Copied' : 'Copy prompt'}
        </button>
      </div>
      <div className="loop-count">
        <span>{learning.completedLoops}</span>
        evidence-based loops completed
      </div>
    </section>
  )
}
