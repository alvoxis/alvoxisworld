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
  save/        Serialisation (pure, tested), save files (export/import, validation) and IndexedDB slot storage
  ui/          DOM HUD (toolbar, categories, top bar, menu: new world, weather, save/load, stats,
               history) and the minimap
  main.ts      Boot
tests/         Vitest suites (world and sizes, brushes, simulation, creatures, effects, weather, hydrology,
               pathfinding, workers, undo/redo, save files, time control, map painting, camera)
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

#### Slopes and passability (`src/world/passability.ts`)

`World.slopeClass` (gentle 0 / steep 1 / cliff 2) is derived from the largest height drop to the 4 neighbours, ignoring open-water neighbours (a coast is not a cliff). `setHeight`, `writeTile` and water-ness changes refresh a tile and its neighbours only. Navigation uses `navCodes()` = terrain id | slope << 4 (still one byte per tile), so snapshots, workers, regions and the water field all see slopes. `passableId(cls, code)` is the one rule: WATER swims; LAND and LOWLAND wade rivers only, cliffs block both, LOWLAND is also blocked by mountain, snow and steep tiles; `tileCost` charges river 3 and steep 2. Creatures check `canMove` (destination plus both diagonal corners) and `unstick()` moves an animal standing on blocked ground to the nearest open tile (`trapped` counts animals with none within 4 tiles).

### Weather, fire and disasters (`src/sim/weather.ts`, `fire.ts`, `disasters.ts`, `sky.ts`)

- **Order in each tick:** `Simulation.step` runs weather, then resolves lightning strikes, then (if enabled) the natural-disaster roll, then meteors in flight (advance, land), then fire, then vegetation, then creatures. Everything uses the simulation RNG, so it's deterministic and stops when paused.
- **Weather** keeps a short list of moving systems (`id`, `kind` rain or drought, position, radius, intensity, lifetime, and the flags `storm`, `snow`, `forceSnow`). Every 10 ticks it:
  - may form new automatic systems (rain, drought or thunderstorm, by season and severity, capped);
  - moves them with the wind (and accumulates the total `drift`, which decorative clouds follow);
  - recomputes each rain system's `snow` flag from the temperature under its centre;
  - applies effects to a sample of the tiles under each system (about 6% of the area): per tile, `rainOn`, `snowOn` (temperature below `SNOW_TEMPERATURE`, or forced) or `droughtOn`;
  - lets each storm decide lightning strikes (`weather.strikes`, at most 6 per step), which `Simulation` resolves right away;
  - relaxes 2% of the map's tiles back toward long-term climate, where floods drain, snow cover melts (outside winter) and dried beds refill.
  It also keeps a coarse wetness grid (16×16-tile cells) for O(1) lookups: animals' thirst and fire suppression.
- **Snow cover** reuses the flood pattern: the tile becomes `SNOW`, `waterFlags` gets `SNOWCOVER`, and `under` remembers the terrain to restore. Melting restores it only if the tile is still snow (a repainted tile just loses the flag).
- **Fire** keeps a list of burning tiles plus `world.fire`. Each tick a burning tile can ignite its four neighbours (probability is fuel × dryness² × drought boost × wind factor × slope factor) and burns down. Burned land becomes soil. An exact counter enforces `MAX_BURNING` (3,000).
- **Sky** (`Sky` in `sky.ts`) holds the meteors in flight (`ttl`, `total`, impact point, crater radius, energy, approach angle, and whether it fell naturally), the disaster settings, and a small queue of visual events for the renderer. `Simulation.launchMeteor` adds a meteor; when `ttl` reaches 0, `Simulation.impact` calls `meteorStrike`. A meteor the player launched is wrapped by `impactRecorder` (set by `Game` to `UndoHistory.record`) so its terrain change is one undo step; natural ones are not. `Creatures.dangers` (zones around meteors about to land) makes animals flee.
- **Natural disasters** are rolled in `Simulation.naturalDisasters` every `DISASTER_STEP` (40) ticks from `DISASTER_RATES`, scaled by map size, only when switched on.
- **Disasters** (`meteorStrike`, `earthquake`, `lightningStrike`) are plain functions that edit terrain through the world setters (so undo covers them when recorded) and hurt creatures through `Creatures.hurtInCircle` with their own causes of death. `meteorStrike` also flattens vegetation in a blast zone out to 2.2 crater radii.
- **Escaping uninhabitable ground.** A creature standing where its species cannot live (flooded land, a dried pond) looks for the nearest habitable tile within the distance it can cover before its health runs out (health drains 4.5% of max per tick), and moves there ignoring the usual terrain rules for that dash. With none in reach it dies at once, as before.

