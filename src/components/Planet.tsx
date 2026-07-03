import { useEffect, useMemo, useRef } from 'react'
import {
  AdditiveBlending,
  BackSide,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  ShaderMaterial,
  Vector3,
} from 'three'
import type { Group, Mesh, Points } from 'three'
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
const TRAIL_POINTS = 26
/** Radians of orbit the fading motion trail spans behind the planet. */
const TRAIL_ARC = 0.42

/** Module-level scratch vectors — never allocated in the frame loop. */
const tmpPlanet = new Vector3()
const tmpMoon = new Vector3()
const tmpTrail = new Vector3()

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

const TRAIL_VERTEX = /* glsl */ `
  attribute float aFade;
  varying float vFade;
  void main() {
    vFade = aFade;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = clamp((1.0 + aFade * 2.6) * (160.0 / -mv.z), 1.0, 7.0);
    gl_Position = projectionMatrix * mv;
  }
`
const TRAIL_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  varying float vFade;
  void main() {
    float d = length(gl_PointCoord - vec2(0.5));
    float alpha = (1.0 - smoothstep(0.1, 0.5, d)) * vFade * 0.4;
    if (alpha <= 0.004) discard;
    gl_FragColor = vec4(uColor * alpha, alpha);
  }
`

export function Planet({ spec }: { spec: PlanetSpec }) {
  const name = spec.repo.name
  const biome = spec.biome
  const groupRef = useRef<Group>(null)
  const bodyRef = useRef<Mesh>(null)
  const moonRefs = useRef<(Mesh | null)[]>([])
  const trailRef = useRef<Points>(null)

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
  const trail = useMemo(() => {
    const positions = new Float32Array(TRAIL_POINTS * 3)
    const fades = new Float32Array(TRAIL_POINTS)
    for (let i = 0; i < TRAIL_POINTS; i++) fades[i] = i / (TRAIL_POINTS - 1)
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
    geometry.setAttribute('aFade', new Float32BufferAttribute(fades, 1))
    const material = new ShaderMaterial({
      uniforms: { uColor: { value: new Color(biome.glow) } },
      vertexShader: TRAIL_VERTEX,
      fragmentShader: TRAIL_FRAGMENT,
      blending: AdditiveBlending,
      transparent: true,
      depthWrite: false,
    })
    return { geometry, material }
  }, [biome.glow])

  useEffect(
    () => () => {
      surface.dispose()
      atmosphere.dispose()
      trail.geometry.dispose()
      trail.material.dispose()
    },
    [surface, atmosphere, trail],
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

    // Fading motion trail: sample the orbit path behind the current angle.
    // (World-space points, so the geometry lives outside the moving group.)
    const trailPts = trailRef.current
    if (trailPts) {
      const pos = trailPts.geometry.attributes.position
      const tNow = galaxyClock.t
      for (let i = 0; i < TRAIL_POINTS; i++) {
        const back = (1 - i / (TRAIL_POINTS - 1)) * (TRAIL_ARC / spec.speed)
        planetPositionAt(spec, tNow - back, tmpTrail)
        pos.setXYZ(i, tmpTrail.x, tmpTrail.y, tmpTrail.z)
      }
      pos.needsUpdate = true
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
      {/* Motion trail lives in world space. */}
      <points
        ref={trailRef}
        geometry={trail.geometry}
        material={trail.material}
        frustumCulled={false}
        raycast={() => null}
      />

      <group ref={groupRef} name={`planet-${name}`}>
        {/* The planet: custom-lit procedural surface. */}
        <mesh ref={bodyRef} material={surface}>
          <sphereGeometry args={[spec.size, 48, 32]} />
        </mesh>

        {/* Fresnel atmosphere. */}
        <mesh material={atmosphere} scale={1.13} raycast={() => null}>
          <sphereGeometry args={[spec.size, 32, 24]} />
        </mesh>

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
