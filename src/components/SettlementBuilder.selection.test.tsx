import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  paintBoundaryCell,
  paintBoundaryLine,
  placeWorkstation,
  type ConstructionLayout,
  type ConstructionResult,
  type GridPoint,
} from '../game/construction'
import type { ConstructionOrder, ConstructionTravelPhase } from '../game/constructionJobs'
import { useColonyStore } from '../game/store'
import { SettlementBuilder } from './SettlementBuilder'
import { constructionPhaseSummary } from './mapInspection'

const summaryOrder = (
  id: string,
  assignedCrewId: string,
  travelPhase: ConstructionTravelPhase,
  status: ConstructionOrder['status'],
): ConstructionOrder => ({
  id,
  commandId: `command-${id}`,
  sequence: Number(id),
  priority: 3,
  operation: 'construct',
  status,
  block: null,
  assignedCrewId,
  travelPhase,
  target: {
    kind: 'boundary',
    cells: [{ x: Number(id), y: 0 }],
    construct: { x: Number(id), y: 0, kind: 'wall' },
    deconstruct: null,
  },
  materials: { required: 1, reserved: 0, delivered: 0, recoverable: 0 },
  work: { required: 1, completed: 0 },
})

const mapCell = ({ x, y }: GridPoint) => screen.getByRole('group', {
  name: /freeform construction grid/i,
}).querySelector<HTMLElement>(
  `[data-construction-cell][data-grid-x="${x}"][data-grid-y="${y}"]`,
)!

const inspectCell = (point: GridPoint) => {
  const cell = mapCell(point)
  fireEvent.pointerDown(cell, {
    button: 0,
    clientX: 120,
    clientY: 140,
    pointerId: 81,
    pointerType: 'mouse',
  })
  fireEvent.pointerUp(cell, {
    button: 0,
    clientX: 120,
    clientY: 140,
    pointerId: 81,
    pointerType: 'mouse',
  })
}

const layoutFrom = (result: ConstructionResult) => {
  if (!result.ok) throw new Error(`${result.code}: ${result.error}`)
  return result.layout
}

const addSharedDoorExpansion = (source: ConstructionLayout) => {
  let layout = layoutFrom(
    paintBoundaryLine(source, { x: 7, y: 7 }, { x: 10, y: 7 }, 'wall'),
  )
  layout = layoutFrom(
    paintBoundaryLine(layout, { x: 10, y: 7 }, { x: 10, y: 12 }, 'wall'),
  )
  return layoutFrom(
    paintBoundaryLine(layout, { x: 10, y: 12 }, { x: 7, y: 12 }, 'wall'),
  )
}

beforeEach(() => {
  localStorage.clear()
  useColonyStore.getState().resetColony()
})

afterEach(cleanup)

