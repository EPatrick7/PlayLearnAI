import type {
  Actor,
  BuildBlueprint,
  BuildResult,
  BuildableModuleId,
  MoonbaseState,
  SettlementPhase,
} from './types'
import {
  detectRooms,
  getWorkstationCells,
  getWorkstationFootprintSize,
  type ConstructionLayout,
} from './construction'
import {
  analyzeConstructionPressure,
  constructionEnvironmentAt,
} from './pressureTopology'

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
    siteKind: 'exterior_power',
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
    width: 5,
    height: 6,
    siteKind: 'pressurized_bay',
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
    width: 5,
    height: 6,
    siteKind: 'pressurized_bay',
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
    width: 5,
    height: 6,
    siteKind: 'pressurized_bay',
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
    height: 6,
    siteKind: 'pressurized_bay',
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

const freeformReadyForOperations = (layout: ConstructionLayout) => {
  const pressure = analyzeConstructionPressure(layout)
  return pressure.rooms.length >= 2 &&
    layout.workstations.some((workstation) => workstation.type === 'life-support') &&
    pressure.doors.some((door) =>
      door.role === 'exterior_airlock' && door.roomIds.length === 1,
    )
}

const hasOpenConstruction = (state: Pick<MoonbaseState, 'settlement'>) =>
  state.settlement.constructionOrders.some((order) => order.status !== 'complete')

export const canBeginOperations = (
  state: Pick<MoonbaseState, 'settlement'>,
) => {
  if (state.settlement.phase === 'operations') return false
  if (hasOpenConstruction(state)) return false
  const pressure = analyzeConstructionPressure(state.settlement.layout)
  if (!pressure.doors.some((door) => (
    door.role === 'exterior_airlock' && door.roomIds.length === 1
  ))) return false
  if (!state.settlement.constructionCrew.every((position) => (
    constructionEnvironmentAt(state.settlement.layout, pressure, position.cell) === 'pressurized'
  ))) return false
  return phaseFor(state) === 'ready' || freeformReadyForOperations(state.settlement.layout)
}

const alignOperationsModulesToConstruction = (state: MoonbaseState) => {
  const layout = state.settlement.layout
  const rooms = detectRooms(layout)
  if (rooms.length < 2) return
  const bunkCells = new Set(
    layout.workstations
      .filter((workstation) => workstation.type === 'bed')
      .flatMap(getWorkstationCells)
      .map((cell) => `${cell.x}:${cell.y}`),
  )
  const habitatRoom = rooms.find((room) => room.cells.some(
    (cell) => bunkCells.has(`${cell.x}:${cell.y}`),
  )) ?? rooms[0]
  const expansionRooms = rooms.filter((room) => room.id !== habitatRoom.id)
  const semanticRooms = [habitatRoom, ...expansionRooms]

  const shellForRoom = (roomIndex: number) => {
    const room = semanticRooms[Math.min(roomIndex, semanticRooms.length - 1)]
    const x = Math.max(0, room.bounds.x - 1)
    const y = Math.max(0, room.bounds.y - 1)
    return {
      x,
      y,
      width: Math.min(layout.width - x, room.bounds.width + 2),
      height: Math.min(layout.height - y, room.bounds.height + 2),
    }
  }
  const workstationPosition = (type: string) => {
    const workstation = layout.workstations.find((candidate) => candidate.type === type)
    if (!workstation) return null
    const footprint = getWorkstationFootprintSize(workstation)
    return { ...workstation.origin, ...footprint }
  }
  const door = semanticRooms[1].doorCells[0] ?? semanticRooms[0].doorCells[0] ?? { x: 0, y: 0 }
  const rightmostRoomEdge = Math.max(...rooms.map((room) => room.bounds.x + room.bounds.width))
  const exteriorX = Math.max(0, Math.min(layout.width - 3, rightmostRoomEdge + 2))
  const exteriorY = Math.max(0, Math.min(layout.height - 2, semanticRooms[1].bounds.y))
  const habitat = shellForRoom(0)
  const laboratory = shellForRoom(1)
  const habitatStorageCell = {
    x: Math.min(layout.width - 1, habitat.x + Math.min(1, habitat.width - 1)),
    y: Math.min(layout.height - 1, habitat.y + Math.min(1, habitat.height - 1)),
    width: 1,
    height: 1,
  }

  state.modules.forEach((module) => {
    const position = module.type === 'habitat'
      ? habitat
      : module.type === 'laboratory'
        ? laboratory
        : module.type === 'life_support'
          ? workstationPosition('life-support') ?? laboratory
          : module.type === 'storage'
            ? workstationPosition('storage-rack') ?? habitatStorageCell
            : module.type === 'airlock' || module.type === 'corridor'
              ? { x: door.x, y: door.y, width: 1, height: 1 }
              : module.type === 'solar_battery_skid'
                ? workstationPosition('solar-array') ?? workstationPosition('battery-bank') ?? {
                    x: exteriorX,
                    y: exteriorY,
                    width: 3,
                    height: 2,
                  }
                : module.type === 'landing_pad'
                  ? {
                      x: Math.max(0, layout.width - 4),
                      y: Math.max(0, layout.height - 3),
                      width: 4,
                      height: 3,
                    }
                  : null
    if (position) module.position = position
  })
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
    site.kind !== blueprint.siteKind ||
    (blueprint.siteKind === 'pressurized_bay' && site.connectionSide === null)
  ) {
    const expected = blueprint.siteKind === 'exterior_power' ? 'an exterior power pad' : 'a corridor-connected room bay'
    return [source, buildResult(source, 'incompatible_site', false, {
      siteId,
      error: `${blueprint.name} needs ${expected}; ${site.label} is not compatible.`,
    })]
  }
  if (
    site.x < 0 ||
    site.y < 0 ||
    site.x + site.width > source.map.width ||
    site.y + site.height > source.map.height ||
    blueprint.width > site.width ||
    blueprint.height > site.height
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
    width: nextSite.width,
    height: nextSite.height,
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
  if (!canBeginOperations(source)) {
    return [source, buildResult(source, 'not_ready', false, {
      error: hasOpenConstruction(source)
        ? 'Finish or cancel all open construction before beginning operations.'
        : 'Enclose a second room, install Life Support and a working exterior airlock, and bring every colonist inside before beginning operations.',
    })]
  }

  const state = cloneState(source)
  if (freeformReadyForOperations(source.settlement.layout)) {
    alignOperationsModulesToConstruction(state)
  }
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
