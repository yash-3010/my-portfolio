import { Vector3 } from 'three'
import type { GalaxyData, GalaxyRepo } from '../types'
import {
  CONSTELLATIONS,
  biomeFor,
  type Biome,
  type ConstellationId,
  type ConstellationMeta,
} from './palette'

/**
 * Procedural layout: turns the GitHub snapshot into a deterministic galaxy.
 * All randomness is seeded from repo names so the galaxy is stable across
 * loads and re-renders.
 */

export interface MoonSpec {
  /** 'star' moons are bright specks, 'fork' moons are rocky. */
  kind: 'star' | 'fork'
  size: number
  /** Orbit radius around the planet, in world units. */
  orbitRadius: number
  /** Radians per second around the planet. */
  speed: number
  phase: number
  inclination: number
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
  /** Distance from the sun (driven by recency: recent = close). */
  orbitRadius: number
  /** Orbit angle at t=0, radians. */
  phase: number
  /** Radians per second. Near-uniform so constellations stay clustered. */
  speed: number
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

export interface GalaxyLayout {
  planets: PlanetSpec[]
  /** Constellations that actually contain planets. */
  constellations: ConstellationMeta[]
  minOrbitRadius: number
  maxOrbitRadius: number
}

export const SUN_RADIUS = 2.4
const MIN_PLANET_SIZE = 0.55
const MAX_PLANET_SIZE = 1.55
const FIRST_ORBIT = SUN_RADIUS + 4.2
const ORBIT_GAP = 2.6
/** Radial span cap so 100 live repos don't outgrow the lights/fog/frustum. */
const MAX_ORBIT_SPAN = 36
/** Rigid-body rotation keeps constellation clusters coherent. */
const BASE_ORBIT_SPEED = 0.02
const ACTIVE_WINDOW_DAYS = 60

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
const WEB_PATTERN = /\b(web|site|website|portfolio|app|react|next|vue|svelte|frontend|ui|landing|dashboard|pixels?)\b/i

export function classifyConstellation(repo: GalaxyRepo): ConstellationId {
  const haystack = [repo.name.replace(/[-_]/g, ' '), repo.description ?? '', ...repo.topics].join(' ')
  if (AI_PATTERN.test(haystack)) return 'ai'
  if (TOOLS_PATTERN.test(haystack)) return 'tools'
  if (WEB_PATTERN.test(haystack)) return 'web'
  if (repo.language === 'Python' || repo.language === 'Jupyter Notebook') return 'ai'
  if (repo.language === 'TypeScript' || repo.language === 'JavaScript' || repo.language === 'HTML' || repo.language === 'CSS') {
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
    moons.push({
      kind,
      size: planetSize * (kind === 'star' ? 0.1 + rand() * 0.06 : 0.14 + rand() * 0.08),
      // Kept within ~1 unit of the surface so neighboring repos' moon systems
      // never interpenetrate (ring gap can shrink to ~1.8 with jitter).
      orbitRadius: planetSize + 0.4 + Math.min(i * 0.28 + rand() * 0.15, 1.0),
      speed: 0.35 + rand() * 0.5,
      phase: rand() * Math.PI * 2,
      inclination: (rand() - 0.5) * 0.9,
    })
  }
  return moons
}

export function buildGalaxy(data: GalaxyData): GalaxyLayout {
  const now = new Date(data.fetchedAt).getTime()
  // Own repos only; skip empty husks with no commits.
  const repos = data.repos.filter((r) => r.commits > 0)
  const maxCommits = Math.max(1, ...repos.map((r) => r.commits))
  // The most-starred repo wears the ring (Saturn of the system).
  const maxStars = Math.max(0, ...repos.map((r) => r.stars))

  // Recency rank drives orbit distance: most recently pushed = innermost.
  const byRecency = [...repos].sort(
    (a, b) => new Date(b.pushedAt).getTime() - new Date(a.pushedAt).getTime(),
  )
  const orbitRank = new Map(byRecency.map((r, i) => [r.name, i]))

  // Per-constellation angular slots so clusters read as constellations.
  const grouped = new Map<ConstellationId, GalaxyRepo[]>()
  for (const repo of repos) {
    const id = classifyConstellation(repo)
    const list = grouped.get(id) ?? []
    list.push(repo)
    grouped.set(id, list)
  }

  // Linear ring spacing for small galaxies; compressed once the span would
  // outgrow what the lighting, fog, and camera limits are tuned for.
  const span = Math.min(ORBIT_GAP * Math.max(1, repos.length - 1), MAX_ORBIT_SPAN)

  const planets: PlanetSpec[] = []
  for (const [constellation, members] of grouped) {
    const meta = CONSTELLATIONS[constellation]
    members.sort((a, b) => (orbitRank.get(a.name)! - orbitRank.get(b.name)!))
    members.forEach((repo, slot) => {
      const seedHash = hashString(repo.name)
      const rand = rng(seedHash)
      const rank = orbitRank.get(repo.name)!
      const rankT = repos.length > 1 ? rank / (repos.length - 1) : 0
      const sizeT = Math.sqrt(repo.commits / maxCommits)
      const size = MIN_PLANET_SIZE + (MAX_PLANET_SIZE - MIN_PLANET_SIZE) * sizeT
      // Spread members across the sector; jitter keeps it organic.
      const slotT = members.length === 1 ? 0.5 : slot / (members.length - 1)
      const phase =
        meta.centerAngle + (slotT - 0.5) * meta.sectorWidth + (rand() - 0.5) * 0.22
      // Drawn unconditionally so a star-count change can't reshuffle the layout.
      const ringRoll = rand()
      const ringed = (maxStars > 0 && repo.stars === maxStars) || ringRoll < 0.08
      planets.push({
        repo,
        biome: biomeFor(repo.language),
        constellation,
        size,
        orbitRadius: FIRST_ORBIT + rankT * span + (rand() - 0.5) * 0.8,
        phase,
        // Identical angular velocity for every planet: the disc rotates as a
        // rigid body, so constellation clusters never drift apart.
        speed: BASE_ORBIT_SPEED,
        inclination: (rand() - 0.5) * 0.24,
        active: daysSince(repo.pushedAt, now) <= ACTIVE_WINDOW_DAYS,
        highlight: HIGHLIGHT_REPOS.has(repo.name),
        moons: buildMoons(repo, size, rand),
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
    })
  }

  const radii = planets.map((p) => p.orbitRadius)
  return {
    planets,
    constellations: [...grouped.keys()].map((id) => CONSTELLATIONS[id]),
    minOrbitRadius: planets.length ? Math.min(...radii) : FIRST_ORBIT,
    maxOrbitRadius: planets.length ? Math.max(...radii) : FIRST_ORBIT,
  }
}

/* ---------------------------------------------------------------- */
/* Frame-time helpers                                                */
/* ---------------------------------------------------------------- */

/** Planet position on its inclined circular orbit at galaxy-time t (seconds). */
export function planetPositionAt(p: PlanetSpec, t: number, out: Vector3): Vector3 {
  const angle = p.phase + p.speed * t
  const x = Math.cos(angle) * p.orbitRadius
  const z = Math.sin(angle) * p.orbitRadius
  const y = Math.sin(angle) * p.orbitRadius * Math.sin(p.inclination)
  return out.set(x, y * 0.35, z)
}

/** Moon position relative to its planet at galaxy-time t. */
export function moonPositionAt(m: MoonSpec, t: number, out: Vector3): Vector3 {
  const angle = m.phase + m.speed * t
  const x = Math.cos(angle) * m.orbitRadius
  const z = Math.sin(angle) * m.orbitRadius
  return out.set(x, Math.sin(angle) * m.orbitRadius * Math.sin(m.inclination), z)
}

/* ---------------------------------------------------------------- */
/* Contribution statistics                                           */
/* ---------------------------------------------------------------- */

/** Longest run of consecutive days with commits (drives the comet). */
export function longestStreak(days: { count: number }[]): number {
  let best = 0
  let run = 0
  for (const day of days) {
    run = day.count > 0 ? run + 1 : 0
    if (run > best) best = run
  }
  return best
}

/** Total commits across all rendered repos (drives the asteroid belt). */
export function totalCommits(layout: GalaxyLayout): number {
  return layout.planets.reduce((sum, p) => sum + p.repo.commits, 0)
}
