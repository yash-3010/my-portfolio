import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { galaxyClock, useGalaxyStore } from '../state/store'
import type { GalaxyData } from '../types'
import type { GalaxyLayout } from '../lib/galaxy'
import type { Biome } from '../lib/palette'

/**
 * The 2D chrome around the galaxy: brand block, legend, control hint, seed
 * badge and credit link. Everything is pointer-events:none except real links.
 * While a card is focused, everything but the brand block fades out (CSS).
 */

const TAGLINE_MAX = 90

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  const cut = text.slice(0, max - 1)
  // Break on a word boundary when one is reasonably close.
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`
}

export function HUD({ data, layout }: { data: GalaxyData; layout: GalaxyLayout }) {
  const introDone = useGalaxyStore((s) => s.introDone)
  const focused = useGalaxyStore((s) => s.focus !== null)
  const setFocus = useGalaxyStore((s) => s.setFocus)
  const [everFocused, setEverFocused] = useState(false)
  // Sim controls mirror the non-reactive galaxyClock (frame loop reads it).
  const [playing, setPlaying] = useState(galaxyClock.playing)
  const [speed, setSpeed] = useState(galaxyClock.yps)

  useEffect(() => {
    if (focused) setEverFocused(true)
  }, [focused])

  const tagline = data.user.bio ? truncate(data.user.bio, TAGLINE_MAX) : null

  const hasRing = useMemo(() => layout.planets.some((p) => p.ring), [layout])
  const moonCount = useMemo(
    () => layout.planets.reduce((sum, p) => sum + p.moons.length, 0),
    [layout],
  )
  // Matches the belt: every commit in the snapshot, not just rendered repos.
  const asteroidCount = useMemo(
    () => data.repos.reduce((sum, r) => sum + r.commits, 0),
    [data],
  )
  const worldCount = layout.planets.length + layout.dwarfs.length

  const biomes = useMemo(() => {
    const seen = new Map<string, Biome>()
    for (const planet of layout.planets) {
      if (!seen.has(planet.biome.language)) seen.set(planet.biome.language, planet.biome)
    }
    return [...seen.values()]
  }, [layout])

  return (
    <div className={`hud${focused ? ' hud--focused' : ''}`}>
      {/* Keyboard path into the galaxy: visually hidden until focused. */}
      <nav className="hud__nav" aria-label="Explore the galaxy">
        <button type="button" onClick={() => setFocus({ kind: 'sun' })}>
          About {data.user.name}
        </button>
        {layout.planets.map((p) => (
          <button
            type="button"
            key={p.repo.name}
            onClick={() => setFocus({ kind: 'planet', name: p.repo.name })}
          >
            {p.repo.name}
          </button>
        ))}
      </nav>

      {/* Top-left brand */}
      <motion.div
        className="hud__brand"
        initial={{ opacity: 0, y: -10 }}
        animate={introDone ? { opacity: 1, y: 0 } : { opacity: 0, y: -10 }}
        transition={{ delay: 0.3, duration: 0.8, ease: 'easeOut' }}
      >
        <h1 className="hud__name">{data.user.name.toUpperCase()}</h1>
        <p className="hud__sub">The Living Repo Galaxy</p>
        {tagline && <p className="hud__tagline">{tagline}</p>}

        {/* Telemetry — spans are mutated per-frame by TelemetryProbe. */}
        <div className="hud__telemetry">
          <div className="telemetry__big">
            T&nbsp;+&nbsp;<span id="tele-yr">0</span>&nbsp;yr
          </div>
          <div>
            <span className="telemetry__k">rate</span> {speed.toFixed(2)} yr/s
            &nbsp;&nbsp;
            <span className="telemetry__k">scale</span> 1 AU ≈{' '}
            <span id="tele-scale">–</span> px
          </div>
          <div className="telemetry__k telemetry__counts">
            3 stars · {worldCount} planets · {moonCount} moons ·{' '}
            {asteroidCount.toLocaleString()} asteroids
          </div>
        </div>
      </motion.div>

      {/* Sim controls — bottom left, above the seed badge. */}
      <motion.div
        className="hud__controls glass"
        initial={{ opacity: 0, y: 10 }}
        animate={introDone ? { opacity: 1, y: 0 } : { opacity: 0, y: 10 }}
        transition={{ delay: 0.6, duration: 0.6, ease: 'easeOut' }}
      >
        <button
          type="button"
          onClick={() => {
            galaxyClock.playing = !galaxyClock.playing
            setPlaying(galaxyClock.playing)
          }}
        >
          {playing ? 'Pause' : 'Play'}
        </button>
        <button
          type="button"
          onClick={() => {
            galaxyClock.t = 0
          }}
        >
          Reset
        </button>
        <label className="controls__slider">
          <span>speed</span>
          <input
            type="range"
            min={0.02}
            max={1.5}
            step={0.02}
            value={speed}
            onChange={(e) => {
              const v = Number(e.target.value)
              galaxyClock.yps = v
              setSpeed(v)
            }}
          />
          <span className="controls__value">{speed.toFixed(2)}×</span>
        </label>
      </motion.div>

      {/* Top-right legend */}
      <motion.aside
        className="hud__legend glass"
        initial={{ opacity: 0, x: 16 }}
        animate={introDone ? { opacity: 1, x: 0 } : { opacity: 0, x: 16 }}
        transition={{ delay: 0.45, duration: 0.7, ease: 'easeOut' }}
      >
        <div className="legend__label">constellations</div>
        {layout.constellations.map((c) => (
          <div className="legend__row" key={c.id}>
            <span
              className="legend__dot"
              style={{ background: c.color, boxShadow: `0 0 8px ${c.color}` }}
            />
            {c.label}
          </div>
        ))}
        <div className="legend__divider" />
        <div className="legend__label">languages</div>
        {biomes.map((b) => (
          <div className="legend__row" key={b.language}>
            <span
              className="legend__dot"
              style={{ background: b.color, boxShadow: `0 0 8px ${b.color}` }}
            />
            {b.language}
          </div>
        ))}
        <p className="legend__caption">
          planet size = commits · orbit = recency · moons = stars &amp; forks
          · belt = 1 asteroid per commit
          {hasRing && ' · ring = most-starred repo'}
        </p>
      </motion.aside>

      {/* Bottom-center control hint — shown until the first focus ever */}
      <AnimatePresence>
        {introDone && !everFocused && (
          <motion.div
            className="hud__hint"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0, transition: { delay: 0.7, duration: 0.6 } }}
            exit={{ opacity: 0, y: 8, transition: { duration: 0.3 } }}
          >
            <span className="hint--fine">drag to orbit · scroll to zoom · click a planet</span>
            <span className="hint--coarse">drag to orbit · pinch to zoom · tap a planet</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bottom-left seed badge */}
      {data.seed && (
        <motion.div
          className="hud__seed"
          initial={{ opacity: 0 }}
          animate={introDone ? { opacity: 1 } : { opacity: 0 }}
          transition={{ delay: 0.9, duration: 0.6 }}
        >
          seed data · run <code>npm run fetch:github</code> for the live galaxy
        </motion.div>
      )}

      {/* Bottom-right credit link */}
      <motion.div
        className="hud__credit"
        initial={{ opacity: 0 }}
        animate={introDone ? { opacity: 1 } : { opacity: 0 }}
        transition={{ delay: 0.9, duration: 0.6 }}
      >
        <a href={data.user.profileUrl} target="_blank" rel="noreferrer">
          built from github.com/{data.user.login}
        </a>
      </motion.div>
    </div>
  )
}
