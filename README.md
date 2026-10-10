# ALVOXIS: World Evolution

An original, browser-based sandbox god game with top-down pixel-art graphics: shape a procedurally generated world, paint biomes, release life and watch the world evolve over seasons and years.

> **Status: Milestone 3 (rivers, lakes and pathfinding).** Read [What works](#what-works) and [Not implemented yet](#not-implemented-yet) before assuming a feature exists.

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
- 16 terrain types: deep ocean, shallow water, lake, river, beach, grassland, forest, jungle, savanna, desert, swamp, tundra, snow, hills, mountain and bare soil.
- **Rivers and lakes** (Milestone 3), generated from the terrain using priority-flood hydrology:
  - Every land tile drains downhill toward the sea; closed basins deeper than a threshold fill as lakes.
  - Tiles that collect enough rain from upstream (more where it is wet) become rivers, kept 4-connected so fish can swim along them.
  - Rivers cover about 2% of land, lakes about 3–9%, depending on the seed. Same seed, same rivers.
  - **Rivers are fordable:** land animals wade across them, slowly. So rivers never cut the land into separate regions; a test checks this. Lakes are not fordable.
- Three world sizes: 256×160, 512×320 (default) and 1024×640.

**Rendering**
- Zoomed out, the map draws one shaded pixel per tile, with hill shading and water depth.
- Zoomed in, 8×8 pixel-art tiles appear: trees, acacias, dunes, peaks, waves, flowing rivers, calm lakes and shoreline foam. They are built lazily in 32×32-tile chunks and cached (LRU).
- Only changed chunks are redrawn. The display is crisp on Retina screens (device pixel ratio capped at 2).
- In winter, cold regions are shown frosted.

**Tools** (every button performs a real action)
- View: Move (one-finger pan) and Inspect (terrain, elevation or depth, temperature, moisture, nearby life).
- Terrain: Raise, Lower and Smooth. They use a soft circular brush, and biomes are recalculated from height and climate, so raising the seabed makes islands with beaches.
- Biomes: paint any of 15 terrain types, including Lake and River. Painting also sets height and climate so the result stays consistent: painted forest can spread, and painted water floods the land. Painted rivers and lakes are real water that animals drink from, wade through or swim in.
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
  | Fish | Shallow water, rivers, lakes | Any water (sea, lakes, rivers) | Never thirsty |
  | Raptor | Grazers | Land (wades rivers) | Fast hunter |
  | Tyrant | Hadrosaurs, grazers | Land, but not mountains or snow | Rare apex predator |

  - **Needs.** A hungry herbivore walks to the nearest food tile it can *reach* within sight. A thirsty animal follows a shared water-distance map to the nearest *reachable* place to drink: next to any water, in a river, or in a swamp. Water it can't reach, such as across a lake or behind a ridge, is ignored.
  - **Predators** hunt the nearest prey within sight that they can outrun, deal damage on contact, and pounce over the last 2.5 tiles. A chase that doesn't succeed within 250 ticks is abandoned. With no prey in sight, a hungry predator heads for the nearby area with the most prey. Prey flees, picking an open escape heading and holding it rather than switching back and forth.
  - **Health.** Starvation and thirst drain health, and being fed heals it. Animals die of starvation, thirst, predators, old age, drowning (land animals in water), stranding (fish on land), or removal by the player. Every death is recorded with its cause.
  - **Reproduction.** Healthy, fed adults that are off cooldown walk to an adult mate of the same species, re-routing as it moves, and wait together until they breed. Juveniles grow up into adults. Predators only breed where there are at least 3 prey per predator nearby, so they can't out-breed their food.
  - **Population limits.** Breeding stops when an area is crowded (carrying capacity per 8×8 tiles), when a species reaches its share of the 6,000-creature cap, or when the cap itself is reached.
  - **Movement and pathfinding.** Animals follow routes found by A* (and by breadth-first search for "nearest reachable food") on the tile grid. Routes respect each species' terrain rules and never cut corners. Routes are re-checked step by step, so editing the terrain under a route makes the animal re-plan instead of walking into water. Searches are capped per animal and per tick (a shared budget of 40,000 tile expansions); an animal that runs out of budget simply tries again on a later tick. The water-distance map is shared by all animals and rebuilt only after edits that change where animals can go (at most every 10 ticks). Movement is drawn smoothly between ticks.
  - **Determinism.** The same world, actions and seed always produce the same simulation, and this is covered by tests.
- **Selecting a creature:** with Select (Life) or Inspect (View), tap a creature to see its live panel: species, ID, stage and age, what it's doing, and health, hunger and thirst bars. **Follow** keeps the camera on it; **Remove** deletes it. The panel shows how it died if it dies while selected.
- History log: first appearance of each species, extinctions, world creation.
- World statistics: land share, biome mix, and per species the number alive, born, and deaths by cause.

**Persistence**
- Three save slots in IndexedDB, with Save, Load and Delete. A save (format v3) holds the full map, including rivers and lakes, plus climate, creatures (IDs, needs, health, states, current routes), clock, history and RNG state, so a loaded world continues exactly as it would have. Older saves still load: v2 animals simply plan new routes, and v1 animals get full health and new IDs.
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
- Erosion, weather (rain, drought), and dynamic climate change. Rivers don't yet change course or dry up.
- Technological eras (industrial, modern, space).
- Minimap, undo, exporting and importing save files, sound, and an offline/PWA cache.

Known limitations:
- Stored routes are at most 32 steps, and searches are capped (food within sight, prowling up to 6,000 tile expansions). Very long detours are taken in pieces, and a target far beyond the cap counts as unreachable.
- Raising, lowering or smoothing terrain recalculates biomes from height and climate, which erases rivers and lakes under the brush. Rivers don't re-form after terrain edits; paint them back with the River brush.
- Populations still rise and fall, and a species can die out; that's a valid outcome (see [docs/ECOSYSTEM.md](docs/ECOSYSTEM.md)). Tyrants are a small population and the most likely to die out (in 1 of 3 test worlds after about 10 years). Herbivores with plenty of food reach their population caps.
- Creature performance was measured in desktop Chromium (about 4,300 animals at 10×: 60 fps, 100 ticks/s) and in iPhone-sized emulation, not on a physical iPhone.
- Large (1024×640) worlds take about 0.85 seconds to generate in desktop Chromium, rivers included, and longer on phones.
- Saves stay in the browser where they were made. Clearing Safari website data deletes them.
- `npm audit` reports a moderate advisory in the Vite 5 / esbuild **dev server**. It does not affect the built game; we'll upgrade to Vite 6+ in a later milestone.

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): technology choices, module layout, data model and performance strategy.
- [docs/ROADMAP.md](docs/ROADMAP.md): milestones from this foundation to civilizations and the space age.
- [docs/ECOSYSTEM.md](docs/ECOSYSTEM.md): the population-stability investigation: method, measurements and the balance changes they justified.
