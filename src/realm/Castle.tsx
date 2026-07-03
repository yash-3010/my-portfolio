import { useMemo, useRef, useState } from 'react'
import { BoxGeometry, ConeGeometry, CylinderGeometry, DoubleSide } from 'three'
import type { PointLight } from 'three'
import { useFrame } from '@react-three/fiber'
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
const MERLON_GEO = new BoxGeometry(1, 1, 1)
const WINDOW_GEO = new BoxGeometry(0.22, 0.34, 0.06)
const HIT_GEO = new CylinderGeometry(1, 1, 1, 8)

const WINDOW_GLOW = '#ffbf6e'

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

/** Flickering courtyard fire: emissive flame cone + dancing point light. */
function Brazier({ s }: { s: number }) {
  const lightRef = useRef<PointLight>(null)
  useFrame((state) => {
    const light = lightRef.current
    if (!light) return
    const t = state.clock.getElapsedTime()
    light.intensity =
      (7 + Math.sin(t * 11) * 1.6 + Math.sin(t * 23 + 1.7) * 1.1) * s
  })
  return (
    <group position={[2.2 * s, 0.5, 1.4 * s]}>
      <mesh geometry={BRAZIER_GEO} scale={s} position={[0, 0.2 * s, 0]}>
        <meshStandardMaterial color="#3c3630" roughness={0.9} />
      </mesh>
      <mesh geometry={FLAME_GEO} scale={s} position={[0, 0.65 * s, 0]}>
        <meshStandardMaterial
          color="#ff7a2e"
          emissive="#ff9d3c"
          emissiveIntensity={2.6}
        />
      </mesh>
      <pointLight
        ref={lightRef}
        color="#ff9d4c"
        intensity={7}
        distance={18 * s}
        decay={2}
        position={[0, 1.2 * s, 0]}
      />
    </group>
  )
}

const BRAZIER_GEO = new CylinderGeometry(0.34, 0.24, 0.4, 6)
const FLAME_GEO = new ConeGeometry(0.22, 0.62, 5)

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
  const daytime = useGalaxyStore((st) => st.daytime)
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
    // Battlements around the bailey rim + lit keep windows (night detail).
    const merlons = Array.from({ length: 14 }, (_, i) => (i * Math.PI * 2) / 14)
    const windows = Array.from({ length: 6 }, (_, i) => ({
      angle: (i * Math.PI * 2) / 4 + Math.PI / 4,
      y: (2.1 + (i % 2) * 1.4) * s,
      lit: rand() > 0.3,
    }))
    return { towers, tents, merlons, windows, scaffoldAngle: spec.rotation + Math.PI * 0.8 }
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
      <mesh
        geometry={BASE_GEO}
        scale={[5.4 * s, 0.5, 5.4 * s]}
        position={[0, 0.25, 0]}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial color={stoneDark} flatShading roughness={0.95} />
      </mesh>

      {/* Hex bailey wall */}
      <mesh
        geometry={WALL_GEO}
        scale={[wallR, 2.2 * s, wallR]}
        position={[0, 1.1 * s + 0.5, 0]}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial color={stone} flatShading roughness={0.9} />
      </mesh>

      {/* Battlements along the bailey rim */}
      {parts.merlons.map((angle, i) => (
        <mesh
          key={`merlon-${i}`}
          geometry={MERLON_GEO}
          scale={[0.42 * s, 0.34 * s, 0.28 * s]}
          position={[
            Math.cos(angle) * wallR * 0.99,
            2.2 * s + 0.5 + 0.17 * s,
            Math.sin(angle) * wallR * 0.99,
          ]}
          rotation={[0, -angle, 0]}
          castShadow
        >
          <meshStandardMaterial color={stone} flatShading roughness={0.9} />
        </mesh>
      ))}

      {/* Wall towers with roofs in the language color */}
      {parts.towers.map((tower, i) => {
        const x = Math.cos(tower.angle) * wallR
        const z = Math.sin(tower.angle) * wallR
        return (
          <group key={i} position={[x, 0.5, z]}>
            <mesh
              geometry={TOWER_GEO}
              scale={[0.9 * s, tower.height, 0.9 * s]}
              position={[0, tower.height / 2, 0]}
              castShadow
              receiveShadow
            >
              <meshStandardMaterial color={stone} flatShading roughness={0.9} />
            </mesh>
            <mesh
              geometry={ROOF_GEO}
              scale={[1.22 * s, 1.3 * s, 1.22 * s]}
              position={[0, tower.height + 0.65 * s, 0]}
              castShadow
            >
              <meshStandardMaterial color={banner} flatShading roughness={0.7} />
            </mesh>
          </group>
        )
      })}

      {/* Central keep + roof + banner */}
      <group position={[0, 0.5, 0]} rotation={[0, Math.PI / 4, 0]}>
        <mesh
          geometry={KEEP_GEO}
          scale={[1.9 * s, 4.6 * s, 1.9 * s]}
          position={[0, 2.3 * s, 0]}
          castShadow
          receiveShadow
        >
          <meshStandardMaterial color={stone} flatShading roughness={0.85} />
        </mesh>
        {/* Lit keep windows — the warm night detail against the moonlight. */}
        {parts.windows.map((w, i) => (
          <mesh
            key={`window-${i}`}
            geometry={WINDOW_GEO}
            scale={s}
            position={[
              Math.cos(w.angle) * 1.32 * s,
              w.y,
              Math.sin(w.angle) * 1.32 * s,
            ]}
            rotation={[0, -w.angle + Math.PI / 2, 0]}
          >
            <meshStandardMaterial
              color={daytime ? '#141a24' : '#241a10'}
              emissive={WINDOW_GLOW}
              emissiveIntensity={daytime ? 0 : w.lit ? 2.4 : 0.05}
            />
          </mesh>
        ))}
        <mesh
          geometry={ROOF_GEO}
          scale={[2.3 * s, 1.9 * s, 2.3 * s]}
          position={[0, 5.55 * s, 0]}
          castShadow
        >
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
              emissiveIntensity={daytime ? 0.2 : 1.6}
            />
          </mesh>
          {!daytime && (
            <pointLight color="#ffb85c" intensity={9 * s} distance={16 * s} decay={2} position={[0, 5.7 * s, 0]} />
          )}
        </group>
      )}

      {/* Courtyard fire at night — highlight castles only (light budget). */}
      {spec.highlight && !daytime && <Brazier s={s} />}

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
