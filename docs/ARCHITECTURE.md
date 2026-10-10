# Architecture

## Technology stack

| Concern | Choice | Why |
|---|---|---|
| Language | **TypeScript (strict)** | The simulation will grow large (races, diplomacy, eras), and types keep refactors safe. |
| Build / dev server | **Vite** | Starts instantly, needs almost no config, and outputs a static site that can be hosted anywhere (GitHub Pages). |
| Rendering | **Canvas 2D**, custom renderer | The world is a tile grid. A 1-pixel-per-tile offscreen image plus cached pixel-art chunks covers the whole zoom range with very few draw calls. There's no engine to fight, the bundle is about 15 kB gzipped, and Canvas 2D is reliable in mobile Safari. |
| Tests | **Vitest** | Same config as Vite. The simulation and world modules are DOM-free, so they run in Node. |
| Persistence | **IndexedDB** | Stores typed arrays natively, with much more room than localStorage (a large world is about 3 MB). |
| Hosting / CI | **GitHub Actions + GitHub Pages** | Builds and publishes on push, so the game is playable from an iPhone with no desktop step. |

**Why not Phaser or PixiJS yet?** Neither is needed for a tile map plus a few thousand sprites. The renderer is isolated in `src/render/`, so if entity counts reach tens of thousands, or we want shaders such as animated water or day/night lighting, we can swap in a WebGL backend (PixiJS, or raw WebGL) without touching the simulation.

**Scaling plan.** The simulation already runs on a fixed timestep against plain typed arrays and has no DOM dependencies. That makes it ready to move into a **Web Worker** when civilizations make ticks expensive: the worker would own the state, and the main thread would get dirty-chunk and entity snapshots.

## Module layout

```
src/
  core/        Pure utilities: seeded RNG (mulberry32), coordinate hash, simplex noise + fBm
  world/       World data model (typed-array layers, dirty-chunk tracking, passability version,
               undo hook), terrain catalogue + biome classification, procedural generator,
               hydrology (rivers/lakes), terrain brushes, world-generation worker (genjobs, gen.worker)
  sim/         Fixed-timestep Simulation, calendar/seasons, vegetation (random ticks), weather,
               fire, disasters (meteor/earthquake), creatures (structure-of-arrays + spatial hash),
               pathfinding (A*, BFS, water field), regions (hierarchical routes), food map,
               navigation worker (navjobs, nav.worker)
  render/      Camera (pan/zoom maths), procedural pixel-art tileset & sprites, Renderer
  input/       Unified pointer (touch/mouse/pen), pinch, wheel and keyboard handling
  game/        Game controller (loop, strokes, actions), tool catalogue, undo history
  save/        Serialisation (pure, tested) and IndexedDB slot storage
  ui/          DOM HUD (toolbar, categories, top bar, menu: new world, weather, save/load, stats,
               history) and the minimap
  main.ts      Boot
tests/         Vitest suites (world, brushes, simulation, save/load, camera)
```

Dependencies only point downward: `ui → game → (render, input, save) → sim → world → core`. `world`, `sim` and `save/serialize` never touch the DOM.

## Data model

`World` stores one `Uint8Array` per layer, each of size `width × height`:

| Layer | Meaning |
|---|---|
| `heights` | Elevation, 0–255. `SEA_LEVEL = 110`. |
| `terrain` | Terrain id (see `terrain.ts`). |
| `temperature`, `moisture` | Climate, 0–255. Drives biome classification and vegetation spread. |

Since Milestone 4, these layers are also kept per tile:

| Layer | Meaning |
|---|---|
| `baseTemperature`, `baseMoisture` | Long-term climate; weather pushes the current values around and they relax back. |
| `waterFlags` | `LAKE_BED` / `RIVER_BED` (the tile is or was lake/river and can refill), `FLOOD` (temporary water). |
| `under` | Terrain under flood water, restored when it drains. |
| `fire` | Remaining burn ticks. |

Player-driven changes go through `World.setTerrain / setHeight / setClimate / setWaterFlags`, which call `touch(i)` first so the undo recorder can save the tile's previous values.

The map is split into 32×32-tile **chunks**. Every mutation goes through `setTerrain` or a brush, which calls `markDirty(x, y)` and also flags neighbouring chunks, because hill shading reads neighbour heights. The renderer consumes `dirtyChunks` once per frame.

Creatures use a structure-of-arrays layout (one typed array per field: `id`, `species`, position and previous position, heading, `health`, `hunger`, `thirst`, `age`, `state`, target, timers) with a fixed capacity of 6,000 and swap-remove. IDs are unique and never reused, so the UI can track a creature by ID even though its array index changes. This keeps thousands of animals cache-friendly and makes them trivial to serialise.

### Hydrology (`src/world/hydrology.ts`)

