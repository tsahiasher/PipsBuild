/**
 * Expected reconstructions of the reference screenshots.
 *
 * Each screenshot `gameN.jpg` in the project root has an expected result in
 * `tests/vision/expected/gameN.json`, written in the app's own puzzle-file format, so it can
 * also be opened in the app with "Import puzzle file". To add an example, drop the
 * screenshot in the root and its expected puzzle file here (see CLAUDE.md).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { constraintLabel } from '../../src/engine/constraints';
import { parsePuzzleFile } from '../../src/engine/puzzleFile';
import type { Puzzle } from '../../src/engine/types';

export interface Truth {
  /** Screenshot file name, e.g. "game10.jpg". */
  file: string;
  puzzle: Puzzle;
  /** Region id -> condition label as drawn on the badge ("" when the region has none). */
  labels: Record<string, string>;
  /** Dominoes in tray reading order, e.g. "24 40 66". */
  dominoes: string;
  /** Screenshots of the same puzzle (phone and desktop captures) share this key. */
  key: string;
}

const DIR = 'tests/vision/expected';

const num = (f: string) => Number(/\d+/.exec(f)?.[0] ?? 0);

export const TRUTH: Truth[] = readdirSync(DIR)
  .filter((f) => f.endsWith('.json'))
  .sort((a, b) => num(a) - num(b))
  .map((f) => {
    const puzzle = parsePuzzleFile(readFileSync(`${DIR}/${f}`, 'utf8'));
    return {
      file: f.replace(/\.json$/, '.jpg'),
      puzzle,
      labels: Object.fromEntries(puzzle.regions.map((r) => [r.id, constraintLabel(r.constraint)])),
      dominoes: puzzle.dominoes.map((d) => `${d.a}${d.b}`).join(' '),
      key: puzzle.id,
    };
  });

export const truthFor = (file: string): Truth => {
  const t = TRUTH.find((x) => x.file === file);
  if (!t) throw new Error(`No expected result for ${file}`);
  return t;
};

/** Region id -> cell ids, plus all playable cell ids. */
export function parseTruth(t: Truth) {
  return {
    regions: new Map(t.puzzle.regions.map((r) => [r.id, [...r.cells]])),
    playable: t.puzzle.cells.map((c) => c.id),
  };
}
