/**
 * Settlement landmarks (0.22): the main building at a settlement's centre, drawn instead of the old diamond marker.
 * It is not a building record: it has no housing, no production and no save data. Its look follows the
 * settlement's people (architecture) and stage, so it changes in place when a camp becomes a village or a town.
 *
 * Like architecture.ts, the art is a list of rectangles in grid units (8 units = one tile), relative to the top-left
 * corner of the centre tile. The centre tile and its eight neighbours are always kept free of buildings (civ.ts
 * layout), so a landmark spans those three columns (x -8..16) and stands on the row below the centre (ground at
 * y 15); taller parts rise above, up to y -20. The renderer outlines, shadows and caches it per zoom.
 */
import type { Stage } from '../sim/civ';
import type { Architecture } from '../sim/creatures';
import { BUILDING_SCALE, architectureOf, shade, type Rect } from './architecture';

/** Bounds every landmark stays within (grid units, relative to the centre tile's top-left corner). */
export const LANDMARK_BOUNDS = { x0: -8, y0: -20, x1: 16, y1: 16 } as const;

const DOOR = '#3b2817';
const DARK = '#24180e';
const LIT = '#ffd98a';
const GLASS = '#5b86b8';
const LEAF_LIT = '#c8f5a8';
const TIMBER = '#5e3f1e';
const POLE = '#6b4a2a';
const EARTH = '#a88a5c';

/** A trapezoid roof, row by row from `top` to `eave`, narrower at the top; the eave row darker. */
function hipRoof(r: Rect, roof: string, top: number, eave: number, x0: number, x1: number, inset: number): void {
  const rows = Math.max(2, Math.round(eave - top));
  const h = (eave - top) / rows;
  for (let k = 0; k < rows; k++) {
    const t = rows === 1 ? 0 : (rows - 1 - k) / (rows - 1);
    const i = t * inset;
    const c = k === rows - 1 ? shade(roof, -0.32) : k % 2 ? shade(roof, -0.12) : roof;
    r(x0 + i, top + k * h, x1 - x0 - 2 * i, h + 0.05, c);
    r(x0 + i, top + k * h, 0.6, h + 0.05, shade(roof, 0.18)); // lit left end (light from the north-west)
  }
}

/** A gathering place in front of the building: packed earth with a hearth (stones and a fire). */
function hearth(r: Rect, cx: number, cy: number): void {
  r(-5, 13, 18, 2.6, EARTH);
  r(-4, 13.4, 16, 1.8, '#b89a68');
  r(cx - 1.2, cy - 0.4, 2.4, 1.6, '#7d7a72'); // ring of stones
  r(cx - 0.7, cy - 0.1, 1.4, 1, '#3a2a1a');
  r(cx - 0.5, cy - 1.2, 1, 1.3, '#f08a2c'); // fire
  r(cx - 0.25, cy - 1.7, 0.5, 0.8, '#ffd45a');
}

// ---- humans ------------------------------------------------------------------------------------------------------

/** Camp: a large communal tent of hides on crossed poles, a gathering place with a hearth and log seats, a banner. */
function humanCamp(r: Rect, roof: string): void {
  hearth(r, 4, 14.2);
  r(-3.4, 14.2, 3, 0.8, '#7a5430'); // log seats
  r(8.4, 14.2, 3, 0.8, '#7a5430');
  r(2.6, -2, 0.7, 3.4, POLE); // crossed poles above the smoke hole
  r(4.7, -2, 0.7, 3.4, POLE);
  r(3.1, 0.6, 1.8, 0.5, '#4a321c');
  for (let y = 1; y < 12; y++) {
    const half = 1.2 + (y - 1) * 0.72;
    const band = y % 3 === 0;
    r(4 - half, y, half, 1.05, band ? '#b8956a' : '#d2b282'); // lit side of the hides
    r(4, y, half, 1.05, band ? '#9c7a52' : '#b8956a'); // shaded side
  }
  r(-2.2, 8, 12.4, 0.6, roof); // painted band in the settlement colour
  r(-0.6, 7.2, 1.4, 1, '#a07f55'); // patches
  r(8.2, 9.4, 1.6, 1, '#8c6c46');
  for (let y = 6.5; y < 12; y += 1) {
    const half = 0.4 + (y - 6.5) * 0.3;
    r(4 - half, y, 2 * half, 1.05, DARK); // the entrance
  }
  r(-4.8, 11.6, 0.6, 1.2, POLE); // stakes
  r(12.2, 11.6, 0.6, 1.2, POLE);
  r(13.6, -3, 0.5, 15, POLE); // banner pole
  r(14.1, -3, 1.9, 1.6, roof);
  r(14.1, -1.4, 1.6, 0.6, shade(roof, -0.25));
}

