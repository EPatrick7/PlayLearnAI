export type LunarTerrainFeatureKind =
  | 'crater'
  | 'debris'
  | 'outcrop'
  | 'regolith'
  | 'track'

export interface LunarTerrainFeature {
  id: string
  kind: LunarTerrainFeatureKind
  x: number
  y: number
  width: number
  height: number
  variant: number
  rotation: number
  /** North, east, south, and west use bits 1, 2, 4, and 8. */
  neighborMask?: number
}

export interface LunarTerrain {
  craters: LunarTerrainFeature[]
  debris: LunarTerrainFeature[]
  outcrops: LunarTerrainFeature[]
  regolith: LunarTerrainFeature[]
  tracks: LunarTerrainFeature[]
}

interface LunarTerrainOptions {
  width: number
  height: number
  seed: number
}

interface Point {
  x: number
  y: number
}

const NORTH = 1
const EAST = 2
const SOUTH = 4
const WEST = 8

const clamp = (value: number, minimum: number, maximum: number) => (
  Math.min(maximum, Math.max(minimum, value))
)

const pointKey = ({ x, y }: Point) => `${x}:${y}`

const hashSeed = (seed: number, namespace: string) => {
  let hash = Number.isFinite(seed) ? Math.trunc(seed) >>> 0 : 1
  for (let index = 0; index < namespace.length; index += 1) {
    hash ^= namespace.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

const createRandom = (seed: number, namespace: string) => {
  let state = hashSeed(seed, namespace)
  return () => {
    state += 0x6d2b79f5
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

const shuffled = <T,>(values: readonly T[], random: () => number) => {
  const result = [...values]
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1))
    const value = result[index]
    result[index] = result[swapIndex]
    result[swapIndex] = value
  }
  return result
}

const inBounds = (point: Point, width: number, height: number) => (
  point.x >= 0 && point.x < width && point.y >= 0 && point.y < height
)

/**
 * Shackleton Base sits in a surveyed basin with a service lane extending east.
 * Keeping that area visually quiet lets the authored terrain survive construction
 * changes without appearing to move when a player places a wall or workstation.
 */
export const isLunarTerrainQuietCell = ({ x, y }: Point, width: number, height: number) => {
  const normalizedX = (x + 0.5) / width
  const normalizedY = (y + 0.5) / height
  const basin = (
    ((normalizedX - 0.23) / 0.19) ** 2 +
    ((normalizedY - 0.53) / 0.29) ** 2
  ) < 1
  const serviceLane = (
    normalizedX >= 0.3 &&
    normalizedX <= 0.76 &&
    Math.abs(normalizedY - 0.53) <= 0.105
  )
  return basin || serviceLane
}

const edgeDistance = ({ x, y }: Point, width: number, height: number) => (
  Math.min(x, y, width - 1 - x, height - 1 - y)
)

const allCells = (width: number, height: number) => Array.from(
  { length: width * height },
  (_, index) => ({ x: index % width, y: Math.floor(index / width) }),
)

const createOutcrops = ({ width, height, seed }: LunarTerrainOptions) => {
  const random = createRandom(seed, `outcrops:${width}x${height}`)
  const area = width * height
  const targetCount = clamp(Math.round(area * 0.068), 8, 34)
  const clusterCount = clamp(Math.round(area / 86), 3, 5)
  const edgeBand = clamp(Math.round(Math.min(width, height) * 0.25), 2, 5)
  const candidates = shuffled(
    allCells(width, height).filter((cell) => (
      edgeDistance(cell, width, height) <= edgeBand &&
      !isLunarTerrainQuietCell(cell, width, height)
    )),
    random,
  )
  const occupied = new Set<string>()
  const clusters: Point[][] = []
  const directions: Point[] = [
    { x: 0, y: -1 },
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: -1, y: 0 },
  ]

  for (let clusterIndex = 0; clusterIndex < clusterCount; clusterIndex += 1) {
    const remainingClusters = clusterCount - clusterIndex
    const remainingCells = targetCount - occupied.size
    const clusterTarget = Math.max(2, Math.round(remainingCells / remainingClusters))
    const start = candidates.find((candidate) => {
      if (occupied.has(pointKey(candidate))) return false
      return !clusters.some((cluster) => cluster.some((cell) => (
        Math.abs(cell.x - candidate.x) + Math.abs(cell.y - candidate.y) <= 2
      )))
    })
    if (!start) break

    const cluster: Point[] = [{ ...start }]
    occupied.add(pointKey(start))
    let attempts = 0
    while (cluster.length < clusterTarget && attempts < clusterTarget * 70) {
      attempts += 1
      const anchor = cluster[Math.floor(random() * cluster.length)]
      const direction = directions[Math.floor(random() * directions.length)]
      const candidate = { x: anchor.x + direction.x, y: anchor.y + direction.y }
      const key = pointKey(candidate)
      if (
        !inBounds(candidate, width, height) ||
        occupied.has(key) ||
        isLunarTerrainQuietCell(candidate, width, height) ||
        edgeDistance(candidate, width, height) > edgeBand + 1
      ) continue
      occupied.add(key)
      cluster.push(candidate)
    }
    clusters.push(cluster)
  }

  const fillCandidates = shuffled(candidates, random)
  while (occupied.size < targetCount) {
    const candidate = fillCandidates.find((cell) => !occupied.has(pointKey(cell)))
    if (!candidate) break
    occupied.add(pointKey(candidate))
    clusters.push([candidate])
  }

  const points = [...occupied].map((key) => {
    const [x, y] = key.split(':').map(Number)
    return { x, y }
  }).sort((left, right) => left.y - right.y || left.x - right.x)

  return points.map((point) => {
    const connected = (x: number, y: number) => occupied.has(`${x}:${y}`)
    const neighborMask =
      (connected(point.x, point.y - 1) ? NORTH : 0) |
      (connected(point.x + 1, point.y) ? EAST : 0) |
      (connected(point.x, point.y + 1) ? SOUTH : 0) |
      (connected(point.x - 1, point.y) ? WEST : 0)
    const variantRandom = createRandom(seed, `outcrop:${point.x}:${point.y}`)
    return {
      id: `outcrop-${point.x}-${point.y}`,
      kind: 'outcrop' as const,
      x: point.x,
      y: point.y,
      width: 1,
      height: 1,
      variant: Math.floor(variantRandom() * 4),
      rotation: 0,
      neighborMask,
    }
  })
}

