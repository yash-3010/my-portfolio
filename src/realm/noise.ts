/**
 * Deterministic 2D value noise + fBm for the realm terrain.
 * Zero dependencies, seeded — the realm is identical on every visit.
 */

function hash2(ix: number, iy: number, seed: number): number {
  let h = seed ^ Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

function smootherstep(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10)
}

/** Single-octave value noise in [0, 1]. */
export function makeNoise2D(seed: number): (x: number, y: number) => number {
  return (x, y) => {
    const ix = Math.floor(x)
    const iy = Math.floor(y)
    const fx = smootherstep(x - ix)
    const fy = smootherstep(y - iy)
    const a = hash2(ix, iy, seed)
    const b = hash2(ix + 1, iy, seed)
    const c = hash2(ix, iy + 1, seed)
    const d = hash2(ix + 1, iy + 1, seed)
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy
  }
}

/** Fractal Brownian motion in [0, 1] (normalized). */
export function makeFbm2D(
  seed: number,
  octaves = 4,
  lacunarity = 2,
  gain = 0.5,
): (x: number, y: number) => number {
  const base = makeNoise2D(seed)
  let norm = 0
  let amp = 1
  for (let i = 0; i < octaves; i++) {
    norm += amp
    amp *= gain
  }
  return (x, y) => {
    let value = 0
    let amplitude = 1
    let frequency = 1
    for (let i = 0; i < octaves; i++) {
      value += base(x * frequency, y * frequency) * amplitude
      amplitude *= gain
      frequency *= lacunarity
    }
    return value / norm
  }
}

/** Ridged fBm in [0, 1] — sharp crests, good for mountain ranges. */
export function makeRidged2D(seed: number, octaves = 4): (x: number, y: number) => number {
  const fbm = makeFbm2D(seed, octaves)
  return (x, y) => {
    const v = 1 - Math.abs(fbm(x, y) * 2 - 1)
    return v * v
  }
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

export function smoothstep(edge0: number, edge1: number, v: number): number {
  const t = clamp01((v - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}
