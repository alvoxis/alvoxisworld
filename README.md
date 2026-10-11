# ALVOXIS: World Evolution

An original, browser-based sandbox god game with top-down pixel-art graphics: shape a procedurally generated world, paint biomes, release life and watch the world evolve over seasons and years.

> **Status: Milestone 5b (sky and disasters on top of Milestone 5: bigger worlds, map graphics, tool tabs, buffs and debuffs, redo, save files).** Read [What works](#what-works) and [Not implemented yet](#not-implemented-yet) before assuming a feature exists.

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
| Pause / speed | ⏸ / ▶ and the ‹ › arrows (1×, 2×, 3×, 5×, 10×, 20×) | Same buttons, `Space` toggles pause |
| Undo / redo | ↶ / ↷ | Ctrl/Cmd+Z; Ctrl/Cmd+Shift+Z or Ctrl+Y |

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server with hot reload, reachable from the LAN |
| `npm run build` | Type-check, then build the production site into `dist/` |
| `npm run preview` | Serve the built `dist/` |
| `npm run typecheck` | `tsc --noEmit` (strict) |
| `npm test` | Vitest unit tests (generation and sizes, brushes, simulation, effects, weather, fire, disasters, undo/redo, workers, save/load and save files, time controls, map painting, camera) |
| `npm run check` | Typecheck, tests and build: what CI runs |
| `npm run bench` | Repeatable simulation benchmarks: ecosystem, capped herbivores, long routes, undo history (see [docs/PERFORMANCE.md](docs/PERFORMANCE.md)) |
| `npx vite-node scripts/behavior.ts 4,11,21 4` | Behaviour diagnostics: death causes, animals that barely move, animals on illegal terrain, time per state (seeds, years) |
| `npm run bench:sizes` | Generation time, memory, tick cost and save size for every world size |

You need Node.js 22.12 or newer (Vite 8 and Vitest 5; CI uses 22).

## What works

**World**
- Procedural world generation from a seed: continents and islands, ridged mountain ranges, ocean depth, latitude- and altitude-based temperature, and moisture. Generation is deterministic, so the same seed and size always give the same world.
- 16 terrain types: deep ocean, shallow water, lake, river, beach, grassland, forest, jungle, savanna, desert, swamp, tundra, snow, hills, mountain and bare soil.
- **Rivers and lakes** (Milestone 3), generated from the terrain using priority-flood hydrology:
  - Every land tile drains downhill toward the sea; closed basins deeper than a threshold fill as lakes.
  - Tiles that collect enough rain from upstream (more where it is wet) become rivers, kept 4-connected so fish can swim along them.
  - Rivers cover about 2% of land, lakes about 3–9%, depending on the seed. Same seed, same rivers.
  - **Rivers are fordable:** land animals wade across them, slowly. So rivers never cut the land into separate regions; a test checks this. Lakes are not fordable.
- **World sizes** (Milestone 5): Small 256×160, Medium 512×320 (default), Large 1024×640, Huge 1536×960, Giant 2048×1280, or a **custom** size (each side 128–4096 tiles in steps of 32, at most about 4.2 million tiles). The menu shows each size's estimated memory and warns about the big ones on phones.
  - Maps larger than Medium scale their continents, mountain ranges and climate zones with the map, so they have bigger landmasses and oceans rather than more noise. Their main rivers are two tiles wide, and lakes need deeper basins so they don't crowd the land. Medium and smaller maps generate exactly as before.
  - New worlds are generated in a Web Worker, so the page stays responsive. If workers aren't available or fail, the same generator runs on the main thread with the same result.

**Weather** (Milestone 4, extended in 5b). Weather is simulated, not just drawn. It runs on the simulation clock, so pausing stops it and speed controls speed it up.
- **Moving systems.** Rain, snow, thunderstorms and droughts form by themselves according to season and severity, drift with a slowly turning wind, and fade. Their effects apply to a sample of the tiles under each system every 10 ticks, so cost doesn't grow with the size of the map. There are at most 4 automatic systems plus 6 from god powers.
- **Rain:**
  - Raises moisture and cools.
  - Puts out fires.
  - Refills dried lake and river beds.
  - Heavy rain floods low land next to rivers and lakes with *temporary* water, which drains back to the original terrain afterwards.
  - Greens bare soil outside winter when the ground is wet enough (faster than vegetation regrowth alone).
- **Snow.** Precipitation falls as snow on tiles colder than about 0.39 (and everywhere under the Snow power): wetter and colder, puts out fires, no floods and no refilling of beds (frozen). It settles on cold tundra as **snow cover**: the tile becomes snow, which lowland animals (hadrosaurs, tyrants) cannot cross and nothing can eat. Snow cover melts from spring to autumn, or at once under rain or drought, and stays in winter.
- **Thunderstorms.** A storm is a heavy rain system that throws lightning (at most 6 strikes per weather step). A strike kills or injures creatures at the spot (cause of death: lightning) and ignites burnable ground with a chance that grows with dryness (15% on soaked ground up to 75% on bone-dry ground). Snow and droughts never produce lightning.
- **Drought:**
  - Lowers moisture and warms.
  - Drains floods.
  - Shrinks lakes from the shore inward, and dries river tiles into sandy beds.
  - Withers grass to bare soil and forest to grass.
  - Makes fires spread 1.6× faster.
- **Recovery.** Lakes and rivers remember their beds and refill when the weather allows. After weather passes, the climate drifts back to each tile's long-term values.
- **Animals.** Drought makes animals thirstier and rain less thirsty. Shrinking water and floods change where they can walk and drink; routes adapt automatically.
- **Settings** (⚙ Settings → Simulation): turn automatic weather on or off, and choose Mild, Normal or Extreme. The top bar shows active rain, storms, snow, droughts, meteors in flight and fires.

**Fire.** Fire spreads to the four neighbours with a chance of fuel × dryness² (forest 0.9, savanna 0.85, grass 0.65, jungle 0.6, hills 0.45, tundra 0.3, swamp 0.12; desert, rock, snow and water never burn). Since 5b it also runs **with the wind** (×1.7 downwind, ×0.3 upwind) and **uphill** (×1.25, downhill ×0.85). Rain and snow put it out, water and bare ground are firebreaks, burned land becomes bare soil that regrows, and at most 3,000 tiles burn at once. Animals notice fire 3 tiles away and run from it; those in flames take damage.

**Natural disasters** (Milestone 5b, ⚙ Settings → Simulation). **Off by default**, so the world only changes when you ask. When on, a roll every 40 ticks may start a meteor, an earthquake or a wildfire, each separately switchable, at a Rare / Normal / Frequent rate (expected per game year on a medium map: meteors 0.2 / 0.7 / 1.8, earthquakes 0.15 / 0.5 / 1.3, wildfires 0.3 / 0.9 / 2.2; bigger maps get up to 2.5× more). Natural meteors are mostly small (70%), sometimes medium (25%) and rarely large (5%). Wildfires start only on burnable, dry ground (moisture ≤ 120) where it is not raining. All of it uses the simulation random generator, so it is deterministic, and none of it enters the undo history. Settings are saved with the world.

**Rendering** (redone in Milestone 5)
- **Three zoom levels.** Far out, one shaded pixel per tile (slope shading, sea coloured by depth). In the middle range, map chunks painted at 4 px per tile. Up close, 8 px per tile pixel art.
- **Natural-looking map.**
  - Biome borders and coasts are drawn organically instead of as square tiles; the tiles themselves are unchanged.
  - Hills and mountains get smooth slope lighting.
  - The sea shades from turquoise shallows to deep blue, with foam along the shore.
  - Rivers run as smooth channels with clear banks.
  - Forests, jungles, tundra conifers, savanna acacias, swamp reeds and mountain peaks (big ones along ridge crests, snow-capped when high or cold) are drawn as sprites that overlap tile edges.
- **Passable or not.** Water is always clearly water. Menu → View → *Mark terrain lowland animals cannot cross* hatches mountains and snow.
- **Sky** (5b). Pixel-art clouds drift with the wind, with soft shadows on the ground. **Rain, snow and storm clouds** belong to their weather systems (darker for storms, white for snow) and move with them; **fair-weather clouds** are decoration only: they follow the wind, fade out as you zoom in, thin out when the whole world is in view, and can be switched off (⚙ Settings → Graphics & Performance). Rain falls as streaks and snow as flakes, only over the part of a system that is on screen (at most 90 and 110 particles). Lightning draws a jagged bolt and flashes the sky briefly. A meteor in flight shows a fiery head with a trail of fire turning into smoke and a pulsing ring where it will land; impacts add a shock ring and rising dust. Burning tiles show animated flames up close and rising smoke (at most 40 plumes). Drought is a warm haze.
- **Other effects.** Glints drift across open water. Earthquakes show a ripple. In winter, cold land is frosted.
- **Minimap** (bottom right; 🗺 shows or hides it): the whole world, scaled with high-quality smoothing, with the camera's view as a yellow frame. Tap or drag on it to move the camera.
- Map chunks are painted lazily within a small per-frame time budget, centre of the screen first, and cached. After a change, the old image stays visible until it is repainted, so nothing flashes. The display is crisp on Retina screens (device pixel ratio capped at 2).

**Tools** (every button performs a real action). Four tabs along the bottom: **Creatures** (*Life* on phones), **Biomes**, **God Powers** (*Powers*) and **Buffs & Debuffs** (*Effects*). ✋ Move and 🔍 Inspect stay available on every tab, and so do the time controls in the top bar. Tapping a tool shows a one-line hint.
- **Creatures:** Select, spawn any species (the list comes from the species data, so new species and races appear automatically), and Remove life.
- **Biomes:** paint any of 15 terrain types, including Lake and River, with an adjustable brush. Painting also sets height and climate so the result stays consistent: painted forest can spread, and painted water floods the land. Painted rivers and lakes are real water that animals drink from, wade through or swim in. Navigation updates automatically.
- **God Powers.** The brush size sets the radius, and **Power ●○○ / ●●○ / ●●●** sets the intensity where it applies.
  - **Raise / Lower / Smooth:** soft circular terrain brushes. Biomes are recalculated from height and climate, so raising the seabed makes islands with beaches.
  - **Flood:** turns dry land into temporary flood water, which drains back to the original terrain over time; rain keeps it, drought dries it. Mountains and snow don't flood.
  - **Drain:** removes flood water, empties lakes to a bare lake bed and dries rivers to a sandy bed. Beds remember they were water, so rain can refill them. The sea is never drained.
  - **Rain / Drought:** place a rain system or a drought there (radius about 4× brush size, lasts about 100 game days).
  - **Storm:** a thunderstorm with lightning (see Weather). **Snow:** snowfall that settles on tundra. **Lightning:** one bolt at the tapped point (repeats while held): kills or hurts creatures there and may ignite dry vegetation. **Drought:** see Weather.
  - **Fire:** sets burnable ground alight; see Fire above.
  - **Extinguish:** puts out every fire under the brush.
  - **Meteor:** a meteor falls from the sky and lands about 2 seconds later (of simulated time; it pauses with the game). **Brush size sets the crater radius and Power sets the energy** (depth, blast and number of fires): small, medium and large are named by crater radius (under 4, under 8, 8 and more tiles). On landing it digs a bowl crater with a raised rim and scorches the floor; a crater below sea level becomes a crater lake. Animals inside are killed and those nearby injured; vegetation out to 2.2 crater radii is flattened to bare soil (more near the crater) and up to 60 fires start around the rim. Animals within the danger zone run away while it falls, and at most 24 meteors can be in the sky. **Undo reverts one landed meteor as one step** (tiles that fire or weather changed since are kept).
  - **Meteor shower:** its own tool. The circle is the area the meteors fall in (at least 3 tiles), **Count** (6, 12, 24 or 48) is how many, and **Power** (1–3) sets how big they are (1: small stones; 2: some medium; 3: medium and the odd large one). Each meteor has its own direction and impact point and does the full job (crater, deaths, vegetation, fires). They are launched over about 5 seconds; at most 4 showers, 120 queued meteors and 24 in the air at once, so a phone is never flooded. Showers cannot be undone, and a launched meteor cannot be cancelled.
  - **Earthquake:** a fault line drops into a rift, the ground around it buckles (fading with distance), and animals are hurt by the shaking.
- **Buffs & Debuffs** (Milestone 5). Tap creatures to apply an effect to every creature under the brush, or to the nearest one within 2 tiles. **Power** sets the strength (1–3) and **⏳ Short / Medium / Long** the duration (30, 120 or 360 days). A toast says how many creatures were affected.

  | Buff | Effect | Opposite debuff | Effect |
  |---|---|---|---|
  | 💨 Haste | moves 25% faster per level | 🐌 Slowness | 20% slower per level |
  | 💚 Regeneration | heals 0.4% of max health per tick per level | ☠️ Poison | loses 0.2% per tick per level; can kill (cause: poison) |
  | 🍖 Well fed | hunger and thirst don't grow | 🦴 Famished | hunger and thirst grow 50% faster per level |
  | 🥚 Fertility | shorter breeding cooldown, higher chance | 🚫 Sterility | cannot breed |

  - **Rules:** applying an effect removes its opposite. Reapplying an active effect keeps the longer remaining time and takes the new strength. Effects count down with the simulation, pause with it, and are saved.
  - **Removing:** the creature panel lists active effects with strength and days left; ✕ removes one. ✨ Cleanse removes all effects from creatures under the brush.
- **Undo / redo** (↶ ↷ beside the zoom buttons; Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z or Ctrl+Y). One brush stroke is one step. Up to 40 steps (and 400,000 changed tiles, about 8 MB) are kept, and a new action clears redo. Each step stores the before and after values of the tiles it changed, not a world snapshot.
  - **Conflict-aware.** Undo only reverts tiles that still look exactly as the action left them. If the world has changed a tile since (rain refilled a lake, grazing turned grass to soil, fire burned a forest, a flood drained), that tile keeps its newer state and the toast says how many tiles were kept. Redo works the same way in reverse. So undo never restores stale terrain over later simulation changes.
  - **Can be undone:** Raise, Lower, Smooth, Flood, Drain; painting any biome, lake or river; the terrain part of Meteor and Earthquake (fires on reverted tiles are put out).
  - **Cannot be undone:** creatures spawned, removed or killed (by disasters too); buffs and debuffs; Rain and Drought (they change the weather over time); Fire and Extinguish; natural changes (grazing, weather, fire spreading). Redo does not relight fires.
  - History is cleared when you create, load or import a world.
- **Water rule for terrain brushes:** Raise, Lower and Smooth keep rivers, lakes and flood water while the tile stays at or above sea level. Lowering fresh water below sea level turns it into sea. Painting any other biome over water replaces it, including its bed memory. Undo can bring it back.
- **Area size** is a row of seven round buttons, from very small to very large (radius 1, 2, 4, 7, 11, 16, 24 tiles). The selected one is filled, and the same radius is used by every tool that has an area (biomes, terrain brushes, spawning, weather, fire, buffs, meteors). Hovering or touching the map draws the real area of the selected tool: a solid ring where it acts and, for meteors, a dashed outer ring for the blast zone. Choosing a size flashes the ring at the screen centre. Weather powers use 4× (storm 3×) the radius, with a minimum of 6 tiles; the ring shows exactly that.

**Simulation**
- Fixed-timestep clock: day, season and year (10 ticks per second at 1×). **Time controls** (Milestone 5): ⏸/▶ pauses and resumes, keeping the chosen speed; ‹ and › step through 1×, 2×, 3×, 5×, 10× and 20×, and are disabled at the ends. The current speed shows next to them. They change the real simulation rate, measured at 100 ticks per second at 10× and 200 at 20×.
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
- **Selecting a creature:** with Select (Creatures tab) or 🔍 Inspect, tap a creature to see its live panel: species, ID, stage and age, what it's doing, health, hunger and thirst bars, and active buffs and debuffs. **Follow** keeps the camera on it; **Remove** deletes it. The panel shows how it died if it dies while selected.
- History log: first appearance of each species, extinctions, world creation.
- World statistics: land share, biome mix, and per species the number alive, born, and deaths by cause.

**Persistence**
- Three save slots in IndexedDB, with Save, Load and Delete. A save (format v7) holds everything needed for the world to continue exactly as it would have:
  - the full map, including rivers and lakes;
  - current and long-term climate, water memory (dried beds, floods), and burning tiles;
  - weather systems (with ids, storm and snow state, and the wind drift that moves the clouds), meteors in flight, and the weather and disaster settings;
  - creatures (IDs, needs, health, states, current routes, buffs and debuffs);
  - the navigation snapshot, clock, history and RNG state.
- Older saves still load. v5 and older worlds have no sky block, so they start with the default disaster settings (off), no meteors, and weather systems that get new ids. v4 creatures start without effects. v3 and v2 worlds take today's climate as long-term climate, and their lakes and rivers remember their beds. v2 animals simply plan new routes, and v1 animals get full health and new IDs.
- **Save files** (Milestone 5, ⚙ Settings → Save & Load): **⬇ Export to file** downloads the current world as a `.alvoxis` file (gzip-compressed JSON, about 0.6 MB for a Medium world). **⬆ Import file** loads one on any device.
  - Imports are checked completely before anything changes: file size, format, versions, map size, data types, and a trial load. A damaged, foreign or too-new file shows a clear error and leaves your world untouched.
  - Files from older versions (v1–v4 inside) are upgraded on import, and the message says so.
- New world from a seed (text or number) or a random seed, in any size.

**Mobile**
- Built for mobile Safari: safe-area insets, `100dvh`, no page zoom or bounce while interacting with the map, 40–64 px touch targets, and 16 px inputs so iOS doesn't auto-zoom.
- Two-finger gestures never paint: touch strokes start after a 70 ms delay, so a pinch doesn't leave a stray brush dab.

## Not implemented yet

These are planned (see [docs/ROADMAP.md](docs/ROADMAP.md)) but **do not exist in the game yet**:

- Domestic animals, birds and reptiles; pack hunting; herds and migration, nests and eggs, sexes and genetics.
- Humanoid races (humans, elves, dwarves, orcs, demons, demigods), hybrids and genetics.
- Settlements, buildings, civilizations, diplomacy, alliances and war.
- Player currency and progression.
- Further god powers (plagues, volcanoes, tornadoes, floods from the sea) and buffs/debuffs beyond the eight above.
- Erosion, new rivers carving their own course, snow cover beyond tundra (it never settles on grass, forest or mountains), and long-term climate change.
- Technological eras (industrial, modern, space).
- Undo for creature actions and buffs, sound, and an offline/PWA cache.

Known limitations:
- **Simulation thread.** The simulation tick itself still runs on the main thread; only world generation and navigation rebuilds use workers. Moving the whole tick is not done yet; see [docs/PERFORMANCE.md](docs/PERFORMANCE.md) for why and what it would take.
- **Navigation lags terrain.** After weather or brushes change where animals can walk, the water map and region graph follow within about 60 ticks plus a delivery delay of 20–150 ticks (by map size). Animals check each step of their route meanwhile, so they never walk into water, but they may briefly head for water that has just dried up.
- **Long routes.** Routes are planned in legs of about 24 tiles over a coarse region graph, so routes of any length work, but they're not perfectly shortest. Food is found within sight, or by migrating to the nearest reachable food within about 128 tiles.
- **Snow cover and navigation.** Snow cover changes where hadrosaurs and tyrants can walk, so snowfall on tundra triggers the same navigation rebuilds as floods (at most one per 60 ticks; in a worker in the browser). Decorative clouds are only a picture: rain, snow and storm clouds show the real weather systems, but their shapes and the exact positions of drops and flakes are drawn, not simulated.
- **Meteors in flight** are one-way: once launched they cannot be cancelled, and the landing spot is fixed when they launch. Natural disasters and meteor showers are not undoable, and a player meteor's undo skips tiles that fire has already burned.
- **Weather and water levels** are tile-based: lakes shrink and grow from the shore, rivers dry and refill tile by tile, and floods cover low land beside rivers and lakes. There is no water volume or depth simulation.
- Populations still rise and fall, and a species can die out; that's a valid outcome (see [docs/ECOSYSTEM.md](docs/ECOSYSTEM.md)). Tyrants are a small population and the most likely to die out (in 1 of 3 test worlds after about 10 years). Herbivores with plenty of food reach their population caps.
- **Performance on phones.** Everything was measured in headless desktop Chromium with iPhone-sized emulation and in Node, **not on a physical iPhone**. Huge and Giant maps (about 55 and 100 MB) may be slow or run out of memory on phones. At 20× with about 6,000 animals, frames took up to about 30 ms here (about 30 fps). See [docs/PERFORMANCE.md](docs/PERFORMANCE.md).
- **Map painting** runs on the main thread. After a fast zoom or a big weather change, chunks sharpen over a few frames (the coarser map shows meanwhile).
- **Organic borders are visual.** Coasts and biome edges are drawn up to about a third of a tile away from the true tile border; the simulation still uses tiles. Turn on the passability overlay for a precise view of mountains and snow.
- Saves stay in the browser where they were made. Clearing Safari website data deletes them.
- `npm audit` reports **0 vulnerabilities** after the Milestone 5 toolchain upgrade (Vite 8.2.2, Vitest 5.0.1, vite-node 6.0.0, pinned). `.npmrc` sets `legacy-peer-deps` because npm 10 fails to resolve Vitest 5's unused optional browser peers.

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): technology choices, module layout, data model and performance strategy.
- [docs/ROADMAP.md](docs/ROADMAP.md): milestones from this foundation to civilizations and the space age.
- [docs/ECOSYSTEM.md](docs/ECOSYSTEM.md): the population-stability investigation: method, measurements and the balance changes they justified.
- [docs/PERFORMANCE.md](docs/PERFORMANCE.md): Milestone 5 measurements (world sizes, memory, zoom levels, speeds, populations, minimap, undo), Milestone 4 benchmarks, the Web Worker investigation, and how to reproduce them.

