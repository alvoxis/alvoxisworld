/**
 * Architecture of the peoples: how each people's buildings look. Only the look differs; the rules (costs, capacity,
 * upgrades, builders) are shared and live in sim/civ.ts. A people picks its house style through
 * `CivProfile.architecture`; a new people needs one more entry in HOUSE_STYLES. Workplaces (farm, lumber camp,
 * quarry, storehouse) share one look for every people, with the settlement colour as an accent.
 *
 * No DOM: the art is a list of rectangles on the 8×8 building grid (one tile is 8 units wide), so it can be tested
 * and drawn by any renderer. Buildings stand on their tile (y 0..8); taller levels rise above it (negative y, down to
 * -8). The renderer adds a dark outline and a ground shadow and caches the result per zoom (renderer.ts).
 */
import type { BuildingType } from '../sim/civ';
import { SPECIES, type Architecture } from '../sim/creatures';

/**
 * Buildings are drawn this many times larger than one tile (0.23): a house's art spans two tiles and rises up to two
 * more above, standing on the bottom of its own tile, centred on it. Drawing only: a building still occupies one
 * tile; the layout keeps its neighbours clear (civ.ts findSite) so the larger art fits.
 */
export const BUILDING_SCALE = 2;

/** Draws a rectangle in grid units (x, y, width, height, colour). */
export type Rect = (x: number, y: number, w: number, h: number, c: string) => void;

export interface HouseStyle {
  /** Colour of a house far away, by level (index 1..4). */
  dots: readonly string[];
  /** Draws a house of the level; `roof` is the settlement colour. */
  draw(r: Rect, level: number, roof: string): void;
}

