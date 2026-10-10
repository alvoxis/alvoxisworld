/** Game version shown in Settings → About. Keep equal to package.json (a test checks). */
export const VERSION = '0.7.0';

/** Changelog entries, newest first; the text lives in the translations (about.cl_*). */
export const CHANGELOG: ReadonlyArray<{ version: string; key: 'about.cl_interface' | 'about.cl_technical' | 'about.cl_sky' | 'about.cl_world' }> = [
  { version: '0.7.0', key: 'about.cl_interface' },
  { version: '0.6.0', key: 'about.cl_technical' },
  { version: '0.5.0', key: 'about.cl_sky' },
  { version: '0.4.0', key: 'about.cl_world' },
];
