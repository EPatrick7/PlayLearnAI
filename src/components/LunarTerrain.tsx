import { useMemo } from 'react'
import {
  generateLunarTerrain,
  lunarTerrainFeatures,
  type LunarTerrain,
  type LunarTerrainFeature,
} from '../game/lunarTerrain'
import '../lunar-terrain.css'

interface LunarTerrainProps {
  width: number
  height: number
  seed: number
  dustActive?: boolean
}

const rockBodies = [
  'M14 1 78 0 98 15 100 72 81 100 17 98 0 79 2 20Z',
  'M5 13 58 0 94 9 100 61 87 94 39 100 0 82 3 36Z',
  'M21 0 82 5 100 31 94 86 62 100 9 91 0 56 5 17Z',
  'M8 4 69 0 100 22 95 76 73 100 15 94 0 66 4 28Z',
] as const

const rotate = (feature: LunarTerrainFeature, x: number, y: number) => (
  `rotate(${feature.rotation} ${x} ${y})`
)

const renderRegolith = (feature: LunarTerrainFeature) => {
  const centerX = (feature.x + feature.width / 2) * 100
  const centerY = (feature.y + feature.height / 2) * 100
  const fills = ['#3d4038', '#777466', '#54574d', '#30352f']
  return `<g opacity=".2" transform="${rotate(feature, centerX, centerY)}"><ellipse cx="${centerX}" cy="${centerY}" rx="${feature.width * 43}" ry="${feature.height * 36}" fill="${fills[feature.variant]}"/><ellipse cx="${centerX - 9}" cy="${centerY - 4}" rx="${feature.width * 34}" ry="${feature.height * 25}" fill="url(#terrain-scuff)" opacity=".55"/></g>`
}

const renderCrater = (feature: LunarTerrainFeature) => {
  const centerX = (feature.x + feature.width / 2) * 100
  const centerY = (feature.y + feature.height / 2) * 100
  const radiusX = feature.width * 43
  const radiusY = feature.height * 38
  return `<g transform="${rotate(feature, centerX, centerY)}"><ellipse cx="${centerX}" cy="${centerY}" rx="${radiusX}" ry="${radiusY}" fill="url(#terrain-crater)" opacity=".86"/><ellipse cx="${centerX - radiusX * 0.14}" cy="${centerY - radiusY * 0.16}" rx="${radiusX * 0.72}" ry="${radiusY * 0.65}" fill="none" stroke="#d3cbae" stroke-opacity=".08" stroke-width="5"/><ellipse cx="${centerX + radiusX * 0.16}" cy="${centerY + radiusY * 0.18}" rx="${radiusX * 0.58}" ry="${radiusY * 0.52}" fill="#20241f" opacity=".18"/></g>`
}

const renderTrack = (feature: LunarTerrainFeature) => {
  const startX = feature.x * 100 + 8
  const endX = (feature.x + feature.width) * 100 - 8
  const centerY = (feature.y + 0.5) * 100
  const centerX = (startX + endX) / 2
  return `<g fill="none" stroke="#262a24" stroke-dasharray="13 10" stroke-linecap="square" stroke-opacity=".38" stroke-width="4" transform="rotate(${feature.rotation} ${centerX} ${centerY})"><path d="M${startX} ${centerY - 11}H${endX}"/><path d="M${startX} ${centerY + 11}H${endX}"/><path d="M${startX} ${centerY}" stroke="#d1c8aa" stroke-dasharray="4 22" stroke-opacity=".08" stroke-width="2"/></g>`
}

const mountainFacets = [
  'M7 18 36 8 67 15 93 7 100 52 74 46 48 58 14 46Z',
  'M0 38 24 17 58 11 92 24 100 56 68 48 37 63 9 57Z',
  'M13 7 46 17 77 8 100 29 91 58 57 49 27 63 0 45Z',
  'M0 24 31 9 61 19 88 10 100 48 72 60 42 49 13 61Z',
] as const

const mountainCracks = [
  'M29 25 42 37 35 49 49 62',
  'M66 20 55 34 64 46 52 58',
  'M24 56 38 43 50 49 62 34',
  'M72 55 59 44 66 31 51 22',
] as const

const renderMountainShadow = (feature: LunarTerrainFeature) => {
  const x = feature.x * 100
  const y = feature.y * 100
  const mask = feature.neighborMask ?? 0
  const shadows = [
    mask & 2 ? '' : '<path d="M96 8h10v99H82l14-11Z"/>',
    mask & 4 ? '' : '<path d="M8 96h99v11H-7l15-21Z"/>',
  ].join('')
  return shadows
    ? `<g fill="#171b17" opacity=".48" transform="translate(${x} ${y})">${shadows}</g>`
    : ''
}

