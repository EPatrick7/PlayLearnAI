import type {
  AssignmentInput,
  ColonyAlert,
  ColonyState,
  CreateOrderInput,
  ResourceKey,
  SkillKey,
  WorkOrder,
  WorkOrderType,
} from './types'

export const orderCatalog: Record<
  WorkOrderType,
  { label: string; skill: SkillKey; output?: [ResourceKey, number] }
> = {
  harvest_food: { label: 'Harvest cave wheat', skill: 'farming', output: ['food', 80] },
  chop_wood: { label: 'Gather construction timber', skill: 'woodcutting', output: ['wood', 55] },
  mine_stone: { label: 'Excavate useful stone', skill: 'mining', output: ['stone', 70] },
  mine_ore: { label: 'Extract metal ore', skill: 'mining', output: ['ore', 45] },
  craft_medicine: { label: 'Brew restorative tonic', skill: 'medicine', output: ['medicine', 8] },
  build_bedroom: { label: 'Build private bedrooms', skill: 'masonry' },
  treat_injured: { label: 'Treat injured colonists', skill: 'medicine' },
}

// Zustand attaches action functions to the object supplied by the UI. The game
// state itself is intentionally JSON-safe, so serialization cleanly strips
// those actions while producing the detached snapshot our pure simulation uses.
const cloneState = (state: ColonyState): ColonyState => JSON.parse(JSON.stringify(state)) as ColonyState

const clamp = (value: number, minimum = 0, maximum = 100) => Math.min(maximum, Math.max(minimum, value))

const foodDays = (state: ColonyState) => state.resources.food / (state.colonists.length * 2.4)

export const deriveAlerts = (state: ColonyState): ColonyAlert[] => {
  const alerts: ColonyAlert[] = []
  const days = foodDays(state)
  const injured = state.colonists.filter((colonist) => colonist.status === 'injured')
  const exhausted = state.colonists.filter((colonist) => colonist.fatigue >= 80)
  const lowMorale = state.colonists.filter((colonist) => colonist.morale < 35)

  if (days < 3) {
    alerts.push({
      id: 'alert-food',
      severity: days < 1.5 ? 'critical' : 'warning',
      title: `Food reserves: ${days.toFixed(1)} days`,
      detail: 'Food is consumed continuously; assign capable growers before reserves collapse.',
    })
  }
  if (injured.length > 0) {
    alerts.push({
      id: 'alert-clinic',
      severity: injured.length >= 3 ? 'critical' : 'warning',
      title: `${injured.length} untreated ${injured.length === 1 ? 'injury' : 'injuries'}`,
      detail: 'Treatment needs medicine and a skilled, rested worker.',
    })
  }
  if (exhausted.length > 0) {
    alerts.push({
      id: 'alert-fatigue',
      severity: exhausted.length >= 4 ? 'critical' : 'warning',
      title: `${exhausted.length} exhausted ${exhausted.length === 1 ? 'worker' : 'workers'}`,
      detail: 'Exhausted workers progress slowly and are more likely to become injured.',
    })
  }
  if (lowMorale.length > 0) {
    alerts.push({
      id: 'alert-morale',
      severity: 'warning',
      title: `${lowMorale.length} colonists near breaking point`,
      detail: 'Rest, private rooms, and completed priorities restore morale.',
    })
  }
  if (alerts.length === 0) {
    alerts.push({
      id: 'alert-stable',
      severity: 'info',
      title: 'Colony systems are stable',
      detail: 'This is a good moment to prepare capacity before the next incident.',
    })
  }
  return alerts
}

const completeOrder = (state: ColonyState, order: WorkOrder) => {
  const catalogEntry = orderCatalog[order.type]
  order.status = 'complete'
  order.progress = order.target

  if (catalogEntry.output) {
    const [resource, amount] = catalogEntry.output
    state.resources[resource] = Math.min(state.capacity[resource], state.resources[resource] + amount)
  }

  if (order.type === 'treat_injured') {
    const patients = state.colonists.filter((colonist) => colonist.status === 'injured').slice(0, 2)
    const medicineSpent = Math.min(state.resources.medicine, patients.length * 2)
    state.resources.medicine -= medicineSpent
    patients.forEach((patient) => {
      patient.health = clamp(patient.health + 28)
      patient.status = 'resting'
      patient.morale = clamp(patient.morale + 8)
    })
  }

  if (order.type === 'build_bedroom') {
    state.colonists.forEach((colonist) => {
      colonist.morale = clamp(colonist.morale + 4)
    })
  }

  state.colonists.forEach((colonist) => {
    if (colonist.assignedOrderId === order.id) {
      colonist.assignedOrderId = null
      colonist.status = colonist.fatigue > 72 ? 'resting' : 'idle'
    }
  })

  state.events.unshift({
    id: `event-${state.tick}-${order.id}`,
    tick: state.tick,
    tone: 'good',
    message: `Completed: ${order.label}.`,
  })
}

