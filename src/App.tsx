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
import manualRepos from './data/manual-repos.json'

/** Cast once — the JSON import gives wide types. Manual repos (work projects
    the API can't see) ride along; the fetch script never touches that file.
    On a name collision the MANUAL entry wins — public shells of private
    projects (e.g. the incomplete pvcon-website copy) get replaced. */
const fetched = data as GalaxyData
const manual = manualRepos as GalaxyData['repos']
const galaxyData: GalaxyData = {
  ...fetched,
  repos: [
    ...fetched.repos.filter((r) => !manual.some((m) => m.name === r.name)),
    ...manual,
  ],
}

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
