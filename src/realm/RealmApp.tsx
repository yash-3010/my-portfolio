import { useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { CameraControls, Html } from '@react-three/drei'
import CameraControlsImpl from 'camera-controls'
import { Box3, Color, Fog, Vector3 } from 'three'
import type { GalaxyData } from '../types'
import { buildGalaxy } from '../lib/galaxy'
import { CONSTELLATIONS } from '../lib/palette'
import { useGalaxyStore } from '../state/store'
import { ProjectCard } from '../components/ProjectCard'
import githubJson from '../data/github.json'
import {
  KINGDOM_AMBIENCE,
  REALM_SIZE,
  WATER_LEVEL,
  buildTerrainGeometry,
  climateAt,
  heightAt,
} from './terrain'
import { KINGDOM_ANCHORS, buildRealm, type CastleSpec, type RealmLayout } from './realm'
import { Castle } from './Castle'

/**
 * The Living Realm — Phase 2 (see docs/realm-concept.md).
 * The continent is inhabited: every repo is a castle in its kingdom.
 * Click a castle -> camera flight + the same project card as the galaxy.
 */

const galaxyData = githubJson as GalaxyData
const HALF = REALM_SIZE / 2

/** Kingdom display names for the realm (constellation ids underneath). */
const KINGDOM_NAMES: Record<CastleSpec['kingdom'], string> = {
  tools: 'the frozen reach',
  web: 'the golden vale',
  ai: 'the runelands',
}

const KINGDOM_TINT: Record<CastleSpec['kingdom'], string> = {
  tools: '#9db7e8',
  web: '#d8b869',
  ai: '#a795dd',
}

/* ---------------------------------------------------------------- */
/* Terrain + sea                                                     */
/* ---------------------------------------------------------------- */

function Terrain({ realm }: { realm: RealmLayout }) {
  const geometry = useMemo(() => buildTerrainGeometry(realm.sites), [realm])
  useEffect(() => () => geometry.dispose(), [geometry])
  return (
    <mesh
      geometry={geometry}
      onClick={(e) => {
        // Clicking open ground dismisses the card (terrain would otherwise
        // swallow the click before onPointerMissed sees it).
        if (e.delta < 8) useGalaxyStore.getState().clearFocus()
      }}
    >
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
/* Camera: free roam + focus flights to castles                      */
/* ---------------------------------------------------------------- */

const tmpEye = new Vector3()
const tmpDir = new Vector3()
const tmpTarget = new Vector3()

function isNarrowViewport(): boolean {
  return window.matchMedia('(max-width: 720px)').matches
}

function RealmCamera({ realm }: { realm: RealmLayout }) {
  const ref = useRef<CameraControlsImpl | null>(null)
  const focus = useGalaxyStore((s) => s.focus)

  useEffect(() => {
    const controls = ref.current
    if (!controls) return
    controls.minDistance = 14
    controls.maxDistance = 320
    controls.minPolarAngle = 0.2
    controls.maxPolarAngle = 1.32
    controls.smoothTime = 0.5
    controls.draggingSmoothTime = 0.12
    controls.dollySpeed = 0.7
    controls.mouseButtons.right = CameraControlsImpl.ACTION.TRUCK
    controls.touches.two = CameraControlsImpl.ACTION.TOUCH_DOLLY_TRUCK
    controls.setBoundary(
      new Box3(new Vector3(-HALF, 2, -HALF), new Vector3(HALF, 90, HALF)),
    )
    void controls.setLookAt(0, 95, HALF * 1.35, 0, 4, -20, false)
  }, [])

  // Terrain-following clamp: never let the camera dolly under the ground.
  useFrame(() => {
    const controls = ref.current
    if (!controls) return
    controls.getPosition(tmpEye)
    const floor = heightAt(tmpEye.x, tmpEye.z, realm.sites) + 2.5
    if (tmpEye.y < floor) {
      void controls.setPosition(tmpEye.x, floor, tmpEye.z, false)
    }
  })

  // Focus flights: castle hero shot / back to a mid overview.
  useEffect(() => {
    const controls = ref.current
    if (!controls) return
    if (focus?.kind !== 'planet') {
      if (focus === null) return // stay where the user was; no forced reset
      return
    }
    const castle = realm.castles.find((c) => c.repo.name === focus.name)
    if (!castle) return
    const pos = castle.position
    const dist = (20 + 14 * castle.scale) * (isNarrowViewport() ? 1.15 : 1)
    controls.getPosition(tmpEye)
    tmpDir.copy(tmpEye).sub(pos)
    tmpDir.y = 0
    if (tmpDir.lengthSq() < 1e-6) tmpDir.set(0, 0, 1)
    tmpDir.normalize()
    tmpEye.copy(pos).addScaledVector(tmpDir, dist)
    tmpEye.y = pos.y + 9 + 6 * castle.scale
    tmpTarget.copy(pos)
    tmpTarget.y += 3.5 * castle.scale
    if (isNarrowViewport()) {
      tmpTarget.y -= dist * 0.24
    } else {
      // Shift the subject left of center so the card doesn't cover it.
      tmpDir.cross(new Vector3(0, 1, 0)).normalize()
      tmpTarget.addScaledVector(tmpDir, dist * 0.16)
    }
    void controls.setLookAt(
      tmpEye.x, tmpEye.y, tmpEye.z,
      tmpTarget.x, tmpTarget.y, tmpTarget.z,
      true,
    )
  }, [focus, realm])

  return <CameraControls ref={ref} makeDefault />
}

/* ---------------------------------------------------------------- */
/* Kingdom name markers                                              */
/* ---------------------------------------------------------------- */

function KingdomLabels() {
  return (
    <>
      {(Object.keys(KINGDOM_ANCHORS) as CastleSpec['kingdom'][]).map((id) => (
        <Html
          key={id}
          position={[KINGDOM_ANCHORS[id].x, 16, KINGDOM_ANCHORS[id].z]}
          center
          distanceFactor={140}
          zIndexRange={[8, 0]}
          style={{ pointerEvents: 'none' }}
        >
          <div className="kingdom-label" style={{ color: KINGDOM_TINT[id] }}>
            {KINGDOM_NAMES[id]}
          </div>
        </Html>
      ))}
    </>
  )
}

/* ---------------------------------------------------------------- */
/* App shell                                                         */
/* ---------------------------------------------------------------- */

export default function RealmApp() {
  const realm = useMemo(() => buildRealm(galaxyData), [])
  // The galaxy layout supplies the PlanetSpecs the shared ProjectCard reads.
  const galaxyLayout = useMemo(() => buildGalaxy(galaxyData), [])
  const focused = useGalaxyStore((s) => s.focus !== null)
  const pointerDown = useRef({ x: 0, y: 0 })

  // The realm has no loading screen or intro rail yet: unlock focus
  // immediately, and clear any focus carried over from the galaxy.
  useEffect(() => {
    const store = useGalaxyStore.getState()
    store.setReady()
    store.setRevealed()
    store.setIntroDone()
    store.clearFocus()
    return () => useGalaxyStore.getState().clearFocus()
  }, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') useGalaxyStore.getState().clearFocus()
    }
    const onPointerDown = (e: PointerEvent) => {
      pointerDown.current.x = e.clientX
      pointerDown.current.y = e.clientY
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('pointerdown', onPointerDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('pointerdown', onPointerDown)
    }
  }, [])

  return (
    <div className="app">
      <div className="canvas-wrap">
        <Canvas
          dpr={[1, 2]}
          camera={{ fov: 50, near: 0.5, far: 900, position: [0, 130, 320] }}
          gl={{ antialias: true, powerPreference: 'high-performance' }}
          onPointerMissed={(e) => {
            const dx = e.clientX - pointerDown.current.x
            const dy = e.clientY - pointerDown.current.y
            if (Math.hypot(dx, dy) < 8) useGalaxyStore.getState().clearFocus()
          }}
        >
          <hemisphereLight args={['#8ea4d8', '#2b2620', 0.75]} />
          <directionalLight
            position={[-120, 140, 80]}
            color="#ffd9a8"
            intensity={2.9}
          />
          <ClimateAmbience />
          <Terrain realm={realm} />
          <Sea />
          {realm.castles.map((castle) => (
            <Castle key={castle.repo.name} spec={castle} />
          ))}
          <KingdomLabels />
          <RealmCamera realm={realm} />
        </Canvas>
      </div>

      <div className={`realm-hud${focused ? ' realm-hud--focused' : ''}`}>
        <div className="realm-hud__brand">
          <h1 className="hud__name">THE LIVING REALM</h1>
          <p className="hud__sub">every repo is a castle</p>
          <p className="realm-hud__zones">
            {(Object.keys(KINGDOM_NAMES) as CastleSpec['kingdom'][]).map((id) => (
              <span key={id} style={{ color: KINGDOM_TINT[id] }}>
                {KINGDOM_NAMES[id]} · {CONSTELLATIONS[id].label.toLowerCase()}
              </span>
            ))}
          </p>
        </div>
        <a className="realm-hud__back" href="#/">
          ← back to the galaxy
        </a>
        <div className="realm-hud__hint">
          <span className="hint--fine">drag to orbit · right-drag to pan · click a castle</span>
          <span className="hint--coarse">one finger to orbit · two to pan &amp; zoom · tap a castle</span>
        </div>
      </div>

      <ProjectCard data={galaxyData} layout={galaxyLayout} />
    </div>
  )
}
