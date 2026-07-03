import { useEffect, useMemo, useState } from 'react'
import {
  AdditiveBlending,
  CanvasTexture,
  RepeatWrapping,
  ShaderMaterial,
  Vector2,
} from 'three'
import { useFrame } from '@react-three/fiber'
import type { ThreeEvent } from '@react-three/fiber'
import { Html, useCursor } from '@react-three/drei'
import { useGalaxyStore } from '../state/store'
import type { WallBuild } from './wall'
import { WALL_THICKNESS } from './wall'
import { makeNoise2D } from './noise'

/**
 * Render layer for the Wall: smooth-shaded ice body (physical material,
 * procedural normal map, env reflections), additive commit-veins that
 * breathe, and the hit volume that enters walk-the-year mode.
 */

/* ---------------------------------------------------------------- */
/* Procedural ice normal map (no downloaded assets)                  */
/* ---------------------------------------------------------------- */

let iceNormalMap: CanvasTexture | null = null

function getIceNormalMap(): CanvasTexture {
  if (iceNormalMap) return iceNormalMap
  const size = 256
  const noise = makeNoise2D(0x1ce0f2)
  // Multi-octave height field.
  const height = new Float32Array(size * size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = 0
      let amp = 1
      let freq = 4 / size
      for (let o = 0; o < 4; o++) {
        v += noise(x * freq, y * freq) * amp
        amp *= 0.5
        freq *= 2
      }
      height[y * size + x] = v / 1.875
    }
  }
  // Sobel -> tangent-space normals.
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const img = ctx.createImageData(size, size)
  const strength = 2.2
  const at = (x: number, y: number) =>
    height[((y + size) % size) * size + ((x + size) % size)]
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength
      const len = Math.sqrt(dx * dx + dy * dy + 1)
      const i = (y * size + x) * 4
      img.data[i] = ((-dx / len) * 0.5 + 0.5) * 255
      img.data[i + 1] = ((-dy / len) * 0.5 + 0.5) * 255
      img.data[i + 2] = (1 / len) * 0.5 + 0.5 > 1 ? 255 : ((1 / len) * 0.5 + 0.5) * 255
      img.data[i + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  iceNormalMap = new CanvasTexture(canvas)
  iceNormalMap.wrapS = RepeatWrapping
  iceNormalMap.wrapT = RepeatWrapping
  // Geometry carries world-space UVs; one repeat ≈ 6 world units.
  iceNormalMap.repeat.set(1, 1)
  return iceNormalMap
}

/* ---------------------------------------------------------------- */
/* Commit-vein shader                                                */
/* ---------------------------------------------------------------- */

const VEIN_VERTEX = /* glsl */ `
  attribute float aGlow;
  varying float vGlow;
  varying float vY;
  void main() {
    vGlow = aGlow;
    vY = position.y;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const VEIN_FRAGMENT = /* glsl */ `
  uniform float uTime;
  varying float vGlow;
  varying float vY;
  void main() {
    vec3 dim = vec3(0.16, 0.38, 0.52);
    vec3 hot = vec3(0.56, 0.88, 1.0);
    vec3 color = mix(dim, hot, vGlow);
    float pulse = 0.82 + 0.18 * sin(uTime * 1.1 + vY * 0.7 + vGlow * 6.0);
    // Quiet days barely whisper; busy days burn — otherwise 240 commit-days
    // of seed data read as a solid barcode.
    float alpha = (0.06 + 0.94 * pow(vGlow, 1.6)) * pulse;
    gl_FragColor = vec4(color * alpha, alpha);
  }
`

const DRAG_THRESHOLD_PX = 8

export function Wall({ wall }: { wall: WallBuild }) {
  const setFocus = useGalaxyStore((s) => s.setFocus)
  const focus = useGalaxyStore((s) => s.focus)
  const [hovered, setHovered] = useState(false)
  useCursor(hovered)

  const veinMaterial = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: { uTime: { value: 0 } },
        vertexShader: VEIN_VERTEX,
        fragmentShader: VEIN_FRAGMENT,
        blending: AdditiveBlending,
        transparent: true,
        depthWrite: false,
      }),
    [],
  )
  useEffect(() => () => veinMaterial.dispose(), [veinMaterial])

  useFrame((state) => {
    veinMaterial.uniforms.uTime.value = state.clock.getElapsedTime()
  })

  const walking = focus?.kind === 'wall'

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    if (e.delta > DRAG_THRESHOLD_PX) return
    setFocus({ kind: 'wall' })
  }

  // Hit volume: an invisible slab following the wall's bounding region.
  const bounds = useMemo(() => {
    wall.bodyGeometry.computeBoundingBox()
    return wall.bodyGeometry.boundingBox!
  }, [wall])
  const center = useMemo(
    () => ({
      x: (bounds.min.x + bounds.max.x) / 2,
      y: (bounds.min.y + bounds.max.y) / 2,
      z: (bounds.min.z + bounds.max.z) / 2,
    }),
    [bounds],
  )

  return (
    <group>
      {/* Cold fill from beyond the Wall so the ice reads glacial blue
          against the realm's warm dusk key light. */}
      <directionalLight position={[0, 50, -160]} color="#7fb0ff" intensity={1.1} />

      {/* Ice body — deliberately high-fidelity: smooth shading, physical
          material, procedural normal detail, environment reflections. */}
      <mesh geometry={wall.bodyGeometry} castShadow receiveShadow>
        <meshPhysicalMaterial
          vertexColors
          roughness={0.36}
          metalness={0}
          clearcoat={0.55}
          clearcoatRoughness={0.35}
          normalMap={getIceNormalMap()}
          normalScale={new Vector2(0.85, 0.85)}
          envMapIntensity={0.9}
        />
      </mesh>

      {/* Commit veins */}
      {wall.veinGeometry && (
        <mesh geometry={wall.veinGeometry} material={veinMaterial} />
      )}

      {/* Hit slab */}
      <mesh
        position={[center.x, center.y, center.z]}
        visible={false}
        onClick={handleClick}
        onPointerOver={(e) => {
          e.stopPropagation()
          setHovered(true)
        }}
        onPointerOut={() => setHovered(false)}
      >
        <boxGeometry
          args={[
            bounds.max.x - bounds.min.x,
            bounds.max.y - bounds.min.y,
            (bounds.max.z - bounds.min.z) + WALL_THICKNESS,
          ]}
        />
      </mesh>

      {hovered && !walking && (
        <Html
          position={[0, bounds.max.y + 3.5, wall.rail.getPointAt(0.5).z]}
          center
          distanceFactor={60}
          zIndexRange={[8, 0]}
          style={{ pointerEvents: 'none' }}
        >
          <div className="planet-label">
            <span className="planet-label__name">the wall</span>
            <span className="planet-label__lang" style={{ color: '#8fe0ff' }}>
              365 days of commits · click to walk the year
            </span>
          </div>
        </Html>
      )}
    </group>
  )
}