## Technical improvements (passability and performance)

- **Slopes.** Every tile has a slope class derived from the height difference to its neighbours (open water ignored): gentle, steep (≥ 13 units) or sheer cliff (≥ 20). Cliffs block every walker; steep slopes cost double and are closed to lowland species like the hadrosaur; mountains, snow and water keep their rules. Swimmers are unaffected. The class is updated locally whenever height or water changes. *Menu → Mark ground animals cannot cross* shows red for blocked terrain and crossed lines for cliffs.
- **Detours and stuck animals.** Routes go around blocked ground; an animal that ends up on newly blocked ground (a cliff rises, snow settles) dashes to the nearest open tile; one fully walled in stays put and is counted as trapped. Animals never cut a corner between two blocked tiles. Changing terrain bumps a version, shared navigation is rebuilt at most once per 60 ticks (in a worker in the browser) and routes re-check every step against live terrain.
- **Frame budget.** The simulation never spends more than about 12 ms of a frame; if the device cannot keep up, it runs slower and the speed label shows the achieved speed in orange. The map is repainted in small budgeted batches, visible chunks first.

## Interface and Settings (v0.7.0)

- **Three languages**: Русский (ru), English (en) and 简体中文 (zh-CN). ⚙ Settings → Language switches every menu, button, tool, species, biome, effect, status line, toast and history entry at once, without reloading or touching the world. The choice is stored on this device (`alvoxis.lang`); on first start the browser's language is used, else English. History messages are stored with a message code (save format unchanged, extra optional fields), so a loaded world speaks the language chosen now; entries from older saves keep their stored English text. Dictionaries live in `src/i18n/` (see ARCHITECTURE.md); a test fails if a language lacks a key or leaves English words in.
- **Tool categories** Life / Biomes / Powers / Effects have their own small original SVG icons (inline, no downloads) and 52 px tap targets; the selected category is highlighted. The round size buttons and area rings are unchanged.
- **⚙ Settings** (the gear at the top left) has seven sections:
  - *Language*.
  - *Save & Load*: three IndexedDB slots (loading asks for confirmation), export/import of files (import asks for confirmation), and **New world** (seed, size, asks before discarding the current world).
  - *Graphics & Performance*: fewer decorative particles, reduced visual effects, performance mode, fair-weather clouds, the passability overlay and the area-ring colour. These change only how things are drawn: particle caps (rain, snow, smoke, dust, ambient clouds) drop to about a third; glints, cloud shadows and flashes are skipped; performance mode also draws at 1× pixel density instead of up to 2× and repaints map changes in 2 ms steps. The simulation is identical in every mode.
  - *Simulation*: time speed (the same control as the top-bar buttons), automatic weather and severity, natural disasters and their kinds and frequency.
  - *Statistics*: world age, map size and seed, animals alive (herbivores/predators), births and deaths, sky events this session, land and biome shares, per-species counts and causes of death, and the history log. Only values the simulation really tracks.
  - *About & Feedback*: version, save format, short help, changelog, and **Copy diagnostics** (version, language, device, viewport, world size/seed/tick, settings and the last five errors; no save contents or personal data; if the clipboard is not allowed the text is shown selected so it can be copied by hand). There is no online feedback service yet.
  - *Promo Codes & Gifts*: see below.
