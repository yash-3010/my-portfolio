import { useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { AdditiveBlending } from 'three'
import type { Group } from 'three'
import { Html, useCursor } from '@react-three/drei'
import { SUN_RADIUS } from '../lib/galaxy'
import { galaxyClock } from '../state/store'
import { getGlowTexture } from './Sun'

/**
 * The system is a hierarchical triple (à la Trisolaris, kept stable):
 *  - Star B, a small amber companion, whirls tightly around the main sun on
 *    the inner reference ring — together they read as the central pair.
 *  - Star C, a coral dwarf, circles the whole system far beyond the planets;
 *    you find it by zooming out or orbiting, like the mock's "zoom out for
 *    star C" hint.
 * Both ride the freezable galaxy clock. Neither carries the identity or data
 * of a repo — they're the sky's architecture, so they stay non-focusable.
 */

const B_COLOR = '#ff9e52'
const B_GLOW = '#ffb36b'
/** Rides the previously decorative inner reference ring. */
const B_ORBIT = SUN_RADIUS * 1.9
const B_SIZE = SUN_RADIUS * 0.32
const B_SPEED = 0.11

const C_COLOR = '#ff6a54'
const C_GLOW = '#ff8a70'
const C_SIZE = SUN_RADIUS * 0.5
/** Distance as a multiple of the outermost orbit — beyond the planets. */
const C_DIST = 2.0
const C_SPEED = 0.005
const C_INCLINATION = 0.32

export function CompanionStars({ maxR }: { maxR: number }) {
  const bRef = useRef<Group>(null)
  const cRef = useRef<Group>(null)
  const [hoveredB, setHoveredB] = useState(false)
  const [hoveredC, setHoveredC] = useState(false)
  useCursor(hoveredB || hoveredC)

  useFrame(() => {
    const t = galaxyClock.t
    if (bRef.current) {
      const a = t * B_SPEED
      bRef.current.position.set(Math.cos(a) * B_ORBIT, 0, Math.sin(a) * B_ORBIT)
    }
    if (cRef.current) {
      const a = Math.PI * 0.35 + t * C_SPEED
      const r = maxR * C_DIST
      cRef.current.position.set(
        Math.cos(a) * r,
        Math.sin(a) * r * Math.sin(C_INCLINATION),
        Math.sin(a) * r,
      )
    }
  })

  return (
    <>
      {/* Star B — tight companion. */}
      <group ref={bRef}>
        <pointLight color={B_GLOW} intensity={40} decay={1.8} />
        <mesh raycast={() => null}>
          <icosahedronGeometry args={[B_SIZE, 2]} />
          <meshStandardMaterial
            color="#ff8a3d"
            emissive={B_COLOR}
            emissiveIntensity={1.2}
            flatShading
            roughness={0.6}
          />
        </mesh>
        <sprite scale={B_SIZE * 6.5} raycast={() => null}>
          <spriteMaterial
            map={getGlowTexture()}
            color={B_GLOW}
            transparent
            opacity={0.45}
            depthWrite={false}
            blending={AdditiveBlending}
          />
        </sprite>
        <mesh
          visible={false}
          onPointerOver={(e) => {
            e.stopPropagation()
            setHoveredB(true)
          }}
          onPointerOut={() => setHoveredB(false)}
        >
          <sphereGeometry args={[B_SIZE * 2.4, 10, 10]} />
        </mesh>
        {hoveredB && (
          <Html
            position={[0, B_SIZE + 1.0, 0]}
            center
            distanceFactor={16}
            zIndexRange={[8, 0]}
            style={{ pointerEvents: 'none' }}
          >
            <div className="planet-label">
              <span className="planet-label__name">star B</span>
              <span className="planet-label__lang" style={{ color: B_GLOW }}>
                close companion
              </span>
            </div>
          </Html>
        )}
      </group>

      {/* Star C — the far wanderer. */}
      <group ref={cRef}>
        <mesh raycast={() => null}>
          <icosahedronGeometry args={[C_SIZE, 2]} />
          <meshBasicMaterial color={C_GLOW} fog={false} />
        </mesh>
        <sprite scale={C_SIZE * 9} raycast={() => null}>
          <spriteMaterial
            map={getGlowTexture()}
            color={C_COLOR}
            transparent
            opacity={0.6}
            depthWrite={false}
            blending={AdditiveBlending}
            fog={false}
          />
        </sprite>
        <mesh
          visible={false}
          onPointerOver={(e) => {
            e.stopPropagation()
            setHoveredC(true)
          }}
          onPointerOut={() => setHoveredC(false)}
        >
          <sphereGeometry args={[C_SIZE * 3, 10, 10]} />
        </mesh>
        {hoveredC && (
          <Html
            position={[0, C_SIZE + 1.2, 0]}
            center
            distanceFactor={16}
            zIndexRange={[8, 0]}
            style={{ pointerEvents: 'none' }}
          >
            <div className="planet-label">
              <span className="planet-label__name">star C</span>
              <span className="planet-label__lang" style={{ color: C_GLOW }}>
                distant companion
              </span>
            </div>
          </Html>
        )}
      </group>
    </>
  )
}
