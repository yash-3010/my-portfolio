import { Suspense, useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { CameraControls, Environment, Html, Stars } from '@react-three/drei'
import { Bloom, EffectComposer, N8AO, Vignette } from '@react-three/postprocessing'
import CameraControlsImpl from 'camera-controls'
import { suspend } from 'suspend-react'
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
  WALL_SPAN_X,
  WATER_LEVEL,
  buildTerrainGeometry,
  climateAt,
  heightAt,
} from './terrain'
import { KINGDOM_ANCHORS, buildRealm, type CastleSpec, type RealmLayout } from './realm'
import { Castle } from './Castle'
import { buildWall, type WallBuild } from './wall'
import { Wall } from './Wall'
import { Trees } from './Trees'
import { Lightning } from './Lightning'
import { makeNoiseNormalMap } from './textures'

const nightHdri = import('@pmndrs/assets/hdri/night.exr')

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
  const detail = useMemo(() => makeNoiseNormalMap(0x9e0a2d, 1.8), [])
  return (
    <mesh
      geometry={geometry}
      castShadow
      receiveShadow
      onClick={(e) => {
        // Clicking open ground dismisses the card (terrain would otherwise
        // swallow the click before onPointerMissed sees it).
        if (e.delta < 8) useGalaxyStore.getState().clearFocus()
      }}
    >
      <meshStandardMaterial
        vertexColors
        roughness={0.93}
        normalMap={detail}
        normalScale={[0.55, 0.55]}
      />
    </mesh>
  )
}

function Sea() {
  const normals = useMemo(() => {
    const t = makeNoiseNormalMap(0x05ea, 1.1)
    t.repeat.set(30, 30)
    return t
  }, [])
  useFrame((_, delta) => {
    normals.offset.x += delta * 0.008
    normals.offset.y += delta * 0.0045
  })
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, WATER_LEVEL, 0]} receiveShadow>
      <planeGeometry args={[REALM_SIZE * 2.2, REALM_SIZE * 2.2]} />
      <meshStandardMaterial
        color="#0f2137"
        roughness={0.14}
        metalness={0.08}
        normalMap={normals}
        normalScale={[0.35, 0.35]}
        transparent
        opacity={0.96}
        emissive="#081525"
        emissiveIntensity={0.5}
        envMapIntensity={0.35}
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

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

