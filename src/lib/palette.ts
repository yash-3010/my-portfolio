/** Visual identity of the galaxy: language biomes + constellation colors. */

export interface Biome {
  /** GitHub language name this biome represents. */
  language: string
  /** Base surface color of the planet. */
  color: string
  /** Darker secondary shade (craters / dark side). */
  accent: string
  /** Emissive tint used when the planet is recently active. */
  glow: string
  /** Procedural surface family: oceans+continents, banded gas, or ice. */
  style: 'terra' | 'gas' | 'ice'
}

/** The three languages this galaxy renders: blue, green, red. Repos in any
    other language are filtered out of the scene entirely. */
export const BIOMES: Record<string, Biome> = {
  TypeScript: { language: 'TypeScript', style: 'terra', color: '#4c8dff', accent: '#1e3a8a', glow: '#8ec5ff' },
  Python: { language: 'Python', style: 'terra', color: '#34d399', accent: '#065f46', glow: '#8af0c6' },
  Ruby: { language: 'Ruby', style: 'terra', color: '#e04a4a', accent: '#7f1d1d', glow: '#fda4a4' },
}

export const DEFAULT_BIOME: Biome = {
  language: 'Other', style: 'ice',
  color: '#8b5cf6',
  accent: '#3b0764',
  glow: '#c4b5fd',
}

export function biomeFor(language: string | null): Biome {
  return (language && BIOMES[language]) || DEFAULT_BIOME
}

export type ConstellationId = 'web' | 'ai' | 'tools'

export interface ConstellationMeta {
  id: ConstellationId
  label: string
  /** Accent color for labels / legend. */
  color: string
  /** Center of the constellation's angular sector in the orbital plane, radians. */
  centerAngle: number
  /** Angular width of the sector, radians. */
  sectorWidth: number
}

const THIRD = (Math.PI * 2) / 3

export const CONSTELLATIONS: Record<ConstellationId, ConstellationMeta> = {
  web: { id: 'web', label: 'Web', color: '#8ec5ff', centerAngle: Math.PI / 2, sectorWidth: THIRD * 0.72 },
  ai: { id: 'ai', label: 'AI / ML', color: '#8af0c6', centerAngle: Math.PI / 2 + THIRD, sectorWidth: THIRD * 0.72 },
  tools: { id: 'tools', label: 'Dev Tools', color: '#fde68a', centerAngle: Math.PI / 2 + THIRD * 2, sectorWidth: THIRD * 0.72 },
}

/** Sun / self colors. */
export const SUN = {
  core: '#ffd27d',
  glow: '#ff9d5c',
  light: '#ffe3b3',
}
