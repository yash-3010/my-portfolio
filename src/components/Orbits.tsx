import { useMemo } from 'react'
import { Line } from '@react-three/drei'
import type { PlanetSpec } from '../lib/galaxy'
import { SUN_RADIUS } from '../lib/galaxy'
import { useGalaxyStore } from '../state/store'

const SEGMENTS = 128
const BASE_OPACITY = 0.13
const LIT_OPACITY = 0.45

/** Orbit rings never intercept the pointer. */
const noRaycast = () => null

/**
 * Samples the same inclined circular orbit as planetPositionAt over the full
 * angle domain (the phase offset is irrelevant for a closed ring).
 */
function orbitPoints(spec: PlanetSpec): [number, number, number][] {
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

function circlePoints(radius: number): [number, number, number][] {
  const points: [number, number, number][] = []
  for (let i = 0; i <= SEGMENTS; i++) {
    const angle = (i / SEGMENTS) * Math.PI * 2
    points.push([Math.cos(angle) * radius, 0, Math.sin(angle) * radius])
  }
  return points
}

export function Orbits({ planets }: { planets: PlanetSpec[] }) {
  const hovered = useGalaxyStore((s) => s.hovered)
  const focus = useGalaxyStore((s) => s.focus)
  const focusName = focus?.kind === 'planet' ? focus.name : null

  const rings = useMemo(
    () => planets.map((spec) => ({ spec, points: orbitPoints(spec) })),
    [planets],
  )
  const referenceRing = useMemo(() => circlePoints(SUN_RADIUS * 1.9), [])

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

      {/* Faint inner reference ring for depth near the sun. */}
      <Line
        points={referenceRing}
        color="#ffffff"
        lineWidth={1}
        transparent
        opacity={0.05}
        depthWrite={false}
        raycast={noRaycast}
      />
    </group>
  )
}
