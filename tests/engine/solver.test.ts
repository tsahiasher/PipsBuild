import { describe, expect, it } from 'vitest';
import { isSolved } from '../../src/engine/constraints';
import { placeDomino } from '../../src/engine/placement';
import { countSolutions } from '../../src/engine/solver';
import type { Constraint, Domino, Placements, Puzzle } from '../../src/engine/types';
import { board, dom, smallPuzzle } from './fixtures';

const sum = (target: number): Constraint => ({ type: 'sum', target });
const count = (p: Puzzle) => countSolutions(p, { maxSolutions: 100000 });

describe('solution counting: what counts as the same solution', () => {
  it('a double such as 3|3 turned around is one solution', () => {
    const p = board(['##'], [], [dom('d1', 3, 3)]);
    expect(count(p).count).toBe(1);
  });

  it('2|3 and 3|2 inside one "sum 5" condition are one solution, not two', () => {
    const p = board(['##'], [{ cells: ['0,0', '0,1'], constraint: sum(5) }], [dom('d1', 2, 3)]);
    expect(count(p)).toMatchObject({ count: 1, complete: true });
  });

  it('turning a domino across two different conditions is a different solution', () => {
    const p = board(
      ['##'],
      [
        { cells: ['0,0'], constraint: { type: 'lt', target: 4 } },
        { cells: ['0,1'], constraint: { type: 'lt', target: 4 } },
      ],
      [dom('d1', 2, 3)],
    );
    expect(count(p).count).toBe(2);
  });

  it('turning a domino between a condition and an unconstrained square matters', () => {
    const p = board(['##'], [{ cells: ['0,0'], constraint: { type: 'lt', target: 3 } }], [dom('d1', 2, 4)]);
    expect(count(p).count).toBe(1); // only 2 fits under the condition
    const q = board(['##'], [{ cells: ['0,0'], constraint: { type: 'lt', target: 5 } }], [dom('d1', 2, 4)]);
    expect(count(q).count).toBe(2); // 2 or 4 may sit on the conditioned square
  });

  it('identical dominoes swapped are one solution', () => {
    const p = board(['####'], [], [dom('d1', 1, 2), dom('d2', 2, 1)]);
    expect(count(p).count).toBe(1);
  });

  it('different dominoes in different places are different solutions', () => {
    const p = board(['####'], [], [dom('d1', 1, 2), dom('d2', 3, 4)]);
    expect(count(p).count).toBe(2);
  });

  it('a 2x3 board with three different dominoes: 3 tilings x 3! orders = 18', () => {
    const p = board(['###', '###'], [], [dom('a', 0, 0), dom('b', 0, 1), dom('c', 0, 2)]);
    expect(count(p).count).toBe(18);
  });

  it('swapping two dominoes inside one condition, or pairing its squares differently, is the same solution', () => {
    // A 2x2 block that is one "sum 6" condition, with the dominoes 1|2 and 2|1: whichever way the
    // squares are paired (side by side or one above the other) the condition holds the pips 1,1,2,2.
    const p = board(
      ['##', '##'],
      [{ cells: ['0,0', '0,1', '1,0', '1,1'], constraint: sum(6) }],
      [dom('d1', 1, 2), dom('d2', 2, 1)],
    );
    expect(count(p).count).toBe(1);
  });

  it('a different pip on a square outside the conditions is a different solution', () => {
    // One condition square, the rest free: which pip ends up on the free squares differs.
    const p = board(['####'], [{ cells: ['0,0'], constraint: { type: 'lt', target: 9 } }], [dom('a', 1, 2), dom('b', 3, 4)]);
    // 1|2 first: the conditioned square holds 1 or 2; 3|4 first: it holds 3 or 4 -> 4 solutions.
    expect(count(p).count).toBe(4);
  });

  it('the small fixture has exactly one solution', () => {
    expect(count(smallPuzzle()).count).toBe(1);
  });
});

