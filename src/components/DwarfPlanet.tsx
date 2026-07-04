import { useEffect, useMemo, useRef } from 'react'
import { Vector3 } from 'three'
import type { Group, Mesh } from 'three'
import { useFrame } from '@react-three/fiber'
import { useTexture } from '@react-three/drei'
import type { DwarfSpec } from '../lib/galaxy'
import { planetPositionAt } from '../lib/galaxy'
import {
  DWARF_TEXTURES,
  NIGHT_TEXTURE,
  configurePlanetTexture,
  makePlanetSurface,
  planetTextureUrl,
} from '../lib/planetSurface'
import { galaxyClock } from '../state/store'

/** Module-level scratch vector — never allocated in the frame loop. */
const tmpDwarf = new Vector3()

/**
 * Dwarf planet: an unclickable filler world that pads the roster out to a
 * full ten-planet system. No repo behind it — no hover, no label, no card.
 */
export function DwarfPlanet({ spec, index }: { spec: DwarfSpec; index: number }) {
  const groupRef = useRef<Group>(null)
  const bodyRef = useRef<Mesh>(null)

  const [dayMap, nightMap] = useTexture(
    [
      planetTextureUrl(DWARF_TEXTURES[index % DWARF_TEXTURES.length]),
      planetTextureUrl(NIGHT_TEXTURE),
    ],
    configurePlanetTexture,
  )

  // Same sun-lit surface as repo planets, city lights permanently off.
  const surface = useMemo(
    () => makePlanetSurface({ active: false }, dayMap, nightMap),
    [dayMap, nightMap],
  )
  useEffect(() => () => surface.dispose(), [surface])

  useFrame((state) => {
    const group = groupRef.current
    if (!group) return
    // Orbital position runs on the freezable galaxy clock (years).
    planetPositionAt(spec, galaxyClock.t, tmpDwarf)
    group.position.copy(tmpDwarf)
    // Self-rotation stays alive on wall-clock time while frozen.
    if (bodyRef.current) bodyRef.current.rotation.y = state.clock.getElapsedTime() * spec.spin
  })

  return (
    <group ref={groupRef} name={spec.name}>
      <mesh ref={bodyRef} material={surface} raycast={() => null}>
        <sphereGeometry args={[spec.size, 32, 24]} />
      </mesh>
    </group>
  )
}