- **Promo codes (local test prototype)**: `WELCOME` gives the cosmetic *Aurora* area ring, `ALVOXIS` the *Gold* area ring (choose it in Graphics & Performance). States: activated (reward shown), already used, invalid, empty. **This is not a secure system**: codes are checked in the app itself, the list is visible in the source, and used codes are remembered only in this browser (so clearing site data or using another device allows redeeming again). No payments, no purchases, no Alvoxis Energy.
- Future achievements and rewards are analysed in [docs/ACHIEVEMENTS.md](docs/ACHIEVEMENTS.md); nothing of that is implemented.

## Settlements (Civilization Foundation, v0.8.0)

There are no people in the game yet, so no fictional civilization was added. A **settlement** is the home area of a group of one existing *land* species (grazers, raptors or hadrosaurs); everything shown is read from the running simulation.

- **Found one:** (until 0.17) Life tab → *Found settlement*, then tap the ground; the tool was removed in 0.18 and existing animal settlements keep living. It needs at least 6 living animals of one land species, not yet in a settlement, within 8 tiles of the spot; open dry land (not water, mountain or snow); land not already claimed; and, for grazing species, at least 20% of the land within 6 tiles that they can eat. Up to 12 settlements. The toast says why a try was refused. Founding is not undoable.
- **Identity:** a unique id, a name made from the world seed and the id (no random numbers), and its own colour.
- **Population:** the members are real creatures (by id). Births to a member join at once, deaths and removals leave at once, creatures of the species that live inside the territory join (checked every 20 ticks), members that wander more than 4 tiles beyond the border leave (moving away). The count is always the number of living members.
- **Territory:** the land tiles within a radius of the centre (6–18, growing with the population as `5 + 1.4·√n`) that the species can stand on, connected to the centre; water, rivers and lakes cut it off. Earlier settlements keep contested tiles. It is rebuilt only when something changes (founding, growth, disappearance, terrain edits such as floods, craters or snow), never every frame.
- **Changes over time:** status founding / growing / stable / declining / fading (sampled every 100 ticks from the real population), milestone events at 10, 25, 50, 100, 200 and 400 animals, and **disappearance**: abandoned when no animals are left, dissolved when fewer than 2 remain for 300 ticks.
- **Borders:** coloured outlines of the real territory, a marker at the centre and (zoomed in) the name and population. Switch them in ⚙ Settings → Graphics & Performance → *Show settlement borders*. The outline comes from precomputed edge lists; each frame only the segments in view are stroked.
- **Card:** use Inspect (or Select) on a tile inside a territory. It shows the name, population, composition by life stage, territory (tiles, radius), age, status, counts (born, died, joined, left, peak) and the last events, and follows the simulation live.
- **Saving:** save format **8** adds an optional `settlements` block (members, stats, events). Territory is not saved; it is rebuilt from the land on load. Saves 1–7 load unchanged (no settlements). Invalid saved data is ignored.

