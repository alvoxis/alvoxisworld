# CLAUDE.md — ALVOXIS: World Evolution

Browser pixel-art sandbox god game. TypeScript (strict), Vite, Vitest, Canvas 2D. Repository: `alvoxis-world`. Read this file first; it replaces re-auditing the project.

## Working rules (save the usage limit)

- **Read only what the task needs.** Start from the map below, open the specific files involved, use Grep/Glob for lookups. Do not re-read the whole project, and do not repeat an audit unless the task asks for one or something contradicts this file.
- **Reuse existing systems, change as little as possible.** Extend what exists (tools, `Hud`, `SettingsStore`, i18n, save format) rather than adding parallel mechanisms.
- **Do not add unrequested features or dependencies.** No new npm packages without an explicit request.
- **Checks:** while developing run targeted tests (`npx vitest run tests/<file>.test.ts`, `npx tsc --noEmit`). Run the full `npm run check` once at the end of a finished stage. Do not re-run checks that already passed on unchanged code.
- **Reports are short:** what changed, which checks ran and their results, what is left or limited. No long recaps of earlier work.
- **Never claim a check, test, device test or browser test that was not actually run.** Nothing has been tested on a physical iPhone unless the user says so; headless Chromium with iPhone emulation is not an iPhone.
- **Do not touch the `alvoxis-ascension` repository** (or any repo other than this one).

## Project rules that always apply

- Every button/option must really work; no decorative or mock controls. Do not present unimplemented things as done.
- Keep saves compatible: current `SAVE_VERSION` is 11 and loads versions 1–11. Add new save fields as optional and sanitise them on load. Bump the version only when needed and add a migration/test.
- Preserve species coexistence and never auto-remove dinosaurs or other species. Simulation stays deterministic (fixed 10 ticks/s; use the sim RNG, not `Math.random`).
- Settings and quality options change drawing only, never simulation rules.
- Settlements (`src/sim/settlements.ts`) and the human economy (`src/sim/civ.ts`: food/wood/stone, five buildings, house levels 1–4, worker jobs, stages, three technologies) exist. Still out of scope unless explicitly requested: states, diplomacy, wars, rulers, trade, hybrid races, inventory, the "Alvoxis Energy" economy, real payments. Promo codes are a local, non-secure test prototype and must not be described otherwise.
- No pull requests unless asked.

## Localisation (ru / en / zh-CN)

- Every player-visible string goes through `src/i18n` (`t`, `td`, `tn`). Add the key to `en.ts` first, then `ru.ts` and `zh.ts` (typed; `tests/i18n.test.ts` checks parity, placeholders and untranslated words). Static HTML uses `data-i18n*` attributes.
- Game data keep English ids/names (saves, undo labels, tests use them); display names come from `src/i18n/names.ts`.
- Simulation history lines: `sim.log(englishText, code?, params?)` with a matching `msg.<code>` key in all dictionaries.

## Commands

| Command | Use |
| --- | --- |
| `npx vitest run tests/<file>.test.ts` | targeted tests during development |
| `npx tsc --noEmit` | typecheck |
| `npm run check` | typecheck + all tests + production build; once per finished stage |
| `npm run dev` / `npm run preview` | local server (preview serves `dist/`; start long servers as background tasks) |
| `npm run bench`, `npm run bench:sizes`, `npx vite-node scripts/behavior.ts 4,11,21 4` | performance / ecosystem diagnostics, only when the task is about them |

## Map (where to look)

- `src/world/` terrain, `World` layers (typed arrays), generator, hydrology, slopes (`passability.ts`).
- `src/sim/` `settlements.ts`, `civ.ts`, `groups.ts` (groups of free people, autonomous settling), `sites.ts` (where to settle), `simulation.ts` (tick loop, god powers, history), `creatures.ts` (SoA creatures, species data), `pathfinding.ts` / `regions.ts` / `navjobs.ts` (navigation, workers), `weather.ts`, `fire.ts`, `sky.ts` (meteors, showers), `disasters.ts`, `effects.ts`, `foodmap.ts`, `clock.ts`.
- `src/game/` `game.ts` (controller, loop, save/load hooks), `tools.ts` (tool list, area rings), `settings.ts`, `promo.ts`, `undo.ts`, `timecontrol.ts`.
- `src/render/` `renderer.ts`, `painter.ts` (terrain chunks), `skyfx.ts`, `tileset.ts`, `camera.ts`.
- `src/ui/` `hud.ts` (all DOM UI and Settings), `settlementcard.ts`, `icons.ts`, `minimap.ts`. `index.html` + `src/styles.css`.
- `src/save/` `serialize.ts` (format), `storage.ts` (IndexedDB slots), `file.ts` (export/import).
- `src/i18n/`, `src/app/` (version, changelog, diagnostics).
- `tests/` one file per area (e.g. `creatures`, `sky`, `passability`, `areas`, `i18n`, `settings`, `savefile`, `render`).
- Docs: `README.md` (what works), `docs/ARCHITECTURE.md`, `docs/PERFORMANCE.md` (measurements), `docs/ROADMAP.md`, `docs/ACHIEVEMENTS.md` (analysis only). Update only the docs a change affects.

## Git and delivery

- Branch `main`; push with `git push -u origin main` after a finished stage. Confirm CI (and the Pages deploy) before saying it is live.
- Commit messages end with the attribution lines from the session's system reminder; do not put model identifiers anywhere else (code, docs, PR text).
