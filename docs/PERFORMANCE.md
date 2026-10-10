# Performance

All numbers below come from repeatable runs. Re-run them yourself and compare on the same machine.

The benchmarks run in Node 22, single-threaded, in this repository's cloud container. Node has no Web Worker here, so navigation rebuilds run on the main thread in these numbers: the worst case. Browser numbers were measured in headless desktop Chromium (Playwright) against the production build. **Nothing has been measured on a physical iPhone.**

Commands:

```sh
npm run bench                 # simulation scenarios: mixed | capped | long | undo
npm run bench:sizes           # every world size: generation, memory, tick cost, save size (or e.g. `-- giant`)
```

## Milestone 5 measurements

Conditions:
- **Node:** Node 22.22, single thread, this repository's cloud container (shared CPU, so expect ±10–30% between runs). Since Milestone 5 the scripts run under vite-node 6 (Vite 8).
- **Browser:** headless Chromium (Playwright) with iPhone 13 emulation (390×664 CSS px, device pixel ratio 3, capped to 2 by the game), production build served by `vite preview`, software rendering (no GPU).
- Frame cost is the CPU time spent inside each animation frame (simulation and drawing), recorded by `Game.frameStats` over 2.5–3 s windows.
- **Nothing in this section was measured on a physical iPhone.**

### World sizes (`npm run bench:sizes`, seed 12345)

Population: herds of 8 grazers, plus 2 raptors with every third herd, one herd per about 6,000 grassland/savanna tiles. Weather on. Ticks measured after 200 warm-up ticks.

| Size | Tiles | Generate | World layers | Whole simulation (incl. navigation) | First tick (builds navigation) | Tick avg / p95 | Save file (gzip) | 1 px map + image |
|---|---|---|---|---|---|---|---|---|
| Small 256×160 | 0.04 M | 99 ms | 0.4 MB | 2.8 MB | 60 ms | 0.22 / 0.44 ms (82 animals) | 0.2 MB, 35 ms | ≈0.3 MB |
| Medium 512×320 | 0.16 M | 261 ms | 1.4 MB | 6.3 MB | 94 ms | 0.83 / 0.62 ms (90) | 0.6 MB, 104 ms | ≈1.3 MB |
| Large 1024×640 | 0.66 M | 955 ms | 5.6 MB | 20.9 MB | 228 ms | 1.74 / 1.94 ms (305) | 2.1 MB, 407 ms | ≈5.0 MB |
| Huge 1536×960 | 1.47 M | 1,948 ms | 12.7 MB | 45.0 MB | 423 ms | 3.77 / 4.18 ms (765) | 4.5 MB, 939 ms | ≈11.3 MB |
| Giant 2048×1280 | 2.62 M | 3,452 ms | 22.5 MB | 78.8 MB | 718 ms | 7.18 / 9.60 ms (1,285) | 8.1 MB, 2,068 ms | ≈20.0 MB |

- "Whole simulation" is the exact total of distinct typed-array buffers reachable from the `Simulation` object (world, creatures at their fixed 6,000-slot capacity, pathfinding, water map, region graph, food map), with no navigation rebuild in flight. A rebuild in flight briefly adds a terrain snapshot plus a second water map and region graph.
- **Memory reduction for big maps.** Before this milestone's changes the Giant figure was **108.9 MB**. Pathfinder search state went from 32 to 9 bytes per tile (40.3 → 22.8 MB on Giant), and region labels from 4 to 2 bytes per tile per movement class. The browser additionally holds the 1 px map canvas and its `ImageData` (8 bytes per tile, last column) and the painted-chunk caches (at most 80 × 256 KB + 160 × 64 KB ≈ 30 MB, independent of map size).
- Tick cost grows with map area mainly through weather and vegetation sampling and the larger populations.
- **Default size.** Medium stays the default: it generates in about 0.26 s here and keeps the whole simulation under 7 MB. Phones are slower than this container, and the first world is generated before the page is interactive. Large and above are offered with a note in the menu (memory estimate, slower on phones).

