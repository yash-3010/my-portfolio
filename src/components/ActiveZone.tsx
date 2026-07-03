import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { AdditiveBlending, Color, ShaderMaterial } from 'three'
import type { GalaxyLayout } from '../lib/galaxy'
import { SUN_RADIUS } from '../lib/galaxy'

/**
 * The "habitable zone" of the repo system: a soft green annulus spanning the
 * orbits of repos pushed within the active window (recency maps to orbit
 * distance, so active repos naturally band together near the sun). Breathes
 * gently on wall-clock time, like the mock's pulsing green zone.
 */

const ZONE_COLOR = '#4fc9a8'
/** World-unit padding beyond the innermost/outermost active orbit. */
const PAD = 0.9

const ZONE_VERTEX = /* glsl */ `
  varying vec2 vLocal;
  void main() {
    vLocal = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`
const ZONE_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uInner;
  uniform float uOuter;
  uniform float uTime;
  varying vec2 vLocal;
  void main() {
    float r = length(vLocal);
    float t = (r - uInner) / (uOuter - uInner);
    if (t < 0.0 || t > 1.0) discard;
    // Soft feathered band, breathing slowly.
    float band = smoothstep(0.0, 0.35, t) * (1.0 - smoothstep(0.65, 1.0, t));
    float pulse = 0.8 + 0.2 * sin(uTime * 0.9);
    gl_FragColor = vec4(uColor, band * 0.05 * pulse);
  }
`

export function ActiveZone({ layout }: { layout: GalaxyLayout }) {
  const bounds = useMemo(() => {
    const radii = layout.planets.filter((p) => p.active).map((p) => p.orbitRadius)
    if (!radii.length) return null
    return {
      inner: Math.max(SUN_RADIUS * 1.4, Math.min(...radii) - PAD),
      outer: Math.max(...radii) + PAD,
    }
  }, [layout])

  const material = useMemo(() => {
    if (!bounds) return null
    return new ShaderMaterial({
      uniforms: {
        uColor: { value: new Color(ZONE_COLOR) },
        uInner: { value: bounds.inner },
        uOuter: { value: bounds.outer },
        uTime: { value: 0 },
      },
      vertexShader: ZONE_VERTEX,
      fragmentShader: ZONE_FRAGMENT,
      blending: AdditiveBlending,
      transparent: true,
      depthWrite: false,
    })
  }, [bounds])

  useEffect(() => () => material?.dispose(), [material])

  useFrame((state) => {
    if (material) material.uniforms.uTime.value = state.clock.getElapsedTime()
  })

  if (!bounds || !material) return null
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} material={material} raycast={() => null}>
      <ringGeometry args={[bounds.inner, bounds.outer, 128]} />
    </mesh>
  )
}