/** Village: a long timber-framed communal hall with a hipped roof, a front gable over a double door, lit windows. */
function humanVillage(r: Rect, roof: string): void {
  hearth(r, 12.5, 14.4);
  r(-6.4, 13, 20.8, 1.4, '#7c766c'); // stone footing
  r(-6, 4, 20, 9.2, '#c49a5c'); // walls (plaster between timbers)
  for (const x of [-6, -1.6, 3, 5, 9.6, 13.4]) r(x, 4, 0.6, 9.2, TIMBER); // posts
  r(-6, 4, 20, 0.6, TIMBER); // beams
  r(-6, 8.6, 20, 0.5, TIMBER);
  for (const x0 of [-5.4, 9.6]) {
    for (let k = 0; k < 4; k++) r(x0 + k * 0.95, 8.4 - k * 1.05, 0.95, 0.5, TIMBER); // braces
    r(x0 + 0.6, 9.8, 2.4, 1.8, LIT); // lower windows with shutters
    r(x0 + 0.6, 9.8, 2.4, 0.3, DOOR);
  }
  r(-0.4, 5.4, 1.6, 1.8, LIT); // upper windows
  r(7, 5.4, 1.6, 1.8, LIT);
  hipRoof(r, roof, -5, 4, -7.6, 15.6, 6.4);
  r(0.6, -6, 6.8, 1, shade(roof, -0.2)); // ridge
  r(1, -7.6, 0.5, 1.8, TIMBER); // crossed gable horns at both ends of the ridge
  r(6.5, -7.6, 0.5, 1.8, TIMBER);
  // Front gable over the entrance, with a carved board and a porch.
  for (let k = 0; k < 6; k++) r(4 - 1 - k * 0.75, -1 + k, 2 + k * 1.5, 1.05, k === 5 ? shade(roof, -0.3) : k % 2 ? shade(roof, -0.1) : roof);
  r(2.6, 1.6, 2.8, 2.4, '#d9b880');
  r(3.6, 2, 0.8, 0.8, LIT);
  r(1.6, 8.8, 4.8, 4.4, DOOR); // double door under an arch of timber
  r(3.85, 8.8, 0.3, 4.4, '#5a3c20');
  r(1.4, 8.4, 5.2, 0.6, TIMBER);
  r(0.4, 7.2, 0.6, 6, POLE); // porch posts and awning
  r(7, 7.2, 0.6, 6, POLE);
  r(0, 6.6, 8, 0.8, shade(roof, -0.15));
  r(3, 13.2, 2, 0.8, '#9c958a'); // step
}