### Browser frame cost by size and zoom (60 animals spawned, 5×)

| Size | Generate via menu (worker, includes UI) | Fit zoom | Zoom 4 | Zoom 16 |
|---|---|---|---|---|
| Medium | 405 ms | avg 0.3, p95 0.6 ms | avg 0.9, p95 7.0 ms | avg 0.7, p95 1.5 ms |
| Large | 980 ms | — | — | — |
| Giant | 3,737 ms | avg 2.2, p95 7.1 ms | avg 2.3, p95 8.3 ms | avg 2.5, p95 9.2 ms |

Worst single frames were 33 ms (Medium) and 74 ms (Giant): chunk repaints after weather changes plus simulation ticks. In every size, a tap at 25%/50% of the minimap centred the camera at 25%/50% of the world.

### Map painting

| | 8 px per tile (256×256) | 4 px per tile (128×128) |
|---|---|---|
| Node, warm, all 160 chunks of a Medium map | 5.7 ms per chunk | 2.1 ms per chunk |
| Chromium, average over a session (mixed levels) | about 4 ms | 1.35 ms |

At most 6 ms of painting happens per frame (at least one chunk), centre first. Stale chunks stay visible until repainted, so painting never blanks the screen.

### Speed and population (Medium, zoom 4)

| Animals | 1× | 5× | 10× | 20× |
|---|---|---|---|---|
| 425 → 1,901 (grows while measuring) | 10 ticks/s, avg 0.7 / p95 1.7 ms | 50 ticks/s, 1.0 / 2.2 ms | — | 201 ticks/s, 4.9 / 12.6 ms |
| 3,596 → 5,995 | 10 ticks/s, 1.1 / 2.7 ms | — | 100 ticks/s, 9.0 / 20.9 ms | 201 ticks/s, 13.7 / 33.3 ms |
| Large map, 5,200 → 6,000 | 10 ticks/s, 0.7 / 3.4 ms | — | 100 ticks/s, 7.1 / 12.4 ms | 200 ticks/s, 13.3 / 28.0 ms |

The simulation always kept up with the requested speed (100 or 200 ticks per second). At 20× with about 6,000 animals, p95 frames of 28–33 ms mean roughly 30–35 fps in this container.

### Minimap

On a Giant map, scaling the 1 px map to the minimap with `imageSmoothingQuality = 'high'` costs a median **2 ms** (10 runs). It is done at most once per second; other frames copy the cached image. A step-down mip chain tried first cost 18 ms and was dropped.

### Undo history (`npm run bench -- undo`, Giant map)

40 strokes of 20 dabs each at brush radius 24, plus a meteor: 40 actions kept (the oldest dropped), 286,760 tiles ≈ 5.5 MB. Undoing all 40 took 74–81 ms and redoing all 40 55–62 ms, a few milliseconds per step. The cap of 400,000 tiles bounds history at about 8 MB.

### Simulation benchmarks compared with Milestone 4

| Scenario | Milestone 4 commit, same machine and session | Milestone 5 |
|---|---|---|
| Capped herbivores (5,163 animals) | 3.03–3.34 ms avg (median 3.05) | 3.21–3.43 ms (median 3.30) |
| Long routes, 40 pairs on 1024×640 | 6.9–9.5 ms per route (Vite 8 toolchain) | 6.5–8.4 ms per route |

- The capped scenario may be up to about 8% slower, within this container's run-to-run spread. The likely cost is the per-creature effect check.
- Long-route times rose from 4.9 ms (measured earlier the same day) after the toolchain upgrade. The Milestone 4 code measured the same way is just as slow, so that is the toolchain or machine, not this milestone's code.
- Large maps now generate differently, so expansions per route changed (1,426 → 1,540).

## Milestone 5b: sky and disasters

Same conditions as above (headless Chromium with iPhone 13 emulation, production build; Node 22 for the simulation benchmarks). **Not measured on a physical iPhone.**

### Browser frame cost (60–100 herds spawned, 5×, zoom 4 unless noted)

