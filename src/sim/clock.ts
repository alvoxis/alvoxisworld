export const TICKS_PER_SECOND = 10;
export const TICKS_PER_DAY = 4;
export const DAYS_PER_SEASON = 30;
export const SEASONS = ['Spring', 'Summer', 'Autumn', 'Winter'] as const;
export type Season = (typeof SEASONS)[number];
export const TICKS_PER_SEASON = TICKS_PER_DAY * DAYS_PER_SEASON;
export const TICKS_PER_YEAR = TICKS_PER_SEASON * SEASONS.length;

/** Vegetation growth multiplier by season. */
export const SEASON_GROWTH: Record<Season, number> = {
  Spring: 1.6,
  Summer: 1,
  Autumn: 0.5,
  Winter: 0.12,
};

export interface WorldDate {
  year: number;
  season: Season;
  seasonIndex: number;
  day: number;
}

export function dateFromTick(tick: number): WorldDate {
  const year = Math.floor(tick / TICKS_PER_YEAR) + 1;
  const inYear = tick % TICKS_PER_YEAR;
  const seasonIndex = Math.floor(inYear / TICKS_PER_SEASON);
  const day = Math.floor((inYear % TICKS_PER_SEASON) / TICKS_PER_DAY) + 1;
  return { year, season: SEASONS[seasonIndex], seasonIndex, day };
}
