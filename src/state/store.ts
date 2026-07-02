import { create } from 'zustand'
import { Vector3 } from 'three'

/**
 * UI + focus state. Frame-rate data (planet positions, galaxy clock) lives in
 * plain module singletons below, NOT in the store — mutating them every frame
 * must not trigger React renders.
 */

export type FocusTarget =
  | { kind: 'sun' }
  | { kind: 'planet'; name: string }
  | null

interface GalaxyStore {
  /** What the camera is flying to / the card is showing. */
  focus: FocusTarget
  /** Repo name under the pointer (drives cursor + label). */
  hovered: string | null
  /** Loading screen has finished fading out. */
  ready: boolean
  /** Intro camera dolly has finished. */
  introDone: boolean
  setFocus: (focus: FocusTarget) => void
  clearFocus: () => void
  setHovered: (name: string | null) => void
  setReady: () => void
  setIntroDone: () => void
}

export const useGalaxyStore = create<GalaxyStore>((set) => ({
  focus: null,
  hovered: null,
  ready: false,
  introDone: false,
  setFocus: (focus) => set({ focus, hovered: null }),
  clearFocus: () => set({ focus: null }),
  setHovered: (hovered) => set({ hovered }),
  setReady: () => set({ ready: true }),
  setIntroDone: () => set({ introDone: true }),
}))

/* ---------------------------------------------------------------- */
/* Non-reactive frame-loop singletons                                */
/* ---------------------------------------------------------------- */

/**
 * Galaxy clock. `scale` eases to 0 while a planet is focused so orbits freeze
 * and the camera can hold a stable target; the scene root advances `t` each
 * frame by delta * scale.
 */
export const galaxyClock = { t: 0, scale: 1 }

/** World positions of planets, written by Planet meshes each frame. */
export const planetPositions = new Map<string, Vector3>()

export function getPlanetPosition(name: string): Vector3 | undefined {
  return planetPositions.get(name)
}
