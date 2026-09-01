import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import { GameIcon, type GameIconName } from './GameIcon'
import { PawnSprite, type PawnSpriteVariant } from './PawnSprite'
import '../arrival.css'

const MISSION_ARRIVAL_STAGES = [
  'descent',
  'touchdown',
  'approach',
  'airlock',
] as const

export type MissionArrivalStage = typeof MISSION_ARRIVAL_STAGES[number]

const DEFAULT_MISSION_ARRIVAL_TIMINGS: Record<MissionArrivalStage, number> = {
  descent: 2800,
  touchdown: 1700,
  approach: 3200,
  airlock: 1800,
}

export interface MissionArrivalCompletion {
  kind: 'new' | 'saved'
  skipped: boolean
}

export interface MissionArrivalProps {
  /** Whether the player can return to a mission already stored by the parent. */
  hasSavedMission?: boolean
  /** Called before a new landing begins so the parent can install a fresh mission. */
  onPrepareNewMission: () => void | Promise<void>
  /** Called once the saved mission is resumed or the new-arrival sequence ends. */
  onComplete: (completion: MissionArrivalCompletion) => void
  /** Primarily useful for previews and deterministic tests. */
  timings?: Partial<Record<MissionArrivalStage, number>>
}

interface LearningStep {
  detail: string
  icon: GameIconName
  label: string
  number: string
}

interface ArrivalStageCopy {
  ariaLabel: string
  detail: string
  eyebrow: string
  title: string
}

const LEARNING_STEPS: LearningStep[] = [
  {
    number: '01',
    label: 'Ground',
    icon: 'map',
    detail: 'Read pressure, power, supplies, and the terrain before issuing work.',
  },
  {
    number: '02',
    label: 'Plan',
    icon: 'plan',
    detail: 'Stage crew, equipment, priorities, constraints, and a clear stop condition.',
  },
  {
    number: '03',
    label: 'Supervise',
    icon: 'activity',
    detail: 'Advance deliberately. Watch the crew and pause when the world changes.',
  },
  {
    number: '04',
    label: 'Verify',
    icon: 'verify',
    detail: 'Compare the result with the baseline, then keep the evidence you learned from.',
  },
]

const STAGE_COPY: Record<MissionArrivalStage, ArrivalStageCopy> = {
  descent: {
    eyebrow: 'Powered descent',
    title: 'Lander on final approach',
    detail: 'Guidance has acquired the marked pad. Crew remain sealed in their EVA suits.',
    ariaLabel: 'Powered descent active. The lander is approaching the moon base landing pad.',
  },
  touchdown: {
    eyebrow: 'Contact light',
    title: 'Touchdown confirmed',
    detail: 'Engines are safe. Surface dust is settling and the habitat beacon is steady.',
    ariaLabel: 'Touchdown confirmed. The lander is safely on the surface beside the moon base.',
  },
  approach: {
    eyebrow: 'Surface transfer',
    title: 'All six suited crew to the airlock',
    detail: 'The full crew crosses the exposed surface as one team. No one enters vacuum unsuited.',
    ariaLabel: 'Surface transfer in progress. Six suited crew members are walking from the lander to the airlock.',
  },
  airlock: {
    eyebrow: 'Pressure equalizing',
    title: 'Crew entering Shackleton Relay',
    detail: 'The outer hatch is sealed. The established habitat is pressurized, powered, and ready for the first plan.',
    ariaLabel: 'The outer hatch is sealed and the airlock is pressurizing. The crew are entering the moon base.',
  },
}

const CREW: Array<{
  accent: string
  initials: string
  modifier: string
  variant: PawnSpriteVariant
}> = [
  { initials: 'AO', variant: 'umber', accent: '#b7654f', modifier: 'one' },
  { initials: 'MA', variant: 'gold', accent: '#5d8f8c', modifier: 'two' },
  { initials: 'SP', variant: 'olive', accent: '#b3914f', modifier: 'three' },
  { initials: 'LH', variant: 'rose', accent: '#8a6378', modifier: 'four' },
  { initials: 'JR', variant: 'copper', accent: '#9a7046', modifier: 'five' },
  { initials: 'NK', variant: 'slate', accent: '#596f7c', modifier: 'six' },
]

const boundedDuration = (duration: number | undefined, fallback: number) => (
  typeof duration === 'number' && Number.isFinite(duration)
    ? Math.max(0, duration)
    : fallback
)