describe('solution counting: unsolvable puzzles', () => {
  it('explains a cell/domino count mismatch', () => {
    const p = board(['###', '###'], [], [dom('a', 1, 1), dom('b', 2, 2)]);
    expect(countSolutions(p)).toMatchObject({ count: 0, complete: true, reason: 'The board has 6 cells, but 2 dominoes cover 4.' });
  });

  it('explains a condition that no arrangement can meet', () => {
    const p = board(['##'], [{ cells: ['0,0', '0,1'], constraint: sum(13) }], [dom('d1', 6, 6)]);
    const r = countSolutions(p);
    expect(r.count).toBe(0);
    expect(r.reason).toMatch(/"13" condition can't be met/);
  });

  it('proves a puzzle unsolvable by exhausting the search', () => {
    // Both columns need a sum of 3, but the dominoes cannot make that.
    const p = board(
      ['##', '##'],
      [
        { cells: ['0,0', '1,0'], constraint: sum(3) },
        { cells: ['0,1', '1,1'], constraint: sum(3) },
      ],
      [dom('a', 1, 2), dom('b', 3, 4)],
    );
    expect(countSolutions(p)).toMatchObject({ count: 0, complete: true });
  });

  it('knows an empty board is not a puzzle', () => {
    expect(countSolutions(board([], [], [])).reason).toMatch(/no cells/);
  });
});

describe('solution counting: limits', () => {
  const free = board(['####', '####'], [], [dom('a', 0, 1), dom('b', 0, 2), dom('c', 0, 3), dom('d', 0, 4)]);

  it('counts everything when allowed (5 tilings x 4! = 120)', () => {
    expect(count(free)).toMatchObject({ count: 120, complete: true });
  });

  it('stops at the solution limit and says the count is a minimum', () => {
    expect(countSolutions(free, { maxSolutions: 10 })).toMatchObject({ count: 10, complete: false, stoppedBy: 'limit' });
  });

  it('stops at the time limit', () => {
    const bigger = board(['######', '######'], [], [0, 1, 2, 3, 4, 5].map((v) => dom(`d${v}`, 0, v)));
    const r = countSolutions(bigger, { maxSolutions: 1e9, maxMs: 0 });
    expect(r).toMatchObject({ complete: false, stoppedBy: 'time' });
  });
});

// ---------------------------------------------------------------------------------------
// Cross-check against a brute force written separately from the solver: every tiling, every
// assignment of dominoes to tiles and every turn, judged by the engine's own `isSolved`.
// ---------------------------------------------------------------------------------------

const rowMajor = (id: string) => {
  const [r, c] = id.split(',').map(Number);
  return r * 100 + c;
};

/**
 * Identity of a solution up to the equivalences described in solver.ts, computed here from
 * the finished board: the pips in each condition, plus the pips on squares outside the
 * conditions (two such squares on one domino count as an unordered pair).
 */
function keyOf(p: Puzzle, pl: Placements): string {
  const regionOf = new Map<string, string>();
  for (const r of p.regions) if (r.constraint) for (const c of r.cells) regionOf.set(c, r.id);
  const byId = new Map(p.dominoes.map((d) => [d.id, d]));
  const inRegion = new Map<string, number[]>();
  const outside: string[] = [];
  for (const [id, t] of Object.entries(pl)) {
    const dm = byId.get(id)!;
    const [first, second, v1, v2] =
      rowMajor(t.cellA) <= rowMajor(t.cellB) ? [t.cellA, t.cellB, dm.a, dm.b] : [t.cellB, t.cellA, dm.b, dm.a];
    const r1 = regionOf.get(first);
    const r2 = regionOf.get(second);
    if (r1) inRegion.set(r1, [...(inRegion.get(r1) ?? []), v1]);
    if (r2) inRegion.set(r2, [...(inRegion.get(r2) ?? []), v2]);
    if (!r1 && !r2) outside.push(`${first}-${second}:${Math.min(v1, v2)},${Math.max(v1, v2)}`);
    else {
      if (!r1) outside.push(`${first}=${v1}`);
      if (!r2) outside.push(`${second}=${v2}`);
    }
  }
  const regions = [...inRegion.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([r, vs]) => `${r}:${vs.sort((a, b) => a - b).join(',')}`);
  return `${outside.sort().join(';')}#${regions.join('/')}`;
}

function tilings(p: Puzzle): [string, string][][] {
  const ids = [...p.cells].sort((a, b) => a.row - b.row || a.col - b.col).map((c) => c.id);
  const set = new Set(ids);
  const out: [string, string][][] = [];
  const rec = (covered: Set<string>, tiles: [string, string][]) => {
    const c = ids.find((x) => !covered.has(x));
    if (!c) {
      out.push([...tiles]);
      return;
    }
    const [r, col] = c.split(',').map(Number);
    for (const nb of [`${r},${col + 1}`, `${r + 1},${col}`]) {
      if (!set.has(nb) || covered.has(nb)) continue;
      covered.add(c);
      covered.add(nb);
      tiles.push([c, nb]);
      rec(covered, tiles);
      tiles.pop();
      covered.delete(c);
      covered.delete(nb);
    }
  };
  rec(new Set(), []);
  return out;
}

function bruteForce(p: Puzzle): Set<string> {
  const keys = new Set<string>();
  for (const tiles of tilings(p)) {
    const assign = (i: number, used: boolean[], pl: Placements) => {
      if (i === tiles.length) {
        if (isSolved(p, pl)) keys.add(keyOf(p, pl));
        return;
      }
      const [c, d] = tiles[i];
      p.dominoes.forEach((dm, k) => {
        if (used[k]) return;
        used[k] = true;
        for (const [A, B] of [
          [c, d],
          [d, c],
        ]) {
          const next = placeDomino(p, pl, dm, A, B);
          if (next) assign(i + 1, used, next);
        }
        used[k] = false;
      });
    };
    assign(0, p.dominoes.map(() => false), {});
  }
  return keys;
}

/** Small deterministic random generator, so failures are reproducible by seed. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const SHAPES = [
  ['###', '###'],
  ['####', '####'],
  ['###', '#.#', '###'],
  ['##', '##', '##', '##'],
  ['##..', '####', '..##'],
  ['###.', '####', '.###'],
];

/** A random puzzle built around a random solution, so it always has at least one. */
function randomPuzzle(seed: number): Puzzle {
  const rand = rng(seed * 7919);
  const shape = SHAPES[seed % SHAPES.length];
  const base = board(shape);
  const tiles = tilings(base);
  const tiling = tiles[Math.floor(rand() * tiles.length)];
  const values = new Map<string, number>();
  const pips = seed % 3 === 0 ? 3 : 7; // few distinct pips make duplicates and equal values common
  const dominoes: Domino[] = tiling.map(([c, d], i) => {
    const a = Math.floor(rand() * pips);
    const b = Math.floor(rand() * pips);
    values.set(c, a);
    values.set(d, b);
    return { id: `d${i + 1}`, a, b };
  });
  // Loose puzzles: squares dealt into up to four groups (or none), so many solutions.
  // Tight puzzles: nearly every square in a group of one or two with an exact condition,
  // like the real puzzles, so the solution is usually unique and the pruning does the work.
  const tight = Math.floor(seed / 6) % 2 === 1;
  const groups = new Map<number, string[]>();
  if (tight) {
    const order = base.cells.map((c) => c.id).sort(() => rand() - 0.5);
    let g = 0;
    for (let i = 0; i < order.length; ) {
      if (rand() < 0.1) {
        i++; // leave some squares without a condition
        continue;
      }
      const size = rand() < 0.5 ? 1 : 2;
      groups.set(g++, order.slice(i, i + size));
      i += size;
    }
  } else {
    for (const c of base.cells) {
      const g = Math.floor(rand() * 5) - 1; // -1 = no condition
      if (g >= 0) groups.set(g, [...(groups.get(g) ?? []), c.id]);
    }
  }
  const regions = [...groups.values()].map((cells) => {
    const vs = cells.map((c) => values.get(c)!);
    const total = vs.reduce((s, v) => s + v, 0);
    const options: Constraint[] = [sum(total), { type: 'lt', target: total + 1 + Math.floor(rand() * 2) }];
    if (total >= 1) options.push({ type: 'gt', target: total - 1 - Math.floor(rand() * Math.min(2, total)) });
    if (new Set(vs).size === 1) options.push({ type: 'eq' });
    if (new Set(vs).size === vs.length) options.push({ type: 'neq' });
    const constraint = tight && rand() < 0.75 ? options[0] : options[Math.floor(rand() * options.length)];
    return { cells, constraint };
  });
  // Shuffle the tray so its order never gives anything away.
  dominoes.sort(() => rand() - 0.5);
  return board(shape, regions, dominoes);
}

describe('solution counting agrees with a brute force', () => {
  for (let seed = 1; seed <= 60; seed++) {
    it(`random puzzle ${seed}`, () => {
      const p = randomPuzzle(seed);
      const expected = bruteForce(p);
      const r = countSolutions(p, { maxSolutions: 100000, collect: true });
      expect(r.complete).toBe(true);
      expect(r.count).toBe(expected.size);
      expect(expected.size).toBeGreaterThan(0);
      // Every solution reported is a real solution, and no two are the same.
      for (const s of r.solutions!) expect(isSolved(p, s)).toBe(true);
      const keys = new Set(r.solutions!.map((s) => keyOf(p, s)));
      expect(keys.size).toBe(r.count);
      expect(keys).toEqual(expected);
    });
  }
});

describe('the generated puzzles are a meaningful check', () => {
  it('cover tightly constrained, loosely constrained and duplicate-piece puzzles', () => {
    const puzzles = Array.from({ length: 60 }, (_, i) => randomPuzzle(i + 1));
    const counts = puzzles.map((p) => countSolutions(p, { maxSolutions: 100000 }).count);
    expect(counts.filter((c) => c <= 5).length).toBeGreaterThanOrEqual(15); // tight: few solutions, pruning decides
    expect(counts.filter((c) => c === 1).length).toBeGreaterThanOrEqual(1); // at least one unique solution
    expect(counts.filter((c) => c > 20).length).toBeGreaterThanOrEqual(10); // loose: many solutions, equivalences decide
    const hasDuplicates = (p: Puzzle) => new Set(p.dominoes.map((d) => [Math.min(d.a, d.b), Math.max(d.a, d.b)].join('|'))).size < p.dominoes.length;
    expect(puzzles.filter(hasDuplicates).length).toBeGreaterThanOrEqual(5);
  });
});
