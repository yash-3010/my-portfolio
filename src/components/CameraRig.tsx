import { useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { CameraControls } from '@react-three/drei'
import CameraControlsImpl from 'camera-controls'
import { Vector3 } from 'three'
import {
  BINARY_EXTENT,
  C_ORBIT_RADIUS,
  STARS,
  planetPositionAt,
  starPositionAt,
  type GalaxyLayout,
} from '../lib/galaxy'
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
    // Card on the right: aim right of the subject so its bulk fills the
    // LEFT half of the frame, hero-shot style.
    tmpTarget.addScaledVector(tmpRight, dist * 0.26)
  }
}

export function CameraRig({ layout }: { layout: GalaxyLayout }) {
  const controlsRef = useRef<CameraControlsImpl | null>(null)
  const revealed = useGalaxyStore((s) => s.revealed)
  const introDone = useGalaxyStore((s) => s.introDone)
  const focus = useGalaxyStore((s) => s.focus)
  const maxR = layout.maxOrbitRadius
  // Overview flights frame the core system, not the extended-orbit sprawl.
  const frameR = layout.frameRadius

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
    // Keeps an overview dolly from tunneling into the central binary; planet
    // focus flights lower it on the fly for close-ups.
    controls.minDistance = BINARY_EXTENT * 1.4
    // Zoom-out must clear star C's distant loop, not just the planet disc.
    controls.maxDistance = Math.max(maxR * 3.6, C_ORBIT_RADIUS * 1.6)
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
      void controls.setLookAt(0, frameR * 0.4, frameR * 0.72, 0, 0, 0, false)
      useGalaxyStore.getState().setIntroDone()
      return
    }
    controls.enabled = false
    void controls.setLookAt(0, frameR * 0.4, frameR * 0.72, 0, 0, 0, true).then(() => {
      controls.enabled = true
      useGalaxyStore.getState().setIntroDone()
    })
  }, [revealed, frameR])

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
      flight = controls.setLookAt(0, frameR * 0.4, frameR * 0.72, 0, 0, 0, true)
    } else if (focus.kind === 'sun') {
      const star = STARS.find((s) => s.id === focus.star)
      if (star && star.id === 'C') {
        // The distant companion lives 45 AU out — fly to IT, not the center.
        // The galaxy clock freezes while focused, so the pose stays valid.
        starPositionAt(star, galaxyClock.t, tmpPos)
        computeFocusPose(controls, tmpPos, star.radius * 5.2)
      } else {
        // A and B whirl tightly around the barycenter: frame the pair.
        computeFocusPose(controls, tmpPos.set(0, 0, 0), BINARY_EXTENT * 4.6)
      }
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
      // Close-ups get under the binary-shell minDistance; restored on return.
      controls.minDistance = 1.4
      // Hero shot: ~2.5 radii out, so the planet looms over half the frame.
      // A little more breathing room on phones: the sheet eats 62vh.
      const dist = Math.max(2.0, spec.size * 2.6) * (isNarrowViewport() ? 1.15 : 1)
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
      if (cancelled) return
      arrivedRef.current = true
      // Re-arm the binary shell once the camera is far away again — doing it
      // mid-flight would clamp the animation and pop the camera.
      if (focus?.kind !== 'planet') controls.minDistance = BINARY_EXTENT * 1.4
    })
    return () => {
      cancelled = true
    }
  }, [focus, introDone, layout, maxR, frameR])

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