### Undo and redo (`src/game/undo.ts`)

- One action is one stroke (or one tap of a one-shot power).
- `UndoHistory.record()` installs `world.recorder` only while the tool itself runs, so simulation changes between applications are never captured.
- The first time a tile is touched, its 8 per-tile values are saved ("before"); when the action ends, the same tiles' values are saved again ("after"). Actions that changed nothing are dropped.
- **Conflict check.** Undo restores a tile only if its height, terrain, long-term climate, water memory and flood terrain still equal "after". Redo re-applies only if they still equal "before". A tile the simulation changed in between (lake dried, grass grazed, forest burned, flood drained) keeps its newer state, and the result reports how many tiles were skipped. Current temperature and moisture are passing weather: they never block, and are only changed where the action itself changed them.
- Undo bumps `passVersion` when movement classes change (through `writeTile`) and puts out fires on reverted tiles. Redo does not re-ignite.
- A new action clears the redo stack. History is bounded across both stacks: 40 actions and 400,000 tiles (about 20 bytes each, so at most about 8 MB).
- Not undoable: creatures (spawn, remove, deaths), buffs and debuffs, weather systems (Rain, Drought), fire spreading, Extinguish, and every natural change.

### Save files (`src/save/file.ts`)

- The file is the same `SaveData` the IndexedDB slots store, as JSON `{ format: "alvoxis-world-save", fileVersion: 1, save }`. Typed arrays are written as `{ "$t": "Float32Array", "b64": … }`. The JSON is gzip-compressed with `CompressionStream` where available, and import accepts gzip or plain JSON.
- Import never touches the running world until the file has passed every check: size limits, format tag, file and save versions, map size (≤ 4096 per side, ≤ 4M tiles), allowed array types, then a dry-run `deserializeInto` on a scratch simulation. Errors are `SaveFileError` with a message for the player.
- The loader itself also checks creature array types and counters, the burning-tile list and the food map, so damaged slots fail cleanly too.

### Buffs and debuffs (`src/sim/effects.ts`)

- Eight effects in opposite pairs (Haste/Slowness, Regeneration/Poison, Well fed/Famished, Fertility/Sterility), stored per creature as remaining ticks and strength (1–3) plus a bit mask (`Creatures.effTicks`, `effPower`, `effMask`).
- Applying an effect removes its opposite; reapplying keeps the longer duration and the new strength. Effects count down every tick and are saved (format v5).
- Each effect hooks one rule: speed, needs, health per tick, breeding readiness or chance. Creatures without effects skip the code path (mask check).

### World sizes (`src/world/generator.ts`)

- Presets from Small (256×160) to Giant (2048×1280), plus custom sizes validated by `checkWorldSize` (multiples of 32, 128–4096 per side, at most 4M tiles).
- `featureScale(w, h)` = √(area / medium area), clamped to 1–2.5. Continents, mountain ranges, hills and climate zones scale with it, so big maps have big continents rather than more noise. Lakes need deeper and larger basins there, and rivers carrying 14× the river threshold are widened to two tiles. Medium and smaller maps have scale 1 and generate exactly as before.
- Per-tile memory was reduced for big maps: Pathfinder state is 9 bytes per tile (float cost, a 3-bit direction byte instead of a parent index, one stamp word for open/closed) and its heap, queue and path buffers grow on demand. Region labels are `Uint16Array` unless a class has 65,535 or more regions.

### Workers (`src/world/genjobs.ts`, `src/sim/navjobs.ts`)

Both workers follow the same pattern:
1. A pure job function (`computeWorld`, `computeNav`) that never throws; errors come back as results.
2. A tiny worker entry file, bundled by Vite through `new Worker(new URL(...), { type: 'module' })`.
3. A main-thread client that falls back to running the same function locally.

Navigation rebuilds are installed at a fixed tick: the request tick plus `navDelay(width, height)`, which is 20 to 150 ticks depending only on map size. Results therefore never depend on timing. See docs/PERFORMANCE.md for the investigation.

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

