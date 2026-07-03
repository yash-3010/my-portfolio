import { Suspense, lazy, useEffect, useMemo, useState } from 'react'
import { MotionConfig } from 'framer-motion'
import type { GalaxyData } from './types'
import { buildGalaxy } from './lib/galaxy'
import { useGalaxyStore } from './state/store'
import { GalaxyCanvas } from './components/GalaxyCanvas'
import { HUD } from './components/HUD'
import { ProjectCard } from './components/ProjectCard'
import { LoadingScreen } from './components/LoadingScreen'
import data from './data/github.json'

/** Cast once — the JSON import gives wide types. */
const galaxyData = data as GalaxyData

/** The realm world loads lazily so galaxy visitors never pay for it. */
const RealmApp = lazy(() => import('./realm/RealmApp'))

function useHashRoute(): string {
  const [hash, setHash] = useState(() => window.location.hash)
  useEffect(() => {
    const onChange = () => setHash(window.location.hash)
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return hash
}

function App() {
  const hash = useHashRoute()
  if (hash.startsWith('#/realm')) {
    return (
      <Suspense fallback={<div className="realm-loading">crossing into the realm…</div>}>
        <RealmApp />
      </Suspense>
    )
  }
  return <GalaxyApp />
}

function GalaxyApp() {
  const layout = useMemo(() => buildGalaxy(galaxyData), [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') useGalaxyStore.getState().clearFocus()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    // reducedMotion="user" turns framer transforms into plain fades when the
    // OS asks for reduced motion (CSS alone can't reach framer's rAF styles).
    <MotionConfig reducedMotion="user">
      <div className="app">
        <GalaxyCanvas data={galaxyData} layout={layout} />
        <HUD data={galaxyData} layout={layout} />
        <ProjectCard data={galaxyData} layout={layout} />
        <LoadingScreen />
      </div>
    </MotionConfig>
  )
}

export default App
