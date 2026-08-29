import { describe, expect, it } from 'vitest'
import {
  getBoundaryConnection,
  getBoundaryConnectionMask,
  getBoundaryConnectionName,
  getBoundaryDoorAxis,
  type BoundaryConnectionMask,
} from './boundaryConnections'
import { createConstructionLayout, type BoundaryCell } from './construction'

const layoutWith = (boundaries: BoundaryCell[]) => ({
  ...createConstructionLayout(),
  boundaries,
})

describe('boundary tile connections', () => {
  it('maps every NESW bitmask to a stable semantic tile name', () => {
    const expected = [
      'isolated',
      'end-north',
      'end-east',
      'corner-north-east',
      'end-south',
      'straight-vertical',
      'corner-east-south',
      'tee-north-east-south',
      'end-west',
      'corner-west-north',
      'straight-horizontal',
      'tee-west-north-east',
      'corner-south-west',
      'tee-south-west-north',
      'tee-east-south-west',
      'cross',
    ] as const

    expected.forEach((name, mask) => {
      expect(getBoundaryConnectionName(mask as BoundaryConnectionMask)).toBe(name)
    })
  })

  it('classifies every cardinal neighborhood from mixed wall and door tiles', () => {
    const center = { x: 12, y: 9 }
    const neighbors = [
      { x: 12, y: 8, bit: 1 },
      { x: 13, y: 9, bit: 2 },
      { x: 12, y: 10, bit: 4 },
      { x: 11, y: 9, bit: 8 },
    ] as const

    for (let mask = 0; mask <= 15; mask += 1) {
      const boundaries: BoundaryCell[] = [
        { ...center, kind: 'wall' },
        ...neighbors
          .filter(({ bit }) => mask & bit)
          .map(({ x, y }, index) => ({
            x,
            y,
            kind: index % 2 === 0 ? 'door' as const : 'wall' as const,
          })),
      ]
      expect(getBoundaryConnectionMask(layoutWith(boundaries), center)).toBe(mask)
    }
  })

  it('connects cardinal wall neighbors and ignores diagonal boundaries', () => {
    const center = { x: 8, y: 8 }
    const layout = layoutWith([
      { ...center, kind: 'wall' },
      { x: 8, y: 7, kind: 'wall' },
      { x: 9, y: 8, kind: 'wall' },
      { x: 8, y: 9, kind: 'wall' },
      { x: 7, y: 7, kind: 'wall' },
    ])

    expect(getBoundaryConnectionMask(layout, center)).toBe(7)
    expect(getBoundaryConnection(layout, center)).toEqual({
      mask: 7,
      name: 'tee-north-east-south',
      className: 'boundary-connection-tee-north-east-south',
    })
  })

  it('keeps a wall run connected through a door in either direction', () => {
    const layout = layoutWith([
      { x: 4, y: 5, kind: 'wall' },
      { x: 5, y: 5, kind: 'door' },
      { x: 6, y: 5, kind: 'wall' },
    ])

    expect(getBoundaryConnection(layout, { x: 4, y: 5 })).toMatchObject({
      mask: 2,
      name: 'end-east',
    })
    expect(getBoundaryConnection(layout, { x: 5, y: 5 })).toMatchObject({
      mask: 10,
      name: 'straight-horizontal',
    })
    expect(getBoundaryConnection(layout, { x: 6, y: 5 })).toMatchObject({
      mask: 8,
      name: 'end-west',
    })
  })

  it('orients doors along the strongest wall run with a stable horizontal tie', () => {
    expect(getBoundaryDoorAxis(10)).toBe('horizontal')
    expect(getBoundaryDoorAxis(5)).toBe('vertical')
    expect(getBoundaryDoorAxis(7)).toBe('vertical')
    expect(getBoundaryDoorAxis(11)).toBe('horizontal')
    expect(getBoundaryDoorAxis(15)).toBe('horizontal')
    expect(getBoundaryDoorAxis(0)).toBe('horizontal')
  })

  it('returns the isolated class at grid edges without wrapping', () => {
    const layout = layoutWith([
      { x: 0, y: 0, kind: 'door' },
      { x: 23, y: 0, kind: 'wall' },
      { x: 0, y: 17, kind: 'wall' },
    ])

    expect(getBoundaryConnection(layout, { x: 0, y: 0 })).toEqual({
      mask: 0,
      name: 'isolated',
      className: 'boundary-connection-isolated',
    })
  })
})