const footprintCells = (feature: Pick<LunarTerrainFeature, 'x' | 'y' | 'width' | 'height'>) => {
  const cells: Point[] = []
  for (let y = feature.y; y < feature.y + feature.height; y += 1) {
    for (let x = feature.x; x < feature.x + feature.width; x += 1) cells.push({ x, y })
  }
  return cells
}

const createPlacedFeatures = ({
  width,
  height,
  seed,
  kind,
  count,
  occupied,
  sizes,
  allowQuiet = false,
}: LunarTerrainOptions & {
  kind: Exclude<LunarTerrainFeatureKind, 'outcrop'>
  count: number
  occupied: Set<string>
  sizes: readonly { width: number; height: number }[]
  allowQuiet?: boolean
}) => {
  const random = createRandom(seed, `${kind}:${width}x${height}`)
  const features: LunarTerrainFeature[] = []
  const fittingSizes = sizes.filter((size) => size.width <= width && size.height <= height)
  if (fittingSizes.length === 0) return features
  let attempts = 0
  while (features.length < count && attempts < count * 90) {
    attempts += 1
    const size = fittingSizes[Math.floor(random() * fittingSizes.length)]
    const candidate = {
      x: Math.floor(random() * Math.max(1, width - size.width + 1)),
      y: Math.floor(random() * Math.max(1, height - size.height + 1)),
      width: size.width,
      height: size.height,
      variant: Math.floor(random() * 4),
      rotation: Math.round((random() * 28 - 14) * 10) / 10,
    }
    const cells = footprintCells(candidate)
    if (cells.some((cell) => (
      occupied.has(pointKey(cell)) ||
      (!allowQuiet && isLunarTerrainQuietCell(cell, width, height))
    ))) continue
    cells.forEach((cell) => occupied.add(pointKey(cell)))
    features.push({
      ...candidate,
      id: `${kind}-${features.length}-${candidate.x}-${candidate.y}`,
      kind,
    })
  }
  return features
}

export const generateLunarTerrain = ({ width, height, seed }: LunarTerrainOptions): LunarTerrain => {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    return { craters: [], debris: [], outcrops: [], regolith: [], tracks: [] }
  }

  const outcrops = createOutcrops({ width, height, seed })
  const occupied = new Set(outcrops.map((feature) => `${feature.x}:${feature.y}`))
  const area = width * height
  const craters = createPlacedFeatures({
    width,
    height,
    seed,
    kind: 'crater',
    count: clamp(Math.round(area / 72), 2, 6),
    occupied,
    sizes: [
      { width: 1, height: 1 },
      { width: 2, height: 1 },
      { width: 2, height: 2 },
      { width: 3, height: 2 },
    ],
  })
  const tracks = createPlacedFeatures({
    width,
    height,
    seed,
    kind: 'track',
    count: clamp(Math.round(area / 210), 1, 3),
    occupied,
    sizes: [
      { width: 4, height: 1 },
      { width: 5, height: 1 },
      { width: 3, height: 1 },
    ],
    allowQuiet: true,
  })
  const debris = createPlacedFeatures({
    width,
    height,
    seed,
    kind: 'debris',
    count: clamp(Math.round(area / 46), 3, 10),
    occupied,
    sizes: [{ width: 1, height: 1 }],
    allowQuiet: true,
  })
  const regolith = createPlacedFeatures({
    width,
    height,
    seed,
    kind: 'regolith',
    count: clamp(Math.round(area / 45), 3, 10),
    occupied: new Set(outcrops.map((feature) => `${feature.x}:${feature.y}`)),
    sizes: [
      { width: 2, height: 1 },
      { width: 3, height: 1 },
      { width: 3, height: 2 },
      { width: 4, height: 2 },
    ],
    allowQuiet: true,
  })

  return { craters, debris, outcrops, regolith, tracks }
}

export const lunarTerrainFeatures = (terrain: LunarTerrain) => [
  ...terrain.regolith,
  ...terrain.craters,
  ...terrain.tracks,
  ...terrain.outcrops,
  ...terrain.debris,
]
