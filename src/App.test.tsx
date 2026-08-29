import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import App from './App'
import { useColonyStore } from './game/store'

const renderFreshApp = () => render(<App />)

const settlementMap = () => screen.getByRole('group', {
  name: /top-down interactive map of shackleton base/i,
})

const selectGuidedBlueprint = (name: RegExp) => {
  fireEvent.click(screen.getByRole('button', { name }))
}

const placeSelectedBlueprint = (name: RegExp) => {
  fireEvent.click(within(settlementMap()).getByRole('button', { name }))
}

beforeEach(() => {
  localStorage.clear()
  useColonyStore.getState().resetColony()
})

afterEach(() => {
  cleanup()
})

describe('tiny-start settlement UI', () => {
  it('lands with only the habitat, pad, two crew, and one guided build action', () => {
    renderFreshApp()

    const map = settlementMap()
    expect(map).toHaveAccessibleName(
      /2 base areas, 2 crew, 0 equipment items, 0 work orders, and 5 vacant build sites/i,
    )

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
    expect(guidedBuildActions[0]).toHaveAccessibleName(/Place Solar \/ Battery Skid.*3 build kits/i)
    expect(screen.getByLabelText('0 of 5 essential modules built')).toBeVisible()

    expect(screen.queryByRole('navigation', { name: 'Colony commands' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Current objective' })).not.toBeInTheDocument()
  })

  it('places the selected solar blueprint at a named site and advances the settlement', () => {
    renderFreshApp()

    selectGuidedBlueprint(/^Place Solar \/ Battery Skid/)

    const blueprintTray = screen.getByRole('region', { name: 'Build blueprints' })
    expect(
      within(blueprintTray).getByRole('button', { name: /^Solar \/ Battery Skid/ }),
    ).toHaveAttribute('aria-pressed', 'true')

    placeSelectedBlueprint(/^Build Solar \/ Battery Skid at East Ridge$/)

    const state = useColonyStore.getState()
    expect(state.settlement.phase).toBe('power_online')
    expect(state.reserves.constructionStock).toBe(11)
    expect(state.settlement.buildSites.find((site) => site.id === 'site-east-ridge')).toMatchObject({
      label: 'East Ridge',
      occupiedBy: 'solar_battery_skid',
    })
    expect(state.modules.find((module) => module.id === 'module-solar-skid')?.position).toEqual({
      x: 14,
      y: 1,
      width: 5,
      height: 4,
    })

    expect(settlementMap()).toHaveAccessibleName(
      /3 base areas, 2 crew, 0 equipment items, 0 work orders, and 4 vacant build sites/i,
    )
    expect(
      within(settlementMap()).getByRole('button', { name: /Inspect Solar \/ Battery Skid/i }),
    ).toBeVisible()
    expect(screen.getByLabelText('1 of 5 essential modules built')).toBeVisible()
    expect(screen.getByText(/Solar \/ Battery Skid built\. power online\./i)).toBeVisible()
    expect(screen.getByRole('button', { name: /^Place Life Support/ })).toBeEnabled()
  })

  it('builds all five essentials through the UI before revealing colony operations', () => {
    renderFreshApp()

    selectGuidedBlueprint(/^Place Solar \/ Battery Skid/)
    placeSelectedBlueprint(/^Build Solar \/ Battery Skid at East Ridge$/)

    selectGuidedBlueprint(/^Place Life Support/)
    placeSelectedBlueprint(/^Build Life Support at South Shelf$/)

    selectGuidedBlueprint(/^Place South Airlock/)
    placeSelectedBlueprint(/^Build South Airlock at North Shelf$/)

    const blueprintTray = screen.getByRole('region', { name: 'Build blueprints' })
    fireEvent.click(within(blueprintTray).getByRole('button', { name: /^Stores/ }))
    placeSelectedBlueprint(/^Build Stores at East Apron$/)

    selectGuidedBlueprint(/^Place Kepler Laboratory/)
    placeSelectedBlueprint(/^Build Kepler Laboratory at North Ridge$/)

    const ready = useColonyStore.getState()
    expect(ready.settlement.phase).toBe('ready')
    expect(ready.settlement.buildSites.every((site) => site.occupiedBy !== null)).toBe(true)
    expect(ready.reserves.constructionStock).toBe(0)
    expect(screen.getByLabelText('5 of 5 essential modules built')).toBeVisible()
    expect(screen.queryByRole('navigation', { name: 'Colony commands' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Current objective' })).not.toBeInTheDocument()

    const beginFirstShift = screen.getByRole('button', { name: /Begin first shift/i })
    expect(beginFirstShift).toBeEnabled()
    fireEvent.click(beginFirstShift)

    expect(useColonyStore.getState().settlement.phase).toBe('operations')
    expect(screen.getByRole('navigation', { name: 'Colony commands' })).toBeVisible()
    expect(screen.getByRole('region', { name: 'Current objective' })).toBeVisible()
    expect(screen.queryByRole('region', { name: 'Settlement guide' })).not.toBeInTheDocument()
  })
})
