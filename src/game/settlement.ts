import type {
  Actor,
  BuildBlueprint,
  BuildResult,
  BuildableModuleId,
  MoonbaseState,
  SettlementPhase,
} from './types'

export const buildBlueprints: readonly BuildBlueprint[] = [
  {
    id: 'solar_battery_skid',
    name: 'Solar / Battery Skid',
    moduleId: 'module-solar-skid',
    location: 'solar-skid',
    moduleType: 'solar_battery_skid',
    cost: 3,
    width: 5,
    height: 4,
    atmosphere: 'no',
    powerPriority: 1,
  },
  {
    id: 'life_support',
    name: 'Life Support',
    moduleId: 'module-life-support',
    location: 'life-support',
    moduleType: 'life_support',
    cost: 4,
    width: 4,
    height: 4,
    atmosphere: 'yes',
    powerPriority: 1,
  },
  {
    id: 'airlock',
    name: 'South Airlock',
    moduleId: 'module-airlock',
    location: 'airlock',
    moduleType: 'airlock',
    cost: 2,
    width: 3,
    height: 3,
    atmosphere: 'yes',
    powerPriority: 1,
  },
  {
    id: 'storage',
    name: 'Stores',
    moduleId: 'module-storage',
    location: 'storage',
    moduleType: 'storage',
    cost: 2,
    width: 4,
    height: 3,
    atmosphere: 'yes',
    powerPriority: 3,
  },
  {
    id: 'laboratory',
    name: 'Kepler Laboratory',
    moduleId: 'module-laboratory',
    location: 'laboratory',
    moduleType: 'laboratory',
    cost: 3,
    width: 5,
    height: 4,
    atmosphere: 'no',
    powerPriority: 2,
  },
] as const

export interface BuildProgress {
  built: number
  total: number
  percent: number
}

type InteractiveActor = Extract<Actor, 'manual' | 'agent'>

// Store snapshots include action functions at runtime; JSON cloning intentionally
// keeps only the serializable Moonbase domain, matching the simulation boundary.
const cloneState = (state: MoonbaseState): MoonbaseState =>
  JSON.parse(JSON.stringify(state)) as MoonbaseState

const builtBlueprintIds = (state: Pick<MoonbaseState, 'settlement'>) => {
  const builtModuleIds = new Set(state.settlement.builtModuleIds)
  return new Set(
    buildBlueprints
      .filter((blueprint) => builtModuleIds.has(blueprint.moduleId))
      .map((blueprint) => blueprint.id),
  )
}

const phaseFor = (state: Pick<MoonbaseState, 'settlement'>): SettlementPhase => {
  if (state.settlement.phase === 'operations') return 'operations'
  const built = builtBlueprintIds(state)
  if (!built.has('solar_battery_skid')) return 'landing'
  if (!built.has('life_support')) return 'power_online'
  if (built.size === buildBlueprints.length) return 'ready'
  return built.has('airlock') ? 'expanding' : 'habitable'
}

export const availableBlueprintsFor = (
  state: Pick<MoonbaseState, 'settlement'>,
): readonly BuildBlueprint[] => {
  const phase = phaseFor(state)
  const built = builtBlueprintIds(state)
  if (phase === 'landing') {
    return buildBlueprints.filter((blueprint) => blueprint.id === 'solar_battery_skid' && !built.has(blueprint.id))
  }
  if (phase === 'power_online') {
    return buildBlueprints.filter((blueprint) => blueprint.id === 'life_support' && !built.has(blueprint.id))
  }
  if (phase === 'habitable') {
    return buildBlueprints.filter((blueprint) => blueprint.id === 'airlock' && !built.has(blueprint.id))
  }
  if (phase === 'expanding') {
    return buildBlueprints.filter((blueprint) =>
      (blueprint.id === 'storage' || blueprint.id === 'laboratory') &&
      !built.has(blueprint.id),
    )
  }
  return []
}

export const buildProgressFor = (
  state: Pick<MoonbaseState, 'settlement'>,
): BuildProgress => {
  const built = builtBlueprintIds(state).size
  const total = buildBlueprints.length
  return { built, total, percent: Math.round((built / total) * 100) }
}

const buildResult = (
  state: MoonbaseState,
  code: BuildResult['code'],
  ok: boolean,
  details: Pick<BuildResult, 'moduleId' | 'siteId' | 'error'> = {},
): BuildResult => ({
  ok,
  code,
  phase: phaseFor(state),
  worldRevision: state.worldRevision,
  ...details,
})