Not included yet: people or other races, buildings, resources, research, diplomacy, wars, rulers, automatic founding, relocation of whole settlements, merging settlements.

## Humans (v0.9.0)

People are a sixth species, **Human**, available from the very first moment: Life tab → Human (two per tap). They are not unlocked by evolution and no existing species was changed, removed or limited.

- **Behaviour, with existing mechanisms only:** people use the same creature system as animals (movement, needs, breeding, ageing, selection, rendering). They walk where lowland animals can (not on mountains, snow, water or sheer cliffs), detour around obstacles, forage plants (grass, forest, jungle, savanna, hills), drink, breed (a litter of one, cooldown 500 ticks), age (adult at 600 ticks, up to 3000), flee predators and meteors, and are hurt by fire, lightning, floods and earthquakes like every creature. A group stops at 20% of the creature capacity.
- **Raptors and tyrants may hunt people** (they were added to their prey lists), so people react to predators and can be eaten; existing predator and prey behaviour is otherwise unchanged.
- **Not in this stage:** buildings, tools, hunting by people, resources, trade, research, rulers, wars, inventory, hybrid species, Alvoxis Energy. People have no needs beyond food and water.
- **Interface:** the status line shows *People N* separately from animals; statistics list People; the creature panel marks them as sentient.
- **Settlements:** the animal settlements of v0.8.0 are unchanged. People now form their own *human* settlements (below); animal settlements never take people and human settlements never take animals.
- **Saves:** format 9 only adds an optional `statSpecies` (how many species the per-species statistics hold). Saves 1–8 load unchanged: death statistics are mapped by species id, birth statistics are padded, and the food map is rebuilt once because it has one more food group.

## Human settlements, economy, growth and technologies (v0.10–0.13)

**Founding (0.10).** (Until 0.17 also by hand: Life tab → *Found human settlement*; since 0.14 people found settlements by themselves, and the tool was removed in 0.18.) It needs at least 6 free people (not in a settlement) within 8 tiles, open dry land the people can stand on (not water, mountain, snow, steep slope or cliff), unclaimed land, a viable amount of connected land (at least 20 tiles) and, for the surroundings, enough plant food. The toast says why a try is refused (not enough people, bad ground, claimed, no food, too many settlements). The *animal* tool takes only animals and the *human* tool only people, so one settlement never mixes them. Members are the real creature ids: births to a member join at once, deaths and removals leave at once, free people who walk into the territory join while housing has room, people who wander more than 4 tiles beyond the border leave. Territory, border, card, age, status and history work as for animal settlements.

**Resources and buildings (0.11).** Each human settlement keeps its own stock of **food, wood and stone** (stock cap 60 each, plus 120 per storehouse) and **knowledge** (cap 500). It starts with a small kit (20 food, 20 wood). Sources:
- *Food*: foraging on the edible land of the territory (at most 0.06 per person and 0.02 per edible tile per step; a step is 20 ticks, a year is 24 steps) and **farms** (1 per step × soil fertility from moisture 0.4–1.4; a farm on land that is no longer farmland yields nothing). Hungry people (hunger ≥ 40) eat from the stock, which really lowers their hunger; with no stock they find food on their own as before.
- *Wood*: **lumber camps** cut 1 wood per step from the forest within 6 tiles; every 10 wood fells a real tree (the forest tile becomes grassland), and the camp stops when no forest is in reach.
- *Stone*: **quarries** cut 0.7 per step from hills and mountains within 5 tiles; the reserve is 60 per rock tile (at most 1500) and runs out.
- *Knowledge*: 0.05 per adult per step.

Buildings: **house** (+5 housing, 10 wood), **farm** (8 wood), **lumber camp** (8 wood), **quarry** (12 wood), **storehouse** (+120 storage, 20 wood and 10 stone). Each needs a free tile inside the territory on gentle ground with type conditions (farm: grass/savanna/soil with moisture; lumber camp: next to ≥ 6 forest tiles; quarry: ≥ 3 rock tiles near), is paid when started, and takes 5–8 steps of work (needs at least 2 people). At most two constructions at a time and 4 / 10 / 24 buildings at camp / village / town stage. Buildings are drawn on the map (finished solid, under construction faded with a progress bar) and burn down in fires and drown when the tile floods.

