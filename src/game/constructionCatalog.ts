import type { GameIconName } from '../components/GameIcon'
import {
  CONSTRUCTION_GRID_HEIGHT,
  CONSTRUCTION_GRID_WIDTH,
  offsetPresetPoint,
  offsetStarterPoint,
  type BoundaryCell,
  type BoundaryKind,
  type ConstructionLayout,
  type GridPoint,
  type WorkstationPlacement,
} from './construction'

export type BuildCategory = 'structure' | 'furniture' | 'production' | 'power' | 'orders'
export type WorkstationKind =
  | 'bed'
  | 'storage-rack'
  | 'life-support'
  | 'research-bench'
  | 'solar-array'
  | 'battery-bank'

export type ConstructionTool = 'wall' | 'door' | 'erase' | WorkstationKind

export interface WorkstationSpec {
  kind: WorkstationKind
  label: string
  shortLabel: string
  category: Exclude<BuildCategory, 'structure' | 'orders'>
  icon: GameIconName
  width: number
  height: number
  materialCost: number
  indoor: boolean
  description: string
}

export interface BoundarySpec {
  kind: BoundaryKind
  label: string
  materialCost: number
}

export const BOUNDARY_SPECS: Record<BoundaryKind, BoundarySpec> = {
  wall: {
    kind: 'wall',
    label: 'Wall',
    materialCost: 1,
  },
  door: {
    kind: 'door',
    label: 'Door',
    materialCost: 1,
  },
}

export const WORKSTATION_SPECS: Record<WorkstationKind, WorkstationSpec> = {
  bed: {
    kind: 'bed',
    label: 'Bunk bed',
    shortLabel: 'Bunk',
    category: 'furniture',
    icon: 'bed',
    width: 1,
    height: 2,
    materialCost: 2,
    indoor: true,
    description: '1×2 sleeping place',
  },
  'storage-rack': {
    kind: 'storage-rack',
    label: 'Storage rack',
    shortLabel: 'Rack',
    category: 'furniture',
    icon: 'storage',
    width: 2,
    height: 2,
    materialCost: 4,
    indoor: true,
    description: '2×2 material storage',
  },
  'life-support': {
    kind: 'life-support',
    label: 'Life support',
    shortLabel: 'ECLSS',
    category: 'production',
    icon: 'lifeSupport',
    width: 2,
    height: 2,
    materialCost: 4,
    indoor: true,
    description: '2×2 atmosphere processor',
  },
  'research-bench': {
    kind: 'research-bench',
    label: 'Research bench',
    shortLabel: 'Research',
    category: 'production',
    icon: 'microscope',
    width: 3,
    height: 2,
    materialCost: 6,
    indoor: true,
    description: '3×2 science workstation',
  },
  'solar-array': {
    kind: 'solar-array',
    label: 'Solar array',
    shortLabel: 'Solar',
    category: 'power',
    icon: 'solar',
    width: 3,
    height: 2,
    materialCost: 6,
    indoor: false,
    description: '3×2 exterior generator',
  },
  'battery-bank': {
    kind: 'battery-bank',
    label: 'Battery bank',
    shortLabel: 'Battery',
    category: 'power',
    icon: 'battery',
    width: 2,
    height: 1,
    materialCost: 2,
    indoor: false,
    description: '2×1 power storage',
  },
}

export const categoryLabels: Record<BuildCategory, string> = {
  structure: 'Structure',
  furniture: 'Furniture',
  production: 'Production',
  power: 'Power',
  orders: 'Orders',
}

const starterBoundaries = (): BoundaryCell[] => {
  const cells: BoundaryCell[] = []
  for (let x = 3; x <= 7; x += 1) {
    cells.push({ x, y: 7, kind: 'wall' })
    cells.push({ x, y: 11, kind: 'wall' })
  }
  for (let y = 8; y <= 10; y += 1) {
    cells.push({ x: 3, y, kind: 'wall' })
    cells.push({ x: 7, y, kind: y === 9 ? 'door' : 'wall' })
  }
  return cells
    .map((cell) => offsetStarterPoint(cell))
    .sort((left, right) => left.y - right.y || left.x - right.x)
}

const starterWorkstations = (): WorkstationPlacement[] => [
  {
    id: 'starter-bunk-amina',
    type: 'bed',
    label: 'Amina bunk',
    origin: offsetStarterPoint({ x: 4, y: 8 }),
    size: { width: 1, height: 2 },
    rotation: 0,
  },
  {
    id: 'starter-bunk-mateo',
    type: 'bed',
    label: 'Mateo bunk',
    origin: offsetStarterPoint({ x: 5, y: 8 }),
    size: { width: 1, height: 2 },
    rotation: 90,
  },
]

