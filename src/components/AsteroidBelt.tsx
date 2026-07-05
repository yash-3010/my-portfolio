import { useEffect, useMemo, useRef } from 'react'
import { DynamicDrawUsage, Euler, Matrix4, Quaternion, Vector3 } from 'three'
import type {
  BufferGeometry,
  InstancedMesh,
  Mesh,
  MeshStandardMaterial,
} from 'three'
import { useFrame } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import { AU, BELT, circumbinaryPeriod, keplerPoint, seededRng } from '../lib/galaxy'
import { galaxyClock } from '../state/store'

/**
 * The asteroid belt: one rock per commit across the WHOLE journey (every
 * repo in the snapshot plus manual entries — not just the rendered planets),
 * packed into a tight ring after the second planet slot. Ten real asteroid
 * meshes from the pack are instanced with seeded radii, phases and tumbles —
 * deterministic, so the belt is identical every load. Every rock rides its
 * OWN Kepler orbit on the freezable galaxy clock: inner rocks lap outer ones.
 */

const MODEL_URL = `${import.meta.env.BASE_URL}assets/models/asteroids_pack.glb`

/** Rock world-size range (unit-normalized geometry × this scale). */
const MIN_ROCK = 0.07
const MAX_ROCK = 0.2
/** Vertical scatter, world units — keeps the belt a thin disc. */
const THICKNESS = 1.1

const TAU = Math.PI * 2
const noRaycast = () => null

/* Scratch objects for the per-frame matrix compose — never re-allocated. */
const tmpMatrix = new Matrix4()
const tmpPos = new Vector3()
const tmpScale = new Vector3()

interface InstanceSet {
  geometry: BufferGeometry
  material: MeshStandardMaterial
  count: number
  /** Per-rock orbit state, all seeded once. radius = semi-major axis. */
  radius: Float32Array
  phase: Float32Array
  height: Float32Array
  size: Float32Array
  /** Mean motion, radians per simulated year (Kepler per rock). */
  rate: Float32Array
  /** Per-rock ellipse: eccentricity + argument of periapsis. */
  ecc: Float32Array
  peri: Float32Array
  quaternions: Quaternion[]
}

export function AsteroidBelt({ total }: { total: number }) {
  const gltf = useGLTF(MODEL_URL)
  const meshRefs = useRef<(InstancedMesh | null)[]>([])
  const lastT = useRef(Number.NaN)

  /* Extract the ten rocks: bake node transforms into cloned geometry,
     center each rock, normalize to a unit bounding sphere (instance scale
     then IS the world size), and de-chrome the "metallic version" so the
     rocks read as sun-lit rubble instead of dark glints. */
  const variants = useMemo(() => {
    gltf.scene.updateMatrixWorld(true)
    const out: { geometry: BufferGeometry; material: MeshStandardMaterial }[] = []
    gltf.scene.traverse((obj) => {
      const mesh = obj as Mesh
      if (!mesh.isMesh) return
      const geometry = mesh.geometry.clone()
      geometry.applyMatrix4(mesh.matrixWorld)
      geometry.center()
      geometry.computeBoundingSphere()
      const r = geometry.boundingSphere?.radius ?? 1
      geometry.scale(1 / r, 1 / r, 1 / r)
      const material = (mesh.material as MeshStandardMaterial).clone()
      material.metalness = Math.min(material.metalness, 0.25)
      material.roughness = Math.max(material.roughness, 0.75)
      out.push({ geometry, material })
    })
    return out
  }, [gltf])

  useEffect(
    () => () => {
      // Clones only — the GLTF cache keeps the originals (and the textures).
      for (const v of variants) {
        v.geometry.dispose()
        v.material.dispose()
      }
    },
    [variants],
  )

  /* Deal the commits across the rock variants; every orbit parameter is
     seeded once, then the frame loop just advances angles. */
  const instanceSets = useMemo<InstanceSet[]>(() => {
    if (!variants.length) return []
    const counts = variants.map((_, i) =>
      Math.floor(total / variants.length) + (i < total % variants.length ? 1 : 0),
    )
    const e = new Euler()
    return variants.map((variant, vi) => {
      const rand = seededRng(`belt-${vi}`)
      const count = counts[vi]
      const radius = new Float32Array(count)
      const phase = new Float32Array(count)
      const height = new Float32Array(count)
      const size = new Float32Array(count)
      const rate = new Float32Array(count)
      const ecc = new Float32Array(count)
      const peri = new Float32Array(count)
      const quaternions: Quaternion[] = []
      for (let i = 0; i < count; i++) {
        radius[i] = BELT.inner + (BELT.outer - BELT.inner) * rand()
        phase[i] = rand() * TAU
        // Two rolls pull the scatter toward the midplane.
        height[i] = (rand() + rand() - 1) * (THICKNESS / 2)
        size[i] = MIN_ROCK + (MAX_ROCK - MIN_ROCK) * rand() ** 1.6
        e.set(rand() * TAU, rand() * TAU, rand() * TAU)
        quaternions.push(new Quaternion().setFromEuler(e))
        // Kepler per rock: inner rocks orbit faster than outer ones.
        rate[i] = TAU / circumbinaryPeriod(radius[i] / AU)
        // Real belts straggle: gentle per-rock ellipses feather the ring's
        // edges without diving into the neighboring planet slots.
        ecc[i] = 0.02 + rand() * 0.1
        peri[i] = rand() * TAU
      }
      return { ...variant, count, radius, phase, height, size, rate, ecc, peri, quaternions }
    })
  }, [variants, total])

  /* Advance every rock along its own orbit — skipped entirely while the
     galaxy clock is frozen (focused card), so the belt freezes too. */
  useFrame(() => {
    const t = galaxyClock.t
    if (t === lastT.current) return
    lastT.current = t
    for (let vi = 0; vi < instanceSets.length; vi++) {
      const mesh = meshRefs.current[vi]
      const set = instanceSets[vi]
      if (!mesh) continue
      for (let i = 0; i < set.count; i++) {
        // Full Kepler per rock: mean anomaly -> ellipse with the barycenter
        // at the focus, same math the planets fly.
        const M = set.phase[i] + set.rate[i] * t
        const p = keplerPoint(set.radius[i], set.ecc[i], set.peri[i], M)
        tmpPos.set(p.x, set.height[i], p.z)
        tmpScale.setScalar(set.size[i])
        tmpMatrix.compose(tmpPos, set.quaternions[i], tmpScale)
        mesh.setMatrixAt(i, tmpMatrix)
      }
      mesh.instanceMatrix.needsUpdate = true
    }
  })

  return (
    <group name="asteroid-belt">
      {instanceSets.map((set, i) => (
        <instancedMesh
          key={i}
          args={[set.geometry, set.material, set.count]}
          raycast={noRaycast}
          // Instances span the whole ring; the unit bounding sphere would
          // cull them all as soon as the origin leaves the frustum.
          frustumCulled={false}
          ref={(el) => {
            meshRefs.current[i] = el
            // Matrices stream every unfrozen frame.
            el?.instanceMatrix.setUsage(DynamicDrawUsage)
          }}
        />
      ))}
    </group>
  )
}

useGLTF.preload(MODEL_URL)