/** Town: a stone town hall with wings, an arched entrance, banners, and a clock tower with a pointed roof. */
function humanTown(r: Rect, roof: string): void {
  const STONE = '#d8d0bf';
  const MORTAR = '#b3aa98';
  r(-7, 13, 22, 1.6, '#9c958a'); // plinth
  r(1, 14.2, 6, 1.2, '#b9b2a2'); // steps
  r(-6.6, 3, 21.2, 10.2, STONE); // two storeys of dressed stone
  for (const y of [5, 7.4, 9.8, 12.2]) r(-6.6, y, 21.2, 0.3, MORTAR);
  for (const [y, xs] of [[5.3, [-4, 1, 6, 11]], [7.7, [-1.5, 3.5, 8.5, 13.5]], [10.1, [-4, 11]]] as const) {
    for (const x of xs) r(x, y, 0.3, 2.1, MORTAR);
  }
  r(-6.6, 8, 21.2, 0.6, '#c2b9a6'); // string course
  for (const x of [-5.2, -2.2, 8.4, 11.4]) {
    r(x, 4.4, 1.6, 2.6, GLASS); // tall upper windows with lit lower panes
    r(x, 5.8, 1.6, 1.2, LIT);
    r(x - 0.2, 4.1, 2, 0.4, MORTAR);
    r(x, 9.4, 1.6, 2.2, LIT); // ground-floor windows
  }
  r(1.6, 8.6, 4.8, 4.6, '#c2b9a6'); // arched entrance
  r(2.2, 9.4, 3.6, 3.8, DOOR);
  r(2.6, 9, 2.8, 0.6, DOOR);
  r(3.85, 9.6, 0.3, 3.6, '#5a3c20');
  for (const x of [0.2, 7]) {
    r(x, 3.6, 0.8, 4.4, roof); // banners in the settlement colour
    r(x + 0.2, 8, 0.4, 0.6, shade(roof, -0.3));
  }
  hipRoof(r, roof, -1, 3.2, -7.8, 15.8, 4); // wing roofs
  r(-7.8, 3, 23.6, 0.4, shade(roof, -0.4));
  // The tower: stone shaft with a clock and a belfry, a pointed roof with a finial and a pennant.
  r(0.8, -12, 6.4, 15, STONE);
  r(0.8, -12, 1, 15, '#e4ddcf'); // lit edge
  r(6.4, -12, 0.8, 15, '#bfb6a3'); // shaded edge
  for (const y of [-9, -5, -1]) r(0.8, y, 6.4, 0.3, MORTAR);
  r(2.4, -4, 3.2, 3.2, '#efe6cf'); // clock face
  r(3.85, -3.6, 0.3, 1.6, DARK);
  r(3.85, -2.3, 1.2, 0.3, DARK);
  r(2.2, -10.6, 1.2, 2.4, DARK); // belfry openings
  r(4.6, -10.6, 1.2, 2.4, DARK);
  r(0.4, -12.6, 7.2, 0.8, MORTAR); // cornice
  for (let k = 0; k < 6; k++) {
    const half = 0.5 + k * 0.62;
    r(4 - half, -18.6 + k * 1.05, 2 * half, 1.1, k % 2 ? shade(roof, -0.15) : roof);
  }
  r(3.75, -20, 0.5, 1.6, '#d4b13c'); // finial
  r(4.25, -20, 1.8, 0.8, roof);
}

// ---- elves -------------------------------------------------------------------------------------------------------

/** Camp: two living trees whose boughs are woven into one arched leaf roof over an open hall, a ring of moss stones. */
function elvenCamp(r: Rect, roof: string): void {
  r(-4, 13, 16, 2.6, '#6f8a4a'); // mossy ground
  for (const [x, y] of [[-2.6, 13.6], [0.4, 14.6], [7, 14.6], [9.8, 13.6]]) r(x, y, 1.4, 0.9, '#b7c2a8'); // ring of pale stones
  r(3.2, 13.4, 1.6, 1.2, '#8fd36e'); // glowing moss at the heart
  r(3.6, 13.1, 0.8, 0.5, LEAF_LIT);
  for (const x of [-5.4, 11.4]) {
    r(x, 1, 2, 13, '#6b4a2a'); // living trunks
    r(x + 0.5, 2, 0.4, 11, '#8a6a42');
    r(x - 0.6, 13.2, 3.2, 0.8, '#5a3d22'); // roots
  }
  r(-3.4, 2.6, 2.2, 0.6, '#6b4a2a'); // boughs bending inward
  r(9.2, 2.6, 2.2, 0.6, '#6b4a2a');
  // Arched roof of leaves: a rounded mass, darker underneath, with a pale highlight and drooping leaf tips.
  const rows: Array<[number, number, string]> = [[-6, 6, '#78c25c'], [-5, 9, '#6ab858'], [-4, 12, '#5fb865'], [-3, 14, '#4fa458'], [-2, 15.6, '#4fa458'], [-1, 16.8, '#3f8f4a'], [0, 17.6, '#3f8f4a'], [1, 18, '#356f3c'], [2, 18, '#2c5f33']];
  for (const [y, w, c] of rows) r(4 - w / 2, y, w, 1.05, c);
  for (const x of [-4.6, -2, 7.6, 10.4]) r(x, 3, 0.8, 1.6, '#3f8f4a'); // drooping tips
  r(-1, -4.4, 3, 0.6, LEAF_LIT);
  r(4.4, -3.2, 2, 0.5, LEAF_LIT);
  r(-3.4, 5, 14.8, 8, '#2a3a22'); // shade under the arch (the open hall)
  r(-2.4, 3.6, 12.8, 1.4, '#2a3a22');
  r(-0.6, 3, 9.2, 0.8, '#1f2c19');
  for (const x of [0.6, 6]) {
    r(x, 3.6, 1.4, 3, roof); // pennants in the settlement colour hanging from the arch
    r(x + 0.35, 6.6, 0.7, 0.8, roof);
    r(x, 3.6, 1.4, 0.4, shade(roof, 0.3));
  }
  r(-1.6, 9.4, 1.2, 3.6, '#a88a5c'); // low benches of pale wood
  r(8.4, 9.4, 1.2, 3.6, '#a88a5c');
  r(-2.8, 5, 0.8, 0.8, LEAF_LIT); // lanterns in the boughs
  r(10, 5, 0.8, 0.8, LEAF_LIT);
}

