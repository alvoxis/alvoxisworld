# ALVOXIS: World Evolution

An original, browser-based sandbox god game with top-down pixel-art graphics: shape a procedurally generated world, paint biomes, release life and watch the world evolve over seasons and years.

> **Status: Milestone 1 (playable foundation).** Read [What works](#what-works-milestone-1) and [Not implemented yet](#not-implemented-yet) before assuming a feature exists.

All code and art are original. Terrain tiles and creature sprites are drawn in code (`src/render/tileset.ts`), and there are no external image assets.

## Play

- **Locally:** `npm install`, then `npm run dev`. Open the printed URL. `--host` is on, so a phone on the same Wi-Fi can open the `Network:` URL.
- **From an iPhone, with no computer:** every push to `main` builds and publishes the game to GitHub Pages (`.github/workflows/deploy.yml`). One-time setup: in the repository, go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**. The game is then served at `https://alvoxis.github.io/alvoxisworld/`. In Safari, Share → *Add to Home Screen* opens it full-screen.

### Controls

| Action | Touch (iPhone/iPad) | Mouse / keyboard |
|---|---|---|
| Use the selected tool | One finger (hold to keep applying) | Left button |
| Pan | Two-finger drag, or the ✋ Move tool | Right/middle drag, arrows / WASD |
| Zoom | Pinch, or the ＋ / － buttons | Wheel, trackpad pinch, `+` / `-` |
| Show the whole world | ⤢ button | ⤢ button |
| Pause / speed | ⏸ 1× 3× 10× | Same buttons, `Space` toggles pause |

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server with hot reload, reachable from the LAN |
| `npm run build` | Type-check, then build the production site into `dist/` |
| `npm run preview` | Serve the built `dist/` |
| `npm run typecheck` | `tsc --noEmit` (strict) |
| `npm test` | Vitest unit tests (generation, brushes, simulation, save/load, camera) |
| `npm run check` | Typecheck, tests and build: what CI runs |

You need Node.js 20 or newer (CI uses 22).

## What works (Milestone 1)

**World**
- Procedural world generation from a seed: continents and islands, ridged mountain ranges, ocean depth, latitude- and altitude-based temperature, and moisture. Generation is deterministic, so the same seed and size always give the same world.
- 14 terrain types: deep ocean, shallow water, beach, grassland, forest, jungle, savanna, desert, swamp, tundra, snow, hills, mountain and bare soil.
- Three world sizes: 256×160, 512×320 (default) and 1024×640.

**Rendering**
- Zoomed out, the map draws one shaded pixel per tile, with hill shading and water depth.
- Zoomed in, 8×8 pixel-art tiles appear: trees, acacias, dunes, peaks, waves and shoreline foam. They are built lazily in 32×32-tile chunks and cached (LRU).
- Only changed chunks are redrawn. The display is crisp on Retina screens (device pixel ratio capped at 2).
- In winter, cold regions are shown frosted.

**Tools** (every button performs a real action)
- View: Move (one-finger pan) and Inspect (terrain, elevation or depth, temperature, moisture, nearby life).
- Terrain: Raise, Lower and Smooth. They use a soft circular brush, and biomes are recalculated from height and climate, so raising the seabed makes islands with beaches.
- Biomes: paint any of 13 terrain types. Painting also sets height and climate so the result stays consistent: painted forest can spread, and painted water floods the land.
- Life: spawn Grazers (herbivores) and Raptors (predators), and Remove life.
- Brush size: 1–16 tiles.

**Simulation**
- Fixed-timestep clock: day, season and year. Speeds are pause, 1×, 3× and 10×.
- Vegetation uses random ticks, so cost grows with map area rather than with full scans. Bare soil regrows. Forest and jungle spread into neighbouring grass where the climate is wet enough, and grass colonises inland sand. Growth is fastest in spring and nearly stops in winter.
- Ecosystem: grazers eat vegetation, wear grassland down to bare soil, breed and age. Raptors hunt grazers using a spatial hash. Animals starve, die of old age, or drown when their land is flooded.
- History log: first appearance of each species, extinctions, world creation.
- World statistics: land share, biome mix, populations, births and deaths.

**Persistence**
- Three save slots in IndexedDB, with Save, Load and Delete. A save holds the full map, climate, creatures, clock, history and RNG state, so a loaded world continues exactly as it would have.
- New world from a seed (text or number) or a random seed, in any of the three sizes.

**Mobile**
- Built for mobile Safari: safe-area insets, `100dvh`, no page zoom or bounce while interacting with the map, 40–64 px touch targets, and 16 px inputs so iOS doesn't auto-zoom.
- Two-finger gestures never paint: touch strokes start after a 70 ms delay, so a pinch doesn't leave a stray brush dab.

## Not implemented yet

These are planned (see [docs/ROADMAP.md](docs/ROADMAP.md)) but **do not exist in the game yet**:

- Dinosaur variety beyond the two prototype species, and other wildlife.
- Humanoid races (humans, elves, dwarves, orcs, demons, demigods), hybrids and genetics.
- Settlements, buildings, civilizations, diplomacy, alliances and war.
- Player currency and progression.
- God powers beyond terrain and life brushes (meteors, rain, fire, blessings and so on).
- Rivers, lakes as distinct water bodies, erosion, weather, and dynamic climate change.
- Technological eras (industrial, modern, space).
- Minimap, undo, exporting and importing save files, sound, and an offline/PWA cache.

Known limitations:
- Large (1024×640) worlds take about 1 second to generate on desktop and longer on phones.
- Saves stay in the browser where they were made. Clearing Safari website data deletes them.
- `npm audit` reports a moderate advisory in the Vite 5 / esbuild **dev server**. It does not affect the built game; we'll upgrade to Vite 6+ in a later milestone.

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): technology choices, module layout, data model and performance strategy.
- [docs/ROADMAP.md](docs/ROADMAP.md): milestones from this foundation to civilizations and the space age.
