import type { ConstructionSpeed } from '../game/types'
import { GameIcon } from './GameIcon'

interface ConstructionClockControlsProps {
  className?: string
  label?: string
  onChange: (speed: ConstructionSpeed) => void
  speed: ConstructionSpeed
}

const speedTitle = (speed: Exclude<ConstructionSpeed, 0>) => (
  speed === 1 ? 'Normal worker speed' : speed === 2 ? 'Fast worker speed' : 'Very fast worker speed'
)

export function ConstructionClockControls({
  className = '',
  label = 'Construction speed',
  onChange,
  speed,
}: ConstructionClockControlsProps) {
  return (
    <div
      aria-label={label}
      className={`construction-speed-controls ${className}`.trim()}
      role="group"
    >
      <button
        aria-label="Pause construction"
        aria-pressed={speed === 0}
        onClick={() => onChange(0)}
        title="Pause worker clock"
        type="button"
      >
        <GameIcon name="pause" />
      </button>
      {([1, 2, 3] as const).map((nextSpeed) => (
        <button
          aria-label={`${nextSpeed} times construction speed`}
          aria-pressed={speed === nextSpeed}
          key={nextSpeed}
          onClick={() => onChange(nextSpeed)}
          title={speedTitle(nextSpeed)}
          type="button"
        >
          <GameIcon name={nextSpeed === 1 ? 'play' : 'fastForward'} />
          <span>{nextSpeed}×</span>
        </button>
      ))}
    </div>
  )
}
