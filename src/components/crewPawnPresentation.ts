import type { CrewMember } from '../game/types'
import type { PawnSpriteVariant } from './PawnSprite'

export interface CrewPawnPresentation {
  accent: string
  initials: string
  showStatusDot: boolean
  status: CrewMember['status']
  suited?: boolean
  variant: PawnSpriteVariant
}

const variants: readonly PawnSpriteVariant[] = [
  'umber',
  'gold',
  'olive',
  'rose',
  'copper',
  'slate',
]

const accents = ['#a75b4c', '#527b7d', '#68805f', '#8a6378', '#9a7046', '#596f7c'] as const

const initials = (name: string) => name
  .split(/\s+/)
  .filter(Boolean)
  .map((part) => part[0])
  .join('')
  .slice(0, 2)

export const crewPawnPresentation = (
  member: CrewMember,
  index: number,
  suited = false,
): CrewPawnPresentation => ({
  accent: accents[index % accents.length],
  initials: initials(member.name),
  showStatusDot: true,
  status: member.status,
  suited,
  variant: variants[index % variants.length],
})