- **Three levels**, chosen by device pixels per tile `s`:
  - `s < 3`: the **1 px per tile** `base` canvas (an `ImageData` updated per dirty chunk). Land is slope-shaded and the sea is coloured by depth. It is drawn with smoothing when shrunk (`s < 1`) and also feeds the minimap.
  - `3 ≤ s < 9`: **4 px per tile** chunks (128×128 canvases, LRU of 160).
  - `s ≥ 9`: **8 px per tile** chunks (256×256, LRU of 80).
- Chunks are painted by **`TerrainPainter`** (`src/render/painter.ts`), a pure function over the world arrays, so it is deterministic and unit-tested without a DOM:
  - Each pixel samples terrain at a slightly **warped** position (a tileable smooth offset field, ±0.34 tile), so biome borders and coasts are organic instead of square. Rivers are never warped, so their tiles stay exact; their staircase corners are cut and filled diagonally.
  - Light comes from tile-corner slopes, interpolated bilinearly per pixel, plus a fine grain table and mirrored art variants so tiles don't repeat visibly.
  - The sea's colour depends only on interpolated depth (no deep/shallow tile edge), with foam and wet shallows where land is near the warped sample.
  - Trees, conifers, acacias, mountain peaks (big ones on ridge crests, snow-capped when high or cold) and reeds are **sprites** that may overlap neighbouring tiles. Chunks read a one-tile margin, and decoration checks its neighbours, so `World.markDirty` invalidates chunks within two tiles of a change.
  - The optional overlay hatches mountains and snow, the terrain lowland animals cannot cross.
- Dirty chunks are marked **stale**, not dropped: the old image stays on screen until it is repainted in place. Painting runs centre-first within a 6 ms budget per frame, with at least one chunk per frame.
- **Sky layer** (`src/render/skyfx.ts`, `SkyRenderer`), drawn after the creatures and before the selection ring. It only reads simulation state:
  - Cloud sprites are pre-rendered once (4 shapes × 4 palettes: fair, rain, storm, snow, plus a shadow silhouette per shape), so each cloud is one `drawImage`. Fair-weather clouds (about one per 2,500 tiles, at most 120, positions wrapped around the world from the wind drift) are skipped when the camera is close; weather clouds are 4–12 puffs per system.
  - Rain and snow particles are generated per frame inside the on-screen part of each system from a hash (no particle state), capped at 90 and 110.
  - Lightning bolts, meteors with trails and landing markers, smoke from a bounded sample of burning tiles, and impact dust and rings are drawn from small lists that `Game` keeps for a second or so after the simulation emits events.
- Other overlays: water glints (at most 500 per frame), pixel flame sprites up close, creatures (culled to the viewport; dots far away, sprites close up) and the selection ring.
- Chunk edges are snapped to whole device pixels to avoid seams.

## Input

`InputController` turns pointer events into one of four modes: `stroke` (tool), `pan`, `gesture` (two-finger pan and pinch) or `pending`. Touch strokes wait 70 ms, so a second finger turns into a pinch instead of a stray paint dab. Tools declare `repeatMs`: `0` means apply on move with interpolation, a positive value means apply on a timer while held, and `Infinity` means apply once.

## Adding things

- **New terrain:** add an id to `T` and a `TERRAIN` entry, handle it in `classify` and `Tileset.draw` (plus `drawGround` and `TerrainPainter.paintFeatures` if it has trees or other sprites), then (optionally) add `paintTool(id)` in `game/tools.ts`.
- **New buff or debuff:** add an id and an `EFFECTS` entry (with its opposite) in `sim/effects.ts`, raise `EFFECT_COUNT`, and add its rule in `Creatures` (`tickEffects`, `speedOf`, needs or breeding). The Buffs & Debuffs tab lists it automatically.
- **New species:** add a `SPECIES` entry (plus a constant for its id) and a pixel-art entry in `PIXEL_ART` (`render/tileset.ts`, one character per pixel, 1/8 tile per pixel), then a `spawnTool` line in `game/tools.ts`. Shared behaviour comes from the species data. Truly new movement (flying, amphibious) needs a new movement class in `pathfinding.ts` (`MOVE`, `passableId`, and a `WaterField` entry if it drinks).
- **New tool:** add an object to `TOOLS`. The UI picks it up automatically.

