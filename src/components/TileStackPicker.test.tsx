import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MapInspectable, MapTileInspection } from './mapInspection'
import { TileStackPicker } from './TileStackPicker'

const colonist: MapInspectable = {
  key: 'crew:amina',
  kind: 'crew',
  id: 'amina',
  label: 'Amina Okafor',
  subtitle: 'Colonist · Building',
  detail: 'Mission Commander',
  icon: 'crew',
  portrait: {
    accent: '#a75b4c',
    initials: 'AO',
    showStatusDot: true,
    status: 'working',
    variant: 'umber',
  },
  cell: { x: 20, y: 14 },
  stats: [],
}

const blueprint: MapInspectable = {
  key: 'blueprint:wall-1',
  kind: 'blueprint',
  id: 'wall-1',
  label: 'Wall blueprint',
  subtitle: 'Blueprint · Building · P3',
  detail: 'Build a one-tile wall.',
  icon: 'wall',
  cell: { x: 20, y: 14 },
  stats: [],
}

const tile: MapTileInspection = {
  key: '20:14',
  cell: { x: 20, y: 14 },
  surfaceKind: 'floor',
  surfaceLabel: 'Pressurized floor',
  surfaceDetail: 'Sealed player-built room',
  roomId: 'room-2',
  roomLabel: 'Room 2',
  roomArea: 20,
  moduleId: null,
  moduleName: null,
  atmosphere: 'yes',
  contents: [colonist, blueprint],
  focusedItem: null,
}

const triggerForTile = () => {
  const trigger = document.createElement('button')
  trigger.textContent = 'Tile trigger'
  trigger.getBoundingClientRect = vi.fn(() => ({
    x: 860,
    y: 600,
    left: 860,
    right: 900,
    top: 600,
    bottom: 640,
    width: 40,
    height: 40,
    toJSON: () => ({}),
  }))
  document.body.append(trigger)
  return trigger
}

afterEach(() => {
  cleanup()
  document.querySelectorAll('button').forEach((button) => {
    if (button.textContent === 'Tile trigger') button.remove()
  })
  document.querySelectorAll('[data-picker-test-map]').forEach((map) => map.remove())
})

