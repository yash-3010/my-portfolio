#!/usr/bin/env node
/**
 * Build-time GitHub data fetcher for The Living Repo Galaxy.
 *
 * Rewrites src/data/github.json to match the GalaxyData type in src/types.ts.
 * Plain Node 22 ESM, zero npm dependencies (uses the global fetch).
 *
 * Usage:   npm run fetch:github
 * Config:  GITHUB_LOGIN  (default: yash-3010)
 *          GITHUB_TOKEN or GH_TOKEN (optional; unlocks GraphQL contributions
 *          and full enrichment of every repo)
 *
 * This script NEVER hard-fails: on any fatal problem it logs a warning,
 * leaves the existing github.json untouched, and exits 0 so CI builds
 * survive API outages.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const LOGIN = process.env.GITHUB_LOGIN || 'yash-3010'
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || ''
const API = 'https://api.github.com'
const OUT_FILE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../src/data/github.json',
)

/** Max parallel per-repo enrichment requests. */
const CONCURRENCY = 4
/** Without a token (60 req/h budget) fully enrich only this many repos. */
const UNAUTH_ENRICH_LIMIT = 20
/** Target length for readme summaries. */
const SUMMARY_MAX_CHARS = 280

// ---------------------------------------------------------------------------
// Logging helpers
// ---------------------------------------------------------------------------

const log = (...args) => console.log('[fetch-github]', ...args)
const warn = (...args) => console.warn('[fetch-github] WARN:', ...args)

// ---------------------------------------------------------------------------
// HTTP layer
// ---------------------------------------------------------------------------

