# Performance (Milestone 4)

All numbers below come from repeatable runs. Re-run them yourself and compare on the same machine:

```sh
npm run bench            # all scenarios
npm run bench -- capped  # one scenario: mixed | capped | long
```

The benchmarks run in Node 22, single-threaded, in this repository's cloud container. Node has no Web Worker here, so navigation rebuilds run on the main thread in these numbers: the worst case. Browser numbers were measured in headless desktop Chromium (Playwright) against the production build. **Nothing has been measured on a physical iPhone.**

## Simulation benchmarks (Node, medians of 3 runs)

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

## Browser measurements (headless Chromium, production build)

| Measurement | Main thread | Web Worker |
|---|---|---|
| Generate a Large (1024×640) world: longest frozen frame | 850–917 ms (2 runs) | **67–83 ms** (2 runs) |
| Navigation rebuilds during play with weather | about 37 ms (medium) / about 275 ms (large, in Chromium) per rebuild on the main thread | Medium: 6 of 6 rebuilds served by the worker. Large at 10×: 9 of 9 after scaling the delivery delay with map size (it was 5 of 9 with a fixed 20-tick delay, the rest falling back to the main thread). 0 errors. |
| 5,476 animals, 4 weather systems, 10× speed | n/a | 60 fps, p95 frame 16.7 ms, worst 33 ms, 100 ticks/s |

## Web Worker investigation

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

- The creature tick itself (about 0.5 µs per animal per tick in Node) still runs on the main thread. At 10× with about 5,500 animals that's an *estimated* 25–30% of a 60 fps frame, derived from the Node per-tick cost rather than measured in the browser. Phones will be slower.
- Navigation rebuilds still cost main-thread time when workers are unavailable (Node, or older browsers without module workers).
