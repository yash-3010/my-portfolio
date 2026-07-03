import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  Euler,
  Float32BufferAttribute,
  ShaderMaterial,
  Vector3,
} from 'three'
import type { Group, Points } from 'three'
import { Html, useCursor } from '@react-three/drei'
import { SUN_RADIUS } from '../lib/galaxy'
import { galaxyClock } from '../state/store'
import { getGlowTexture } from './Sun'

/**
 * The streak comet: the longest run of consecutive commit days rides an
 * eccentric, inclined orbit through the whole system. Its tail always points
 * away from the sun (real comets' do) and its length scales with the streak.
 * Sweep speed follows Kepler's second law approximation — it whips around
 * perihelion and drifts at aphelion — advanced on the freezable galaxy clock.
 */

const TAIL_POINTS_FINE = 64
const TAIL_POINTS_COARSE = 40
/** Rough orbital period in galaxy-clock seconds. */
const PERIOD = 160
const TAIL_SEED = 0xc03e7501
/** Orbital plane: tilted out of the ecliptic so it crosses the disc. */
const ORBIT_PLANE = new Euler(0.5, 0.9, 0, 'YXZ')

const HEAD_COLOR = '#dff2ff'
const TAIL_COLOR = '#9fd8ff'

const tmpHead = new Vector3()
const tmpDir = new Vector3()

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const TAIL_VERTEX = /* glsl */ `
  attribute float aFade;
  varying float vFade;
  void main() {
    vFade = aFade;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = clamp((2.0 + aFade * 9.0) * (200.0 / -mv.z), 1.5, 26.0);
    gl_Position = projectionMatrix * mv;
  }
`
const TAIL_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  varying float vFade;
  void main() {
    float d = length(gl_PointCoord - vec2(0.5));
    float alpha = (1.0 - smoothstep(0.05, 0.5, d)) * vFade * 0.5;
    if (alpha <= 0.004) discard;
    gl_FragColor = vec4(uColor * alpha, alpha);
  }
`

export function Comet({ maxR, streak }: { maxR: number; streak: number }) {
  const groupRef = useRef<Group>(null)
  const tailRef = useRef<Points>(null)
  const [hovered, setHovered] = useState(false)
  useCursor(hovered)

  // Orbit geometry: semi-major ~ the whole system, perihelion kept clear of
  // the sun's surface. e follows from the two.
  const orbit = useMemo(() => {
    const a = Math.max(maxR * 0.95, SUN_RADIUS * 6)
    const q = Math.max(SUN_RADIUS * 2.4, maxR * 0.26)
    const e = Math.max(0.05, 1 - q / a)
    return { a, e, ell: a * (1 - e * e) }
  }, [maxR])

  const thetaRef = useRef(Math.PI) // start at aphelion, far from the action
  const lastTRef = useRef<number | null>(null)

  const tail = useMemo(() => {
    const coarse = window.matchMedia('(pointer: coarse)').matches
    const count = coarse ? TAIL_POINTS_COARSE : TAIL_POINTS_FINE
    const rnd = mulberry32(TAIL_SEED)
    const positions = new Float32Array(count * 3)
    const fades = new Float32Array(count)
    const jitter = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      const f = i / (count - 1)
      fades[i] = 1 - f
      jitter[i * 3] = (rnd() - 0.5) * 2
      jitter[i * 3 + 1] = (rnd() - 0.5) * 2
      jitter[i * 3 + 2] = (rnd() - 0.5) * 2
    }
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
    geometry.setAttribute('aFade', new Float32BufferAttribute(fades, 1))
    const material = new ShaderMaterial({
      uniforms: { uColor: { value: new Color(TAIL_COLOR) } },
      vertexShader: TAIL_VERTEX,
      fragmentShader: TAIL_FRAGMENT,
      blending: AdditiveBlending,
      transparent: true,
      depthWrite: false,
    })
    return { geometry, material, jitter, count }
  }, [])

  useEffect(
    () => () => {
      tail.geometry.dispose()
      tail.material.dispose()
    },
    [tail],
  )

  useFrame(() => {
    const group = groupRef.current
    if (!group) return

    // Kepler-ish sweep: dθ/dt ∝ (a/r)², advanced on the freezable clock.
    const t = galaxyClock.t
    const dt = lastTRef.current === null ? 0 : t - lastTRef.current
    lastTRef.current = t
    const { a, e, ell } = orbit
    let r = ell / (1 + e * Math.cos(thetaRef.current))
    thetaRef.current += ((2 * Math.PI) / PERIOD) * (a / r) * (a / r) * dt

    r = ell / (1 + e * Math.cos(thetaRef.current))
    tmpHead
      .set(Math.cos(thetaRef.current) * r, 0, Math.sin(thetaRef.current) * r)
      .applyEuler(ORBIT_PLANE)
    group.position.copy(tmpHead)

    // Tail: anti-sunward, longer when the comet dives close to the sun.
    const tailPts = tailRef.current
    if (tailPts) {
      tmpDir.copy(tmpHead).normalize()
      const proximity = 1 - Math.min(1, tmpHead.length() / (orbit.a * 1.2))
      const tailLen =
        maxR * (0.1 + 0.42 * Math.min(1, streak / 30)) * (0.55 + proximity * 0.9)
      const pos = tailPts.geometry.attributes.position
      for (let i = 0; i < tail.count; i++) {
        const f = i / (tail.count - 1)
        const dist = Math.pow(f, 1.35) * tailLen
        const spread = f * tailLen * 0.1
        pos.setXYZ(
          i,
          tmpHead.x + tmpDir.x * dist + tail.jitter[i * 3] * spread,
          tmpHead.y + tmpDir.y * dist + tail.jitter[i * 3 + 1] * spread,
          tmpHead.z + tmpDir.z * dist + tail.jitter[i * 3 + 2] * spread,
        )
      }
      pos.needsUpdate = true
    }
  })

  return (
    <>
      {/* Tail lives in world space so it can trail across the whole system. */}
      <points
        ref={tailRef}
        geometry={tail.geometry}
        material={tail.material}
        frustumCulled={false}
        raycast={() => null}
      />

      <group ref={groupRef}>
        {/* Icy nucleus — bright enough to catch the bloom pass. */}
        <mesh raycast={() => null}>
          <icosahedronGeometry args={[0.16, 1]} />
          <meshBasicMaterial color={HEAD_COLOR} />
        </mesh>
        <sprite scale={1.6} raycast={() => null}>
          <spriteMaterial
            map={getGlowTexture()}
            color={TAIL_COLOR}
            transparent
            opacity={0.65}
            depthWrite={false}
            blending={AdditiveBlending}
          />
        </sprite>

        {/* Padded hover target. */}
        <mesh
          visible={false}
          onPointerOver={(e) => {
            e.stopPropagation()
            setHovered(true)
          }}
          onPointerOut={() => setHovered(false)}
        >
          <sphereGeometry args={[1.1, 10, 10]} />
        </mesh>

        {hovered && (
          <Html
            position={[0, 1.2, 0]}
            center
            distanceFactor={16}
            zIndexRange={[8, 0]}
            style={{ pointerEvents: 'none' }}
          >
            <div className="planet-label">
              <span className="planet-label__name">the streak comet</span>
              <span className="planet-label__lang" style={{ color: TAIL_COLOR }}>
                {streak} days of consecutive commits
              </span>
            </div>
          </Html>
        )}
      </group>
    </>
  )
}
