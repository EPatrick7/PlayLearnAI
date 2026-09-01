import type { GameIconName } from '../components/GameIcon'
import type {
  BoundaryCell,
  BoundaryKind,
  ConstructionLayout,
  WorkstationPlacement,
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
  return cells.sort((left, right) => left.y - right.y || left.x - right.x)
}

const starterWorkstations = (): WorkstationPlacement[] => [
  {
    id: 'starter-bunk-amina',
    type: 'bed',
    label: 'Amina bunk',
    origin: { x: 4, y: 8 },
    size: { width: 1, height: 2 },
    rotation: 0,
  },
  {
    id: 'starter-bunk-mateo',
    type: 'bed',
    label: 'Mateo bunk',
    origin: { x: 5, y: 8 },
    size: { width: 1, height: 2 },
    rotation: 90,
  },
]

export const createStarterConstruction = (): ConstructionLayout => ({
  width: 24,
  height: 18,
  boundaries: starterBoundaries(),
  workstations: starterWorkstations(),
})

export const isWorkstationTool = (tool: ConstructionTool | null): tool is WorkstationKind =>
  Boolean(tool && tool in WORKSTATION_SPECS)
