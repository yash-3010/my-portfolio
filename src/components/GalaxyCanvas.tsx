import { Suspense, useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing'
import type { GalaxyData } from '../types'
import { longestStreak, type GalaxyLayout } from '../lib/galaxy'
import { galaxyClock, useGalaxyStore } from '../state/store'
import { Starfield } from './Starfield'
import { DeepSpace } from './DeepSpace'
import { Skybox } from './Skybox'
import { Sun } from './Sun'
import { CompanionStars } from './CompanionStars'
import { ActiveZone } from './ActiveZone'
import { Planet } from './Planet'
import { Orbits } from './Orbits'
import { AsteroidBelt } from './AsteroidBelt'
import { Comet } from './Comet'
import { WarpStreaks } from './WarpStreaks'
import { CameraRig } from './CameraRig'

/**
 * Advances the galaxy clock. `scale` eases toward 0 while a card is focused
 * so orbits freeze smoothly; toward 1 when the focus clears.
 */
function ClockTicker() {
  useFrame((_, delta) => {
    const target = useGalaxyStore.getState().focus ? 0 : 1
    galaxyClock.scale += (target - galaxyClock.scale) * Math.min(1, delta * 3)
    galaxyClock.t += delta * galaxyClock.scale
  })
  return null
}

export function GalaxyCanvas({ data, layout }: { data: GalaxyData; layout: GalaxyLayout }) {
  const maxR = layout.maxOrbitRadius
  const streak = useMemo(() => longestStreak(data.contributions), [data])
  const pointerDown = useRef({ x: 0, y: 0 })

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
          // Everything else (fog, controls.maxDistance, starfield) scales with
          // the layout, so the frustum must too.
          far: Math.max(300, maxR * 6),
          position: [0, maxR * 2.6, maxR * 3.4],
        }}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        onCreated={() => {
          // Signal readiness once the first frame has actually painted.
          requestAnimationFrame(() => useGalaxyStore.getState().setReady())
        }}
        onPointerMissed={(e) => {
          // Only treat it as a "click on empty space" if the pointer barely
          // moved — releasing an orbit drag must not close the card.
          const dx = e.clientX - pointerDown.current.x
          const dy = e.clientY - pointerDown.current.y
          if (Math.hypot(dx, dy) < 8) useGalaxyStore.getState().clearFocus()
        }}
      >
        <color attach="background" args={['#050510']} />
        <fog attach="fog" args={['#050510', maxR * 2.2, maxR * 4.5]} />
        <ambientLight intensity={0.22} />
        <ClockTicker />
        <Suspense fallback={null}>
          <Skybox radius={maxR * 4.8} />
          <DeepSpace radius={maxR} />
          <Starfield contributions={data.contributions} radius={maxR * 2.4} />
          <Sun user={data.user} />
          <CompanionStars maxR={maxR} />
          <ActiveZone layout={layout} />
          {layout.planets.map((spec) => (
            <Planet key={spec.repo.name} spec={spec} />
          ))}
          <Orbits planets={layout.planets} />
          <AsteroidBelt layout={layout} />
          {streak > 0 && <Comet maxR={maxR} streak={streak} />}
          <WarpStreaks maxR={maxR} />
          <CameraRig layout={layout} />
          {/* Selective bloom unifies every glow source (sun, halos, active
              planets, starfield) into one consistent light bleed. */}
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