Runs once at generation, after biome classification, and is deterministic from heights and moisture:
1. **Priority-flood** from the sea and the map border, using a binary heap. This fills closed basins and gives every land tile a downstream neighbour that leads to the sea.
2. **Lakes**: tiles where `filled − height ≥ lakeDepth`, in connected groups of at least `minLakeSize` tiles.
3. **Rivers**: rain is accumulated downstream, from the highest filled tile to the lowest (`0.4 + moisture` per tile). Tiles above `riverThreshold` become `RIVER`, and diagonal steps get an extra orthogonal tile so rivers stay 4-connected.

Rivers and lakes are ordinary terrain ids (`T.RIVER`, `T.LAKE`, both `isWater`), so saves, rendering and brushes need no extra layer. `generateWorld(w, h, seed, { hydrology: false })` turns it off, which tests and comparisons use.

### Pathfinding (`src/sim/pathfinding.ts`)

- **Movement classes**: `LAND` walks land and wades rivers (3× cost in A*, 0.6× speed); `LOWLAND` is the same but can't climb mountains or snow; `WATER` swims in any water. Species declare a class (`SpeciesDef.move`), and `passable(world, cls, x, y)` is the single source of truth for movement.
- **`Pathfinder.astar`**: 8-way A* with an octile heuristic and no corner cutting. Scratch arrays are allocated once per map size and reused via a generation stamp, so searches allocate nothing.
- **`Pathfinder.nearest`**: a breadth-first search for the nearest *reachable* tile that matches a predicate (used for food).
- **Budgets**: every search has its own node limit, and all searches in one tick share `NODE_BUDGET` (40,000 expansions). When the budget is spent a search returns `NO_BUDGET` and the creature retries on a later decision, so search work can never stall the tick.
- **`WaterField`**: a multi-source BFS distance map, per land class, to the nearest drink spot. Thirsty animals walk down it one step at a time. It is rebuilt when `World.passVersion` has changed, at most every 10 ticks. `passVersion` is bumped by `setTerrain` only when a tile changes movement class (land, sea or lake, river, mountain or snow). Grazing grass into soil, for example, doesn't trigger a rebuild.
- **Routes** are stored per creature: up to `PATH_MAX` (32) tile indices, plus position and goal. Each waypoint is re-checked with `passable` before use, so terrain edits invalidate routes lazily, and longer routes are re-planned when the stored part runs out.

### Weather, fire and disasters (`src/sim/weather.ts`, `fire.ts`, `disasters.ts`)

- **Order in each tick:** `Simulation.step` runs weather, then fire, then vegetation, then creatures. Everything uses the simulation RNG, so it's deterministic and stops when paused.
- **Weather** keeps a short list of moving systems (rain or drought, with position, radius, intensity and lifetime). Every 10 ticks it:
  - may form new automatic systems (by season and severity, capped);
  - moves them with the wind;
  - applies effects to a sample of the tiles under each system (about 6% of the area);
  - relaxes 2% of the map's tiles back toward long-term climate, where floods also drain and dried beds refill.
  It also keeps a coarse wetness grid (16×16-tile cells) for O(1) lookups: animals' thirst and fire suppression.
- **Fire** keeps a list of burning tiles plus `world.fire`. Each tick a burning tile can ignite its four neighbours (probability is fuel × dryness², higher in drought) and burns down. Burned land becomes soil. An exact counter enforces `MAX_BURNING` (3,000).
- **Disasters** are plain functions that edit terrain through the world setters (so undo covers them) and hurt creatures through `Creatures.hurtInCircle` with their own causes of death.

### Undo (`src/game/undo.ts`)

- One action is one stroke (or one tap of a one-shot power).
- `UndoHistory.record()` installs `world.recorder` only while the tool itself runs, so simulation changes between applications are never captured.
- The first time a tile is touched, its 8 per-tile values are saved. Undo writes them back in reverse, bumps `passVersion` when movement classes change, and puts out fires on restored tiles.
- History is bounded: 40 actions and 400,000 tiles.

### Workers (`src/world/genjobs.ts`, `src/sim/navjobs.ts`)

Both workers follow the same pattern:
1. A pure job function (`computeWorld`, `computeNav`) that never throws; errors come back as results.
2. A tiny worker entry file, bundled by Vite through `new Worker(new URL(...), { type: 'module' })`.
3. A main-thread client that falls back to running the same function locally.

Navigation rebuilds are installed at a fixed tick (request + `NAV_DELAY`), so results never depend on timing. See docs/PERFORMANCE.md for the investigation.

### Long routes and food (`src/sim/regions.ts`, `src/sim/foodmap.ts`)

