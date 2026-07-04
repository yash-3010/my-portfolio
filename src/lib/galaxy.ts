import { Vector3 } from 'three'
import type { GalaxyData, GalaxyRepo } from '../types'
import {
  CONSTELLATIONS,
  biomeFor,
  type Biome,
  type ConstellationId,
  type ConstellationMeta,
} from './palette'
// Type-only imports flow the other way, so this is not a runtime cycle.
import { MOON_TEXTURES } from './planetSurface'

/**
 * Procedural layout: turns the GitHub snapshot into a deterministic
 * Trisolaris — a stable hierarchical triple star system. A tight G+K binary
 * whirls at the barycenter, repos orbit the pair on circumbinary Kepler
 * orbits, and a distant O-type companion loops around everything from afar.
 * All randomness is seeded from repo names so the system is stable across
 * loads and re-renders. Time is measured in YEARS on the galaxy clock.
 */

const TAU = Math.PI * 2

/* ---------------------------------------------------------------- */
/* The triple star system (solar units: masses M☉, distances AU)     */
/* ---------------------------------------------------------------- */

/** World units per astronomical unit. */
export const AU = 14

const M_A = 1.0
const M_B = 0.9
const M_C = 0.5
const M_AB = M_A + M_B
const M_OUT = M_AB + M_C

/** Binary separation — tight, so the planet region stays stable. */
const A_BIN = 0.5
/** Distant companion's orbit around the whole inner system. */
const A_OUT = 45

/** Kepler's third law in solar units: P[yr] = sqrt(a³[AU] / M[M☉]). */
const keplerPeriod = (a: number, m: number) => Math.sqrt(a ** 3 / m)

/** Orbital period around the central binary for any semi-major axis (AU) —
    the belt uses this per-rock so inner rocks lap outer ones. */
export function circumbinaryPeriod(aAU: number): number {
  return keplerPeriod(aAU, M_AB)
}

export const P_BIN = keplerPeriod(A_BIN, M_AB)
export const P_OUT = keplerPeriod(A_OUT, M_OUT)

export interface StarSpec {
  id: 'A' | 'B' | 'C'
  starType: 'G' | 'K' | 'O'
  /** Photosphere radius, world units. */
  radius: number
  /** Orbit radius around the system barycenter, world units. */
  orbitRadius: number
  /** Orbital period, years. */
  period: number
  /** Orbit angle at t=0, radians. */
  phase: number
  /** Photosphere texture in public/assets/planets/. */
  texture: string
  /** Chromosphere rim + solar-prominence plasma color (SDO 304 Å style). */
  flareColor: string
}

/** Each binary member circles the barycenter opposite the other, scaled by
    the partner's mass share. The O companion orbits everything, far out. */
export const STARS: StarSpec[] = [
  {
    id: 'A',
    starType: 'G',
    radius: 3.0,
    orbitRadius: A_BIN * (M_B / M_AB) * AU,
    period: P_BIN,
    phase: 0,
    texture: '2k_sun.jpg',
    flareColor: '#ff7a3a',
  },
  {
    id: 'B',
    starType: 'K',
    radius: 2.4,
    orbitRadius: A_BIN * (M_A / M_AB) * AU,
    period: P_BIN,
    phase: Math.PI,
    texture: '2k_sun_red.jpg',
    flareColor: '#ff4a2c',
  },
  {
    id: 'C',
    starType: 'O',
    // O-types are giants — and it has to read from 600+ units away.
    radius: 7.0,
    orbitRadius: A_OUT * AU,
    period: P_OUT,
    phase: 2.1,
    texture: '2k_sun_blue.jpg',
    flareColor: '#9cc4ff',
  },
]

/** Star C's orbit radius — the camera's zoom-out ceiling must clear it. */
export const C_ORBIT_RADIUS = A_OUT * AU

/** Asteroid belt right after the second planet slot (1.6 AU), one rock per
    all-time commit — a tight, dense inner ring. Rides one Kepler period. */
export const BELT = {
  inner: 1.8 * AU,
  outer: 2.2 * AU,
  period: keplerPeriod(2.0, M_AB),
}

/** How far the binary reaches from the barycenter (orbit + body). */
export const BINARY_EXTENT = Math.max(
  ...STARS.filter((s) => s.id !== 'C').map((s) => s.orbitRadius + s.radius),
)

