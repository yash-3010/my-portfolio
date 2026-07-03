import { useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { CameraControls } from '@react-three/drei'
import CameraControlsImpl from 'camera-controls'
import { Box3, Color, Fog, Vector3 } from 'three'
import {
  KINGDOM_AMBIENCE,
  REALM_SIZE,
  WATER_LEVEL,
  buildTerrainGeometry,
  climateAt,
} from './terrain'

/**
 * The Living Realm — Phase 1 (see docs/realm-concept.md).
 * A walkable empty continent: island terrain, three climate kingdoms with
 * ambience that shifts as you travel, dusk lighting, free-roam camera.
 * Castles, the Wall, and the intro rail arrive in later phases.
 */

const HALF = REALM_SIZE / 2

/* ---------------------------------------------------------------- */
/* Terrain + sea                                                     */
/* ---------------------------------------------------------------- */

function Terrain() {
  const geometry = useMemo(() => buildTerrainGeometry(), [])
  useEffect(() => () => geometry.dispose(), [geometry])
  return (
    <mesh geometry={geometry} receiveShadow>
      <meshStandardMaterial vertexColors flatShading roughness={0.95} />
    </mesh>
  )
}

function Sea() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, WATER_LEVEL, 0]}>
      <planeGeometry args={[REALM_SIZE * 2.2, REALM_SIZE * 2.2]} />
      <meshStandardMaterial
        color="#274b74"
        roughness={0.2}
        metalness={0.15}
        transparent
        opacity={0.95}
        emissive="#16345c"
        emissiveIntensity={0.55}
      />
    </mesh>
  )
}

/* ---------------------------------------------------------------- */
/* Climate ambience: fog + sky lerp toward the kingdom under camera  */
/* ---------------------------------------------------------------- */

const skyTarget = new Color()
const fogTarget = new Color()

function ClimateAmbience() {
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)

  // Install fog + background once.
  useEffect(() => {
    scene.fog = new Fog('#1a1420', 230, 640)
    scene.background = new Color('#171310')
  }, [scene])

  useFrame((_, delta) => {
    const fog = scene.fog as Fog | null
    const bg = scene.background as Color | null
    if (!fog || !bg) return
    const { frozen, vale, rune } = climateAt(camera.position.x, camera.position.z)
    skyTarget.setRGB(
      KINGDOM_AMBIENCE.frozen.sky.r * frozen +
        KINGDOM_AMBIENCE.vale.sky.r * vale +
        KINGDOM_AMBIENCE.rune.sky.r * rune,
      KINGDOM_AMBIENCE.frozen.sky.g * frozen +
        KINGDOM_AMBIENCE.vale.sky.g * vale +
        KINGDOM_AMBIENCE.rune.sky.g * rune,
      KINGDOM_AMBIENCE.frozen.sky.b * frozen +
        KINGDOM_AMBIENCE.vale.sky.b * vale +
        KINGDOM_AMBIENCE.rune.sky.b * rune,
    )
    fogTarget.setRGB(
      KINGDOM_AMBIENCE.frozen.fog.r * frozen +
        KINGDOM_AMBIENCE.vale.fog.r * vale +
        KINGDOM_AMBIENCE.rune.fog.r * rune,
      KINGDOM_AMBIENCE.frozen.fog.g * frozen +
        KINGDOM_AMBIENCE.vale.fog.g * vale +
        KINGDOM_AMBIENCE.rune.fog.g * rune,
      KINGDOM_AMBIENCE.frozen.fog.b * frozen +
        KINGDOM_AMBIENCE.vale.fog.b * vale +
        KINGDOM_AMBIENCE.rune.fog.b * rune,
    )
    const k = Math.min(1, delta * 2)
    bg.lerp(skyTarget, k)
    fog.color.lerp(fogTarget, k)
  })
  return null
}

/* ---------------------------------------------------------------- */
/* Camera: free roam clamped to a dome over the continent            */
/* ---------------------------------------------------------------- */

function RealmCamera() {
  const ref = useRef<CameraControlsImpl | null>(null)

  useEffect(() => {
    const controls = ref.current
    if (!controls) return
    controls.minDistance = 24
    controls.maxDistance = 320
    controls.minPolarAngle = 0.2
    controls.maxPolarAngle = 1.32
    controls.smoothTime = 0.4
    controls.draggingSmoothTime = 0.12
    controls.dollySpeed = 0.7
    // Panning IS the point on a map — right-drag / two-finger truck.
    controls.mouseButtons.right = CameraControlsImpl.ACTION.TRUCK
    controls.touches.two = CameraControlsImpl.ACTION.TOUCH_DOLLY_TRUCK
    controls.setBoundary(
      new Box3(new Vector3(-HALF, 2, -HALF), new Vector3(HALF, 90, HALF)),
    )
    // Establishing pose: south coast looking north across all three kingdoms.
    void controls.setLookAt(0, 95, HALF * 1.35, 0, 4, -20, false)
  }, [])

  return <CameraControls ref={ref} makeDefault />
}

/* ---------------------------------------------------------------- */
/* App shell                                                         */
/* ---------------------------------------------------------------- */

export default function RealmApp() {
  return (
    <div className="app">
      <div className="canvas-wrap">
        <Canvas
          dpr={[1, 2]}
          camera={{ fov: 50, near: 0.5, far: 900, position: [0, 130, 320] }}
          gl={{ antialias: true, powerPreference: 'high-performance' }}
        >
          <hemisphereLight args={['#8ea4d8', '#2b2620', 0.55]} />
          <directionalLight
            position={[-120, 140, 80]}
            color="#ffd9a8"
            intensity={2.9}
          />
          <ClimateAmbience />
          <Terrain />
          <Sea />
          <RealmCamera />
        </Canvas>
      </div>

      <div className="realm-hud">
        <div className="realm-hud__brand">
          <h1 className="hud__name">THE LIVING REALM</h1>
          <p className="hud__sub">Phase 1 · an empty continent, for now</p>
          <p className="realm-hud__zones">
            <span style={{ color: '#9db7e8' }}>❄ the frozen reach</span>
            <span style={{ color: '#d8b869' }}>☀ the golden vale</span>
            <span style={{ color: '#a795dd' }}>✦ the runelands</span>
          </p>
        </div>
        <a className="realm-hud__back" href="#/">
          ← back to the galaxy
        </a>
        <div className="realm-hud__hint">
          <span className="hint--fine">drag to orbit · right-drag to pan · scroll to zoom</span>
          <span className="hint--coarse">one finger to orbit · two fingers to pan &amp; zoom</span>
        </div>
      </div>
    </div>
  )
}
