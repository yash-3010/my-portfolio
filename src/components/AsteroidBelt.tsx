import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import {
  Color,
  Euler,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
} from 'three'
import type { Group } from 'three'
import { totalCommits, type GalaxyLayout } from '../lib/galaxy'
import { galaxyClock } from '../state/store'

/**
 * The commit belt: every commit across every rendered repo becomes one rock,
 * scattered in a main-belt ring between the middle and outer orbits. Rocks
 * are a single InstancedMesh (one draw call) lit by the sun's point light;
 * the whole ring rotates rigidly on the galaxy clock so it freezes with the
 * planets when a card is open.
 */

const MAX_ROCKS_FINE = 4000
const MAX_ROCKS_COARSE = 1600
/** Slightly slower than the planet disc — outer material lags, Kepler-style. */
const BELT_SPEED = 0.014
const BELT_SEED = 0xbe17a5ed
/** Radial half-width and vertical half-thickness of the ring, world units. */
const BELT_WIDTH = 1.7
const BELT_THICKNESS = 0.55

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const noRaycast = () => undefined

export function AsteroidBelt({ layout }: { layout: GalaxyLayout }) {
  const groupRef = useRef<Group>(null)
  const commits = useMemo(() => totalCommits(layout), [layout])

  const mesh = useMemo(() => {
    if (commits === 0) return null
    const coarse = window.matchMedia('(pointer: coarse)').matches
    const count = Math.min(commits, coarse ? MAX_ROCKS_COARSE : MAX_ROCKS_FINE)
    const rBase =
      layout.minOrbitRadius + (layout.maxOrbitRadius - layout.minOrbitRadius) * 0.62

    const geometry = new IcosahedronGeometry(1, 0)
    const material = new MeshStandardMaterial({ roughness: 0.96, metalness: 0.04 })
    const instanced = new InstancedMesh(geometry, material, count)

    const rnd = mulberry32(BELT_SEED)
    const matrix = new Matrix4()
    const quat = new Quaternion()
    const euler = new Euler()
    const pos = new Vector3()
    const scale = new Vector3()
    const color = new Color()

    for (let i = 0; i < count; i++) {
      const angle = rnd() * Math.PI * 2
      // Sum of two randoms ≈ triangular: dense mid-belt, feathered edges.
      const r = rBase + (rnd() + rnd() - 1) * BELT_WIDTH
      pos.set(
        Math.cos(angle) * r,
        (rnd() + rnd() - 1) * BELT_THICKNESS,
        Math.sin(angle) * r,
      )
      euler.set(rnd() * Math.PI * 2, rnd() * Math.PI * 2, rnd() * Math.PI * 2)
      quat.setFromEuler(euler)
      // rnd*rnd skews small: mostly gravel, the occasional boulder.
      const s = 0.028 + rnd() * rnd() * 0.09
      scale.set(
        s * (0.6 + rnd() * 0.9),
        s * (0.6 + rnd() * 0.9),
        s * (0.6 + rnd() * 0.9),
      )
      matrix.compose(pos, quat, scale)
      instanced.setMatrixAt(i, matrix)

      // Grey rock with faint warm/cool temperature variation.
      const g = 0.38 + rnd() * 0.38
      color.setRGB(g * (0.95 + rnd() * 0.1), g * (0.9 + rnd() * 0.1), g * (0.85 + rnd() * 0.12))
      instanced.setColorAt(i, color)
    }

    instanced.instanceMatrix.needsUpdate = true
    if (instanced.instanceColor) instanced.instanceColor.needsUpdate = true
    instanced.frustumCulled = false
    instanced.raycast = noRaycast
    return instanced
  }, [commits, layout])

  useEffect(() => {
    if (!mesh) return
    return () => {
      mesh.geometry.dispose()
      ;(mesh.material as MeshStandardMaterial).dispose()
      mesh.dispose()
    }
  }, [mesh])

  useFrame(() => {
    // Rigid ring rotation on the freezable clock, same sense as the planets.
    if (groupRef.current) groupRef.current.rotation.y = -BELT_SPEED * galaxyClock.t
  })

  if (!mesh) return null
  return (
    <group ref={groupRef}>
      <primitive object={mesh} />
    </group>
  )
}
