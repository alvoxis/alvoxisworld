# Roadmap

Each milestone ends with something playable, plus tests for the new rules. Milestones 1–5 and 5b are done.

## ✅ Milestone 1: Living map foundation (done)
Seeded world generation with biomes and climate. Two-level pixel-art renderer. Touch and mouse camera. Terrain, biome and life brushes. Seasons and time controls. Vegetation succession. Grazer/raptor food chain. IndexedDB save slots. Stats and history. CI and GitHub Pages deploy.

## ✅ Milestone 2: Living world (done)
Creature model with IDs, health, hunger, thirst, life stages and behaviour states. Five species (grazer, hadrosaur, fish, raptor, tyrant) with habitat rules. Food and water seeking, hunting, fleeing, damage and death causes. Mate-seeking reproduction with carrying capacity. Select, inspect, follow and remove creatures. Smooth movement between ticks. Save format v2 with v1 migration. Deterministic, tested simulation.

## ✅ Milestone 3: Rivers, lakes and pathfinding (done)
Priority-flood hydrology (rivers that drain to the sea or lakes, fordable by land animals; lakes in closed basins) and River/Lake brushes. A* and nearest-reachable searches with per-tick budgets. A shared water-distance map. Path following that re-validates each step after terrain edits. Prowling predators, catchable-prey targeting, chase timeouts, mate courtship and prey-limited predator breeding, each backed by measurements (see ECOSYSTEM.md). Save format v3.

## ✅ Milestone 4: Weather, god powers and performance (done)
Moving rain and drought systems that change moisture and temperature, fill and dry lakes and rivers, flood low land and wither plants. God powers: Rain, Drought, Fire (spreading by fuel and dryness), Meteor (craters, crater lakes), Earthquake (rifts). Minimap. Change-based undo for terrain actions. Brushes keep rivers and lakes. World generation and navigation rebuilds in Web Workers, deterministically. Region-graph long routes, food map and herbivore migration. Save format v4. Measured in docs/PERFORMANCE.md.

## ✅ Milestone 5: Expanded world, visuals and god-game UI (done)
World presets up to Giant (2048×1280) and custom sizes, with continents, ranges and rivers scaled to the map. Lighter navigation memory. Painted map chunks at two resolutions: organic biome edges, slope shading, depth-shaded sea with foam, smooth rivers, tree and peak sprites, water glints, flame sprites, a passability overlay. Creatures / Biomes / God Powers / Buffs & Debuffs tabs. Flood, Drain, Extinguish. Eight buffs and debuffs with duration and strength (save format v5). Arrow time controls. Redo with conflict-aware undo. Save export/import as files. Measured in docs/PERFORMANCE.md.

## ✅ Milestone 5b: Sky and disasters (done)
Visible drifting clouds with shadows; rain, snow and thunderstorms with lightning that really kills and ignites; snow cover on tundra that melts; rain that greens bare soil. Meteors that fly, land and leave craters, blast zones, fires and smoke, in small/medium/large sizes, plus meteor showers. Wind- and slope-driven fire. Natural disasters (meteors, earthquakes, wildfires) that are off by default and configurable. Animals that scramble out of floods and run from meteors and fire. Save format v6. Measured in docs/PERFORMANCE.md.

## ✅ Technical Improvement Milestone (done)
Slope-aware passability (gentle / steep / cliff) with detours and unsticking; time-budgeted simulation and map repainting; incremental food map and weather relaxation; a separate meteor-shower tool with count and power; round area-size buttons with on-map previews. Save format v7. Measured in docs/PERFORMANCE.md.

## ✅ Interface and Settings milestone (done)
Russian, English and Simplified Chinese interface with instant switching; SVG tool category icons; Settings with Language, Save & Load (with confirmations), Graphics & Performance, Simulation, Statistics, About & Feedback and local test promo codes; achievements analysis (docs/ACHIEVEMENTS.md, design only).

## ✅ Civilization Foundation (done)
Settlements of existing land animals: founding conditions, exact population, real territory and borders, card, growth and disappearance, save format 8. No people, economy, research, diplomacy or wars yet.

## ✅ Humans Foundation 0.9.0 (done)
People as a sixth species with the existing creature rules, available from the start; prey of raptors and tyrants; kept apart from animal settlements. Save format 9. Next logical step: human settlements (a separate settlement kind with its own founding rules) before any buildings or resources.

## ✅ Civilization 0.10–0.13 (done)
Human settlements, food/wood/stone, five buildings, housing-limited growth with camp/village/town stages, three technologies. Save format 10. Next logical step: people that really work (jobs and walking to workplaces), roads, more resources and buildings, then states, diplomacy and wars as separate stages.

## ✅ Autonomous Living World 0.14 (done)
Creatures that are easy to see and pick; groups; people that find homes, found settlements, join, leave and move on by themselves; species civilization profiles. Save format 11. Next logical step: people that work (jobs, walking to buildings), roads, a second people with its own profile, tuning of the site scoring on real worlds.

