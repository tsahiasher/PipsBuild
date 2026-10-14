import { makeCells } from '../../src/engine/puzzle';
import type { Constraint, Domino, Puzzle, Region } from '../../src/engine/types';

/** Builds a puzzle from a picture: "#" playable, "." hole. */
export function board(rows: string[], regions: { cells: string[]; constraint: Constraint | null }[] = [], dominoes: Domino[] = []): Puzzle {
  const ids: string[] = [];
  rows.forEach((line, r) => [...line].forEach((ch, c) => ch === '#' && ids.push(`${r},${c}`)));
  return {
    id: 'test',
    rows: rows.length,
    cols: Math.max(...rows.map((r) => r.length)),
    cells: makeCells(ids),
    regions: regions.map((r, i): Region => ({ id: `r${i + 1}`, color: i, ...r })),
    dominoes,
  };
}

export const dom = (id: string, a: number, b: number): Domino => ({ id, a, b });

/**
 * 2x2 board with two vertical dominoes as the unique-ish solution:
 *   cells (0,0)=1 (1,0)=2 | (0,1)=3 (1,1)=4
 * Regions: left column sum 3, right column sum 7.
 */
export function smallPuzzle(): Puzzle {
  return board(
    ['##', '##'],
    [
      { cells: ['0,0', '1,0'], constraint: { type: 'sum', target: 3 } },
      { cells: ['0,1', '1,1'], constraint: { type: 'sum', target: 7 } },
    ],
    [dom('d1', 1, 2), dom('d2', 3, 4)],
  );
}
