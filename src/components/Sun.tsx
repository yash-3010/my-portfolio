import { useMemo, useRef, useState } from 'react'
import {
  AdditiveBlending,
  BackSide,
  CanvasTexture,
  Color,
  ShaderMaterial,
} from 'three'
import type { Mesh, SpriteMaterial } from 'three'
import { useFrame } from '@react-three/fiber'
import type { ThreeEvent } from '@react-three/fiber'
import { useCursor } from '@react-three/drei'
import type { GalaxyUser } from '../types'
import { SUN } from '../lib/palette'
import { SUN_RADIUS } from '../lib/galaxy'
import { useGalaxyStore } from '../state/store'

/* ---------------------------------------------------------------- */
/* Shared procedural glow texture (also used by Planet glow sprites) */
/* ---------------------------------------------------------------- */

let glowTexture: CanvasTexture | null = null

/** Lazy singleton: soft white radial gradient, tinted per-use via material color. */
export function getGlowTexture(): CanvasTexture {
  if (glowTexture) return glowTexture
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const gradient = ctx.createRadialGradient(
    size / 2, size / 2, 0,
    size / 2, size / 2, size / 2,
  )
  gradient.addColorStop(0, 'rgba(255,255,255,1)')
  gradient.addColorStop(0.2, 'rgba(255,255,255,0.6)')
  gradient.addColorStop(0.5, 'rgba(255,255,255,0.18)')
  gradient.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, size, size)
  glowTexture = new CanvasTexture(canvas)
  return glowTexture
}

/* ---------------------------------------------------------------- */
/* Fresnel atmosphere: additive rim shell so the sun reads as a      */
/* ball of light instead of a flat emissive disc.                    */
/* ---------------------------------------------------------------- */

const ATMOSPHERE_VERTEX = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vViewDir;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vViewDir = normalize(-mvPosition.xyz);
    gl_Position = projectionMatrix * mvPosition;
  }
`

const ATMOSPHERE_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  varying vec3 vNormal;
  varying vec3 vViewDir;
  void main() {
    // BackSide shell: strongest where the surface silhouettes against space.
    float rim = pow(1.0 - abs(dot(normalize(vNormal), normalize(vViewDir))), 2.4);
    gl_FragColor = vec4(uColor, rim * 0.85);
  }
`

const DRAG_THRESHOLD_PX = 8

export function Sun({ user }: { user: GalaxyUser }) {
  const coreRef = useRef<Mesh>(null)
  const glowMatRef = useRef<SpriteMaterial>(null)
  const [hovered, setHovered] = useState(false)
  const setFocus = useGalaxyStore((s) => s.setFocus)
  useCursor(hovered)

  const atmosphereMaterial = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: { uColor: { value: new Color(SUN.glow) } },
        vertexShader: ATMOSPHERE_VERTEX,
        fragmentShader: ATMOSPHERE_FRAGMENT,
        blending: AdditiveBlending,
        transparent: true,
        depthWrite: false,
        side: BackSide,
      }),
    [],
  )

  useFrame((state) => {
    const t = state.clock.getElapsedTime()
    const core = coreRef.current
    if (core) {
      core.rotation.y = t * 0.06
      core.rotation.x = Math.sin(t * 0.11) * 0.08
      core.scale.setScalar(1 + Math.sin(t * 1.1) * 0.015)
    }
    const glow = glowMatRef.current
    if (glow) glow.opacity = 0.5 + Math.sin(t * 1.5) * 0.06
  })

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    // R3F tracks pointer travel since pointerdown; big delta = drag, not a tap.
    if (e.delta > DRAG_THRESHOLD_PX) return
    setFocus({ kind: 'sun' })
  }

  return (
    <group name={`sun-${user.login}`}>
      {/* The scene's key light lives at the sun's core. Decay is kept gentle
          so the outermost orbit ring still receives real light. */}
      <pointLight color={SUN.light} intensity={300} decay={1.5} />

      <mesh
        ref={coreRef}
        onClick={handleClick}
        onPointerOver={(e) => {
          e.stopPropagation()
          setHovered(true)
        }}
        onPointerOut={() => setHovered(false)}
      >
        <icosahedronGeometry args={[SUN_RADIUS, 2]} />
        {/* Emissive pushed past the bloom threshold: the composer supplies the
            light bleed, the facets keep visible tonal variation. */}
        <meshStandardMaterial
          color="#ffb45e"
          emissive={SUN.core}
          emissiveIntensity={1.15}
          flatShading
          roughness={0.6}
        />
      </mesh>

      {/* Fresnel rim shell. */}
      <mesh scale={1.28} material={atmosphereMaterial} raycast={() => null}>
        <icosahedronGeometry args={[SUN_RADIUS, 3]} />
      </mesh>

      {/* Additive halo. */}
      <sprite scale={7} raycast={() => null}>
        <spriteMaterial
          ref={glowMatRef}
          map={getGlowTexture()}
          color={SUN.glow}
          transparent
          opacity={0.5}
          depthWrite={false}
          blending={AdditiveBlending}
        />
      </sprite>
    </group>
  )
}
