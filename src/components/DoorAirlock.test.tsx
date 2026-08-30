import '@testing-library/jest-dom/vitest'
import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ConstructionLayout } from '../game/construction'
import type { ConstructionOrder } from '../game/constructionJobs'
import { createInitialState } from '../game/seed'
import { ConstructionMap } from './ConstructionMap'
import { MoonbaseMap } from './MoonbaseMap'

const airlockLayout: ConstructionLayout = {
  width: 24,
  height: 18,
  boundaries: [
    { x: 3, y: 4, kind: 'wall' },
    { x: 4, y: 4, kind: 'door' },
    { x: 5, y: 4, kind: 'wall' },
    { x: 10, y: 8, kind: 'wall' },
    { x: 10, y: 9, kind: 'door' },
    { x: 10, y: 10, kind: 'wall' },
  ],
  workstations: [],
}

const horizontalDoorSelector = [
  '.boundary-door.door-airlock.door-horizontal',
  '[data-grid-x="4"][data-grid-y="4"]',
].join('')

const verticalDoorSelector = [
  '.boundary-door.door-airlock.door-vertical',
  '[data-grid-x="10"][data-grid-y="9"]',
].join('')

const expectCompletedAirlocks = (container: HTMLElement) => {
  const horizontalDoor = container.querySelector(horizontalDoorSelector)
  const verticalDoor = container.querySelector(verticalDoorSelector)

  expect(horizontalDoor).toHaveAttribute('data-boundary-mask', '10')
  expect(horizontalDoor).toHaveAttribute('data-connect-east', 'true')
  expect(horizontalDoor).toHaveAttribute('data-connect-west', 'true')
  expect(horizontalDoor).toHaveAttribute('data-door-axis', 'horizontal')
  expect(horizontalDoor).toHaveAttribute('data-door-texture', 'airlock')
  expect(horizontalDoor?.querySelector(':scope > i')).toBeInTheDocument()

  expect(verticalDoor).toHaveAttribute('data-boundary-mask', '5')
  expect(verticalDoor).toHaveAttribute('data-connect-north', 'true')
  expect(verticalDoor).toHaveAttribute('data-connect-south', 'true')
  expect(verticalDoor).toHaveAttribute('data-door-axis', 'vertical')
  expect(verticalDoor).toHaveAttribute('data-door-texture', 'airlock')
  expect(verticalDoor?.querySelector(':scope > i')).toBeInTheDocument()
}

const airlockOrder: ConstructionOrder = {
  id: 'airlock-blueprint',
  commandId: 'airlock-blueprint-command',
  sequence: 1,
  priority: 3,
  operation: 'construct',
  status: 'hauling',
  block: null,
  assignedCrewId: null,
  travelPhase: 'idle',
  target: {
    kind: 'boundary',
    cells: [{ x: 4, y: 4 }],
    construct: { x: 4, y: 4, kind: 'door' },
    deconstruct: null,
  },
  materials: {
    required: 1,
    reserved: 1,
    delivered: 0,
    recoverable: 0,
  },
  work: { required: 1, completed: 0 },
}

describe('full-tile pressure airlocks', () => {
  it('renders both door axes with the airlock contract in Architect', () => {
    const { container } = render(
      <div className="construction-map-scroll">
        <ConstructionMap
          layout={airlockLayout}
          onApply={vi.fn()}
          onCancelTool={vi.fn()}
          onError={vi.fn()}
          onRotate={vi.fn()}
          onUndo={vi.fn()}
          rotation={0}
          selectedTool={null}
        />
      </div>,
    )

    expectCompletedAirlocks(container)
  })

  it('uses the same airlock contract for completed Operations doors', () => {
    const state = createInitialState()
    const { container } = render(
      <MoonbaseMap
        constructionLayout={airlockLayout}
        crew={[]}
        dustActive={false}
        equipment={[]}
        height={state.map.height}
        modules={state.modules}
        onInspectModule={vi.fn()}
        plan={state.operationsPlan}
        selectedModuleId=""
        width={state.map.width}
        workOrders={[]}
      />,
    )

    expectCompletedAirlocks(container)
  })

  it('keeps connection data and the airlock texture on Operations blueprints', () => {
    const state = createInitialState()
    const blueprintLayout: ConstructionLayout = {
      ...airlockLayout,
      boundaries: airlockLayout.boundaries.filter(({ kind }) => kind === 'wall'),
    }
    const { container } = render(
      <MoonbaseMap
        constructionLayout={blueprintLayout}
        constructionOrders={[airlockOrder]}
        crew={[]}
        dustActive={false}
        equipment={[]}
        height={state.map.height}
        modules={state.modules}
        onInspectModule={vi.fn()}
        plan={state.operationsPlan}
        selectedModuleId=""
        width={state.map.width}
        workOrders={[]}
      />,
    )

    const blueprint = container.querySelector('[data-construction-order-id="airlock-blueprint"]')
    expect(blueprint).toHaveClass('door-airlock', 'door-horizontal')
    expect(blueprint).toHaveAttribute('data-boundary-mask', '10')
    expect(blueprint).toHaveAttribute('data-connect-east', 'true')
    expect(blueprint).toHaveAttribute('data-connect-west', 'true')
    expect(blueprint).toHaveAttribute('data-door-axis', 'horizontal')
    expect(blueprint).toHaveAttribute('data-door-texture', 'airlock')
  })
})
