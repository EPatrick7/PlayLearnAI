import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createConstructionLayout, type GridPoint } from '../game/construction'
import { ConstructionMap } from './ConstructionMap'

afterEach(cleanup)

const renderMap = (selectedTool: 'wall' | null = null) => {
  const onApply = vi.fn()
  const view = render(
    <div className="construction-map-scroll">
      <ConstructionMap
        layout={createConstructionLayout()}
        onApply={onApply}
        onCancelTool={vi.fn()}
        onError={vi.fn()}
        onRotate={vi.fn()}
        onUndo={vi.fn()}
        rotation={0}
        selectedTool={selectedTool}
      />
    </div>,
  )
  const map = screen.getByRole('group', { name: /freeform construction grid/i })
  const scroll = view.container.querySelector<HTMLElement>('.construction-map-scroll')!
  const cell = ({ x, y }: GridPoint) => map.querySelector<HTMLElement>(
    `[data-construction-cell][data-grid-x="${x}"][data-grid-y="${y}"]`,
  )!
  return { cell, map, onApply, scroll }
}

describe('ConstructionMap pan and zoom', () => {
  it('left-drags and one-finger drags the nearest scroll container in Pan mode', () => {
    const { map, scroll } = renderMap()
    scroll.scrollLeft = 100
    scroll.scrollTop = 80

    fireEvent.pointerDown(map, {
      button: 0,
      clientX: 150,
      clientY: 120,
      pointerId: 1,
      pointerType: 'mouse',
    })
    expect(map).toHaveClass('is-panning')
    fireEvent.pointerMove(map, {
      clientX: 120,
      clientY: 100,
      pointerId: 1,
      pointerType: 'mouse',
    })
    fireEvent.pointerUp(map, { pointerId: 1, pointerType: 'mouse' })

    expect(scroll.scrollLeft).toBe(130)
    expect(scroll.scrollTop).toBe(100)

    fireEvent.pointerDown(map, {
      button: 0,
      clientX: 120,
      clientY: 100,
      pointerId: 2,
      pointerType: 'touch',
    })
    fireEvent.pointerMove(map, {
      clientX: 100,
      clientY: 90,
      pointerId: 2,
      pointerType: 'touch',
    })
    fireEvent.pointerUp(map, { pointerId: 2, pointerType: 'touch' })

    expect(scroll.scrollLeft).toBe(150)
    expect(scroll.scrollTop).toBe(110)
  })

  it('keeps left drag for construction while middle drag pans with a tool active', () => {
    const { cell, map, onApply, scroll } = renderMap('wall')

    fireEvent.pointerDown(cell({ x: 1, y: 1 }), {
      button: 0,
      clientX: 40,
      clientY: 40,
      pointerId: 3,
      pointerType: 'mouse',
    })
    fireEvent.pointerUp(cell({ x: 1, y: 1 }), {
      button: 0,
      pointerId: 3,
      pointerType: 'mouse',
    })
    expect(onApply).toHaveBeenCalledOnce()

    scroll.scrollLeft = 60
    fireEvent.pointerDown(map, {
      button: 1,
      clientX: 100,
      clientY: 100,
      pointerId: 4,
      pointerType: 'mouse',
    })
    fireEvent.pointerMove(map, {
      clientX: 75,
      clientY: 100,
      pointerId: 4,
      pointerType: 'mouse',
    })
    fireEvent.pointerUp(map, { button: 1, pointerId: 4, pointerType: 'mouse' })

    expect(scroll.scrollLeft).toBe(85)
    expect(onApply).toHaveBeenCalledOnce()
  })

  it('turns an active touch draft into a two-finger pan without applying it', () => {
    const { cell, map, onApply, scroll } = renderMap('wall')
    scroll.scrollLeft = 100

    fireEvent.pointerDown(cell({ x: 1, y: 1 }), {
      button: 0,
      clientX: 100,
      clientY: 100,
      pointerId: 5,
      pointerType: 'touch',
    })
    fireEvent.pointerDown(cell({ x: 2, y: 1 }), {
      button: 0,
      clientX: 140,
      clientY: 100,
      pointerId: 6,
      pointerType: 'touch',
    })
    fireEvent.pointerMove(map, {
      clientX: 100,
      clientY: 100,
      pointerId: 6,
      pointerType: 'touch',
    })
    fireEvent.pointerUp(map, { pointerId: 6, pointerType: 'touch' })
    fireEvent.pointerUp(map, { pointerId: 5, pointerType: 'touch' })

    expect(scroll.scrollLeft).toBe(120)
    expect(onApply).not.toHaveBeenCalled()
  })

  it('zooms with the wheel and exposes clamped accessible controls', () => {
    const { map } = renderMap()
    const output = screen.getByText('100%')

    fireEvent.wheel(map, { clientX: 200, clientY: 150, deltaY: -120 })
    expect(Number.parseInt(output.textContent ?? '0')).toBeGreaterThan(100)

    const zoomIn = screen.getByRole('button', { name: /zoom in construction map/i })
    for (let index = 0; index < 12; index += 1) fireEvent.click(zoomIn)
    expect(output).toHaveTextContent('180%')
    expect(zoomIn).toBeDisabled()

    const zoomOut = screen.getByRole('button', { name: /zoom out construction map/i })
    for (let index = 0; index < 12; index += 1) fireEvent.click(zoomOut)
    expect(output).toHaveTextContent('70%')
    expect(zoomOut).toBeDisabled()
  })
})
