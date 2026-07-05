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

/* ------------------------------------------------------------------ */
/* Overview pose — THE establishing shot. Tune these three numbers:    */
/*   AZIMUTH   spins the camera around the system (radians, 0 = +Z);  */
/*             this decides which part of the Milky Way sits behind.  */
/*   ELEVATION camera height, as a fraction of the frame radius.      */
/*   DISTANCE  horizontal pull-back, as a fraction of the frame radius.*/
/* ------------------------------------------------------------------ */
const OVERVIEW_AZIMUTH = 3.4
const OVERVIEW_ELEVATION = 0.08
const OVERVIEW_DISTANCE = 0.34

function isNarrowViewport(): boolean {
  return window.matchMedia('(max-width: 720px)').matches
}

/** Portrait phones see roughly HALF the horizontal FOV of a desktop window:
    the same pose overflows sideways, and a near-flat elevation smears the
    orbit lines into stripes across the screen. Pull back and lift instead. */
const NARROW_DISTANCE_FACTOR = 2.6
const NARROW_ELEVATION = 0.45

function overviewEye(frameR: number): Vector3 {
  const narrow = isNarrowViewport()
  const dist = frameR * OVERVIEW_DISTANCE * (narrow ? NARROW_DISTANCE_FACTOR : 1)
  const elevation = frameR * (narrow ? NARROW_ELEVATION : OVERVIEW_ELEVATION)
  return tmpEye.set(
    Math.sin(OVERVIEW_AZIMUTH) * dist,
    elevation,
    Math.cos(OVERVIEW_AZIMUTH) * dist,
  )
}

/** Where the camera waits before the intro dolly — same azimuth as the
    overview pose, pulled way back, so the flight is a clean descent. */
export function introStartPosition(frameR: number): [number, number, number] {
  const narrow = isNarrowViewport()
  const dist = frameR * 1.7 * (narrow ? NARROW_DISTANCE_FACTOR : 1)
  return [
    Math.sin(OVERVIEW_AZIMUTH) * dist,
    frameR * 1.3 * (narrow ? 1.4 : 1),
    Math.cos(OVERVIEW_AZIMUTH) * dist,
  ]
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
    const eye = overviewEye(frameR)
    if (reduceMotion) {
      void controls.setLookAt(eye.x, eye.y, eye.z, 0, 0, 0, false)
      useGalaxyStore.getState().setIntroDone()
      return
    }
    controls.enabled = false
    void controls.setLookAt(eye.x, eye.y, eye.z, 0, 0, 0, true).then(() => {
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
      const eye = overviewEye(frameR)
      flight = controls.setLookAt(eye.x, eye.y, eye.z, 0, 0, 0, true)
    } else if (focus.kind === 'sun') {
      const star = STARS.find((s) => s.id === focus.star)
      if (star && star.id === 'C') {
        // The distant companion lives 45 AU out — fly to IT, not the center.
        // The galaxy clock freezes while focused, so the pose stays valid.
        starPositionAt(star, galaxyClock.t, tmpPos)
        computeFocusPose(controls, tmpPos, star.radius * 5.2 * (isNarrowViewport() ? 1.5 : 1))
      } else {
        // A and B whirl tightly around the barycenter: frame the pair.
        // Narrow screens need extra room or the pair crops at the edges.
        const dist = BINARY_EXTENT * 4.6 * (isNarrowViewport() ? 1.5 : 1)
        computeFocusPose(controls, tmpPos.set(0, 0, 0), dist)
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
      // Phones need real breathing room: the sheet eats 62vh and the narrow
      // FOV crops the sphere past the screen edges otherwise.
      const dist = Math.max(2.0, spec.size * 2.6) * (isNarrowViewport() ? 1.7 : 1)
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
