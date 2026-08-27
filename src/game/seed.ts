import type { ColonyState, Colonist, SkillKey, WorkOrder } from './types'

const names = [
  ['Alda Coppervein', 'Prospector', 'spots patterns in stone'],
  ['Bram Flintbeard', 'Mason', 'perfectionist'],
  ['Cora Mossmantle', 'Grower', 'works best at dawn'],
  ['Dain Emberhand', 'Smith', 'never abandons a task'],
  ['Edda Rootwise', 'Herbalist', 'calms nearby workers'],
  ['Fenn Ironwhistle', 'Hauler', 'fast but distractible'],
  ['Gilda Deepdelver', 'Miner', 'ignores minor injuries'],
  ['Harl Oakenshield', 'Woodcutter', 'afraid of caverns'],
  ['Iona Bronzebraid', 'Medic', 'needs regular rest'],
  ['Jori Coalfoot', 'Miner', 'thrives under pressure'],
  ['Ketta Barleybrew', 'Cook', 'wastes nothing'],
  ['Ludo Stonecap', 'Mason', 'hates unfinished rooms'],
  ['Mara Silverpick', 'Prospector', 'learns new work quickly'],
  ['Nori Pinekeg', 'Woodcutter', 'high spirits'],
  ['Orin Ashbelt', 'Hauler', 'night owl'],
  ['Pella Fernhelm', 'Grower', 'injury prone'],
  ['Quill Graniteeye', 'Surveyor', 'careful planner'],
  ['Runa Goldthumb', 'Herbalist', 'hoards remedies'],
  ['Sella Tinboot', 'Builder', 'steady under pressure'],
  ['Torra Flintlock', 'Guard', 'protective of friends'],
] as const

const specialties: SkillKey[] = [
  'mining',
  'masonry',
  'farming',
  'masonry',
  'medicine',
  'hauling',
  'mining',
  'woodcutting',
  'medicine',
  'mining',
  'farming',
  'masonry',
  'mining',
  'woodcutting',
  'hauling',
  'farming',
  'mining',
  'medicine',
  'masonry',
  'hauling',
]

const makeColonists = (): Colonist[] =>
  names.map(([name, title, trait], index) => {
    const specialty = specialties[index]
    const skills = {
      farming: 1 + ((index * 2) % 4),
      woodcutting: 1 + ((index * 3) % 4),
      mining: 1 + ((index * 5) % 4),
      masonry: 1 + ((index * 7) % 4),
      medicine: 1 + ((index * 11) % 4),
      hauling: 2 + ((index * 13) % 3),
    }
    skills[specialty] = 7 + (index % 4)

    return {
      id: `dwarf-${String(index + 1).padStart(2, '0')}`,
      name,
      title,
      trait,
      status: index === 8 || index === 15 ? 'injured' : 'idle',
      health: index === 8 ? 62 : index === 15 ? 71 : 88 + (index % 12),
      morale: 54 + ((index * 7) % 39),
      fatigue: 12 + ((index * 11) % 61),
      hunger: 10 + ((index * 9) % 52),
      location: index % 3 === 0 ? 'Great Hall' : index % 3 === 1 ? 'East Gallery' : 'Surface Camp',
      assignedOrderId: null,
      skills,
    }
  })

const initialOrders: WorkOrder[] = [
  {
    id: 'order-001',
    type: 'harvest_food',
    label: 'Harvest cave wheat',
    priority: 5,
    requiredSkill: 'farming',
    workers: [],
    progress: 36,
    target: 100,
    status: 'queued',
    createdAt: 0,
  },
  {
    id: 'order-002',
    type: 'mine_stone',
    label: 'Expand eastern dormitory',
    priority: 3,
    requiredSkill: 'mining',
    workers: [],
    progress: 18,
    target: 100,
    status: 'queued',
    createdAt: 0,
  },
  {
    id: 'order-003',
    type: 'treat_injured',
    label: 'Treat injured colonists',
    priority: 5,
    requiredSkill: 'medicine',
    workers: [],
    progress: 12,
    target: 100,
    status: 'queued',
    createdAt: 0,
  },
  {
    id: 'order-004',
    type: 'chop_wood',
    label: 'Gather construction timber',
    priority: 2,
    requiredSkill: 'woodcutting',
    workers: [],
    progress: 51,
    target: 100,
    status: 'queued',
    createdAt: 0,
  },
]

export const createInitialState = (): ColonyState => ({
  colonyName: 'Emberdeep',
  day: 7,
  hour: 6,
  tick: 0,
  season: 'Early Spring',
  weather: 'Cold rain',
  resources: { food: 84, wood: 38, stone: 117, ore: 24, medicine: 6 },
  capacity: { food: 300, wood: 200, stone: 400, ore: 200, medicine: 50 },
  colonists: makeColonists(),
  workOrders: initialOrders,
  alerts: [
    {
      id: 'alert-food',
      severity: 'critical',
      title: 'Food reserves: 1.8 days',
      detail: 'Twenty mouths and an unfinished harvest make this the immediate bottleneck.',
    },
    {
      id: 'alert-clinic',
      severity: 'warning',
      title: 'Two untreated injuries',
      detail: 'Untreated colonists recover slowly and cannot safely perform strenuous work.',
    },
    {
      id: 'alert-beds',
      severity: 'info',
      title: 'Six colonists lack bedrooms',
      detail: 'Crowding will gradually reduce morale.',
    },
  ],
  events: [
    { id: 'event-1', tick: 0, tone: 'bad', message: 'Cold rain spoiled 14 units of surface grain.' },
    { id: 'event-2', tick: 0, tone: 'neutral', message: 'Alda reports a rich ore vein beyond the east wall.' },
    { id: 'event-3', tick: 0, tone: 'neutral', message: 'Morning shift is awaiting assignments.' },
  ],
  learning: {
    score: 0,
    phase: 'inspect',
    completedLoops: 0,
    coaching: 'Start with context: ask your agent to assess the colony before it changes anything.',
    toolCalls: [],
  },
})
