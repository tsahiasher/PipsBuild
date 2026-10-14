import { describe, expect, it } from 'vitest';
import { browserDecoded, loadImage } from '../../scripts/load';
import { recognize } from '../../src/vision/recognize';
import { isSolved } from '../../src/engine/constraints';
import { TRUTH } from './groundTruth';
import { solve } from '../helpers/solver';

describe('recognised puzzles are solvable', () => {
  for (const t of TRUTH) {
    it(`${t.file} has a solution under the game rules`, async () => {
      const { puzzle } = await recognize(loadImage(browserDecoded(t.file)));
      const solution = solve(puzzle);
      expect(solution).not.toBeNull();
      expect(isSolved(puzzle, solution!)).toBe(true);
    });
  }

  it('game7 contains a ≠ region whose solution uses different values', async () => {
    const { puzzle } = await recognize(loadImage(browserDecoded('game7.jpg')));
    const neq = puzzle.regions.find((r) => r.constraint?.type === 'neq');
    expect(neq?.cells).toHaveLength(3);
    const solution = solve(puzzle)!;
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
