# Ecosystem stability investigation (Milestone 3)

After Milestone 2 we saw three problems: raptors falling from a peak to near extinction, tyrants dying out in mixed worlds, and animals dying of thirst far from water. This document records how each cause was identified, what changed, and what the measurements were before and after. Balance values were changed only where a measurement pointed to them.

## Method

The scenario is the same in every run:
- Worlds: 512×320, seeds 4, 7 and 11.
- Spawns (deterministic RNG per seed):
  - 15 groups of 8 grazers on grassland, plus 2 raptors with every third group.
  - 8 groups of 4 hadrosaurs in forest, plus 2 tyrants with every fourth group.
  - 8 groups of 6 fish in shallow water.
- Length: 8 to 12 simulated years.

Each predator death was logged with:
- its cause;
- the straight-line distance to the nearest water;
- whether there was prey within 14 tiles;
- whether it had been stuck (moved less than 4 tiles over its last 150 ticks).

Further runs traced hunt outcomes by prey species, which breeding condition blocked tyrants, and what starving tyrants did in their last 600 ticks.

The diagnostic scripts were kept out of the test suite because they are slow. `tests/sim.test.ts` keeps a shorter regression run of the same scenario: seed 11, 6 years.

## 1. Thirst far from water: navigation, not water supply

Baseline (Milestone 2 AI, no rivers), 3 seeds × 8 years:
- **Raptors: 40 thirst deaths.** In 39 of them water was within 32 tiles in a straight line, and in 23 within 10 tiles. Most died while "Looking for water", and 7 had been stuck.
- **Tyrants: 9 thirst deaths**, 7 of them with water within 32 tiles. Some died 2 to 3 tiles from water they couldn't reach: it was behind a mountain, which tyrants can't cross.

**Cause.** Animals picked the nearest water *in a straight line* and steered straight at it. They got stuck behind coastlines and ridges, and the search radius was 32 tiles.

**Changes.**
- A shared **water-distance map** per movement class: a breadth-first search from every place an animal can drink, over tiles it can walk. Thirsty animals follow it to the nearest *reachable* water, with no radius limit.
- **Rivers and lakes** provide water inland.

**Result.** Without rivers, raptor thirst deaths fell from 40 to 20, with 0 stuck. With rivers and lakes they fell to **4**, and tyrant thirst deaths fell from 9 to 2. A later fix (very thirsty animals drink before hunting) brought tyrant thirst deaths to **0**.

## 2. Raptor starvation and decline: prey out of sight, then overshoot

**Baseline: 44 raptor starvation deaths.** In 39 of them there was no prey within 14 tiles, and the raptor was not stuck. It was wandering empty ground at random while prey existed elsewhere.

**Change: prowling.** A hungry predator with no prey in sight heads, via A*, toward the most prey-rich area nearby, using the per-cell prey counts the simulation already keeps.

**Result.** Raptor starvation deaths fell from 44 to 10, and most raptors now die of old age (55 of 70 deaths).

**New problem: overshoot.** With efficient hunting, seed 11 showed a clear boom and crash:

| Time | Raptors | Grazers |
|---|---|---|
| 3.5 years | 46 | 434 |
| 8 years | 139 | 148 |
| 12 years | 13 | 8 |

**Cause.** Predator breeding did not depend on food.

**Change.** Predators only breed with at least **3 prey per predator** of their species within sight.

**Result.** Seed 11 at 12 years: 38 raptors and 1,352 grazers, with no crash.

## 3. Tyrant fragility: four separate causes

| Finding (data) | Change |
|---|---|
| Tyrants chasing raptors succeeded **0 of 5** times (about 300 ticks each). A fleeing raptor (0.225 tiles/tick) outruns a sprinting tyrant (0.161). Hadrosaur hunts succeeded 35 of 38 times. | Removed raptors from the tyrant's prey list. |
| While "ready to breed", tyrants spent about 1,600 to 2,100 ticks with a mate in sight but never close. They walked to where the mate *had been*, and all breeding conditions were met for only about 100 to 170 ticks. A crowd limit of 1 other tyrant also meant a juvenile nearby blocked breeding. | Mate-seekers re-plan when the mate moves, and a pair within range waits together (courtship). Tyrant crowd limit raised from 1 to 3, breeding cooldown cut from 900 to 600 ticks. |
| Starving tyrants spent about 450 of their last 600 ticks "Hunting" with 10 to 46 prey within sight. Young and old tyrants (0.85× speed) can't catch a fleeing grazer. Prey only flees within 6 tiles, so chases never ended. | Predators only target prey they can outrun. A chase is abandoned after 250 ticks, and a pounce (1.6× speed within 2.5 tiles) closes the last gap. |
| Some tyrants died of thirst while prowling, because hunger outranked thirst. | Thirst above 85 always takes priority. |

**Result** (tyrants alive, and tyrant births, after 12 years):

| Seed | Before | After |
|---|---|---|
| 4 | 0 alive | 8 alive, 12 births |
| 7 | 0 alive | 0 alive (died out around year 10), 4 births |
| 11 | 1 alive | 13 alive, 20 births |

Seed 7's tyrants still die out. That's an accepted outcome: a 4-animal founding population with few local hadrosaurs. They no longer die because they can't navigate.

## Current results

12-year runs, measured in Node 22 in this container, single thread:

| Seed | Grazers | Raptors | Hadrosaurs | Tyrants | Fish | Worst ms/tick |
|---|---|---|---|---|---|---|
| 4 | 2,373 | 176 | 540 | 8 | 1,797 | 3.9 |
| 7 | 2,700 (cap) | 103 | 252 | 0 | 1,800 (cap) | 2.6 |
| 11 | 804 | 159 | 145 | 13 | 1,798 | 2.4 |

## Known open issues

- On seed 11, grazers decline from 1,595 (year 9) to 804 (year 12) while raptors keep rising. The prey-per-predator rule slows overshoot but doesn't rule out a later cycle.
- Herbivores with plenty of food hit their population caps (grazers 45%, fish 30% of the 6,000-creature limit). The caps then act as the limit instead of food or space, which costs CPU.
- Tyrants remain the most likely species to die out.
