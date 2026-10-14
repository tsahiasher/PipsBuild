import { describe, expect, it } from 'vitest';
import { evaluateConstraint, isSolved, violatedRegions } from '../../src/engine/constraints';
import { placeDomino } from '../../src/engine/placement';
import { checkConsistency, parseConstraint } from '../../src/engine/puzzle';
import { smallPuzzle } from './fixtures';

describe('conditions', () => {
  it('12. sum', () => {
    expect(evaluateConstraint({ type: 'sum', target: 11 }, [5, 6])).toMatchObject({ complete: true, valid: true });
    expect(evaluateConstraint({ type: 'sum', target: 11 }, [5, 5])).toMatchObject({ complete: true, valid: false });
  });

  it('13. less than', () => {
    expect(evaluateConstraint({ type: 'lt', target: 5 }, [1, 3]).valid).toBe(true);
    expect(evaluateConstraint({ type: 'lt', target: 5 }, [2, 3]).valid).toBe(false);
  });

  it('14. greater than', () => {
    expect(evaluateConstraint({ type: 'gt', target: 4 }, [5]).valid).toBe(true);
    expect(evaluateConstraint({ type: 'gt', target: 4 }, [4]).valid).toBe(false);
  });

  it('15. equal', () => {
    expect(evaluateConstraint({ type: 'eq' }, [3, 3, 3]).valid).toBe(true);
    expect(evaluateConstraint({ type: 'eq' }, [3, 3, 2]).valid).toBe(false);
  });

  it('16. different', () => {
    expect(evaluateConstraint({ type: 'neq' }, [1, 2, 3]).valid).toBe(true);
    expect(evaluateConstraint({ type: 'neq' }, [1, 2, 1]).valid).toBe(false);
  });

  it('17. incomplete regions are valid until provably impossible', () => {
    expect(evaluateConstraint({ type: 'sum', target: 11 }, [5, null])).toEqual({ complete: false, valid: true, impossible: false });
    expect(evaluateConstraint({ type: 'sum', target: 3 }, [5, null])).toEqual({ complete: false, valid: false, impossible: true });
    expect(evaluateConstraint({ type: 'sum', target: 13 }, [0, null])).toMatchObject({ impossible: true });
    expect(evaluateConstraint({ type: 'lt', target: 2 }, [2, null])).toMatchObject({ impossible: true });
    expect(evaluateConstraint({ type: 'gt', target: 10 }, [3, null])).toMatchObject({ impossible: true });
    expect(evaluateConstraint({ type: 'eq' }, [1, 2, null])).toMatchObject({ impossible: true });
    expect(evaluateConstraint({ type: 'eq' }, [1, null, null])).toMatchObject({ impossible: false });
    expect(evaluateConstraint(null, [null])).toEqual({ complete: false, valid: true, impossible: false });
  });

  it('18. detects a solved board', () => {
    const p = smallPuzzle();
    let pl = placeDomino(p, {}, p.dominoes[0], '0,0', '1,0')!;
    pl = placeDomino(p, pl, p.dominoes[1], '0,1', '1,1')!;
    expect(isSolved(p, pl)).toBe(true);
  });

  it('19. a full but wrong board is not solved', () => {
    const p = smallPuzzle();
    let pl = placeDomino(p, {}, p.dominoes[0], '0,0', '0,1')!;
    pl = placeDomino(p, pl, p.dominoes[1], '1,0', '1,1')!;
    expect(isSolved(p, pl)).toBe(false);
    expect([...violatedRegions(p, pl)].sort()).toEqual(['r1', 'r2']);
  });

  it('parses badge text', () => {
    expect(parseConstraint('11')).toEqual({ type: 'sum', target: 11 });
    expect(parseConstraint('<2')).toEqual({ type: 'lt', target: 2 });
    expect(parseConstraint('>4')).toEqual({ type: 'gt', target: 4 });
    expect(parseConstraint('=')).toEqual({ type: 'eq' });
    expect(parseConstraint('≠')).toEqual({ type: 'neq' });
    expect(parseConstraint('<')).toBeNull();
  });

  it('flags cell/domino count mismatch before play', () => {
    const p = smallPuzzle();
    p.dominoes.pop();
    expect(checkConsistency(p).map((i) => i.message)).toContain('4 playable cells detected, but 1 dominoes only cover 2 cells.');
  });

  it('does not require every cell to be in a region', () => {
    const p = smallPuzzle();
    p.regions = [];
    expect(checkConsistency(p)).toEqual([]);
  });
});

describe('different (≠) condition', () => {
  it('accepts any number of distinct values', () => {
    expect(evaluateConstraint({ type: 'neq' }, [0, 3, 6]).valid).toBe(true);
    expect(evaluateConstraint({ type: 'neq' }, [0, 1, 2, 3, 4, 5, 6]).valid).toBe(true);
    expect(evaluateConstraint({ type: 'neq' }, [4, 2]).valid).toBe(true);
  });

  it('rejects any repeated value, wherever it appears', () => {
    expect(evaluateConstraint({ type: 'neq' }, [1, 2, 1])).toMatchObject({ complete: true, valid: false });
    expect(evaluateConstraint({ type: 'neq' }, [5, 0, 3, 5, 2]).valid).toBe(false);
  });

  it('flags a repeat early, before the region is full', () => {
    expect(evaluateConstraint({ type: 'neq' }, [2, null, 2])).toMatchObject({ complete: false, impossible: true });
    expect(evaluateConstraint({ type: 'neq' }, [2, null, 3])).toMatchObject({ complete: false, valid: true });
  });

  it('knows more than 7 cells can never all differ (pips are 0–6)', () => {
    expect(evaluateConstraint({ type: 'neq' }, Array(8).fill(null))).toMatchObject({ impossible: true });
  });
});
