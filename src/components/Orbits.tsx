import { useMemo } from 'react'
import { Line } from '@react-three/drei'
import { STARS, orbitPathPoints } from '../lib/galaxy'
import type { DwarfSpec, PlanetSpec } from '../lib/galaxy'
import { useGalaxyStore } from '../state/store'

const SEGMENTS = 128
const BASE_OPACITY = 0.13
const LIT_OPACITY = 0.45
const DWARF_OPACITY = 0.07
const DWARF_COLOR = '#8a93a6'

/** Orbit rings never intercept the pointer. */
const noRaycast = () => null

export function Orbits({ planets, dwarfs }: { planets: PlanetSpec[]; dwarfs: DwarfSpec[] }) {
  const hovered = useGalaxyStore((s) => s.hovered)
  const focus = useGalaxyStore((s) => s.focus)
  const focusName = focus?.kind === 'planet' ? focus.name : null

  // All rings sample the same Kepler ellipses the bodies actually fly
  // (orbitPathPoints), so lines and planets can never drift apart.
  const rings = useMemo(
    () => planets.map((spec) => ({ spec, points: orbitPathPoints(spec, SEGMENTS) })),
    [planets],
  )
  const dwarfRings = useMemo(
    () => dwarfs.map((spec) => ({ name: spec.name, points: orbitPathPoints(spec, SEGMENTS) })),
    [dwarfs],
  )
  const cRing = useMemo(() => {
    const c = STARS.find((s) => s.id === 'C')!
    return orbitPathPoints(
      {
        orbitRadius: c.orbitRadius,
        eccentricity: c.eccentricity,
        periapsis: c.periapsis,
        inclination: 0,
      },
      SEGMENTS,
    )
  }, [])

  return (
    <group>
      {rings.map(({ spec, points }) => {
        const name = spec.repo.name
        const lit = hovered === name || focusName === name
        return (
          <Line
            key={name}
            points={points}
            color={spec.biome.color}
            lineWidth={1}
            transparent
            opacity={lit ? LIT_OPACITY : BASE_OPACITY}
            depthWrite={false}
            raycast={noRaycast}
          />
        )
      })}

      {/* Dwarf planets ride the faintest, colorless rings. */}
      {dwarfRings.map(({ name, points }) => (
        <Line
          key={name}
          points={points}
          color={DWARF_COLOR}
          lineWidth={1}
          transparent
          opacity={DWARF_OPACITY}
          depthWrite={false}
          raycast={noRaycast}
        />
      ))}

      {/* Star C's distant loop — a blue whisper so the companion is findable. */}
      <Line
        points={cRing}
        color="#7ea8ff"
        lineWidth={1}
        transparent
        opacity={0.09}
        depthWrite={false}
        raycast={noRaycast}
      />
    </group>
  )
}