/** A #rrggbb colour made lighter (k > 0) or darker (k < 0). */
export function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1, 7), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(k >= 0 ? v + (255 - v) * k : v * (1 + k))));
  return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => f(v).toString(16).padStart(2, '0')).join('')}`;
}

const DOOR = '#3b2817';
const LIT = '#ffd98a';
const GLASS = '#5b86b8';
const LEAF_LIT = '#c8f5a8';

/** A stepped gable roof in the settlement colour, from `top` down to `eave` (the lowest row darker). */
function gable(r: Rect, roof: string, top: number, eave: number, x0 = 0, x1 = 8): void {
  const rows = Math.max(2, Math.round(eave - top));
  for (let k = 0; k < rows; k++) {
    const inset = ((rows - 1 - k) / rows) * ((x1 - x0) / 2 - 0.6);
    // Rows of shingles: alternate rows a shade darker, the eave darkest.
    r(x0 + inset, top + k, x1 - x0 - 2 * inset, 1.05, k === rows - 1 ? shade(roof, -0.3) : k % 2 ? shade(roof, -0.1) : roof);
  }
  r(x0 + (x1 - x0) / 2 - 0.5, top - 0.3, 1, 0.5, shade(roof, 0.25)); // ridge cap
}

/**
 * Human houses grow from mud and thatch to stone: 1 a low thatched hut with a pennant, 2 a log cottage with a
 * gabled roof and lit windows, 3 a two-storey house on a stone ground floor with a timber frame and a chimney,
 * 4 a tall pale stone town house with three rows of windows, a dormer and two chimneys.
 */
function drawHumanHouse(r: Rect, level: number, roof: string): void {
  switch (level) {
    case 1:
      r(1.5, 5, 5, 2, '#9c7a4a'); // mud walls
      r(1.5, 6.5, 5, 0.5, '#7d5f37');
      r(0.5, 3.5, 7, 1.6, '#c9a352'); // thatch in layers
      r(0.5, 4.8, 7, 0.4, '#a8873f');
      r(1.5, 2.5, 5, 1.2, '#d6b25f');
      r(2.5, 1.6, 3, 1, '#e0be6c');
      r(3.4, 0.9, 1.2, 0.8, '#b48f43');
      r(3.4, 5.4, 1.2, 1.6, DOOR);
      r(6.6, 0.2, 0.4, 3.4, '#6b4a2a'); // pole with a pennant in the settlement colour
      r(7, 0.2, 1, 0.7, roof);
      break;
    case 2:
      r(0.5, 6.6, 7, 0.4, '#7c766c'); // footing
      r(1, 3.6, 6, 3, '#b0803f'); // log walls
      r(1, 4.4, 6, 0.3, '#7c5428');
      r(1, 5.4, 6, 0.3, '#7c5428');
      gable(r, roof, 0.4, 3.8);
      r(3.3, 4.8, 1.4, 1.8, DOOR);
      r(1.6, 4.2, 1.1, 1, LIT);
      r(5.3, 4.2, 1.1, 1, LIT);
      break;
    case 3:
      r(0, 4, 8, 3, '#8f8b84'); // stone ground floor
      r(0.5, 4.8, 2, 0.3, '#6f6b65');
      r(4, 5.6, 2.5, 0.3, '#6f6b65');
      r(1.5, 6.3, 2, 0.3, '#6f6b65');
      r(3.2, 4.8, 1.6, 2.2, DOOR);
      r(0.5, 0.8, 7, 3.2, '#b0803f'); // timber-framed upper floor
      r(0.5, 0.8, 7, 0.3, '#5e3f1e');
      r(0.5, 3.7, 7, 0.3, '#5e3f1e');
      r(2.2, 0.8, 0.3, 3.2, '#5e3f1e');
      r(5.5, 0.8, 0.3, 3.2, '#5e3f1e');
      r(0.9, 1.6, 0.9, 1.1, LIT);
      r(3.5, 1.6, 1, 1.1, LIT);
      r(6.2, 1.6, 0.9, 1.1, LIT);
      r(5.8, -3.2, 1, 2.4, '#6d5d4f'); // chimney
      r(5.6, -3.4, 1.4, 0.4, '#4f433a');
      gable(r, roof, -2.6, 1, -0.3, 8.3);
      break;
    default:
      r(0, 6.4, 8, 0.6, '#9c958a'); // plinth
      r(0, -3, 8, 9.4, '#e1dbcd'); // three storeys of pale stone
      r(0, 0.6, 8, 0.4, '#b9b2a2');
      r(0, 3.6, 8, 0.4, '#b9b2a2');
      for (const x of [0.8, 3.5, 6.2]) {
        r(x, -2.1, 1, 1.6, GLASS);
        r(x, 1.4, 1, 1.6, GLASS);
      }
      r(0.8, 4.4, 1, 1.4, GLASS);
      r(6.2, 4.4, 1, 1.4, GLASS);
      r(3.3, 4.2, 1.4, 2.2, DOOR);
      r(6.2, -7, 1, 2.6, '#6d5d4f'); // chimneys
      r(1, -6.6, 0.9, 2, '#6d5d4f');
      gable(r, roof, -6, -3, -0.3, 8.3);
      r(3.3, -5.4, 1.4, 1.1, '#e1dbcd'); // dormer
      r(3.6, -5.1, 0.8, 0.6, GLASS);
  }
}

/**
 * Elven houses are living wood and leaves: 1 a dome of leaves on a wicker ring, 2 a round wooden dwelling under a
 * rounded leaf roof, 3 a house on a platform in a tree under a wide canopy, with a ladder, 4 a tall pale-wood
 * spire hall with leaf-roofed wings. The settlement colour shows in a pennant, a vine or a band.
 */
function drawElvenHouse(r: Rect, level: number, roof: string): void {
  switch (level) {
    case 1:
      r(1, 6, 6, 1, '#7a5a34'); // wicker ring
      r(1, 3.2, 6, 2.9, '#4f8f3c'); // dome of leaves
      r(1.8, 2.3, 4.4, 1, '#5fa84a');
      r(2.8, 1.5, 2.4, 0.9, '#78c25c');
      r(1.6, 3.8, 0.6, 0.5, '#3d7530');
      r(5.4, 4.6, 0.6, 0.5, '#3d7530');
      r(3.6, 2.6, 0.6, 0.4, '#8fd36e');
      r(3.2, 4.6, 1.6, 2.4, '#22301a'); // low round entrance
      r(4, 0.5, 0.3, 1.1, '#6b4a2a');
      r(4.3, 0.5, 0.9, 0.5, roof);
      break;
    case 2:
      r(1, 3.8, 6, 3.2, '#8a6a42'); // round wooden walls
      r(1, 4.8, 6, 0.3, '#6c5030');
      r(1, 5.9, 6, 0.3, '#6c5030');
      r(0, 2.8, 8, 1.2, '#3f8f4a'); // rounded leaf roof
      r(0.6, 1.8, 6.8, 1.1, '#4fa458');
      r(1.6, 0.9, 4.8, 1, '#5fb865');
      r(2.8, 0.2, 2.4, 0.8, '#78c25c');
      r(0, 3.9, 0.8, 0.5, '#3f8f4a');
      r(7.2, 3.9, 0.8, 0.5, '#3f8f4a');
      r(0.4, 2.9, 1.2, 0.4, roof); // vine in the settlement colour
      r(3.2, 4.8, 1.6, 2.2, '#2b2015');
      r(1.6, 4.3, 1, 1, LEAF_LIT);
      r(5.4, 4.3, 1, 1, LEAF_LIT);
      break;
    case 3:
      r(3, 2, 2, 5, '#6b4a2a'); // trunk with roots
      r(3.5, 3, 0.3, 3, '#563a20');
      r(2, 6.4, 4, 0.6, '#5a3d22');
      r(1.6, 6.8, 1, 0.3, '#5a3d22');
      r(5.4, 6.8, 1, 0.3, '#5a3d22');
      r(5.3, 2.4, 0.3, 4.2, '#8a6a42'); // ladder
      r(6.1, 2.4, 0.3, 4.2, '#8a6a42');
      for (const y of [3.2, 4.4, 5.6]) r(5.3, y, 1.1, 0.2, '#8a6a42');
      r(0, 1.8, 8, 0.6, '#8a6a42'); // platform
      r(1, -1.4, 6, 3.2, '#a07a4c'); // the house on it
      r(1, 0, 6, 0.3, '#7d5c34');
      r(1.8, -0.6, 1, 1, LEAF_LIT);
      r(5.2, -0.6, 1, 1, LEAF_LIT);
      r(3.4, -0.3, 1.2, 2.1, '#2b2015');
      r(-0.4, -3.2, 8.8, 1.9, '#3f8f4a'); // wide canopy
      r(0.4, -4.2, 7.2, 1.1, '#4fa458');
      r(1.6, -5, 4.8, 0.9, '#5fb865');
      r(3, -5.6, 2, 0.7, '#78c25c');
      r(6.8, -6.2, 0.3, 1.2, '#6b4a2a');
      r(7.1, -6.2, 0.9, 0.5, roof);
      break;
    default:
      r(0.5, 6.4, 7, 0.6, '#bfb08c'); // terrace
      r(0, 1, 2, 5.4, '#d4c6a4'); // wings
      r(6, 1, 2, 5.4, '#d4c6a4');
      r(-0.3, 0, 2.6, 1.1, '#4fa458');
      r(5.7, 0, 2.6, 1.1, '#4fa458');
      r(0.6, 2.4, 0.8, 1, LEAF_LIT);
      r(6.6, 2.4, 0.8, 1, LEAF_LIT);
      r(2, -3, 4, 9.4, '#e2d6b8'); // tall hall of pale wood
      r(2, -0.2, 4, 0.3, '#c8b994');
      r(2, 2.8, 4, 0.3, '#c8b994');
      r(2, -3, 4, 0.5, roof); // band in the settlement colour
      r(2.3, -4.4, 3.4, 1.4, '#3f8f4a'); // leaf spire
      r(2.9, -5.6, 2.2, 1.2, '#4fa458');
      r(3.4, -6.7, 1.2, 1.1, '#5fb865');
      r(3.8, -7.6, 0.4, 0.9, '#78c25c');
      r(3.5, -1.8, 1, 1.6, LEAF_LIT);
      r(3.5, 1.2, 1, 1.4, LEAF_LIT);
      r(3.2, 4.2, 1.6, 2.2, DOOR);
  }
}


/** Dwarf houses: low, sturdy stone and timber, heavy roofs. */
function drawDwarfHouse(r: Rect, _level: number, roof: string): void {
  const stone = '#7a6050';
  const dark = '#5a4030';
  r(1, 5.5, 6, 2.5, stone);
  r(1, 7.5, 6, 0.5, dark);
  r(0.5, 3.5, 7, 2.2, roof);
  r(0.5, 5.2, 7, 0.4, shade(roof, -0.2));
  r(3.2, 5.8, 1.6, 1.8, DOOR);
  r(2, 4.5, 1, 0.8, LIT);
  r(5, 4.5, 1, 0.8, LIT);
  if (_level >= 2) r(6.5, 2.5, 0.5, 2, dark); // chimney
}

/** Gnome houses: small, rounded, with chimneys and gardens. */
function drawGnomeHouse(r: Rect, _level: number, roof: string): void {
  r(1.5, 5, 5, 2.5, '#8a6a4a');
  r(1, 3.8, 6, 1.8, roof);
  r(1, 5.2, 6, 0.4, shade(roof, -0.15));
  r(3.3, 5.5, 1.4, 1.8, DOOR);
  r(2.2, 4.3, 0.9, 0.7, LIT);
  r(4.8, 4.3, 0.9, 0.7, LIT);
  r(6.8, 3.2, 0.4, 1.5, '#5a4030'); // chimney
  if (_level >= 2) r(0.5, 6.8, 1.2, 0.6, '#6a9a4a'); // garden
}

/** Demigod halls: tall, pale stone with golden accents and light. */
function drawDemigodHouse(r: Rect, _level: number, roof: string): void {
  r(1, 4, 6, 3.5, '#e8d8b0');
  r(1, 7, 6, 0.5, '#c0b090');
  gable(r, roof, 0.5, 4.2);
  r(3.2, 5.2, 1.6, 2, DOOR);
  r(2, 4.5, 1, 1.2, '#fff8c0'); // glowing window
  r(5, 4.5, 1, 1.2, '#fff8c0');
  r(3.5, 1.2, 1, 1.5, '#ffd060'); // spire light
}

/** Orc huts: rough timber and hide, aggressive look. */
function drawOrcHouse(r: Rect, _level: number, roof: string): void {
  r(1, 5.2, 6, 2.3, '#6a5a3a');
  r(0.8, 3.5, 6.4, 2, roof);
  r(0.8, 5, 6.4, 0.5, shade(roof, -0.25));
  r(3, 5.5, 2, 1.8, '#3a2a1a');
  r(2.5, 4.2, 1, 0.9, '#ff6a3a'); // fire light
  r(4.5, 4.2, 1, 0.9, '#ff6a3a');
  r(6.5, 4, 0.6, 2, '#5a3a2a'); // pole
}

/** Merfolk dwellings: shell and coral style near water. */
function drawMerfolkHouse(r: Rect, _level: number, roof: string): void {
  r(1.5, 5.2, 5, 2.3, '#6a9ab0');
  r(1, 3.8, 6, 1.8, roof);
  r(1, 5.2, 6, 0.4, shade(roof, -0.1));
  r(3.3, 5.6, 1.4, 1.6, DOOR);
  r(2.2, 4.4, 0.9, 0.8, '#a0e0ff');
  r(4.8, 4.4, 0.9, 0.8, '#a0e0ff');
  r(6.6, 4.5, 0.5, 1.2, '#e0c080'); // shell accent
}

export const HOUSE_STYLES: Readonly<Record<Architecture, HouseStyle>> = {
  human: { dots: ['', '#b8964f', '#c9a36b', '#a7a39b', '#e4ded2'], draw: drawHumanHouse },
  elven: { dots: ['', '#4f8f3c', '#6f8a4a', '#7fae5a', '#d9e8c0'], draw: drawElvenHouse },
  dwarf: { dots: ['', '#8a6a4a', '#a08060', '#6a5040', '#c0a080'], draw: drawDwarfHouse },
  gnome: { dots: ['', '#6a9a5a', '#8aba70', '#5a7a4a', '#d0e8b0'], draw: drawGnomeHouse },
  demigod: { dots: ['', '#e0c060', '#f0d080', '#c0a040', '#fff0c0'], draw: drawDemigodHouse },
  orc: { dots: ['', '#5a6a3a', '#7a8a4a', '#4a5a2a', '#a0b070'], draw: drawOrcHouse },
  merfolk: { dots: ['', '#5a9ab0', '#7ab0c0', '#4a7a90', '#c0e0f0'], draw: drawMerfolkHouse },
};
/**
 * Workplaces read by their use: a fenced field with rows of crops and a scarecrow, a lumber camp with a log pile
 * under a lean-to and an axe in a stump, a quarry pit with cut blocks and a pick, a wide plank barn with a big door.
 */
export type Workplace = Exclude<BuildingType, 'house' | 'shipyard' | 'bridge' | 'tower' | 'temple' | 'townhall'>;

export const WORKPLACES: Readonly<Record<Workplace, { dot: string; draw(r: Rect, roof: string): void }>> = {
  farm: {
    dot: '#7fb046',
    draw(r, roof) {
      r(0, 0.5, 8, 7, '#8a6a3c'); // tilled soil
      for (const y of [0.8, 2.5, 4.2, 5.9]) {
        r(0, y + 0.95, 8, 0.4, '#6e5230'); // furrow
        for (let x = 0.5; x < 7.5; x += 1.5) {
          r(x, y, 0.6, 0.9, '#7cc04a'); // crop with a ripe tip
          r(x, y, 0.6, 0.3, '#d8d060');
        }
      }
      r(0, 0.5, 0.3, 7, '#b08a52'); // fence posts
      r(7.7, 0.5, 0.3, 7, '#b08a52');
      r(6.6, -1, 0.3, 2, '#6b4a2a'); // scarecrow with a hat in the settlement colour
      r(6.1, -0.6, 1.3, 0.3, '#6b4a2a');
      r(6.4, -1.4, 0.7, 0.6, roof);
    },
  },
  lumber: {
    dot: '#7a5530',
    draw(r, roof) {
      r(0, 6.6, 8, 0.5, '#6b5434');
      r(0.3, 3, 0.3, 3.6, '#6b4a2a'); // lean-to
      r(5.1, 3, 0.3, 3.6, '#6b4a2a');
      r(0, 2.4, 5.8, 0.7, roof);
      r(0.4, 4.6, 4.8, 0.9, '#8a5a2b'); // log pile with cut ends
      r(0.4, 5.5, 4.8, 0.9, '#7a4f25');
      r(0.9, 3.7, 3.8, 0.9, '#8a5a2b');
      for (const [x, y] of [[0.4, 4.7], [0.4, 5.6], [0.9, 3.8]]) r(x, y, 0.6, 0.7, '#d2a46a');
      r(5.8, 5, 1.6, 1.6, '#7a4f25'); // stump with an axe
      r(5.8, 5, 1.6, 0.4, '#d2a46a');
      r(6.5, 3.2, 0.3, 1.9, '#9a6a34');
      r(6.8, 3.2, 0.8, 0.7, '#d6dbe2');
    },
  },
  quarry: {
    dot: '#9a9791',
    draw(r, roof) {
      r(0.5, 2.5, 7, 4.5, '#6f6c67'); // stepped pit
      r(0.5, 2.5, 7, 0.5, '#8d8a84');
      r(1.3, 3.4, 5.4, 2.8, '#4f4c48');
      r(1.3, 3.4, 5.4, 0.4, '#5f5c58');
      r(0.2, 6.2, 1.6, 1, '#b5b1aa'); // cut blocks
      r(6.2, 6.1, 1.6, 1.1, '#b5b1aa');
      r(5.4, 0.6, 1.8, 1.4, '#a09d98');
      r(2, 1, 2.4, 0.4, '#d6dbe2'); // pick
      r(3, 1, 0.3, 1.8, '#9a6a34');
      r(0.6, 0, 0.3, 1.2, '#6b4a2a');
      r(0.9, 0, 0.8, 0.5, roof);
    },
  },
  storehouse: {
    dot: '#a77b47',
    draw(r, roof) {
      r(0, 6.5, 8, 0.5, '#7c766c'); // footing
      r(0, 2.6, 8, 4, '#a77b47'); // plank barn
      r(0, 3.6, 8, 0.25, '#86602f');
      r(0, 4.8, 8, 0.25, '#86602f');
      r(2.5, 3.8, 3, 2.8, '#5a3d22'); // big door with a cross brace
      r(2.5, 5, 3, 0.3, '#a77b47');
      r(3.85, 3.8, 0.3, 2.8, '#a77b47');
      r(6.2, 5.6, 1.2, 1, '#c39a5e'); // crate and sack
      r(0.6, 5.7, 1, 0.9, '#d9c9a3');
      gable(r, roof, -0.6, 2.8, -0.3, 8.3);
    },
  },
  market: {
    dot: '#c9a06a',
    draw(r, roof) {
      r(0.5, 3, 7, 4, '#c9a06a');
      r(1, 1.5, 6, 1.5, roof);
    },
  },
  workshop: {
    dot: '#8a6a4a',
    draw(r, _roof) {
      r(0.5, 3, 7, 4, '#8a6a4a');
      r(3, 1, 2, 2, '#5a3a2a');
    },
  },
  mill: {
    dot: '#a08060',
    draw(r, _roof) {
      r(1, 2.5, 6, 4.5, '#a08060');
      r(3, 0.5, 2, 2, '#6a5030');
    },
  },
  library: {
    dot: '#8a7a6a',
    draw(r, roof) {
      r(1, 2.5, 6, 4.5, '#c0b090');
      r(1.5, 1, 5, 1.5, roof);
    },
  },
  barracks: {
    dot: '#6a5a4a',
    draw(r, roof) {
      r(0.5, 2, 7, 5, '#7a6a5a');
      r(2, 0.5, 4, 1.5, roof);
    },
  },
};

/** Building style of a settlement's species (human style for any species without one). */
export function architectureOf(species: number): Architecture {
  return SPECIES[species]?.civ?.architecture ?? 'human';
}

/**
 * Shipyard (shared look): a plank dock on posts, a boat hull on its slipway with ribs showing, a crane with a hanging
 * load, and a mooring post with a pennant in the settlement colour.
 */
function drawShipyard(r: Rect, roof: string): void {
  r(0, 5.6, 8, 0.8, '#8a6a42'); // dock planks
  for (const x of [0.4, 3.6, 6.8]) r(x, 6.4, 0.5, 1.4, '#5a3d22'); // posts
  r(1, 3.4, 5, 1.8, '#7a4f25'); // hull
  r(1.6, 5.2, 3.8, 0.5, '#5a3d22');
  for (const x of [1.8, 3, 4.2]) r(x, 3.4, 0.3, 1.8, '#c39a5e'); // ribs
  r(0.4, 3, 0.4, 1, '#7a4f25'); // bow
  r(6.6, 0, 0.4, 5.6, '#6b4a2a'); // crane mast and arm
  r(4.6, 0, 2.4, 0.4, '#6b4a2a');
  r(4.8, 0.4, 0.15, 1.6, '#d6dbe2'); // rope and load
  r(4.4, 2, 0.9, 0.7, '#a77b47');
  r(7.2, 4.4, 0.4, 1.2, '#5a3d22'); // mooring post
  r(7.6, 4.4, 0.6, 0.4, roof);
}

/** Draws any building: houses in the people's style and level, workplaces in the shared style. */
export function drawBuildingArt(r: Rect, arch: Architecture, type: BuildingType, level: number, roof: string): void {
  if (type === 'house') HOUSE_STYLES[arch].draw(r, level, roof);
  else if (type === 'shipyard') drawShipyard(r, roof);
  else if (type === 'townhall') {
    r(0.5, 1.5, 7, 5.5, '#b0a080');
    r(2, 0, 4, 1.5, '#d0c0a0');
  }
  else if (type === 'bridge') {
    r(0, 2, 8, 4, '#6a5a4a');
    for (let i = 0; i < 3; i++) r(0.4, 2.4 + i * 1.2, 7.2, 0.6, '#8a6a4a');
    r(0, 1.6, 0.6, 4.8, '#5a3a2a');
    r(7.4, 1.6, 0.6, 4.8, '#5a3a2a');
  }
  else if (type === 'market') {
    r(0.5, 3, 7, 4, '#c9a06a');
    r(1, 1.5, 6, 1.5, '#e8d4a0'); // canopy
  }
  else if (type === 'temple') {
    r(1.5, 2, 5, 5, '#d4c4a0');
    r(3, 0.5, 2, 1.5, '#f0e6c0'); // roof peak
  }
  else if (type === 'workshop') {
    r(0.5, 3, 7, 4, '#8a6a4a');
    r(3, 1, 2, 2, '#5a3a2a'); // chimney
  }
  else if (type === 'tower') {
    r(2.5, 1, 3, 6, '#7a6a5a');
    r(2, 0.2, 4, 1, '#5a4a3a');
  }
  else if (type === 'mill') {
    r(1, 2.5, 6, 4.5, '#a08060');
    r(3, 0.5, 2, 2, '#6a5030'); // post
  }
  else if (type in WORKPLACES) WORKPLACES[type as Workplace].draw(r, roof);
}

/** Far-away colour of a building. */
export function buildingDot(arch: Architecture, type: BuildingType, level: number): string {
  if (type === 'shipyard') return '#6b8fb3';
  if (type === 'bridge') return '#8a6a4a';
  if (type === 'market') return '#c9a06a';
  if (type === 'temple') return '#d4c4a0';
  if (type === 'tower') return '#7a6a5a';
  if (type === 'townhall') return '#b0a080';
  if (type === 'library') return '#8a7a6a';
  if (type === 'barracks') return '#6a5a4a';
  return type === 'house' ? HOUSE_STYLES[arch].dots[Math.max(1, Math.min(4, level))] : WORKPLACES[type].dot;
}

const boundsCache = new Map<string, { x0: number; y0: number; x1: number; y1: number }>();

/** Grid-unit bounds of a building's art (x 0..8 on its tile, y up to -8 above it, ground at 8). */
export function buildingArtBounds(arch: Architecture, type: BuildingType, level: number): { x0: number; y0: number; x1: number; y1: number } {
  const key = `${arch}|${type}|${level}`;
  let b = boundsCache.get(key);
  if (!b) {
    const r = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    drawBuildingArt((x, y, w, h) => {
      r.x0 = Math.min(r.x0, x);
      r.y0 = Math.min(r.y0, y);
      r.x1 = Math.max(r.x1, x + w);
      r.y1 = Math.max(r.y1, y + h);
    }, arch, type, level, '#808080');
    b = r;
    boundsCache.set(key, b);
  }
  return b;
}

/**
 * The world rectangle (tiles) a building's drawn art covers at BUILDING_SCALE: used for hit testing and to check
 * that buildings do not overlap. `bx, by` is the building's tile.
 */
export function buildingRect(bx: number, by: number, arch: Architecture, type: BuildingType, level: number): { x0: number; y0: number; x1: number; y1: number } {
  const a = buildingArtBounds(arch, type, level);
  const k = BUILDING_SCALE / 8; // tiles per grid unit
  const left = bx + 0.5 - BUILDING_SCALE / 2;
  const top = by + 1 - BUILDING_SCALE; // the scaled tile's top; art y 0..8 maps onto it, negative y rises above
  return { x0: left + Math.max(0, a.x0) * k, y0: top + a.y0 * k, x1: left + Math.min(8, a.x1) * k, y1: top + Math.min(8, a.y1) * k };
}
