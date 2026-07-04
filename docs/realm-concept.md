# Concept: The Living Realm 🏰

> Working title. A second render layer for the portfolio: the same live GitHub
> data that generates the galaxy, re-imagined as a fantasy realm seen through a
> Game-of-Thrones-intro-style camera flyover. This document is the design
> spec — nothing here is built yet.

## Why this works

The GoT title sequence is secretly a **data visualization**: a camera on a rail
flying over a map whose geometry encodes state (the castles shown change with
the story). That is exactly the architecture the galaxy already uses —
procedural world from `src/data/github.json`, camera rail, focus targets,
overlay cards. The realm is a **new skin over the same skeleton**, not a new
app.

**Hard rule on IP:** inspired-by, never cloned. No HBO names, sigils, music,
fonts, or the astrolabe. Original kingdom names, original heraldry. The things
we actually borrow — clockwork assembly, a camera rail over a stylized map —
are techniques, not property.

## The world ↔ GitHub mapping

| Realm element | GitHub data | Galaxy equivalent |
| --- | --- | --- |
| **Kingdoms** (climate zones) | Interest domains via `classifyConstellation` | Constellations |
| — The Frozen Reach (snow, cold blues) | Dev tools / infra | `tools` |
| — The Golden Vale (wheat, warm light) | Web / frontend | `web` |
| — The Runelands (glowing glyphs, dusk) | AI / ML | `ai` |
| **Castles** | Repos — keep/tower height & footprint = commits | Planets |
| **Banner colors** | Primary language (reuse `BIOMES` palette) | Biome color |
| **Garrison tents around walls** | Stars + forks | Moons |
| **Construction scaffolding + crane** | Pushed in last 60 days | Active glow |
| **Roads between castles** | Shared topics / same language | (new) |
| **The Great Wall** | 365-day contribution graph: one ice segment per day, height + inner glow = commit count | Starfield band |
| **The Citadel** (map table room) | About-me / bio / stats | Sun |
| **Ravens** | Contact / profile links | Card links |

## Signature mechanic: clockwork assembly

Castles stand as simple silhouettes until the camera approaches, then
**assemble themselves**: foundation rings rotate up, towers telescope, gears
spin at the joints, the banner unfurls last. On focus-out they stay built
(memory of visit).

Why this matters practically: assembly animation makes **low-poly kit pieces
look intentional and premium**. We need ~12 modular parts (tower, keep, wall
segment, gate, roof cone, banner, gear, scaffold, tent, tree, rock, road tile),
all flat-shaded like the planets. No sculpting, no texture painting, no
downloaded asset packs.

## Camera design

- **Intro rail (the money shot):** a 45–60s spline flyover — rise from the
  Citadel, sweep the Golden Vale, cross into the Runelands at dusk, climb the
  Frozen Reach, finish tracking along the top of the Wall — then hand over
  control. Skippable after 3s. Reuses the CameraRig pattern: rail is a
  `CatmullRomCurve3`, progress driven by scroll or time.
- **Free roam:** same camera-controls setup as the galaxy (rotate + dolly, no
  pan), clamped to a dome over the map.
- **Focus flight:** click a castle → fly to a low three-quarter hero angle,
  assembly plays, project card slides in (identical card component).

## The Wall (contribution graph)

The strongest storytelling beat — better than the galaxy's starfield band:

- 365 ice blocks in a run along the northern border, `height = 4 + count * k`,
  emissive blue veins scale with count; zero days are low, dark ice.
- A **"walk the year" mode**: clicking the Wall locks the camera to a rail
  along its top, scroll scrubs through the year, a HUD readout shows
  date + commits under the camera.
- Streaks read as ramparts; your longest streak gets a watchtower.

## Technical plan

Same stack, no new fundamentals:

- **Terrain:** one `PlaneGeometry` displaced by seeded simplex noise; vertex
  colors paint the three climate zones with smooth borders. Snow line by
  altitude in the north. ~10k triangles.
- **Sky/climate:** per-zone fog + hemisphere light lerped by camera position;
  snow particles (reuse starfield's shader points) in the north, fireflies in
  the Runelands.
- **Castle kit:** 12 modular low-poly pieces, procedurally composed per repo
  from the seeded PRNG (same `rng(hashString(name))` trick as the galaxy) —
  every castle unique, every build deterministic.
- **Assembly:** per-piece spring timelines (position/rotation/scale), staggered
  by piece index. No animation software.
- **Data:** `github.json`, `types.ts`, fetch script, palette — **unchanged**.
  `buildRealm(data)` becomes a sibling of `buildGalaxy(data)` returning castle
  specs instead of planet specs.
- **Routing:** `/` = world picker (or remembers last choice), `/galaxy`,
  `/realm`. Lazy-load each world's chunk so neither pays for the other.

## Scope honesty

Roughly 3–4× the galaxy build:

| Phase | Deliverable |
| --- | --- |
| 1 | Terrain + climate zones + free-roam camera (walkable empty realm) |
| 2 | Castle kit + procedural composition + focus flight + cards |
| 3 | The Wall + walk-the-year mode |
| 4 | Clockwork assembly + intro rail + polish pass |

Each phase ships something visible. Phase 1 is a weekend-sized start; the full
realm is a multi-week side project. The galaxy stays the live portfolio until
the realm earns the switch — then the **world-switcher** ("explore as galaxy /
explore as realm") becomes the portfolio's most memorable feature.

## Open questions

- Kingdom names (original — three suggestions above are placeholders).
- Day/night: fixed golden-hour look, or a slow cycle?
- Sound: the GoT intro is 50% score. A subtle original ambient loop (wind,
  gears) with a mute toggle would sell it — needs a royalty-free or generated
  track.
- Mobile: the intro rail must be cheap enough for phones — decide the poly
  budget in Phase 1, not Phase 4.