describe('SettlementBuilder inspection selection', () => {
  it('reports mixed assigned construction phases with phase-specific counts', () => {
    expect(constructionPhaseSummary([
      summaryOrder('1', 'crew-one', 'to_stockpile', 'hauling'),
      summaryOrder('2', 'crew-two', 'to_stockpile', 'hauling'),
      summaryOrder('3', 'crew-three', 'at_site', 'building'),
    ])).toBe('2 collecting material · 1 building')
  })

  it('keeps a colonist selected as assignment changes move them between tiles', async () => {
    const view = render(<SettlementBuilder />)
    fireEvent.click(screen.getByRole('button', { name: 'Pause construction' }))

    const mateo = view.container.querySelector<HTMLElement>(
      '[data-crew-id="crew-mateo-alvarez"]',
    )!
    const idleCell = {
      x: Number(mateo.dataset.gridX),
      y: Number(mateo.dataset.gridY),
    }
    inspectCell(idleCell)
    const inspector = screen.getByRole('region', { name: 'Mateo Alvarez inspector' })
    expect(inspector).toBeVisible()
    expect(inspector).not.toHaveAttribute('aria-live')

    const target = { x: 9, y: 6 }
    act(() => {
      const state = useColonyStore.getState()
      const result = paintBoundaryCell(state.settlement.layout, target, 'wall')
      expect(state.queueConstruction(result).ok).toBe(true)
      useColonyStore.getState().setConstructionSpeed(1)
      useColonyStore.getState().advanceConstruction(0.1)
      useColonyStore.getState().setConstructionSpeed(0)
    })

    await waitFor(() => {
      const movingMateo = view.container.querySelector<HTMLElement>(
        '[data-crew-id="crew-mateo-alvarez"]',
      )!
      expect(screen.getByRole('region', { name: 'Mateo Alvarez inspector' })).toBeVisible()
      expect(view.container.querySelector('.construction-selection-cell')).toHaveAttribute(
        'data-grid-x',
        movingMateo.dataset.gridX,
      )
      expect(view.container.querySelector('.construction-selection-cell')).toHaveAttribute(
        'data-grid-y',
        movingMateo.dataset.gridY,
      )
      expect(movingMateo.dataset.gridX).not.toBe(String(target.x))
    })

    act(() => {
      useColonyStore.getState().setConstructionSpeed(1)
      for (let tick = 0; tick < 20; tick += 1) {
        useColonyStore.getState().advanceConstruction(1)
      }
      useColonyStore.getState().setConstructionSpeed(0)
    })

    await waitFor(() => {
      const movedMateo = view.container.querySelector<HTMLElement>(
        '[data-crew-id="crew-mateo-alvarez"]',
      )!
      const selectedCell = view.container.querySelector('.construction-selection-cell')
      expect(screen.getByRole('region', { name: 'Mateo Alvarez inspector' })).toBeVisible()
      expect(selectedCell).toHaveAttribute('data-grid-x', movedMateo.dataset.gridX)
      expect(selectedCell).toHaveAttribute('data-grid-y', movedMateo.dataset.gridY)
    })
  })

  it('keeps the opened overlap choices stable when a colonist moves off the tile', () => {
    const initial = useColonyStore.getState()
    const stockpile = initial.settlement.constructionStockpile
    useColonyStore.setState({
      settlement: {
        ...initial.settlement,
        constructionCrew: initial.settlement.constructionCrew.map((position) =>
          position.crewId === 'crew-mateo-alvarez'
            ? { ...position, cell: { ...stockpile } }
            : position,
        ),
      },
    })
    const view = render(<SettlementBuilder />)
    inspectCell(stockpile)

    const picker = screen.getByRole('dialog', { name: 'Choose an item' })
    expect(screen.getByRole('button', { name: /Mateo Alvarez.*Colonist/i })).toBeVisible()

    const movedCell = { x: stockpile.x + 3, y: stockpile.y }
    act(() => {
      const state = useColonyStore.getState()
      useColonyStore.setState({
        settlement: {
          ...state.settlement,
          constructionCrew: state.settlement.constructionCrew.map((position) =>
            position.crewId === 'crew-mateo-alvarez'
              ? { ...position, cell: movedCell }
              : position,
          ),
        },
      })
    })

    expect(view.container.querySelector('[data-crew-id="crew-mateo-alvarez"]'))
      .toHaveAttribute('data-grid-x', String(movedCell.x))
    expect(picker).toBeVisible()
    const mateoChoice = screen.getByRole('button', { name: /Mateo Alvarez.*Colonist/i })
    expect(mateoChoice).toBeVisible()

    fireEvent.click(mateoChoice)
    expect(screen.getByRole('region', { name: 'Mateo Alvarez inspector' })).toBeVisible()
    expect(view.container.querySelector('.construction-selection-cell'))
      .toHaveAttribute('data-grid-x', String(movedCell.x))
  })

  it('returns focus to the construction map when B externally dismisses the tile picker', async () => {
    const initial = useColonyStore.getState()
    useColonyStore.setState({
      settlement: {
        ...initial.settlement,
        constructionCrew: initial.settlement.constructionCrew.map((position) =>
          position.crewId === 'crew-mateo-alvarez'
            ? { ...position, cell: { ...initial.settlement.constructionStockpile } }
            : position,
        ),
      },
    })
    render(<SettlementBuilder />)
    fireEvent.click(screen.getByRole('button', { name: 'Pause construction' }))
    const target = initial.settlement.constructionStockpile
    inspectCell(target)

    const picker = screen.getByRole('dialog', { name: 'Choose an item' })
    await waitFor(() => expect(picker).toContainElement(document.activeElement as HTMLElement))
    fireEvent.keyDown(window, { key: 'b' })

    expect(screen.queryByRole('dialog', { name: 'Choose an item' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Build menu' })).toHaveAttribute('aria-pressed', 'true')
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('group', {
      name: /freeform construction grid/i,
    })))
  })

  it('explains an unreachable blueprint and offers exterior-door recovery', () => {
    const initial = useColonyStore.getState()
    const layout = addSharedDoorExpansion(initial.settlement.layout)
    useColonyStore.setState({
      settlement: {
        ...initial.settlement,
        layout,
        constructionStockpile: { x: 6, y: 9 },
        constructionCrew: initial.settlement.constructionCrew.map((position) => {
          if (position.crewId === 'crew-amina-okafor') {
            return { ...position, cell: { x: 12, y: 8 } }
          }
          if (position.crewId === 'crew-mateo-alvarez') {
            return { ...position, cell: { x: 12, y: 10 } }
          }
          return position
        }),
      },
    })

    const placement = placeWorkstation(layout, {
      id: 'blocked-life-support',
      type: 'life-support',
      label: 'Blocked life support',
      origin: { x: 8, y: 10 },
      size: { width: 2, height: 2 },
      rotation: 0,
    })
    const queued = useColonyStore.getState().queueConstruction(placement)
    expect(queued.ok).toBe(true)
    const orderId = queued.orderIds[0]
    const blocker = 'No walkable route from an available builder to this construction site.'
    useColonyStore.setState((state) => ({
      settlement: {
        ...state.settlement,
        constructionStockpile: { x: 12, y: 9 },
        constructionOrders: state.settlement.constructionOrders.map((order) => (
          order.id === orderId
            ? {
                ...order,
                status: 'blocked' as const,
                block: { kind: 'no_path' as const, message: blocker },
                assignedCrewId: null,
              }
            : order
        )),
      },
    }))

    render(<SettlementBuilder />)
    inspectCell({ x: 8, y: 10 })

    const inspector = screen.getByRole('region', {
      name: 'Blocked life support blueprint inspector',
    })
    expect(within(inspector).getByText(blocker)).toBeVisible()
    expect(within(inspector).getByRole('button', {
      name: `Builder assignment unavailable. ${blocker}`,
    })).toBeDisabled()
    const recovery = within(inspector).getByRole('button', {
      name: 'Activate Door designator to add exterior access',
    })
    expect(recovery).toHaveTextContent('Add exterior airlock')

    fireEvent.click(recovery)

    expect(screen.queryByRole('region', {
      name: 'Blocked life support blueprint inspector',
    })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Return to Select mode from Door' })).toBeVisible()
    expect(document.querySelector('.construction-cursor')).toHaveStyle({
      gridColumn: '11',
      gridRow: '10',
    })
    expect(screen.getByText(/cursor is on a safe exterior wall that opens onto clear floor/i))
      .toBeVisible()
    expect(useColonyStore.getState().settlement.constructionOrders)
      .toContainEqual(expect.objectContaining({ id: orderId, block: expect.objectContaining({ kind: 'no_path' }) }))
  })
})
