import { useMemo } from 'react'
import { Line } from '@react-three/drei'
import { C_ORBIT_RADIUS } from '../lib/galaxy'
import type { DwarfSpec, PlanetSpec } from '../lib/galaxy'
import { useGalaxyStore } from '../state/store'

const SEGMENTS = 128
const BASE_OPACITY = 0.13
const LIT_OPACITY = 0.45
const DWARF_OPACITY = 0.07
const DWARF_COLOR = '#8a93a6'

/** Orbit rings never intercept the pointer. */
const noRaycast = () => null

/**
 * Samples the same inclined circular orbit as planetPositionAt over the full
 * angle domain (the phase offset is irrelevant for a closed ring).
 */
function orbitPoints(spec: Pick<PlanetSpec, 'orbitRadius' | 'inclination'>): [number, number, number][] {
  const points: [number, number, number][] = []
  const sinIncl = Math.sin(spec.inclination)
  for (let i = 0; i <= SEGMENTS; i++) {
    const angle = (i / SEGMENTS) * Math.PI * 2
    const x = Math.cos(angle) * spec.orbitRadius
    const z = Math.sin(angle) * spec.orbitRadius
    const y = Math.sin(angle) * spec.orbitRadius * sinIncl * 0.35
    points.push([x, y, z])
  }
  return points
}

export function Orbits({ planets, dwarfs }: { planets: PlanetSpec[]; dwarfs: DwarfSpec[] }) {
  const hovered = useGalaxyStore((s) => s.hovered)
  const focus = useGalaxyStore((s) => s.focus)
  const focusName = focus?.kind === 'planet' ? focus.name : null

  const rings = useMemo(
    () => planets.map((spec) => ({ spec, points: orbitPoints(spec) })),
    [planets],
  )
  const dwarfRings = useMemo(
    () => dwarfs.map((spec) => ({ name: spec.name, points: orbitPoints(spec) })),
    [dwarfs],
  )
  const cRing = useMemo(
    () => orbitPoints({ orbitRadius: C_ORBIT_RADIUS, inclination: 0 }),
    [],
  )

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
