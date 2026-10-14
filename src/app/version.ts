/** Game version shown in Settings → About. Keep equal to package.json (a test checks). */
export const VERSION = '0.37.0';

/** Changelog entries, newest first; the text lives in the translations (about.cl_*). */
export const CHANGELOG: ReadonlyArray<{ version: string; key: 'about.cl_world23' | 'about.cl_landmarks' | 'about.cl_visual21' | 'about.cl_world20' | 'about.cl_kingdoms' | 'about.cl_visual' | 'about.cl_elves' | 'about.cl_housing' | 'about.cl_jobs' | 'about.cl_living' | 'about.cl_civ_tech' | 'about.cl_civ_growth' | 'about.cl_civ_economy' | 'about.cl_civ_settlements' | 'about.cl_humans' | 'about.cl_settlements' | 'about.cl_interface' | 'about.cl_technical' | 'about.cl_sky' | 'about.cl_world' }> = [
  { version: '0.23.0', key: 'about.cl_world23' },
  { version: '0.22.0', key: 'about.cl_landmarks' },
  { version: '0.21.0', key: 'about.cl_visual21' },
  { version: '0.20.0', key: 'about.cl_world20' },
  { version: '0.19.0', key: 'about.cl_kingdoms' },
  { version: '0.18.0', key: 'about.cl_visual' },
  { version: '0.17.0', key: 'about.cl_elves' },
  { version: '0.16.0', key: 'about.cl_housing' },
  { version: '0.15.0', key: 'about.cl_jobs' },
  { version: '0.14.0', key: 'about.cl_living' },
  { version: '0.13.0', key: 'about.cl_civ_tech' },
  { version: '0.12.0', key: 'about.cl_civ_growth' },
  { version: '0.11.0', key: 'about.cl_civ_economy' },
  { version: '0.10.0', key: 'about.cl_civ_settlements' },
  { version: '0.9.0', key: 'about.cl_humans' },
  { version: '0.8.0', key: 'about.cl_settlements' },
  { version: '0.7.0', key: 'about.cl_interface' },
  { version: '0.6.0', key: 'about.cl_technical' },
  { version: '0.5.0', key: 'about.cl_sky' },
  { version: '0.4.0', key: 'about.cl_world' },
];
// cache-bust 1791927812