/** Star position on its flat circular orbit at galaxy-time t (years). */
export function starPositionAt(s: StarSpec, t: number, out: Vector3): Vector3 {
  const angle = s.phase + (TAU * t) / s.period
  return out.set(Math.cos(angle) * s.orbitRadius, 0, Math.sin(angle) * s.orbitRadius)
}

/* ---------------------------------------------------------------- */
/* Planet slots (semi-major axis AU + circumbinary Kepler period)    */
/* ---------------------------------------------------------------- */

const PLANET_SLOTS: { a: number; per: number }[] = [
  { a: 1.1, per: 0.837 },
  { a: 1.6, per: 1.468 },
  { a: 2.4, per: 2.697 },
  { a: 3.2, per: 4.153 },
  { a: 4.2, per: 6.245 },
  { a: 6.5, per: 12.02 },
  { a: 8.4, per: 17.66 },
  { a: 10.4, per: 24.33 },
  { a: 12.5, per: 32.06 },
  { a: 14.8, per: 41.3 },
]

/** Beyond the table (11+ repos), keep stacking Kepler-consistent orbits. */
function slotFor(rank: number): { a: number; per: number } {
  const slot = PLANET_SLOTS[rank]
  if (slot) return slot
  const a = 14.8 + 2.2 * (rank - (PLANET_SLOTS.length - 1))
  return { a, per: keplerPeriod(a, M_AB) }
}

export interface MoonSpec {
  /** 'star' moons are bright specks, 'fork' moons are rocky. */
  kind: 'star' | 'fork'
  size: number
  /** Orbit radius around the planet, in world units. */
  orbitRadius: number
  /** Radians per second around the planet (wall-clock animated). */
  speed: number
  phase: number
  inclination: number
  /** Seeded pick into MOON_TEXTURES — varies the rock across a system. */
  textureIndex: number
}

export interface RingSpec {
  /** Inner/outer radius as multiples of the planet radius. */
  inner: number
  outer: number
  /** Tilt away from the orbital plane, radians. */
  tilt: number
}

export interface PlanetSpec {
  repo: GalaxyRepo
  biome: Biome
  constellation: ConstellationId
  /** Planet radius in world units (driven by commit count). */
  size: number
  /** Distance from the barycenter (driven by recency: recent = close). */
  orbitRadius: number
  /** Orbit angle at t=0, radians. */
  phase: number
  /** Circumbinary Kepler period, years — inner planets lap outer ones. */
  period: number
  /** Orbital plane tilt, radians. */
  inclination: number
  /** Pushed within ACTIVE_WINDOW_DAYS -> glows. */
  active: boolean
  /** Featured project (bigger label priority). */
  highlight: boolean
  moons: MoonSpec[]
  /** Self-rotation speed, radians per second. */
  spin: number
  /** Stable shader seed derived from the repo name. */
  seed: number
  /** Surface weathering 0..1 (repo age; 5+ years = fully weathered). */
  age: number
  /** Storm system intensity 0..1 (open issues; 12+ = full hurricane). */
  storm: number
  /** Planetary ring — worn by the most-starred repo (plus rare seeded extras). */
  ring: RingSpec | null
}

/** Unclickable filler world: keeps the system at ten planets. */
export interface DwarfSpec {
  name: string
  size: number
  orbitRadius: number
  period: number
  phase: number
  inclination: number
  /** Self-rotation speed, radians per second. */
  spin: number
}

export interface GalaxyLayout {
  planets: PlanetSpec[]
  dwarfs: DwarfSpec[]
  /** Constellations that actually contain planets. */
  constellations: ConstellationMeta[]
  minOrbitRadius: number
  maxOrbitRadius: number
  /** What the overview camera frames: the core system, not the sprawl of
      extended orbits a large repo roster stacks beyond the slot table. */
  frameRadius: number
}

const MIN_PLANET_SIZE = 0.5
const MAX_PLANET_SIZE = 1.2
const ACTIVE_WINDOW_DAYS = 60
/** Total worlds in the system: repos first, dwarf planets fill the rest. */
const SYSTEM_PLANET_COUNT = 10

export const HIGHLIGHT_REPOS = new Set([
  'my-file-crypto',
  'pdf-modifier',
  'tinypixels',
  'langchain-learn',
  'pvcon-website',
])

/* ---------------------------------------------------------------- */
/* Seeded randomness                                                 */
/* ---------------------------------------------------------------- */

