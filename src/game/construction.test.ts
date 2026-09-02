import { describe, expect, it } from 'vitest'
import {
  CONSTRUCTION_GRID_HEIGHT,
  CONSTRUCTION_GRID_WIDTH,
  cellsOnConstructionLine,
  createConstructionLayout,
  detectRooms,
  eraseAt,
  eraseLine,
  getWorkstationCells,
  getWorkstationFootprintSize,
  isConstructionLayout,
  moveWorkstation,
  occupantAt,
  paintBoundaryCell,
  paintBoundaryLine,
  placeWorkstation,
  removeWorkstation,
  rotateWorkstation,
  validateWorkstationPlacement,
  type ConstructionLayout,
  type ConstructionResult,
} from './construction'

const layoutFrom = (result: ConstructionResult) => {
  if (!result.ok) throw new Error(`${result.code}: ${result.error}`)
  return result.layout
}

const paintRectangle = (
  source: ConstructionLayout,
  left: number,
  top: number,
  right: number,
  bottom: number,
) => {
  let layout = layoutFrom(paintBoundaryLine(source, { x: left, y: top }, { x: right, y: top }, 'wall'))
  layout = layoutFrom(paintBoundaryLine(layout, { x: right, y: top }, { x: right, y: bottom }, 'wall'))
  layout = layoutFrom(paintBoundaryLine(layout, { x: right, y: bottom }, { x: left, y: bottom }, 'wall'))
  return layoutFrom(paintBoundaryLine(layout, { x: left, y: bottom }, { x: left, y: top }, 'wall'))
}

describe('freeform boundary painting', () => {
  it('rejects malformed persisted layouts before room detection or rendering', () => {
    const valid = createConstructionLayout()
    expect(isConstructionLayout(valid)).toBe(true)
    expect(isConstructionLayout({ ...valid, boundaries: undefined })).toBe(false)
    expect(isConstructionLayout({
      ...valid,
      boundaries: [{ x: CONSTRUCTION_GRID_WIDTH, y: 2, kind: 'wall' }],
    })).toBe(false)
    expect(isConstructionLayout({
      ...valid,
      boundaries: [{ x: 2, y: 2, kind: 'wall' }],
      workstations: [{
        id: 'overlap',
        type: 'bed',
        label: 'Overlap',
        origin: { x: 2, y: 2 },
        size: { width: 1, height: 2 },
        rotation: 0,
      }],
    })).toBe(false)
    expect(isConstructionLayout({
      ...valid,
      workstations: [{
        id: 'oversized',
        type: 'bed',
        label: 'Oversized',
        origin: { x: 0, y: 0 },
        size: { width: 2 ** 32, height: 1 },
        rotation: 0,
      }],
    })).toBe(false)
  })

  it('paints individual walls and only permits doors to replace walls', () => {
    const initial = createConstructionLayout()
    const snapshot = structuredClone(initial)

    const rejectedDoor = paintBoundaryCell(initial, { x: 3, y: 4 }, 'door')
    expect(rejectedDoor).toMatchObject({
      ok: false,
      code: 'door_requires_wall',
      conflictingCell: { x: 3, y: 4 },
    })
    expect(rejectedDoor.layout).toBe(initial)
    expect(initial).toEqual(snapshot)

    const walled = layoutFrom(paintBoundaryCell(initial, { x: 3, y: 4 }, 'wall'))
    const doored = layoutFrom(paintBoundaryCell(walled, { x: 3, y: 4 }, 'door'))
    expect(doored.boundaries).toEqual([{ x: 3, y: 4, kind: 'door' }])
    expect(occupantAt(doored, { x: 3, y: 4 })).toMatchObject({
      kind: 'boundary',
      boundary: { kind: 'door' },
    })

    const restoredWall = layoutFrom(paintBoundaryCell(doored, { x: 3, y: 4 }, 'wall'))
    expect(restoredWall.boundaries).toEqual([{ x: 3, y: 4, kind: 'wall' }])
  })

  it('snaps cardinal and diagonal pointer drags to a deterministic dominant axis', () => {
    expect(cellsOnConstructionLine({ x: 2, y: 2 }, { x: 7, y: 4 })).toEqual([
      { x: 2, y: 2 },
      { x: 3, y: 2 },
      { x: 4, y: 2 },
      { x: 5, y: 2 },
      { x: 6, y: 2 },
      { x: 7, y: 2 },
    ])
    expect(cellsOnConstructionLine({ x: 10, y: 3 }, { x: 8, y: 9 })).toEqual([
      { x: 10, y: 3 },
      { x: 10, y: 4 },
      { x: 10, y: 5 },
      { x: 10, y: 6 },
      { x: 10, y: 7 },
      { x: 10, y: 8 },
      { x: 10, y: 9 },
    ])
    // Exact diagonal ties intentionally resolve horizontally.
    expect(cellsOnConstructionLine({ x: 2, y: 2 }, { x: 5, y: 5 })).toEqual([
      { x: 2, y: 2 },
      { x: 3, y: 2 },
      { x: 4, y: 2 },
      { x: 5, y: 2 },
    ])
  })

  it('validates whole strokes atomically and erases along the same snapped line', () => {
    const initial = createConstructionLayout()
    const rejected = paintBoundaryLine(
      initial,
      { x: CONSTRUCTION_GRID_WIDTH - 4, y: 6 },
      { x: CONSTRUCTION_GRID_WIDTH + 4, y: 7 },
      'wall',
    )
    expect(rejected).toMatchObject({
      ok: false,
      code: 'out_of_bounds',
      conflictingCell: { x: CONSTRUCTION_GRID_WIDTH, y: 6 },
    })
    expect(rejected.layout).toBe(initial)
    expect(initial.boundaries).toEqual([])

    const painted = layoutFrom(
      paintBoundaryLine(initial, { x: 2, y: 6 }, { x: 8, y: 8 }, 'wall'),
    )
    expect(painted.boundaries).toHaveLength(7)
    expect(painted.boundaries.every((cell) => cell.y === 6)).toBe(true)

    const erased = layoutFrom(eraseLine(painted, { x: 4, y: 6 }, { x: 6, y: 7 }))
    expect(erased.boundaries.map((cell) => cell.x)).toEqual([2, 3, 7, 8])

    const fractional = eraseAt(erased, { x: 3.5, y: 6 })
    expect(fractional).toMatchObject({ ok: false, code: 'invalid_coordinate' })
    expect(fractional.layout).toBe(erased)
  })
})

