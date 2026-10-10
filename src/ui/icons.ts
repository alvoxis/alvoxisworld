/**
 * Small original SVG icons (inline, a few hundred bytes each, no network requests).
 * Drawn on a 32×32 grid with simple shapes so they stay crisp at any phone density.
 */
export type CategoryId = 'creatures' | 'biomes' | 'powers' | 'effects';

const svg = (body: string) =>
  `<svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true" focusable="false">${body}</svg>`;

export const CATEGORY_ICONS: Record<CategoryId, string> = {
  // Life: a paw print.
  creatures: svg(
    '<ellipse cx="16" cy="21" rx="7" ry="5.5" fill="#6fd16b"/>' +
      '<ellipse cx="7.5" cy="14" rx="2.6" ry="3.4" fill="#8be07f" transform="rotate(-20 7.5 14)"/>' +
      '<ellipse cx="13" cy="9.5" rx="2.6" ry="3.6" fill="#8be07f" transform="rotate(-6 13 9.5)"/>' +
      '<ellipse cx="19.5" cy="9.5" rx="2.6" ry="3.6" fill="#8be07f" transform="rotate(6 19.5 9.5)"/>' +
      '<ellipse cx="25" cy="14" rx="2.6" ry="3.4" fill="#8be07f" transform="rotate(20 25 14)"/>',
  ),
  // Biomes: a mountain range under a sun, with a strip of grass.
  biomes: svg(
    '<circle cx="23.5" cy="8.5" r="3.6" fill="#ffd85c"/>' +
      '<path d="M2 25 L11 9 L17 18 L21 12.5 L30 25 Z" fill="#8c8a85"/>' +
      '<path d="M11 9 L14.2 14.4 L12.2 13.4 L11 15 L9.6 13.2 L7.9 14.4 Z" fill="#f4f7fb"/>' +
      '<rect x="2" y="25" width="28" height="4.5" rx="1.5" fill="#4c9f3e"/>',
  ),
  // Powers: a lightning bolt in a glow.
  powers: svg(
    '<circle cx="16" cy="16" r="12.5" fill="#f2c14e" fill-opacity=".18"/>' +
      '<path d="M18.5 2.5 L7 18 H14 L12.5 29.5 L25 12.5 H17.5 Z" fill="#ffd34d" stroke="#c98a1b" stroke-width="1.2" stroke-linejoin="round"/>',
  ),
  // Effects: a potion flask with sparkles.
  effects: svg(
    '<path d="M12.5 4 H19.5 V6 H18 V12 L24 23 Q25.2 26.5 21.5 27.5 H10.5 Q6.8 26.5 8 23 L14 12 V6 H12.5 Z" fill="#b57bff" stroke="#7b46c9" stroke-width="1.2" stroke-linejoin="round"/>' +
      '<path d="M10.8 20.5 Q16 18.2 21.2 20.5 L23 23.6 Q23.6 25.6 21.4 26 H10.6 Q8.4 25.6 9 23.6 Z" fill="#e0c4ff"/>' +
      '<path d="M26 5 l1 2.4 2.4 1 -2.4 1 -1 2.4 -1 -2.4 -2.4 -1 2.4 -1 Z" fill="#ffe27a"/>',
  ),
};

export const GEAR_ICON = svg(
  '<path fill="currentColor" d="M13.4 2.5h5.2l.8 3.3 2 .9 2.9-1.8 3.7 3.7-1.8 2.9.9 2 3.3.8v5.2l-3.3.8-.9 2 1.8 2.9-3.7 3.7-2.9-1.8-2 .9-.8 3.3h-5.2l-.8-3.3-2-.9-2.9 1.8-3.7-3.7 1.8-2.9-.9-2-3.3-.8v-5.2l3.3-.8.9-2-1.8-2.9 3.7-3.7 2.9 1.8 2-.9z"/>' +
    '<circle cx="16" cy="16" r="4.6" fill="#10141f"/>',
);
