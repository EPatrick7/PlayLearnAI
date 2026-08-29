import { useMemo, useState } from 'react'
import {
  availableBlueprintsFor,
  buildProgressFor,
} from '../game/settlement'
import { useColonyStore } from '../game/store'
import type { BuildableModuleId, SettlementPhase } from '../game/types'
import { GameIcon, type GameIconName } from './GameIcon'
import { MoonbaseMap } from './MoonbaseMap'

const blueprintIcons: Record<BuildableModuleId, GameIconName> = {
  solar_battery_skid: 'solar',
  life_support: 'lifeSupport',
  airlock: 'airlock',
  storage: 'storage',
  laboratory: 'laboratory',
}

const starterCrewIds = new Set(['crew-amina-okafor', 'crew-mateo-alvarez'])

const phaseCopy: Record<Exclude<SettlementPhase, 'expanding' | 'ready' | 'operations'>, {
  eyebrow: string
  title: string
  body: string
}> = {
  landing: {
    eyebrow: 'First landing · 1 of 5',
    title: 'Give the habitat power',
    body: 'Two settlers are living on reserve cells. Pick a place for the solar skid.',
  },
  power_online: {
    eyebrow: 'Power online · 2 of 5',
    title: 'Make breathable air',
    body: 'The lights are steady. Add life support before the reserve tanks run low.',
  },
  habitable: {
    eyebrow: 'Air stable · 3 of 5',
    title: 'Open the airlock',
    body: 'Your habitat can breathe. Build an airlock so the crew can work outside safely.',
  },
}

const starterCrew = (crew: ReturnType<typeof useColonyStore.getState>['crew']) => crew
  .filter((member) => starterCrewIds.has(member.id))
  .map((member) => ({ ...member, location: 'habitat' as const }))

