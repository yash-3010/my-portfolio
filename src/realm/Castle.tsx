import { useMemo, useState } from 'react'
import { BoxGeometry, ConeGeometry, CylinderGeometry, DoubleSide } from 'three'
import type { ThreeEvent } from '@react-three/fiber'
import { Html, useCursor } from '@react-three/drei'
import type { CastleSpec } from './realm'
import { useGalaxyStore } from '../state/store'

/**
 * One repo as a low-poly castle, composed from shared primitive geometries:
 * plateau base, hex bailey wall, wall towers, central keep, banner in the
 * repo's language color, garrison tents (stars+forks), and a construction
 * scaffold + lantern when the repo is recently active.
 * Everything is deterministic from the spec (already seeded upstream).
 */

/* Shared unit geometries — scaled per use, never rebuilt. */
const BASE_GEO = new CylinderGeometry(1, 1.12, 1, 8)
const WALL_GEO = new CylinderGeometry(1, 1.04, 1, 6)
const TOWER_GEO = new CylinderGeometry(1, 1.15, 1, 6)
const ROOF_GEO = new ConeGeometry(1, 1, 6)
const KEEP_GEO = new CylinderGeometry(1, 1.06, 1, 4)
const POLE_GEO = new CylinderGeometry(0.05, 0.05, 1, 4)
const BANNER_GEO = new BoxGeometry(1, 0.62, 0.04)
const TENT_GEO = new ConeGeometry(1, 1, 5)
const BEAM_GEO = new BoxGeometry(0.12, 1, 0.12)
const LANTERN_GEO = new BoxGeometry(0.3, 0.3, 0.3)
const HIT_GEO = new CylinderGeometry(1, 1, 1, 8)

/** Kingdom stonework. */
const STONE: Record<CastleSpec['kingdom'], string> = {
  tools: '#828ca3', // Frozen Reach — cold granite
  web: '#a6957a', // Golden Vale — warm sandstone
  ai: '#7d7a99', // Runelands — dusk stone
}

const STONE_DARK: Record<CastleSpec['kingdom'], string> = {
  tools: '#5d6579',
  web: '#7d6f5a',
  ai: '#5c5975',
}

const TENT_STAR = '#d9c18a'
const TENT_FORK = '#9aa3b2'
const DRAG_THRESHOLD_PX = 8

