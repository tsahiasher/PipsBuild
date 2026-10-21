import { describe, expect, it } from 'vitest';
import { describeSolvability, type Solvability } from '../../src/ui/solveMessage';
import type { SolveResult } from '../../src/engine/solver';

const state = (result: SolveResult | null, pending = false): Solvability => ({ result, pending });

describe('solvability message', () => {
  it('says it is checking before there is a result', () => {
    expect(describeSolvability(state(null, true))).toMatchObject({ tone: 'busy' });
  });

  it('is green and counts the solutions', () => {
    expect(describeSolvability(state({ count: 1, complete: true }))).toEqual({ tone: 'ok', headline: 'Solvable: 1 solution' });
    expect(describeSolvability(state({ count: 3, complete: true }))).toEqual({ tone: 'ok', headline: 'Solvable: 3 solutions' });
  });

  it('says "or more" when the solution limit was reached', () => {
    expect(describeSolvability(state({ count: 1000, complete: false, stoppedBy: 'limit' }))).toEqual({
      tone: 'ok',
      headline: 'Solvable: 1,000 or more solutions',
    });
  });

  it('says "at least" when the time limit was reached after finding some', () => {
    expect(describeSolvability(state({ count: 37, complete: false, stoppedBy: 'time' }))).toMatchObject({
      tone: 'ok',
      headline: 'Solvable: at least 37 solutions',
      detail: '(stopped counting after 2.5 s)',
    });
  });

  it('is red and gives the reason when the puzzle cannot be solved', () => {
    expect(describeSolvability(state({ count: 0, complete: true, reason: 'The board has 6 cells, but 2 dominoes cover 4.' }))).toEqual({
      tone: 'bad',
      headline: 'Not solvable',
      detail: 'The board has 6 cells, but 2 dominoes cover 4.',
    });
    expect(describeSolvability(state({ count: 0, complete: true }))).toMatchObject({ tone: 'bad', headline: 'Not solvable' });
  });

  it('is neither green nor red when time ran out before finding a solution', () => {
    expect(describeSolvability(state({ count: 0, complete: false, stoppedBy: 'time' }))).toMatchObject({ tone: 'warn' });
  });

  it('keeps showing the last result while a new one is computed', () => {
    expect(describeSolvability(state({ count: 2, complete: true }, true)).headline).toBe('Solvable: 2 solutions');
  });
});
