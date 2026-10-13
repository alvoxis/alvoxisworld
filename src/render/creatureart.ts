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


// ---- 0.23 wild animals (side view, facing right) -------------------------------------------------------------------
const DEER: string[] = [
  '........a.a',
  '........aaa',
  '.......bbbe',
  '.......bbbn',
  '.bbbbbbbb..',
  'wbbbbbbbb..',
  '.bBBBBBbb..',
  '..l....l...',
  '..l....l...',
  '..h....h...',
];
const RABBIT: string[] = ['....ee.', '....ee.', '.gggggk', 'ggggggg', 'wgggggg', '.l...l.'];
const WOLF: string[] = [
  '.........e.e',
  '........gggg',
  '........gkgg',
  '.......ggggn',
  't.ggggggggg.',
  'ttggggggggg.',
  '..gLLLLLgg..',
  '..l..l..l.l.',
];
const BEAR: string[] = [
  '.........e.e.',
  '........bbbbb',
  '........bkbbb',
  '........bbbbn',
  '..bbbbbbbbbb.',
  '.bbbbbbbbbbb.',
  '.bbbbbbbbbbb.',
  '.bBBBBBBBbbb.',
  '..ll....ll...',
  '..ll....ll...',
];
const SHARK: string[] = ['.....f......', '....ff......', 't.sssssssss.', 'ttssssssssse', 't.sWWWWWWss.', '....p...p...'];
const WHALE: string[] = [
  '....bbbbbbbbb...',
  '..bbbbbbbbbbbbb.',
  't.bbbbbbbbbbbbbb',
  'ttbbbbbbbbbbbebb',
  't.bWWWWWWWWWWbb.',
  '....WWW...p.....',
];
const ORCA: string[] = ['......f.......', '.....ff.......', 't.kkkkkkkkkkk.', 'ttkkkkkkkkWkek', 't.kWWWWWWkkkk.', '....p.........'];


// New races (simple distinct sprites)
const DWARF: string[] = [
  '....ddd....',
  '...ddddd...',
  '..ddedddd..',
  '..ddddddd..',
  '...ddddd...',
  '..l..l..l..',
  '..l..l..l..',
];
const GNOME: string[] = [
  '....ggg....',
  '...ggggg...',
  '..ggegggg..',
  '..ggggggg..',
  '...ggggg...',
  '..l...l....',
  '..l...l....',
];
const DEMIGOD: string[] = [
  '....yyy....',
  '...yyyyy...',
  '..yyeyyyy..',
  '..yyyyyyy..',
  '...yyyyy...',
  '..l....l...',
  '..l....l...',
];
const ORC: string[] = [
  '....ooo....',
  '...ooooo...',
  '..ooeoooo..',
  '..ooooooo..',
  '...ooooo...',
  '..l..l..l..',
  '..l..l..l..',
];
const MERFOLK: string[] = [
  '....mmm....',
  '...mmmmm...',
  '..mmemmmm..',
  '..mmmmmmm..',
  '...mmmmm...',
  '..l....l...',
  '..f....f...',
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
  7: {
    frames: [DEER, swap(DEER, { 7: '...l..l....', 8: '..l....l...', 9: '.h......h..' })],
    palette: { a: '#c9b08a', b: '#a8703c', B: '#d9b48a', e: '#1a1a1a', n: '#2a1a10', w: '#f2ece0', l: '#7a4a24', h: '#2a1a10' },
  },
  8: {
    frames: [RABBIT, swap(RABBIT, { 5: '..l.l..' })],
    palette: { g: '#b8a58a', e: '#c9b49a', k: '#1a1a1a', w: '#f4f0e8', l: '#8a7a62' },
  },
  9: {
    frames: [WOLF, swap(WOLF, { 7: '...l.l...ll.' })],
    palette: { g: '#7d7f86', L: '#b8bcc4', k: '#f2c14e', n: '#1a1a1a', e: '#5d5f66', t: '#5d5f66', l: '#4a4c52' },
  },
  10: {
    frames: [BEAR, swap(BEAR, { 8: '...ll..ll....', 9: '...ll..ll....' })],
    palette: { b: '#6b4a32', B: '#4f3523', e: '#4f3523', k: '#111111', n: '#2a1a10', l: '#3e2a1c' },
  },
  11: {
    frames: [SHARK, swap(SHARK, { 2: '..sssssssss.', 3: 'tsssssssssse', 4: '..sWWWWWWss.' })],
    palette: { s: '#7b8a99', f: '#5d6b79', t: '#5d6b79', W: '#dfe6ec', e: '#111111', p: '#5d6b79' },
  },
  12: {
    frames: [WHALE, swap(WHALE, { 2: '..bbbbbbbbbbbbbb', 3: 'tbbbbbbbbbbbbebb', 4: '..bWWWWWWWWWWbb.' })],
    palette: { b: '#4a5d78', W: '#9aa9bb', t: '#3b4b63', e: '#111111', p: '#3b4b63' },
  },
  13: {
    frames: [ORCA, swap(ORCA, { 2: '..kkkkkkkkkkk.', 3: 'tkkkkkkkkkWkek', 4: '..kWWWWWWkkkk.' })],
    palette: { k: '#1d2330', W: '#f2f2f2', f: '#1d2330', t: '#1d2330', e: '#8a8f99', p: '#1d2330' },
  },
  14: {
    frames: [DWARF, swap(DWARF, { 5: '..l....l..' })],
    palette: { d: '#c4a574', e: '#fff', l: '#5a4030' },
  },
  15: {
    frames: [GNOME, swap(GNOME, { 5: '..l....l....' })],
    palette: { g: '#a8d08a', e: '#fff', l: '#4a6a3a' },
  },
  16: {
    frames: [DEMIGOD, swap(DEMIGOD, { 5: '..l....l...' })],
    palette: { y: '#ffe8a0', e: '#fff', l: '#c0a060' },
  },
  17: {
    frames: [ORC, swap(ORC, { 5: '..l....l..' })],
    palette: { o: '#6b8e4e', e: '#fff', l: '#3a4a2a' },
  },
  18: {
    frames: [MERFOLK, swap(MERFOLK, { 6: '..f....f...' })],
    palette: { m: '#7ec8e3', e: '#fff', f: '#5ab0d0', l: '#4a7a90' },
  },
};

/** Opaque pixels of a frame (for tests: silhouettes and sizes). */
export function silhouette(species: number, frame = 0): string[] {
  const art = CREATURE_ART[species];
  return (art?.frames[frame] ?? []).map((r) => [...r].map((ch) => (art.palette[ch] ? '#' : '.')).join(''));
}

/**
 * Drawn size of creatures (0.23): one sprite pixel is CREATURE_SCALE / 8 of a tile, half of the earlier 1/8, so
 * people and animals stand at a natural size next to houses and trees. Nothing is drawn narrower than the minimum
 * (device pixels; people a little larger) so creatures stay visible far away. Juveniles are drawn at 3/4 size.
 * Drawing only: selection uses its own, larger radius (Creatures.candidatesAt), not the sprite.
 */
export const CREATURE_SCALE = 0.4;
export const MIN_SPRITE_PX = 5;
export const MIN_PERSON_PX = 6;

/** Device pixels per sprite pixel for a creature at s device pixels per tile. */
export function creatureScale(s: number, artW: number, sentient: boolean, juvenile: boolean, dpr: number): number {
  const minW = (sentient ? MIN_PERSON_PX : MIN_SPRITE_PX) * dpr;
  return Math.max((s / 8) * CREATURE_SCALE, minW / artW) * (juvenile ? 0.75 : 1);
}
