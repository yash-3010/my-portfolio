import { useRef, useState } from 'react'
import { AdditiveBlending, CanvasTexture } from 'three'
import type { Mesh, SpriteMaterial } from 'three'
import { useFrame } from '@react-three/fiber'
import type { ThreeEvent } from '@react-three/fiber'
import { Sparkles, useCursor } from '@react-three/drei'
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
/* Sun                                                               */
/* ---------------------------------------------------------------- */

const DRAG_THRESHOLD_PX = 8

export function Sun({ user }: { user: GalaxyUser }) {
  const coreRef = useRef<Mesh>(null)
  const glowMatRef = useRef<SpriteMaterial>(null)
  const downRef = useRef({ x: 0, y: 0 })
  const [hovered, setHovered] = useState(false)
  const setFocus = useGalaxyStore((s) => s.setFocus)
  useCursor(hovered)

  useFrame((state) => {
    const t = state.clock.getElapsedTime()
    const core = coreRef.current
    if (core) {
      core.rotation.y = t * 0.06
      core.rotation.x = Math.sin(t * 0.11) * 0.08
      core.scale.setScalar(1 + Math.sin(t * 1.1) * 0.015)
    }
    const glow = glowMatRef.current
    if (glow) glow.opacity = 0.72 + Math.sin(t * 1.5) * 0.07
  })

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    downRef.current.x = e.clientX
    downRef.current.y = e.clientY
  }

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    const moved = Math.hypot(
      e.clientX - downRef.current.x,
      e.clientY - downRef.current.y,
    )
    if (moved > DRAG_THRESHOLD_PX) return
    setFocus({ kind: 'sun' })
  }

  return (
    <group name={`sun-${user.login}`}>
      {/* The scene's key light lives at the sun's core. */}
      <pointLight color={SUN.light} intensity={340} decay={1.7} />

      <mesh
        ref={coreRef}
        onPointerDown={handlePointerDown}
        onClick={handleClick}
        onPointerOver={(e) => {
          e.stopPropagation()
          setHovered(true)
        }}
        onPointerOut={() => setHovered(false)}
      >
        <icosahedronGeometry args={[SUN_RADIUS, 2]} />
        <meshStandardMaterial
          color={SUN.core}
          emissive={SUN.core}
          emissiveIntensity={1.6}
          flatShading
          roughness={0.6}
        />
      </mesh>

      {/* Additive halo. */}
      <sprite scale={7}>
        <spriteMaterial
          ref={glowMatRef}
          map={getGlowTexture()}
          color={SUN.glow}
          transparent
          opacity={0.72}
          depthWrite={false}
          blending={AdditiveBlending}
        />
      </sprite>

      <Sparkles
        count={36}
        scale={7.5}
        size={3}
        speed={0.35}
        color={SUN.core}
        opacity={0.7}
      />
    </group>
  )
}
