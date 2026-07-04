import {
  Color,
  RepeatWrapping,
  ShaderMaterial,
  SRGBColorSpace,
  Vector3,
} from 'three'
import type { Texture } from 'three'
import type { PlanetSpec } from './galaxy'

/**
 * Real solar-system imagery (Solar System Scope, CC-BY 4.0) custom-lit by the
 * sun at the origin so every planet gets a true day/night terminator. Each
 * language biome wears the body whose palette matches it, and recently-active
 * repos bloom with Earth's real city lights on their night side.
 */

const LANGUAGE_TEXTURE: Record<string, string> = {
  TypeScript: '2k_earth_daymap.jpg',
  JavaScript: '2k_jupiter.jpg',
  Python: '2k_uranus.jpg',
  'Jupyter Notebook': '2k_venus_surface.jpg',
  HTML: '2k_mars.jpg',
  CSS: '2k_neptune.jpg',
  Go: '2k_neptune.jpg',
  Rust: '2k_venus_surface.jpg',
  Shell: '2k_mercury.jpg',
  C: '2k_mercury.jpg',
  'C++': '2k_saturn.jpg',
  Java: '2k_mars.jpg',
}
const DEFAULT_TEXTURE = '2k_neptune.jpg'

export const NIGHT_TEXTURE = '2k_earth_nightmap.jpg'
export const MOON_TEXTURE = '2k_moon.jpg'
export const RING_TEXTURE = '2k_saturn_ring_alpha.png'
export const SUN_TEXTURE = '2k_sun.jpg'

export function planetTextureUrl(file: string): string {
  return `${import.meta.env.BASE_URL}assets/planets/${file}`
}

export function dayTextureFor(spec: PlanetSpec): string {
  return LANGUAGE_TEXTURE[spec.biome.language] ?? DEFAULT_TEXTURE
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
  uniform vec3 uGlow;
  uniform vec3 uCameraPos;

  varying vec2 vUv;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;

  void main() {
    vec3 n = normalize(vWorldNormal);
    vec3 sunDir = normalize(-vWorldPos);            // the sun sits at origin
    vec3 viewDir = normalize(uCameraPos - vWorldPos);
    float day = dot(n, sunDir);
    float light = smoothstep(-0.12, 0.28, day);      // soft terminator

    vec3 albedo = texture2D(uMap, vUv).rgb;
    vec3 color = albedo * (0.05 + light * 1.15);

    // real city lights on the night side of recently-active repos
    float night = 1.0 - smoothstep(-0.05, 0.18, day);
    color += texture2D(uNightMap, vUv).rgb * night * uCity * 1.7;

    // thin atmospheric rim, tinted by the biome so the language still reads
    float rim = pow(1.0 - max(dot(n, viewDir), 0.0), 2.6);
    color += uGlow * rim * (0.12 + 0.08 * light);

    gl_FragColor = vec4(color, 1.0);
  }
`

export function makePlanetSurface(
  spec: PlanetSpec,
  map: Texture,
  nightMap: Texture,
): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uMap: { value: map },
      uNightMap: { value: nightMap },
      uCity: { value: spec.active ? 1 : 0 },
      uGlow: { value: new Color(spec.biome.glow) },
      uCameraPos: { value: new Vector3() },
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
  })
}
