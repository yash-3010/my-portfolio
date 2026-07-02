import { useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { CameraControls } from '@react-three/drei'
import CameraControlsImpl from 'camera-controls'
import { Vector3 } from 'three'
import { SUN_RADIUS, planetPositionAt, type GalaxyLayout } from '../lib/galaxy'
import { galaxyClock, getPlanetPosition, useGalaxyStore } from '../state/store'

/* Reused scratch vectors — never allocated per frame / per flight. */
const tmpPos = new Vector3()
const tmpEye = new Vector3()
const tmpCam = new Vector3()

export function CameraRig({ layout }: { layout: GalaxyLayout }) {
  const controlsRef = useRef<CameraControlsImpl | null>(null)
  const ready = useGalaxyStore((s) => s.ready)
  const introDone = useGalaxyStore((s) => s.introDone)
  const focus = useGalaxyStore((s) => s.focus)
  const maxR = layout.maxOrbitRadius

  /* ------------------------------------------------------------ */
  /* Controls configuration                                        */
  /* ------------------------------------------------------------ */
  useEffect(() => {
    const controls = controlsRef.current
    if (!controls) return
    controls.minDistance = 4
    controls.maxDistance = maxR * 3.6
    controls.smoothTime = 0.55
    controls.draggingSmoothTime = 0.12
    controls.maxPolarAngle = Math.PI * 0.62
    controls.dollySpeed = 0.6
    // No panning: rotate + dolly only, so the sun stays centered-ish.
    controls.truckSpeed = 0
    controls.mouseButtons.right = CameraControlsImpl.ACTION.NONE
    controls.touches.two = CameraControlsImpl.ACTION.TOUCH_DOLLY
    controls.touches.three = CameraControlsImpl.ACTION.NONE
  }, [maxR])

  /* ------------------------------------------------------------ */
  /* Intro dolly: far establishing shot -> overview pose           */
  /* ------------------------------------------------------------ */
  useEffect(() => {
    if (!ready) return
    const controls = controlsRef.current
    if (!controls) return
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduceMotion) {
      void controls.setLookAt(0, maxR * 0.85, maxR * 1.55, 0, 0, 0, false)
      useGalaxyStore.getState().setIntroDone()
      return
    }
    controls.enabled = false
    void controls.setLookAt(0, maxR * 0.85, maxR * 1.55, 0, 0, 0, true).then(() => {
      controls.enabled = true
      useGalaxyStore.getState().setIntroDone()
    })
  }, [ready, maxR])

  /* ------------------------------------------------------------ */
  /* Focus flights                                                 */
  /* ------------------------------------------------------------ */
  useEffect(() => {
    if (!introDone) return
    const controls = controlsRef.current
    if (!controls) return

    if (focus === null) {
      // Return to the overview pose.
      void controls.setLookAt(0, maxR * 0.85, maxR * 1.55, 0, 0, 0, true)
      return
    }

    if (focus.kind === 'sun') {
      // Keep the current viewing direction, just move in close.
      controls.getPosition(tmpCam)
      if (tmpCam.lengthSq() < 1e-6) tmpCam.set(0, 0.3, 1)
      tmpEye.copy(tmpCam).normalize().multiplyScalar(SUN_RADIUS * 3.6)
      tmpEye.y = SUN_RADIUS * 1.2
      void controls.setLookAt(tmpEye.x, tmpEye.y, tmpEye.z, 0, 0, 0, true)
      return
    }

    const spec = layout.planets.find((p) => p.repo.name === focus.name)
    if (!spec) return
    const live = getPlanetPosition(focus.name)
    const pos = live ? tmpPos.copy(live) : planetPositionAt(spec, galaxyClock.t, tmpPos)
    const dist = Math.max(4.2, spec.size * 4.6)
    controls.getPosition(tmpCam)
    tmpEye.copy(tmpCam).sub(pos)
    if (tmpEye.lengthSq() < 1e-6) tmpEye.set(0, 0, 1)
    tmpEye.normalize().multiplyScalar(dist).add(pos)
    tmpEye.y = pos.y + dist * 0.35
    void controls.setLookAt(tmpEye.x, tmpEye.y, tmpEye.z, pos.x, pos.y, pos.z, true)
  }, [focus, introDone, layout, maxR])

  /* ------------------------------------------------------------ */
  /* While a planet is focused, pin the target to its live world   */
  /* position so the freeze-easing never drifts the framing.       */
  /* ------------------------------------------------------------ */
  useFrame(() => {
    const controls = controlsRef.current
    if (!controls) return
    const state = useGalaxyStore.getState()
    if (!state.introDone) return
    const f = state.focus
    if (f && f.kind === 'planet') {
      const pos = getPlanetPosition(f.name)
      if (pos) controls.setTarget(pos.x, pos.y, pos.z, false)
    }
  })

  return <CameraControls ref={controlsRef} makeDefault />
}
