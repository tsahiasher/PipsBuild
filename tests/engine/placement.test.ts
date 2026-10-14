import { describe, expect, it } from 'vitest';
import {
  canPlaceDomino,
  getBoardValues,
  placeDomino,
  placementError,
  removeDomino,
  rotateDomino,
  rotatePlacement,
  unusedDominoes,
} from '../../src/engine/placement';
import { boardComponents, rotationOf } from '../../src/engine/geometry';
import type { Placements } from '../../src/engine/types';
import { board, dom } from './fixtures';

const p3x3 = board(['###', '#.#', '###'], [], [dom('d1', 1, 2), dom('d2', 3, 4)]);
const [d1, d2] = p3x3.dominoes;

describe('placement', () => {
  it('1. accepts a legal horizontal placement', () => {
    expect(canPlaceDomino(p3x3, {}, d1, '0,0', '0,1')).toBe(true);
  });

  it('2. accepts a legal vertical placement', () => {
    expect(canPlaceDomino(p3x3, {}, d1, '0,0', '1,0')).toBe(true);
  });

  it('3. rejects overlapping placements', () => {
    const pl = placeDomino(p3x3, {}, d1, '0,0', '0,1')!;
    expect(placementError(p3x3, pl, d2, '0,1', '0,2')).toBe('occupied');
  });

  it('4. rejects nonexistent cells', () => {
    expect(placementError(p3x3, {}, d1, '5,5', '5,6')).toBe('missing-cell');
  });

  it('5. rejects covering a hole', () => {
    expect(placementError(p3x3, {}, d1, '1,0', '1,1')).toBe('missing-cell');
  });

  it('6. rejects crossing the board boundary', () => {
    expect(placementError(p3x3, {}, d1, '0,2', '0,3')).toBe('missing-cell');
    expect(placementError(p3x3, {}, d1, '-1,0', '0,0')).toBe('missing-cell');
  });

  it('rejects non-adjacent and single-cell placements', () => {
    expect(placementError(p3x3, {}, d1, '0,0', '0,2')).toBe('not-adjacent');
    expect(placementError(p3x3, {}, d1, '0,0', '0,0')).toBe('same-cell');
  });

  it('7. removes a domino', () => {
    const pl = placeDomino(p3x3, {}, d1, '0,0', '0,1')!;
    expect(removeDomino(pl, 'd1')).toEqual({});
  });

  it('8. moves a placed domino to a new legal position', () => {
    const pl = placeDomino(p3x3, {}, d1, '0,0', '0,1')!;
    // The domino may overlap its own old cells when moving.
    const moved = placeDomino(p3x3, pl, d1, '0,1', '0,2')!;
    expect(moved.d1).toEqual({ cellA: '0,1', cellB: '0,2' });
    expect(Object.keys(moved)).toEqual(['d1']);
  });

  it('9. rotates 90 degrees clockwise around the left cell of a horizontal domino', () => {
    expect(rotatePlacement({ cellA: '1,1', cellB: '1,2' })).toEqual({ cellA: '1,1', cellB: '2,1' });
    const pl = placeDomino(p3x3, {}, d1, '0,0', '0,1')!;
    expect(rotateDomino(p3x3, pl, d1)!.d1).toEqual({ cellA: '0,0', cellB: '1,0' });
  });

  it('rotates around the top cell of a vertical domino', () => {
    expect(rotatePlacement({ cellA: '1,1', cellB: '2,1' })).toEqual({ cellA: '1,1', cellB: '1,0' });
  });

  it('10. four rotations around the same square make a full circle', () => {
    const start = { cellA: '1,1', cellB: '1,2' };
    const pivot = '1,1';
    const seen = [start];
    let p = start;
    for (let i = 0; i < 4; i++) {
      p = rotatePlacement(p, pivot);
      seen.push(p);
    }
    expect(seen.map((x) => x.cellB)).toEqual(['1,2', '2,1', '1,0', '0,1', '1,2']);
    expect(seen.every((x) => x.cellA === pivot)).toBe(true);
  });

  it('11. the pivot keeps its value; the other half travels right, below, left, above', () => {
    // B is on the left, so B is the pivot.
    let p = { cellA: '1,2', cellB: '1,1' };
    const order: (string | null)[] = [];
    for (let i = 0; i < 4; i++) {
      p = rotatePlacement(p, '1,1');
      order.push(p.cellB === '1,1' ? p.cellA : null);
    }
    expect(order).toEqual(['2,1', '1,0', '0,1', '1,2']);
  });

  it('rejects a rotation off the board or into a hole', () => {
    // Vertical at the left edge: the lower half would swing to the left, off the board.
    const pl = placeDomino(p3x3, {}, d1, '0,0', '1,0')!;
    expect(rotateDomino(p3x3, pl, d1)).toBeNull();
    // Horizontal (2,0)-(2,1): the right half would swing down, off the board.
    expect(rotateDomino(p3x3, placeDomino(p3x3, {}, d1, '2,0', '2,1')!, d1)).toBeNull();
    // Horizontal (0,1)-(0,2): the right half would swing into the hole at (1,1).
    expect(rotateDomino(p3x3, placeDomino(p3x3, {}, d1, '0,1', '0,2')!, d1)).toBeNull();
  });

  it('20. supports disconnected components and never bridges them', () => {
    const p = board(['##.##'], [], [dom('a', 1, 1), dom('b', 2, 2)]);
    expect(boardComponents(p.cells)).toHaveLength(2);
    expect(canPlaceDomino(p, {}, p.dominoes[0], '0,0', '0,1')).toBe(true);
    expect(canPlaceDomino(p, {}, p.dominoes[0], '0,3', '0,4')).toBe(true);
    expect(canPlaceDomino(p, {}, p.dominoes[0], '0,1', '0,3')).toBe(false);
  });

  it('21. treats duplicate-valued dominoes as independent pieces', () => {
    const p = board(['####'], [], [dom('x', 4, 6), dom('y', 4, 6)]);
    let pl: Placements = placeDomino(p, {}, p.dominoes[0], '0,0', '0,1')!;
    pl = placeDomino(p, pl, p.dominoes[1], '0,2', '0,3')!;
    expect(Object.keys(pl).sort()).toEqual(['x', 'y']);
    expect(unusedDominoes(p, removeDomino(pl, 'x')).map((d) => d.id)).toEqual(['x']);
  });

  it('22. detects unused dominoes', () => {
    const pl = placeDomino(p3x3, {}, d1, '0,0', '0,1')!;
    expect(unusedDominoes(p3x3, pl).map((d) => d.id)).toEqual(['d2']);
  });

  it('reads board values from whichever half sits on each cell', () => {
    const pl = placeDomino(p3x3, {}, d1, '0,1', '0,0')!; // A=1 on the right
    const v = getBoardValues(p3x3, pl);
    expect(v.get('0,0')).toBe(2);
    expect(v.get('0,1')).toBe(1);
    expect(v.get('2,2')).toBeNull();
  });
});
