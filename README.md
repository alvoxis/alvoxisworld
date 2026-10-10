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

- More species (beyond the five above), herds and migration, nests and eggs, sexes and genetics.
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

- **Found one:** Life tab → *Found settlement*, then tap the ground. It needs at least 6 living animals of one land species, not yet in a settlement, within 8 tiles of the spot; open dry land (not water, mountain or snow); land not already claimed; and, for grazing species, at least 20% of the land within 6 tiles that they can eat. Up to 12 settlements. The toast says why a try was refused. Founding is not undoable.
- **Identity:** a unique id, a name made from the world seed and the id (no random numbers), and its own colour.
- **Population:** the members are real creatures (by id). Births to a member join at once, deaths and removals leave at once, creatures of the species that live inside the territory join (checked every 20 ticks), members that wander more than 4 tiles beyond the border leave (moving away). The count is always the number of living members.
- **Territory:** the land tiles within a radius of the centre (6–18, growing with the population as `5 + 1.4·√n`) that the species can stand on, connected to the centre; water, rivers and lakes cut it off. Earlier settlements keep contested tiles. It is rebuilt only when something changes (founding, growth, disappearance, terrain edits such as floods, craters or snow), never every frame.
- **Changes over time:** status founding / growing / stable / declining / fading (sampled every 100 ticks from the real population), milestone events at 10, 25, 50, 100, 200 and 400 animals, and **disappearance**: abandoned when no animals are left, dissolved when fewer than 2 remain for 300 ticks.
- **Borders:** coloured outlines of the real territory, a marker at the centre and (zoomed in) the name and population. Switch them in ⚙ Settings → Graphics & Performance → *Show settlement borders*. The outline comes from precomputed edge lists; each frame only the segments in view are stroked.
- **Card:** use Inspect (or Select) on a tile inside a territory. It shows the name, population, composition by life stage, territory (tiles, radius), age, status, counts (born, died, joined, left, peak) and the last events, and follows the simulation live.
- **Saving:** save format **8** adds an optional `settlements` block (members, stats, events). Territory is not saved; it is rebuilt from the land on load. Saves 1–7 load unchanged (no settlements). Invalid saved data is ignored.

Not included yet: people or other races, buildings, resources, research, diplomacy, wars, rulers, automatic founding, relocation of whole settlements, merging settlements.