describe('free-standing workstation placement', () => {
  it('rejects enormous footprints without allocating their declared area', () => {
    const layout = createConstructionLayout()
    const oversized = {
      id: 'oversized-live-input',
      type: 'storage-rack',
      origin: { x: 0, y: 0 },
      size: { width: 2 ** 32, height: 1 },
      rotation: 0 as const,
    }

    expect(validateWorkstationPlacement(layout, oversized)).toMatchObject({
      valid: false,
      code: 'out_of_bounds',
      cells: [],
    })
    expect(placeWorkstation(layout, oversized)).toMatchObject({
      ok: false,
      code: 'out_of_bounds',
    })
    expect(getWorkstationCells(oversized)).toEqual([])
  })

  it('rotates multi-cell footprints and rejects boundary, overlap, and bounds conflicts', () => {
    let layout = createConstructionLayout()
    layout = layoutFrom(paintBoundaryCell(layout, { x: 4, y: 3 }, 'wall'))

    const benchInput = {
      id: 'bench-a',
      type: 'lab_bench',
      label: 'Analysis bench',
      origin: { x: 2, y: 3 },
      size: { width: 3, height: 2 },
      rotation: 90 as const,
    }
    expect(validateWorkstationPlacement(layout, benchInput)).toMatchObject({
      valid: true,
      cells: [
        { x: 2, y: 3 },
        { x: 3, y: 3 },
        { x: 2, y: 4 },
        { x: 3, y: 4 },
        { x: 2, y: 5 },
        { x: 3, y: 5 },
      ],
    })

    layout = layoutFrom(placeWorkstation(layout, benchInput))
    const bench = layout.workstations[0]
    expect(getWorkstationFootprintSize(bench)).toEqual({ width: 2, height: 3 })
    expect(getWorkstationCells(bench)).toHaveLength(6)

    const blockedRotation = rotateWorkstation(layout, 'bench-a', 180)
    expect(blockedRotation).toMatchObject({
      ok: false,
      code: 'occupied',
      conflictingCell: { x: 4, y: 3 },
    })
    expect(blockedRotation.layout).toBe(layout)

    const overlap = placeWorkstation(layout, {
      id: 'console-b',
      type: 'console',
      origin: { x: 3, y: 4 },
      size: { width: 2, height: 2 },
    })
    expect(overlap).toMatchObject({
      ok: false,
      code: 'occupied',
      conflictingCell: { x: 3, y: 4 },
    })
    expect(overlap.layout).toBe(layout)

    const outOfBounds = placeWorkstation(layout, {
      id: 'rack-edge',
      type: 'storage_rack',
      origin: {
        x: CONSTRUCTION_GRID_WIDTH - 1,
        y: CONSTRUCTION_GRID_HEIGHT - 1,
      },
      size: { width: 2, height: 2 },
    })
    expect(outOfBounds).toMatchObject({ ok: false, code: 'out_of_bounds' })

    const duplicate = placeWorkstation(layout, benchInput)
    expect(duplicate).toMatchObject({ ok: false, code: 'duplicate_workstation_id' })
  })

  it('moves, rotates, removes, and cell-erases whole workstation objects immutably', () => {
    const initial = createConstructionLayout()
    const placed = layoutFrom(placeWorkstation(initial, {
      id: 'rack-b',
      type: 'storage_rack',
      origin: { x: 8, y: 8 },
      size: { width: 3, height: 2 },
    }))

    const moved = layoutFrom(moveWorkstation(placed, 'rack-b', { x: 12, y: 9 }))
    expect(moved.workstations[0].origin).toEqual({ x: 12, y: 9 })
    expect(placed.workstations[0].origin).toEqual({ x: 8, y: 8 })

    const rotated = layoutFrom(rotateWorkstation(moved, 'rack-b'))
    expect(rotated.workstations[0].rotation).toBe(90)
    expect(getWorkstationFootprintSize(rotated.workstations[0])).toEqual({
      width: 2,
      height: 3,
    })

    const erasedResult = eraseAt(rotated, { x: 12, y: 10 })
    const erased = layoutFrom(erasedResult)
    expect(erasedResult.affectedCells).toHaveLength(6)
    expect(erased.workstations).toEqual([])
    expect(rotated.workstations).toHaveLength(1)

    const missing = removeWorkstation(erased, 'rack-b')
    expect(missing).toMatchObject({ ok: false, code: 'workstation_not_found' })
    expect(missing.layout).toBe(erased)
  })
})