const renderMountain = (feature: LunarTerrainFeature) => {
  const x = feature.x * 100
  const y = feature.y * 100
  const mask = feature.neighborMask ?? 0
  const exposedEdges = [
    mask & 1 ? '' : '<path d="M0 0h100v8L84 13 65 7 45 14 23 8 0 13Z" fill="#30362f"/><path d="M2 13 23 8 45 14 65 7 84 13 98 8" fill="none" stroke="#d7ceb0" stroke-opacity=".14" stroke-width="3"/>',
    mask & 2 ? '' : '<path d="M80 0 85 18 78 38 85 59 78 79 83 100h17V0Z" fill="#292f29"/><path d="M80 2 85 18 78 38 85 59 78 79 83 98" fill="none" stroke="#74776a" stroke-opacity=".18" stroke-width="3"/>',
    mask & 4 ? '' : '<path d="M0 76 18 82 37 75 56 83 77 76 100 81v19H0Z" fill="#292f29"/><path d="M2 76 18 82 37 75 56 83 77 76 98 81" fill="none" stroke="#74776a" stroke-opacity=".2" stroke-width="3"/>',
    mask & 8 ? '' : '<path d="M0 0h9l5 18-7 20 8 21-7 20 5 21H0Z" fill="#30362f"/><path d="M9 2 14 18 7 38 15 59 8 79 13 98" fill="none" stroke="#d2c9ab" stroke-opacity=".1" stroke-width="3"/>',
  ].join('')
  const crack = feature.variant === 0
    ? ''
    : `<path d="${mountainCracks[feature.variant]}" fill="none" stroke="#20251f" stroke-linecap="round" stroke-opacity=".32" stroke-width="3"/>`

  return `<g transform="translate(${x} ${y})"><rect width="100" height="100" fill="url(#terrain-mountain)"/><path d="${mountainFacets[feature.variant]}" fill="#222821" opacity=".13"/>${crack}${exposedEdges}</g>`
}

const boulderPlacement = [
  { offsetX: 22, offsetY: 28, scale: 0.5 },
  { offsetX: 30, offsetY: 21, scale: 0.47 },
  { offsetX: 20, offsetY: 25, scale: 0.52 },
  { offsetX: 29, offsetY: 30, scale: 0.48 },
] as const

const renderBoulder = (feature: LunarTerrainFeature) => {
  const x = feature.x * 100
  const y = feature.y * 100
  const path = rockBodies[feature.variant]
  const placement = boulderPlacement[feature.variant]
  const stoneTransform = `translate(${placement.offsetX} ${placement.offsetY}) scale(${placement.scale})`
  const shadowTransform = `translate(${placement.offsetX + 5} ${placement.offsetY + 7}) scale(${placement.scale})`
  const seam = feature.variant % 2 === 1
    ? '<path d="M22 61 41 45 58 51 77 34" fill="none" stroke="#b8ae8c" stroke-linecap="round" stroke-opacity=".38" stroke-width="4"/>'
    : ''
  return `<g transform="translate(${x} ${y}) rotate(${feature.rotation} 50 50)"><g fill="#171b17" opacity=".56" transform="${shadowTransform}"><path d="${path}"/></g><g fill="url(#terrain-rock)" stroke="#252a24" stroke-width="3" transform="${stoneTransform}"><path d="${path}"/><path d="M17 17 67 10 82 30 51 44 20 36Z" fill="#e2d9be" stroke="none" opacity=".13"/>${seam}</g>${feature.variant === 2 ? '<ellipse cx="72" cy="69" rx="7" ry="5" fill="#41463e" stroke="#292e28" stroke-width="2"/>' : ''}</g>`
}

const renderDebris = (feature: LunarTerrainFeature) => {
  const x = feature.x * 100
  const y = feature.y * 100
  const transform = `translate(${x} ${y}) rotate(${feature.rotation} 50 50)`
  if (feature.variant === 1) {
    return `<g transform="${transform}" fill="none" stroke="#30342d" stroke-width="5" opacity=".72"><ellipse cx="49" cy="48" rx="18" ry="15"/><path d="M61 59h13"/></g>`
  }
  if (feature.variant === 2) {
    return `<g transform="${transform}"><path d="M50 23v49" stroke="#b18d4c" stroke-width="5"/><path d="M49 24h24l-5 12H49Z" fill="#c19d58" stroke="#4a402a" stroke-width="2"/><ellipse cx="52" cy="75" rx="14" ry="5" fill="#20241f" opacity=".28"/></g>`
  }
  if (feature.variant === 3) {
    return `<g transform="${transform}" fill="#426057" stroke="#26362f" stroke-width="2" opacity=".8"><path d="m28 62 12-31 11 32 15-24 15 38Z"/></g>`
  }
  return `<g transform="${transform}"><path d="M25 57 31 37 52 31 63 47 55 65 35 68Z" fill="url(#terrain-stone)" stroke="#2b3029" stroke-width="2"/><ellipse cx="68" cy="66" rx="8" ry="7" fill="#40453c"/><ellipse cx="48" cy="73" rx="28" ry="8" fill="#20241f" opacity=".2"/></g>`
}

