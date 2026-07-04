import { useEffect, useState } from 'react'
import { BackSide, SRGBColorSpace, TextureLoader } from 'three'
import type { Texture } from 'three'
import { useGalaxyStore } from '../state/store'

/**
 * Optional photographic sky: an equirectangular Milky Way panorama (e.g. ESO's
 * eso0932a, CC-BY) mapped onto an inside-out sphere behind everything else.
 * The asset is NOT bundled — drop it at public/assets/skybox/milkyway.webp
 * (or .jpg) and this lights up; until then the procedural sky stands alone,
 * and the only trace is one 404 in the network tab at load.
 */

const CANDIDATES = ['assets/skybox/milkyway.webp', 'assets/skybox/milkyway.jpg']
/** Dimmed so the photographic sky stays a backdrop, under the bloom threshold. */
const SKY_TINT = '#8890a8'

const noRaycast = () => null

export function Skybox({ radius }: { radius: number }) {
  const [texture, setTexture] = useState<Texture | null>(null)

  useEffect(() => {
    let disposed = false
    let loaded: Texture | null = null
    const loader = new TextureLoader()
    const tryLoad = (i: number) => {
      if (i >= CANDIDATES.length) return
      loader.load(
        import.meta.env.BASE_URL + CANDIDATES[i],
        (tex) => {
          if (disposed) {
            tex.dispose()
            return
          }
          tex.colorSpace = SRGBColorSpace
          loaded = tex
          setTexture(tex)
          // Tell the procedural sky to retire its ambient star shell.
          useGalaxyStore.getState().setSkyPhoto()
        },
        undefined,
        () => tryLoad(i + 1), // fall through to the next format / no skybox
      )
    }
    tryLoad(0)
    return () => {
      disposed = true
      loaded?.dispose()
      setTexture(null)
    }
  }, [])

  if (!texture) return null
  return (
    // scale.x = -1 un-mirrors the equirect projection on a BackSide sphere.
    <mesh
      scale={[-1, 1, 1]}
      rotation={[0.35, 1.1, 0]}
      renderOrder={-3}
      frustumCulled={false}
      raycast={noRaycast}
    >
      <sphereGeometry args={[radius, 48, 32]} />
      <meshBasicMaterial
        map={texture}
        color={SKY_TINT}
        side={BackSide}
        fog={false}
        depthWrite={false}
      />
    </mesh>
  )
}
