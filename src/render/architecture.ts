/**
 * Architecture of the peoples: how each people's houses look at each level (1–4). Only the look differs; the rules
 * (costs, capacity, upgrades, builders) are shared and live in sim/civ.ts. A people picks its style through
 * `CivProfile.architecture`; a new people needs one more entry here. No DOM: the art is a list of rectangles on the
 * 8×8 building grid, so it can be tested and drawn by any renderer. Higher levels may rise above their tile (negative y).
 */
import type { Architecture } from '../sim/creatures';

/** Draws a rectangle in grid units (x, y, width, height, colour). */
export type Rect = (x: number, y: number, w: number, h: number, c: string) => void;

export interface HouseStyle {
  /** Colour of a house far away, by level (index 1..4). */
  dots: readonly string[];
  /** Draws a house of the level; `roof` is the settlement colour. */
  draw(r: Rect, level: number, roof: string): void;
}

/**
 * Human houses: 1 thatched hut, 2 timber house with a coloured roof, 3 stone base with a timber upper floor,
 * 4 two-storey pale stone town house with windows and a chimney.
 */
function drawHumanHouse(r: Rect, level: number, roof: string): void {
  switch (level) {
    case 1:
      r(2, 2, 4, 1, '#d9b765'); // thatch, stepped like a cone
      r(1, 3, 6, 2, '#c4a052');
      r(0, 5, 8, 2, '#a98a45');
      r(3, 5, 2, 2, '#3b2817');
      r(4, 1, 1, 1, roof); // a small pennant in the settlement colour
      break;
    case 2:
      r(1, 3, 6, 4, '#a8783e'); // log walls
      r(1, 4, 6, 0.5, '#7c5428');
      r(1, 5.5, 6, 0.5, '#7c5428');
      r(0, 1, 8, 2, roof);
      r(1, 0, 6, 1, roof);
      r(3, 5, 2, 2, '#3b2817');
      r(5.5, 3.5, 1, 1, '#ffd98a'); // lit window
      break;
    case 3:
      r(0, 3, 8, 4, '#8f8b84'); // stone ground floor
      r(1, 4, 2, 0.5, '#6f6b65');
      r(5, 5, 2, 0.5, '#6f6b65');
      r(1, 0, 6, 3, '#a8783e'); // timber upper floor
      r(1, 1.2, 6, 0.4, '#5e3f1e');
      r(0, -2, 8, 2, roof);
      r(2, -3, 4, 1, roof);
      r(3, 5, 2, 2, '#3b2817');
      r(2, 0.8, 1, 1, '#ffd98a');
      r(5, 0.8, 1, 1, '#ffd98a');
      break;
    default:
      r(0, -2, 8, 9, '#e1dbcd'); // two storeys of pale stone
      r(0, 2.5, 8, 0.5, '#b9b2a2');
      r(0, -4, 8, 2, roof);
      r(1, -5, 6, 1, roof);
      r(6, -6, 1, 2, '#6d5d4f'); // chimney
      for (const x of [1, 3.5, 6]) {
        r(x, -1, 1, 1.5, '#5b86b8');
        r(x, 3.5, 1, 1.5, '#5b86b8');
      }
      r(3.5, 5, 1.5, 2, '#3b2817');
  }
}

/**
 * Elven houses: living wood and leaves instead of thatch and stone. 1 a leaf-covered dome shelter, 2 a round wooden
 * dwelling under a rounded leaf roof with a green-lit window, 3 a house on a platform in a tree under a wide canopy,
 * 4 a tall pale-wood spire hall with leaf wings and lit windows. The settlement colour shows in a pennant or band.
 */
function drawElvenHouse(r: Rect, level: number, roof: string): void {
  switch (level) {
    case 1:
      r(3, 1, 2, 1, '#78c25c'); // a dome of leaves
      r(2, 2, 4, 1, '#5fa84a');
      r(1, 3, 6, 4, '#4f8f3c');
      r(1, 4, 1, 1, '#3d7530');
      r(6, 5, 1, 1, '#3d7530');
      r(3, 5, 2, 2, '#22301a'); // round low entrance
      r(4, 0, 1, 1, roof);
      break;
    case 2:
      r(1, 3, 6, 4, '#8a6a42'); // round wooden walls
      r(1, 4.5, 6, 0.4, '#6c5030');
      r(2, 0, 4, 1, '#6cc06a'); // rounded leaf roof
      r(1, 1, 6, 1, '#4fa458');
      r(0, 2, 8, 1.2, '#3f8f4a');
      r(3, 5, 2, 2, '#2b2015');
      r(5.5, 3.5, 1, 1, '#c8f5a8'); // green-lit window
      r(0, 2, 1, 0.6, roof);
      break;
    case 3:
      r(3, 2, 2, 5, '#6b4a2a'); // trunk
      r(2, 6, 4, 1, '#5a3d22'); // roots
      r(0, 2, 8, 1, '#8a6a42'); // platform
      r(1, -1, 6, 3, '#a07a4c'); // the house on the platform
      r(2, 0, 1, 1, '#c8f5a8');
      r(5, 0, 1, 1, '#c8f5a8');
      r(0, -3, 8, 2, '#3f8f4a'); // wide canopy
      r(1, -4, 6, 1, '#5fb865');
      r(3, -5, 2, 1, '#78c25c');
      r(6, -5, 1, 1, roof);
      break;
    default:
      r(2, -3, 4, 10, '#e2d6b8'); // tall hall of pale wood
      r(2, -3, 4, 0.6, roof); // band in the settlement colour
      r(3, -6, 2, 3, '#4fa458'); // leaf spire
      r(3.5, -7, 1, 1, '#78c25c');
      r(0, -1, 2, 4, '#4fa458'); // leaf wings
      r(6, -1, 2, 4, '#4fa458');
      r(0, 3, 2, 0.6, '#3f8f4a');
      r(6, 3, 2, 0.6, '#3f8f4a');
      r(3.5, -1, 1, 1.5, '#c8f5a8');
      r(3.5, 2.2, 1, 1.5, '#c8f5a8');
      r(3, 5, 2, 2, '#3b2817');
  }
}

export const HOUSE_STYLES: Readonly<Record<Architecture, HouseStyle>> = {
  human: { dots: ['', '#b8964f', '#c9a36b', '#a7a39b', '#e4ded2'], draw: drawHumanHouse },
  elven: { dots: ['', '#4f8f3c', '#6f8a4a', '#7fae5a', '#d9e8c0'], draw: drawElvenHouse },
};
