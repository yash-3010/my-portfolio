import { Color, ShaderMaterial, Vector3 } from 'three'
import type { PlanetSpec } from './galaxy'

/**
 * Cinematic procedural planet surfaces — custom-lit by the sun at the origin
 * so every planet gets a real day/night terminator, and the surface itself is
 * generated per repo from its seed:
 *
 *   terra — oceans with sun glints, fbm continents, polar caps, and warm
 *           city lights blooming on the night side of active repos
 *   gas   — turbulent latitude bands with a great-storm vortex whose
 *           intensity tracks the repo's open issues
 *   ice   — bright glacial crust with ridged pressure cracks
 *
 * Weathering (repo age) darkens and pockmarks the surface. All noise is
 * 3D value-noise fbm over the unit sphere: zero textures, zero downloads.
 */

const STYLE_ID = { terra: 0, gas: 1, ice: 2 } as const

const VERTEX = /* glsl */ `
  varying vec3 vUnit;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;

  void main() {
    vUnit = normalize(position);
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorldPos = world.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`

const FRAGMENT = /* glsl */ `
  uniform float uSeed;
  uniform float uTime;
  uniform float uStyle;
  uniform float uAge;
  uniform float uStorm;
  uniform float uCity;
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform vec3 uGlow;
  uniform vec3 uCameraPos;

  varying vec3 vUnit;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;

  float hash(vec3 p) {
    return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
  }

  float noise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float n000 = hash(i);
    float n100 = hash(i + vec3(1.0, 0.0, 0.0));
    float n010 = hash(i + vec3(0.0, 1.0, 0.0));
    float n110 = hash(i + vec3(1.0, 1.0, 0.0));
    float n001 = hash(i + vec3(0.0, 0.0, 1.0));
    float n101 = hash(i + vec3(1.0, 0.0, 1.0));
    float n011 = hash(i + vec3(0.0, 1.0, 1.0));
    float n111 = hash(i + vec3(1.0, 1.0, 1.0));
    return mix(
      mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
      mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y),
      f.z
    );
  }

  float fbm(vec3 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
      v += a * noise(p);
      p *= 2.03;
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vec3 n = normalize(vWorldNormal);
    vec3 sunDir = normalize(-vWorldPos);            // the sun sits at origin
    vec3 viewDir = normalize(uCameraPos - vWorldPos);
    float day = dot(n, sunDir);
    float light = smoothstep(-0.12, 0.28, day);      // soft terminator
    vec3 p = vUnit + uSeed;

    vec3 albedo;
    float landMask = 1.0;
    float spec = 0.0;

    if (uStyle < 0.5) {
      /* ---- terra: oceans, continents, polar caps ---- */
      float cont = fbm(p * 2.6);
      landMask = smoothstep(0.47, 0.53, cont);
      vec3 ocean = uColorA * 0.32;
      vec3 land = mix(uColorB, uColorA * 0.85, fbm(p * 6.0) * 0.7);
      albedo = mix(ocean, land, landMask);
      // polar ice caps with a noisy edge
      float cap = smoothstep(0.68, 0.78, abs(vUnit.y) + (fbm(p * 5.0) - 0.5) * 0.12);
      albedo = mix(albedo, vec3(0.92, 0.95, 1.0), cap);
      // ocean sun glint
      vec3 r = reflect(-sunDir, n);
      spec = pow(max(dot(r, viewDir), 0.0), 70.0) * (1.0 - landMask) * (1.0 - cap) * light;
    } else if (uStyle < 1.5) {
      /* ---- gas giant: turbulent bands + great storm ---- */
      float swirl = fbm(p * vec3(2.0, 7.0, 2.0)) * 0.5;
      float band = sin((vUnit.y * 3.2 + swirl) * (5.0 + mod(uSeed, 3.0)) + uTime * 0.02) * 0.5 + 0.5;
      albedo = mix(uColorA, uColorB, band);
      albedo = mix(albedo, albedo * 1.18, fbm(p * 9.0) * 0.4);
      // great storm vortex driven by open issues
      vec3 stormCenter = normalize(vec3(cos(uSeed * 7.0), -0.28, sin(uSeed * 7.0)));
      float sd = distance(vUnit, stormCenter);
      float vortex = (1.0 - smoothstep(0.08, 0.34, sd)) * uStorm;
      float eye = (1.0 - smoothstep(0.0, 0.09, sd)) * uStorm;
      albedo = mix(albedo, uColorB * 0.55, vortex * (0.6 + 0.4 * sin(sd * 42.0 - uTime * 0.4)));
      albedo = mix(albedo, vec3(0.95, 0.9, 0.82), eye * 0.5);
    } else {
      /* ---- ice world: glacial crust + pressure cracks ---- */
      float ridged = 1.0 - abs(fbm(p * 4.5) * 2.0 - 1.0);
      float cracks = smoothstep(0.82, 0.96, ridged);
      albedo = mix(uColorA * 1.05, uColorB * 0.6, cracks);
      albedo = mix(albedo, vec3(0.9, 0.96, 1.0), fbm(p * 3.0) * 0.25);
      vec3 r2 = reflect(-sunDir, n);
      spec = pow(max(dot(r2, viewDir), 0.0), 40.0) * 0.35 * light;
    }

    // weathering: old repos get darker, pockmarked surfaces
    float pit = (1.0 - fbm(p * 11.0)) * uAge;
    albedo *= 1.0 - pit * 0.3;

    vec3 color = albedo * (0.055 + light * 1.12) + spec * vec3(1.0, 0.95, 0.85);

    // warm city lights on the night side of recently-active repos
    float night = 1.0 - smoothstep(-0.02, 0.22, day);
    float cells = step(0.982, hash(floor(vUnit * 26.0 + uSeed)));
    float cityBase = uStyle < 0.5 ? landMask : step(0.5, fbm(p * 3.0));
    color += vec3(1.0, 0.72, 0.42) * cells * cityBase * night * uCity * 2.4;

    // thin atmospheric rim
    float rim = pow(1.0 - max(dot(n, viewDir), 0.0), 2.6);
    color += uGlow * rim * (0.14 + 0.1 * light);

    gl_FragColor = vec4(color, 1.0);
  }
`

export function makePlanetSurface(spec: PlanetSpec): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uSeed: { value: spec.seed },
      uTime: { value: 0 },
      uStyle: { value: STYLE_ID[spec.biome.style] },
      uAge: { value: spec.age },
      uStorm: { value: spec.storm },
      uCity: { value: spec.active ? 1 : 0 },
      uColorA: { value: new Color(spec.biome.color) },
      uColorB: { value: new Color(spec.biome.accent) },
      uGlow: { value: new Color(spec.biome.glow) },
      uCameraPos: { value: new Vector3() },
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
  })
}