describe('TileStackPicker', () => {
  it('renders a compact nonmodal context picker with keyboard navigation', async () => {
    const trigger = triggerForTile()
    const onClose = vi.fn()
    const leakedKeyDown = vi.fn()
    window.addEventListener('keydown', leakedKeyDown)
    render(
      <TileStackPicker
        gridHeight={18}
        gridWidth={24}
        onClose={onClose}
        onSelectItem={vi.fn()}
        onSelectSurface={vi.fn()}
        tile={tile}
        trigger={trigger}
      />,
    )

    const picker = screen.getByRole('dialog', { name: 'Choose an item' })
    expect(picker).not.toHaveAttribute('aria-modal')
    expect(picker).toHaveClass('tile-stack-popover', 'portal-layer', 'anchor-right', 'anchor-bottom')
    expect(picker).toHaveAttribute('data-grid-x', '20')
    expect(picker).toHaveTextContent('Tile 21, 15')
    expect(within(picker).getByLabelText('2 overlapping items')).toHaveTextContent('2')
    const choices = [
      within(picker).getByRole('button', { name: /Amina Okafor.*Colonist/i }),
      within(picker).getByRole('button', { name: /Wall blueprint.*Blueprint/i }),
      within(picker).getByRole('button', { name: /Tile itself.*Pressurized floor.*Tile 21, 15/i }),
    ]
    expect(choices[0].querySelector('.pawn-sprite')).toBeInTheDocument()
    const surfaceGroup = within(picker).getByRole('group', { name: 'Tile itself' })
    expect(within(surfaceGroup).getByText(/^Tile itself ·/)).toBeVisible()
    expect(within(surfaceGroup).getByRole('button', {
      name: /Tile itself.*Pressurized floor.*Tile 21, 15/i,
    })).toBe(choices[2])
    await waitFor(() => expect(document.activeElement).toBe(choices[0]))

    fireEvent.keyDown(picker, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(choices[1])
    fireEvent.keyDown(picker, { key: 'End' })
    expect(document.activeElement).toBe(choices[2])
    expect(leakedKeyDown).not.toHaveBeenCalled()

    fireEvent.keyDown(picker, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
    await waitFor(() => expect(document.activeElement).toBe(trigger))
    window.removeEventListener('keydown', leakedKeyDown)
  })

  it('pre-focuses and marks the directly hit item without skipping the chooser', async () => {
    const trigger = triggerForTile()
    render(
      <TileStackPicker
        gridHeight={18}
        gridWidth={24}
        onClose={vi.fn()}
        onSelectItem={vi.fn()}
        onSelectSurface={vi.fn()}
        preferredItemKey={blueprint.key}
        tile={tile}
        trigger={trigger}
      />,
    )

    const picker = screen.getByRole('dialog', { name: 'Choose an item' })
    const blueprintChoice = within(picker).getByRole('button', {
      name: /Wall blueprint.*Blueprint.*Targeted/i,
    })
    expect(blueprintChoice).toHaveAttribute('data-pointer-hit', 'true')
    expect(within(picker).getByRole('button', { name: /Amina Okafor.*Colonist/i }))
      .not.toHaveAttribute('data-pointer-hit')
    await waitFor(() => expect(document.activeElement).toBe(blueprintChoice))
  })

  it('closes and restores trigger focus after item and surface selection', async () => {
    const trigger = triggerForTile()
    const onClose = vi.fn()
    const onSelectItem = vi.fn()
    const onSelectSurface = vi.fn()
    render(
      <TileStackPicker
        gridHeight={18}
        gridWidth={24}
        onClose={onClose}
        onSelectItem={onSelectItem}
        onSelectSurface={onSelectSurface}
        tile={tile}
        trigger={trigger}
      />,
    )

    const picker = screen.getByRole('dialog', { name: 'Choose an item' })
    fireEvent.click(within(picker).getByRole('button', { name: /Wall blueprint.*Blueprint/i }))
    expect(onSelectItem).toHaveBeenCalledWith(tile, blueprint)
    expect(onClose).toHaveBeenCalledOnce()
    await waitFor(() => expect(document.activeElement).toBe(trigger))

    fireEvent.click(within(picker).getByRole('button', { name: /Tile itself.*Pressurized floor.*Tile 21, 15/i }))
    expect(onSelectSurface).toHaveBeenCalledWith(tile)
    expect(onClose).toHaveBeenCalledTimes(2)
    await waitFor(() => expect(document.activeElement).toBe(trigger))
  })

  it('treats an outside pointer as a focus-restoring cancel', async () => {
    const trigger = triggerForTile()
    const onClose = vi.fn()
    render(
      <TileStackPicker
        gridHeight={18}
        gridWidth={24}
        onClose={onClose}
        onSelectItem={vi.fn()}
        onSelectSurface={vi.fn()}
        tile={tile}
        trigger={trigger}
      />,
    )

    await waitFor(() => expect(document.activeElement).not.toBe(trigger))
    fireEvent.pointerDown(document.body)
    expect(onClose).toHaveBeenCalledOnce()
    await waitFor(() => expect(document.activeElement).toBe(trigger))
  })

  it('keeps focus inside when a live tile item disappears', async () => {
    const trigger = triggerForTile()
    const onClose = vi.fn()
    const view = render(
      <TileStackPicker
        gridHeight={18}
        gridWidth={24}
        onClose={onClose}
        onSelectItem={vi.fn()}
        onSelectSurface={vi.fn()}
        tile={tile}
        trigger={trigger}
      />,
    )

    const picker = screen.getByRole('dialog', { name: 'Choose an item' })
    const colonistChoice = within(picker).getByRole('button', { name: /Amina Okafor.*Colonist/i })
    await waitFor(() => expect(document.activeElement).toBe(colonistChoice))

    view.rerender(
      <TileStackPicker
        gridHeight={18}
        gridWidth={24}
        onClose={onClose}
        onSelectItem={vi.fn()}
        onSelectSurface={vi.fn()}
        tile={{ ...tile, contents: [blueprint] }}
        trigger={trigger}
      />,
    )

    const blueprintChoice = within(picker).getByRole('button', {
      name: /Wall blueprint.*Blueprint/i,
    })
    await waitFor(() => expect(document.activeElement).toBe(blueprintChoice))
    expect(picker).toContainElement(document.activeElement as HTMLElement)

    view.rerender(
      <TileStackPicker
        gridHeight={18}
        gridWidth={24}
        onClose={onClose}
        onSelectItem={vi.fn()}
        onSelectSurface={vi.fn()}
        tile={{ ...tile, contents: [] }}
        trigger={trigger}
      />,
    )

    const surfaceChoice = within(picker).getByRole('button', {
      name: /Tile itself.*Pressurized floor.*Tile 21, 15/i,
    })
    await waitFor(() => expect(document.activeElement).toBe(surfaceChoice))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('restores focus to the map when its geometric tile trigger cannot receive focus', async () => {
    const map = document.createElement('div')
    map.className = 'construction-map'
    map.dataset.pickerTestMap = 'true'
    map.tabIndex = 0
    const tileCell = document.createElement('span')
    tileCell.dataset.constructionCell = ''
    tileCell.dataset.gridX = '20'
    tileCell.dataset.gridY = '14'
    tileCell.getBoundingClientRect = vi.fn(() => ({
      x: 860,
      y: 600,
      left: 860,
      right: 900,
      top: 600,
      bottom: 640,
      width: 40,
      height: 40,
      toJSON: () => ({}),
    }))
    map.append(tileCell)
    document.body.append(map)

    const onClose = vi.fn()
    render(
      <TileStackPicker
        gridHeight={18}
        gridWidth={24}
        onClose={onClose}
        onSelectItem={vi.fn()}
        onSelectSurface={vi.fn()}
        tile={tile}
        trigger={tileCell}
      />,
    )

    const picker = screen.getByRole('dialog', { name: 'Choose an item' })
    await waitFor(() => expect(picker).toContainElement(document.activeElement as HTMLElement))
    fireEvent.keyDown(picker, { key: 'Escape' })

    expect(onClose).toHaveBeenCalledOnce()
    await waitFor(() => expect(document.activeElement).toBe(map))
  })

  it('keeps the app background interactive and preserves any pre-existing inert state', () => {
    const appRoot = document.createElement('div')
    appRoot.id = 'root'
    document.body.append(appRoot)
    const trigger = triggerForTile()

    const view = render(
      <TileStackPicker
        gridHeight={18}
        gridWidth={24}
        onClose={vi.fn()}
        onSelectItem={vi.fn()}
        onSelectSurface={vi.fn()}
        tile={tile}
        trigger={trigger}
      />,
    )

    expect(appRoot).not.toHaveAttribute('inert')
    view.unmount()
    expect(appRoot).not.toHaveAttribute('inert')

    appRoot.setAttribute('inert', '')
    const inertView = render(
      <TileStackPicker
        gridHeight={18}
        gridWidth={24}
        onClose={vi.fn()}
        onSelectItem={vi.fn()}
        onSelectSurface={vi.fn()}
        tile={tile}
        trigger={trigger}
      />,
    )

    expect(appRoot).toHaveAttribute('inert')
    inertView.unmount()
    expect(appRoot).toHaveAttribute('inert')
    appRoot.remove()
  })
})
