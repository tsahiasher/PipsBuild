import { describe, expect, it } from 'vitest';
import { dominoKey, duplicateDominoes, firstUnusedDomino, nextUniqueHalf } from '../../src/engine/dominoes';
import { checkConsistency } from '../../src/engine/puzzle';
import { dom, smallPuzzle } from './fixtures';

describe('unique dominoes in the builder', () => {
  it('treats 3|1 and 1|3 as the same piece', () => {
    expect(dominoKey(3, 1)).toBe(dominoKey(1, 3));
    expect(duplicateDominoes([dom('a', 3, 1), dom('b', 1, 3), dom('c', 2, 2)])).toEqual(['1|3']);
  });

  it('blocks starting a puzzle that uses a domino twice', () => {
    const p = smallPuzzle();
    p.dominoes = [dom('d1', 1, 2), dom('d2', 2, 1)];
    expect(checkConsistency(p).map((i) => i.message)).toContain('Domino 1|2 is used more than once; each domino can appear only once.');
  });

  it('skips values that would duplicate another piece when stepping a half', () => {
    const ds = [dom('a', 1, 3), dom('b', 1, 2)];
    // b: 1|2 -> 1|3 is taken, so the next value is 1|4.
    expect(nextUniqueHalf(ds, 'b', 'b', 1)).toBe(4);
    // b stepping down from 2: 1|1 is free.
    expect(nextUniqueHalf(ds, 'b', 'b', -1)).toBe(1);
  });

  it('returns null when every value for that half is taken', () => {
    const ds = [0, 1, 2, 3, 4, 5, 6].map((v) => dom(`x${v}`, 0, v));
    expect(nextUniqueHalf(ds, 'x0', 'b', 1)).toBeNull();
  });

  it('adds the first unused piece, and nothing once all 28 are used', () => {
    expect(firstUnusedDomino([dom('a', 0, 0), dom('b', 1, 0)])).toEqual([0, 2]);
    const all = [];
    for (let a = 0; a <= 6; a++) for (let b = a; b <= 6; b++) all.push(dom(`${a}${b}`, a, b));
    expect(firstUnusedDomino(all)).toBeNull();
  });
});
