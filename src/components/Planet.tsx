import { useEffect, useMemo, useRef } from 'react'
import { AdditiveBlending, DoubleSide, ShaderMaterial, Vector3 } from 'three'
import type { Group, Mesh } from 'three'
import { useFrame } from '@react-three/fiber'
import type { ThreeEvent } from '@react-three/fiber'
import { Html, useCursor, useTexture } from '@react-three/drei'
import type { PlanetSpec } from '../lib/galaxy'
import { moonPositionAt, planetPositionAt } from '../lib/galaxy'
import {
  MOON_TEXTURES,
  NIGHT_TEXTURE,
  RING_TEXTURE,
  configurePlanetTexture,
  makePlanetSurface,
  planetTextureUrl,
} from '../lib/planetSurface'
import { galaxyClock, planetPositions, useGalaxyStore } from '../state/store'
import { getGlowTexture } from './Sun'

const STAR_MOON_COLOR = '#ffe9b8'
/* Near-white: it tints the real lunar texture, no longer a flat color. */
const FORK_MOON_COLOR = '#cdd2da'
const DRAG_THRESHOLD_PX = 8

/** Module-level scratch vectors — never allocated in the frame loop. */
const tmpPlanet = new Vector3()
const tmpMoon = new Vector3()

/* Planetary ring: Saturn's real ring imagery, sampled radially. The source
   texture is a 2048x125 strip where x runs inner edge -> outer edge. */
const RING_VERTEX = /* glsl */ `
  varying vec2 vLocal;
  void main() {
    vLocal = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`
const RING_FRAGMENT = /* glsl */ `
  uniform sampler2D uMap;
  uniform float uInner;
  uniform float uOuter;
  varying vec2 vLocal;
  void main() {
    float r = length(vLocal);
    float t = (r - uInner) / (uOuter - uInner);
    if (t < 0.0 || t > 1.0) discard;
    vec4 tex = texture2D(uMap, vec2(t, 0.5));
    gl_FragColor = vec4(tex.rgb, tex.a * 0.9);
  }
`

export function Planet({ spec, textureFile }: { spec: PlanetSpec; textureFile: string }) {
  const name = spec.repo.name
  const biome = spec.biome
  const groupRef = useRef<Group>(null)
  const bodyRef = useRef<Mesh>(null)
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

  /* Shared texture cache: every planet reuses the same loaded instances. */
  const [dayMap, nightMap, ringMap, ...moonMaps] = useTexture(
    [
      planetTextureUrl(textureFile),
      planetTextureUrl(NIGHT_TEXTURE),
      planetTextureUrl(RING_TEXTURE),
      ...MOON_TEXTURES.map(planetTextureUrl),
    ],
    configurePlanetTexture,
  )

  /* Textured surface + ring resources. */
  const surface = useMemo(
    () => makePlanetSurface(spec, dayMap, nightMap),
    [spec, dayMap, nightMap],
  )
  const ringMaterial = useMemo(() => {
    if (!spec.ring) return null
    return new ShaderMaterial({
      uniforms: {
        uMap: { value: ringMap },
        uInner: { value: spec.ring.inner * spec.size },
        uOuter: { value: spec.ring.outer * spec.size },
      },
      vertexShader: RING_VERTEX,
      fragmentShader: RING_FRAGMENT,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
    })
  }, [spec, ringMap])

  useEffect(
    () => () => {
      surface.dispose()
      ringMaterial?.dispose()
    },
    [surface, ringMaterial],
  )

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
    <>
      <group ref={groupRef} name={`planet-${name}`}>
        {/* The planet: real imagery, custom-lit from the sun at the origin. */}
        <mesh ref={bodyRef} material={surface}>
          <sphereGeometry args={[spec.size, 48, 32]} />
        </mesh>

        {/* Planetary ring (most-starred repo wears one). */}
        {spec.ring && ringMaterial && (
          <mesh
            material={ringMaterial}
            rotation={[-Math.PI / 2 + spec.ring.tilt, 0, spec.seed]}
            raycast={() => null}
          >
            <ringGeometry
              args={[spec.ring.inner * spec.size, spec.ring.outer * spec.size, 96]}
            />
          </mesh>
        )}

        {/* Faint additive halo so recently-active repos still read from afar. */}
        {spec.active && (
          <sprite scale={spec.size * 3.2} raycast={() => null}>
            <spriteMaterial
              map={getGlowTexture()}
              color={biome.glow}
              transparent
              opacity={0.16}
              depthWrite={false}
              blending={AdditiveBlending}
            />
          </sprite>
        )}

        {/* Moons: real lunar imagery — stars tinted warm gold, forks plain rock. */}
        {spec.moons.map((moon, i) => (
          <mesh
            key={i}
            ref={(el) => {
              moonRefs.current[i] = el
            }}
            castShadow={false}
          >
            <sphereGeometry args={[moon.size, 16, 12]} />
            <meshStandardMaterial
              map={moonMaps[moon.textureIndex]}
              color={moon.kind === 'star' ? STAR_MOON_COLOR : FORK_MOON_COLOR}
              roughness={0.9}
              emissive={moon.kind === 'star' ? STAR_MOON_COLOR : '#000000'}
              emissiveIntensity={moon.kind === 'star' ? 0.22 : 0}
            />
          </mesh>
        ))}

        {/* Invisible padded hit target — R3F raycasts invisible meshes. Capped
            so it can never occlude a neighboring planet's visible body (slot
            gaps are ≥ 0.5 AU = 7 world units). */}
        <mesh
          visible={false}
          onClick={handleClick}
          onPointerOver={(e) => {
            e.stopPropagation()
            setHovered(name)
          }}
          onPointerOut={() => setHovered(null)}
        >
          <sphereGeometry args={[Math.min(Math.max(spec.size * 1.8, 1.4), 2.2), 12, 12]} />
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
              style={spec.highlight && !isHovered ? { opacity: 0.75 } : undefined}
            >
              <span className="planet-label__name">{name}</span>
              <span className="planet-label__lang" style={{ color: biome.color }}>
                {spec.repo.language ?? biome.language}
              </span>
            </div>
          </Html>
        )}
      </group>
    </>
  )
}
