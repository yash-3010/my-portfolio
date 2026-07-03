/** Shape of the build-time GitHub snapshot in src/data/github.json. */

export interface GalaxyUser {
  login: string
  name: string
  avatarUrl: string
  bio: string | null
  profileUrl: string
  followers: number
  publicRepos: number
}

export interface GalaxyRepo {
  name: string
  description: string | null
  url: string
  homepage: string | null
  /** Primary language as reported by GitHub (drives the planet biome). */
  language: string | null
  /** Top languages by bytes, most used first. */
  languages: string[]
  topics: string[]
  stars: number
  forks: number
  /** Commit count on the default branch (drives planet size). */
  commits: number
  pushedAt: string
  createdAt: string
  /** First meaningful paragraph of the README, markdown stripped. */
  readmeSummary: string | null
}

export interface ContributionDay {
  date: string
  count: number
}

export interface GalaxyData {
  user: GalaxyUser
  repos: GalaxyRepo[]
  /** Last 365 days, oldest first. Rendered as the starfield band. */
  contributions: ContributionDay[]
  fetchedAt: string
  /** True when this file is the committed placeholder, not live API data. */
  seed?: boolean
}
