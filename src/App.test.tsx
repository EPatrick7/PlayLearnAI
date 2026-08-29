import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import App from './App'
import { useColonyStore } from './game/store'

const renderFreshApp = () => render(<App />)

const settlementMap = () => screen.getByRole('group', {
  name: /top-down interactive map of shackleton base/i,
})

const selectBlueprint = (name: RegExp) => {
  fireEvent.click(screen.getByRole('button', { name }))
}

const previewAt = (name: RegExp) => {
  fireEvent.click(within(settlementMap()).getByRole('button', { name }))
}

const confirmBuild = (name: RegExp) => {
  fireEvent.click(screen.getByRole('button', { name }))
}

const completeGuidedBuild = (blueprint: RegExp, site: RegExp, confirmation: RegExp) => {
  selectBlueprint(blueprint)
  previewAt(site)
  confirmBuild(confirmation)
}

beforeEach(() => {
  localStorage.clear()
  useColonyStore.getState().resetColony()
})

afterEach(() => {
  cleanup()
})

describe('tiny-start settlement UI', () => {
  it('renders a semantic 24×18 tile map with a one-cell habitat shell and simple landing UI', () => {
    renderFreshApp()

    const map = settlementMap()
    expect(map).toHaveAttribute('aria-roledescription', 'colony tile map')
    expect(map).toHaveAttribute('data-grid-width', '24')
    expect(map).toHaveAttribute('data-grid-height', '18')
    expect(map).toHaveAccessibleName(
      /2 base areas, 2 crew, 0 equipment items, and 0 work orders/i,
    )
    expect(within(map).queryByRole('button', { name: /build socket/i })).not.toBeInTheDocument()

    const habitatTiles = [
      ...map.querySelectorAll<HTMLElement>(
        '[data-module-id="module-habitat"][data-tile-kind]',
      ),
    ]
    expect(habitatTiles).toHaveLength(6 * 7)
    for (const tile of habitatTiles) {
      const x = Number(tile.dataset.localX)
      const y = Number(tile.dataset.localY)
      const perimeter = x === 0 || x === 5 || y === 0 || y === 6
      expect(perimeter ? ['wall', 'door'] : ['floor']).toContain(tile.dataset.tileKind)
    }

    const habitatDoors = habitatTiles.filter((tile) => tile.dataset.tileKind === 'door')
    expect(habitatDoors).toHaveLength(1)
    expect(habitatDoors[0]).toHaveAttribute('data-grid-x', '6')
    expect(habitatDoors[0]).toHaveAttribute('data-grid-y', '9')
    expect(habitatDoors[0]).toHaveAttribute('data-door-side', 'east')

    const visibleModules = within(map).getAllByRole('button', { name: /^Inspect / })
    expect(visibleModules).toHaveLength(2)
    expect(visibleModules[0]).toHaveAccessibleName(/Inspect Habitat Aster/i)
    expect(visibleModules[1]).toHaveAccessibleName(/Inspect Shackleton Pad/i)

    const visibleCrew = within(map).getAllByRole('button', {
      name: /^Select .+,.+ idle in Habitat Aster/i,
    })
    expect(visibleCrew).toHaveLength(2)
    expect(visibleCrew[0]).toHaveAccessibleName(/Amina Okafor/i)
    expect(visibleCrew[1]).toHaveAccessibleName(/Mateo Alvarez/i)

    const guidedBuildActions = screen.getAllByRole('button', { name: /^Place / })
    expect(guidedBuildActions).toHaveLength(1)
    expect(guidedBuildActions[0]).toHaveAccessibleName(/Place Solar \/ Battery Skid/i)
    expect(screen.getByLabelText('0 of 5 essential modules built')).toBeVisible()
    expect(screen.queryByRole('navigation', { name: 'Colony commands' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Current objective' })).not.toBeInTheDocument()
  })

  it('enables only compatible sockets and commits Solar after preview confirmation', () => {
    renderFreshApp()
    selectBlueprint(/^Place Solar \/ Battery Skid/)

    const map = settlementMap()
    const compatibleSites = within(map).getAllByRole('button', {
      name: /^Preview Solar \/ Battery Skid at /,
    })
    expect(compatibleSites).toHaveLength(3)
    expect(compatibleSites.every((site) => !site.hasAttribute('disabled'))).toBe(true)
    expect(map).toHaveAccessibleName(/3 compatible build sockets/i)
    expect(within(map).queryByRole('button', {
      name: /cannot fit Solar \/ Battery Skid$/,
    })).not.toBeInTheDocument()

    const beforePreview = useColonyStore.getState()
    previewAt(/^Preview Solar \/ Battery Skid at West Ridge$/)

    expect(useColonyStore.getState().worldRevision).toBe(beforePreview.worldRevision)
    expect(useColonyStore.getState().reserves.constructionStock).toBe(14)
    expect(
      useColonyStore.getState().settlement.buildSites.find((site) => site.id === 'site-power-west'),
    ).toMatchObject({ occupiedBy: null })
    expect(
      within(map).getByRole('button', {
        name: /Solar \/ Battery Skid preview at West Ridge\. Selected build socket\./i,
      }),
    ).toBeEnabled()

    confirmBuild(/^Build Solar \/ Battery Skid/)

    const powered = useColonyStore.getState()
    expect(powered.settlement.phase).toBe('power_online')
    expect(powered.reserves.constructionStock).toBe(11)
    expect(powered.settlement.buildSites.find((site) => site.id === 'site-power-west')).toMatchObject({
      label: 'West Ridge',
      occupiedBy: 'solar_battery_skid',
    })
    expect(powered.modules.find((module) => module.id === 'module-solar-skid')?.position).toEqual({
      x: 2,
      y: 1,
      width: 5,
      height: 4,
    })
    expect(screen.getByLabelText('1 of 5 essential modules built')).toBeVisible()
    expect(screen.getByRole('button', { name: /^Place Life Support/ })).toBeEnabled()
  })

  it('builds connected rooms, renders a 2×2 workstation, and then reveals operations', () => {
    renderFreshApp()

    completeGuidedBuild(
      /^Place Solar \/ Battery Skid/,
      /^Preview Solar \/ Battery Skid at East Ridge$/,
      /^Build Solar \/ Battery Skid/,
    )
    completeGuidedBuild(
      /^Place Life Support/,
      /^Preview Life Support at Northwest Bay$/,
      /^Build Life Support/,
    )
    completeGuidedBuild(
      /^Place South Airlock/,
      /^Preview South Airlock at Padside Bay$/,
      /^Build South Airlock/,
    )

    const blueprintTray = screen.getByRole('region', { name: 'Build blueprints' })
    fireEvent.click(within(blueprintTray).getByRole('button', { name: /^Stores/ }))
    previewAt(/^Preview Stores at Southwest Bay$/)
    confirmBuild(/^Build Stores/)

    completeGuidedBuild(
      /^Place Kepler Laboratory/,
      /^Preview Kepler Laboratory at Northeast Bay$/,
      /^Build Kepler Laboratory/,
    )

    const ready = useColonyStore.getState()
    expect(ready.settlement.phase).toBe('ready')
    expect(ready.settlement.buildSites.filter((site) => site.occupiedBy !== null)).toHaveLength(5)
    expect(ready.reserves.constructionStock).toBe(0)
    expect(screen.getByLabelText('5 of 5 essential modules built')).toBeVisible()

    const labBench = settlementMap().querySelector<HTMLElement>(
      '[data-module-id="module-laboratory"][data-fixture="lab-bench"]',
    )
    expect(labBench).toHaveAttribute('data-fixture-id', 'module-laboratory-wet-bench')
    expect(labBench?.style.gridColumn).toMatch(/span 2/)
    expect(labBench?.style.gridRow).toMatch(/span 2/)

    expect(screen.queryByRole('navigation', { name: 'Colony commands' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Current objective' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Begin first shift/i }))

    expect(useColonyStore.getState().settlement.phase).toBe('operations')
    expect(screen.getByRole('navigation', { name: 'Colony commands' })).toBeVisible()
    expect(screen.getByRole('region', { name: 'Current objective' })).toBeVisible()
  })
})