/** Village: a rounded hall of pale wood held by branches, a crescent roof of long leaves, a tree growing through it. */
function elvenVillage(r: Rect, roof: string): void {
  r(-4, 13.6, 16, 1.8, '#bfb08c'); // terrace of pale stone
  r(-6.6, 9, 1.4, 5, '#6b4a2a'); // branches holding the hall
  r(13.2, 9, 1.4, 5, '#6b4a2a');
  r(-5.6, 8, 1.4, 1.4, '#6b4a2a');
  r(12.2, 8, 1.4, 1.4, '#6b4a2a');
  const WALL = '#e2d6b8';
  r(-4.6, 5, 17.2, 8.8, WALL); // rounded hall
  r(-5.4, 6.4, 0.8, 6, WALL);
  r(12.6, 6.4, 0.8, 6, WALL);
  r(-4.6, 8.6, 17.2, 0.4, '#c8b994');
  r(-4.6, 11.6, 17.2, 0.4, '#c8b994');
  r(-4.6, 5, 17.2, 0.6, roof); // band in the settlement colour
  for (const x of [-2.6, 0.6, 7.4, 10.6]) {
    r(x, 6.4, 1.4, 1.6, LEAF_LIT); // round windows
    r(x + 0.3, 6.1, 0.8, 0.3, LEAF_LIT);
  }
  r(2.4, 8, 3.2, 5.8, '#2b2015'); // tall arched door
  r(2.9, 7.4, 2.2, 0.6, '#2b2015');
  r(3.4, 6.9, 1.2, 0.5, '#2b2015');
  r(3.85, 8.4, 0.3, 5.4, '#4a3a26');
  // Crescent roof: long leaf blades, the ends curling up into points.
  const rows: Array<[number, number, string]> = [[0, 15, '#5fb865'], [1, 18, '#4fa458'], [2, 20, '#4fa458'], [3, 21, '#3f8f4a'], [4, 22, '#356f3c']];
  for (const [y, w, c] of rows) r(4 - w / 2, y, w, 1.05, c);
  for (const [x, y, c] of [[-7.6, 2, '#4fa458'], [-8, 1, '#5fb865'], [-8, 0, '#78c25c'], [14.6, 2, '#4fa458'], [15, 1, '#5fb865'], [15, 0, '#78c25c']] as const) r(x, y, 1, 1.05, c);
  for (const x of [-2, 2, 6, 10]) r(x, 0.6, 0.3, 3.6, '#2f6f38'); // leaf veins
  r(-1.5, 0.2, 3, 0.5, LEAF_LIT);
  // A living tree growing up through the roof.
  r(3, -9, 2, 9.4, '#6b4a2a');
  r(3.5, -8, 0.4, 7.6, '#8a6a42');
  r(5, -6, 2.4, 0.6, '#6b4a2a');
  r(0.8, -7.4, 2.2, 0.6, '#6b4a2a');
  const crown: Array<[number, number, number, string]> = [[-14, 3, 3, '#78c25c'], [-13, 1.4, 6.2, '#6ab858'], [-12, 0.4, 7.2, '#5fb865'], [-11, 0, 8, '#4fa458'], [-10, 0.6, 6.8, '#3f8f4a']];
  for (const [y, x, w, c] of crown) r(x, y, w, 1.05, c);
  r(6.4, -7.8, 2.4, 1.6, '#4fa458');
  r(-0.4, -8.6, 2.2, 1.4, '#4fa458');
  r(2, -13.4, 1.4, 0.6, LEAF_LIT);
}

