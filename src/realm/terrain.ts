import { BufferGeometry, Color, Float32BufferAttribute, PlaneGeometry } from 'three'
import { makeFbm2D, makeRidged2D, smoothstep } from './noise'

/**
 * The realm's island continent, generated once and deterministically.
 * Three climate kingdoms (see docs/realm-concept.md):
 *   - The Frozen Reach — north (−z): ridged mountains, snowline, cold rock
 *   - The Golden Vale  — south-west: rolling wheat and grass
 *   - The Runelands    — south-east: dusk moss and violet stone
 * Faceted low-poly look: non-indexed geometry, one color per triangle.
 */

export const REALM_SIZE = 280
export const WATER_LEVEL = 0
const SEGMENTS = 116
const HALF = REALM_SIZE / 2

const SEED_BASE = 0x0a11ce
const SEED_MOUNTAIN = 0x5eed42
const SEED_TINT = 0x7e57ed

/* ---------------------------------------------------------------- */
/* Height + climate fields                                           */
/* ---------------------------------------------------------------- */

const baseFbm = makeFbm2D(SEED_BASE, 5)
const ridged = makeRidged2D(SEED_MOUNTAIN, 4)
const tintFbm = makeFbm2D(SEED_TINT, 3)

export interface ClimateWeights {
  frozen: number
  vale: number
  rune: number
}

/** Blend weights of the three kingdoms at a world x/z position (sum = 1). */
export function climateAt(x: number, z: number): ClimateWeights {
  // North (−z) belongs to the Frozen Reach.
  const f = smoothstep(8, 70, -z)
  // The south splits west (Vale) / east (Runelands) across a soft border.
  const west = 1 - smoothstep(-22, 22, x)
  return {
    frozen: f,
    vale: (1 - f) * west,
    rune: (1 - f) * (1 - west),
  }
}

/** A spot the terrain flattens into a buildable plateau (castle site). */
export interface FlattenSite {
  x: number
  z: number
  /** Plateau height. */
  y: number
  /** Fully flat within r; blends back to raw terrain over r..r+10. */
  r: number
}

/** Raw (site-agnostic) terrain height at world x/z. */
export function rawHeightAt(x: number, z: number): number {
  const { frozen } = climateAt(x, z)

  // Rolling base terrain.
  const base = baseFbm(x * 0.012 + 100, z * 0.012 + 100) * 9 - 2.6

  // Ridged ranges rise in the north.
  const mountains = Math.pow(ridged(x * 0.02, z * 0.02), 1.4) * 30 * frozen

  // Island falloff: the continent sinks into the sea toward the edges.
  const r = Math.max(Math.abs(x), Math.abs(z))
  const falloff = 1 - smoothstep(HALF * 0.7, HALF * 0.97, r)

  return (base + mountains) * falloff - (1 - falloff) * 6
}

/* ---------------------------------------------------------------- */
/* Palette                                                           */
/* ---------------------------------------------------------------- */

const SAND = new Color('#a8946a')
const GRASS = new Color('#6f9455')
const WHEAT = new Color('#c2a558')
const MOSS = new Color('#5d6d8f')
const VIOLET = new Color('#7d6fb4')
const ROCK = new Color('#525c74')
const ROCK_COLD = new Color('#46506b')
const SNOW = new Color('#e9eff9')
const DEEP = new Color('#233049')

const scratch = new Color()

/** Facet color for a triangle centred at (x, z) with centroid height h. */
function colorAt(x: number, z: number, h: number, out: Color): Color {
  const { frozen, vale, rune } = climateAt(x, z)
  const tint = tintFbm(x * 0.05, z * 0.05)

  if (h < WATER_LEVEL + 0.5) {
    // Shoreline and seabed.
    out.copy(DEEP).lerp(SAND, smoothstep(WATER_LEVEL - 4, WATER_LEVEL + 0.5, h))
    return out
  }

  // Kingdom ground covers.
  out.set(0, 0, 0)
  scratch.copy(GRASS).lerp(WHEAT, tint)
  out.r += scratch.r * vale
  out.g += scratch.g * vale
  out.b += scratch.b * vale
  scratch.copy(MOSS).lerp(VIOLET, tint * 0.8)
  out.r += scratch.r * rune
  out.g += scratch.g * rune
  out.b += scratch.b * rune
  scratch.copy(ROCK_COLD)
  out.r += scratch.r * frozen
  out.g += scratch.g * frozen
  out.b += scratch.b * frozen

  // Rock band on high ground everywhere; snow above the (noisy) snowline,
  // which sits much lower in the Frozen Reach.
  const rockiness = smoothstep(7, 12, h) * (1 - frozen)
  out.lerp(ROCK, rockiness)
  const snowline = 16 - frozen * 9 + tint * 2.5
  out.lerp(SNOW, smoothstep(snowline, snowline + 3.5, h))

  // Beach blend just above the waterline.
  out.lerp(SAND, 1 - smoothstep(WATER_LEVEL + 0.5, WATER_LEVEL + 1.6, h))
  return out
}

/* ---------------------------------------------------------------- */
/* Geometry                                                          */
/* ---------------------------------------------------------------- */

/** Height including plateau flattening around castle sites. */
export function heightAt(x: number, z: number, sites: FlattenSite[] = []): number {
  let h = rawHeightAt(x, z)
  for (const site of sites) {
    const dx = x - site.x
    const dz = z - site.z
    const d = Math.sqrt(dx * dx + dz * dz)
    if (d > site.r + 10) continue
    const w = 1 - smoothstep(site.r, site.r + 10, d)
    h = h + (site.y - h) * w
  }
  return h
}

/** Build the faceted island geometry (non-indexed, per-face vertex colors). */
export function buildTerrainGeometry(sites: FlattenSite[] = []): BufferGeometry {
  const plane = new PlaneGeometry(REALM_SIZE, REALM_SIZE, SEGMENTS, SEGMENTS)
  plane.rotateX(-Math.PI / 2)

  const pos = plane.attributes.position
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, heightAt(pos.getX(i), pos.getZ(i), sites))
  }

  // Non-indexed so each face can carry a single flat color.
  const geo = plane.toNonIndexed()
  plane.dispose()

  const p = geo.attributes.position
  const colors = new Float32Array(p.count * 3)
  const c = new Color()
  for (let i = 0; i < p.count; i += 3) {
    const cx = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3
    const cz = (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3
    const ch = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3
    colorAt(cx, cz, ch, c)
    for (let v = 0; v < 3; v++) {
      colors[(i + v) * 3] = c.r
      colors[(i + v) * 3 + 1] = c.g
      colors[(i + v) * 3 + 2] = c.b
    }
  }
  geo.setAttribute('color', new Float32BufferAttribute(colors, 3))
  geo.computeVertexNormals()
  return geo
}

/* ---------------------------------------------------------------- */
/* Ambience per kingdom (fog/sky lerp targets)                       */
/* ---------------------------------------------------------------- */

export const KINGDOM_AMBIENCE = {
  frozen: { sky: new Color('#0c1424'), fog: new Color('#101b30') },
  vale: { sky: new Color('#171310'), fog: new Color('#241b13') },
  rune: { sky: new Color('#130e22'), fog: new Color('#1b1430') },
}