export const advanceSimulation = (source: ColonyState, hours: number): ColonyState => {
  const state = cloneState(source)
  const boundedHours = Math.max(1, Math.min(8, Math.round(hours)))

  for (let step = 0; step < boundedHours; step += 1) {
    state.tick += 1
    state.hour += 1
    if (state.hour >= 24) {
      state.hour = 0
      state.day += 1
    }

    state.resources.food = Math.max(0, state.resources.food - state.colonists.length * 0.1)

    for (const colonist of state.colonists) {
      colonist.hunger = clamp(colonist.hunger + 2)
      if (colonist.assignedOrderId) {
        colonist.fatigue = clamp(colonist.fatigue + 4)
        colonist.morale = clamp(colonist.morale - (colonist.fatigue > 80 ? 2 : 0.25))
      } else {
        colonist.fatigue = clamp(colonist.fatigue - (colonist.status === 'resting' ? 7 : 3))
        colonist.hunger = clamp(colonist.hunger - 1)
        if (colonist.status === 'resting' && colonist.fatigue < 45) colonist.status = 'idle'
      }
      if (state.resources.food === 0) colonist.health = clamp(colonist.health - 3)
    }

    for (const order of state.workOrders.filter((candidate) => candidate.status === 'active')) {
      const workers = state.colonists.filter((colonist) => order.workers.includes(colonist.id))
      const progress = workers.reduce((sum, worker) => {
        const fatiguePenalty = worker.fatigue > 75 ? 0.55 : 1
        return sum + (2 + worker.skills[order.requiredSkill] * 0.7) * fatiguePenalty
      }, 0)
      order.progress += progress
      if (order.progress >= order.target) completeOrder(state, order)
    }
  }

  state.alerts = deriveAlerts(state)
  state.events = state.events.slice(0, 12)
  return state
}

export const createOrder = (source: ColonyState, input: CreateOrderInput): [ColonyState, string] => {
  const state = cloneState(source)
  const catalogEntry = orderCatalog[input.type]
  const id = `order-${String(state.tick + state.workOrders.length + 1).padStart(3, '0')}`
  state.workOrders.push({
    id,
    type: input.type,
    label: catalogEntry.label,
    priority: input.priority,
    requiredSkill: catalogEntry.skill,
    workers: [],
    progress: 0,
    target: 100,
    status: 'queued',
    createdAt: state.tick,
  })
  state.events.unshift({
    id: `event-${state.tick}-${id}`,
    tick: state.tick,
    tone: 'agent',
    message: `Agent created work order: ${catalogEntry.label} (priority ${input.priority}).`,
  })
  return [state, id]
}

export const assignColonists = (
  source: ColonyState,
  assignments: AssignmentInput[],
): [ColonyState, { assigned: string[]; errors: string[] }] => {
  const state = cloneState(source)
  const assigned: string[] = []
  const errors: string[] = []

  for (const assignment of assignments.slice(0, 12)) {
    const colonist = state.colonists.find((candidate) => candidate.id === assignment.colonistId)
    if (!colonist) {
      errors.push(`Unknown colonist: ${assignment.colonistId}`)
      continue
    }
    if (colonist.status === 'injured') {
      errors.push(`${colonist.name} is injured and cannot be assigned.`)
      continue
    }

    state.workOrders.forEach((order) => {
      order.workers = order.workers.filter((workerId) => workerId !== colonist.id)
      if (order.workers.length === 0 && order.status === 'active') order.status = 'queued'
    })

    if (assignment.workOrderId === null) {
      colonist.assignedOrderId = null
      colonist.status = colonist.fatigue > 70 ? 'resting' : 'idle'
      assigned.push(`${colonist.name} → unassigned`)
      continue
    }

    const order = state.workOrders.find(
      (candidate) => candidate.id === assignment.workOrderId && candidate.status !== 'complete' && candidate.status !== 'cancelled',
    )
    if (!order) {
      errors.push(`Unknown or closed work order: ${assignment.workOrderId}`)
      continue
    }
    if (order.workers.length >= 4) {
      errors.push(`${order.label} already has the maximum of four workers.`)
      continue
    }

    order.workers.push(colonist.id)
    order.status = 'active'
    colonist.assignedOrderId = order.id
    colonist.status = 'working'
    assigned.push(`${colonist.name} → ${order.label}`)
  }

  if (assigned.length > 0) {
    state.events.unshift({
      id: `event-${state.tick}-assign`,
      tick: state.tick,
      tone: 'agent',
      message: `Agent updated ${assigned.length} assignment${assigned.length === 1 ? '' : 's'}.`,
    })
  }
  return [state, { assigned, errors }]
}

export const reprioritizeOrder = (
  source: ColonyState,
  orderId: string,
  priority: 1 | 2 | 3 | 4 | 5,
): [ColonyState, boolean] => {
  const state = cloneState(source)
  const order = state.workOrders.find((candidate) => candidate.id === orderId)
  if (!order || order.status === 'complete' || order.status === 'cancelled') return [state, false]
  order.priority = priority
  state.events.unshift({
    id: `event-${state.tick}-priority`,
    tick: state.tick,
    tone: 'agent',
    message: `Agent changed ${order.label} to priority ${priority}.`,
  })
  return [state, true]
}