**Growth (0.12).** Housing is 10 plus 5 per house. A settlement whose people have filled the housing cannot have births, and newcomers stay free. Hunger has consequences: with an empty stock people fall back on foraging by themselves and may starve, but a settlement is not removed while it has people (it dissolves only after fewer than 2 remain for 300 ticks). Stages: **camp**, **village** (12 people, 3 finished buildings including a house and a farm; territory +2) and **town** (30 people, 8 buildings, a storehouse and 2 technologies; territory +4). A stage drops only when the population falls clearly below its requirement. Stage changes, buildings, famines, losses and technologies are written to the history.

**Technologies (0.13).** Knowledge pays for three technologies, each researched in 12 steps and needing a finished building: *Better farming* (+50% food from farms, needs a farm, 30 knowledge), *Better building* (−25% cost, −30% build time, needs a house, 40) and *Better harvesting* (+50% wood and stone, needs a lumber camp or quarry, 50).

**Control.** The settlement card (Inspect on a tile of the territory) shows stage and the conditions for the next one, population and housing, stock with yearly production and consumption, buildings and their state, Build buttons (with the reason when unavailable), technologies with progress and Research buttons, and the history. By default human settlements build and research by themselves with simple rules (food and wood first, then housing, farms, storehouse, quarry; the cheapest available technology); turn that off in ⚙ Settings → Simulation to decide yourself.

**Saves.** Format **10** adds an optional `civ` block per human settlement (stock, buildings, technologies, research, stage) and `auto`; everything is validated on load (unknown building or technology ids, out-of-range numbers, duplicate tiles, members of another species are dropped). Saves 1–9 load unchanged (a human settlement without `civ` gets a fresh one).

**Balance.** In a 20-year run on a test map with forest, hills and a pond (auto mode), a camp of 12 became a village in year 1, a town in year 5, learned all technologies and stayed at 42–56 people, limited by housing. This is one scenario in a test world, **not a verified long-term balance**; real worlds with droughts, fires and predators were not run for decades.

**Not included:** wars, diplomacy, rulers, trade, Alvoxis Energy, hybrid species, roads or unit jobs (people do not walk to workplaces; production is computed per settlement), buildings damaged by earthquakes or meteors other than through fire, flooding and terrain change.

## A living world (v0.14.0)

You can now add people and just run time: groups form, travel, found settlements and move on without any button.

- **Seeing and picking creatures.** Why people were hard to see and pick: (1) settlements were drawn *after* the creatures, so houses, the centre marker and borders covered the people inside them; (2) a person was only 4 px wide at normal zoom and a 1.5 px dot far out; (3) a tap was matched to the creature's feet, although its sprite is drawn above them; (4) a tall settlement card could cover half the map and the Move tool could not pick anything. Now settlements are drawn first, names after the creatures, nothing is drawn smaller than 7 px (people 10 px, with dark rims on the far-zoom dots), a tap on the picture or the feet selects the nearest creature within a finger-sized radius (24 px; tapping the same spot again moves to the next nearest, so crowds can be picked one by one), a short tap with the Move tool also picks, and cards are at most 42% of the screen height.
- **Individual card** (by the permanent id): species and id, stage and age, what it is doing, diet, health, hunger and thirst, effects, home settlement (with an *Open settlement* button) and its group. The selection follows the creature while it moves (even when others around it die and the arrays are compacted); when it dies or is removed the card tells what happened for six seconds and then the selection clears.
- **Groups** (`src/sim/groups.ts`): free people standing within 4 tiles form a group of real creature ids (at most 24); someone within 6 tiles joins it; members who end up more than 10 tiles from the centre leave it (so a group splits where its members really are, never into equal halves); two people alone look for company or a settlement with room within 24–45 tiles. A group can rest together, travel, wait, or find nothing and wait longer (the wait doubles up to 1,200 ticks). Members walk with the normal route-finding when they have no pressing need (state *Traveling*); hunger, thirst, danger and fire still come first. A group bigger than the land around it can feed lets the surplus walk to another good place.
- **Choosing a home** (`src/sim/sites.ts`): one scoring function looks at the real world: terrain the species likes (from its `civ` profile), share of land it can eat, open water within 9 tiles, free unclaimed land, wood and stone nearby, fire within 10 tiles, predators within 6 (refuse) and 14 (penalty), and at least 16 tiles from any settlement. A group first looks for a settlement with room that is not in trouble, then (with at least 4 people) for a good place, tries a few places around it chosen by a hash of its id, and settles only after resting 150 ticks at a place scoring at least 0.5. Autonomous foundings are at least 600 ticks apart worldwide. Everything is switchable in ⚙ Settings → Simulation (*People found settlements by themselves*); groups still form without it, and the *Found human settlement* tool still works.
- **Leaving and moving on.** A human settlement builds up *pressure* from famine, fire on its land, full housing with no way to build and too little food land. At 24 points (and a year after the last departure) about a third of the people, those living farthest from the centre, leave (at least 3, at least 4 stay). They are alive and free, cannot rejoin that settlement for 480 ticks, and look for a new home as a group. Settlements that fall apart release their people alive.
- **Other peoples.** `SpeciesDef.civ` (a `CivProfile`) holds what a people wants: liked terrain, terrain to avoid, water need, smallest founding group, largest travelling group and compatible species. A new people is a new species entry with such a profile; nothing else in groups, scoring or founding is specific to humans. No second people exists yet.
- **Saves**: format **11** adds the optional `groups` block (groups, goals handed out) and per-settlement `stress`, `lastEmigration` and `bans`; older saves load unchanged and invalid data is ignored.

Limits: groups and settlements are single-species; the scoring weights are untuned guesses checked on a few test worlds, not tuned for play.

## Living settlements: jobs and visible work (v0.15.0)

Residents of human settlements now really work at the buildings, and farms, lumber camps, quarries and building sites produce only through them.

- **Jobs** (`assignJobs` in `src/sim/civ.ts`, every settlement step = 20 ticks). Adult residents (not children) get one job each: *construction* (up to 3 builders per site), *field work* (2 per farm), *woodcutting* (2 per lumber camp), *quarrying* (2 per quarry). Houses and storehouses need nobody. A free adult takes the nearest reachable building with a free place, most urgent first (building sites, then farms, then wood, then stone; farms before building sites while food is short). A job is kept while the worker is a living adult member, the building stands and still has work, and the worker is not stuck, so people do not keep switching. When nobody is free, at most one worker per step who has held a job for 200 ticks moves from the least urgent work to a more urgent one (e.g. a new building site). Extra adults rest. Carrying is not simulated: the yield goes to the settlement stock at the workplace.
- **Walking to work.** Workers walk with the creatures' own pathfinding (`Creatures.workGoal` → `planTo`/`followPath`, no new per-frame loop) and, within 2.5 tiles of the building, switch to the new **Working** state and stay. Hunger, thirst, danger, fire and mating still come first; they return afterwards. Buildings that the regions say cannot be reached are never given; a worker who gets no closer for 15 steps while trying gives the job up and does not take that building again for 600 ticks. A destroyed building, a death, leaving or emigration drops the job at once.
- **Production without double counting.** The old flat per-building production is gone; each building gives its former yield × (workers at work ÷ places): farm 1 × fertility × farming tech, lumber camp 1 wood × harvesting, quarry 0.7 stone × harvesting. A fully staffed building gives exactly what it gave before, so the technologies (+50% food, −25% cost / −30% time, +50% wood and stone), costs and stage conditions keep their meaning. Construction advances 0.5 step of work per builder at the site per step (3 builders: 1.5). Lumber camps fell no trees and quarries take no stone while that store is full. **Foraging and knowledge stay settlement-wide** (all people and their land), because they are not tied to a building.
- **Construction rules.** The cost is paid when work starts (as before), so a site never waits for material; it waits only for builders. A start is refused with the reason (resources, site, slots, two sites at a time). Auto-building still runs only when *Settlements build by themselves* is on.
- **Events.** New history lines (en / ru / zh-CN): a farm started or stopped working (stopped after 15 steps without work), a lumber camp or quarry has nothing left. A toast announces finished or destroyed buildings, food running out, a new stage, exhausted workplaces and stopped farms: at most one toast every 3 s, the newest with a count of the others; everything stays in the history.
- **Visible activity.** People at work get a tiny two-frame tool beside the head (axe, pick, hammer, shoot), drawn only for working people. The draw order of 0.14 is kept, so people stay on top of buildings and borders and remain tappable.
- **Cards.** The resident card shows what the person is doing (working in the field, cutting trees, breaking stone, building a …, going to work, resting) and the job with its building and tile. The settlement card shows workers (with a job / adults / at work now), the split by task, problems (no adults, workplaces without workers, no farm or lumber camp, exhausted workplace, barren field, full store) and, per building, how many work there and how many are on the way, or "waiting for builders".
- **Saves.** Still format **11**: jobs, skipped buildings and the per-building fields (`active`, `idle`, `empty`, `here`) are optional parts of the settlement `civ` block, validated on load (unknown buildings, duplicate workers and non-members are dropped). Older saves load and residents get jobs on the next step. A loaded world continues exactly like the original (tested).