- **`RegionGraph`** splits the map into 16×16 cells, labels connected walkable areas in each cell (per movement class), and links regions across cell borders.
  - `connected(a, b)` is an O(1) reachability test.
  - `waypoint(s, goal)` runs A* over regions (a few thousand nodes on the largest map) and returns a tile about `LEG` (24) tiles along the route.
  - `Creatures.planTo` uses it for any goal further than a leg. `continueRoute` plans the next leg when the stored one runs out.
- **`FoodMap`** counts food tiles per 8×8 cell for each distinct diet. `seekFood` skips its search when nothing edible is in sight, and `migrateToFood` heads for the nearest cell with *reachable* food.

### Creature simulation (`src/sim/creatures.ts`)

- **Species are data.** `SPECIES` holds diet, habitat (`land` or `water`), impassable terrain, speed, size, lifespan, need rates, food tiles or prey species, attack, sight, breeding cooldown, litter size and population limits. `PREDATORS_OF` is derived from it.
- **Each tick, per creature:** ageing and needs, then the habitat check (drowned or stranded), then health (starvation and thirst damage, regeneration when fed), then death (attributed to the last cause of harm or to old age). After that come **think**, **act** and **try to breed**.
- **Think** runs every 4 ticks per creature, staggered by ID. It picks a state in priority order: flee from a predator nearby, keep eating or drinking until sated, satisfy the greater need (water or food/prey), seek a mate, otherwise wander.
- **Act** runs every tick and moves or eats according to the state:
  - Herbivores walk a BFS route to the nearest reachable food.
  - Thirsty animals follow the water field.
  - Predators chase in the open when the line to the prey is clear and it's within 6 tiles; otherwise they follow an A* route that is re-planned when the prey drifts from the route's end. They pounce within 2.5 tiles, and give up after 250 ticks or if the prey is unreachable.
  - Predators with no prey in sight prowl toward prey-dense cells.
  - Mates walk to each other and wait together.
  - Fleeing and wandering animals pick an open heading from 16 candidates, scored by free run ahead, direction away from the threat and continuity, and hold it.

  A failed search sets a short cooldown so animals with no options stay cheap.
- **Spatial hash** (8×8-tile cells) is rebuilt each tick. It answers nearest-prey, nearest-predator and mate queries, and holds per-cell, per-species counts for carrying capacity.
- **Deaths** are counted per species and cause (`deathStats`) and also queued (`drainDeaths`), so the UI can report what happened to a selected creature.
- **Rendering** interpolates each creature between its previous and current tick position using `Simulation.alpha`, so movement looks smooth at 10 ticks/s without simulating per frame.

## Simulation loop

`Simulation.advance(dt)` gathers real time and runs `TICKS_PER_SECOND × speed` fixed ticks, capped per frame so the loop can't spiral. Each tick:

1. **Vegetation:** samples about 0.3% of tiles at random (cost scales with area, not with full scans) and applies succession rules.
2. **Creatures:** rebuilds the prey spatial hash, then runs metabolism, death, grazing or hunting, movement and breeding.
3. **Clock and events:** season changes notify the renderer (winter frost), and extinctions are written to history.

The RNG state is saved, so a loaded game is deterministic from that point on.

## Rendering

- **1 px per tile** (`base` canvas, an `ImageData` updated per dirty chunk) is always drawn, scaled up with smoothing disabled.
- **8 px per tile** detail chunks (256×256 canvases) are composed on the CPU from the procedural tileset when zoom ≥ 6 CSS px per tile. At most 8 are built per frame, the 1 px map shows underneath until they're ready, and an 80-chunk LRU with canvas pooling bounds memory on iOS.
- Chunk edges are snapped to whole device pixels to avoid seams.
- Creatures are culled to the viewport. They're drawn as dots when zoomed out and as 8×8 sprites (mirrored by heading) when zoomed in.

## Input

`InputController` turns pointer events into one of four modes: `stroke` (tool), `pan`, `gesture` (two-finger pan and pinch) or `pending`. Touch strokes wait 70 ms, so a second finger turns into a pinch instead of a stray paint dab. Tools declare `repeatMs`: `0` means apply on move with interpolation, a positive value means apply on a timer while held, and `Infinity` means apply once.

## Adding things

- **New terrain:** add an id to `T` and a `TERRAIN` entry, handle it in `classify` and `Tileset.draw`, then (optionally) add `paintTool(id)` in `game/tools.ts`.
- **New species:** add a `SPECIES` entry (plus a constant for its id) and a pixel-art entry in `PIXEL_ART` (`render/tileset.ts`, one character per pixel, 1/8 tile per pixel), then a `spawnTool` line in `game/tools.ts`. Shared behaviour comes from the species data. Truly new movement (flying, amphibious) needs a new movement class in `pathfinding.ts` (`MOVE`, `passableId`, and a `WaterField` entry if it drinks).
- **New tool:** add an object to `TOOLS`. The UI picks it up automatically.