## Frame budgeting (Technical Improvement Milestone)

- `Simulation.advance` stops ticking when 12 ms of a frame is spent (`SIM_BUDGET_MS`); backlog is capped at 2 frames, `achievedSpeed`/`throttled` feed the speed label.
- `Renderer.flushDirty` repaints dirty chunks and the 1 px map within 4 ms per frame, visible chunks first.
- `FoodMap.update` recounts a few bands per tick (full map every 50 ticks); weather climate relaxation sweeps a contiguous window with a cursor.
- Meteor showers: `Sky.showers` queue (≤ 4 showers, ≤ 120 queued, ≤ 24 in flight), launched by `Simulation.tickShowers`.
- Save format v7 adds the relax cursor, showers and food-map cursor; older saves load (slopes are recomputed).

## Localisation and settings (Interface and Settings milestone)

- `src/i18n/index.ts`: `t(key, params)`, `td(dynamicKey)`, `tn(base, n)` (plural forms `_one/_few/_many/_other` chosen with `Intl.PluralRules`), `setLang`, `onLangChange`, `applyDom`. The language is kept in `localStorage` (`alvoxis.lang`) and applied before the first frame.
- `src/i18n/en.ts` is the source of truth (typed object); `ru.ts` and `zh.ts` are typed `Dict`, so a missing key is a compile error. `tests/i18n.test.ts` additionally checks placeholders, plural forms, absence of untranslated Latin words, that every `data-i18n*` key in `index.html` exists, and that every species, terrain, effect, tool, state, cause, season and message code has a translation.
- Static markup uses `data-i18n`, `data-i18n-aria`, `data-i18n-title`, `data-i18n-ph`; text built in code (`Hud.retranslate()`) is rebuilt on every language change.
- Game data keep English ids/names (`SPECIES[].name`, `TERRAIN[].name`, tool `label`) because saves, undo labels and tests use them; `src/i18n/names.ts` maps them to display text.
- Simulation history lines: `Simulation.log(text, code?, params?)` keeps the English `text` and adds an optional message code and values; `messageText()` renders them in the current language. Old saves have no code and show their text.
- **Adding a feature**: add the key to `en.ts` first, then `ru.ts` and `zh.ts` (TypeScript and the parity test enforce it). Use `t()`/`tn()` for every string shown to the player.
- `src/game/settings.ts`: `SettingsStore` (localStorage `alvoxis.settings`; validated on read; reads the old `alvoxis.clouds` key). `renderQualityOf()` maps settings to `Renderer.quality` (`particleScale`, `reduced`, `lowRes`), which only the renderer and `SkyRenderer` read. `src/game/promo.ts` is the local test promo list. `src/app/version.ts` holds the version and changelog; `src/app/diagnostics.ts` builds the diagnostics text.
- The Settings dialog is one `<dialog>` with seven `.set-sec` panels switched by `#set-nav`; confirmations use a second `<dialog id="confirm">` via `Hud.confirm()`.

## Settlements (`src/sim/settlements.ts`)

- `Settlements` lives on `Simulation.settlements`. It uses no random numbers and runs `step()` every 20 ticks after `creatures.tick`; with no settlements it does nothing, so existing deterministic runs are unchanged.
- Membership: `Creatures.onBirth(child, parent)` and `onDeath(id)` hooks keep the member id lists exact; `step()` adds free creatures of the species inside the radius and drops members that moved away. `memberOf: Map<id, settlementId>` gives O(1) lookups.
- Territory: `recomputeTerritory()` builds each settlement's tile list (passable land for the species, within the radius, 4-connected to the centre, earlier ids win) and its border edge list `(tile << 2) | side`, and fills `owner: Uint16Array` (2 bytes per tile, allocated only while settlements exist; about 5 MB on a Giant map). It reruns on founding, radius change, disappearance and `World.passVersion` changes.
- Rendering: `Renderer.drawSettlements` strokes the edge list segments in view; the settings flag `borders` only controls drawing.
- Saving: `SaveData.settlements?` (save version 8); `importState` validates ids, species, coordinates and members, then rebuilds territory.
- Extension points for later stages (not implemented): species/race of members is per settlement; a state would own several settlements by id; events already carry codes and parameters for history and translation.
