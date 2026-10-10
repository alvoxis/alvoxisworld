# ALVOXIS: World Evolution

An original, browser-based sandbox god game with top-down pixel-art graphics: shape a procedurally generated world, paint biomes, release life and watch the world evolve over seasons and years.

> **Status: Milestone 2 (living world).** Read [What works](#what-works) and [Not implemented yet](#not-implemented-yet) before assuming a feature exists.

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

## What works

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
- Life: Select, spawn Grazers, Hadrosaurs, Fish, Raptors and Tyrants, and Remove life.
- Brush size: 1–16 tiles.

**Simulation**
- Fixed-timestep clock: day, season and year. Speeds are pause, 1×, 3× and 10×.
- Vegetation uses random ticks, so cost grows with map area rather than with full scans. Bare soil regrows. Forest and jungle spread into neighbouring grass where the climate is wet enough, and grass colonises inland sand. Growth is fastest in spring and nearly stops in winter.
- **Creatures** (Milestone 2): every animal has a unique ID, health, hunger, thirst, age, a life stage (juvenile, adult, elder) and a behaviour state. They are updated on simulation ticks, never per rendered frame.

  | Species | Diet | Habitat | Notes |
  |---|---|---|---|
  | Grazer | Grass, savanna, tundra, hills, swamp | Land | Wears grassland down to bare soil |
  | Hadrosaur | Forest, jungle, swamp, grass | Land, but not mountains or snow | Browsing thins forest to grassland |
  | Fish | Shallow water | Water only | Never thirsty |
  | Raptor | Grazers | Land | Fast hunter |
  | Tyrant | Hadrosaurs, grazers, raptors | Land, but not mountains or snow | Rare apex predator |

  - **Needs.** A hungry herbivore looks for the nearest food tile it can see and eats there. A thirsty animal walks to water (within 32 tiles) and drinks; swamps also count. Predators hunt the nearest prey within sight and deal damage on contact. Prey flees from predators nearby.
  - **Health.** Starvation and thirst drain health, and being fed heals it. Animals die of starvation, thirst, predators, old age, drowning (land animals in water), stranding (fish on land), or removal by the player. Every death is recorded with its cause.
  - **Reproduction.** Healthy, fed adults that are off cooldown look for an adult mate of the same species and breed when one is close. Juveniles grow up into adults.
  - **Population limits.** Breeding stops when an area is crowded (carrying capacity per 8×8 tiles), when a species reaches its share of the 6,000-creature cap, or when the cap itself is reached.
  - **Movement.** Animals respect terrain: they never enter tiles their habitat forbids and step around obstacles. Movement is drawn smoothly between ticks.
  - **Determinism.** The same world, actions and seed always produce the same simulation, and this is covered by tests.
- **Selecting a creature:** with Select (Life) or Inspect (View), tap a creature to see its live panel: species, ID, stage and age, what it's doing, and health, hunger and thirst bars. **Follow** keeps the camera on it; **Remove** deletes it. The panel shows how it died if it dies while selected.
- History log: first appearance of each species, extinctions, world creation.
- World statistics: land share, biome mix, and per species the number alive, born, and deaths by cause.

**Persistence**
- Three save slots in IndexedDB, with Save, Load and Delete. A save holds the full map, climate, creatures (IDs, needs, health, states), clock, history and RNG state, so a loaded world continues exactly as it would have. Milestone 1 saves still load: their animals get full health and new IDs.
- New world from a seed (text or number) or a random seed, in any of the three sizes.

**Mobile**
- Built for mobile Safari: safe-area insets, `100dvh`, no page zoom or bounce while interacting with the map, 40–64 px touch targets, and 16 px inputs so iOS doesn't auto-zoom.
- Two-finger gestures never paint: touch strokes start after a 70 ms delay, so a pinch doesn't leave a stray brush dab.

## Not implemented yet

These are planned (see [docs/ROADMAP.md](docs/ROADMAP.md)) but **do not exist in the game yet**:

- More species (beyond the five above), herds and migration, nests and eggs, sexes and genetics.
- Humanoid races (humans, elves, dwarves, orcs, demons, demigods), hybrids and genetics.
- Settlements, buildings, civilizations, diplomacy, alliances and war.
- Player currency and progression.
- God powers beyond terrain and life brushes (meteors, rain, fire, blessings and so on).
- Rivers, lakes as distinct water bodies, erosion, weather, and dynamic climate change.
- Technological eras (industrial, modern, space).
- Minimap, undo, exporting and importing save files, sound, and an offline/PWA cache.

Known limitations:
- There is no pathfinding. Animals steer straight toward a target and side-step obstacles, so they can get stuck behind long coastlines or mountain ridges for a while, and can't reach water on the far side of a ridge.
- Predator–prey populations swing up and down, and a species can die out (for example raptors after a prey crash). Re-spawn it with the Life tools. Tyrants are rare and fragile by design.
- Animals spawned far from water (more than 32 tiles) may die of thirst. Rivers are planned for the next milestone.
- Creature performance was measured in desktop Chromium (3,000 creatures at 10×: 60 fps) and in iPhone-sized emulation, not on a physical iPhone.
- Large (1024×640) worlds take about 1 second to generate on desktop and longer on phones.
- Saves stay in the browser where they were made. Clearing Safari website data deletes them.
- `npm audit` reports a moderate advisory in the Vite 5 / esbuild **dev server**. It does not affect the built game; we'll upgrade to Vite 6+ in a later milestone.

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): technology choices, module layout, data model and performance strategy.
- [docs/ROADMAP.md](docs/ROADMAP.md): milestones from this foundation to civilizations and the space age.
