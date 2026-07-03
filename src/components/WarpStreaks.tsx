import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  AdditiveBlending,
  BufferGeometry,
  Float32BufferAttribute,
  LineBasicMaterial,
  Vector3,
} from 'three'
import type { LineSegments } from 'three'
import { warpState } from '../state/store'

/**
 * Warp arrival: while the intro camera plunges down its straight-line
 * corridor, a tube of light streaks whips past. The streaks are static world
 * geometry aligned with the flight path — the camera flying through them
 * creates the motion. Intensity follows warpState.progress (bell curve), so
 * they fade in as the plunge begins and are gone by the time it settles.
 */

const STREAK_COUNT = 340
const STREAK_SEED = 0x0aa9f7e1

/** Intro flight path endpoints as multiples of the system radius.
 *  CameraRig drives the camera along exactly this line. */
export const WARP_EYE_FROM = new Vector3(0, 1.35, 5.2)
export const WARP_EYE_TO = new Vector3(0, 0.85, 1.55)
export const WARP_DURATION = 3.2

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function WarpStreaks({ maxR }: { maxR: number }) {
  const ref = useRef<LineSegments>(null)

  const { geometry, material } = useMemo(() => {
    const rnd = mulberry32(STREAK_SEED)
    const start = WARP_EYE_FROM.clone().multiplyScalar(maxR)
    const end = WARP_EYE_TO.clone().multiplyScalar(maxR)

    // Local frame along the corridor.
    const dir = end.clone().sub(start).normalize()
    const right = new Vector3().crossVectors(dir, new Vector3(0, 1, 0)).normalize()
    const up = new Vector3().crossVectors(right, dir)

    const positions = new Float32Array(STREAK_COUNT * 2 * 3)
    const colors = new Float32Array(STREAK_COUNT * 2 * 3)
    const p = new Vector3()

    for (let i = 0; i < STREAK_COUNT; i++) {
      // Overshoot both ends slightly so streaks are already around the camera.
      const s = rnd() * 1.3 - 0.15
      // rnd*rnd hugs the corridor; a hollow core keeps the view ahead clear.
      const radius = maxR * (0.06 + rnd() * rnd() * 0.6)
      const phi = rnd() * Math.PI * 2
      p.copy(start)
        .addScaledVector(dir, start.distanceTo(end) * s)
        .addScaledVector(right, Math.cos(phi) * radius)
        .addScaledVector(up, Math.sin(phi) * radius)
      const len = maxR * (0.06 + rnd() * 0.14)

      positions[i * 6] = p.x + dir.x * len * 0.5
      positions[i * 6 + 1] = p.y + dir.y * len * 0.5
      positions[i * 6 + 2] = p.z + dir.z * len * 0.5
      positions[i * 6 + 3] = p.x - dir.x * len * 0.5
      positions[i * 6 + 4] = p.y - dir.y * len * 0.5
      positions[i * 6 + 5] = p.z - dir.z * len * 0.5

      // Blue-white, bright head fading to a dim tail along the segment.
      const b = 0.5 + rnd() * 0.5
      const cool = 0.85 + rnd() * 0.15
      colors[i * 6] = b * cool * 0.85
      colors[i * 6 + 1] = b * cool * 0.92
      colors[i * 6 + 2] = b
      colors[i * 6 + 3] = b * cool * 0.85 * 0.2
      colors[i * 6 + 4] = b * cool * 0.92 * 0.2
      colors[i * 6 + 5] = b * 0.2
    }

    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
    geometry.setAttribute('color', new Float32BufferAttribute(colors, 3))
    const material = new LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0,
      blending: AdditiveBlending,
      depthWrite: false,
    })
    return { geometry, material }
  }, [maxR])

  useEffect(
    () => () => {
      geometry.dispose()
      material.dispose()
    },
    [geometry, material],
  )

  useFrame(() => {
    const obj = ref.current
    if (!obj) return
    // Bell over the plunge: invisible at rest, peak mid-warp, gone on arrival.
    const bell = warpState.active ? Math.sin(Math.min(1, warpState.progress) * Math.PI) : 0
    obj.visible = bell > 0.015
    material.opacity = bell * 0.85
  })

  return (
    <lineSegments
      ref={ref}
      geometry={geometry}
      material={material}
      visible={false}
      frustumCulled={false}
      raycast={() => null}
    />
  )
}
