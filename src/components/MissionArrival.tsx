import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import { GameIcon } from './GameIcon'
import { PawnSprite, type PawnSpriteVariant } from './PawnSprite'
import '../arrival.css'

const MISSION_ARRIVAL_STAGES = [
  'touchdown',
  'emergency',
] as const

export type MissionArrivalStage = typeof MISSION_ARRIVAL_STAGES[number]

const DEFAULT_MISSION_ARRIVAL_TIMINGS: Record<MissionArrivalStage, number> = {
  touchdown: 1600,
  emergency: 3000,
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
  /** Current saved-game summary shown only when a resumable mission exists. */
  savedMissionDay?: number
  savedMissionLabel?: string
  /** Primarily useful for previews and deterministic tests. */
  timings?: Partial<Record<MissionArrivalStage, number>>
}

interface ArrivalStageCopy {
  ariaLabel: string
  detail: string
  eyebrow: string
  title: string
}

const STAGE_COPY: Record<MissionArrivalStage, ArrivalStageCopy> = {
  touchdown: {
    eyebrow: 'Touchdown',
    title: 'Aquila is down.',
    detail: 'Six crew. One small habitat. Plenty of room to grow.',
    ariaLabel: 'Aquila has landed safely beside the starter habitat.',
  },
  emergency: {
    eyebrow: 'First shift',
    title: 'Make the outpost livable.',
    detail: 'Amina and Mateo take the first build shift. Add one room, an airlock, and life support.',
    ariaLabel: 'The six-person crew is safe. Amina and Mateo are starting a habitat expansion with life support.',
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

function BaseSilhouette({ starter = false }: { starter?: boolean }) {
  return (
    <div aria-hidden="true" className={`arrival-base ${starter ? 'arrival-base--starter' : ''}`}>
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
  const visualStage = stage === 'emergency' ? 'approach' : stage
  return (
    <div
      aria-label={STAGE_COPY[stage].ariaLabel}
      className={`arrival-scene arrival-scene--${visualStage} arrival-scene--${stage}`}
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
      <BaseSilhouette starter />
      <Lander />
      <CrewTransfer />
      {stage === 'emergency' && (
        <div className="arrival-scene__mission">
          <GameIcon name="habitat" />
          <span><small>Your first build</small><strong>Safe expansion</strong></span>
        </div>
      )}
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
      <BaseSilhouette starter />
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
      <span className="arrival-briefing-scene__label arrival-briefing-scene__label--base">STARTER HABITAT</span>
    </div>
  )
}

export function MissionArrival({
  hasSavedMission = false,
  onPrepareNewMission,
  onComplete,
  savedMissionDay = 1,
  savedMissionLabel = 'Build the first expansion',
  timings,
}: MissionArrivalProps) {
  const [stage, setStage] = useState<MissionArrivalStage | null>(null)
  const [preparing, setPreparing] = useState(false)
  const [preparationError, setPreparationError] = useState<string | null>(null)
  const [complete, setComplete] = useState(false)
  const [reducedMotion] = useState(() => (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ))
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
    if (reducedMotion && stage === 'emergency') return
    const timer = window.setTimeout(() => {
      const nextStage = MISSION_ARRIVAL_STAGES[currentStageIndex + 1]
      if (nextStage) {
        setStage(nextStage)
        return
      }
      finish({ kind: 'new', skipped: false })
    }, stageDuration)

    return () => window.clearTimeout(timer)
  }, [currentStageIndex, finish, reducedMotion, stage, stageDuration])

  const startNewMission = async () => {
    if (preparing) return
    if (hasSavedMission && !window.confirm('Start over? Current mission progress will be replaced.')) return
    setPreparationError(null)
    setPreparing(true)
    try {
      await onPrepareNewMission()
      if (!mountedRef.current) return
      completionSentRef.current = false
      setPreparing(false)
      setStage(reducedMotion ? 'emergency' : 'touchdown')
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
          <button
            className="arrival-button arrival-button--quiet"
            onClick={() => finish({ kind: 'new', skipped: !reducedMotion })}
            type="button"
          >
            {reducedMotion ? 'Enter colony' : 'Skip intro'}
            <GameIcon name={reducedMotion ? 'play' : 'fastForward'} />
          </button>
        </header>

        <div className="arrival-cutscene__body">
          <ArrivalScene stage={stage} />

          <div className="arrival-cutscene__caption">
            <span className="arrival-kicker">{copy.eyebrow}</span>
            <h1 id="arrival-cutscene-title">{copy.title}</h1>
            <p>{copy.detail}</p>
            {!reducedMotion && (
              <div aria-hidden="true" className="arrival-stage-timer" key={stage} style={progressStyle}>
                <span />
              </div>
            )}
          </div>
        </div>
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
            <small>Shackleton site</small>
            <strong>Shackleton Relay</strong>
          </span>
        </div>
      </header>

      <div className="arrival-briefing__content">
        <div className="arrival-briefing__copy">
          <span className="arrival-kicker">Lunar colony survival</span>
          <h1 id="arrival-briefing-title">Build a home<br />on the Moon.</h1>
          <p id="arrival-briefing-summary">
            Start with one habitat. Expand carefully. Keep six crew safe.
          </p>

          <aside className="arrival-safety-note" aria-label={hasSavedMission ? 'Saved mission' : 'First shift'}>
            <span><GameIcon name={hasSavedMission ? 'activity' : 'habitat'} /></span>
            <p>
              <strong>{hasSavedMission ? `Continue · Day ${savedMissionDay}` : 'First shift'}</strong>
              {hasSavedMission ? savedMissionLabel : 'Build a second room with an airlock and life support.'}
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
                <span><strong>Continue mission</strong></span>
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
                <strong>{preparing ? 'Preparing…' : hasSavedMission ? 'New colony' : 'Start new colony'}</strong>
              </span>
            </button>
          </div>

          {preparationError && <p className="arrival-preparation-error" role="alert">{preparationError}</p>}

        </div>

        <div className="arrival-briefing__visual">
          <BriefingScene />
        </div>
      </div>

    </section>
  )
}