Limits: no hauling between buildings and the store; no animation of the buildings themselves; the numbers of places per building are first guesses; the balance of worker-based production was checked only in the test scenarios.

## Housing evolution (v0.16.0)

Houses now grow with their settlement. A house keeps its id, tile and place in the list; only its `level` changes.

| Level | Look on the map | Holds | Opened by | Upgrade cost (wood / stone) | Work |
| --- | --- | --- | --- | --- | --- |
| 1 Hut | small thatched cone with a pennant | 5 | any camp (built as a normal house, 10 wood) | — | 6 steps |
| 2 Wooden house | log walls, roof in the settlement colour, lit window | 8 | village stage | 12 / 0 | 6 steps |
| 3 Reinforced house | stone ground floor, timber upper floor, taller | 12 | village + *Better building* | 12 / 12 | 8 steps |
| 4 Urban house | two-storey pale stone house with windows and a chimney, rises above its tile | 18 | town + *Better building* | 16 / 24 | 10 steps |

- *Better building* also gives −25% upgrade cost and −30% upgrade time, as for new buildings. Housing is 10 plus the sum of each finished house's level capacity (level 1 = the old 5 per house).
- **How an upgrade works.** The cost is paid once when it starts; the house is surrounded by scaffolding with a blue progress bar and builders from the 0.15 job system do the work (0.5 step per builder per step, up to 3 builders). An upgrade counts as one of the two constructions allowed at a time. Meanwhile the house keeps its people and its current capacity; when the work is done it becomes the next level in place. One level at a time; never above what the stage and technology allow.
- **Who decides.** With *Settlements build by themselves* on, a settlement upgrades one house at a time, lowest level and oldest first, only while housing is nearly full (people ≥ capacity − 2), with a farm and a lumber camp, no famine, at least 15 food (or one per person) and at least 10 wood left after paying. The settlement card has an **Upgrade house** button (same convention as Build: greyed with the reason when not possible).
- **Fire and floods** destroy houses of every level as before; the capacity disappears with the house, the builders' jobs are dropped on the next step and the paid cost is lost (as for a building site).
- **Card.** Houses by level, upgrades in progress, and what opens the next level; each house line shows its level and capacity or the upgrade progress.
- **Events.** "A house became a …" and "… has its first …" (a new housing tier) go to the history and the toast (one toast per 3 s with a count of the others).
- **Saves.** Still format **11**: `level` and `up` are optional building fields; houses from older saves load as level 1 huts with no upgrade; invalid levels or upgrades are cleaned up on load. Saving during an upgrade keeps the paid cost, progress and builders.

Limits: one house type for every people (the levels are a table, so another people could get its own later); advanced houses burn like huts; costs, capacities and the auto rule are first guesses checked in tests and one browser scenario, not tuned by long play. The project has no Latvian translation; the new texts exist in English, Russian and Simplified Chinese.

## Elves and race identity (v0.17.0)

Elves are a second people, added through the same species list as every creature (`SPECIES[6]`, key `elf`). They use the shared creature rules (needs, eating, drinking, fleeing, breeding, ageing, death), the shared groups, settling, settlement, economy, jobs and housing rules. Only data and look differ.

| | Humans | Elves |
| --- | --- | --- |
| Food | grass, forest, jungle, savanna, hills | forest, jungle, grass, savanna |
| Life | adult at 600 ticks, up to 3000 | adult at 700, up to 3800, but fewer children (cooldown 650, chance 0.015 vs 500 / 0.02) and a smaller share of the world (15% vs 20%) |
| Body | 50 health, speed 0.12 | 45 health, speed 0.13, sight 13 |
| Groups | up to 24 | up to 16 |
| Site score weights (food / liked land / trees / rock / free land) | 0.45 / 0.3 / 0.1 / 0.05 / 0.1 (unchanged) | 0.35 / 0.3 / 0.25 / 0 / 0.1 |
| Liked land | grass first | forest first, then jungle and grass |
| Distance to other settlements | 16 tiles | 20 tiles |
| Architecture | `human` | `elven` |

- **Real effect on choices.** The weights, the liked terrain and the distance are read by `assessSite`, which both groups and autonomous founding use. On a test map, a forest spot by a lake scores much higher than open grassland for elves, while for humans both score about the same; an elven group 18 tiles from another settlement is refused (too close), a human one is not. Raptors and tyrants hunt elves as they hunt humans, so elves flee and avoid predator land the same way.
- **Balance check (not a test).** Runs of 10 game years with 8 humans and 8 elves (scratch script, single seeds): on identical grassland both peoples end near each other (humans 25, elves 27); on a forest-and-grass map the people placed in the forest (with wood) grows larger whichever it is (elves in the forest 43 vs humans 26; swapped: humans 48 vs elves 33). On one generated map (seed 77) the elves reached 84 and the humans 41, with the humans placed on a poorer spot. Elf longevity and birth rate were lowered once after the first runs (3800 and 0.015, from 4200 and 0.016) because elves outgrew humans on equal land. Not tuned by long play.
- **Architecture.** House art lives in `src/render/architecture.ts` (no DOM): one style per `CivProfile.architecture`, each with four levels and far-away dot colours. Elven houses: 1 *Elven shelter* (a dome of leaves), 2 *Elven dwelling* (round wooden walls under a rounded leaf roof, green-lit window), 3 *Tree house* (a house on a platform in a tree under a wide canopy), 4 *Elven hall* (a tall pale-wood spire hall with leaf wings). Capacity, costs, upgrade rules, builders and saves are the shared 0.16 rules; the style comes from the settlement's species, so a building never needs its own race field and cannot render in the wrong style.
- **One people per settlement and group.** Groups, joining, founding and the found tool keep one species per settlement or group (the found tool takes the more numerous people at the spot). Humans and elves meeting each other follow the existing rules: no hostility, no trade or diplomacy.
- **Fix found on the way.** A person who joined or founded a settlement stayed listed in its group until the next group step (up to 30 ticks); a save in that window loaded slightly differently. Now the person leaves the group at once (`Groups.release`), and a group left with one member is dissolved at once, as the group step would.
- **UI.** The Elf spawn tool sits with the other creatures; cards, statistics and history name elves; the "Found settlement of a people" tool and the automatic-settlement setting now mention both peoples; elven house names in the settlement card.
- **Saves: format 12.** Nothing in the format changed (species ids and `statSpecies` already cover a new species); the bump only makes older builds refuse saves that may contain elves. Saves 1–11 load unchanged; houses keep their levels and upgrades.

Limits: elves have no buildings of their own besides houses (farms, lumber camps, quarries and storehouses look the same for both peoples); elves fell trees for wood like humans; no relations between peoples yet.

