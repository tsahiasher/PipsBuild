import { evaluateAll } from '../../src/engine/constraints';
import { cellId, parseCellId } from '../../src/engine/geometry';
import type { Placements, Puzzle } from '../../src/engine/types';

/** Backtracking solver, used to check that a recognised puzzle has a solution. */
export function solve(p: Puzzle): Placements | null {
  const cells = p.cells.map((c) => c.id);
  const playable = new Set(cells);
  const pl: Placements = {};
  const used = new Set<string>();
  const occ = new Set<string>();
  const stillPossible = () => [...evaluateAll(p, pl).values()].every((e) => !e.impossible);
  const go = (): boolean => {
    const first = cells.find((c) => !occ.has(c));
    if (!first) return true;
    const { row, col } = parseCellId(first);
    for (const nb of [cellId(row, col + 1), cellId(row + 1, col)]) {
      if (!playable.has(nb) || occ.has(nb)) continue;
      const tried = new Set<string>();
      for (const d of p.dominoes) {
        if (used.has(d.id)) continue;
        for (const [a, b] of [
          [first, nb],
          [nb, first],
        ]) {
          const key = `${d.a}${d.b}${a}`;
          if (tried.has(key)) continue; // identical pieces / symmetric doubles
          tried.add(key);
          pl[d.id] = { cellA: a, cellB: b };
          used.add(d.id);
          occ.add(first);
          occ.add(nb);
          if (stillPossible() && go()) return true;
          delete pl[d.id];
          used.delete(d.id);
          occ.delete(first);
          occ.delete(nb);
        }
      }
    }
    return false;
  };
  return go() ? { ...pl } : null;
}