| Scene | Medium 512×320 | Giant 2048×1280 |
|---|---|---|
| Clear sky, decorative clouds off | avg 1.00 ms, p95 5.2 | avg 2.51, p95 8.2 |
| Decorative clouds on | avg 0.59, p95 1.2 | avg 2.45, p95 7.8 |
| Worst case in view: 3 storms + 1 snowfall (each 24 tiles wide), 10 meteors in flight, a fire (10-tile radius), constant lightning | avg 2.32, p95 8.2, max 24.7 | avg 4.76, p95 13.1, max 77.9 |
| Same scene at zoom 12 | avg 1.19, p95 3.9 | avg 4.54, p95 13.1 |
| Same scene, whole world in view | avg 1.17, p95 2.1 | avg 5.07, p95 13.4 |

(The first two rows differ by noise rather than by the clouds themselves: clouds are about 10–25 `drawImage` calls per frame. The first row also includes the chunk repaints after the world was generated.) Frame cost is CPU time inside the frame, as in the Milestone 5 tables.

### Simulation benchmarks

| Scenario | Before (`1a6efd4`) | Now |
|---|---|---|
| Mixed ecosystem, weather on, seeds 4 / 11 (6th year) | 2.46 / 2.13 ms per tick | 2.35 / 2.06 |
| Capped herbivores (5,163 animals; interleaved runs, 3 each) | 3.00–3.01 ms (p95 4.9–5.3) | 3.87–4.03 (p95 6.3–6.7) |

The capped scenario got slower on this seed, and that is down to weather luck rather than per-creature cost. With storms disabled it was just as slow (3.87–3.98 ms), the old `creatures.ts` with the new weather was just as slow (3.8–4.0), and the old `weather.ts` and `fire.ts` brought it back to 3.2. The new weather caused 9 navigation rebuilds in the first 700 ticks of that scenario (about 38 ms each on the main thread in Node) against none before. Across six world seeds over 2,400 ticks, rebuild requests went from 32.7 to 36.0 on average (the limit is 40, one per 60 ticks), i.e. weather already asked for rebuilds almost constantly, and snow cover on tundra adds a few more. In the browser those rebuilds run in the navigation worker.

### Behaviour diagnostics (`npx vite-node scripts/behavior.ts 4,11,21 4`)

Four years of the mixed ecosystem on three seeds, sampling every 50 ticks: no animal stood still for 500+ ticks except one grazer in one run, and a single sample in one run showed an animal on terrain its species cannot enter (most likely mid-escape from a flood; not investigated further). Drownings and strandings, which used to appear (1–2 per run), no longer do. Grazer deaths by thirst varied between 15 and 38 per run depending on the weather the random generator produced, so differences of that size between runs are noise.

## Technical Improvement Milestone

Same conditions as above: headless Chromium with iPhone 13 *emulation*, production build, `scene.mjs` scenes run back to back on a baseline build (commit 7b66fe9) and this one. **Not measured on a physical iPhone.** Scenes are reproducible but not identical in population: animals breed, so the same scene holds different counts in each build (noted below).

### Causes of the rare long frames (found by wrapping each frame stage)

| Cause | Cost seen | Fix |
| --- | --- | --- |
| Season change dirtied every chunk and the 1 px map; all repainted in one frame | 53–80 ms | budgeted flush (4 ms/frame), visible chunks first |
| FoodMap full recount | 19–31 ms per 50 ticks on Giant | recount a few bands per tick |
| Weather climate relaxation (random sampling over the whole map) | ~8 ms per step on Giant | contiguous window with a cursor |
| Catch-up at 20× (33–40 ticks in one frame) | 130–270 ms | 12 ms simulation budget per frame; speed label shows the achieved speed |

### Before / after (ms per frame, 20× unless noted)

