import { describe, expect, it } from 'vitest';
import { listSamples } from '../../scripts/load';
import { isSolved } from '../../src/engine/constraints';
import { countSolutions } from '../../src/engine/solver';
import { goldenFor } from './goldens';

/**
 * Samples whose puzzle really has more than one solution, with how many. Each was checked by
 * hand against the screenshot (every condition and every domino), so a new sample that shows
 * more than one solution should be looked at the same way before it is added here.
 */
const MORE_THAN_ONE: Record<string, number> = {
  // The two free squares at the top-left let other dominoes slot in beside them.
  game10: 3,
};

/**
 * A puzzle read wrongly (a misread condition, a missing cell or domino) is usually unsolvable
 * or ambiguous, so this also guards against saving a bad golden. The recognition tests make
 * sure the recogniser reproduces the golden, so this covers the recognised puzzle too.
 */
describe('golden puzzles are solvable', () => {
  for (const name of listSamples()) {
    const expected = MORE_THAN_ONE[name] ?? 1;
    it(`${name} has ${expected === 1 ? 'exactly one solution' : `${expected} solutions`}, all valid under the game rules`, () => {
      const { puzzle } = goldenFor(name);
      const r = countSolutions(puzzle, { maxSolutions: 1000, collect: true });
      expect(r.complete).toBe(true);
      expect(r.count).toBe(expected);
      for (const s of r.solutions!) expect(isSolved(puzzle, s)).toBe(true);
    });
  }

  it('game7 contains a ≠ region whose solution uses different values', () => {
    const { puzzle } = goldenFor('game7');
    const neq = puzzle.regions.find((r) => r.constraint?.type === 'neq');
    expect(neq?.cells).toHaveLength(3);
    const solution = countSolutions(puzzle, { maxSolutions: 1, collect: true }).solutions![0];
    const values = new Map<string, number>();
    for (const [id, p] of Object.entries(solution)) {
      const d = puzzle.dominoes.find((x) => x.id === id)!;
      values.set(p.cellA, d.a);
      values.set(p.cellB, d.b);
    }
    const v = neq!.cells.map((c) => values.get(c));
    expect(new Set(v).size).toBe(3);
  });
});