function baseHeaders(extra = {}) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'repo-galaxy-fetch',
    ...extra,
  }
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`
  return headers
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * fetch() with resilience:
 *  - network errors: retry 3x with 2s/4s/8s backoff, then return null.
 *  - 403/429 with x-ratelimit-remaining=0 or Retry-After: wait the advised
 *    time (capped at 60s), max 3 attempts, then return the failing Response.
 * Never throws; callers inspect the Response (or null) themselves.
 * @param {string} url
 * @param {RequestInit} [options]
 * @returns {Promise<Response | null>}
 */
async function ghFetch(url, options = {}) {
  const MAX_NET_RETRIES = 3
  const MAX_RATE_RETRIES = 3
  let netFailures = 0
  let rateHits = 0

  for (;;) {
    let res
    try {
      res = await fetch(url, options)
    } catch (err) {
      netFailures += 1
      if (netFailures > MAX_NET_RETRIES) {
        warn(`network error on ${url} after ${MAX_NET_RETRIES} retries:`, err.message)
        return null
      }
      const backoff = 2000 * 2 ** (netFailures - 1) // 2s / 4s / 8s
      warn(`network error on ${url} (${err.message}); retrying in ${backoff / 1000}s`)
      await sleep(backoff)
      continue
    }

    const isRateLimited =
      (res.status === 403 || res.status === 429) &&
      (res.headers.get('x-ratelimit-remaining') === '0' || res.headers.has('retry-after'))

    if (isRateLimited && rateHits < MAX_RATE_RETRIES) {
      rateHits += 1
      const waitMs = rateLimitWaitMs(res)
      warn(
        `rate limited on ${url} (attempt ${rateHits}/${MAX_RATE_RETRIES}); ` +
          `waiting ${Math.round(waitMs / 1000)}s`,
      )
      await sleep(waitMs)
      continue
    }

    return res
  }
}

/**
 * How long to wait before retrying a rate-limited response, in ms.
 * Prefers Retry-After, falls back to x-ratelimit-reset, capped at 60s.
 */
function rateLimitWaitMs(res) {
  const CAP = 60_000
  const retryAfter = Number(res.headers.get('retry-after'))
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(retryAfter * 1000, CAP)
  }
  const reset = Number(res.headers.get('x-ratelimit-reset'))
  if (Number.isFinite(reset) && reset > 0) {
    const untilReset = reset * 1000 - Date.now()
    if (untilReset > 0) return Math.min(untilReset, CAP)
  }
  return CAP
}

/** GET a REST endpoint and parse JSON; returns null on any failure. */
async function getJson(pathname) {
  const res = await ghFetch(`${API}${pathname}`, { headers: baseHeaders() })
  if (!res || !res.ok) {
    warn(`GET ${pathname} failed${res ? ` (HTTP ${res.status})` : ''}`)
    return null
  }
  try {
    return await res.json()
  } catch (err) {
    warn(`GET ${pathname}: bad JSON (${err.message})`)
    return null
  }
}

/**
 * Run an async mapper over items with at most `limit` in flight at once.
 * Results keep the input order.
 */
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length)
  let next = 0
  async function worker() {
    for (;;) {
      const i = next
      next += 1
      if (i >= items.length) return
      results[i] = await fn(items[i], i)
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, worker)
  await Promise.all(workers)
  return results
}

// ---------------------------------------------------------------------------
// User + repo listing
// ---------------------------------------------------------------------------

/** Fetch the user profile block; null on failure. */
async function fetchUser(login) {
  const u = await getJson(`/users/${login}`)
  if (!u) return null
  return {
    login: u.login,
    name: u.name || u.login,
    avatarUrl: u.avatar_url,
    bio: u.bio ?? null,
    profileUrl: u.html_url,
    followers: u.followers ?? 0,
    publicRepos: u.public_repos ?? 0,
  }
}

/**
 * List all owned repos (paginated), keeping only non-fork, non-archived
 * ones. Sorted by most recently pushed (as returned by the API).
 */
async function fetchRepoList(login) {
  const repos = []
  for (let page = 1; page <= 10; page += 1) {
    const batch = await getJson(
      `/users/${login}/repos?per_page=100&type=owner&sort=pushed&page=${page}`,
    )
    if (!batch) return repos.length ? repos : null
    repos.push(...batch)
    if (batch.length < 100) break
  }
  return repos.filter((r) => !r.fork && !r.archived)
}

// ---------------------------------------------------------------------------
// Per-repo enrichment (each piece fails soft)
// ---------------------------------------------------------------------------

/**
 * Commit count on the default branch via the Link-header trick:
 * per_page=1 makes the rel="last" page number equal the commit count.
 * No Link header means a single page → 1 commit. HTTP 409 = empty repo → 0.
 */
async function fetchCommitCount(owner, repo) {
  const res = await ghFetch(`${API}/repos/${owner}/${repo}/commits?per_page=1`, {
    headers: baseHeaders(),
  })
  if (!res) return null
  if (res.status === 409) return 0
  if (!res.ok) {
    warn(`commits for ${repo}: HTTP ${res.status}`)
    return null
  }
  const link = res.headers.get('link')
  if (!link) return 1
  const match = link.match(/[?&]page=(\d+)>;\s*rel="last"/)
  return match ? Number(match[1]) : 1
}

/** Top 4 languages by bytes, most used first; null on failure. */
async function fetchLanguages(owner, repo) {
  const langs = await getJson(`/repos/${owner}/${repo}/languages`)
  if (!langs) return null
  return Object.entries(langs)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([name]) => name)
}

/** Raw README text; null when missing or on failure. */
async function fetchReadme(owner, repo) {
  const res = await ghFetch(`${API}/repos/${owner}/${repo}/readme`, {
    headers: baseHeaders({ Accept: 'application/vnd.github.raw' }),
  })
  if (!res) return null
  if (res.status === 404) return null
  if (!res.ok) {
    warn(`readme for ${repo}: HTTP ${res.status}`)
    return null
  }
  return res.text()
}

/**
 * Reduce raw README markdown to a plain-text one-liner: strips badges,
 * images, code fences, HTML, and headings, keeps the first paragraph of
 * at least 40 characters, and truncates around 280 chars on a word
 * boundary with an ellipsis.
 */
function summarizeReadme(markdown) {
  if (!markdown) return null
  let text = markdown
    .replace(/\r\n/g, '\n')
    // fenced code blocks
    .replace(/```[\s\S]*?```/g, '\n')
    .replace(/~~~[\s\S]*?~~~/g, '\n')
    // HTML comments, then tags
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>\n]+>/g, '')
    // badge images wrapped in links, then bare images
    .replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    // links → their text; reference-style link definitions
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1')
    .replace(/^\s*\[[^\]]+\]:\s+\S+.*$/gm, '')
    // headings and horizontal rules
    .replace(/^#{1,6}\s.*$/gm, '')
    .replace(/^\s*(?:-{3,}|={3,}|\*{3,})\s*$/gm, '')
    // inline code + emphasis markers
    .replace(/`([^`]*)`/g, '$1')
    .replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, '$1')

  const paragraph = text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .find((p) => p.length >= 40)
  if (!paragraph) return null

  if (paragraph.length <= SUMMARY_MAX_CHARS) return paragraph
  const cut = paragraph.slice(0, SUMMARY_MAX_CHARS)
  const lastSpace = cut.lastIndexOf(' ')
  return `${cut.slice(0, lastSpace > 0 ? lastSpace : SUMMARY_MAX_CHARS).replace(/[,.;:]$/, '')}…`
}

