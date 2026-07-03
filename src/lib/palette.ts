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

export const BIOMES: Record<string, Biome> = {
  TypeScript: { language: 'TypeScript', style: 'terra', color: '#4c8dff', accent: '#1e3a8a', glow: '#8ec5ff' },
  JavaScript: { language: 'JavaScript', style: 'gas', color: '#fbbf24', accent: '#92400e', glow: '#fde68a' },
  Python: { language: 'Python', style: 'terra', color: '#34d399', accent: '#065f46', glow: '#8af0c6' },
  'Jupyter Notebook': { language: 'Jupyter Notebook', style: 'gas', color: '#fb923c', accent: '#7c2d12', glow: '#fdba74' },
  HTML: { language: 'HTML', style: 'terra', color: '#fb7185', accent: '#881337', glow: '#fda4af' },
  CSS: { language: 'CSS', style: 'gas', color: '#a78bfa', accent: '#4c1d95', glow: '#c4b5fd' },
  Go: { language: 'Go', style: 'ice', color: '#22d3ee', accent: '#155e75', glow: '#a5f3fc' },
  Rust: { language: 'Rust', style: 'terra', color: '#e07840', accent: '#7c2d12', glow: '#fdba74' },
  Shell: { language: 'Shell', style: 'ice', color: '#94a3b8', accent: '#334155', glow: '#cbd5e1' },
  C: { language: 'C', style: 'ice', color: '#64748b', accent: '#1e293b', glow: '#94a3b8' },
  'C++': { language: 'C++', style: 'gas', color: '#f472b6', accent: '#831843', glow: '#f9a8d4' },
  Java: { language: 'Java', style: 'terra', color: '#f87171', accent: '#7f1d1d', glow: '#fca5a5' },
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