## Visual evolution, settlement layout and mobile UI (v0.18.0)

Reference: the official WorldBox site and its public screenshots were looked at for usability ideas only (square icon tiles, outlined sprites that stand out from the ground); no art or assets were taken. Everything below is original ALVOXIS work.

- **Buildings.** All art lives in `src/render/architecture.ts` (no DOM): houses per people and level, and one shared look for workplaces with the settlement colour as an accent. The renderer turns each look into a sprite once per zoom level, with a dark outline (readable on any ground) and a soft ground shadow, and then only copies it (`Renderer.buildingSprite`, cached; far away buildings stay single-colour dots).
  - Human houses: 1 low thatched hut with mud walls and a pennant, 2 log cottage with a stepped gabled roof and lit windows, 3 two-storey house on a stone ground floor with a timber frame and a chimney, 4 tall pale stone town house with three rows of windows, a dormer and two chimneys.
  - Elven houses: 1 dome of leaves on a wicker ring, 2 round wooden dwelling under a rounded leaf roof, 3 house on a platform in a tree under a wide canopy with a ladder, 4 tall pale-wood spire hall with leaf-roofed wings.
  - Workplaces: farm = fenced field with rows of crops and a scarecrow; lumber camp = log pile under a lean-to and an axe in a stump; quarry = stepped pit with cut blocks and a pick; storehouse = wide plank barn with a big door, a crate and a sack.
- **Layout** (`findSite`, only for new buildings; existing buildings never move). The centre tile and its neighbours stay open; houses form a loose ring around it that widens as there are more; a storehouse stands near the centre; fields lie further out on moist farmland (they may touch each other, not houses); lumber camps and quarries stand by their forest or rock. Buildings avoid touching side by side, and a fixed variation per tile and settlement (no random generator) keeps villages from looking identical. No roads are drawn: there is no road system.
- **Palette.** The two manual founding tools (*Found settlement*, *Found settlement of a people*) are removed; people found settlements by themselves (groups, site choice, founding and migration are unchanged, and *People found settlements by themselves* in Settings still switches it). Animal settlements can no longer be founded by hand; existing ones keep living. Tools are now one row of square icon tiles (46–48 px) that scrolls sideways; each tile has its name as accessible name and tooltip, and the chosen tool is marked by a border, a dot and `aria-pressed`, with its name and hint shown in a strip above the tiles.
- **Settlement card.** Compact by default: name with a stage tag, icon chips (people / housing, houses with upgrades under way, building sites, food, wood, stone; full names in tooltips), at most two urgent alerts (famine, fire on the land, pressure to leave, workplaces without workers), and the build and upgrade buttons as icon + price (name, purpose and the reason when unavailable in the tooltip and accessible name). **Details** (a native disclosure, opens and closes with a tap, remembered while moving between settlements) holds everything else: population, territory, age, status, stage and next stage, housing, houses by level, workers, resources with yearly rates, buildings, technologies with Research buttons, automation, history and the tile facts.
- Saves are unchanged (format 12): only drawing and placement of new buildings changed.

Limits: buildings are one tile wide (taller levels rise into the tile above); far zoom shows dots only; the layout rules were checked in tests and two browser scenarios, not on many generated worlds.

## Kingdoms and leaders (v0.19.0)

A light political layer above settlements (`src/sim/kingdoms.ts`). Nothing is created by the player and no random numbers are used.

- **Forming.** Every 240 ticks (half a game year) the simulation looks for *eligible* settlements: people's settlements with at least 8 inhabitants, at least 960 ticks (2 years) old, with little pressure to leave (stress ≤ 12) and not yet in a kingdom. A kingdom forms from the eligible settlement with the most eligible neighbours of the **same people** (centres within 48 tiles and connected by walkable land), together with those neighbours (at most 8). At most one kingdom forms per check and at most 6 exist. An existing kingdom takes in at most one more eligible neighbour per check (within 48 tiles of a member and 72 of its capital). A lone settlement stays independent; humans and elves never share a kingdom. Joining changes nothing in the settlement (ids, people, buildings, stock stay as they are), and a settlement only leaves a kingdom when it no longer exists, so there are no join/leave loops. No splitting, wars, alliances or diplomacy.
- **Rulers.** The ruler is a real creature: the oldest adult (not yet elderly) member of the capital; if the capital has none, of any member settlement; if there are only elders, the oldest elder; ties go to the lower id. A ruler who dies is removed at once (the kingdom shows *succession*, never a dead ruler); a ruler who is no longer a member of one of its settlements is replaced. Every settlement step (20 ticks) the kingdom drops settlements that no longer exist, picks a new capital (the most populous member) when needed, crowns a successor and dissolves when no settlement is left. The last 8 reigns are kept (from, to, died / left).
- **Names** are generated from the world seed and the kingdom id in the style of its people (e.g. *Ranrodheim* for humans, *Ithath* for elves); they never change.
- **Map.** Each kingdom has its own colour: a light tint over its land (off in the reduced quality setting), its outer border drawn a little bolder in its colour, faint lines between its own settlements, and *♛ name* above the capital. Independent settlements keep their own borders. The tint and the split borders are cached per kingdom and rebuilt only when territories or membership change.
- **UI.** A *♛ name* chip on the settlement card and a *Kingdom* line on a person's card (with *(ruler)* for the ruler) open the **kingdom card**: name and people, settlements, population, territory and age as icon chips, status (stable / succession), the ruler with sprite, stage and age and a *Select* button (the normal creature selection), the capital with an *Open* button; **Details** list the settlements, past rulers and the kingdom's recent history.
- **Events** (history, en / ru / zh-CN): kingdom founded, settlement joined, ruler took power, new ruler succeeded, capital moved, kingdom fell apart; founding, succession and dissolution also make a toast (one every 3 s, the newest with a count of the others).
- **Saves: format 13.** An optional `kingdoms` block (ids of settlements, capital and ruler, reigns and events). On load every reference is checked: unknown settlements, settlements of another people or already in another kingdom are dropped, a missing capital is chosen again, a ruler who is not a living member makes the kingdom wait for a successor; kingdoms with no valid settlement are dropped. Settlements and creatures are never changed by this. Saves 1–12 load with no kingdoms; they form later as the rules allow.

Limits: no splitting, wars, diplomacy, trade, taxes or royal families; the thresholds (8 people, 2 years, 48 tiles) are first guesses checked in tests and one browser scenario; a ruler who wanders beyond the settlement border is replaced like one who left.

## World evolution: terrain, trails, shipyards and livelier art (v0.20.0)

What is **implemented** (and tested), and what is only a **foundation**:

- **Terrain tab** (new, icon tab between Biomes and Powers): *Raise* (mountains), *Lower* (dig), *Deepen water* (new) and *Smooth*, moved out of Powers so nothing is duplicated. Raise, Lower and Deepen use the power control (●○○ … ●●●: 3, 6 or 10 height steps at the centre of a stroke); the size bar sets the radius; dragging applies the brush repeatedly and every stroke can be undone. *Implemented.*
  - The elevation model is the world's own height map (0..255, sea level 110) that already drives terrain, slopes, passability, water and saves; nothing is a drawn-only overlay. Heights are now limited to 8..250 (`HEIGHT_LIMITS`), strokes fall off with the square of the distance and slow down near the limits, so repeated strokes build tapered peaks and sloping pits. Mountains (and cliffs) remain impassable for people and lowland animals; pathfinding and regions route around them (tested). High snow now carries snow-capped peaks instead of a flat white field.
  - *Deepen water* lowers water tiles only (land is untouched); shallow sea becomes deep sea, a lake or river pushed below sea level becomes sea. Depth is the real height below sea level and is coloured continuously as before.
  - A creature whose ground became impassable still walks off within 4 tiles; if a whole mountain was raised around it, it is now carried to the nearest usable tile within 24 tiles (deterministic, never killed). Before, it stayed stuck forever.
  - Only the chunks a stroke touched are repainted (tested).