/**
 * Turn a raw API repo into a GalaxyRepo. When `enrich` is false (unauth
 * budget saver) the expensive endpoints are skipped and commits is a
 * flat estimate.
 */
async function buildRepo(raw, enrich) {
  const base = {
    name: raw.name,
    description: raw.description ?? null,
    url: raw.html_url,
    homepage: raw.homepage || null,
    language: raw.language ?? null,
    languages: raw.language ? [raw.language] : [],
    topics: Array.isArray(raw.topics) ? raw.topics : [],
    stars: raw.stargazers_count ?? 0,
    forks: raw.forks_count ?? 0,
    commits: 5,
    pushedAt: raw.pushed_at,
    createdAt: raw.created_at,
    readmeSummary: null,
  }
  if (!enrich) {
    log(`  ${raw.name}: skipped enrichment (no token), commits estimated`)
    return base
  }

  const owner = raw.owner?.login || LOGIN
  const [commits, languages, readme] = await Promise.all([
    fetchCommitCount(owner, raw.name),
    fetchLanguages(owner, raw.name),
    fetchReadme(owner, raw.name),
  ])
  if (commits !== null) base.commits = commits
  else warn(`  ${raw.name}: commit count unavailable, using estimate`)
  if (languages !== null && languages.length) base.languages = languages
  base.readmeSummary = summarizeReadme(readme)
  return base
}

// ---------------------------------------------------------------------------
// Contributions
// ---------------------------------------------------------------------------

/** yyyy-mm-dd for a Date, in UTC. */
const isoDay = (d) => d.toISOString().slice(0, 10)

/** 365 zero-count days ending today, oldest first. */
function zeroContributions() {
  const days = []
  const now = new Date()
  for (let i = 364; i >= 0; i -= 1) {
    days.push({ date: isoDay(new Date(now.getTime() - i * 86_400_000)), count: 0 })
  }
  return days
}

/**
 * Fetch the trailing 365 days of contributions via GraphQL (token
 * required). Returns [{date, count}] oldest-first, or null on failure.
 */
