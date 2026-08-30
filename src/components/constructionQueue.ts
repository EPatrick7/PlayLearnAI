import type { GridPoint } from '../game/construction'
import { WORKSTATION_SPECS, type WorkstationKind } from '../game/constructionCatalog'
import {
  carriedConstructionMaterial,
  type ConstructionBlock,
  type ConstructionOrder,
} from '../game/constructionJobs'
import type { GameIconName } from './GameIcon'
import {
  constructionOrderActivity,
  constructionOrderPresentation,
  constructionOrderProgress,
} from './mapInspection'

export type ConstructionQueueTone = 'danger' | 'warning' | 'active' | 'waiting' | 'paused'

export interface ConstructionQueueCommand {
  commandId: string
  label: string
  icon: GameIconName
  priority: number
  priorityLabel: string
  totalJobs: number
  remainingJobs: number
  completedJobs: number
  progress: number
  activity: string
  detail: string
  tone: ConstructionQueueTone
  statusRank: number
  workerIds: string[]
  materialAllocated: number
  materialRequired: number
  salvageRemaining: number
  targetOrderId: string
  targetCell: GridPoint
  sequence: number
}

interface BuildConstructionQueueOptions {
  paused?: boolean
  crewNames?: ReadonlyMap<string, string>
}

const blockRank: Record<ConstructionBlock['kind'], number> = {
  target_changed: 0,
  carrier_unavailable: 1,
  no_path: 2,
  insufficient_materials: 4,
  prerequisite: 5,
}

const blockingRank = (order: ConstructionOrder) => {
  if (order.block) return blockRank[order.block.kind]
  return order.status === 'blocked' ? 3 : null
}

const representativeRank = (order: ConstructionOrder) => {
  const blocked = blockingRank(order)
  if (blocked !== null) return blocked
  if (order.assignedCrewId && order.status === 'building') return 6
  if (order.assignedCrewId && order.travelPhase === 'at_site') return 7
  if (order.assignedCrewId && order.travelPhase === 'to_site') return 8
  if (order.assignedCrewId && order.travelPhase === 'to_stockpile') return 9
  if (order.assignedCrewId) return 10
  return 11
}

const compareRepresentative = (left: ConstructionOrder, right: ConstructionOrder) => (
  representativeRank(left) - representativeRank(right)
  || right.priority - left.priority
  || left.sequence - right.sequence
  || left.id.localeCompare(right.id)
)

const pluralJob = (count: number) => `${count} ${count === 1 ? 'job' : 'jobs'}`

const workstationSubject = (order: ConstructionOrder, side: 'construct' | 'deconstruct') => {
  if (order.target.kind !== 'workstation') return null
  const target = order.target[side]
  const spec = target ? WORKSTATION_SPECS[target.type as WorkstationKind] : null
  return target ? spec?.label ?? target.label : null
}

const boundarySubject = (order: ConstructionOrder, side: 'construct' | 'deconstruct') => {
  if (order.target.kind !== 'boundary') return null
  const target = order.target[side]
  return target ? target.kind === 'door' ? 'Door' : 'Wall' : null
}

const targetSubject = (order: ConstructionOrder, side: 'construct' | 'deconstruct') => (
  boundarySubject(order, side) ?? workstationSubject(order, side)
)

const orderLabel = (order: ConstructionOrder) => {
  const presentation = constructionOrderPresentation(order)
  const constructed = targetSubject(order, 'construct')
  const deconstructed = targetSubject(order, 'deconstruct')
  if (order.operation === 'deconstruct') {
    return {
      key: `deconstruct:${deconstructed}`,
      label: `Deconstruct ${(deconstructed ?? 'object').toLowerCase()}`,
      icon: 'minus' as const,
    }
  }
  if (order.operation === 'replace') {
    return {
      key: `replace:${deconstructed}:${constructed}`,
      label: `Replace ${(deconstructed ?? 'object').toLowerCase()} → ${(constructed ?? 'object').toLowerCase()}`,
      icon: presentation.icon,
    }
  }
  return {
    key: `construct:${constructed}`,
    label: constructed ?? 'Construction',
    icon: presentation.icon,
  }
}

const commandLabel = (orders: readonly ConstructionOrder[]) => {
  const presentations = orders.map(orderLabel)
  const distinctLabels = new Set(presentations.map((presentation) => presentation.key))
  if (distinctLabels.size > 1) {
    const allDeconstruct = orders.every((order) => order.operation === 'deconstruct')
    return {
      label: `${allDeconstruct ? 'Deconstruct selection' : 'Mixed construction'} ×${orders.length}`,
      icon: allDeconstruct ? 'minus' as const : 'work' as const,
    }
  }

  const presentation = presentations[0]
  return {
    label: `${presentation.label}${orders.length > 1 ? ` ×${orders.length}` : ''}`,
    icon: presentation.icon,
  }
}

const blockerActivity = (
  kind: ConstructionBlock['kind'],
  count: number,
) => {
  if (kind === 'target_changed') return count === 1 ? 'Target changed' : `${count} targets changed`
  if (kind === 'carrier_unavailable') return count === 1
    ? 'Carrier unavailable'
    : `${count} carriers unavailable`
  if (kind === 'no_path') return count === 1 ? 'No route' : `${count} have no route`
  if (kind === 'insufficient_materials') return count === 1
    ? 'Needs material'
    : `${count} need material`
  return count === 1 ? 'Waiting on prerequisite' : `${count} wait on prerequisites`
}