/** Town: a terraced civic hall of white wood, curved leaf-roofed wings, and a slender spire of stacked leaf tiers. */
function elvenTown(r: Rect, roof: string): void {
  const WOOD = '#ece3c8';
  const EDGE = '#c8b994';
  r(-7, 13.2, 22, 1.4, '#bfb08c'); // terrace
  r(-6, 12.4, 20, 0.8, '#d4c6a4');
  r(2.4, 14.6, 3.2, 1, '#d4c6a4'); // steps
  for (const x of [-6, 9]) {
    r(x, 4.8, 5, 7.6, WOOD); // wings
    r(x, 4.8, 0.6, 7.6, '#f6efdb');
    for (const wx of [x + 1, x + 3]) {
      r(wx, 6.2, 1, 3.6, LEAF_LIT); // tall narrow pointed windows
      r(wx + 0.25, 5.7, 0.5, 0.5, LEAF_LIT);
    }
    r(x, 10.6, 5, 0.4, EDGE);
    r(x - 0.8, 3.8, 6.6, 1.1, '#3f8f4a'); // curved leaf roofs with upturned tips
    r(x - 0.2, 2.9, 5.4, 1, '#4fa458');
    r(x + 0.8, 2.1, 3.4, 0.9, '#5fb865');
    r(x - 1.4, 3, 0.8, 0.9, '#5fb865');
    r(x + 5.8, 3, 0.8, 0.9, '#5fb865');
  }
  // The central hall rises into a slender spire.
  r(0.4, -2, 7.2, 14.4, WOOD);
  r(0.4, -2, 0.8, 14.4, '#f6efdb');
  r(6.8, -2, 0.8, 14.4, '#d9ceb0');
  r(0.4, 2.4, 7.2, 0.6, roof); // bands in the settlement colour
  r(0.4, -2, 7.2, 0.5, roof);
  r(2.6, 7, 2.8, 5.4, '#2b2015'); // tall arched door
  r(3.1, 6.4, 1.8, 0.6, '#2b2015');
  r(3.6, 5.9, 0.8, 0.5, '#2b2015');
  r(3.4, 3.6, 1.2, 1.8, LEAF_LIT); // round window over the door
  r(1.4, -1, 1, 3, LEAF_LIT);
  r(5.6, -1, 1, 3, LEAF_LIT);
  // Leaf tiers, each narrower, with drooping tips; a thin spire between them; a glowing leaf at the top.
  const tiers: Array<[number, number]> = [[-3, 9.6], [-7.4, 7.4], [-11.6, 5.4], [-15.4, 3.6]];
  for (const [y, w] of tiers) {
    r(4 - w / 2, y, w, 1.2, '#3f8f4a');
    r(4 - w / 2 + 0.6, y - 0.9, w - 1.2, 1, '#4fa458');
    r(4 - w / 2 + 1.4, y - 1.6, Math.max(0.6, w - 2.8), 0.8, '#5fb865');
    r(4 - w / 2 - 0.5, y + 0.6, 0.6, 0.9, '#3f8f4a');
    r(4 + w / 2 - 0.1, y + 0.6, 0.6, 0.9, '#3f8f4a');
  }
  for (const y0 of [-6.2, -10.4, -14.2]) r(3.2, y0, 1.6, 2.6, WOOD); // spire between the tiers
  r(3.85, -19.4, 0.3, 2.8, '#d9ceb0');
  r(3.4, -20, 1.2, 1, LEAF_LIT);
  r(4.15, -18.8, 1.8, 0.6, roof); // pennant
}

