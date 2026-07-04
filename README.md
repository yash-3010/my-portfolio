# The Living Repo Galaxy 🌌

My portfolio as a living 3D galaxy, procedurally generated from my GitHub.

Every repository is a planet orbiting the sun (me). Nothing in the scene is
hand-placed — it is all derived from live GitHub data:

| Galaxy feature | GitHub data |
| --- | --- |
| Planet size | Commit count on the default branch |
| Planet biome (color) | Primary language — TypeScript blue, Python green, JavaScript amber, … |
| Orbit distance | Recency — recently pushed repos orbit closer to the sun |
| Glow + pulse | Pushed within the last 60 days |
| Moons | Stars and forks |
| Planet surface | Real solar-system imagery — every repo is dealt its own body (biased toward its language's palette: TypeScript→Earth, JavaScript→Jupiter, Python→Uranus, …), sun-lit with a true day/night terminator; active repos glow with Earth's real city lights on the night side; the ringed repo is Saturn |
| Asteroid belt | One rock per all-time commit, riding the frost line between the rocky worlds and the giants |
| Constellations | Repos clustered by interest: **Web**, **AI / ML**, **Dev Tools** |
| Planetary ring | The most-starred repo wears a banded ring |

### Real imagery

The scene wraps itself in an equirectangular Milky Way panorama when one is
present at `public/assets/skybox/milkyway.webp` (or `.jpg`). The one used here
is [ESO's eso0932a](https://www.eso.org/public/images/eso0932a/) — credit:
ESO/S. Brunier, CC-BY 4.0.

Planet, moon, ring, and sun surface textures (`public/assets/planets/`) are
from [Solar System Scope](https://www.solarsystemscope.com/textures/) —
credit: INOVE, CC-BY 4.0.

The asteroid belt instances the
[Asteroids Pack (metallic version)](https://sketchfab.com/3d-models/asteroids-pack-metallic-version)
by Sebastian Sosnowski — CC Attribution.

Click (or tap) a planet and the camera flies in; a card shows the repo's
README summary, tech stack, stats, and links. Click the sun for the about-me
card. The whole layout is deterministic — seeded from repo names — so the
galaxy is stable between visits, and it rearranges itself as my GitHub
activity changes.

## Stack

- [Vite](https://vite.dev) + React 19 + TypeScript (strict)
- [three.js](https://threejs.org) via [React Three Fiber](https://docs.pmnd.rs/react-three-fiber) + [drei](https://github.com/pmndrs/drei) (`CameraControls` for the fly-to navigation)
- [zustand](https://github.com/pmndrs/zustand) for focus/UI state
- [framer-motion](https://motion.dev) for the overlay cards, HUD, and loading screen
- Zero-dependency Node script for the build-time GitHub snapshot

## Running it

```bash
npm install
npm run dev        # local dev at http://localhost:5173
npm run build      # typecheck + production build to dist/
```

## Refreshing the galaxy data

The scene renders from a committed snapshot at `src/data/github.json`
(fetched at build time — no runtime API calls, no rate limits for visitors).

```bash
# Unauthenticated (60 req/h budget: enriches the 20 most recent repos,
# keeps the existing contribution history)
npm run fetch:github

# Authenticated (full enrichment + real contribution calendar via GraphQL)
GITHUB_TOKEN=ghp_... npm run fetch:github

# Different account
GITHUB_LOGIN=someone-else npm run fetch:github
```

The script never hard-fails: on any API trouble it logs a warning and keeps
the existing snapshot, so CI builds always succeed.

## Deploying

**GitHub Pages** — `.github/workflows/deploy.yml` builds on every push to
`main` and nightly (so the galaxy tracks live activity), refreshing the
snapshot with the Actions `GITHUB_TOKEN` first. Enable it under
*Settings → Pages → Source: GitHub Actions*.

**Vercel / Netlify** — build command `npm run fetch:github && npm run build`,
output `dist/`. Leave `DEPLOY_BASE` unset (it defaults to `/`; the Pages
workflow sets it to `/my-portfolio/`).

## Project layout

```
scripts/fetch-github.mjs   build-time GitHub snapshot fetcher
src/
  types.ts                 GalaxyData schema shared by script and scene
  data/github.json         committed snapshot (seed data until first fetch)
  lib/palette.ts           language→biome colors, constellation sectors
  lib/galaxy.ts            deterministic procedural layout + orbit math
  lib/planetSurface.ts     language→texture mapping + sun-lit surface shader
  state/store.ts           focus/hover state + frame-loop clock singletons
  components/
    GalaxyCanvas.tsx       R3F canvas, lighting, fog, galaxy clock
    CameraRig.tsx          camera-controls: intro dolly, focus fly-to
    Skybox.tsx             ESO Milky Way panorama sphere
    Sun.tsx  Planet.tsx  Orbits.tsx
    HUD.tsx  ProjectCard.tsx  LoadingScreen.tsx
```