describe('emergent room detection', () => {
  it('requires both sealed edge isolation and a cardinally adjacent door', () => {
    const shell = paintRectangle(createConstructionLayout(), 2, 2, 7, 7)
    expect(detectRooms(shell)).toEqual([])

    const withDoor = layoutFrom(paintBoundaryCell(shell, { x: 4, y: 2 }, 'door'))
    expect(detectRooms(withDoor)).toEqual([
      {
        id: 'room-1',
        area: 16,
        bounds: { x: 3, y: 3, width: 4, height: 4 },
        doorCells: [{ x: 4, y: 2 }],
        cells: expect.arrayContaining([
          { x: 3, y: 3 },
          { x: 6, y: 6 },
        ]),
      },
    ])

    const opened = layoutFrom(eraseAt(withDoor, { x: 2, y: 4 }))
    expect(detectRooms(opened)).toEqual([])
  })

  it('ignores workstation occupancy when finding room topology', () => {
    let layout = paintRectangle(createConstructionLayout(), 2, 2, 8, 8)
    layout = layoutFrom(paintBoundaryCell(layout, { x: 5, y: 2 }, 'door'))
    const roomBeforeFurniture = detectRooms(layout)

    layout = layoutFrom(placeWorkstation(layout, {
      id: 'life-support-bank',
      type: 'life_support',
      origin: { x: 3, y: 3 },
      size: { width: 3, height: 3 },
      rotation: 90,
    }))
    expect(detectRooms(layout)).toEqual(roomBeforeFurniture)
    expect(roomBeforeFurniture[0]).toMatchObject({ area: 25 })
  })

  it('detects multiple deterministic rooms divided by a sealed interior wall', () => {
    let layout = paintRectangle(createConstructionLayout(), 1, 1, 9, 7)
    layout = layoutFrom(paintBoundaryLine(layout, { x: 5, y: 1 }, { x: 5, y: 7 }, 'wall'))
    layout = layoutFrom(paintBoundaryCell(layout, { x: 3, y: 1 }, 'door'))
    layout = layoutFrom(paintBoundaryCell(layout, { x: 7, y: 1 }, 'door'))

    expect(detectRooms(layout)).toEqual([
      {
        id: 'room-1',
        area: 15,
        bounds: { x: 2, y: 2, width: 3, height: 5 },
        doorCells: [{ x: 3, y: 1 }],
        cells: expect.any(Array),
      },
      {
        id: 'room-2',
        area: 15,
        bounds: { x: 6, y: 2, width: 3, height: 5 },
        doorCells: [{ x: 7, y: 1 }],
        cells: expect.any(Array),
      },
    ])
  })
})