function hashString(str: string): number {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** Seeded PRNG keyed by a string — for scene code outside this module. */
export function seededRng(key: string): () => number {
  return rng(hashString(key))
}

/** mulberry32 — tiny deterministic PRNG. */
function rng(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/* ---------------------------------------------------------------- */
/* Constellation classification                                      */
/* ---------------------------------------------------------------- */

const AI_PATTERN = /\b(ai|ml|llm|gpt|langchain|torch|tensor|neural|agent|rag|embedding|openai|anthropic|claude|learn(ing)?)\b/i
const TOOLS_PATTERN = /\b(cli|tool|util|script|crypto|cipher|pdf|convert(er)?|modifier|parser|automation|bot|scraper|dotfiles)\b/i
const WEB_PATTERN = /\b(web|site|website|portfolio|app|react|next|vue|svelte|rails|frontend|ui|landing|dashboard|pixels?)\b/i

export function classifyConstellation(repo: GalaxyRepo): ConstellationId {
  const haystack = [repo.name.replace(/[-_]/g, ' '), repo.description ?? '', ...repo.topics].join(' ')
  if (AI_PATTERN.test(haystack)) return 'ai'
  if (TOOLS_PATTERN.test(haystack)) return 'tools'
  if (WEB_PATTERN.test(haystack)) return 'web'
  if (repo.language === 'Python' || repo.language === 'Jupyter Notebook') return 'ai'
  if (
    repo.language === 'TypeScript' ||
    repo.language === 'JavaScript' ||
    repo.language === 'HTML' ||
    repo.language === 'CSS' ||
    repo.language === 'Ruby'
  ) {
    return 'web'
  }
  return 'tools'
}

/* ---------------------------------------------------------------- */
/* Layout                                                            */
/* ---------------------------------------------------------------- */

function daysSince(iso: string, now: number): number {
  return (now - new Date(iso).getTime()) / 86_400_000
}

function buildMoons(repo: GalaxyRepo, planetSize: number, rand: () => number): MoonSpec[] {
  // Stars and forks each contribute moons, capped so busy repos stay readable.
  const starMoons = Math.min(3, Math.ceil(Math.log2(repo.stars + 1)))
  const forkMoons = Math.min(2, Math.ceil(Math.log2(repo.forks + 1)))
  const moons: MoonSpec[] = []
  const total = starMoons + forkMoons
  for (let i = 0; i < total; i++) {
    const kind: MoonSpec['kind'] = i < starMoons ? 'star' : 'fork'
    const orbitRadius = planetSize + 0.4 + Math.min(i * 0.28 + rand() * 0.15, 1.0)
    moons.push({
      kind,
      // Tiny next to their planet — specks, not siblings.
      size: planetSize * (kind === 'star' ? 0.04 + rand() * 0.02 : 0.05 + rand() * 0.03),
      orbitRadius,
      // Kepler around the planet: speed falls off as r^-1.5, so inner moons
      // visibly lap outer ones.
      speed: 0.9 / orbitRadius ** 1.5,
      phase: rand() * TAU,
      inclination: (rand() - 0.5) * 0.9,
      textureIndex: Math.floor(rand() * MOON_TEXTURES.length),
    })
  }
  return moons
}

/** Only these languages earn a planet — everything else stays off-stage. */
const ALLOWED_LANGUAGES = new Set(['TypeScript', 'Python', 'Ruby'])

export function buildGalaxy(data: GalaxyData): GalaxyLayout {
  const now = new Date(data.fetchedAt).getTime()
  // Own repos only; skip empty husks and off-palette languages.
  const repos = data.repos.filter(
    (r) => r.commits > 0 && r.language !== null && ALLOWED_LANGUAGES.has(r.language),
  )
  const maxCommits = Math.max(1, ...repos.map((r) => r.commits))
  // The most-starred repo wears the ring (Saturn of the system).
  const maxStars = Math.max(0, ...repos.map((r) => r.stars))

  // Recency rank drives the orbit slot: most recently pushed = innermost.
  const byRecency = [...repos].sort(
    (a, b) => new Date(b.pushedAt).getTime() - new Date(a.pushedAt).getTime(),
  )
  const orbitRank = new Map(byRecency.map((r, i) => [r.name, i]))

  const grouped = new Set<ConstellationId>()
  const planets: PlanetSpec[] = []
  for (const repo of repos) {
    const constellation = classifyConstellation(repo)
    grouped.add(constellation)
    const meta = CONSTELLATIONS[constellation]
    const seedHash = hashString(repo.name)
    const rand = rng(seedHash)
    const rank = orbitRank.get(repo.name)!
    const slot = slotFor(rank)
    const sizeT = Math.sqrt(repo.commits / maxCommits)
    // Start inside the repo's constellation sector; Kepler shear spreads the
    // system out over time the way the reference does.
    const phase = meta.centerAngle + (rand() - 0.5) * meta.sectorWidth
    // Ring = most-starred repo, exactly as the legend promises. No stars in
    // the roster -> no ring anywhere. (Draw kept for seed-stream stability.)
    void rand()
    const ringed = maxStars > 0 && repo.stars === maxStars
    planets.push({
      repo,
      biome: biomeFor(repo.language),
      constellation,
      size: MIN_PLANET_SIZE + (MAX_PLANET_SIZE - MIN_PLANET_SIZE) * sizeT,
      orbitRadius: slot.a * AU,
      phase,
      period: slot.per,
      inclination: (rand() - 0.5) * 0.24,
      active: daysSince(repo.pushedAt, now) <= ACTIVE_WINDOW_DAYS,
      highlight: HIGHLIGHT_REPOS.has(repo.name),
      moons: buildMoons(repo, MIN_PLANET_SIZE + (MAX_PLANET_SIZE - MIN_PLANET_SIZE) * sizeT, rand),
      spin: 0.05 + rand() * 0.12,
      seed: (seedHash % 997) / 99.7,
      age: Math.min(1, daysSince(repo.createdAt, now) / (365 * 5)),
      storm: Math.min(1, (repo.openIssues ?? 0) / 12),
      ring: ringed
        ? {
            inner: 1.45 + rand() * 0.2,
            outer: 2.15 + rand() * 0.5,
            tilt: 0.28 + (rand() - 0.5) * 0.4,
          }
        : null,
    })
  }

  // Dwarf planets pad the roster out to a full ten-world system.
  const dwarfs: DwarfSpec[] = []
  for (let rank = repos.length; rank < SYSTEM_PLANET_COUNT; rank++) {
    const name = `dwarf-${rank + 1}`
    const rand = rng(hashString(name))
    const slot = slotFor(rank)
    dwarfs.push({
      name,
      size: 0.26 + rand() * 0.16,
      orbitRadius: slot.a * AU,
      period: slot.per,
      phase: rand() * TAU,
      inclination: (rand() - 0.5) * 0.24,
      spin: 0.05 + rand() * 0.12,
    })
  }

  const radii = [...planets, ...dwarfs].map((p) => p.orbitRadius)
  const maxOrbitRadius = radii.length ? Math.max(...radii) : PLANET_SLOTS[0].a * AU
  return {
    planets,
    dwarfs,
    constellations: [...grouped].map((id) => CONSTELLATIONS[id]),
    minOrbitRadius: radii.length ? Math.min(...radii) : PLANET_SLOTS[0].a * AU,
    maxOrbitRadius,
    frameRadius: Math.min(maxOrbitRadius, PLANET_SLOTS[PLANET_SLOTS.length - 1].a * AU),
  }
}

/* ---------------------------------------------------------------- */
/* Frame-time helpers                                                */
/* ---------------------------------------------------------------- */

/** Body position on its inclined circumbinary orbit at galaxy-time t (years). */
export function planetPositionAt(
  p: Pick<PlanetSpec, 'phase' | 'period' | 'orbitRadius' | 'inclination'>,
  t: number,
  out: Vector3,
): Vector3 {
  const angle = p.phase + (TAU * t) / p.period
  const x = Math.cos(angle) * p.orbitRadius
  const z = Math.sin(angle) * p.orbitRadius
  const y = Math.sin(angle) * p.orbitRadius * Math.sin(p.inclination)
  return out.set(x, y * 0.35, z)
}

/** Moon position relative to its planet at wall-clock time t (seconds). */
export function moonPositionAt(m: MoonSpec, t: number, out: Vector3): Vector3 {
  const angle = m.phase + m.speed * t
  const x = Math.cos(angle) * m.orbitRadius
  const z = Math.sin(angle) * m.orbitRadius
  return out.set(x, Math.sin(angle) * m.orbitRadius * Math.sin(m.inclination), z)
}
