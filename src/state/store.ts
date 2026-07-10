import { create } from 'zustand'
import { Vector3 } from 'three'

/**
 * UI + focus state. Frame-rate data (planet positions, galaxy clock) lives in
 * plain module singletons below, NOT in the store — mutating them every frame
 * must not trigger React renders.
 */

export type FocusTarget =
  | { kind: 'sun'; star?: 'A' | 'B' | 'C' }
  | { kind: 'planet'; name: string }
  /** Realm only: walking the contribution Wall. */
  | { kind: 'wall' }
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
  /** Contribution-day index under the camera while walking the Wall. */
  wallDay: number
  /** Realm time-of-day (doubles as the site's light/dark theme). */
  daytime: boolean
  /** Realm cinematic intro rail is playing (input + focus suspended). */
  cinema: boolean
  setFocus: (focus: FocusTarget) => void
  clearFocus: () => void
  setHovered: (name: string | null) => void
  setReady: () => void
  setRevealed: () => void
  setIntroDone: () => void
  setWallDay: (i: number) => void
  toggleDaytime: () => void
  setCinema: (on: boolean) => void
}

function initialDaytime(): boolean {
  try {
    const stored = window.localStorage.getItem('realm-daytime')
    if (stored !== null) return stored === '1'
  } catch {
    /* storage unavailable (private mode) — fall through */
  }
  return window.matchMedia('(prefers-color-scheme: light)').matches
}

export const useGalaxyStore = create<GalaxyStore>((set, get) => ({
  focus: null,
  hovered: null,
  ready: false,
  revealed: false,
  introDone: false,
  wallDay: 364,
  daytime: initialDaytime(),
  cinema: false,
  // Ignore focus requests until the intro flight lands (and during the
  // realm's cinematic rail) — the camera can't frame a card mid-flight.
  setFocus: (focus) => {
    if (!get().introDone || get().cinema) return
    set({ focus, hovered: null })
  },
  clearFocus: () => set({ focus: null }),
  setHovered: (hovered) => set({ hovered }),
  setReady: () => set({ ready: true }),
  setRevealed: () => set({ revealed: true }),
  setIntroDone: () => set({ introDone: true }),
  setWallDay: (wallDay) => set({ wallDay }),
  toggleDaytime: () => {
    const daytime = !get().daytime
    try {
      window.localStorage.setItem('realm-daytime', daytime ? '1' : '0')
    } catch {
      /* non-fatal */
    }
    set({ daytime })
  },
  setCinema: (cinema) => set({ cinema }),
}))

/* ---------------------------------------------------------------- */
/* Non-reactive frame-loop singletons                                */
/* ---------------------------------------------------------------- */

/**
 * Galaxy clock, measured in simulated YEARS. `scale` eases to 0 while a
 * planet is focused so orbits freeze and the camera can hold a stable target;
 * the scene root advances `t` each frame by delta * scale * yps (when
 * playing). `yps` (years per second) is the user-facing speed control.
 */
export const galaxyClock = { t: 0, scale: 1, yps: 0.02, playing: true }

/** World positions of planets, written by Planet meshes each frame. */
export const planetPositions = new Map<string, Vector3>()

export function getPlanetPosition(name: string): Vector3 | undefined {
  return planetPositions.get(name)
}