| Scene | Build | avg | p95 | p99 | max | frames > 33 ms | ticks/s |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Giant 2048×1280, 1616 animals, weather, panning | before | 125.5 | 292.9 | 326.4 | 326.4 | 75 of 98 | 169 |
| | after | 15.7 | 23.5 | 26.0 | 30.3 | 0 of 400 | 171 |
| Medium 512×320, weather (before ~2,770 animals, after ~4,650) | before | 27.7 | 86.1 | 152.9 | 244.6 | 86 of 362 | 200 |
| | after | 16.6 | 21.9 | 24.5 | 26.8 | 0 of 564 | 163 |
| Edit: raise brush r=11 every frame, 5× | before | 6.1 | 10.5 | 12.5 | 13.1 | 0 | 50 |
| | after | 6.8 | 10.4 | 11.9 | 12.5 | 0 | 50 |
| Sky: 4 weather systems, repeated 16-meteor showers, fire, 5× | before | 3.9 | 8.8 | 11.9 | 32.7 | 0 | 50 |
| | after | 4.3 | 8.2 | 11.6 | 14.1 | 0 | 50 |

At 20× both builds are CPU-bound; the new build keeps frames short by running fewer ticks per frame rather than skipping frames, so achieved speed is nearly equal on Giant and lower on Medium only because the after scene has 68% more animals. Editing and sky scenes are within noise except the worst frame (32.7 → 14.1 ms, the old repaint spike).

### Slope passability cost
Natural worlds lose little walkable land: cliffs are 0.2–0.4% of land on medium maps; LAND connectivity is essentially unchanged; the largest LOWLAND region on seed 4 shrinks from 35.5k to 29.4k tiles. `scripts/behavior.ts` on seeds 4, 11 and 21 over 4 years stays healthy. Slope refresh is local to a changed tile and its neighbours.

### Not changed
The simulation stays on the main thread; the Web Worker analysis above still holds (navigation and generation already run in workers).

## Interface and Settings milestone

Same method as the previous milestone (headless Chromium, iPhone 13 emulation, `scene.mjs` scenes, production build). **Not measured on a physical iPhone.**

| Scene (20× unless noted) | Technical milestone build | This build | This build, performance mode |
| --- | --- | --- | --- |
| Giant, 1616 animals, panning: avg / p99 / max ms | 15.7 / 26.0 / 30.3 | 16.1 / 28.0 / 30.4 | 15.6 / 25.2 / 26.2 |
| Medium, ~4650 animals: avg / p99 / max ms | 16.6 / 24.5 / 26.8 | 16.5 / 24.8 / 26.7 | not run |
| Edit brush r=11, 5×: avg / max ms | 6.8 / 12.5 | 6.2 / 11.9 | not run |
| Sky, showers + fire, 5×: avg / max ms | 4.3 / 14.1 | 3.9 / 17.9 | 4.0 / 17.0 |

The localisation and Settings code adds no per-frame work (strings are built on change, the status line was already rebuilt four times a second). Performance mode in this software-rendered headless browser changes little (the canvas is 390 px instead of 780 px wide, frame cost within noise); its intended benefit is on devices with a high pixel density and a GPU, which has not been measured here. The simulation is identical in every mode.

## Human settlements (0.10–0.13)

`npm run bench:civ` (Node, 512×320, seed 77, 2,400 ticks after a 600-tick warm-up, medians of 3): the same ~12 groups of people cost **0.48 ms/tick** without settlements and **0.57 ms/tick** with 12 developing settlements (~420 members, ~100 buildings). The settlement step runs once per 20 ticks and costs about 2.3 ms when it runs (0.11 ms averaged over ticks), well inside the 12 ms simulation budget. Drawing buildings strokes only those in view. Browser frame cost with settlements and phone behaviour were **not measured**; no physical iPhone was used.

## Autonomous living world (0.14)

`npm run bench:civ` (Node, 512×320, seed 77, 2,400 ticks after a 600-tick warm-up, medians of 3, about 12 groups of 12 people at the start): **0.43 ms/tick** with group handling switched off, **0.56 ms/tick** with groups and autonomous settling (people then found settlements, breed to the housing limit and build, ~180 members, ~40 buildings), **0.55 ms/tick** with 12 developing settlements (~440 members, ~110 buildings). The group step runs once per 30 ticks. The difference mixes the group code with the larger population and the settlement economy that autonomous founding causes, so the cost of the groups alone was not isolated. Drawing: settlement borders and buildings are still drawn only for what is in view; creatures now have a minimum size (no extra cost per creature). Browser frame cost and phones were **not measured**; no physical iPhone was used.

