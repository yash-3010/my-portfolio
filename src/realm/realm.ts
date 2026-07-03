import { Vector3 } from 'three'
import type { GalaxyData, GalaxyRepo } from '../types'
import { biomeFor, type Biome, type ConstellationId } from '../lib/palette'
import { HIGHLIGHT_REPOS, classifyConstellation } from '../lib/galaxy'
import { rawHeightAt, wallPathZ, type FlattenSite } from './terrain'
import { REALM_SIZE } from './terrain'

/**
 * Realm layout: every repo becomes a castle in its kingdom (Phase 2 of
 * docs/realm-concept.md). Deterministic — seeded by repo names, so the
 * realm is stable across visits and rebuilds.
 */

export interface CastleSpec {
  repo: GalaxyRepo
  biome: Biome
  kingdom: ConstellationId
  /** Castle site; y is the flattened plateau height. */
  position: Vector3
  /** Terrain is flattened to the plateau within this radius. */
  plateauRadius: number
  /** Overall castle scale, driven by commit count (≈0.75..1.6). */
  scale: number
  /** Wall towers (3..5, more commits = more towers). */
  towers: number
  /** Garrison tents around the walls = stars + forks (capped). */
  tents: number
  /** Pushed within the active window -> construction scaffold + lantern. */
  active: boolean
  highlight: boolean
  /** Base rotation of the whole castle, radians. */
  rotation: number
}

export interface RealmLayout {
  castles: CastleSpec[]
  /** Sites passed to the terrain builder so plateaus get flattened. */
  sites: FlattenSite[]
}

/** Where each kingdom's castles cluster (world x/z). */
export const KINGDOM_ANCHORS: Record<ConstellationId, { x: number; z: number }> = {
  tools: { x: 0, z: -50 }, // the Frozen Reach — foothills of the ranges
  web: { x: -62, z: 42 }, // the Golden Vale
  ai: { x: 62, z: 42 }, // the Runelands
}

const HALF = REALM_SIZE / 2
const GOLDEN_ANGLE = 2.399963229728653

function hashString(str: string): number {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

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

/**
 * Find a buildable spot near the spiral-suggested position: on land, below
 * the peaks, inside the coast. Scans a small ring of offsets and keeps the
 * candidate whose raw height is closest to comfortable building ground.
 */
function findSite(cx: number, cz: number, rand: () => number): { x: number; z: number; y: number } {
  let bestX = cx
  let bestZ = cz
  let bestScore = Infinity
  for (let i = 0; i < 24; i++) {
    const r = i === 0 ? 0 : 4 + rand() * 14
    const a = rand() * Math.PI * 2
    const x = cx + Math.cos(a) * r
    const z = cz + Math.sin(a) * r
    if (Math.abs(x) > HALF * 0.62 || Math.abs(z) > HALF * 0.62) continue
    const h = rawHeightAt(x, z)
    // Ideal ground sits around h=5: dry, but well under the snowline —
    // and never on top of the Wall's line.
    const wallClearance = Math.abs(z - wallPathZ(x))
    const score =
      Math.abs(h - 5) +
      (h < 1.5 ? 10 : 0) +
      (h > 10.5 ? 10 : 0) +
      (wallClearance < 9 ? 12 : 0)
    if (score < bestScore) {
      bestScore = score
      bestX = x
      bestZ = z
    }
  }
  const y = Math.min(10.5, Math.max(2.4, rawHeightAt(bestX, bestZ)))
  return { x: bestX, z: bestZ, y }
}

export function buildRealm(data: GalaxyData): RealmLayout {
  const repos = data.repos.filter((r) => r.commits > 0)
  const maxCommits = Math.max(1, ...repos.map((r) => r.commits))

  // Group per kingdom, biggest builds closest to the kingdom's heart.
  const grouped = new Map<ConstellationId, GalaxyRepo[]>()
  for (const repo of repos) {
    const id = classifyConstellation(repo)
    const list = grouped.get(id) ?? []
    list.push(repo)
    grouped.set(id, list)
  }

  const castles: CastleSpec[] = []
  for (const [kingdom, members] of grouped) {
    const anchor = KINGDOM_ANCHORS[kingdom]
    members.sort((a, b) => b.commits - a.commits)
    members.forEach((repo, i) => {
      const rand = rng(hashString(repo.name))
      // Golden-angle spiral packs any repo count without overlaps.
      const spiralR = 12 + 13 * Math.sqrt(i)
      const spiralA = rand() * Math.PI * 2 + i * GOLDEN_ANGLE
      const site = findSite(
        anchor.x + Math.cos(spiralA) * spiralR,
        anchor.z + Math.sin(spiralA) * spiralR,
        rand,
      )
      const sizeT = Math.sqrt(repo.commits / maxCommits)
      const scale = 0.75 + sizeT * 0.85
      castles.push({
        repo,
        biome: biomeFor(repo.language),
        kingdom,
        position: new Vector3(site.x, site.y, site.z),
        plateauRadius: 6.5 * scale + 2,
        scale,
        towers: 3 + Math.round(sizeT * 2),
        tents: Math.min(7, repo.stars + repo.forks),
        active: isActive(repo, data.fetchedAt),
        highlight: HIGHLIGHT_REPOS.has(repo.name),
        rotation: rand() * Math.PI * 2,
      })
    })
  }

  return {
    castles,
    sites: castles.map((c) => ({
      x: c.position.x,
      z: c.position.z,
      y: c.position.y,
      r: c.plateauRadius,
    })),
  }
}

const ACTIVE_WINDOW_DAYS = 60

function isActive(repo: GalaxyRepo, fetchedAt: string): boolean {
  const days =
    (new Date(fetchedAt).getTime() - new Date(repo.pushedAt).getTime()) / 86_400_000
  return days <= ACTIVE_WINDOW_DAYS
}
