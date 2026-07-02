import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useProgress } from '@react-three/drei'
import { useGalaxyStore } from '../state/store'

/**
 * Full-viewport boot screen: pulsing CSS star + progress bar. Percent is the
 * max of real asset progress (drei useProgress) and a synthetic exponential
 * ramp, so the bar always moves even when everything is procedural. Holds for
 * at least MIN_HOLD_MS, then fades/scales out and unmounts entirely.
 */

const MIN_HOLD_MS = 1400

export function LoadingScreen() {
  const ready = useGalaxyStore((s) => s.ready)
  const { progress } = useProgress()
  const [minHold, setMinHold] = useState(false)
  const [gone, setGone] = useState(false)
  const [percent, setPercent] = useState(0)
  const startRef = useRef(0)

  useEffect(() => {
    startRef.current = performance.now()
    const timer = window.setTimeout(() => setMinHold(true), MIN_HOLD_MS)
    return () => window.clearTimeout(timer)
  }, [])

  const done = ready && minHold

  // The instant the exit fade starts, the canvas is being revealed — let the
  // camera rig begin the intro dolly so the flight is actually visible.
  useEffect(() => {
    if (done) useGalaxyStore.getState().setRevealed()
  }, [done])

  useEffect(() => {
    if (done) {
      setPercent(100)
      return
    }
    const id = window.setInterval(() => {
      const elapsed = (performance.now() - startRef.current) / 1000
      // Synthetic ramp: quick to ~60%, then a slow crawl toward 94%.
      const synthetic = 94 * (1 - Math.exp(-elapsed / 1.05))
      setPercent((prev) => Math.min(100, Math.max(prev, progress, synthetic)))
    }, 90)
    return () => window.clearInterval(id)
  }, [done, progress])

  if (gone) return null

  return (
    <AnimatePresence onExitComplete={() => setGone(true)}>
      {!done && (
        <motion.div
          className="loading"
          role="status"
          aria-label="Loading the galaxy"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, scale: 1.06 }}
          transition={{ duration: 0.7, ease: [0.4, 0, 0.2, 1] }}
          // Release input the moment the exit fade begins — the user's first
          // drag/click must reach the galaxy, not the dying overlay.
          style={{ pointerEvents: done ? 'none' : 'auto' }}
        >
          <div className="loading__star" aria-hidden="true" />
          <div className="loading__title">The Living Repo Galaxy</div>
          <p className="loading__line">generating galaxy from github data</p>
          <div
            className="loading__bar"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(percent)}
            aria-label="Scene build progress"
          >
            <div className="loading__bar-fill" style={{ width: `${percent}%` }} />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
