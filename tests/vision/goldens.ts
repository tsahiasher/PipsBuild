/**
 * Golden results of the sample screenshots.
 *
 * Every `samples/gameN.jpg` has a golden file `samples/goldens/gameN.json`: the recogniser's
 * saved output, in the app's own puzzle-file format (so it also opens in the app through
 * "Import puzzle file"). `npm run save:goldens` writes them; the tests compare against them.
 */
import { existsSync, readFileSync } from 'node:fs';
import { goldenPath, listSamples } from '../../scripts/load';
import { constraintLabel } from '../../src/engine/constraints';
import { parsePuzzleFile } from '../../src/engine/puzzleFile';
import type { Puzzle } from '../../src/engine/types';

export interface Golden {
  /** Sample name, e.g. "game10" (the screenshot is samples/game10.jpg). */
  name: string;
  puzzle: Puzzle;
  /** Region id -> condition label as drawn on the badge ("" when the region has none). */
  labels: Record<string, string>;
  /** Screenshots of the same puzzle (phone and desktop captures) share this key. */
  key: string;
}

/** The golden of a sample, or null when none has been saved yet. */
export function loadGolden(name: string): Golden | null {
  const path = goldenPath(name);
  if (!existsSync(path)) return null;
  const puzzle = parsePuzzleFile(readFileSync(path, 'utf8'));
  return {
    name,
    puzzle,
    labels: Object.fromEntries(puzzle.regions.map((r) => [r.id, constraintLabel(r.constraint)])),
    key: puzzle.id,
  };
}

/** The golden of a sample; throws a helpful error when it is missing. */
export function goldenFor(name: string): Golden {
  const g = loadGolden(name);
  if (!g) throw new Error(`No golden for ${name}. Run: npm run save:goldens -- ${name}`);
  return g;
}

/** Goldens of every sample that has one. */
export const goldens = (): Golden[] => listSamples().flatMap((n) => loadGolden(n) ?? []);

/** Region id -> cell ids, plus all playable cell ids. */
export function parseGolden(g: Golden) {
  return {
    regions: new Map(g.puzzle.regions.map((r) => [r.id, [...r.cells]])),
    playable: g.puzzle.cells.map((c) => c.id),
  };
}

export interface CanonicalPuzzle {
  cells: string[];
  /** One entry per region: "cell cell … => condition", sorted. */
  regions: string[];
  /** Dominoes in tray reading order, e.g. "24". */
  dominoes: string[];
}

/**
 * The parts of a puzzle a golden pins down. Region ids and colours are display details and the
 * grid offset depends on the capture, so they are left out; the tray order is kept.
 */
export function canonicalPuzzle(p: Puzzle): CanonicalPuzzle {
  const r0 = Math.min(...p.cells.map((c) => c.row));
  const c0 = Math.min(...p.cells.map((c) => c.col));
  const n = (id: string) => {
    const [r, c] = id.split(',').map(Number);
    return `${r - r0},${c - c0}`;
  };
  return {
    cells: p.cells.map((c) => n(c.id)).sort(),
    regions: p.regions.map((r) => `${r.cells.map(n).sort().join(' ')} => ${constraintLabel(r.constraint) || '-'}`).sort(),
    dominoes: p.dominoes.map((d) => `${d.a}${d.b}`),
  };
}
