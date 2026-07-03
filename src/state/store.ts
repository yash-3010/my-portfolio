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
  /** First frame has painted (loading screen may still be up). */
  ready: boolean
  /** Loading screen has started revealing the canvas — intro dolly may begin. */
  revealed: boolean
  /** Intro camera dolly has finished. */
  introDone: boolean
  setFocus: (focus: FocusTarget) => void
  clearFocus: () => void
  setHovered: (name: string | null) => void
  setReady: () => void
  setRevealed: () => void
  setIntroDone: () => void
}

export const useGalaxyStore = create<GalaxyStore>((set, get) => ({
  focus: null,
  hovered: null,
  ready: false,
  revealed: false,
  introDone: false,
  // Ignore focus requests until the intro flight lands — otherwise a click
  // during the establishing dolly opens a card the camera can't frame yet.
  setFocus: (focus) => {
    if (!get().introDone) return
    set({ focus, hovered: null })
  },
  clearFocus: () => set({ focus: null }),
  setHovered: (hovered) => set({ hovered }),
  setReady: () => set({ ready: true }),
  setRevealed: () => set({ revealed: true }),
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

/**
 * Warp-arrival intro state. CameraRig writes it every frame while it drives
 * the plunge; WarpStreaks reads it to fade the light corridor in and out.
 */
export const warpState = { active: false, progress: 0 }

/** World positions of planets, written by Planet meshes each frame. */
export const planetPositions = new Map<string, Vector3>()

export function getPlanetPosition(name: string): Vector3 | undefined {
  return planetPositions.get(name)
}