- **Trails.** People of a settlement wear the land they cross while going somewhere (to work, food, water, a mate, travelling) and where they work; aimless wandering does not count. Wear fades slowly; tiles past a threshold show as a trail and, much used, as a worn path, drawn from cached 64×64-tile blocks with soft edges. Saved (sparse). *Implemented as trails only*: they are drawing, do not speed anyone up, cost nothing and have no bridges. **Built roads (paid with stone and work), bridges and faster movement on roads are the next step.**
- **Shipyard** (new building, both peoples): only on a shore tile beside open sea (not a lake or river) with at least 10 sea tiles within 3; 24 wood, 6 stone, 9 steps, built by builders like any building; towns with a storehouse build one by themselves where a coast exists. Art: a dock on posts, a hull with ribs on its slipway, a crane and a mooring post. *Foundation only: no ships are built and nobody sails.* Site scoring gives coasts a small bonus (humans 0.04, elves 0.02 of the score).
- **Creatures.** All seven species have new outlined two-frame sprites (`render/creatureart.ts`); walking creatures alternate frames (fleeing ones faster), standing, eating or working ones hold still; land creatures cast a small ground shadow. **Humans vs elves:** humans are compact with short dark hair, a blue tunic, belt and boots; elves are a pixel taller and slimmer, with long ears swept back, long pale hair down the back, a green cloak narrowing to the knees and a bow on the back.
- **Buildings and effects** (drawing only, off in reduced quality): chimney smoke from human houses (levels 3–4), a slow warm glow in elven windows (levels 2–4), soot over buildings with fire on or beside their tile, shingle rows on human roofs.
- **Ground detail:** sparse flowers on grass, stones on hills, pebbles on sand and desert.
- **Saves: format 14** — optional settlement `wear` (trails) and the shipyard type; heights and water depth were already saved. Saves 1–13 load unchanged (no trails).

Not done in this milestone (honest list): swaying trees, wet ground after rain, day/night lighting, separate damage sprites, built roads, bridges, ships and sailing, new art for every non-house building per people, terrain texture redraws beyond the details above. Physical-phone performance was not measured.

## Visual evolution: close-up terrain, water, mountains and vegetation (v0.21.0)

Drawing only; the simulation, tools and save format (14) are unchanged.

- **Close-up level.** At close zoom (18 or more device pixels per tile, not in low-resolution mode) the ground is painted at 16 px per tile from native art (`render/groundart.ts`) with four variants per terrain: grass blades and clover, leaf litter, twigs and moss on forest floor, ferns in jungle, dry blades and bare patches on savanna, sand ripples, dunes and pebbles, soil clods and cracks, swamp puddles, lichen on tundra, snow drifts with blue shadows, rock outcrops on hills, rock strata on mountains, wave crests and river streaks. Each variant keeps its terrain's average colour, so zooming between levels does not jump. Normal and far zoom keep the 8 px, 4 px and 1 px levels.
- **Water and coasts:** a darker wet band on land beside open water, on top of the existing depth colouring and foam.
- **Mountains and snow:** strata contour lines on high hills and mountains, a ragged snow line on mountains above height 214, snow fields toned down so lit slopes no longer clip to a flat white slab; raised terrain shades as tapered slopes.
- **Lighting and depth:** ridges cast a soft shadow towards the south-east on lower ground.
- **Vegetation:** birches among forest edges and interiors, fallen logs and mushrooms in forest gaps; trees and pines have their own 16-px sprites up close.
- **Performance:** a 16-px chunk is painted in four bands of eight rows, one band per turn within the existing 6 ms paint budget, while the 8-px chunk (if cached) stands in; at most four chunks are in progress at once and an edit restarts an unfinished one. Only chunks a change touches are repainted. See `docs/PERFORMANCE.md`.

Not done: animated water or swaying trees, day/night light, roads, bridges, ships and sailing. Not measured on a physical phone.

## Settlement landmarks (v0.22.0)

Drawing and tapping only; settlements, buildings, the simulation and the save format (14) are unchanged.

- **Main building at every settlement centre**, replacing the diamond marker (`render/landmarks.ts`). It is not a building record: no housing, no production, no save data. Its look comes from the settlement's people and stage, so it changes in place when a camp becomes a village or a town (nothing is created, reset or duplicated). It stands in the 3×3 centre that the layout always keeps free of houses.
  - Humans: *camp* a large hide tent on crossed poles with a hearth, log seats and a banner; *village* a long timber-framed hall with a hipped roof, a front gable over a double door, porch, lit windows and a hearth; *town* a stone town hall with wings, an arched entrance, banners and a clock tower with a pointed roof.
  - Elves (own shapes, not a recolour): *camp* two living trees whose boughs form an arched leaf roof over an open hall with hanging pennants and moss stones; *village* a rounded pale-wood hall held by branches under a crescent roof of long leaves, with a tree growing through it; *town* a terraced white-wood civic hall with curved leaf-roofed wings and a slender spire of stacked leaf tiers.
  - Same outline, shadow and light direction as the other buildings; cached per look and zoom. From zoom 3 up it stays inside the settlement's free centre: it may be drawn larger (up to 6 CSS px per tile) only while its sides and base stay half a tile short of the nearest building, so it never covers a neighbouring house. Far away (zoom below 3, creatures as dots) it becomes an icon drawn over the dots; the settlement's buildings under the icon are drawn again on top of it, and up to three of its residents standing on it (the existing creatures, at their own positions) are drawn over it. Close up and not in reduced quality, the hearth of a human camp or village flickers.
  - Fire on the centre: on the landmark's ground row it is drawn in front of the walls; behind the walls it shows as firelight on the building and smoke over its roof (never flames through walls); far away it is drawn over the icon as a marker.
- **Tapping:** a tap on the landmark's visible shape (its drawn rectangles, at the drawn scale) opens the settlement card, also on parts above the territory. A creature right under the finger (within 0.6 tile) is still selected first at normal and close zoom; far away only the residents drawn over the icon can be picked there. Away from landmarks the usual creature radius applies. When settlement borders are hidden, landmarks are neither drawn nor tapped.
- The settlement name (and the kingdom name of a capital) sits above the landmark.

Not done: roads, bridges, ships, day/night light. Not tested on a physical phone.

## World simulation and visual evolution (v0.23.0)

Save format 15 (versions 1–14 still load; new data start empty).

- **Proportions (drawing only):** buildings are drawn about twice as large (2 tiles wide, standing on their tile); creatures about half as large (with a minimum size so they stay visible). The settlement layout keeps a free 5×5 centre and space between buildings for the larger drawings. New tree art (tall and broad oaks, palms, tall pines) at a moderate forest density.
- **Clearing and felling:** a new settlement first clears the trees in its centre, and a building site among trees is cleared before construction starts ("clearing" in the card). Lumberjacks walk to a real tree, fell it and carry the wood: the tile turns to grass, a stump stays and rots after about two years, and the forest can grow back. Wood is credited once per felled tree (10 per tree, by forest kind). Trees never grow on built ground or roads.
- **Roads:** each settlement lays roads a few tiles at a time from every building door to its centre, around water, trees and buildings, joining the existing network. People walk 20% faster on roads. Human and elven roads look different.
- **Population:** humans and elves have children about three times less often (only the breeding cycle changed). 20-year runs over 5 seeds: 48 founders grew to 157–220 people (585–805 before); no settlement died out.
- **Life tab:** creatures are sorted into Land (peoples, herbivores, small animals, predators, dinosaurs) and Sea (fish, sea predators, sea mammals). New animals with their own diet and behaviour: deer, rabbit, wolf, bear (hunt deer and rabbits, never people), shark, orca (hunt fish and sharks), whale (feeds in deep water).
- **Swimming:** humans and elves can swim across shallow sea, rivers and lakes (slower, tiring), only when the land way is much longer; never through deep ocean; they do not wander into water and swim back to shore. Swimmers are drawn half in the water.

Limits: no domestic animals, birds or reptiles yet; sharks do not attack swimmers; sea animals may also enter rivers and lakes; wolves do not hunt as a pack; the main building is drawn 1.33–1.5× (not 2×) so it fits the free centre; settlements from older saves keep their old building spacing. Not tested on a physical phone.
