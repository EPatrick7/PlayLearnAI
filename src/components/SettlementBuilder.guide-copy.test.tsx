import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  paintBoundaryCell,
  paintBoundaryLine,
  placeWorkstation,
  type ConstructionLayout,
  type ConstructionResult,
  type GridPoint,
} from '../game/construction'
import { useColonyStore } from '../game/store'
import { SettlementBuilder } from './SettlementBuilder'

const layoutFrom = (result: ConstructionResult) => {
  if (!result.ok) throw new Error(`${result.code}: ${result.error}`)
  return result.layout
}

const addSecondShell = (source: ConstructionLayout) => {
  let layout = layoutFrom(
    paintBoundaryLine(source, { x: 9, y: 2 }, { x: 14, y: 2 }, 'wall'),
  )
  layout = layoutFrom(
    paintBoundaryLine(layout, { x: 14, y: 2 }, { x: 14, y: 7 }, 'wall'),
  )
  layout = layoutFrom(
    paintBoundaryLine(layout, { x: 14, y: 7 }, { x: 9, y: 7 }, 'wall'),
  )
  layout = layoutFrom(
    paintBoundaryLine(layout, { x: 9, y: 7 }, { x: 9, y: 2 }, 'wall'),
  )
  return layout
}

const addSecondRoom = (source: ConstructionLayout) => layoutFrom(
  paintBoundaryCell(addSecondShell(source), { x: 10, y: 2 }, 'door'),
)

const addSharedDoorExpansion = (source: ConstructionLayout) => {
  let layout = layoutFrom(
    paintBoundaryLine(source, { x: 7, y: 7 }, { x: 10, y: 7 }, 'wall'),
  )
  layout = layoutFrom(
    paintBoundaryLine(layout, { x: 10, y: 7 }, { x: 10, y: 11 }, 'wall'),
  )
  layout = layoutFrom(
    paintBoundaryLine(layout, { x: 10, y: 11 }, { x: 7, y: 11 }, 'wall'),
  )
  return layout
}

const installLayout = (layout: ConstructionLayout) => {
  useColonyStore.setState((state) => ({
    settlement: { ...state.settlement, layout, constructionOrders: [] },
    worldRevision: state.worldRevision + 1,
  }))
}

const constructionMap = () => screen.getByRole('group', {
  name: /freeform construction grid/i,
})

const constructionCell = ({ x, y }: GridPoint) => {
  const cell = constructionMap().querySelector<HTMLElement>(
    `[data-construction-cell][data-grid-x="${x}"][data-grid-y="${y}"]`,
  )
  if (!cell) throw new Error(`Missing construction cell ${x}:${y}.`)
  return cell
}

const pointAtCell = (point: GridPoint, pointerId = 81) => {
  const cell = constructionCell(point)
  fireEvent.pointerDown(cell, {
    button: 0,
    buttons: 1,
    clientX: 120,
    clientY: 140,
    pointerId,
    pointerType: 'mouse',
  })
  fireEvent.pointerUp(cell, {
    button: 0,
    buttons: 0,
    clientX: 120,
    clientY: 140,
    pointerId,
    pointerType: 'mouse',
  })
}

beforeEach(() => {
  localStorage.clear()
  useColonyStore.getState().resetColony()
})

afterEach(cleanup)

