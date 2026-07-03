import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion, useDragControls } from 'framer-motion'
import { useGalaxyStore } from '../state/store'
import type { GalaxyData } from '../types'
import type { GalaxyLayout, PlanetSpec } from '../lib/galaxy'
import { CONSTELLATIONS, SUN, biomeFor } from '../lib/palette'

/**
 * The focus card: a floating right-side glass panel on desktop, a bottom
 * sheet on mobile. No full-screen dim — the galaxy stays visible behind it.
 */

const MAX_TOPICS = 6

const INTERESTS = ['Full-stack · TypeScript', 'Python', 'AI / ML', 'Developer tools']

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const hours = ms / 3_600_000
  if (hours < 1) return 'just now'
  if (hours < 24) return `${Math.floor(hours)}h ago`
  const days = hours / 24
  if (days < 30) return `${Math.floor(days)}d ago`
  const months = days / 30.44
  if (months < 12) return `${Math.floor(months)}mo ago`
  return `${Math.floor(days / 365.25)}y ago`
}

function normalizeUrl(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`
}

function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 720px)').matches,
  )
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 720px)')
    const onChange = (e: MediaQueryListEvent) => setMobile(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return mobile
}

/* ---------------------------------------------------------------- */
/* Card bodies                                                       */
/* ---------------------------------------------------------------- */

function PlanetBody({ spec, onClose }: { spec: PlanetSpec; onClose: () => void }) {
  const { repo } = spec
  const constellation = CONSTELLATIONS[spec.constellation]
  return (
    <>
      <div className="card__handle" aria-hidden="true" />
      <button className="card__close" onClick={onClose} aria-label="Close">
        ×
      </button>
      <div className="card__chips">
        <span
          className="chip"
          style={{
            color: constellation.color,
            background: `${constellation.color}1f`,
            borderColor: `${constellation.color}45`,
          }}
        >
          {constellation.label}
        </span>
        {spec.active && (
          <span className="chip chip--active">
            <span className="chip__pulse" aria-hidden="true" />
            recently active
          </span>
        )}
      </div>
      <h2 className="card__title">{repo.name}</h2>
      {repo.description && <p className="card__desc">{repo.description}</p>}
      {repo.readmeSummary && <blockquote className="card__readme">{repo.readmeSummary}</blockquote>}
      <div className="card__stats">
        <span>★ {repo.stars}</span>
        <span>⑂ {repo.forks}</span>
        <span>⬤ {repo.commits}</span>
        <span>⟳ {timeAgo(repo.pushedAt)}</span>
      </div>
      {repo.languages.length > 0 && (
        <div className="card__langs">
          {repo.languages.map((lang) => {
            const biome = biomeFor(lang)
            return (
              <span
                key={lang}
                className="chip chip--lang"
                style={{
                  color: biome.color,
                  background: `${biome.color}1c`,
                  borderColor: `${biome.color}3d`,
                }}
              >
                {lang}
              </span>
            )
          })}
        </div>
      )}
      {repo.topics.length > 0 && (
        <div className="card__topics">
          {repo.topics.slice(0, MAX_TOPICS).map((topic) => (
            <span key={topic} className="tag">
              {topic}
            </span>
          ))}
        </div>
      )}
      <div className="card__actions">
        <a className="btn" href={repo.url} target="_blank" rel="noreferrer">
          View on GitHub
        </a>
        {repo.homepage && (
          <a className="btn btn--ghost" href={normalizeUrl(repo.homepage)} target="_blank" rel="noreferrer">
            Live demo ↗
          </a>
        )}
      </div>
    </>
  )
}

const AVATAR_TIMEOUT_MS = 4000

function SunBody({ data, onClose }: { data: GalaxyData; onClose: () => void }) {
  const { user } = data
  const [imgFailed, setImgFailed] = useState(false)
  const [imgLoaded, setImgLoaded] = useState(false)

  // A hung avatar request never fires onError — fall back after a timeout so
  // the card doesn't sit with an empty ring on flaky networks.
  useEffect(() => {
    if (imgLoaded || imgFailed) return
    const timer = window.setTimeout(() => setImgFailed(true), AVATAR_TIMEOUT_MS)
    return () => window.clearTimeout(timer)
  }, [imgLoaded, imgFailed])
  const contributions = useMemo(
    () => data.contributions.reduce((sum, day) => sum + day.count, 0),
    [data.contributions],
  )
  const avatarRing = { boxShadow: `0 0 0 2px ${SUN.core}, 0 0 26px ${SUN.glow}66` }
  return (
    <>
      <div className="card__handle" aria-hidden="true" />
      <button className="card__close" onClick={onClose} aria-label="Close">
        ×
      </button>
      <div className="card__sun-head">
        {imgFailed ? (
          <div className="card__avatar card__avatar--fallback" style={avatarRing} aria-hidden="true">
            {user.name.charAt(0) || 'Y'}
          </div>
        ) : (
          <img
            className="card__avatar"
            style={avatarRing}
            src={user.avatarUrl}
            alt={user.name}
            width={72}
            height={72}
            onLoad={() => setImgLoaded(true)}
            onError={() => setImgFailed(true)}
          />
        )}
        <div>
          <h2 className="card__title">{user.name}</h2>
          <a className="card__login" href={user.profileUrl} target="_blank" rel="noreferrer">
            @{user.login}
          </a>
        </div>
      </div>
      {user.bio && <p className="card__desc">{user.bio}</p>}
      <div className="card__langs">
        {INTERESTS.map((interest) => (
          <span key={interest} className="chip chip--interest">
            {interest}
          </span>
        ))}
      </div>
      <div className="card__sun-stats">
        <div className="stat">
          <span className="stat__value">{user.publicRepos.toLocaleString()}</span>
          <span className="stat__label">public repos</span>
        </div>
        <div className="stat">
          <span className="stat__value">{user.followers.toLocaleString()}</span>
          <span className="stat__label">followers</span>
        </div>
        <div className="stat">
          <span className="stat__value">{contributions.toLocaleString()}</span>
          <span className="stat__label">contributions past year</span>
        </div>
      </div>
      <div className="card__actions">
        <a className="btn" href={user.profileUrl} target="_blank" rel="noreferrer">
          GitHub profile
        </a>
      </div>
    </>
  )
}

/* ---------------------------------------------------------------- */
/* Shell                                                             */
/* ---------------------------------------------------------------- */

export function ProjectCard({ data, layout }: { data: GalaxyData; layout: GalaxyLayout }) {
  const focus = useGalaxyStore((s) => s.focus)
  const clearFocus = useGalaxyStore((s) => s.clearFocus)
  const isMobile = useIsMobile()

  let key: string | null = null
  let body: ReactNode = null
  let ariaLabel = ''
  if (focus?.kind === 'sun') {
    key = 'sun'
    ariaLabel = data.user.name
    body = <SunBody data={data} onClose={clearFocus} />
  } else if (focus?.kind === 'planet') {
    const spec = layout.planets.find((p) => p.repo.name === focus.name)
    if (spec) {
      key = `planet:${spec.repo.name}`
      ariaLabel = spec.repo.name
      body = <PlanetBody spec={spec} onClose={clearFocus} />
    }
  }

  const hidden = isMobile ? { y: 80, opacity: 0 } : { x: 64, opacity: 0 }
  const exit = isMobile ? { y: 60, opacity: 0 } : { x: 48, opacity: 0 }

  return (
    <AnimatePresence mode="wait">
      {body && key && (
        <motion.div
          className="card-wrap"
          key={key}
          initial={hidden}
          animate={{ x: 0, y: 0, opacity: 1 }}
          exit={exit}
          transition={{ type: 'spring', damping: 26, stiffness: 240 }}
        >
          <CardShell ariaLabel={ariaLabel} isMobile={isMobile} onDismiss={clearFocus}>
            {body}
          </CardShell>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/**
 * The glass panel itself: owns dialog focus management and, on mobile, the
 * handle-driven swipe-to-dismiss (drag starts only from the grab handle so it
 * never fights the scrollable card body).
 */
function CardShell({
  ariaLabel,
  isMobile,
  onDismiss,
  children,
}: {
  ariaLabel: string
  isMobile: boolean
  onDismiss: () => void
  children: ReactNode
}) {
  const cardRef = useRef<HTMLDivElement>(null)
  const dragControls = useDragControls()

  // Move focus into the dialog on open; hand it back where it was on close.
  useEffect(() => {
    const previous = document.activeElement
    cardRef.current?.focus({ preventScroll: true })
    return () => {
      if (previous instanceof HTMLElement && document.contains(previous)) {
        previous.focus({ preventScroll: true })
      }
    }
  }, [ariaLabel])

  return (
    <motion.div
      ref={cardRef}
      className="card glass"
      role="dialog"
      aria-label={ariaLabel}
      tabIndex={-1}
      drag={isMobile ? 'y' : false}
      dragControls={dragControls}
      dragListener={false}
      dragConstraints={{ top: 0, bottom: 0 }}
      dragElastic={{ top: 0, bottom: 0.6 }}
      onDragEnd={(_, info) => {
        if (info.offset.y > 90 || info.velocity.y > 600) onDismiss()
      }}
    >
      {isMobile && (
        <div
          className="card__grab"
          onPointerDown={(e) => dragControls.start(e)}
          aria-hidden="true"
        />
      )}
      {children}
    </motion.div>
  )
}