const countActivity = (activity: string, count: number) => (
  `${count} ${activity.toLowerCase()}`
)

const activityFor = (
  openOrders: readonly ConstructionOrder[],
  representative: ConstructionOrder,
  paused: boolean,
  crewNames: ReadonlyMap<string, string>,
) => {
  const blockedRank = blockingRank(representative)
  const blocker = blockedRank !== null
    ? representative.block
      ? blockerActivity(
          representative.block.kind,
          openOrders.filter((order) => order.block?.kind === representative.block?.kind).length,
        )
      : 'Blocked'
    : null
  const workable = openOrders.filter((order) => blockingRank(order) === null)
  const activeRepresentative = [...workable].sort(compareRepresentative)[0] ?? null
  const active = workable.length === 0
    ? null
    : paused
      ? 'Paused'
      : activeRepresentative
        ? (() => {
            const phase = constructionOrderActivity(activeRepresentative)
            const count = workable.filter((order) => (
              constructionOrderActivity(order) === phase
            )).length
            return countActivity(phase, count)
          })()
        : null
  const assignedCrewIds = [...new Set(openOrders.flatMap((order) => (
    order.assignedCrewId ? [order.assignedCrewId] : []
  )))]
  const builders = assignedCrewIds.map((crewId) => crewNames.get(crewId) ?? crewId).join(', ')
  const detail = representative.block?.message
    ?? (builders
      ? `${builders} assigned to this placement.`
      : paused
        ? 'Resume time to let colonists continue this placement.'
        : 'A colonist will take this placement when available.')
  return {
    activity: [blocker, active].filter(Boolean).join(' · '),
    detail,
    tone: blocker
      ? blockedRank === 0 || blockedRank === 2 ? 'danger' as const : 'warning' as const
      : paused
        ? 'paused' as const
        : assignedCrewIds.length > 0
          ? 'active' as const
          : 'waiting' as const,
    statusRank: blockedRank ?? (paused ? 12 : representativeRank(representative)),
  }
}

export const buildConstructionQueue = (
  orders: readonly ConstructionOrder[],
  {
    paused = false,
    crewNames = new Map<string, string>(),
  }: BuildConstructionQueueOptions = {},
): ConstructionQueueCommand[] => {
  const byCommand = new Map<string, ConstructionOrder[]>()
  orders.forEach((order) => {
    const group = byCommand.get(order.commandId) ?? []
    group.push(order)
    byCommand.set(order.commandId, group)
  })

  return [...byCommand.entries()].flatMap(([commandId, group]) => {
    const sorted = [...group].sort((left, right) => (
      left.sequence - right.sequence || left.id.localeCompare(right.id)
    ))
    const open = sorted.filter((order) => order.status !== 'complete')
    if (open.length === 0) return []

    const representative = [...open].sort(compareRepresentative)[0]
    const completedJobs = sorted.length - open.length
    const progressWeight = sorted.reduce((total, order) => total + Math.max(1, order.work.required), 0)
    const progress = Math.round(sorted.reduce((total, order) => (
      total + (order.status === 'complete' ? 100 : constructionOrderProgress(order))
        * Math.max(1, order.work.required)
    ), 0) / progressWeight)
    const presentation = commandLabel(sorted)
    const activity = activityFor(open, representative, paused, crewNames)
    const priorities = [...new Set(open.map((order) => order.priority))].sort((left, right) => left - right)
    const workerIds = [...new Set(open.flatMap((order) => (
      order.assignedCrewId
        ? [order.assignedCrewId]
        : order.materials.carriedByCrewId
          ? [order.materials.carriedByCrewId]
          : []
    )))]
    const materialRequired = open.reduce((total, order) => total + order.materials.required, 0)
    const materialAllocated = open.reduce((total, order) => total + Math.min(
      order.materials.required,
      order.materials.delivered
        + carriedConstructionMaterial(order)
        + order.materials.reserved,
    ), 0)
    const salvageRemaining = open.reduce((total, order) => total + order.materials.recoverable, 0)
    const progressDetail = completedJobs > 0
      ? `${pluralJob(open.length)} left · ${completedJobs} complete`
      : `${pluralJob(open.length)} remaining`

    return [{
      commandId,
      label: presentation.label,
      icon: presentation.icon,
      priority: representative.priority,
      priorityLabel: priorities.length === 1
        ? `P${priorities[0]}`
        : `P${priorities[0]}–P${priorities.at(-1)}`,
      totalJobs: sorted.length,
      remainingJobs: open.length,
      completedJobs,
      progress,
      activity: activity.activity,
      detail: `${activity.detail} ${progressDetail}.`,
      tone: activity.tone,
      statusRank: activity.statusRank,
      workerIds,
      materialAllocated,
      materialRequired,
      salvageRemaining,
      targetOrderId: representative.id,
      targetCell: { ...representative.target.cells[0] },
      sequence: sorted[0].sequence,
    }]
  }).sort((left, right) => (
    left.sequence - right.sequence
    || left.commandId.localeCompare(right.commandId)
  ))
}