async function fetchContributions(login) {
  const to = new Date()
  const from = new Date(to.getTime() - 364 * 86_400_000)
  const query = `
    query ($login: String!, $from: DateTime!, $to: DateTime!) {
      user(login: $login) {
        contributionsCollection(from: $from, to: $to) {
          contributionCalendar {
            weeks { contributionDays { date contributionCount } }
          }
        }
      }
    }`
  const res = await ghFetch(`${API}/graphql`, {
    method: 'POST',
    headers: baseHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      query,
      variables: { login, from: from.toISOString(), to: to.toISOString() },
    }),
  })
  if (!res || !res.ok) {
    warn(`GraphQL contributions failed${res ? ` (HTTP ${res.status})` : ''}`)
    return null
  }
  let payload
  try {
    payload = await res.json()
  } catch (err) {
    warn(`GraphQL contributions: bad JSON (${err.message})`)
    return null
  }
  const weeks =
    payload?.data?.user?.contributionsCollection?.contributionCalendar?.weeks
  if (!weeks) {
    warn('GraphQL contributions: unexpected response shape', JSON.stringify(payload?.errors ?? payload).slice(0, 300))
    return null
  }
  const days = weeks
    .flatMap((w) => w.contributionDays)
    .map((d) => ({ date: d.date, count: d.contributionCount }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  return days.slice(-365)
}

/**
 * Contributions for the output file. With a token: live GraphQL data.
 * Without one (or on GraphQL failure): keep the existing file's array if
 * present, else emit 365 zero-count days.
 */
async function resolveContributions(login, existing) {
  if (TOKEN) {
    const live = await fetchContributions(login)
    if (live && live.length) return live
    warn('falling back to existing/zero contributions')
  } else {
    log('no token: GraphQL contributions unavailable')
  }
  if (Array.isArray(existing?.contributions) && existing.contributions.length) {
    log(`kept ${existing.contributions.length} contribution days from existing github.json`)
    return existing.contributions
  }
  log('no existing contributions found; emitting 365 zero-count days')
  return zeroContributions()
}

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------

/** Read the current github.json, or null when missing/unparseable. */
async function readExisting() {
  try {
    return JSON.parse(await readFile(OUT_FILE, 'utf8'))
  } catch {
    return null
  }
}

/** Print a fixed-width summary table of the fetched repos plus totals. */
function printSummary(repos) {
  const rows = repos.map((r) => [
    r.name,
    r.language ?? '—',
    String(r.commits),
    String(r.stars),
    r.pushedAt?.slice(0, 10) ?? '—',
  ])
  const header = ['name', 'lang', 'commits', 'stars', 'pushedAt']
  const widths = header.map((h, i) =>
    Math.max(h.length, ...rows.map((row) => row[i].length)),
  )
  const line = (cells) => cells.map((c, i) => c.padEnd(widths[i])).join('  ')
  console.log()
  console.log(line(header))
  console.log(line(widths.map((w) => '-'.repeat(w))))
  for (const row of rows) console.log(line(row))
  const totals = repos.reduce(
    (acc, r) => ({ commits: acc.commits + r.commits, stars: acc.stars + r.stars }),
    { commits: 0, stars: 0 },
  )
  console.log()
  log(`${repos.length} repos · ${totals.commits} commits · ${totals.stars} stars`)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  log(`fetching GitHub data for "${LOGIN}" ${TOKEN ? '(authenticated)' : '(no token, 60 req/h budget)'}`)

  const existing = await readExisting()

  const user = await fetchUser(LOGIN)
  if (!user) {
    warn('could not fetch user profile; keeping existing github.json untouched')
    return
  }

  const rawRepos = await fetchRepoList(LOGIN)
  if (!rawRepos || rawRepos.length === 0) {
    warn('no repos fetched; keeping existing github.json untouched')
    return
  }
  log(`found ${rawRepos.length} owned, non-fork, non-archived repos`)

  // Without a token, fully enrich only the most recently pushed repos.
  // The list is already sorted by pushed desc.
  const enrichLimit = TOKEN ? rawRepos.length : UNAUTH_ENRICH_LIMIT
  if (!TOKEN && rawRepos.length > enrichLimit) {
    log(`enriching the ${enrichLimit} most recently pushed repos; the rest get estimates`)
  }

  const repos = await mapLimit(rawRepos, CONCURRENCY, (raw, i) =>
    buildRepo(raw, i < enrichLimit),
  )

  const contributions = await resolveContributions(LOGIN, existing)

  /** @type {import('../src/types.ts').GalaxyData} */
  const data = {
    user,
    repos,
    contributions,
    fetchedAt: new Date().toISOString(),
    // no `seed` flag: this is live data
  }

  await mkdir(path.dirname(OUT_FILE), { recursive: true })
  await writeFile(OUT_FILE, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
  log(`wrote ${path.relative(process.cwd(), OUT_FILE)}`)

  printSummary(repos)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    // Never break the build: log and exit clean.
    warn('unexpected failure, github.json left untouched:', err?.stack ?? err)
    process.exitCode = 0
  })
}

export { summarizeReadme, zeroContributions, mapLimit }