export function SettlementBuilder() {
  const colony = useColonyStore()
  const [selectedBlueprintId, setSelectedBlueprintId] = useState<BuildableModuleId | null>(null)
  const [selectedModuleId, setSelectedModuleId] = useState('')
  const [announcement, setAnnouncement] = useState('')

  const availableBlueprints = availableBlueprintsFor(colony)
  const selectedBlueprint = availableBlueprints.find((blueprint) => blueprint.id === selectedBlueprintId) ?? null
  const progress = buildProgressFor(colony)
  const builtIds = useMemo(() => new Set(colony.settlement.builtModuleIds), [colony.settlement.builtModuleIds])
  const visibleModules = useMemo(
    () => colony.modules
      .filter((module) => builtIds.has(module.id))
      .map((module) => ({
        ...module,
        atmosphere: module.type === 'solar_battery_skid' || module.type === 'landing_pad' ? 'no' as const : 'yes' as const,
        breached: false,
        condition: Math.max(88, module.condition),
      })),
    [builtIds, colony.modules],
  )
  const visibleCrew = useMemo(() => starterCrew(colony.crew), [colony.crew])

  const selectBlueprint = (blueprintId: BuildableModuleId) => {
    setSelectedBlueprintId((current) => current === blueprintId ? null : blueprintId)
    setAnnouncement('')
  }

  const placeBlueprint = (siteId: string) => {
    if (!selectedBlueprint) return
    const result = colony.constructModule(selectedBlueprint.id, siteId)
    if (!result.ok) {
      setAnnouncement(result.error ?? 'That module could not be built there.')
      return
    }
    setSelectedModuleId(result.moduleId ?? '')
    setAnnouncement(`${selectedBlueprint.name} built. ${result.phase.replaceAll('_', ' ')}.`)
    setSelectedBlueprintId(null)
  }

  const resetSettlement = () => {
    if (window.confirm('Start a new landing? Your current settlement layout will be replaced.')) {
      colony.resetColony()
      setSelectedBlueprintId(null)
      setSelectedModuleId('')
      setAnnouncement('New landing started.')
    }
  }

  const startFirstShift = () => {
    const result = colony.beginOperations()
    if (!result.ok) setAnnouncement(result.error ?? 'Finish the essential modules first.')
  }

  const phase = colony.settlement.phase
  const expandingRemaining = availableBlueprints.length
  const guide = phase === 'expanding'
    ? {
        eyebrow: `Shape your base · ${progress.built} of ${progress.total}`,
        title: expandingRemaining > 1 ? 'Choose your next room' : 'One room to go',
        body: expandingRemaining > 1
          ? 'Add storage and a laboratory in either order. Their locations are up to you.'
          : 'Place the last essential room wherever it fits your layout.',
      }
    : phase === 'ready'
      ? {
          eyebrow: 'Settlement ready · 5 of 5',
          title: 'This is your moonbase',
          body: 'Power, air, access, stores, and research space are online. Begin when you are ready.',
        }
      : phaseCopy[phase as keyof typeof phaseCopy]

  const singleNextBlueprint = availableBlueprints.length === 1 ? availableBlueprints[0] : null
  const solarBuilt = builtIds.has('module-solar-skid')
  const lifeSupportBuilt = builtIds.has('module-life-support')

  return (
    <div className="game-shell settlement-shell">
      <header className="settlement-topbar">
        <div className="settlement-brand" aria-label="Shackleton landing">
          <span className="brand-mark"><i />PL</span>
          <span><small>First landing</small><strong>Shackleton</strong></span>
        </div>

        <div className="settlement-progress" aria-label={`${progress.built} of ${progress.total} essential modules built`}>
          <span><i style={{ width: `${progress.percent}%` }} /></span>
          <small>{progress.built}/{progress.total} essentials</small>
        </div>

        <div className="settlement-vitals" aria-label="Settlement essentials">
          <span className="vital-materials"><GameIcon name="gear" /><small>Build kits</small><strong>{colony.reserves.constructionStock}</strong></span>
          {solarBuilt && <span className="vital-online"><GameIcon name="power" /><small>Power</small><strong>Online</strong></span>}
          {lifeSupportBuilt && <span className="vital-online"><GameIcon name="oxygen" /><small>Air</small><strong>Stable</strong></span>}
          <button aria-label="Reset settlement" className="settlement-reset" onClick={resetSettlement} title="Start a new landing" type="button"><GameIcon name="reset" /></button>
        </div>
      </header>

      <main className="world-stage settlement-stage">
        <div aria-label="Settlement map viewport. Swipe horizontally to explore the moon." className="settlement-map-scroll" role="region" tabIndex={0}>
          <MoonbaseMap
            buildSites={colony.settlement.buildSites.map((site) => ({
              id: site.id,
              label: site.label,
              moduleId: site.occupiedBy,
              position: { x: site.x, y: site.y, width: 5, height: 4 },
            }))}
            buildingLabel={selectedBlueprint?.name ?? null}
            crew={visibleCrew}
            dustActive={false}
            equipment={[]}
            height={colony.map.height}
            modules={visibleModules}
            onChooseBuildSite={placeBlueprint}
            onInspectModule={setSelectedModuleId}
            plan={colony.operationsPlan}
            selectedModuleId={selectedModuleId}
            width={colony.map.width}
            workOrders={[]}
          />
        </div>

        <section aria-label="Settlement guide" className={`settlement-guide phase-${phase} ${selectedBlueprint ? 'placing' : ''}`}>
          <header>
            <span className="guide-pin"><GameIcon name={phase === 'ready' ? 'check' : selectedBlueprint ? 'map' : 'habitat'} /></span>
            <span><small>{guide.eyebrow}</small><h1>{selectedBlueprint ? `Place ${selectedBlueprint.name}` : guide.title}</h1></span>
          </header>
          <p>{selectedBlueprint ? 'Choose any glowing construction plot on the moon.' : guide.body}</p>

          {phase === 'ready' ? (
            <button className="begin-shift" onClick={startFirstShift} type="button"><GameIcon name="play" /><span><strong>Begin first shift</strong><small>Open colony operations</small></span></button>
          ) : singleNextBlueprint && !selectedBlueprint ? (
            <button
              className="choose-next-build"
              onClick={() => selectBlueprint(singleNextBlueprint.id)}
              type="button"
            >
              <GameIcon name={blueprintIcons[singleNextBlueprint.id]} />
              <span><strong>Place {singleNextBlueprint.name}</strong><small>{singleNextBlueprint.cost} build kits</small></span>
              <GameIcon name="chevron" />
            </button>
          ) : selectedBlueprint ? (
            <button className="cancel-placement" onClick={() => setSelectedBlueprintId(null)} type="button">Cancel placement</button>
          ) : null}
        </section>

        {(phase === 'expanding' || selectedBlueprint) && phase !== 'ready' && (
          <section aria-label="Build blueprints" className={`blueprint-tray ${selectedBlueprint ? 'placing' : ''}`}>
            <header>
              <span><GameIcon name="gear" /><strong>{selectedBlueprint ? 'Choose a build site' : 'Build'}</strong></span>
              <small>{colony.reserves.constructionStock} kits left</small>
            </header>
            <div>
              {availableBlueprints.map((blueprint) => (
                <button
                  aria-pressed={selectedBlueprintId === blueprint.id}
                  className={selectedBlueprintId === blueprint.id ? 'selected' : ''}
                  key={blueprint.id}
                  onClick={() => selectBlueprint(blueprint.id)}
                  type="button"
                >
                  <span className="blueprint-icon"><GameIcon name={blueprintIcons[blueprint.id]} /></span>
                  <span><strong>{blueprint.name}</strong><small>{blueprint.cost} kits · {blueprint.width}×{blueprint.height}</small></span>
                  <i>{selectedBlueprintId === blueprint.id ? <GameIcon name="check" /> : <GameIcon name="plus" />}</i>
                </button>
              ))}
            </div>
          </section>
        )}

        <div aria-live="polite" className="settlement-announcement">{announcement}</div>
        <div aria-hidden="true" className="landing-signature">
          <span>SHACKLETON CRATER</span><i />
        </div>
      </main>
    </div>
  )
}
