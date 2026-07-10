import { useEffect, useMemo } from 'react'
import {
  Color,
  ConeGeometry,
  CylinderGeometry,
  DynamicDrawUsage,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
} from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { RealmLayout } from './realm'
import { REALM_SIZE, climateAt, heightAt, rawHeightAt, wallPathZ } from './terrain'

/**
 * Instanced pine forests — thousands of conifers in a single draw call, the
 * detail that sells the miniature-map look. Density follows the climate:
 * thick dark stands below the ranges, sparser copses in the Vale and the
 * Runelands, snow-dusted trees near the snowline. Deterministic.
 */

const HALF = REALM_SIZE / 2

function mulberry(seed: number): () => number {
  let a = seed | 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** One pine: trunk + three stacked foliage cones, merged. */
function buildPineGeometry() {
  const trunk = new CylinderGeometry(0.09, 0.14, 0.5, 6)
  trunk.translate(0, 0.25, 0)
  const c1 = new ConeGeometry(0.72, 1.1, 8)
  c1.translate(0, 0.95, 0)
  const c2 = new ConeGeometry(0.55, 0.95, 8)
  c2.translate(0, 1.55, 0)
  const c3 = new ConeGeometry(0.36, 0.8, 8)
  c3.translate(0, 2.1, 0)
  const merged = mergeGeometries([trunk, c1, c2, c3], false)!
  trunk.dispose()
  c1.dispose()
  c2.dispose()
  c3.dispose()
  return merged
}

const PINE_DEEP = new Color('#17301f')
const PINE_BLUE = new Color('#1d3230')
const PINE_WARM = new Color('#2a3b20')
const PINE_SNOWY = new Color('#9db3ad')

export function Trees({ realm, count }: { realm: RealmLayout; count: number }) {
  const mesh = useMemo(() => {
    const geometry = buildPineGeometry()
    const material = new MeshStandardMaterial({ roughness: 0.95, flatShading: false })
    const instanced = new InstancedMesh(geometry, material, count)
    instanced.instanceMatrix.setUsage(DynamicDrawUsage)

    const rand = mulberry(0x7ee5)
    const m = new Matrix4()
    const p = new Vector3()
    const q = new Quaternion()
    const s = new Vector3()
    const up = new Vector3(0, 1, 0)
    const color = new Color()

    let placed = 0
    let attempts = 0
    while (placed < count && attempts < count * 30) {
      attempts++
      const x = (rand() * 2 - 1) * HALF * 0.94
      const z = (rand() * 2 - 1) * HALF * 0.94
      const h = rawHeightAt(x, z)
      // On land, below the bare peaks.
      if (h < 1.4 || h > 20) continue
      // Slope check — pines don't grow on cliffs.
      const slope =
        Math.abs(rawHeightAt(x + 1.4, z) - h) + Math.abs(rawHeightAt(x, z + 1.4) - h)
      if (slope > 2.6) continue
      // Keep castle plateaus and the Wall's line clear.
      if (Math.abs(z - wallPathZ(x)) < 6) continue
      let nearSite = false
      for (const site of realm.sites) {
        const dx = x - site.x
        const dz = z - site.z
        if (dx * dx + dz * dz < (site.r + 5) * (site.r + 5)) {
          nearSite = true
          break
        }
      }
      if (nearSite) continue

      // Density by climate: forests thicken toward the foothills.
      const { frozen, vale } = climateAt(x, z)
      const density = 0.28 + frozen * 0.62 + (h > 3 && h < 12 ? 0.15 : 0)
      if (rand() > density) continue

      const y = heightAt(x, z, realm.sites)
      const scale = (1.1 + rand() * 1.5) * (1 - Math.min(0.35, h * 0.012))
      p.set(x, y - 0.05, z)
      q.setFromAxisAngle(up, rand() * Math.PI * 2)
      s.set(scale * (0.85 + rand() * 0.3), scale, scale * (0.85 + rand() * 0.3))
      m.compose(p, q, s)
      instanced.setMatrixAt(placed, m)

      // Snow-dusted near the snowline; warmer greens in the Vale.
      const snowT = Math.min(1, Math.max(0, (h - (12 - frozen * 6)) / 5))
      color
        .copy(frozen > 0.5 ? PINE_BLUE : vale > 0.4 ? PINE_WARM : PINE_DEEP)
        .lerp(PINE_SNOWY, snowT)
        .multiplyScalar(0.85 + rand() * 0.3)
      instanced.setColorAt(placed, color)
      placed++
    }

    instanced.count = placed
    instanced.instanceMatrix.needsUpdate = true
    if (instanced.instanceColor) instanced.instanceColor.needsUpdate = true
    instanced.castShadow = true
    instanced.receiveShadow = false
    instanced.frustumCulled = false
    return instanced
  }, [realm, count])

  useEffect(
    () => () => {
      mesh.geometry.dispose()
      ;(mesh.material as MeshStandardMaterial).dispose()
      mesh.dispose()
    },
    [mesh],
  )

  return <primitive object={mesh} />
}