function MissionMark() {
  return (
    <span aria-hidden="true" className="arrival-mark">
      <span>SR</span>
      <i />
    </span>
  )
}

function BaseSilhouette() {
  return (
    <div aria-hidden="true" className="arrival-base">
      <div className="arrival-base__antenna"><i /><i /><i /></div>
      <div className="arrival-base__module arrival-base__module--life">
        <GameIcon name="lifeSupport" />
        <span>LSS</span>
      </div>
      <div className="arrival-base__corridor arrival-base__corridor--left" />
      <div className="arrival-base__module arrival-base__module--habitat">
        <span>SHACKLETON</span>
        <b>HAB-01</b>
        <i /><i /><i />
      </div>
      <div className="arrival-base__corridor arrival-base__corridor--right" />
      <div className="arrival-base__module arrival-base__module--stores">
        <GameIcon name="storage" />
        <span>STORES</span>
      </div>
      <div className="arrival-base__airlock">
        <span className="arrival-base__beacon" />
        <GameIcon name="airlock" />
        <small>AIRLOCK</small>
      </div>
    </div>
  )
}

function Lander() {
  return (
    <div aria-hidden="true" className="arrival-lander">
      <span className="arrival-lander__antenna" />
      <span className="arrival-lander__body">
        <b>AQUILA</b>
        <GameIcon name="landingPad" />
        <i />
      </span>
      <span className="arrival-lander__leg arrival-lander__leg--left" />
      <span className="arrival-lander__leg arrival-lander__leg--right" />
      <span className="arrival-lander__engine arrival-lander__engine--left" />
      <span className="arrival-lander__engine arrival-lander__engine--right" />
      <span className="arrival-lander__ramp" />
    </div>
  )
}

function CrewTransfer() {
  return (
    <div aria-hidden="true" className="arrival-crew">
      {CREW.map((member) => (
        <span
          className={`arrival-crew__member arrival-crew__member--${member.modifier}`}
          key={member.initials}
        >
          <PawnSprite
            accent={member.accent}
            initials={member.initials}
            showInitials
            size="standard"
            suited
            variant={member.variant}
          />
        </span>
      ))}
    </div>
  )
}

function ArrivalScene({ stage }: { stage: MissionArrivalStage }) {
  return (
    <div
      aria-label={STAGE_COPY[stage].ariaLabel}
      className={`arrival-scene arrival-scene--${stage}`}
      data-testid="arrival-scene"
      role="img"
    >
      <div aria-hidden="true" className="arrival-scene__sky">
        <i /><i /><i /><i /><i /><i /><i />
        <span className="arrival-scene__earth" />
      </div>
      <div aria-hidden="true" className="arrival-scene__horizon" />
      <div aria-hidden="true" className="arrival-scene__surface">
        <i className="arrival-crater arrival-crater--one" />
        <i className="arrival-crater arrival-crater--two" />
        <i className="arrival-crater arrival-crater--three" />
        <span className="arrival-pad"><b>03</b></span>
        <span className="arrival-dust arrival-dust--left" />
        <span className="arrival-dust arrival-dust--right" />
      </div>
      <BaseSilhouette />
      <Lander />
      <CrewTransfer />
      <div aria-hidden="true" className="arrival-scene__telemetry">
        <span><small>Cabin</small><strong>SEALED</strong></span>
        <span><small>Exterior</small><strong>VACUUM</strong></span>
        <span><small>Suit loop</small><strong>NOMINAL</strong></span>
      </div>
    </div>
  )
}

function BriefingScene() {
  return (
    <div aria-hidden="true" className="arrival-briefing-scene">
      <div className="arrival-briefing-scene__sky"><i /><i /><i /><i /><i /></div>
      <span className="arrival-briefing-scene__earth" />
      <span className="arrival-briefing-scene__ridge" />
      <span className="arrival-briefing-scene__route" />
      <span className="arrival-briefing-scene__lander"><GameIcon name="landingPad" /></span>
      <BaseSilhouette />
      <div className="arrival-briefing-scene__crew">
        {CREW.map((member) => (
          <PawnSprite
            accent={member.accent}
            initials={member.initials}
            key={member.initials}
            size="standard"
            suited
            variant={member.variant}
          />
        ))}
      </div>
      <span className="arrival-briefing-scene__label arrival-briefing-scene__label--pad">PAD 03</span>
      <span className="arrival-briefing-scene__label arrival-briefing-scene__label--base">PRESSURIZED BASE</span>
    </div>
  )
}