const addSettlementEvent = (
  state: MoonbaseState,
  actor: InteractiveActor,
  message: string,
  targetIds: string[],
) => {
  state.events.unshift({
    id: `event-settlement-${String(state.worldRevision).padStart(4, '0')}`,
    elapsedHours: state.elapsedHours,
    missionDay: state.missionDay,
    hour: state.hour,
    worldRevision: state.worldRevision,
    planRevision: state.operationsPlan.revision,
    phase: 'changed',
    actor,
    message,
    targetIds,
  })
  state.events = state.events.slice(0, 40)
}

export const constructModule = (
  source: MoonbaseState,
  blueprintId: BuildableModuleId,
  siteId: string,
  actor: InteractiveActor = 'manual',
): [MoonbaseState, BuildResult] => {
  const blueprint = buildBlueprints.find((candidate) => candidate.id === blueprintId)
  if (!blueprint) {
    return [source, buildResult(source, 'unknown_blueprint', false, { error: `Unknown blueprint: ${blueprintId}.` })]
  }

  const site = source.settlement.buildSites.find((candidate) => candidate.id === siteId)
  if (!site) {
    return [source, buildResult(source, 'unknown_site', false, { error: `Unknown build site: ${siteId}.` })]
  }
  if (source.settlement.phase === 'operations') {
    return [source, buildResult(source, 'already_operational', false, { error: 'Base establishment is already complete.' })]
  }
  if (site.occupiedBy) {
    return [source, buildResult(source, 'site_occupied', false, { siteId, error: `${site.label} is already occupied.` })]
  }
  if (!availableBlueprintsFor(source).some((candidate) => candidate.id === blueprintId)) {
    return [source, buildResult(source, 'blueprint_unavailable', false, { error: `${blueprint.name} is not available in the ${phaseFor(source)} phase.` })]
  }
  if (source.reserves.constructionStock < blueprint.cost) {
    return [source, buildResult(source, 'insufficient_stock', false, { error: `${blueprint.name} needs ${blueprint.cost} construction stock.` })]
  }
  if (
    site.x < 0 ||
    site.y < 0 ||
    site.x + blueprint.width > source.map.width ||
    site.y + blueprint.height > source.map.height
  ) {
    return [source, buildResult(source, 'unknown_site', false, { siteId, error: `${site.label} cannot fit ${blueprint.name}.` })]
  }

  const state = cloneState(source)
  const nextSite = state.settlement.buildSites.find((candidate) => candidate.id === siteId)!
  const module = state.modules.find((candidate) => candidate.id === blueprint.moduleId)
  if (!module) {
    return [source, buildResult(source, 'unknown_blueprint', false, { error: `Missing module template: ${blueprint.moduleId}.` })]
  }

  module.position = {
    x: nextSite.x,
    y: nextSite.y,
    width: blueprint.width,
    height: blueprint.height,
  }
  nextSite.occupiedBy = blueprint.id
  state.settlement.builtModuleIds = [...new Set([...state.settlement.builtModuleIds, module.id])]
  state.reserves.constructionStock -= blueprint.cost
  state.worldRevision += 1
  state.settlement.phase = phaseFor(state)
  addSettlementEvent(
    state,
    actor,
    `Constructed ${blueprint.name} at ${nextSite.label}; ${state.reserves.constructionStock} construction stock remains.`,
    [module.id, nextSite.id],
  )

  return [state, buildResult(state, 'built', true, { moduleId: module.id, siteId: nextSite.id })]
}

export const beginOperations = (
  source: MoonbaseState,
  actor: InteractiveActor = 'manual',
): [MoonbaseState, BuildResult] => {
  if (source.settlement.phase === 'operations') {
    return [source, buildResult(source, 'already_operational', false, { error: 'Operations are already active.' })]
  }
  if (phaseFor(source) !== 'ready') {
    return [source, buildResult(source, 'not_ready', false, { error: 'Construct all five establishment modules before beginning operations.' })]
  }

  const state = cloneState(source)
  state.settlement.phase = 'operations'
  state.settlement.builtModuleIds = state.modules.map((module) => module.id)
  state.worldRevision += 1
  state.operationsPlan.basedOnWorldRevision = state.worldRevision
  state.verification = null
  addSettlementEvent(
    state,
    actor,
    'Base establishment complete. Shackleton Relay operations are now active.',
    state.settlement.builtModuleIds,
  )

  return [state, buildResult(state, 'operations_started', true)]
}