const terrainSvg = (terrain: LunarTerrain, width: number, height: number) => {
  const viewWidth = width * 100
  const viewHeight = height * 100
  const northRidge = `M-80 ${viewHeight * 0.13}C${viewWidth * 0.1} ${viewHeight * 0.05} ${viewWidth * 0.22} ${viewHeight * 0.16} ${viewWidth * 0.34} ${viewHeight * 0.08}S${viewWidth * 0.58} ${viewHeight * 0.04} ${viewWidth * 0.68} ${viewHeight * 0.13}S${viewWidth * 0.88} ${viewHeight * 0.09} ${viewWidth + 100} ${viewHeight * 0.045}`
  const southRidge = `M-120 ${viewHeight - 130}C${viewWidth * 0.12} ${viewHeight - 345} ${viewWidth * 0.25} ${viewHeight - 70} ${viewWidth * 0.39} ${viewHeight - 245}S${viewWidth * 0.72} ${viewHeight - 105} ${viewWidth + 120} ${viewHeight - 300}`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewWidth} ${viewHeight}" preserveAspectRatio="none"><defs><linearGradient id="terrain-mountain" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${viewWidth}" y2="${viewHeight}"><stop offset="0" stop-color="#55594f"/><stop offset=".48" stop-color="#484d44"/><stop offset="1" stop-color="#3d433b"/></linearGradient><linearGradient id="terrain-rock" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#797a6d"/><stop offset=".34" stop-color="#5c6055"/><stop offset=".72" stop-color="#484d44"/><stop offset="1" stop-color="#30352f"/></linearGradient><linearGradient id="terrain-stone" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#797a6d"/><stop offset="1" stop-color="#3f443c"/></linearGradient><radialGradient id="terrain-crater" cx="38%" cy="34%" r="68%"><stop offset="0" stop-color="#2f332d"/><stop offset=".5" stop-color="#3d4139"/><stop offset=".68" stop-color="#7a796a"/><stop offset=".82" stop-color="#52564c" stop-opacity=".35"/><stop offset="1" stop-color="#52564c" stop-opacity="0"/></radialGradient><pattern id="terrain-scuff" width="23" height="17" patternUnits="userSpaceOnUse"><path d="M0 15 23 8" stroke="#d8cfb1" stroke-opacity=".08" stroke-width="2"/><circle cx="7" cy="4" r="1.5" fill="#22261f" opacity=".2"/></pattern></defs><g fill="none" stroke-linecap="round"><path d="${northRidge}" stroke="#e1d9bd" stroke-opacity=".08" stroke-width="18"/><path d="${southRidge}" stroke="#20241f" stroke-opacity=".22" stroke-width="24"/><path d="M${viewWidth * 0.82} 0l-34 145 55 96-48 132 43 118-58 148 31 142" stroke="#232720" stroke-dasharray="34 12 8 16" stroke-opacity=".2" stroke-width="4"/></g>${terrain.regolith.map(renderRegolith).join('')}${terrain.craters.map(renderCrater).join('')}${terrain.tracks.map(renderTrack).join('')}${terrain.mountains.map(renderMountainShadow).join('')}${terrain.mountains.map(renderMountain).join('')}${terrain.boulders.map(renderBoulder).join('')}${terrain.debris.map(renderDebris).join('')}</svg>`
}

const signatureFor = (features: readonly LunarTerrainFeature[]) => {
  let hash = 2166136261
  features.forEach((feature) => {
    const value = [
      feature.id,
      feature.kind,
      feature.x,
      feature.y,
      feature.width,
      feature.height,
      feature.variant,
      feature.rotation,
      feature.neighborMask ?? '',
    ].join(':')
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index)
      hash = Math.imul(hash, 16777619)
    }
  })
  return (hash >>> 0).toString(16).padStart(8, '0')
}

interface TerrainPresentation {
  backgroundImage: string
  boulderCount: number
  featureCount: number
  mountainCount: number
  signature: string
}

const presentationCache = new Map<string, TerrainPresentation>()

const terrainPresentation = (width: number, height: number, seed: number) => {
  const key = `${Math.trunc(seed)}:${width}x${height}`
  const cached = presentationCache.get(key)
  if (cached) return cached

  const terrain = generateLunarTerrain({ width, height, seed })
  const features = lunarTerrainFeatures(terrain)
  const presentation = {
    backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(terrainSvg(terrain, width, height))}")`,
    boulderCount: terrain.boulders.length,
    featureCount: features.length,
    mountainCount: terrain.mountains.length,
    signature: signatureFor(features),
  }
  presentationCache.set(key, presentation)
  if (presentationCache.size > 16) {
    const oldestKey = presentationCache.keys().next().value
    if (oldestKey) presentationCache.delete(oldestKey)
  }
  return presentation
}

export function LunarTerrain({
  width,
  height,
  seed,
  dustActive = false,
}: LunarTerrainProps) {
  const presentation = useMemo(
    () => terrainPresentation(width, height, seed),
    [height, seed, width],
  )

  return (
    <div
      aria-hidden="true"
      className={`lunar-terrain ${dustActive ? 'dust-active' : ''}`}
      data-terrain-boulder-count={presentation.boulderCount}
      data-terrain-feature-count={presentation.featureCount}
      data-terrain-mountain-count={presentation.mountainCount}
      data-terrain-seed={seed}
      data-terrain-signature={presentation.signature}
      style={{ backgroundImage: presentation.backgroundImage }}
    />
  )
}