## ✅ Living Settlements 0.15 (done)
Residents take jobs (construction, field work, woodcutting, quarrying), walk to the buildings and produce there; production is tied to workers without double counting; visible work, worker and problem lines in the cards, settlement event toasts. Save format still 11. Next logical step: hauling and roads, more buildings and resources, tuning the places per building on real worlds.

## ✅ Housing Evolution 0.16 (done)
Houses go from huts to wooden, reinforced and urban houses with the settlement's stage and Better building; upgrades cost resources, take builders and time and add room; visible on the map and in the card. Save format still 11. Next logical step: architecture per people, more building types growing the same way.

## ✅ World Simulation & Visual Evolution 0.23 (done)
Buildings drawn 2×, creatures 0.5×, new trees; clearing before building and real tree felling with stumps and regrowth; roads from doors to the centre; births about 3× slower; Life tab in land and sea groups with deer, rabbit, wolf, bear, shark, whale and orca; people swim across shallow water. Save format 15. Next: domestic animals, birds and reptiles, pack hunting, danger in the water, bridges and boats.

## ✅ Settlement Landmarks 0.22 (done)
A main building at every settlement centre by people and stage (human tent, hall, town hall; elven living-wood shelter, leaf hall, spire hall), tappable to open the settlement card. Drawing only; save format 14. Next: landmarks for later stages or kingdoms' capitals, roads and bridges.

## ✅ Visual Evolution 0.21 (done)
Close-up 16-px terrain level with biome variants, wet shores, rock strata and snow lines, ridge shadows, birches, logs and mushrooms; painted in bands within the frame budget. Save format unchanged (14). Next: animated water and vegetation, day/night light, roads and bridges.

## ✅ World Evolution 0.20 (done, with foundations)
Terrain tab (raise, lower, deepen water, smooth, strength, limits), rescue of walled-in creatures, outlined two-frame creature art with distinct elves, trails from real movement, a shipyard foundation on sea coasts, chimney smoke, elven window light, soot and ground detail. Save format 14. Next: built roads and bridges, ships and sailing, swaying vegetation, day/night light.

## ✅ Kingdoms & Leaders 0.19 (done)
Kingdoms form by themselves from neighbouring settlements of one people, with a living ruler, succession, a capital, a cached territory tint and border on the map, a kingdom card and political events. Save format 13. Next logical step: relations between kingdoms (diplomacy, then wars), splitting, rulers with traits.

## ✅ Visual Evolution, Settlement Layout & Mobile UI 0.18 (done)
Outlined, cached building sprites (four clear house levels per people, recognisable workplaces), a ring-shaped settlement layout for new buildings, an icon tool palette without the manual founding tools, and a compact settlement card with details on demand. Save format unchanged (12). Next logical step: multi-tile buildings, roads, per-people workplaces.

## ✅ Elves and Race Identity 0.17 (done)
Elves as a second people through the species data: their own needs balance, site preferences, group size, settlement distance and an elven house style at all four levels; shared rules for everything else. Save format 12. Next logical step: relations between peoples, buildings of other kinds per architecture.

## Milestone 6: Richer nature (next)
- More fauna as data: sauropods, pterosaurs, crocodiles (amphibious habitat), small mammals. Herds, nesting and eggs, sexes, seasonal migration.
- Snow cover beyond tundra, erosion and rivers carving new courses.
- Consider moving the whole simulation tick into a worker (see PERFORMANCE.md).

## Milestone 7: Peoples
- Race definitions as data: humans, elves, dwarves, orcs, demons, demigods. Each has preferred biomes, lifespan, traits and building style.
- Individuals with needs (food, shelter), families, birth and death.
- Hybrid races: compatibility table between parent species, and inherited traits.
- Spawn-a-race god tool.

## Milestone 8: Settlements
- Founding villages, gathering resources (wood, stone, food, ore), placing buildings on the tile map.
- Growth from village to town to city, with territory borders drawn on the map.
- Scalability target: 50+ settlements. Aggregated "abstract" simulation for off-screen settlements, and detailed agents only where needed.
- **Player currency**, earned through world development (population, prosperity, wonders) and spent on god powers and unlocks.

## Milestone 9: Civilizations and politics
- Kingdoms formed from settlements, with leaders, culture and opinions.
- Diplomacy, alliances, trade, rivalries, wars with armies and sieges, and border changes.
- A world history chronicle (wars, founders, dynasties) and a timeline viewer.

## Milestone 10: Ages of progress
- Technology tree per civilization: Stone → Bronze → Iron → Medieval → Industrial → Modern → Space.
- New buildings and units each era. Pollution and climate impact in the industrial era. Space era with launch sites, orbital view and colonisation as the late-game goal.

## Milestone 11: Planet scale
- Huge worlds (2048² and up) using streamed chunks, a WebGL renderer, and worker-side simulation level of detail.
- Optional spherical or wrap-around planet projection.

## Technical backlog
- PWA manifest and service worker for offline play.
- Performance budget tests: tick time on Large worlds with 5,000 creatures.
- A day/night tint in the renderer.
- Paint chunks in a worker (OffscreenCanvas) if phone measurements show chunk painting stalls.
- Undo for creature actions and buffs.
