/**
 * Expected reconstructions of the reference screenshots in the project root.
 * Grid tokens: "." = not playable, "_" = playable cell without a region, anything else = region key.
 */
export interface Truth {
  file: string;
  grid: string[];
  labels: Record<string, string>;
  dominoes: string;
}

export const TRUTH: Truth[] = [
  {
    file: 'game1.jpg',
    grid: [
      'A A A . B _ C C',
      'A . D . _ . . .',
      'E F D . G . H H',
      'E . D . I . . H',
      'J . D . K K L L',
    ],
    labels: { A: '11', B: '<2', C: '7', D: '24', E: '=', F: '>2', G: '5', H: '=', I: '0', J: '>4', K: '<7', L: '<5' },
    dominoes: '24 40 66 33 44 12 25 34 45 46 36 26 22',
  },
  {
    file: 'game2.jpg',
    grid: ['. . A B', 'C C A D', 'E F F G', 'E H H G'],
    labels: { A: '=', B: '<2', C: '=', D: '<4', E: '12', F: '=', G: '10', H: '5' },
    dominoes: '44 61 50 13 55 62 25',
  },
  {
    file: 'game3.jpg',
    grid: ['. A A A', 'B B _ .', '_ . C C', '. . . D'],
    labels: { A: '2', B: '10', C: '8', D: '>2' },
    dominoes: '00 66 53 42 32',
  },
  {
    file: 'game4.jpg',
    grid: [
      '. a b c d .',
      'e f g h i j',
      'k l m n o p',
      'q r s t u v',
      'w x y z A B',
      '. C D E F .',
    ],
    labels: {
      a: '3', b: '3', c: '0', d: '4',
      e: '4', f: '4', g: '2', h: '1', i: '0', j: '0',
      k: '2', l: '0', m: '1', n: '1', o: '3', p: '2',
      q: '5', r: '5', s: '3', t: '3', u: '6', v: '3',
      w: '4', x: '1', y: '0', z: '2', A: '2', B: '5',
      C: '4', D: '5', E: '1', F: '5',
    },
    dominoes: '01 02 03 04 05 12 13 14 15 23 24 25 34 35 45 36',
  },
  {
    file: 'game6.jpg',
    grid: [
      '. a b c d .',
      'e f f g h i',
      'j k l m n o',
      'p q r s t u',
      'v w x y t z',
      '. A B C D .',
    ],
    labels: {
      a: '2', b: '3', c: '2', d: '3',
      e: '1', f: '10', g: '5', h: '4', i: '3',
      j: '4', k: '2', l: '4', m: '1', n: '2', o: '0',
      p: '1', q: '1', r: '0', s: '5', t: '9', u: '0',
      v: '3', w: '5', x: '0', y: '1', z: '3',
      A: '3', B: '5', C: '2', D: '0',
    },
    dominoes: '01 02 03 04 05 12 13 14 15 23 24 25 34 35 45 36',
  },
];

const GAME4 = TRUTH.find((t) => t.file === 'game4.jpg')!;

const GAME7: Truth = {
  file: 'game7.jpg',
  grid: [
    'A A B . C . . D',
    'A . E . F . . D',
    'G . E . F . . H',
    'G G I . F J J J',
    '. . . . . . . .',
    '. . K L L M N .',
    '. . . . _ . . .',
    '. . . . O . . .',
    '. . . . O . . .',
  ],
  labels: { A: '≠', B: '0', C: '4', D: '>7', E: '=', F: '9', G: '=', H: '4', I: '3', J: '14', K: '<4', L: '<3', M: '>4', N: '6', O: '6' },
  dominoes: '26 40 61 56 11 05 13 23 66 33 06 51 24 44',
};

TRUTH.push(
  // Desktop capture of the game4 puzzle: different scale and aspect ratio, 5-wide tray.
  { ...GAME4, file: 'game5.jpg' },
  GAME7,
  // Small desktop capture of the game7 puzzle.
  { ...GAME7, file: 'game8.jpg' },
);

/** Region key -> sorted cell ids, plus playable and unconstrained cell sets. */
export function parseTruth(t: Truth) {
  const regions = new Map<string, string[]>();
  const playable: string[] = [];
  t.grid.forEach((line, r) =>
    line.split(' ').forEach((tok, c) => {
      if (tok === '.') return;
      const id = `${r},${c}`;
      playable.push(id);
      if (tok === '_') return;
      if (!regions.has(tok)) regions.set(tok, []);
      regions.get(tok)!.push(id);
    }),
  );
  return { regions, playable };
}