export function MissionArrival({
  hasSavedMission = false,
  onPrepareNewMission,
  onComplete,
  timings,
}: MissionArrivalProps) {
  const [stage, setStage] = useState<MissionArrivalStage | null>(null)
  const [preparing, setPreparing] = useState(false)
  const [preparationError, setPreparationError] = useState<string | null>(null)
  const [complete, setComplete] = useState(false)
  const mountedRef = useRef(true)
  const completionSentRef = useRef(false)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const finish = useCallback((completion: MissionArrivalCompletion) => {
    if (completionSentRef.current) return
    completionSentRef.current = true
    setStage(null)
    setComplete(true)
    onComplete(completion)
  }, [onComplete])

  const currentStageIndex = stage ? MISSION_ARRIVAL_STAGES.indexOf(stage) : -1
  const stageDuration = stage
    ? boundedDuration(timings?.[stage], DEFAULT_MISSION_ARRIVAL_TIMINGS[stage])
    : 0

  useEffect(() => {
    if (!stage) return
    const timer = window.setTimeout(() => {
      const nextStage = MISSION_ARRIVAL_STAGES[currentStageIndex + 1]
      if (nextStage) {
        setStage(nextStage)
        return
      }
      finish({ kind: 'new', skipped: false })
    }, stageDuration)

    return () => window.clearTimeout(timer)
  }, [currentStageIndex, finish, stage, stageDuration])

  const startNewMission = async () => {
    if (preparing) return
    setPreparationError(null)
    setPreparing(true)
    try {
      await onPrepareNewMission()
      if (!mountedRef.current) return
      completionSentRef.current = false
      setPreparing(false)
      setStage('descent')
    } catch (error) {
      if (!mountedRef.current) return
      setPreparing(false)
      setPreparationError(
        error instanceof Error && error.message
          ? `Landing preparation failed: ${error.message}`
          : 'Landing preparation failed. Your current mission has not been changed.',
      )
    }
  }

  if (stage) {
    const copy = STAGE_COPY[stage]
    const progressStyle = {
      '--arrival-stage-duration': `${stageDuration}ms`,
    } as CSSProperties

    return (
      <section
        aria-labelledby="arrival-cutscene-title"
        className="mission-arrival mission-arrival--cutscene"
        data-arrival-stage={stage}
      >
        <p aria-atomic="true" aria-live="polite" className="arrival-sr-only" role="status">
          {copy.ariaLabel}
        </p>

        <header className="arrival-cutscene__header">
          <div className="arrival-brand">
            <MissionMark />
            <span>
              <small>Shackleton expedition</small>
              <strong>Shackleton Relay</strong>
            </span>
          </div>
          <div className="arrival-cutscene__counter" aria-label={`Arrival stage ${currentStageIndex + 1} of ${MISSION_ARRIVAL_STAGES.length}`}>
            <span>{String(currentStageIndex + 1).padStart(2, '0')}</span>
            <i />
            <span>{String(MISSION_ARRIVAL_STAGES.length).padStart(2, '0')}</span>
          </div>
          <button
            className="arrival-button arrival-button--quiet"
            onClick={() => finish({ kind: 'new', skipped: true })}
            type="button"
          >
            Skip arrival
            <GameIcon name="fastForward" />
          </button>
        </header>

        <div className="arrival-cutscene__body">
          <ArrivalScene stage={stage} />

          <div className="arrival-cutscene__caption">
            <span className="arrival-kicker">{copy.eyebrow}</span>
            <h1 id="arrival-cutscene-title">{copy.title}</h1>
            <p>{copy.detail}</p>
            <div aria-hidden="true" className="arrival-stage-timer" key={stage} style={progressStyle}>
              <span />
            </div>
          </div>
        </div>

        <ol aria-label="Arrival sequence" className="arrival-stage-list">
          {MISSION_ARRIVAL_STAGES.map((candidate, index) => {
            const state = index < currentStageIndex
              ? 'complete'
              : index === currentStageIndex
                ? 'current'
                : 'upcoming'
            return (
              <li
                aria-current={state === 'current' ? 'step' : undefined}
                data-state={state}
                key={candidate}
              >
                <span>{String(index + 1).padStart(2, '0')}</span>
                <i />
                <strong>{STAGE_COPY[candidate].eyebrow}</strong>
              </li>
            )
          })}
        </ol>
      </section>
    )
  }

  if (complete) {
    return (
      <section aria-label="Opening mission" aria-live="polite" className="mission-arrival mission-arrival--complete">
        <GameIcon name="check" size={30} />
        <strong>Opening mission…</strong>
      </section>
    )
  }

  return (
    <section
      aria-busy={preparing}
      aria-describedby="arrival-briefing-summary"
      aria-labelledby="arrival-briefing-title"
      className="mission-arrival mission-arrival--briefing"
      data-arrival-state={preparing ? 'preparing' : 'waiting'}
    >
      <header className="arrival-briefing__header">
        <div className="arrival-brand">
          <MissionMark />
          <span>
            <small>Mission orientation // Shackleton site</small>
            <strong>Shackleton Relay</strong>
          </span>
        </div>
        <span className="arrival-hold-status">
          <i />
          {preparing ? 'Preparing landing' : 'Launch hold active'}
        </span>
      </header>

      <div className="arrival-briefing__content">
        <div className="arrival-briefing__copy">
          <span className="arrival-kicker">Crewed lunar settlement // Mission day 01</span>
          <h1 id="arrival-briefing-title">Land safely.<br />Build deliberately.</h1>
          <p id="arrival-briefing-summary">
            Bring a six-person crew from the lander into a ready, pressurized moon base,
            then recover the settlement through careful, reviewable decisions.
          </p>

          <aside className="arrival-safety-note" aria-label="Arrival safety">
            <span><GameIcon name="evaSuit" /></span>
            <p>
              <strong>Vacuum protocol is automatic on arrival.</strong>
              Every crew member crosses the exposed surface in a sealed EVA suit and only
              removes it after the airlock reaches pressure.
            </p>
          </aside>

          <div className="arrival-briefing__actions">
            {hasSavedMission && (
              <button
                className="arrival-button arrival-button--primary"
                disabled={preparing}
                onClick={() => finish({ kind: 'saved', skipped: false })}
                type="button"
              >
                <GameIcon name="play" />
                <span><strong>Resume saved mission</strong><small>Return to your last checkpoint</small></span>
              </button>
            )}
            <button
              className={hasSavedMission
                ? 'arrival-button arrival-button--secondary'
                : 'arrival-button arrival-button--primary'}
              disabled={preparing}
              onClick={startNewMission}
              type="button"
            >
              <GameIcon name={preparing ? 'gear' : 'landingPad'} />
              <span>
                <strong>{preparing ? 'Preparing mission…' : hasSavedMission ? 'Start a new landing' : 'Start landing'}</strong>
                <small>{hasSavedMission ? 'Create a fresh Shackleton expedition' : 'Begin the arrival sequence'}</small>
              </span>
            </button>
          </div>

          {preparationError && <p className="arrival-preparation-error" role="alert">{preparationError}</p>}

          <p className="arrival-wait-copy">
            <GameIcon name="pause" />
            Nothing starts on its own. Take your time; the mission clock is stopped here.
          </p>
        </div>

        <div className="arrival-briefing__visual">
          <BriefingScene />
          <div className="arrival-briefing__manifest">
            <span><small>Crew</small><strong>06 suited</strong></span>
            <span><small>Habitat</small><strong>Pressurized</strong></span>
            <span><small>Mission clock</small><strong>On hold</strong></span>
          </div>
        </div>
      </div>

      <section aria-labelledby="arrival-loop-title" className="arrival-loop">
        <header>
          <span className="arrival-kicker">The command loop</span>
          <h2 id="arrival-loop-title">Ground → Plan → Supervise → Verify</h2>
          <p>Each turn is a small, inspectable experiment. The world only advances when you tell it to.</p>
        </header>
        <ol>
          {LEARNING_STEPS.map((step) => (
            <li key={step.label}>
              <span className="arrival-loop__number">{step.number}</span>
              <GameIcon name={step.icon} />
              <h3>{step.label}</h3>
              <p>{step.detail}</p>
              <GameIcon className="arrival-loop__arrow" name="chevron" />
            </li>
          ))}
        </ol>
      </section>
    </section>
  )
}
