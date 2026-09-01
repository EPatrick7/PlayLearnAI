import type { ConstructionLayout, GridPoint } from './construction'
import { analyzeConstructionPressure } from './pressureTopology'
import type { AtmosphereState, ModuleState } from './types'

const pointKey = ({ x, y }: GridPoint) => `${x}:${y}`

/**
 * Cells covered by a semantic module that is not breathable. Freeform pressure
 * topology describes the shell; this overlay carries live incident state such
 * as the breached Kepler Laboratory into construction routing and exposure.
 */
export const constructionSemanticEvaCells = (
  modules: readonly ModuleState[],
  layout: ConstructionLayout,
  laboratoryAtmosphere?: AtmosphereState,
): GridPoint[] => {
  const cells = new Map<string, GridPoint>()
  const unbreathableModules = modules.filter((module) => {
    const atmosphere = module.location === 'laboratory' && laboratoryAtmosphere
      ? laboratoryAtmosphere
      : module.atmosphere
    return atmosphere !== 'yes'
  })
  unbreathableModules.forEach((module) => {
    for (let y = module.position.y; y < module.position.y + module.position.height; y += 1) {
      for (let x = module.position.x; x < module.position.x + module.position.width; x += 1) {
        if (x < 0 || y < 0 || x >= layout.width || y >= layout.height) continue
        const cell = { x, y }
        cells.set(pointKey(cell), cell)
      }
    }
  })
  analyzeConstructionPressure(layout).rooms.forEach((room) => {
    const intersectsVacuumModule = unbreathableModules.some((module) => room.cells.some((cell) => (
      cell.x >= module.position.x &&
      cell.x < module.position.x + module.position.width &&
      cell.y >= module.position.y &&
      cell.y < module.position.y + module.position.height
    )))
    if (!intersectsVacuumModule) return
    room.cells.forEach((cell) => cells.set(pointKey(cell), { ...cell }))
  })
  return [...cells.values()].sort((left, right) => left.y - right.y || left.x - right.x)
}

export const constructionSemanticEvaCellKeys = (
  modules: readonly ModuleState[],
  layout: ConstructionLayout,
  laboratoryAtmosphere?: AtmosphereState,
) => new Set(
  constructionSemanticEvaCells(modules, layout, laboratoryAtmosphere).map(pointKey),
)
