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
const tmpDir = new Vector3()
const tmpRight = new Vector3()
const tmpTarget = new Vector3()
const WORLD_UP = new Vector3(0, 1, 0)

/** Upward bias blended into the approach direction (keeps a pleasant oblique). */
const APPROACH_LIFT = 0.35

function isNarrowViewport(): boolean {
  return window.matchMedia('(max-width: 720px)').matches
}

/**
 * Compute a focus pose: eye at `dist` from `pos` along the current camera
 * direction (lifted, never degenerate), and a look-target offset sideways
 * (desktop, card on the right) or downward (mobile, bottom sheet) so the
 * subject doesn't sit behind the card. Writes tmpEye + tmpTarget.
 */
function computeFocusPose(controls: CameraControlsImpl, pos: Vector3, dist: number) {
  controls.getPosition(tmpCam)
  tmpDir.copy(tmpCam).sub(pos)
  tmpDir.y = 0
  if (tmpDir.lengthSq() < 1e-6) tmpDir.set(0, 0, 1)
  tmpDir.normalize()
  tmpDir.y = APPROACH_LIFT
  tmpDir.normalize()
  tmpEye.copy(tmpDir).multiplyScalar(dist).add(pos)

  // Screen-space right = viewDir × up.
  tmpRight.copy(pos).sub(tmpEye).normalize().cross(WORLD_UP).normalize()
  tmpTarget.copy(pos)
  if (isNarrowViewport()) {
    // Bottom sheet covers ~62vh: aim lower so the subject rises on screen.
    tmpTarget.y -= dist * 0.26
  } else {
    // Card on the right: aim right of the subject so it settles left-of-center.
    tmpTarget.addScaledVector(tmpRight, dist * 0.2)
  }
}

export function CameraRig({ layout }: { layout: GalaxyLayout }) {
  const controlsRef = useRef<CameraControlsImpl | null>(null)
  const revealed = useGalaxyStore((s) => s.revealed)
  const introDone = useGalaxyStore((s) => s.introDone)
  const focus = useGalaxyStore((s) => s.focus)
  const maxR = layout.maxOrbitRadius

  // Focus-flight bookkeeping: the per-frame pin must wait for the flight to
  // land, or setTarget(..., false) cancels the animated setLookAt mid-air.
  const arrivedRef = useRef(false)
  const targetOffsetRef = useRef(new Vector3())

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
    controls.minPolarAngle = 0.15
    controls.maxPolarAngle = Math.PI * 0.62
    controls.dollySpeed = 0.6
    // No panning: rotate + dolly only, so the sun stays centered-ish.
    controls.truckSpeed = 0
    controls.mouseButtons.right = CameraControlsImpl.ACTION.NONE
    controls.touches.two = CameraControlsImpl.ACTION.TOUCH_DOLLY
    controls.touches.three = CameraControlsImpl.ACTION.NONE
  }, [maxR])

  /* ------------------------------------------------------------ */
  /* Intro dolly: starts when the loading screen begins to lift,   */
  /* so the flight is actually seen instead of hidden behind it.   */
  /* ------------------------------------------------------------ */
  useEffect(() => {
    if (!revealed) return
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
  }, [revealed, maxR])

  /* ------------------------------------------------------------ */
  /* Focus flights                                                 */
  /* ------------------------------------------------------------ */
  useEffect(() => {
    if (!introDone) return
    const controls = controlsRef.current
    if (!controls) return
    arrivedRef.current = false

    let flight: Promise<void>

    if (focus === null) {
      // Return to the overview pose.
      flight = controls.setLookAt(0, maxR * 0.85, maxR * 1.55, 0, 0, 0, true)
    } else if (focus.kind === 'sun') {
      computeFocusPose(controls, tmpPos.set(0, 0, 0), SUN_RADIUS * 5.2)
      flight = controls.setLookAt(
        tmpEye.x, tmpEye.y, tmpEye.z,
        tmpTarget.x, tmpTarget.y, tmpTarget.z,
        true,
      )
    } else {
      const spec = layout.planets.find((p) => p.repo.name === focus.name)
      if (!spec) return
      const live = getPlanetPosition(focus.name)
      const pos = live ? tmpPos.copy(live) : planetPositionAt(spec, galaxyClock.t, tmpPos)
      // A little more breathing room on phones: the sheet eats 62vh.
      const dist = Math.max(6.0, spec.size * 5.6) * (isNarrowViewport() ? 1.15 : 1)
      computeFocusPose(controls, pos, dist)
      targetOffsetRef.current.copy(tmpTarget).sub(pos)
      flight = controls.setLookAt(
        tmpEye.x, tmpEye.y, tmpEye.z,
        tmpTarget.x, tmpTarget.y, tmpTarget.z,
        true,
      )
    }

    let cancelled = false
    void flight.then(() => {
      if (!cancelled) arrivedRef.current = true
    })
    return () => {
      cancelled = true
    }
  }, [focus, introDone, layout, maxR])

  /* ------------------------------------------------------------ */
  /* After the flight lands, pin the target to the planet's live   */
  /* position (plus the framing offset) so freeze-easing never     */
  /* drifts the framing. Never pin mid-flight or mid-gesture.      */
  /* ------------------------------------------------------------ */
  useFrame(() => {
    const controls = controlsRef.current
    if (!controls) return
    if (!arrivedRef.current || controls.active) return
    const f = useGalaxyStore.getState().focus
    if (f && f.kind === 'planet') {
      const pos = getPlanetPosition(f.name)
      if (!pos) return
      tmpTarget.copy(pos).add(targetOffsetRef.current)
      controls.setTarget(tmpTarget.x, tmpTarget.y, tmpTarget.z, false)
    }
  })

  return <CameraControls ref={controlsRef} makeDefault />
}