export const createStarterConstruction = (): ConstructionLayout => ({
  width: CONSTRUCTION_GRID_WIDTH,
  height: CONSTRUCTION_GRID_HEIGHT,
  boundaries: starterBoundaries(),
  workstations: starterWorkstations(),
})

const presetBoundaries = (): BoundaryCell[] => {
  const cells = new Map<string, BoundaryCell>()
  const place = (x: number, y: number, kind: BoundaryKind = 'wall') => {
    const point = offsetPresetPoint({ x, y })
    const key = `${point.x}:${point.y}`
    const current = cells.get(key)
    cells.set(key, {
      ...point,
      kind: current?.kind === 'door' || kind === 'door' ? 'door' : 'wall',
    })
  }
  const shell = (
    left: number,
    top: number,
    right: number,
    bottom: number,
    doors: readonly GridDoor[] = [],
  ) => {
    for (let x = left; x <= right; x += 1) {
      place(x, top)
      place(x, bottom)
    }
    for (let y = top; y <= bottom; y += 1) {
      place(left, y)
      place(right, y)
    }
    doors.forEach((door) => place(door.x, door.y, 'door'))
  }

  // A six-zone relay base: habitat, central spine, life support, laboratory,
  // stores, and a dedicated airlock. Shared shell tiles become pressure doors.
  shell(1, 6, 6, 12, [{ x: 6, y: 9 }])
  shell(6, 8, 19, 10, [{ x: 6, y: 9 }])
  shell(8, 3, 12, 8, [{ x: 10, y: 8 }])
  shell(14, 3, 18, 8, [{ x: 16, y: 8 }])
  shell(8, 10, 12, 15, [{ x: 10, y: 10 }])
  shell(14, 10, 18, 15, [
    { x: 16, y: 10 },
    { x: 16, y: 15 },
  ])

  return [...cells.values()].sort((left, right) => left.y - right.y || left.x - right.x)
}

interface GridDoor {
  x: number
  y: number
}

const presetOrigin = (x: number, y: number): GridPoint => offsetPresetPoint({ x, y })

const presetWorkstations = (): WorkstationPlacement[] => [
  ...[
    { id: 'preset-bunk-amina', x: 2, y: 7 },
    { id: 'preset-bunk-mateo', x: 3, y: 7 },
    { id: 'preset-bunk-soo-jin', x: 4, y: 7 },
    { id: 'preset-bunk-leila', x: 2, y: 10 },
    { id: 'preset-bunk-jonah', x: 3, y: 10 },
    { id: 'preset-bunk-nia', x: 4, y: 10 },
  ].map(({ id, x, y }) => ({
    id,
    type: 'bed' as const,
    label: 'Crew bunk',
    origin: presetOrigin(x, y),
    size: { width: 1, height: 2 },
    rotation: 0 as const,
  })),
  {
    id: 'preset-life-support',
    type: 'life-support',
    label: 'Shackleton ECLSS',
    origin: presetOrigin(9, 4),
    size: { width: 2, height: 2 },
    rotation: 0,
  },
  {
    id: 'preset-research-bench',
    type: 'research-bench',
    label: 'Kepler research bench',
    origin: presetOrigin(15, 4),
    size: { width: 3, height: 2 },
    rotation: 0,
  },
  {
    id: 'preset-storage-rack',
    type: 'storage-rack',
    label: 'Mission stores',
    origin: presetOrigin(9, 12),
    size: { width: 2, height: 2 },
    rotation: 0,
  },
  {
    id: 'preset-solar-array',
    type: 'solar-array',
    label: 'East ridge solar array',
    origin: presetOrigin(20, 3),
    size: { width: 3, height: 2 },
    rotation: 0,
  },
  {
    id: 'preset-battery-bank',
    type: 'battery-bank',
    label: 'Surface battery bank',
    origin: presetOrigin(20, 6),
    size: { width: 2, height: 1 },
    rotation: 0,
  },
]

/** The pressurized, furnished relay base used after the opening landing. */
export const createPresetMoonbaseConstruction = (): ConstructionLayout => ({
  width: CONSTRUCTION_GRID_WIDTH,
  height: CONSTRUCTION_GRID_HEIGHT,
  boundaries: presetBoundaries(),
  workstations: presetWorkstations(),
})

export const isWorkstationTool = (tool: ConstructionTool | null): tool is WorkstationKind =>
  Boolean(tool && tool in WORKSTATION_SPECS)