function RealmCamera({ realm, wall }: { realm: RealmLayout; wall: WallBuild }) {
  const ref = useRef<CameraControlsImpl | null>(null)
  const focus = useGalaxyStore((s) => s.focus)
  const camera = useThree((s) => s.camera)
  const walking = focus?.kind === 'wall'
  const walk = useRef({ active: false, current: 0, target: 0, lastDay: -1 })

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
  // (Skipped while walking the Wall — the rail owns the camera then.)
  useFrame(() => {
    const controls = ref.current
    if (!controls || !controls.enabled) return
    controls.getPosition(tmpEye)
    const floor = heightAt(tmpEye.x, tmpEye.z, realm.sites) + 2.5
    if (tmpEye.y < floor) {
      void controls.setPosition(tmpEye.x, floor, tmpEye.z, false)
    }
  })

  /* ------------------------------------------------------------ */
  /* Walk the year: rail mode along the Wall's crown               */
  /* ------------------------------------------------------------ */
  useEffect(() => {
    const controls = ref.current
    if (!controls || !walking) return
    const state = walk.current

    // Enter at the rail point nearest the camera's current x.
    controls.getPosition(tmpEye)
    const startT = clamp01((tmpEye.x + WALL_SPAN_X) / (WALL_SPAN_X * 2)) * 0.97 + 0.01
    state.current = startT
    state.target = startT
    const p = wall.rail.getPointAt(startT)
    const ahead = wall.rail.getPointAt(Math.min(1, startT + 0.025))
    let cancelled = false
    void controls
      .setLookAt(p.x, p.y + 2.4, p.z, ahead.x, ahead.y + 2.0, ahead.z, true)
      .then(() => {
        if (cancelled) return
        controls.enabled = false
        state.active = true
      })

    // Scrub input: wheel on desktop, vertical drag on touch.
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      state.target = clamp01(state.target + e.deltaY * 0.00022)
    }
    let dragY: number | null = null
    const onDown = (e: PointerEvent) => {
      dragY = e.clientY
    }
    const onMove = (e: PointerEvent) => {
      if (dragY === null) return
      state.target = clamp01(state.target + (dragY - e.clientY) * 0.0011)
      dragY = e.clientY
    }
    const onUp = () => {
      dragY = null
    }
    window.addEventListener('wheel', onWheel, { passive: false })
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)

    return () => {
      cancelled = true
      window.removeEventListener('wheel', onWheel)
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      state.active = false
      controls.enabled = true
      // Pull back to a viewing pose over where the walk ended.
      const q = wall.rail.getPointAt(clamp01(state.current))
      void controls.setLookAt(q.x, q.y + 13, q.z + 32, q.x, q.y, q.z, true)
    }
  }, [walking, wall])

  useFrame((_, delta) => {
    const state = walk.current
    if (!state.active) return
    state.current += (state.target - state.current) * Math.min(1, delta * 3.2)
    const t = clamp01(state.current)
    const p = wall.rail.getPointAt(t)
    // Near-level gaze: crown line ahead, the realm falling away beside you.
    const ahead = wall.rail.getPointAt(Math.min(1, t + 0.025))
    camera.position.set(p.x, p.y + 2.4, p.z)
    camera.lookAt(ahead.x, ahead.y + 2.0, ahead.z)
    const day = Math.round(t * (wall.days.length - 1))
    if (day !== state.lastDay) {
      state.lastDay = day
      useGalaxyStore.getState().setWallDay(day)
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
  const wall = useMemo(() => buildWall(galaxyData.contributions), [])
  // The galaxy layout supplies the PlanetSpecs the shared ProjectCard reads.
  const galaxyLayout = useMemo(() => buildGalaxy(galaxyData), [])
  const focused = useGalaxyStore((s) => s.focus !== null)
  const pointerDown = useRef({ x: 0, y: 0 })
  // Desktop gets the full treatment; coarse-pointer devices skip AO and
  // halve the forest + shadow resolution.
  const highQ = useMemo(() => window.matchMedia('(pointer: fine)').matches, [])

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
          shadows
          camera={{ fov: 50, near: 0.5, far: 900, position: [0, 130, 320] }}
          gl={{ antialias: true, powerPreference: 'high-performance' }}
          onPointerMissed={(e) => {
            const dx = e.clientX - pointerDown.current.x
            const dy = e.clientY - pointerDown.current.y
            if (Math.hypot(dx, dy) < 8) useGalaxyStore.getState().clearFocus()
          }}
        >
          {/* Moonlight key with real shadows; faint warm western rim. */}
          <hemisphereLight args={['#1a2440', '#0a0806', 0.55]} />
          <directionalLight
            castShadow
            position={[70, 130, -50]}
            color="#b9cfff"
            intensity={2.1}
            shadow-mapSize={highQ ? [2048, 2048] : [1024, 1024]}
            shadow-camera-left={-170}
            shadow-camera-right={170}
            shadow-camera-top={170}
            shadow-camera-bottom={-170}
            shadow-camera-near={10}
            shadow-camera-far={500}
            shadow-bias={-0.0003}
            shadow-normalBias={0.6}
          />
          <directionalLight position={[-140, 60, 90]} color="#ff9d5c" intensity={0.2} />
          <Lightning />
          <ClimateAmbience />
          <Suspense fallback={null}>
            <Terrain realm={realm} />
            <Sea />
            <Trees realm={realm} count={highQ ? 2600 : 1300} />
            {realm.castles.map((castle) => (
              <Castle key={castle.repo.name} spec={castle} />
            ))}
            <Wall wall={wall} />
            <KingdomLabels />
            <RealmCamera realm={realm} wall={wall} />
            <Stars radius={380} depth={80} count={2200} factor={4} saturation={0} fade speed={0.5} />
            {/* Real HDRI night lighting (bundled, no network fetch). */}
            <Environment files={(suspend(nightHdri) as { default: string }).default} />
            <EffectComposer multisampling={0}>
              {highQ ? (
                <N8AO aoRadius={2.4} intensity={2.4} distanceFalloff={0.7} />
              ) : (
                <></>
              )}
              <Bloom
                mipmapBlur
                luminanceThreshold={0.82}
                luminanceSmoothing={0.18}
                intensity={0.75}
              />
              <Vignette offset={0.22} darkness={0.72} />
            </EffectComposer>
          </Suspense>
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
          <span className="hint--fine">drag to orbit · right-drag to pan · click a castle or the wall</span>
          <span className="hint--coarse">one finger to orbit · two to pan &amp; zoom · tap a castle</span>
        </div>
      </div>

      <WallReadout wall={wall} />
      <ProjectCard data={galaxyData} layout={galaxyLayout} />
    </div>
  )
}

/* ---------------------------------------------------------------- */
/* Walk-the-year readout                                             */
/* ---------------------------------------------------------------- */

function WallReadout({ wall }: { wall: WallBuild }) {
  const walking = useGalaxyStore((s) => s.focus?.kind === 'wall')
  const idx = useGalaxyStore((s) => s.wallDay)
  if (!walking) return null
  const day = wall.days[Math.min(idx, wall.days.length - 1)]
  const date = new Date(`${day.date}T00:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })
  return (
    <div className="wall-hud glass" role="status" aria-live="polite">
      <div className="wall-hud__date">{date}</div>
      <div className="wall-hud__count">
        {day.count} commit{day.count === 1 ? '' : 's'}
      </div>
      <div className="wall-hud__bar" aria-hidden="true">
        <div style={{ width: `${Math.round((day.count / wall.maxCount) * 100)}%` }} />
      </div>
      <div className="wall-hud__hint">
        <span className="hint--fine">scroll to walk the year · esc to leave</span>
        <span className="hint--coarse">drag up &amp; down to walk the year</span>
      </div>
      <button
        className="btn"
        onClick={() => useGalaxyStore.getState().clearFocus()}
      >
        leave the wall
      </button>
    </div>
  )
}
