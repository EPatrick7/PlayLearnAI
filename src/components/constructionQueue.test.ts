import { describe, expect, it } from 'vitest'
import type { ConstructionOrder } from '../game/constructionJobs'
import { buildConstructionQueue } from './constructionQueue'

const wallOrder = (
  id: string,
  commandId: string,
  sequence: number,
  overrides: Partial<ConstructionOrder> = {},
): ConstructionOrder => ({
  id,
  commandId,
  sequence,
  priority: 3,
  operation: 'construct',
  status: 'blocked',
  block: { kind: 'insufficient_materials', message: 'Needs 1 construction material.' },
  assignedCrewId: null,
  travelPhase: 'idle',
  target: {
    kind: 'boundary',
    cells: [{ x: sequence, y: 2 }],
    construct: { x: sequence, y: 2, kind: 'wall' },
    deconstruct: null,
  },
  materials: { required: 1, reserved: 0, delivered: 0, recoverable: 0 },
  work: { required: 1, completed: 0 },
  ...overrides,
})

describe('buildConstructionQueue', () => {
  it('keeps one dragged placement grouped and targets its most urgent unfinished tile', () => {
    const queue = buildConstructionQueue([
      wallOrder('line:0', 'line', 0, {
        status: 'complete',
        block: null,
        work: { required: 1, completed: 1 },
      }),
      wallOrder('line:1', 'line', 1, {
        status: 'blocked',
        block: { kind: 'no_path', message: 'No colonist can reach this blueprint.' },
      }),
      wallOrder('line:2', 'line', 2),
    ])

    expect(queue).toHaveLength(1)
    expect(queue[0]).toMatchObject({
      commandId: 'line',
      label: 'Wall ×3',
      totalJobs: 3,
      remainingJobs: 2,
      completedJobs: 1,
      progress: 33,
      activity: 'No route',
      tone: 'danger',
      targetOrderId: 'line:1',
      targetCell: { x: 1, y: 2 },
    })
  })

  it('hides finished commands and keeps placement order stable as statuses change', () => {
    const queue = buildConstructionQueue([
      wallOrder('done:0', 'done', 0, { status: 'complete', block: null }),
      wallOrder('active:0', 'active', 1, {
        priority: 5,
        status: 'building',
        block: null,
        assignedCrewId: 'crew-amina',
      }),
      wallOrder('blocked:0', 'blocked', 2, {
        priority: 1,
        block: { kind: 'carrier_unavailable', message: 'Assigned carrier is unavailable.' },
      }),
    ], { crewNames: new Map([['crew-amina', 'Amina Okafor']]) })

    expect(queue.map((entry) => entry.commandId)).toEqual(['active', 'blocked'])
    expect(queue[0]).toMatchObject({
      activity: '1 building',
      detail: 'Amina Okafor assigned to this placement. 1 job remaining.',
      tone: 'active',
    })
  })

  it('uses workstation icons and reports the paused state without losing the target', () => {
    const order = wallOrder('bench:0', 'bench', 7, {
      operation: 'construct',
      status: 'building',
      block: null,
      target: {
        kind: 'workstation',
        cells: [{ x: 8, y: 4 }, { x: 9, y: 4 }],
        construct: {
          id: 'bench-1',
          type: 'research-bench',
          label: 'Research bench',
          origin: { x: 8, y: 4 },
          size: { width: 3, height: 2 },
          rotation: 0,
        },
        deconstruct: null,
      },
      materials: { required: 6, reserved: 6, delivered: 0, recoverable: 0 },
      work: { required: 6, completed: 0 },
    })

    expect(buildConstructionQueue([order], { paused: true })[0]).toMatchObject({
      label: 'Research bench',
      icon: 'microscope',
      activity: 'Paused',
      tone: 'paused',
      targetCell: { x: 8, y: 4 },
    })
  })
})