const ART: Readonly<Record<Architecture, Readonly<Record<Stage, (r: Rect, roof: string) => void>>>> = {
  human: { camp: humanCamp, village: humanVillage, town: humanTown },
  elven: { camp: elvenCamp, village: elvenVillage, town: elvenTown },
};

/** Draws the landmark of a people at a stage; `roof` is the settlement colour. */
export function drawLandmark(r: Rect, arch: Architecture, stage: Stage, roof: string): void {
  ART[arch][stage](r, roof);
}

const rectCache = new Map<string, Float32Array>();

/** The landmark's rectangles (x, y, w, h, …), computed once per look: the visible footprint used for hit testing. */
export function landmarkRects(arch: Architecture, stage: Stage): Float32Array {
  const key = `${arch}|${stage}`;
  let a = rectCache.get(key);
  if (!a) {
    const out: number[] = [];
    drawLandmark((x, y, w, h) => out.push(x, y, w, h), arch, stage, '#808080');
    a = Float32Array.from(out);
    rectCache.set(key, a);
  }
  return a;
}

/** Topmost grid row of a landmark (for placing the settlement's name above it). */
export function landmarkTop(arch: Architecture, stage: Stage): number {
  const a = landmarkRects(arch, stage);
  let top = 0;
  for (let k = 1; k < a.length; k += 4) top = Math.min(top, a[k]);
  return top;
}

/** Landmarks are drawn this much larger than their 3-tile grid at normal and close zoom (0.23, with 2× houses). */
export const LANDMARK_BASE_SCALE = 1.5;

/**
 * The scale a landmark would like: LANDMARK_BASE_SCALE, or more far away (as if a tile were at least 6 CSS pixels)
 * so it stays readable. Where it is actually drawn, `landmarkScaleFor` limits this to the settlement's free centre.
 */
export function landmarkScale(zoom: number): number {
  return Math.max(LANDMARK_BASE_SCALE, 6 / zoom);
}

/**
 * Below this zoom (CSS px per tile) creatures are drawn as dots and a landmark becomes an icon: it may grow past the
 * free centre, it is drawn over the creature dots, the settlement's buildings under it are drawn again on top, and a
 * few of its residents (`shownResidents`) are drawn over it. A tap on the icon picks it unless it hits one of those.
 */
export const LANDMARK_OVER_DOTS_BELOW = 3;

/** What a landmark needs to know about its settlement. */
export interface LandmarkOwner {
  x: number;
  y: number;
  species: number;
  members?: readonly number[];
  civ?: { stage: Stage; buildings: ReadonlyArray<{ x: number; y: number }> };
}

/** Half the landmark's width in tiles at scale 1 (it spans the three centre columns). */
const HALF_SPAN = (LANDMARK_BOUNDS.x1 - LANDMARK_BOUNDS.x0) / 16;

/**
 * The scale a landmark is drawn and hit-tested at. From zoom 3 up it never grows into the drawing of the nearest
 * building (buildings are drawn BUILDING_SCALE tiles wide, centred on their tile): its sides and base stop where that
 * building's art begins. The layout keeps the 5×5 centre free, which leaves room for about 1.33×. It never drops
 * below MIN_LANDMARK_SCALE (old worlds may have buildings closer to the centre). Further out it is an icon at the
 * full `landmarkScale`.
 */
export function landmarkScaleFor(st: LandmarkOwner, zoom: number): number {
  const want = landmarkScale(zoom);
  if (zoom < LANDMARK_OVER_DOTS_BELOW) return want;
  let near = Infinity; // Chebyshev distance (tiles) of the nearest building
  for (const b of st.civ?.buildings ?? []) near = Math.min(near, Math.max(Math.abs(b.x - st.x), Math.abs(b.y - st.y)));
  return Math.max(MIN_LANDMARK_SCALE, Math.min(want, (near - BUILDING_SCALE / 2) / HALF_SPAN));
}

/** Smallest landmark scale (it stays at least as large as at 0.22, when houses were one tile wide, but a bit less). */
export const MIN_LANDMARK_SCALE = 0.8;

/** World y (tiles) of the landmark's ground line (its front wall's base) at this zoom. */
export function landmarkGround(st: LandmarkOwner, zoom: number): number {
  return st.y + 0.5 + ((15 - 4) * landmarkScaleFor(st, zoom)) / 8;
}

