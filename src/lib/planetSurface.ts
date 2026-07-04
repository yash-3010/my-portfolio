import { RepeatWrapping, ShaderMaterial, SRGBColorSpace } from 'three'
import type { Texture } from 'three'
import type { PlanetSpec } from './galaxy'

/**
 * Real solar-system imagery (Solar System Scope, CC-BY 4.0) custom-lit by the
 * sun at the origin so every planet gets a true day/night terminator. Each
 * language biome wears the body whose palette matches it, and recently-active
 * repos bloom with Earth's real city lights on their night side.
 */

/** Bodies dealt out to repos. Saturn is reserved for ringed planets. */
const SATURN_TEXTURE = '2k_saturn.jpg'
const TEXTURE_POOL = [
  '2k_earth_clouds.jpg',
  '2k_jupiter.jpg',
  '2k_mars.jpg',
  '2k_ceres_fictional.jpg',
  '2k_makemake_fictional.jpg',
  '2k_venus_surface.jpg',
  '2k_mercury.jpg',
]

/** Bodies whose palette suits the language, most fitting first. Only the
    three rendered languages need entries — the galaxy filters the rest. */
const LANGUAGE_AFFINITY: Record<string, string[]> = {
  TypeScript: ['2k_earth_clouds.jpg', '2k_ceres_fictional.jpg', '2k_makemake_fictional.jpg'],
  Python: ['2k_makemake_fictional.jpg', '2k_ceres_fictional.jpg', '2k_earth_clouds.jpg'],
  Ruby: ['2k_mars.jpg', '2k_venus_surface.jpg', '2k_jupiter.jpg'],
}

/**
 * Deal a body to every repo so neighboring projects look different: walk repos
 * in stable name order, give each its best-fitting body that is least used so
 * far. Ringed planets always wear Saturn. Deterministic — no Math.random.
 */
export function assignPlanetTextures(planets: PlanetSpec[]): Map<string, string> {
  const uses = new Map(TEXTURE_POOL.map((f) => [f, 0]))
  const assigned = new Map<string, string>()
  const ordered = [...planets].sort((a, b) => (a.repo.name < b.repo.name ? -1 : 1))

  // Pass 1: pinned bodies claim their look first, so no ordinary repo can
  // twin a flagship (their pick counts as used if it lives in the pool).
  for (const p of ordered) {
    if (!p.repo.pinTexture) continue
    assigned.set(p.repo.name, p.repo.pinTexture)
    const used = uses.get(p.repo.pinTexture)
    if (used !== undefined) uses.set(p.repo.pinTexture, used + 1)
  }

  // Pass 2: everyone else — ringed wears Saturn, the rest deal by affinity.
  for (const p of ordered) {
    if (assigned.has(p.repo.name)) continue
    if (p.ring) {
      assigned.set(p.repo.name, SATURN_TEXTURE)
      continue
    }
    const prefs = [...(LANGUAGE_AFFINITY[p.biome.language] ?? []), ...TEXTURE_POOL]
    const minUse = Math.min(...prefs.map((f) => uses.get(f)!))
    const pick = prefs.find((f) => uses.get(f) === minUse)!
    uses.set(pick, minUse + 1)
    assigned.set(p.repo.name, pick)
  }
  return assigned
}

export const NIGHT_TEXTURE = '2k_earth_nightmap.jpg'
export const RING_TEXTURE = '2k_saturn_ring_alpha.png'
export const SUN_TEXTURE = '2k_sun.jpg'
/** Rocky looks dealt to moons, seeded per moon in buildMoons. */
export const MOON_TEXTURES = [
  '2k_moon.jpg',
  '2k_eris_fictional.jpg',
  '2k_haumea_fictional.jpg',
]
/** Dwarf-planet imagery for the unclickable filler worlds (makemake is
    office-to-pdf's body now, so dwarfs stick to ceres/haumea). */
export const DWARF_TEXTURES = ['2k_ceres_fictional.jpg', '2k_haumea_fictional.jpg']

export function planetTextureUrl(file: string): string {
  return `${import.meta.env.BASE_URL}assets/planets/${file}`
}

/**
 * Idempotent per-texture setup — drei's useTexture hands every component the
 * same cached instance, so only flip needsUpdate on first touch. RepeatWrapping
 * on U hides the equirect seam under mip filtering.
 */
export function configurePlanetTexture(tex: Texture | Texture[]): void {
  for (const t of Array.isArray(tex) ? tex : [tex]) {
    if (t.colorSpace !== SRGBColorSpace) {
      t.colorSpace = SRGBColorSpace
      t.wrapS = RepeatWrapping
      t.anisotropy = 8
      t.needsUpdate = true
    }
  }
}

const VERTEX = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;

  void main() {
    vUv = uv;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorldPos = world.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`

const FRAGMENT = /* glsl */ `
  uniform sampler2D uMap;
  uniform sampler2D uNightMap;
  uniform float uCity;

  varying vec2 vUv;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;

  void main() {
    vec3 n = normalize(vWorldNormal);
    vec3 sunDir = normalize(-vWorldPos);            // the sun sits at origin
    float day = dot(n, sunDir);
    float light = smoothstep(-0.12, 0.28, day);      // soft terminator

    vec3 albedo = texture2D(uMap, vUv).rgb;
    vec3 color = albedo * (0.05 + light * 1.15);

    // real city lights on the night side of recently-active repos
    float night = 1.0 - smoothstep(-0.05, 0.18, day);
    color += texture2D(uNightMap, vUv).rgb * night * uCity * 1.7;

    gl_FragColor = vec4(color, 1.0);
  }
`

export function makePlanetSurface(
  spec: Pick<PlanetSpec, 'active'>,
  map: Texture,
  nightMap: Texture,
): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uMap: { value: map },
      uNightMap: { value: nightMap },
      uCity: { value: spec.active ? 1 : 0 },
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
  })
}
