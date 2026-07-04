import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AdditiveBlending,
  BackSide,
  CanvasTexture,
  Color,
  ShaderMaterial,
  Vector3,
} from 'three'
import type { Group, Mesh } from 'three'
import { useFrame } from '@react-three/fiber'
import type { ThreeEvent } from '@react-three/fiber'
import { useCursor, useTexture } from '@react-three/drei'
import type { GalaxyUser } from '../types'
import { SUN } from '../lib/palette'
import { STARS, starPositionAt } from '../lib/galaxy'
import type { StarSpec } from '../lib/galaxy'
import { configurePlanetTexture, planetTextureUrl } from '../lib/planetSurface'
import { galaxyClock, useGalaxyStore } from '../state/store'

/* ---------------------------------------------------------------- */
/* Shared procedural glow texture (used by Planet active halos)      */
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
/* Chromosphere rim: a THIN emission ring hugging the limb, like the */
/* red fringe in SDO 304 Å photographs — not a wide halo.            */
/* ---------------------------------------------------------------- */

const RIM_VERTEX = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vViewDir;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vViewDir = normalize(-mvPosition.xyz);
    gl_Position = projectionMatrix * mvPosition;
  }
`
const RIM_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  varying vec3 vNormal;
  varying vec3 vViewDir;
  void main() {
    // BackSide shell: alpha peaks right at the star's limb and dies fast,
    // so the glow sits just above the surface.
    float d = abs(dot(normalize(vNormal), normalize(vViewDir)));
    float rim = pow(d, 6.0);
    gl_FragColor = vec4(uColor * 1.5, rim);
  }
`

const DRAG_THRESHOLD_PX = 8

/** Photosphere HDR push: the bloom pass bleeds each star's own color. */
const SURFACE_BOOST: [number, number, number] = [1.5, 1.5, 1.5]

/** Module-level scratch vector — never allocated in the frame loop. */
const tmpStar = new Vector3()

/**
 * One member of the triple: real photosphere imagery pushed into HDR with a
 * thin chromosphere rim hugging the limb. Every star orbits the barycenter
 * on the frozen-while-focused galaxy clock; clicking any of them opens the
 * about-me card.
 */
function Star({ spec }: { spec: StarSpec }) {
  const groupRef = useRef<Group>(null)
  const bodyRef = useRef<Mesh>(null)
  const [hovered, setHovered] = useState(false)
  const setFocus = useGalaxyStore((s) => s.setFocus)
  useCursor(hovered)

  const sunMap = useTexture(planetTextureUrl(spec.texture), configurePlanetTexture)

  const rimMaterial = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: { uColor: { value: new Color(spec.flareColor) } },
        vertexShader: RIM_VERTEX,
        fragmentShader: RIM_FRAGMENT,
        blending: AdditiveBlending,
        transparent: true,
        depthWrite: false,
        side: BackSide,
      }),
    [spec.flareColor],
  )
  useEffect(() => () => rimMaterial.dispose(), [rimMaterial])

  useFrame((state) => {
    const group = groupRef.current
    if (group) {
      // Orbital motion runs on the freezable galaxy clock (years).
      starPositionAt(spec, galaxyClock.t, tmpStar)
      group.position.copy(tmpStar)
    }
    // Slow self-rotation stays alive on wall-clock time while frozen.
    const t = state.clock.getElapsedTime()
    const core = bodyRef.current
    if (core) {
      core.rotation.y = t * 0.06
      core.scale.setScalar(1 + Math.sin(t * 1.1 + spec.phase) * 0.012)
    }
  })

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    // R3F tracks pointer travel since pointerdown; big delta = drag, not a tap.
    if (e.delta > DRAG_THRESHOLD_PX) return
    // Carry the star id so the camera frames THIS star (matters for C).
    setFocus({ kind: 'sun', star: spec.id })
  }

  return (
    <group ref={groupRef} name={`star-${spec.id}`}>
      <mesh
        ref={bodyRef}
        onClick={handleClick}
        onPointerOver={(e) => {
          e.stopPropagation()
          setHovered(true)
        }}
        onPointerOut={() => setHovered(false)}
      >
        <sphereGeometry args={[spec.radius, 48, 32]} />
        {/* Photosphere pushed past the bloom threshold: the composer bleeds
            each star's own color over its limb (fog off so the distant O
            companion stays a visible beacon). */}
        <meshBasicMaterial map={sunMap} color={SURFACE_BOOST} fog={false} />
      </mesh>

      {/* Thin chromosphere rim, just above the surface. */}
      <mesh scale={1.08} material={rimMaterial} raycast={() => null}>
        <sphereGeometry args={[spec.radius, 48, 32]} />
      </mesh>
    </group>
  )
}

export function Sun({ user }: { user: GalaxyUser }) {
  return (
    <group name={`trisolaris-${user.login}`}>
      {/* The scene's key light sits at the barycenter — the tight binary
          whirls around it so closely that one light stands in for both. */}
      <pointLight color={SUN.light} intensity={3000} decay={1.5} />
      {STARS.map((spec) => (
        <Star key={spec.id} spec={spec} />
      ))}
    </group>
  )
}
