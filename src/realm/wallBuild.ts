import {
  BoxGeometry,
  BufferGeometry,
  CatmullRomCurve3,
  Color,
  Float32BufferAttribute,
  Vector3,
} from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { ContributionDay } from '../types'
import { makeFbm2D } from './noise'
import { WALL_SPAN_X, rawHeightAt, wallPathZ } from './terrain'

/**
 * The Wall — the year of commits as 365 blocks of ice along the realm's
 * northern border (Phase 3 of docs/realm-concept.md).
 *
 * Unlike the rest of the realm this is NOT low-poly: each day is a subdivided
 * block, all 365 are merged and noise-displaced into a craggy, smooth-shaded
 * ice face rendered with a physical material. Days with commits carry glowing
 * veins whose brightness scales with the count.
 */

export const WALL_DAYS = 365
export const WALL_THICKNESS = 3.4
const MIN_HEIGHT = 6
const MAX_EXTRA = 9.5
const SUBDIV_Y = 6
const SUBDIV_X = 2

const displaceA = makeFbm2D(0x1cebe4, 4)
const displaceB = makeFbm2D(0xf40575, 4)
const tintNoise = makeFbm2D(0x51bb1e, 3)

export interface WallBuild {
  /** Merged, displaced, vertex-colored ice body. */
  bodyGeometry: BufferGeometry
  /** Additive glow strips (aGlow attribute), null if the year is empty. */
  veinGeometry: BufferGeometry | null
  /** Walkway rail along the top, west (day 0) to east (day 364). */
  rail: CatmullRomCurve3
  days: ContributionDay[]
  maxCount: number
}

interface SegmentFrame {
  x: number
  z: number
  angle: number
  /** Block bottom — rooted below both the leveled line and local terrain. */
  baseY: number
  height: number
  /** Crown line (baseY + height), smooth along the wall. */
  topY: number
  /** Along-path block width (arc-corrected so blocks never gap). */
  width: number
}

/** Moving average smoothing for the wall's base/top lines. */
function smooth(values: number[], window: number): number[] {
  const out = new Array<number>(values.length)
  for (let i = 0; i < values.length; i++) {
    let sum = 0
    let n = 0
    for (let j = Math.max(0, i - window); j <= Math.min(values.length - 1, i + window); j++) {
      sum += values[j]
      n++
    }
    out[i] = sum / n
  }
  return out
}

function buildFrames(days: ContributionDay[], maxCount: number): SegmentFrame[] {
  const n = days.length
  const rawBases: number[] = []
  const xs: number[] = []
  const zs: number[] = []
  for (let i = 0; i < n; i++) {
    const x = -WALL_SPAN_X + (WALL_SPAN_X * 2 * (i + 0.5)) / n
    const z = wallPathZ(x)
    xs.push(x)
    zs.push(z)
    rawBases.push(rawHeightAt(x, z))
  }
  const bases = smooth(rawBases, 8)

  // Weekly-smoothed height profile: streaks become hills, quiet stretches
  // become lows — per-day jumps would comb the crown into spikes (and the
  // day-level detail already lives in the veins + walk readout).
  const extras = smooth(
    days.map((d) => Math.pow(Math.min(1, d.count / maxCount), 0.7) * MAX_EXTRA),
    3,
  )

  return days.map((_, i) => {
    // Tangent from neighbors for the block's yaw along the arc.
    const x0 = xs[Math.max(0, i - 1)]
    const z0 = zs[Math.max(0, i - 1)]
    const x1 = xs[Math.min(n - 1, i + 1)]
    const z1 = zs[Math.min(n - 1, i + 1)]
    const angle = -Math.atan2(z1 - z0, x1 - x0)
    // Crown rides the leveled line; the base roots below BOTH the leveled
    // line and the real terrain, so blocks never float over ravines.
    const topY = bases[i] + MIN_HEIGHT + extras[i]
    const baseY = Math.min(bases[i], rawBases[i]) - 2.5
    // Arc-corrected width: neighbor midpoint spacing, with a little overlap.
    const span = Math.hypot(x1 - x0, z1 - z0)
    const width = (span / Math.max(1, Math.min(n - 1, i + 1) - Math.max(0, i - 1))) * 1.12
    return { x: xs[i], z: zs[i], angle, baseY, height: topY - baseY, topY, width }
  })
}

// Kept under the bloom threshold — the veins are the emissive element,
// the ice body must not bloom into a barcode.
const ICE_DEEP = new Color('#6d95c2')
const ICE_BRIGHT = new Color('#b9cfe6')
const ICE_COMMIT = new Color('#8fc3de')

