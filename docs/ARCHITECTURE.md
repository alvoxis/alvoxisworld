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
  world/       World data model (typed-array grids, dirty-chunk tracking), terrain catalogue +
               biome classification, procedural generator, terrain brushes
  sim/         Fixed-timestep Simulation, calendar/seasons, vegetation (random ticks),
               creatures (structure-of-arrays + spatial hash)
  render/      Camera (pan/zoom maths), procedural pixel-art tileset & sprites, Renderer
  input/       Unified pointer (touch/mouse/pen), pinch, wheel and keyboard handling
  game/        Game controller (loop, strokes, actions) and the tool catalogue
  save/        Serialisation (pure, tested) and IndexedDB slot storage
  ui/          DOM HUD: toolbar, categories, top bar, menu (new world, save/load, stats, history)
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

The map is split into 32×32-tile **chunks**. Every mutation goes through `setTerrain` or a brush, which calls `markDirty(x, y)` and also flags neighbouring chunks, because hill shading reads neighbour heights. The renderer consumes `dirtyChunks` once per frame.

Creatures use a structure-of-arrays layout (one typed array per field: `id`, `species`, position and previous position, heading, `health`, `hunger`, `thirst`, `age`, `state`, target, timers) with a fixed capacity of 6,000 and swap-remove. IDs are unique and never reused, so the UI can track a creature by ID even though its array index changes. This keeps thousands of animals cache-friendly and makes them trivial to serialise.

### Creature simulation (`src/sim/creatures.ts`)

- **Species are data.** `SPECIES` holds diet, habitat (`land` or `water`), impassable terrain, speed, size, lifespan, need rates, food tiles or prey species, attack, sight, breeding cooldown, litter size and population limits. `PREDATORS_OF` is derived from it.
- **Each tick, per creature:** ageing and needs, then the habitat check (drowned or stranded), then health (starvation and thirst damage, regeneration when fed), then death (attributed to the last cause of harm or to old age). After that come **think**, **act** and **try to breed**.
- **Think** runs every 4 ticks per creature, staggered by ID. It picks a state in priority order: flee from a predator nearby, keep eating or drinking until sated, satisfy the greater need (water or food/prey), seek a mate, otherwise wander.
- **Act** runs every tick and moves or eats according to the state. Food and water targets come from `findTile` (nearest match in straight-line distance, scanned ring by ring). A failed search sets a short cooldown so animals far from water stay cheap.
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
- **New species:** add a `SPECIES` entry (plus a constant for its id) and a pixel-art entry in `PIXEL_ART` (`render/tileset.ts`, one character per pixel, 1/8 tile per pixel), then a `spawnTool` line in `game/tools.ts`. Shared behaviour comes from the species data. Truly new behaviour (flying, amphibious) needs a new habitat rule in `Creatures.canEnter`.
- **New tool:** add an object to `TOOLS`. The UI picks it up automatically.
