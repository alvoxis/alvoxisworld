/**
 * Creature art as character maps (one char = one sprite pixel, '.' = clear), facing right, two frames each:
 * frame 0 standing / mid-stride, frame 1 the other stride (legs, tail or fins swap). No DOM, so it can be tested;
 * tileset.ts turns it into canvases with a dark outline, and the renderer adds a ground shadow and picks the frame
 * from movement. Sprite pixels are 1/8 of a tile, like terrain.
 *
 * People are drawn to be told apart at a glance: humans are compact, with short dark hair, a blue tunic, a belt and
 * boots; elves are a pixel taller and slimmer, with long ears swept back, long pale hair down the back, a green
 * cloak that narrows to the knees, and a bow on the back.
 */
export interface CreatureArt {
  frames: readonly (readonly string[])[];
  palette: Readonly<Record<string, string>>;
}

const swap = (rows: readonly string[], changes: Record<number, string>): string[] => rows.map((r, i) => changes[i] ?? r);

const GRAZER: string[] = [
  '.........',
  '..wwwww..',
  '.wwwwwwhh',
  '.wWwwwwhe',
  '.wwwwwwhn',
  '..wwwww..',
  '..l...l..',
  '..l...l..',
];
const RAPTOR: string[] = [
  '......rrr.',
  '.....rrerr',
  '.....rrrtt',
  't...rrr...',
  'ttrrrrr...',
  '.trbbbr.a.',
  '...rbbrra.',
  '...l..l...',
  '..ll..ll..',
];
const HADROSAUR: string[] = [
  '..........c.',
  '.........cc.',
  '........gggg',
  '........gegg',
  '.......ggg..',
  'd.....gggg..',
  'ddgggggggg..',
  '.dggggggggg.',
  '..gbbbbbbgg.',
  '...l....l...',
  '...l....l...',
  '..ll...ll...',
];
const TYRANT: string[] = [
  '.........rrrr.',
  '........rrrerr',
  '........rrrrrr',
  '........rrttt.',
  '........rrrr..',
  '.......rrr....',
  'd.....rrrr.a..',
  'dd..rrrrrrra..',
  '.ddrrrrrrrr...',
  '..drrrbbbrr...',
  '....rrbbrr....',
  '.....d...d....',
  '.....d...d....',
  '....dd..dd....',
];
const FISH: string[] = ['......', '.d.ss.', 'ddsses', 'ddssss', '.d.ss.', '......'];
const HUMAN: string[] = [
  '...hhh..',
  '..hhsss.',
  '..hssse.',
  '...sss..',
  '..tttt..',
  '.sttttt.',
  '.stbbts.',
  '..tttt..',
  '..l..l..',
  '..f..f..',
];
const ELF: string[] = [
  '...yyy..',
  'ee.yyss.',
  '.eyyssE.',
  '..yy.s..',
  '..ygggg.',
  '.bygggs.',
  '.bgggg..',
  '..gggg..',
  '...gg...',
  '..l..l..',
  '..l..l..',
];

export const CREATURE_ART: Readonly<Record<number, CreatureArt>> = {
  0: {
    frames: [GRAZER, swap(GRAZER, { 6: '...l.l...', 7: '..l...l..' })],
    palette: { w: '#efe6cf', W: '#d8cdb2', h: '#3a2e26', e: '#f2efe6', n: '#2a201a', l: '#3a2e26' },
  },
  1: {
    frames: [RAPTOR, swap(RAPTOR, { 7: '....ll....', 8: '...l..l...' })],
    palette: { r: '#c8502e', e: '#1a1a1a', t: '#e07a46', b: '#f4d2a0', a: '#7a2c18', l: '#7a2c18' },
  },
  2: {
    frames: [HADROSAUR, swap(HADROSAUR, { 9: '....l..l....', 10: '....l..l....', 11: '...ll.ll....' })],
    palette: { g: '#6f8f4a', d: '#4e6a33', b: '#a9b979', c: '#c8643a', e: '#111111', l: '#3f5528' },
  },
  3: {
    frames: [TYRANT, swap(TYRANT, { 11: '......d.d.....', 12: '......d.d.....', 13: '.....dd.dd....' })],
    palette: { r: '#7a3b2a', d: '#552618', b: '#b0705a', t: '#f2efe6', e: '#f2c14e', a: '#6a3022' },
  },
  4: {
    frames: [FISH, swap(FISH, { 1: '..dss.', 2: '.dsses', 3: '.dssss', 4: '..dss.' })],
    palette: { s: '#9fc4d8', d: '#5f8fae', e: '#102030' },
  },
  5: {
    frames: [HUMAN, swap(HUMAN, { 8: '..l.l...', 9: '.f...f..' })],
    palette: { h: '#5a3a1e', s: '#e8b98a', e: '#1a1a1a', t: '#3f6fb5', b: '#6b4a2a', l: '#4a3a2a', f: '#2a2018' },
  },
  6: {
    frames: [ELF, swap(ELF, { 9: '..l.l...', 10: '.l...l..' })],
    palette: { y: '#f3e7a6', s: '#f1d3b3', e: '#f1d3b3', E: '#2d6a2d', g: '#2f7d45', b: '#a0743c', l: '#3b4a2e' },
  },
};

/** Opaque pixels of a frame (for tests: silhouettes and sizes). */
export function silhouette(species: number, frame = 0): string[] {
  const art = CREATURE_ART[species];
  return (art?.frames[frame] ?? []).map((r) => [...r].map((ch) => (art.palette[ch] ? '#' : '.')).join(''));
}
