import type { Equipment, WorkOrderId } from './types'

export type IncidentProfileId = 'leaking_margin' | 'balanced_front' | 'power_window'

export interface IncidentProfileMetadata {
  id: IncidentProfileId
  name: string
  summary: string
  planningFocus: string
}

interface IncidentBalance {
  oxygenHours: number
  batteryKwh: number
  batteryCapacityKwh: number
  dustStartsAtHour: number
  dustBaseDeratePercent: number
  dustMitigatedDeratePercent: number
  workDurationHours: Readonly<Partial<Record<WorkOrderId, number>>>
  equipmentCondition: Readonly<Partial<Record<Equipment['id'], number>>>
}

export interface IncidentProfile extends IncidentProfileMetadata {
  balance: IncidentBalance
}

const profiles = [
  {
    id: 'leaking_margin',
    name: 'Leaking Margin',
    summary: 'A stubborn breach consumes the oxygen cushion, while one engineering kit needs service and a later, lighter dust front leaves power room to recover.',
    planningFocus: 'Only one engineering kit is incident-ready: seal first, then verify and reuse that kit for repressurization.',
    balance: {
      oxygenHours: 28,
      batteryKwh: 36,
      batteryCapacityKwh: 40,
      dustStartsAtHour: 5,
      dustBaseDeratePercent: 40,
      dustMitigatedDeratePercent: 10,
      workDurationHours: { 'work-seal-lab': 3 },
      equipmentCondition: {
        'equipment-eva-01': 74,
        'equipment-engineering-01': 60,
      },
    },
  },
  {
    id: 'balanced_front',
    name: 'Balanced Front',
    summary: 'The reference incident balances a three-hour dust deadline against a healthy but finite oxygen and battery reserve.',
    planningFocus: 'Run breach recovery and solar mitigation in parallel to protect both reserve floors.',
    balance: {
      oxygenHours: 32,
      batteryKwh: 30,
      batteryCapacityKwh: 40,
      dustStartsAtHour: 3,
      dustBaseDeratePercent: 50,
      dustMitigatedDeratePercent: 15,
      workDurationHours: {},
      equipmentCondition: {},
    },
  },
  {
    id: 'power_window',
    name: 'Power Window',
    summary: 'An immediate dense dust front drives the battery near its floor, offset by a larger oxygen reserve.',
    planningFocus: 'Commit the rover team early; prompt solar cleaning is what keeps repressurization and research powered.',
    balance: {
      oxygenHours: 36,
      batteryKwh: 34,
      batteryCapacityKwh: 36,
      dustStartsAtHour: 1,
      dustBaseDeratePercent: 65,
      dustMitigatedDeratePercent: 10,
      workDurationHours: {},
      equipmentCondition: {
        'equipment-eva-02': 72,
        'equipment-rover-01': 68,
      },
    },
  },
] as const satisfies readonly IncidentProfile[]

export const INCIDENT_PROFILE_METADATA: readonly IncidentProfileMetadata[] = profiles.map(
  ({ id, name, summary, planningFocus }) => ({ id, name, summary, planningFocus }),
)

export const normalizeIncidentSeed = (seed: number) => (
  Number.isFinite(seed) ? Math.trunc(seed) : 0
)

export const incidentProfileForSeed = (seed: number): IncidentProfile => {
  const normalized = normalizeIncidentSeed(seed)
  const index = Math.abs(normalized % profiles.length)
  return profiles[index]
}

export const incidentProfileMetadataForSeed = (seed: number): IncidentProfileMetadata => {
  const { id, name, summary, planningFocus } = incidentProfileForSeed(seed)
  return { id, name, summary, planningFocus }
}
