import { Suspense, useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { useProgress } from '@react-three/drei'
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing'
import type { PerspectiveCamera } from 'three'
import type { GalaxyData } from '../types'
import { AU, type GalaxyLayout } from '../lib/galaxy'
import { assignPlanetTextures } from '../lib/planetSurface'
import { galaxyClock, useGalaxyStore } from '../state/store'
import { Skybox } from './Skybox'
import { Sun } from './Sun'
import { Planet } from './Planet'
import { DwarfPlanet } from './DwarfPlanet'
import { AsteroidBelt } from './AsteroidBelt'
import { Orbits } from './Orbits'
import { CameraRig, introStartPosition } from './CameraRig'

/**
 * Advances the galaxy clock in simulated years. `scale` eases toward 0 while
 * a card is focused so orbits freeze smoothly; toward 1 when the focus
 * clears. `yps`/`playing` are the user's speed controls (HUD sliders).
 */
function ClockTicker() {
  useFrame((_, delta) => {
    const target = useGalaxyStore.getState().focus ? 0 : 1
    galaxyClock.scale += (target - galaxyClock.scale) * Math.min(1, delta * 3)
    if (galaxyClock.playing) {
      galaxyClock.t += delta * galaxyClock.scale * galaxyClock.yps
    }
  })
  return null
}

/**
 * Signals `ready` (the loading screen's gate) only once EVERY asset —
 * planet/sun textures, the asteroid GLB, the skybox — has come through
 * three's DefaultLoadingManager AND a few frames have painted afterward,
 * so GPU texture uploads and shader compiles are also behind the loader.
 * A timeout backstop keeps a broken asset from trapping the loader forever.
 */
const READY_SETTLE_FRAMES = 4
const READY_TIMEOUT_MS = 15_000

function ReadySignal() {
  const { active } = useProgress()
  const startedRef = useRef(false)
  const settledFrames = useRef(0)
  if (active) startedRef.current = true

  useEffect(() => {
    const timer = window.setTimeout(
      () => useGalaxyStore.getState().setReady(),
      READY_TIMEOUT_MS,
    )
    return () => window.clearTimeout(timer)
  }, [])

  useFrame(() => {
    if (useGalaxyStore.getState().ready) return
    if (!startedRef.current || active) {
      settledFrames.current = 0
      return
    }
    settledFrames.current += 1
    if (settledFrames.current >= READY_SETTLE_FRAMES) {
      useGalaxyStore.getState().setReady()
    }
  })
  return null
}

/**
 * Feeds the HUD telemetry readout (T+yr and the px-per-AU scale) by mutating
 * the DOM directly — the values change every frame and must never trigger
 * React renders. Mirrors the reference sim's top-left panel.
 */
function TelemetryProbe() {
  const lastYear = useRef(-1)
  const lastScale = useRef(-1)
  useFrame((state) => {
    const year = Math.floor(galaxyClock.t)
    if (year !== lastYear.current) {
      lastYear.current = year
      const el = document.getElementById('tele-yr')
      if (el) el.textContent = year.toLocaleString()
    }
    // Screen-space size of 1 AU at the barycenter's depth.
    const cam = state.camera as PerspectiveCamera
    const dist = cam.position.length()
    const px = Math.round(
      (AU * (state.size.height / 2)) / (Math.tan((cam.fov * Math.PI) / 360) * dist),
    )
    if (px !== lastScale.current && Number.isFinite(px)) {
      lastScale.current = px
      const el = document.getElementById('tele-scale')
      if (el) el.textContent = String(px)
    }
  })
  return null
}

export function GalaxyCanvas({ data, layout }: { data: GalaxyData; layout: GalaxyLayout }) {
  const maxR = layout.maxOrbitRadius
  const pointerDown = useRef({ x: 0, y: 0 })
  // Each repo gets its own solar-system body (needs the whole roster to vary).
  const textureByRepo = useMemo(() => assignPlanetTextures(layout.planets), [layout])
  // Belt = the whole journey: every commit in the snapshot, not just the
  // repos that earn planets.
  const totalCommits = useMemo(
    () => data.repos.reduce((sum, r) => sum + r.commits, 0),
    [data],
  )

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      pointerDown.current.x = e.clientX
      pointerDown.current.y = e.clientY
    }
    window.addEventListener('pointerdown', onPointerDown)
    return () => window.removeEventListener('pointerdown', onPointerDown)
  }, [])

  return (
    <div className="canvas-wrap">
      <Canvas
        dpr={[1, 2]}
        camera={{
          fov: 50,
          near: 0.5,
          // Must cover the skybox's far side from controls.maxDistance
          // (3.6·maxR + 6·maxR ≈ 9.6·maxR). Per-primitive far-plane clipping
          // ignores frustumCulled={false}, so this can't be undersized.
          far: Math.max(300, maxR * 12),
          position: introStartPosition(layout.frameRadius),
        }}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        onPointerMissed={(e) => {
          // Only treat it as a "click on empty space" if the pointer barely
          // moved — releasing an orbit drag must not close the card.
          const dx = e.clientX - pointerDown.current.x
          const dy = e.clientY - pointerDown.current.y
          if (Math.hypot(dx, dy) < 8) useGalaxyStore.getState().clearFocus()
        }}
      >
        <color attach="background" args={['#050510']} />
        {/* Fog reaches far enough that star C's distant loop stays visible. */}
        <fog attach="fog" args={['#050510', maxR * 2.2, maxR * 8]} />
        <ambientLight intensity={0.22} />
        <ClockTicker />
        <ReadySignal />
        <TelemetryProbe />
        {/* Outside the Suspense boundary ON PURPOSE: it loads via its own
            (non-suspending) loader, and inside the boundary React would defer
            mounting it until every suspended sibling resolved — making the
            biggest asset start LAST. Radius beyond controls.maxDistance and
            star C's orbit so the camera and stars stay inside the sphere. */}
        <Skybox radius={maxR * 6} />
        <Suspense fallback={null}>
          <Sun user={data.user} />
          {layout.planets.map((spec) => (
            <Planet
              key={spec.repo.name}
              spec={spec}
              textureFile={textureByRepo.get(spec.repo.name)!}
            />
          ))}
          {layout.dwarfs.map((spec, i) => (
            <DwarfPlanet key={spec.name} spec={spec} index={i} />
          ))}
          <AsteroidBelt total={totalCommits} />
          <Orbits planets={layout.planets} dwarfs={layout.dwarfs} />
          <CameraRig layout={layout} />
          {/* Selective bloom unifies every glow source (sun, halos, active
              planets) into one consistent light bleed. */}
          <EffectComposer multisampling={0}>
            <Bloom
              mipmapBlur
              luminanceThreshold={0.6}
              luminanceSmoothing={0.25}
              intensity={0.85}
            />
            <Vignette offset={0.18} darkness={0.72} />
          </EffectComposer>
        </Suspense>
      </Canvas>
    </div>
  )
}
