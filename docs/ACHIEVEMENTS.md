# Achievements and rewards: preparatory analysis

Status: **analysis only. Nothing in this document is implemented.** There is no balance of Alvoxis Energy, no income, no spending and no achievement tracking in the game. Alvoxis Energy (a future in-game resource earned by developing the world and spent on extra abilities) needs a separate agreement before any code is written.

## What the game already tracks (usable as achievement inputs)

| Data | Where | Saved? |
| --- | --- | --- |
| World age in ticks (years/days derive from it) | `Simulation.tick` | yes |
| Births and deaths, per species births, per species and cause deaths | `Creatures.births/deaths/birthStats/deathsBy` | yes |
| Creatures alive per species | `Creatures.countSpecies` | derived |
| Species that have ever appeared / gone extinct | `Simulation.seenSpecies`, history entries `first` / `extinct` | history yes (last 200), `seenSpecies` no |
| Meteors landed, lightning strikes, earthquakes, wildfires | `Sky.stats` | **no** (session only) |
| Fires burning, weather systems active | `Fire`, `Weather` | yes (state), counters no |
| Terrain shares (land, forest, ...) | `World.terrainCounts()` | derived |
| Player-caused vs natural events | `MeteorInFlight.natural`, tools | not recorded |

Gaps: counters that must outlive a session (sky stats, lifetime totals, "first time" flags) are not stored; history is capped at 200 lines; nothing separates the player's actions from natural events except meteors.

## Proposed shape (for later agreement)

1. **Event stream, not polling.** Simulation and tools emit small typed events (`creature_born`, `species_extinct`, `meteor_landed {natural}`, `tool_used {id}`, `world_year {n}`). A pure `AchievementTracker` consumes them. This keeps rules out of the simulation and testable without a browser.
2. **Per-world progress**, stored in the save as an optional block (like `sky`), so old saves load with empty progress. Cross-world totals would live in `localStorage` or a later account service.
3. **Definitions as data** (`id`, trigger, threshold, reward id) with names and descriptions in the three dictionaries (the i18n parity test already forces translations).
4. **Rewards**: start with cosmetic ones (ring colours, banners), which the promo prototype already demonstrates. Gameplay-affecting rewards must not change simulation rules silently.
5. **Anti-patterns to avoid**: rewards for time spent with the game open (pausing and speed make that meaningless), rewards that require destroying species (the game never auto-removes species, and incentives should not push the player to), and anything that makes the local test promo list look secure.

## Candidate achievements (examples, not commitments)

- First life: spawn any creature; first of each species.
- A thriving world: 500 animals alive at once; 1,000.
- Balance: herbivores and predators both above 20 for 10 game years.
- Old world: survive 10 / 50 / 100 game years.
- Weather watcher: see rain, snow, a thunderstorm and a drought in one world.
- Impact: a meteor shower of 48 meteors; a crater lake created.
- Rescue: animals escape a flood (needs a counter).

## Alvoxis Energy: questions to settle before building

- What exactly earns it (world age, population, diversity, achievements)? How to stop idle farming at 20× speed?
- What is spent on? If on abilities, which rules does an ability change, and can a player be locked out of existing tools (should not)?
- Is the balance per world, per device or per account? A server is needed for anything claimed to be secure or cross-device.
- Offline play and save editing: the save format is plain JSON, so any balance stored in a save can be edited. Is that acceptable for a single-player sandbox?
- Real-money purchases are out of scope and must stay separate from this resource.

## Suggested first implementation step (when approved)

Add the typed event stream and the tracker with three achievements and cosmetic rewards, a save block `achievements?`, and tests; no energy balance.
