import type { ModuleState } from '../game/types'

export interface GridPoint {
  x: number
  y: number
}

const isExteriorModule = (module: ModuleState) =>
  module.type === 'solar_battery_skid' || module.type === 'landing_pad'

/** Returns global grid cells where entity tokens can stand without landing on a full wall tile. */
export const getModuleWalkableCells = (module: ModuleState): GridPoint[] => {
  const cells: GridPoint[] = []
  const { x, y, width, height } = module.position

  if (module.type === 'corridor') {
    const row = y + Math.floor(height / 2)
    for (let localX = 1; localX < width - 1; localX += 1) {
      cells.push({ x: x + localX, y: row })
    }
    if (cells.length === 0) {
      cells.push({ x: x + Math.floor(Math.max(0, width - 1) / 2), y: row })
    }
    return cells
  }

  if (isExteriorModule(module)) {
    for (let localY = 0; localY < height; localY += 1) {
      for (let localX = 0; localX < width; localX += 1) {
        cells.push({ x: x + localX, y: y + localY })
      }
    }
    return cells
  }

  for (let localY = 1; localY < height - 1; localY += 1) {
    for (let localX = 1; localX < width - 1; localX += 1) {
      cells.push({ x: x + localX, y: y + localY })
    }
  }

  if (cells.length === 0) {
    cells.push({
      x: x + Math.floor(Math.max(0, width - 1) / 2),
      y: y + Math.floor(Math.max(0, height - 1) / 2),
    })
  }

  return cells
}