function buildBody(frames: SegmentFrame[], days: ContributionDay[], maxCount: number, segWidth: number): BufferGeometry {
  const parts: BufferGeometry[] = []
  const color = new Color()
  const tinted = new Color()

  for (let i = 0; i < frames.length; i++) {
    const f = frames[i]
    const box = new BoxGeometry(Math.max(segWidth, f.width), f.height, WALL_THICKNESS, SUBDIV_X, SUBDIV_Y, 1)
    box.translate(0, f.height / 2, 0)
    box.rotateY(f.angle)
    box.translate(f.x, f.baseY, f.z)

    // Per-vertex ice color: darker toward the base, brighter at the crown,
    // busy days shifted toward glacial cyan.
    const t = Math.min(1, days[i].count / maxCount)
    const pos = box.attributes.position
    const colors = new Float32Array(pos.count * 3)
    for (let v = 0; v < pos.count; v++) {
      // Gradient over the VISIBLE face (crown down ~13 units), not the
      // buried root, so the wall reads deep-blue at ground level.
      const yNorm = Math.min(1, Math.max(0, 1 - (f.topY - pos.getY(v)) / 13))
      color.copy(ICE_DEEP).lerp(ICE_BRIGHT, Math.pow(yNorm, 1.3))
      tinted.copy(color).lerp(ICE_COMMIT, t * 0.3)
      // Gentle, low-frequency tinting — strong per-block variation moirés
      // into stripes at overview distance.
      const shade = 0.97 + tintNoise(pos.getX(v) * 0.06, pos.getY(v) * 0.06) * 0.05
      colors[v * 3] = tinted.r * shade
      colors[v * 3 + 1] = tinted.g * shade
      colors[v * 3 + 2] = tinted.b * shade
    }
    box.setAttribute('color', new Float32BufferAttribute(colors, 3))
    parts.push(box)
  }

  const merged = mergeGeometries(parts, false)!
  for (const part of parts) part.dispose()

  // Craggy displacement: strong at the base, gentle near the walkway so the
  // top stays level enough to walk. Horizontal only, and continuous across
  // blocks (world-space noise) so the face never tears.
  const pos = merged.attributes.position
  for (let v = 0; v < pos.count; v++) {
    const x = pos.getX(v)
    const y = pos.getY(v)
    const z = pos.getZ(v)
    const crownFactor = 0.25 + 0.75 * Math.min(1, Math.max(0, 1 - (y - 4) / 14))
    pos.setX(v, x + (displaceA(x * 0.42, y * 0.42 + z) - 0.5) * 0.7 * crownFactor)
    pos.setZ(v, z + (displaceB(z * 0.42 + 40, y * 0.42 + x * 0.13) - 0.5) * 0.9 * crownFactor)
  }

  // World-space UVs (planar along the wall) — BoxGeometry's per-face 0..1
  // UVs would tile the normal map absurdly small on 0.5-unit blocks.
  const uv = merged.attributes.uv
  for (let v = 0; v < pos.count; v++) {
    uv.setXY(v, (pos.getX(v) + pos.getZ(v) * 0.6) * 0.16, pos.getY(v) * 0.16)
  }

  merged.computeVertexNormals() // smooth-shaded crags — deliberately not faceted
  return merged
}

function buildVeins(frames: SegmentFrame[], days: ContributionDay[], maxCount: number, segWidth: number): BufferGeometry | null {
  const positions: number[] = []
  const glows: number[] = []
  const forward = new Vector3()

  for (let i = 0; i < frames.length; i++) {
    const count = days[i].count
    if (count <= 0) continue
    const f = frames[i]
    const g = Math.min(1, count / maxCount)
    // South-facing strip (toward the realm), floating just off the ice.
    // Busier days hang longer, brighter veins from the crown.
    forward.set(Math.sin(f.angle), 0, Math.cos(f.angle)) // local +z after yaw
    const off = WALL_THICKNESS / 2 + 0.32
    const halfW = segWidth * 0.34
    const y1 = f.topY - 0.5
    const y0 = f.topY - 1.6 - (0.3 + 0.7 * g) * (MIN_HEIGHT + 2.5)
    const right = { x: Math.cos(f.angle) * halfW, z: -Math.sin(f.angle) * halfW }
    const cx = f.x + forward.x * off
    const cz = f.z + forward.z * off
    const quad = [
      [cx - right.x, y0, cz - right.z],
      [cx + right.x, y0, cz + right.z],
      [cx + right.x, y1, cz + right.z],
      [cx - right.x, y0, cz - right.z],
      [cx + right.x, y1, cz + right.z],
      [cx - right.x, y1, cz - right.z],
    ]
    for (const p of quad) {
      positions.push(p[0], p[1], p[2])
      glows.push(g)
    }
  }

  if (positions.length === 0) return null
  const geo = new BufferGeometry()
  geo.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geo.setAttribute('aGlow', new Float32BufferAttribute(glows, 1))
  return geo
}

export function buildWall(contributions: ContributionDay[]): WallBuild {
  // Exactly the trailing 365 days, oldest first (west to east).
  const days = contributions.slice(-WALL_DAYS)
  const maxCount = Math.max(1, ...days.map((d) => d.count))
  const segWidth = (WALL_SPAN_X * 2) / days.length

  const frames = buildFrames(days, maxCount)
  const bodyGeometry = buildBody(frames, days, maxCount, segWidth)
  const veinGeometry = buildVeins(frames, days, maxCount, segWidth)

  // Walkway rail: control point every ~8 days, held above the local crown
  // maximum so the camera can never clip into a taller neighboring block.
  const tops = frames.map((f) => f.topY)
  const railPoints: Vector3[] = []
  const railY = (i: number) => {
    let m = -Infinity
    for (let j = Math.max(0, i - 6); j <= Math.min(tops.length - 1, i + 6); j++) {
      if (tops[j] > m) m = tops[j]
    }
    return m + 0.5
  }
  for (let i = 0; i < frames.length; i += 8) {
    railPoints.push(new Vector3(frames[i].x, railY(i), frames[i].z))
  }
  const last = frames.length - 1
  railPoints.push(new Vector3(frames[last].x, railY(last), frames[last].z))

  return {
    bodyGeometry,
    veinGeometry,
    rail: new CatmullRomCurve3(railPoints, false, 'catmullrom', 0.15),
    days,
    maxCount,
  }
}