## Earlier milestones

### Milestone 4: simulation benchmarks (Node, medians of 3 runs)

| Scenario | Before (Milestone 3) | After (Milestone 4) |
|---|---|---|
| **Capped herbivores**: 5,160 animals, grazers and fish pinned at their population caps, medium map | 5.94 ms/tick avg, 13.15 ms p95 | **2.83 ms avg, 4.39 ms p95** |
| **Long routes**: 40 reachable pairs ≥150 tiles apart, 1024×640 map, hadrosaur rules | **1 / 40 found**, 5,904 tile expansions each | **40 / 40 found**, 1,426 expansions, 4.9 ms each |
| Mixed ecosystem, seed 4, year 6, weather off (same scenario as the baseline) | 1.54 ms (3,321 animals) | 1.58 ms (3,232 animals) |
| Mixed ecosystem, seed 11, year 6, weather off | 1.17 ms (2,328 animals) | 1.29 ms (2,633 animals) |
| Mixed ecosystem, seed 4 / 11, weather **on** (new feature; navigation rebuilds on the main thread) | n/a | 2.46 / 2.13 ms |

Without weather, cost per animal is unchanged; the small differences are run-to-run noise (±0.15 ms between identical runs). With weather on in Node, the extra cost is mostly navigation rebuilds (about 37 ms each, after weather changes terrain, at most every 60 ticks). In the browser those run in a worker (below).

### What changed and why (each change was profiled first)

- **Capped herbivores.** Profiling showed 43% of tick time in `seekFood`: overgrazed land made food searches fail after exploring their full limit, and every hungry animal retried every few ticks.
  - A coarse **food map** (food tiles per 8×8 cell, per diet, rebuilt every 50 ticks in one pass) lets an animal skip searches that cannot succeed.
  - Hungry animals now **migrate** toward the nearest reachable food instead of retrying.
  - Failed searches back off (40 ticks).
- **Long routes.** Single A* searches were capped at 6,000 nodes, so long detours failed.
  - A **region graph** (16×16-tile cells split into connected regions, per movement class) answers reachability instantly.
  - It gives waypoints, so any route is walked as A* legs of about 24 tiles.
- **Navigation rebuild cost.**
  - The water map now uses precomputed walkability and drink masks and index arithmetic instead of per-tile function calls. Medium map: 84 → about 17 ms (median); large: 366 → about 76 ms.
  - The region graph only scans cell borders for links: about 19 ms medium, about 77 ms large.
  - Rebuilds happen at most every 60 ticks.

### Milestone 4: browser measurements (headless Chromium, production build)

| Measurement | Main thread | Web Worker |
|---|---|---|
| Generate a Large (1024×640) world: longest frozen frame | 850–917 ms (2 runs) | **67–83 ms** (2 runs) |
| Navigation rebuilds during play with weather | about 37 ms (medium) / about 275 ms (large, in Chromium) per rebuild on the main thread | Medium: 6 of 6 rebuilds served by the worker. Large at 10×: 9 of 9 after scaling the delivery delay with map size (it was 5 of 9 with a fixed 20-tick delay, the rest falling back to the main thread). 0 errors. |
| 5,476 animals, 4 weather systems, 10× speed | n/a | 60 fps, p95 frame 16.7 ms, worst 33 ms, 100 ticks/s |

## Living settlements (0.15)

`npm run bench:civ` (same setup as 0.14, single runs before and after the change in this container): people only 0.43 → 0.47 ms/tick, groups with autonomous settling 0.57 → 0.64 ms/tick, 12 developing settlements 0.54 → 0.59 ms/tick (settlement step 0.085 → 0.12 ms/tick averaged; ~400 members, ~100 buildings). Job assignment runs once per settlement step and is linear in buildings × free adults; walking to work uses the existing path budget; the renderer adds a 3×3 tool mark only for people in the Working state. Single runs are noisy (about ±10%). Browser frame cost and phones were **not measured**; no physical iPhone was used.

