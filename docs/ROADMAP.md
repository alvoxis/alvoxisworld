# Roadmap

Each milestone ends with something playable, plus tests for the new rules. Milestones 1–3 are done.

## ✅ Milestone 1: Living map foundation (done)
Seeded world generation with biomes and climate. Two-level pixel-art renderer. Touch and mouse camera. Terrain, biome and life brushes. Seasons and time controls. Vegetation succession. Grazer/raptor food chain. IndexedDB save slots. Stats and history. CI and GitHub Pages deploy.

## ✅ Milestone 2: Living world (done)
Creature model with IDs, health, hunger, thirst, life stages and behaviour states. Five species (grazer, hadrosaur, fish, raptor, tyrant) with habitat rules. Food and water seeking, hunting, fleeing, damage and death causes. Mate-seeking reproduction with carrying capacity. Select, inspect, follow and remove creatures. Smooth movement between ticks. Save format v2 with v1 migration. Deterministic, tested simulation.

## ✅ Milestone 3: Rivers, lakes and pathfinding (done)
Priority-flood hydrology (rivers that drain to the sea or lakes, fordable by land animals; lakes in closed basins) and River/Lake brushes. A* and nearest-reachable searches with per-tick budgets. A shared water-distance map. Path following that re-validates each step after terrain edits. Prowling predators, catchable-prey targeting, chase timeouts, mate courtship and prey-limited predator breeding, each backed by measurements (see ECOSYSTEM.md). Save format v3.

## Milestone 4: Richer nature (next)
- Weather: rain and drought that change moisture over time, plus seasonal snow cover that spreads and melts. Rivers that rise, fall and dry up.
- God powers: rain, drought, meteor (crater), fire that spreads through forest, earthquake.
- More fauna as data: sauropods, pterosaurs, crocodiles (amphibious habitat), small mammals. Herds, nesting and eggs, sexes, seasonal migration.
- Minimap, undo for brush strokes, save export/import as a file (share worlds between devices).
- Move the simulation into a Web Worker, and use a coarse hierarchical pathfinding grid for very long routes.

## Milestone 5: Peoples
- Race definitions as data: humans, elves, dwarves, orcs, demons, demigods. Each has preferred biomes, lifespan, traits and building style.
- Individuals with needs (food, shelter), families, birth and death.
- Hybrid races: compatibility table between parent species, and inherited traits.
- Spawn-a-race god tool.

## Milestone 6: Settlements
- Founding villages, gathering resources (wood, stone, food, ore), placing buildings on the tile map.
- Growth from village to town to city, with territory borders drawn on the map.
- Scalability target: 50+ settlements. Aggregated "abstract" simulation for off-screen settlements, and detailed agents only where needed.
- **Player currency**, earned through world development (population, prosperity, wonders) and spent on god powers and unlocks.

## Milestone 7: Civilizations and politics
- Kingdoms formed from settlements, with leaders, culture and opinions.
- Diplomacy, alliances, trade, rivalries, wars with armies and sieges, and border changes.
- A world history chronicle (wars, founders, dynasties) and a timeline viewer.

## Milestone 8: Ages of progress
- Technology tree per civilization: Stone → Bronze → Iron → Medieval → Industrial → Modern → Space.
- New buildings and units each era. Pollution and climate impact in the industrial era. Space era with launch sites, orbital view and colonisation as the late-game goal.

## Milestone 9: Planet scale
- Huge worlds (2048² and up) using streamed chunks, a WebGL renderer, and worker-side simulation level of detail.
- Optional spherical or wrap-around planet projection.

## Technical backlog
- Upgrade to Vite 6+ (fixes the dev-server audit advisory).
- PWA manifest and service worker for offline play.
- Performance budget tests: tick time on Large worlds with 5,000 creatures.
- Animated water and a day/night tint in the renderer.
