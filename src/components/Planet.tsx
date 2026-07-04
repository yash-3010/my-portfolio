import { useEffect, useMemo, useRef } from 'react'
import {
  AdditiveBlending,
  BackSide,
  Color,
  DoubleSide,
  ShaderMaterial,
  Vector3,
} from 'three'
import type { Group, Mesh } from 'three'
import { useFrame } from '@react-three/fiber'
import type { ThreeEvent } from '@react-three/fiber'
import { Html, useCursor } from '@react-three/drei'
import type { PlanetSpec } from '../lib/galaxy'
import { moonPositionAt, planetPositionAt } from '../lib/galaxy'
import { makePlanetSurface } from '../lib/planetSurface'
import { galaxyClock, planetPositions, useGalaxyStore } from '../state/store'
import { getGlowTexture } from './Sun'

const STAR_MOON_COLOR = '#ffe9b8'
const FORK_MOON_COLOR = '#9aa3b2'
const DRAG_THRESHOLD_PX = 8

/** Module-level scratch vectors — never allocated in the frame loop. */
const tmpPlanet = new Vector3()
const tmpMoon = new Vector3()

/* Fresnel atmosphere shell (shared shader, tinted per planet). */
const ATMO_VERTEX = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vViewDir;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vViewDir = normalize(-mvPosition.xyz);
    gl_Position = projectionMatrix * mvPosition;
  }
`
const ATMO_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uStrength;
  varying vec3 vNormal;
  varying vec3 vViewDir;
  void main() {
    float rim = pow(1.0 - abs(dot(normalize(vNormal), normalize(vViewDir))), 2.8);
    gl_FragColor = vec4(uColor, rim * uStrength);
  }
`

/* Planetary ring: banded annulus with a Cassini-style gap, seeded per repo. */
const RING_VERTEX = /* glsl */ `
  varying vec2 vLocal;
  void main() {
    vLocal = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`
const RING_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uInner;
  uniform float uOuter;
  uniform float uSeed;
  varying vec2 vLocal;
  void main() {
    float r = length(vLocal);
    float t = (r - uInner) / (uOuter - uInner);
    if (t < 0.0 || t > 1.0) discard;
    // Layered radial banding, phase-shifted by the repo seed.
    float bands = 0.55
      + 0.25 * sin(t * 40.0 + uSeed * 17.0)
      + 0.20 * sin(t * 87.0 + uSeed * 5.0);
    bands = clamp(bands, 0.15, 1.0);
    // One clean division gap partway out.
    float gapPos = 0.55 + fract(uSeed * 3.7) * 0.2;
    float gap = 0.15 + 0.85 * smoothstep(0.015, 0.05, abs(t - gapPos));
    // Feathered inner/outer edges.
    float edge = smoothstep(0.0, 0.12, t) * (1.0 - smoothstep(0.8, 1.0, t));
    float alpha = bands * gap * edge * 0.55;
    gl_FragColor = vec4(uColor * (0.55 + 0.45 * bands), alpha);
  }
`

export function Planet({ spec }: { spec: PlanetSpec }) {
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

  /* Procedural surface + atmosphere + trail resources. */
  const surface = useMemo(() => makePlanetSurface(spec), [spec])
  const atmosphere = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: {
          uColor: { value: new Color(biome.glow) },
          uStrength: { value: spec.active ? 0.6 : 0.32 },
        },
        vertexShader: ATMO_VERTEX,
        fragmentShader: ATMO_FRAGMENT,
        blending: AdditiveBlending,
        transparent: true,
        depthWrite: false,
        side: BackSide,
      }),
    [biome.glow, spec.active],
  )
  const ringMaterial = useMemo(() => {
    if (!spec.ring) return null
    // Pale icy dust, faintly tinted toward the biome glow.
    const color = new Color('#cdd6e4').lerp(new Color(biome.glow), 0.3)
    return new ShaderMaterial({
      uniforms: {
        uColor: { value: color },
        uInner: { value: spec.ring.inner * spec.size },
        uOuter: { value: spec.ring.outer * spec.size },
        uSeed: { value: spec.seed },
      },
      vertexShader: RING_VERTEX,
      fragmentShader: RING_FRAGMENT,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
    })
  }, [spec, biome.glow])

  useEffect(
    () => () => {
      surface.dispose()
      atmosphere.dispose()
      ringMaterial?.dispose()
    },
    [surface, atmosphere, ringMaterial],
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
    surface.uniforms.uTime.value = et
    surface.uniforms.uCameraPos.value.copy(state.camera.position)

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
        {/* The planet: custom-lit procedural surface. */}
        <mesh ref={bodyRef} material={surface}>
          <sphereGeometry args={[spec.size, 48, 32]} />
        </mesh>

        {/* Fresnel atmosphere. */}
        <mesh material={atmosphere} scale={1.13} raycast={() => null}>
          <sphereGeometry args={[spec.size, 32, 24]} />
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

        {/* Additive halo for recently-active repos. */}
        {spec.active && (
          <sprite scale={spec.size * 4} raycast={() => null}>
            <spriteMaterial
              map={getGlowTexture()}
              color={biome.glow}
              transparent
              opacity={0.3}
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
            castShadow={false}
          >
            <sphereGeometry args={[moon.size, 16, 12]} />
            <meshStandardMaterial
              color={moon.kind === 'star' ? STAR_MOON_COLOR : FORK_MOON_COLOR}
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