describe('SettlementBuilder first-shift guide', () => {
  it('turns the initial HUD into a compact second-room action without queuing work', () => {
    render(<SettlementBuilder />)

    const status = screen.getByRole('region', { name: 'Construction status' })
    const guide = within(status).getByRole('button', {
      name: 'First shift: build second enclosed room with Wall designator',
    })
    expect(guide).toHaveTextContent('First shift · 1/2 rooms')
    expect(guide).toHaveTextContent('Structure → Wall')
    expect(guide).toHaveTextContent('one door')
    expect(guide).not.toHaveAttribute('aria-expanded')
    expect(guide).not.toHaveAttribute('aria-haspopup')

    fireEvent.click(guide)

    expect(screen.getByRole('button', { name: 'Return to Select mode from Wall' })).toBeVisible()
    expect(constructionMap()).toHaveClass('tool-active')
    expect(useColonyStore.getState().settlement.constructionOrders).toHaveLength(0)
  })

  it('advances from a completed second room to Life Support', () => {
    installLayout(addSecondRoom(useColonyStore.getState().settlement.layout))
    render(<SettlementBuilder />)

    const guide = screen.getByRole('button', {
      name: 'Place Life support inside an enclosed room',
    })
    expect(guide).toHaveTextContent('First shift · Add Life Support')
    expect(guide).toHaveTextContent('Production → Life support')

    fireEvent.click(guide)

    expect(screen.getByRole('button', {
      name: 'Return to Select mode from Life support',
    })).toBeVisible()
    expect(useColonyStore.getState().settlement.constructionOrders).toHaveLength(0)
  })

  it('asks for exterior access when a shared door leaves the expansion unreachable', () => {
    const state = useColonyStore.getState()
    const layout = addSharedDoorExpansion(state.settlement.layout)
    useColonyStore.setState({
      settlement: {
        ...state.settlement,
        layout,
        constructionOrders: [],
        constructionStockpile: { x: 12, y: 9 },
        constructionCrew: state.settlement.constructionCrew.map((position) => {
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
    render(<SettlementBuilder />)

    expect(screen.queryByRole('button', {
      name: 'Place Life support inside an enclosed room',
    })).not.toBeInTheDocument()
    const guide = screen.getByRole('button', {
      name: 'Add an exterior door for colonist access',
    })
    expect(guide).toHaveTextContent('First shift · Add exterior door')
    expect(guide).toHaveTextContent('colonists and material can reach')

    fireEvent.click(guide)

    expect(screen.getByRole('button', { name: 'Return to Select mode from Door' })).toBeVisible()
    expect(constructionMap()).toHaveClass('tool-active')
    expect(useColonyStore.getState().settlement.constructionOrders).toHaveLength(0)
  })

  it('switches from Wall to Door when a closed shell only needs an entrance', () => {
    installLayout(addSecondShell(useColonyStore.getState().settlement.layout))
    render(<SettlementBuilder />)

    const guide = screen.getByRole('button', {
      name: 'Finish the second room with a Door designator',
    })
    expect(guide).toHaveTextContent('First shift · Add a door')
    expect(guide).toHaveTextContent('Replace one wall tile')

    fireEvent.click(guide)

    expect(screen.getByRole('button', { name: 'Return to Select mode from Door' })).toBeVisible()
    expect(useColonyStore.getState().settlement.constructionOrders).toHaveLength(0)
  })

  it('prioritizes unfinished worker jobs and opens their existing queue', () => {
    const state = useColonyStore.getState()
    const queued = state.queueConstruction(
      paintBoundaryCell(state.settlement.layout, { x: 9, y: 6 }, 'wall'),
    )
    expect(queued.ok).toBe(true)
    render(<SettlementBuilder />)

    const guide = screen.getByRole('button', {
      name: /Open construction queue, 1 placement, 1 job/i,
    })
    expect(guide).toHaveTextContent('First shift · 1 job open')
    expect(guide).toHaveTextContent('Workers finish 1 job')

    fireEvent.click(guide)

    expect(screen.getByRole('dialog', { name: 'Construction queue' })).toBeVisible()
  })

  it('becomes the first-shift action when the completed layout is ready', () => {
    let layout = addSecondRoom(useColonyStore.getState().settlement.layout)
    layout = layoutFrom(placeWorkstation(layout, {
      id: 'guide-life-support',
      type: 'life-support',
      label: 'Life support',
      origin: { x: 12, y: 3 },
      size: { width: 2, height: 2 },
      rotation: 0,
    }))
    installLayout(layout)
    render(<SettlementBuilder />)

    const guide = screen.getByRole('button', { name: 'Begin first shift' })
    expect(guide).toHaveTextContent('First shift ready')
    expect(guide).toHaveTextContent('Expansion habitable')

    fireEvent.click(guide)

    expect(useColonyStore.getState().settlement.phase).toBe('operations')
  })

  it('keeps directing an outdoor Life Support unit into an enclosed room', () => {
    let layout = addSecondRoom(useColonyStore.getState().settlement.layout)
    layout = layoutFrom(placeWorkstation(layout, {
      id: 'outdoor-life-support',
      type: 'life-support',
      label: 'Outdoor life support',
      origin: { x: 18, y: 2 },
      size: { width: 2, height: 2 },
      rotation: 0,
    }))
    installLayout(layout)
    render(<SettlementBuilder />)

    expect(screen.queryByRole('button', { name: 'Begin first shift' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', {
      name: 'Place Life support inside an enclosed room',
    })).toBeVisible()
  })
})

describe('SettlementBuilder Copy action', () => {
  it('copies a built wall into a persistent designator and waits for explicit placement', async () => {
    const onConstructionQueued = vi.fn()
    render(<SettlementBuilder onConstructionQueued={onConstructionQueued} />)
    const layoutBefore = useColonyStore.getState().settlement.layout
    const revisionBefore = useColonyStore.getState().worldRevision
    pointAtCell({ x: 3, y: 7 })

    const inspector = screen.getByRole('region', { name: 'Composite wall inspector' })
    const copyAction = within(inspector).getByRole('button', { name: 'Copy' })
    copyAction.focus()
    fireEvent.click(copyAction)

    expect(screen.queryByRole('region', { name: 'Composite wall inspector' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Return to Select mode from Wall' })).toBeVisible()
    expect(useColonyStore.getState().settlement.constructionOrders).toHaveLength(0)
    expect(useColonyStore.getState().settlement.layout).toEqual(layoutBefore)
    expect(useColonyStore.getState().worldRevision).toBe(revisionBefore)
    expect(onConstructionQueued).not.toHaveBeenCalled()
    await waitFor(() => expect(constructionMap()).toHaveFocus())

    pointAtCell({ x: 9, y: 6 }, 82)

    expect(useColonyStore.getState().settlement.constructionOrders).toHaveLength(1)
    expect(onConstructionQueued).toHaveBeenCalledOnce()
    expect(useColonyStore.getState().settlement.constructionOrders[0]).toMatchObject({
      target: { kind: 'boundary', construct: { x: 9, y: 6, kind: 'wall' } },
    })
    expect(screen.getByRole('button', { name: 'Return to Select mode from Wall' })).toBeVisible()
  })

  it('copies the built door without creating a replacement blueprint', () => {
    render(<SettlementBuilder />)
    pointAtCell({ x: 7, y: 9 })

    const inspector = screen.getByRole('region', { name: 'Pressure door inspector' })
    fireEvent.click(within(inspector).getByRole('button', { name: 'Copy' }))

    expect(screen.getByRole('button', { name: 'Return to Select mode from Door' })).toBeVisible()
    expect(useColonyStore.getState().settlement.constructionOrders).toHaveLength(0)
  })

  it('preserves a copied workstation rotation until explicit placement', () => {
    const initial = useColonyStore.getState()
    installLayout({
      ...initial.settlement.layout,
      workstations: initial.settlement.layout.workstations.map((workstation) => (
        workstation.id === 'starter-bunk-amina'
          ? { ...workstation, rotation: 90 as const }
          : workstation
      )),
    })
    render(<SettlementBuilder />)
    pointAtCell({ x: 4, y: 8 })

    const inspector = screen.getByRole('region', { name: 'Amina bunk inspector' })
    fireEvent.click(within(inspector).getByRole('button', { name: 'Copy' }))

    expect(screen.getByRole('button', { name: 'Return to Select mode from Bunk bed' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Rotate Bunk bed to 180°' })).toBeVisible()
    expect(useColonyStore.getState().settlement.constructionOrders).toHaveLength(0)

    pointAtCell({ x: 9, y: 8 }, 83)

    expect(useColonyStore.getState().settlement.constructionOrders).toContainEqual(
      expect.objectContaining({
        target: expect.objectContaining({
          kind: 'workstation',
          construct: expect.objectContaining({ rotation: 90 }),
        }),
      }),
    )
  })
})