function mulberry(seed: number): () => number {
  let a = seed | 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function Castle({ spec }: { spec: CastleSpec }) {
  const name = spec.repo.name
  const s = spec.scale
  const hovered = useGalaxyStore((st) => st.hovered)
  const focus = useGalaxyStore((st) => st.focus)
  const setHovered = useGalaxyStore((st) => st.setHovered)
  const setFocus = useGalaxyStore((st) => st.setFocus)
  const [localHover, setLocalHover] = useState(false)
  useCursor(localHover)

  const isHovered = hovered === name
  const isFocused = focus?.kind === 'planet' && focus.name === name
  const showLabel = (isHovered || spec.highlight) && !isFocused

  // Deterministic per-castle variation (tower heights, tent ring).
  const parts = useMemo(() => {
    const rand = mulberry(
      spec.repo.name.split('').reduce((h, ch) => Math.imul(h ^ ch.charCodeAt(0), 16777619), 2166136261),
    )
    const towers = Array.from({ length: spec.towers }, (_, i) => ({
      angle: spec.rotation + (i * Math.PI * 2) / 6,
      height: (2.7 + rand() * 1.1) * s,
    }))
    const tents = Array.from({ length: spec.tents }, (_, i) => ({
      angle: spec.rotation + 0.4 + (i / Math.max(1, spec.tents)) * Math.PI * 1.7 + rand() * 0.25,
      radius: (5.6 + rand() * 1.6) * s,
      size: 0.5 + rand() * 0.28,
      star: i < spec.repo.stars,
    }))
    return { towers, tents, scaffoldAngle: spec.rotation + Math.PI * 0.8 }
  }, [spec, s])

  const stone = STONE[spec.kingdom]
  const stoneDark = STONE_DARK[spec.kingdom]
  const wallR = 4.2 * s
  const banner = spec.biome.color

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    if (e.delta > DRAG_THRESHOLD_PX) return
    setFocus({ kind: 'planet', name })
  }

  return (
    <group position={spec.position} rotation={[0, spec.rotation, 0]}>
      {/* Plateau base pad */}
      <mesh geometry={BASE_GEO} scale={[5.4 * s, 0.5, 5.4 * s]} position={[0, 0.25, 0]}>
        <meshStandardMaterial color={stoneDark} flatShading roughness={0.95} />
      </mesh>

      {/* Hex bailey wall */}
      <mesh geometry={WALL_GEO} scale={[wallR, 2.2 * s, wallR]} position={[0, 1.1 * s + 0.5, 0]}>
        <meshStandardMaterial color={stone} flatShading roughness={0.9} />
      </mesh>

      {/* Wall towers with roofs in the language color */}
      {parts.towers.map((tower, i) => {
        const x = Math.cos(tower.angle) * wallR
        const z = Math.sin(tower.angle) * wallR
        return (
          <group key={i} position={[x, 0.5, z]}>
            <mesh geometry={TOWER_GEO} scale={[0.9 * s, tower.height, 0.9 * s]} position={[0, tower.height / 2, 0]}>
              <meshStandardMaterial color={stone} flatShading roughness={0.9} />
            </mesh>
            <mesh geometry={ROOF_GEO} scale={[1.22 * s, 1.3 * s, 1.22 * s]} position={[0, tower.height + 0.65 * s, 0]}>
              <meshStandardMaterial color={banner} flatShading roughness={0.7} />
            </mesh>
          </group>
        )
      })}

      {/* Central keep + roof + banner */}
      <group position={[0, 0.5, 0]} rotation={[0, Math.PI / 4, 0]}>
        <mesh geometry={KEEP_GEO} scale={[1.9 * s, 4.6 * s, 1.9 * s]} position={[0, 2.3 * s, 0]}>
          <meshStandardMaterial color={stone} flatShading roughness={0.85} />
        </mesh>
        <mesh geometry={ROOF_GEO} scale={[2.3 * s, 1.9 * s, 2.3 * s]} position={[0, 5.55 * s, 0]}>
          <meshStandardMaterial color={banner} flatShading roughness={0.7} />
        </mesh>
        <mesh geometry={POLE_GEO} scale={[1, 2 * s, 1]} position={[0, 7.4 * s, 0]}>
          <meshStandardMaterial color="#3c4152" roughness={0.8} />
        </mesh>
        <mesh geometry={BANNER_GEO} scale={[1.15 * s, s, 1]} position={[0.62 * s, 7.9 * s, 0]}>
          <meshStandardMaterial
            color={banner}
            emissive={banner}
            emissiveIntensity={0.35}
            side={DoubleSide}
            flatShading
          />
        </mesh>
      </group>

      {/* Garrison tents: stars are pale gold, forks grey */}
      {parts.tents.map((tent, i) => (
        <mesh
          key={`tent-${i}`}
          geometry={TENT_GEO}
          scale={[tent.size, tent.size * 1.5, tent.size]}
          position={[
            Math.cos(tent.angle) * tent.radius,
            tent.size * 0.75,
            Math.sin(tent.angle) * tent.radius,
          ]}
        >
          <meshStandardMaterial
            color={tent.star ? TENT_STAR : TENT_FORK}
            flatShading
            roughness={0.95}
          />
        </mesh>
      ))}

      {/* Construction scaffold + warm lantern = recently active */}
      {spec.active && (
        <group
          position={[
            Math.cos(parts.scaffoldAngle) * wallR * 0.55,
            0.5,
            Math.sin(parts.scaffoldAngle) * wallR * 0.55,
          ]}
        >
          <mesh geometry={BEAM_GEO} scale={[s, 5.4 * s, s]} position={[-0.7 * s, 2.7 * s, 0]}>
            <meshStandardMaterial color="#6b5a41" roughness={0.95} />
          </mesh>
          <mesh geometry={BEAM_GEO} scale={[s, 5.4 * s, s]} position={[0.7 * s, 2.7 * s, 0]}>
            <meshStandardMaterial color="#6b5a41" roughness={0.95} />
          </mesh>
          <mesh
            geometry={BEAM_GEO}
            scale={[s, 1.8 * s, s]}
            rotation={[0, 0, Math.PI / 2]}
            position={[0, 5.2 * s, 0]}
          >
            <meshStandardMaterial color="#6b5a41" roughness={0.95} />
          </mesh>
          <mesh geometry={LANTERN_GEO} scale={s} position={[0, 5.7 * s, 0]}>
            <meshStandardMaterial
              color="#ffd27d"
              emissive="#ffb85c"
              emissiveIntensity={1.6}
            />
          </mesh>
          <pointLight color="#ffb85c" intensity={9 * s} distance={16 * s} decay={2} position={[0, 5.7 * s, 0]} />
        </group>
      )}

      {/* Invisible hit volume over the whole castle */}
      <mesh
        geometry={HIT_GEO}
        scale={[5.6 * s, 9 * s, 5.6 * s]}
        position={[0, 4.5 * s, 0]}
        visible={false}
        onClick={handleClick}
        onPointerOver={(e) => {
          e.stopPropagation()
          setHovered(name)
          setLocalHover(true)
        }}
        onPointerOut={() => {
          setHovered(null)
          setLocalHover(false)
        }}
      />

      {showLabel && (
        <Html
          position={[0, 9.6 * s, 0]}
          center
          distanceFactor={42}
          zIndexRange={[8, 0]}
          style={{ pointerEvents: 'none' }}
        >
          <div
            className="planet-label"
            style={spec.highlight && !isHovered ? { opacity: 0.75 } : undefined}
          >
            <span className="planet-label__name">{name}</span>
            <span className="planet-label__lang" style={{ color: spec.biome.color }}>
              {spec.repo.language ?? spec.biome.language}
            </span>
          </div>
        </Html>
      )}
    </group>
  )
}
