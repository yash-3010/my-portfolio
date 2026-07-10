import { useEffect, useMemo } from 'react'
import { Box3, Group, Mesh, Vector3 } from 'three'
import { useGLTF } from '@react-three/drei'
import type { RealmLayout } from './realm'
import { REALM_SIZE, climateAt, heightAt, rawHeightAt, wallPathZ } from './terrain'

/**
 * Scanned (photogrammetry / hand-modeled) assets, meshopt-compressed at
 * build time. Each hero castle replaces the procedural kit for a flagship
 * repo; scanned trees are scattered as near-ground detail among the
 * instanced pine forests.
 */

const TREE_A = `${import.meta.env.BASE_URL}assets/realm/models/tree-a.glb`
const TREE_B = `${import.meta.env.BASE_URL}assets/realm/models/tree-b.glb`

/** Normalize a GLB: centered on x/z, grounded at y=0, scaled to a footprint. */
function usePrepared(url: string, targetWidth: number, targetHeight?: number) {
  const { scene } = useGLTF(url)
  return useMemo(() => {
    const root = scene.clone(true)
    const box = new Box3().setFromObject(root)
    const size = box.getSize(new Vector3())
    const center = box.getCenter(new Vector3())
    const scale = targetHeight
      ? targetHeight / Math.max(0.0001, size.y)
      : targetWidth / Math.max(0.0001, Math.max(size.x, size.z))
    const holder = new Group()
    root.position.set(-center.x, -box.min.y, -center.z)
    holder.add(root)
    holder.scale.setScalar(scale)
    holder.traverse((obj) => {
      if ((obj as Mesh).isMesh) {
        obj.castShadow = true
        obj.receiveShadow = true
      }
    })
    return { holder, height: size.y * scale }
  }, [scene, targetWidth, targetHeight])
}

export function HeroCastleModel({
  url,
  footprint,
}: {
  url: string
  footprint: number
}) {
  const { holder } = usePrepared(url, footprint)
  return <primitive object={holder} />
}

/** Exposes the scaled height so the banner pole can sit above the model. */
export function useHeroHeight(url: string, footprint: number): number {
  return usePrepared(url, footprint).height
}

/* ---------------------------------------------------------------- */
/* Scattered scanned trees                                            */
/* ---------------------------------------------------------------- */

const HALF = REALM_SIZE / 2
const TREE_COUNT = 46

function mulberry(seed: number): () => number {
  let a = seed | 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function HeroTrees({ realm }: { realm: RealmLayout }) {
  const a = usePrepared(TREE_A, 0, 9)
  const b = usePrepared(TREE_B, 0, 8)

  const group = useMemo(() => {
    const rand = mulberry(0x7ee2)
    const parent = new Group()
    let placed = 0
    let attempts = 0
    while (placed < TREE_COUNT && attempts < TREE_COUNT * 40) {
      attempts++
      const x = (rand() * 2 - 1) * HALF * 0.8
      const z = (rand() * 2 - 1) * HALF * 0.8
      const h = rawHeightAt(x, z)
      // Big detailed trees live on gentle lowland — near paths and castles.
      if (h < 1.6 || h > 9) continue
      const { frozen } = climateAt(x, z)
      if (frozen > 0.6) continue // scanned broadleaves look wrong in snow
      if (Math.abs(z - wallPathZ(x)) < 8) continue
      let nearSite = false
      for (const site of realm.sites) {
        const dx = x - site.x
        const dz = z - site.z
        const d2 = dx * dx + dz * dz
        if (d2 < (site.r + 3) * (site.r + 3)) {
          nearSite = true
          break
        }
      }
      if (nearSite) continue

      const src = rand() > 0.5 ? a.holder : b.holder
      const clone = src.clone(true)
      const s = 0.7 + rand() * 0.7
      clone.scale.multiplyScalar(s)
      clone.position.set(x, heightAt(x, z, realm.sites) - 0.08, z)
      clone.rotation.y = rand() * Math.PI * 2
      parent.add(clone)
      placed++
    }
    return parent
  }, [a.holder, b.holder, realm])

  useEffect(
    () => () => {
      group.clear()
    },
    [group],
  )

  return <primitive object={group} />
}

useGLTF.preload(TREE_A)
useGLTF.preload(TREE_B)
