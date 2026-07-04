import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  ShaderMaterial,
} from 'three'
import type { ContributionDay } from '../types'

/**
 * The contribution band: the last 365 days wrapped 360° around the scene as
 * a milky-way-like ring at ~`radius`. The rest of the sky is the photographic
 * panorama (Skybox) — no procedural filler stars. Fully deterministic (seeded
 * PRNG), twinkles on wall-clock time so the sky stays alive even when the
 * galaxy clock is frozen.
 */

const BAND_SEED = 0x5eedf00d

/** Contribution stars encode a "strong twinkle" flag by offsetting phase +10. */
const TWINKLE_FLAG = 10.0

/** Deterministic PRNG — never Math.random. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const VERTEX_SHADER = /* glsl */ `
  uniform float uTime;
  uniform float uScale;
  uniform float uMaxSize;
  attribute vec3 aColor;
  attribute float aSize;
  attribute float aTwinkle;
  varying vec3 vColor;

  void main() {
    vColor = aColor;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    // Contribution stars carry a +10 phase offset -> stronger amplitude.
    float strong = step(${TWINKLE_FLAG.toFixed(1)}, aTwinkle);
    float phase = aTwinkle - strong * ${TWINKLE_FLAG.toFixed(1)};
    float amp = mix(0.18, 0.30, strong);
    float twinkle = (1.0 - amp) + amp * sin(uTime * 1.4 + phase);
    // uScale carries viewport height * dpr so apparent size is device-independent.
    float size = aSize * (uScale / -mvPosition.z) * twinkle;
    gl_PointSize = clamp(size, 1.0, uMaxSize);
    gl_Position = projectionMatrix * mvPosition;
  }
`

const FRAGMENT_SHADER = /* glsl */ `
  varying vec3 vColor;

  void main() {
    float d = length(gl_PointCoord - vec2(0.5));
    float alpha = 1.0 - smoothstep(0.12, 0.5, d);
    if (alpha <= 0.001) discard;
    gl_FragColor = vec4(vColor * alpha, alpha);
  }
`

interface StarBuffers {
  positions: Float32Array
  colors: Float32Array
  sizes: Float32Array
  twinkles: Float32Array
}

function weekdayOf(date: string, fallback: number): number {
  const ms = Date.parse(`${date}T00:00:00Z`)
  if (Number.isNaN(ms)) return fallback % 7
  return new Date(ms).getUTCDay()
}

function buildBuffers(contributions: ContributionDay[], radius: number): StarBuffers {
  const bandCount = contributions.length

  const positions = new Float32Array(bandCount * 3)
  const colors = new Float32Array(bandCount * 3)
  const sizes = new Float32Array(bandCount)
  const twinkles = new Float32Array(bandCount)

  const color = new Color()
  const dim = new Color('#26304d')
  const bright = new Color('#e8f1ff')
  const cyan = new Color('#9fe8ff')
  const mixed = new Color()

  let maxCount = 1
  for (const day of contributions) {
    if (day.count > maxCount) maxCount = day.count
  }

  // --- Contribution band -------------------------------------------------
  for (let i = 0; i < bandCount; i++) {
    const day = contributions[i]
    const rnd = mulberry32(BAND_SEED + i)

    const lon = (i / bandCount) * Math.PI * 2
    // Weekday spreads the band into a ribbon (±~0.16 rad) + seeded jitter.
    const weekday = weekdayOf(day.date, i)
    const lat = ((weekday - 3) / 3) * 0.16 + (rnd() - 0.5) * 0.07
    const r = radius * (1 + (rnd() - 0.5) * 0.08)

    const cosLat = Math.cos(lat)
    positions[i * 3] = Math.cos(lon) * cosLat * r
    positions[i * 3 + 1] = Math.sin(lat) * r
    positions[i * 3 + 2] = Math.sin(lon) * cosLat * r

    const t = Math.sqrt(Math.min(day.count, maxCount) / maxCount)
    mixed.copy(bright).lerp(cyan, 0.2 + rnd() * 0.35)
    color.copy(dim).lerp(mixed, t)

    colors[i * 3] = color.r
    colors[i * 3 + 1] = color.g
    colors[i * 3 + 2] = color.b
    sizes[i] = 1.4 + t * 2.8
    twinkles[i] = rnd() * Math.PI * 2 + TWINKLE_FLAG
  }

  return { positions, colors, sizes, twinkles }
}

/** No-op raycast so stars never intercept planet clicks. */
const noRaycast = () => null

export function Starfield({
  contributions,
  radius,
}: {
  contributions: ContributionDay[]
  radius: number
}) {
  const geometry = useMemo(() => {
    const { positions, colors, sizes, twinkles } = buildBuffers(contributions, radius)
    const geo = new BufferGeometry()
    geo.setAttribute('position', new Float32BufferAttribute(positions, 3))
    geo.setAttribute('aColor', new Float32BufferAttribute(colors, 3))
    geo.setAttribute('aSize', new Float32BufferAttribute(sizes, 1))
    geo.setAttribute('aTwinkle', new Float32BufferAttribute(twinkles, 1))
    return geo
  }, [contributions, radius])

  const material = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uScale: { value: 280 },
          uMaxSize: { value: 24 },
        },
        vertexShader: VERTEX_SHADER,
        fragmentShader: FRAGMENT_SHADER,
        blending: AdditiveBlending,
        transparent: true,
        depthWrite: false,
      }),
    [],
  )

  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => () => material.dispose(), [material])

  useFrame((state) => {
    // Wall-clock time (NOT galaxyClock): stars twinkle even when frozen.
    material.uniforms.uTime.value = state.clock.getElapsedTime()
    // Device-independent star sizes: scale with framebuffer height (280 was
    // tuned against a 900px-tall dpr-1 viewport).
    const dpr = state.viewport.dpr
    material.uniforms.uScale.value = (state.size.height * dpr * 280) / 900
    material.uniforms.uMaxSize.value = 24 * dpr
  })

  return (
    <points
      geometry={geometry}
      material={material}
      frustumCulled={false}
      raycast={noRaycast}
      renderOrder={-1}
    />
  )
}
