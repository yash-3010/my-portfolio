import { useEffect, useMemo } from 'react'
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

function App() {
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