## Housing evolution (0.16)

`npm run bench:civ`, single run: 0.47 / 0.55 / 0.59 ms/tick (people only / groups / 12 settlements), the same as 0.15 within noise. The upgrade check runs once per settlement step; house sprites are a few more rectangles per visible house. Browser frame cost and phones were **not measured**; no physical iPhone was used.

## Visual evolution (0.18)

Buildings are now copied from cached sprites (one `drawImage` per visible building instead of 10–40 `fillRect` calls); a sprite is built once per look, settlement colour and tile size (the cache is cleared above 400 entries, i.e. after many zoom changes). The settlement card refreshes chips only when their values change. `findSite` adds a 3×3 neighbour check per candidate tile, run only when a building is placed. No browser frame-time measurement was made for this milestone; no physical iPhone was used.

## Elves (0.17)

No new per-tick work: elves run through the same creature, group and settlement code. `npm run bench:civ` was not re-run for this milestone (it spawns humans only, so it would not exercise elves). Browser frame cost and phones were **not measured**; no physical iPhone was used.

## Web Worker investigation (Milestone 4, still current)

**What the simulation depends on.**
- The renderer reads the world's typed arrays and the creature arrays directly every frame, with no copying.
- Brush tools and undo change the world synchronously when touched.
- The selection panel reads creature state 4× per second.
- Pause and speed are read every frame.
- The simulation code itself is DOM-free.

**Option A: move the whole tick into a worker.** That would need either:
- Shared memory (`SharedArrayBuffer`). It requires cross-origin isolation headers, which GitHub Pages cannot send.
- Or message passing: about 150 KB of creature state plus dirty terrain per frame, with brushes and undo becoming asynchronous commands. That changes how every tool works and costs a frame of input latency.

It's possible, but a large rewrite that would collide with the planned UI milestone. **Not done in this milestone.**

**Option B (implemented): move self-contained heavy computations into workers, deterministically.**
- **World generation** (`src/world/gen.worker.ts`). Same deterministic generator; the result is transferred. If the worker fails, errors, times out (20 s) or doesn't exist, generation runs on the main thread with the same result.
- **Navigation rebuilds** (`src/sim/nav.worker.ts`: water map and region graph):
  - When passability changes, the simulation copies the terrain and sends it to the worker.
  - The result is installed a fixed number of ticks later, set only by map size: 20 to 150 ticks (about 33 on medium, 131 on large, so 1.3 s even at 10×). If the worker hasn't answered by then, crashed, or doesn't exist (tests, old browsers), the identical result is computed from the same snapshot on the main thread.
  - The simulation is therefore **deterministic regardless of worker timing**. A test runs the same world with and without a worker and compares positions tick for tick.
  - Saves include the snapshot behind the current navigation data, so a loaded world continues identically.

## Known limits

- **Sky drawing** is cheap but unbounded in one way: very large weather systems cover the whole screen, so rain or snow particles are capped (90 / 110) rather than scaled with area, and look sparse at high zoom. Everything is capped per frame.
- **Chunk painting** runs on the main thread. A single 8 px chunk costs a few milliseconds in desktop Chromium, so a fast zoom or a large weather change can cost a few frames while chunks catch up. It could move to a worker with OffscreenCanvas if phone measurements show stalls.
- **Giant maps** take about 3.5 s to generate here (in a worker, so the page stays responsive) and keep about 80 MB in the simulation plus 20 MB for the map image. Older iPhones may run out of memory; this is untested.
- The creature tick itself (about 0.5 µs per animal per tick in Node) still runs on the main thread. At 10× with about 5,500 animals that's an *estimated* 25–30% of a 60 fps frame, derived from the Node per-tick cost rather than measured in the browser. Phones will be slower.
- Navigation rebuilds still cost main-thread time when workers are unavailable (Node, or older browsers without module workers).
