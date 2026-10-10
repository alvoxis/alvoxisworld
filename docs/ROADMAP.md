# Roadmap

Each milestone ends with something playable, plus tests for the new rules. Only Milestone 1 is done.

## ✅ Milestone 1: Living map foundation (done)
Seeded world generation with biomes and climate. Two-level pixel-art renderer. Touch and mouse camera. Terrain, biome and life brushes. Seasons and time controls. Vegetation succession. Grazer/raptor food chain. IndexedDB save slots. Stats and history. CI and GitHub Pages deploy.

## Milestone 2: Richer nature
- Rivers flowing downhill from mountains, and lakes.
- Weather: rain and drought that change moisture over time, plus seasonal snow cover that spreads and melts.
- God powers: rain, drought, meteor (crater), fire that spreads through forest, earthquake.
- Prehistoric fauna: several dinosaur species defined as data (diet, size, preferred biome, speed), herds, nesting, migration.
- Minimap, undo for brush strokes, save export/import as a file (share worlds between devices).
- Move the simulation into a Web Worker.

## Milestone 3: Peoples
- Race definitions as data: humans, elves, dwarves, orcs, demons, demigods. Each has preferred biomes, lifespan, traits and building style.
- Individuals with needs (food, shelter), families, birth and death.
- Hybrid races: compatibility table between parent species, and inherited traits.
- Spawn-a-race god tool.

## Milestone 4: Settlements
- Founding villages, gathering resources (wood, stone, food, ore), placing buildings on the tile map.
- Growth from village to town to city, with territory borders drawn on the map.
- Scalability target: 50+ settlements. Aggregated "abstract" simulation for off-screen settlements, and detailed agents only where needed.
- **Player currency**, earned through world development (population, prosperity, wonders) and spent on god powers and unlocks.

## Milestone 5: Civilizations and politics
- Kingdoms formed from settlements, with leaders, culture and opinions.
- Diplomacy, alliances, trade, rivalries, wars with armies and sieges, and border changes.
- A world history chronicle (wars, founders, dynasties) and a timeline viewer.

## Milestone 6: Ages of progress
- Technology tree per civilization: Stone → Bronze → Iron → Medieval → Industrial → Modern → Space.
- New buildings and units each era. Pollution and climate impact in the industrial era. Space era with launch sites, orbital view and colonisation as the late-game goal.

## Milestone 7: Planet scale
- Huge worlds (2048² and up) using streamed chunks, a WebGL renderer, and worker-side simulation level of detail.
- Optional spherical or wrap-around planet projection.

## Technical backlog
- Upgrade to Vite 6+ (fixes the dev-server audit advisory).
- PWA manifest and service worker for offline play.
- Performance budget tests: tick time on Large worlds with 5,000 creatures.
- Animated water and a day/night tint in the renderer.