/** The world rectangle (tiles) the landmark's art box covers at this zoom. */
export function landmarkBox(st: LandmarkOwner, zoom: number): { x0: number; y0: number; x1: number; y1: number } {
  const k = landmarkScaleFor(st, zoom);
  const B = LANDMARK_BOUNDS;
  const cx = st.x + 0.5;
  const cy = st.y + 0.5;
  return { x0: cx + ((B.x0 - 4) * k) / 8, y0: cy + ((B.y0 - 4) * k) / 8, x1: cx + ((B.x1 - 4) * k) / 8, y1: cy + ((B.y1 - 4) * k) / 8 };
}

/**
 * Whether the world point (wx, wy) lies on the visible landmark of a settlement at this zoom (CSS pixels per tile).
 * `tol` widens each rectangle by that many grid units, so thin parts (poles, spires) can still be tapped.
 */
export function hitsLandmark(st: LandmarkOwner, wx: number, wy: number, zoom: number, tol = 0.5): boolean {
  if (!st.civ) return false;
  const k = landmarkScaleFor(st, zoom);
  // Grid units relative to the centre tile's top-left, undoing the scale about the tile centre (4, 4).
  const ux = ((wx - st.x - 0.5) * 8) / k + 4;
  const uy = ((wy - st.y - 0.5) * 8) / k + 4;
  const B = LANDMARK_BOUNDS;
  if (ux < B.x0 - tol || ux > B.x1 + tol || uy < B.y0 - tol || uy > B.y1 + tol) return false;
  const a = landmarkRects(architectureOf(st.species), st.civ.stage);
  for (let i = 0; i < a.length; i += 4) {
    if (ux >= a[i] - tol && ux <= a[i] + a[i + 2] + tol && uy >= a[i + 1] - tol && uy <= a[i + 1] + a[i + 3] + tol) return true;
  }
  return false;
}

/**
 * Where fire on tile (x, y) stands relative to a settlement's landmark: 'front' (on its ground row, in front of the
 * walls: drawn after the landmark), 'behind' (covered by the building further back: hidden behind the walls, shown as
 * glow and smoke), 'icon' (covered by a far-away icon: drawn over it as a marker), or null (not covered).
 */
export function landmarkFireSide(st: LandmarkOwner, x: number, y: number, zoom: number): 'front' | 'behind' | 'icon' | null {
  if (!st.civ) return null;
  const box = landmarkBox(st, zoom);
  if (x + 1 <= box.x0 || x >= box.x1 || y + 1 <= box.y0 || y >= box.y1) return null;
  if (zoom < LANDMARK_OVER_DOTS_BELOW) return hitsLandmark(st, x + 0.5, y + 0.5, zoom, 0) ? 'icon' : null;
  const uy = ((y - st.y) * 8) / landmarkScaleFor(st, zoom) + 4; // tile centre in the landmark's grid units
  if (uy >= 12) return 'front';
  return hitsLandmark(st, x + 0.5, y + 0.5, zoom, 0) ? 'behind' : null;
}

/** At most this many residents are drawn over a landmark icon. */
export const SHOWN_RESIDENTS = 3;

/**
 * Far away (icon mode): the residents of the settlement drawn again over its landmark icon, so the settlement does
 * not look empty: up to SHOWN_RESIDENTS members standing on the icon, those nearest its front (largest y) first.
 * These are the existing creatures at their own positions, not new ones. Empty at other zooms.
 */
export function shownResidents(st: LandmarkOwner, creatures: { x: ArrayLike<number>; y: ArrayLike<number>; indexOf(id: number): number }, zoom: number): number[] {
  if (!st.civ || !st.members?.length || zoom >= LANDMARK_OVER_DOTS_BELOW) return [];
  const box = landmarkBox(st, zoom);
  const on: number[] = [];
  for (const id of st.members) {
    const i = creatures.indexOf(id);
    if (i < 0) continue;
    const x = creatures.x[i];
    const y = creatures.y[i];
    if (x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1) on.push(i);
  }
  on.sort((a, b) => creatures.y[b] - creatures.y[a] || a - b);
  return on.slice(0, SHOWN_RESIDENTS);
}
