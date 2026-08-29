import { boundaryAt, type ConstructionLayout, type GridPoint } from './construction'

/**
 * Cardinal connection bits follow clockwise NESW order so a tile's complete
 * neighborhood can be represented by a compact, deterministic four-bit mask.
 */
export const BOUNDARY_CONNECTION_BITS = {
  north: 1,
  east: 2,
  south: 4,
  west: 8,
} as const

export type BoundaryConnectionMask =
  | 0
  | 1
  | 2
  | 3
  | 4
  | 5
  | 6
  | 7
  | 8
  | 9
  | 10
  | 11
  | 12
  | 13
  | 14
  | 15

export type BoundaryConnectionName =
  | 'isolated'
  | 'end-north'
  | 'end-east'
  | 'end-south'
  | 'end-west'
  | 'straight-vertical'
  | 'straight-horizontal'
  | 'corner-north-east'
  | 'corner-east-south'
  | 'corner-south-west'
  | 'corner-west-north'
  | 'tee-north-east-south'
  | 'tee-east-south-west'
  | 'tee-south-west-north'
  | 'tee-west-north-east'
  | 'cross'

export interface BoundaryConnection {
  mask: BoundaryConnectionMask
  name: BoundaryConnectionName
  className: `boundary-connection-${BoundaryConnectionName}`
}

export type BoundaryDoorAxis = 'horizontal' | 'vertical'

const connectionNames: Record<BoundaryConnectionMask, BoundaryConnectionName> = {
  0: 'isolated',
  1: 'end-north',
  2: 'end-east',
  3: 'corner-north-east',
  4: 'end-south',
  5: 'straight-vertical',
  6: 'corner-east-south',
  7: 'tee-north-east-south',
  8: 'end-west',
  9: 'corner-west-north',
  10: 'straight-horizontal',
  11: 'tee-west-north-east',
  12: 'corner-south-west',
  13: 'tee-south-west-north',
  14: 'tee-east-south-west',
  15: 'cross',
}

export const getBoundaryConnectionName = (
  mask: BoundaryConnectionMask,
): BoundaryConnectionName => connectionNames[mask]

export const getBoundaryDoorAxis = (
  mask: BoundaryConnectionMask,
): BoundaryDoorAxis => {
  const horizontalPair = (mask & (
    BOUNDARY_CONNECTION_BITS.east | BOUNDARY_CONNECTION_BITS.west
  )) === (BOUNDARY_CONNECTION_BITS.east | BOUNDARY_CONNECTION_BITS.west)
  const verticalPair = (mask & (
    BOUNDARY_CONNECTION_BITS.north | BOUNDARY_CONNECTION_BITS.south
  )) === (BOUNDARY_CONNECTION_BITS.north | BOUNDARY_CONNECTION_BITS.south)

  if (horizontalPair !== verticalPair) return horizontalPair ? 'horizontal' : 'vertical'

  const horizontalScore = Number(Boolean(mask & BOUNDARY_CONNECTION_BITS.east)) +
    Number(Boolean(mask & BOUNDARY_CONNECTION_BITS.west))
  const verticalScore = Number(Boolean(mask & BOUNDARY_CONNECTION_BITS.north)) +
    Number(Boolean(mask & BOUNDARY_CONNECTION_BITS.south))
  return horizontalScore >= verticalScore ? 'horizontal' : 'vertical'
}

/**
 * Returns the NESW connection mask for the tile at `point`. Walls and doors
 * are intentionally equivalent here so replacing a wall with a door does not
 * visually break a continuous boundary run.
 */
export const getBoundaryConnectionMask = (
  layout: ConstructionLayout,
  point: GridPoint,
): BoundaryConnectionMask => {
  let mask = 0
  if (boundaryAt(layout, { x: point.x, y: point.y - 1 })) {
    mask |= BOUNDARY_CONNECTION_BITS.north
  }
  if (boundaryAt(layout, { x: point.x + 1, y: point.y })) {
    mask |= BOUNDARY_CONNECTION_BITS.east
  }
  if (boundaryAt(layout, { x: point.x, y: point.y + 1 })) {
    mask |= BOUNDARY_CONNECTION_BITS.south
  }
  if (boundaryAt(layout, { x: point.x - 1, y: point.y })) {
    mask |= BOUNDARY_CONNECTION_BITS.west
  }
  return mask as BoundaryConnectionMask
}

export const getBoundaryConnection = (
  layout: ConstructionLayout,
  point: GridPoint,
): BoundaryConnection => {
  const mask = getBoundaryConnectionMask(layout, point)
  const name = getBoundaryConnectionName(mask)
  return {
    mask,
    name,
    className: `boundary-connection-${name}`,
  }
}
