import { useEffect, useRef } from 'react'
import { AdditiveBlending, Vector3 } from 'three'
import type { Group, Mesh, MeshStandardMaterial } from 'three'
import { useFrame } from '@react-three/fiber'
import type { ThreeEvent } from '@react-three/fiber'
import { Html, useCursor } from '@react-three/drei'
import type { PlanetSpec } from '../lib/galaxy'
import { moonPositionAt, planetPositionAt } from '../lib/galaxy'
import { galaxyClock, planetPositions, useGalaxyStore } from '../state/store'
import { getGlowTexture } from './Sun'

const STAR_MOON_COLOR = '#ffe9b8'
const FORK_MOON_COLOR = '#9aa3b2'
const DRAG_THRESHOLD_PX = 8

/** Module-level scratch vectors — never allocated in the frame loop. */
const tmpPlanet = new Vector3()
const tmpMoon = new Vector3()

export function Planet({ spec }: { spec: PlanetSpec }) {
  const name = spec.repo.name
  const biome = spec.biome
  const groupRef = useRef<Group>(null)
  const bodyRef = useRef<Mesh>(null)
  const coreRef = useRef<Mesh>(null)
  const bodyMatRef = useRef<MeshStandardMaterial>(null)
  const moonRefs = useRef<(Mesh | null)[]>([])

  // Persistent world-position vector shared with the camera rig via the store map.
  const worldPosRef = useRef<Vector3 | null>(null)
  if (!worldPosRef.current) worldPosRef.current = new Vector3()

  const hovered = useGalaxyStore((s) => s.hovered)
  const focus = useGalaxyStore((s) => s.focus)
  const setHovered = useGalaxyStore((s) => s.setHovered)
  const setFocus = useGalaxyStore((s) => s.setFocus)

  const isHovered = hovered === name
  const isFocused = focus?.kind === 'planet' && focus.name === name
  const showLabel = (isHovered || spec.highlight) && !isFocused
  useCursor(isHovered)

  useEffect(() => {
    const v = worldPosRef.current!
    planetPositionAt(spec, galaxyClock.t, v)
    planetPositions.set(name, v)
    return () => {
      planetPositions.delete(name)
    }
  }, [name, spec])

  useFrame((state) => {
    const group = groupRef.current
    if (!group) return

    // Orbital position runs on the freezable galaxy clock.
    planetPositionAt(spec, galaxyClock.t, tmpPlanet)
    group.position.copy(tmpPlanet)
    worldPosRef.current!.copy(tmpPlanet)

    // Everything else stays alive on wall-clock time while frozen.
    const et = state.clock.getElapsedTime()
    if (bodyRef.current) bodyRef.current.rotation.y = et * spec.spin
    const core = coreRef.current
    if (core) {
      core.rotation.y = -et * spec.spin * 0.6
      core.rotation.x = et * spec.spin * 0.35
    }
    if (spec.active && bodyMatRef.current) {
      bodyMatRef.current.emissiveIntensity =
        0.55 + Math.sin(et * 1.4 + spec.phase) * 0.18
    }
    for (let i = 0; i < spec.moons.length; i++) {
      const mesh = moonRefs.current[i]
      const moon = spec.moons[i]
      if (!mesh || !moon) continue
      moonPositionAt(moon, et, tmpMoon)
      mesh.position.copy(tmpMoon)
    }
  })

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    // R3F tracks pointer travel since pointerdown; big delta = drag, not a tap.
    if (e.delta > DRAG_THRESHOLD_PX) return
    setFocus({ kind: 'planet', name })
  }

  return (
    <group ref={groupRef} name={`planet-${name}`}>
      {/* Outer shell: primary biome surface. */}
      <mesh ref={bodyRef}>
        <icosahedronGeometry args={[spec.size, 1]} />
        <meshStandardMaterial
          ref={bodyMatRef}
          color={biome.color}
          flatShading
          roughness={0.85}
          emissive={spec.active ? biome.glow : biome.color}
          emissiveIntensity={spec.active ? 0.55 : 0.08}
        />
      </mesh>

      {/* Inner accent core, counter-rotating: its vertices pierce the shell's
          faces, reading as low-poly continents / terrain relief. */}
      <mesh ref={coreRef} rotation={[0.7, 0.3, 0.5]}>
        <icosahedronGeometry args={[spec.size * 0.92, 1]} />
        <meshStandardMaterial
          color={biome.accent}
          flatShading
          roughness={0.95}
          emissive={biome.accent}
          emissiveIntensity={0.05}
        />
      </mesh>

      {/* Additive halo for recently-active repos. */}
      {spec.active && (
        <sprite scale={spec.size * 4}>
          <spriteMaterial
            map={getGlowTexture()}
            color={biome.glow}
            transparent
            opacity={0.35}
            depthWrite={false}
            blending={AdditiveBlending}
          />
        </sprite>
      )}

      {/* Moons: stars are pale gold specks, forks are grey rocks. */}
      {spec.moons.map((moon, i) => (
        <mesh
          key={i}
          ref={(el) => {
            moonRefs.current[i] = el
          }}
        >
          <icosahedronGeometry args={[moon.size, 0]} />
          <meshStandardMaterial
            color={moon.kind === 'star' ? STAR_MOON_COLOR : FORK_MOON_COLOR}
            flatShading
            roughness={0.9}
            emissive={moon.kind === 'star' ? STAR_MOON_COLOR : '#000000'}
            emissiveIntensity={moon.kind === 'star' ? 0.45 : 0}
          />
        </mesh>
      ))}

      {/* Invisible padded hit target — R3F raycasts invisible meshes. Capped
          so it can never occlude a neighboring planet's visible body. */}
      <mesh
        visible={false}
        onClick={handleClick}
        onPointerOver={(e) => {
          e.stopPropagation()
          setHovered(name)
        }}
        onPointerOut={() => setHovered(null)}
      >
        <sphereGeometry args={[Math.min(Math.max(spec.size * 1.6, 1.0), 1.2), 12, 12]} />
      </mesh>

      {showLabel && (
        <Html
          position={[0, spec.size + 0.9, 0]}
          center
          distanceFactor={16}
          // Keep labels below the 2D overlay layer (loading z=100, card z=20).
          zIndexRange={[8, 0]}
          style={{ pointerEvents: 'none' }}
        >
          <div
            className="planet-label"
            style={
              spec.highlight && !isHovered ? { opacity: 0.75 } : undefined
            }
          >
            <span className="planet-label__name">{name}</span>
            <span className="planet-label__lang" style={{ color: biome.color }}>
              {spec.repo.language ?? biome.language}
            </span>
          </div>
        </Html>
      )}
    </group>
  )
}
