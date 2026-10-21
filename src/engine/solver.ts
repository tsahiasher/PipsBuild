import { constraintLabel } from './constraints';
import type { CellId, Domino, Placements, Puzzle } from './types';

/**
 * Counts the distinct solutions of a puzzle.
 *
 * A solution is a way to place every domino so that all conditions hold. Arrangements are
 * the same solution when the conditions cannot tell them apart and nothing else shows a
 * difference, which means all of these hold:
 *  - every condition contains the same pips (in any order), and
 *  - every square outside the conditions holds the same pip, where a domino lying on two such
 *    squares counts the same either way round.
 * So identical dominoes swapped, a double such as 3|3 turned around, and 2|3 against 3|2 inside
 * a "sum 5" condition are each one solution, and so are two arrangements that put the same pips
 * in every condition but pair the squares into dominoes differently. Turning a domino whose two
 * squares belong to different conditions (or to one condition and to none) does change what is
 * seen, so those count separately.
 */

export interface SolveOptions {
  /** Stop once this many solutions are found. Default 1000. */
  maxSolutions?: number;
  /** Stop after this many milliseconds. Default: no time limit. */
  maxMs?: number;
  /** Also return the solutions themselves (for tests and tools; uses memory). */
  collect?: boolean;
}

export interface SolveResult {
  /** Distinct solutions found; exact when `complete`. */
  count: number;
  /** The whole search finished: `count` is exact, and 0 means the puzzle cannot be solved. */
  complete: boolean;
  /** Why the search stopped early (`count` is then "at least"). */
  stoppedBy?: 'limit' | 'time';
  /** A plain-language reason, when the puzzle is shown unsolvable without searching. */
  reason?: string;
  solutions?: Placements[];
}

const SUM = 0;
const LT = 1;
const GT = 2;
const EQ = 3;
const NEQ = 4;
const TYPE_CODE = { sum: SUM, lt: LT, gt: GT, eq: EQ, neq: NEQ } as const;

const popcount = (m: number) => {
  let c = 0;
  for (; m; m &= m - 1) c++;
  return c;
};

interface DominoType {
  lo: number;
  hi: number;
  /** Dominoes of this type not placed yet. */
  left: number;
  members: Domino[];
}

export function countSolutions(puzzle: Puzzle, options: SolveOptions = {}): SolveResult {
  const maxSolutions = options.maxSolutions ?? 1000;
  const deadline = options.maxMs === undefined ? Infinity : Date.now() + options.maxMs;
  const collect = !!options.collect;
  const unsolvable = (reason: string): SolveResult => ({ count: 0, complete: true, reason, ...(collect ? { solutions: [] } : {}) });

  const cells = [...puzzle.cells].sort((a, b) => a.row - b.row || a.col - b.col);
  const n = cells.length;
  const total = puzzle.dominoes.length;
  if (n === 0) return unsolvable('The board has no cells yet.');
  if (total === 0) return unsolvable('There are no dominoes yet.');
  if (n !== 2 * total) {
    return unsolvable(`The board has ${n} cells, but ${total} ${total === 1 ? 'domino covers' : 'dominoes cover'} ${2 * total}.`);
  }

  // ---- board
  const index = new Map<CellId, number>(cells.map((c, i) => [c.id, i]));
  const adj: number[][] = cells.map((c) =>
    [`${c.row - 1},${c.col}`, `${c.row},${c.col - 1}`, `${c.row},${c.col + 1}`, `${c.row + 1},${c.col}`].flatMap((id) => {
      const i = index.get(id);
      return i === undefined ? [] : [i];
    }),
  );

  // ---- dominoes: grouped into types, because identical pieces are interchangeable
  let valueMask = 0;
  let minV = Infinity;
  let maxV = -Infinity;
  const types: DominoType[] = [];
  const typeOf = new Map<string, DominoType>();
  for (const dm of puzzle.dominoes) {
    for (const v of [dm.a, dm.b]) {
      if (!Number.isInteger(v) || v < 0 || v > 30) return unsolvable('Every domino half must show 0 to 6 pips.');
      valueMask |= 1 << v;
      minV = Math.min(minV, v);
      maxV = Math.max(maxV, v);
    }
    const lo = Math.min(dm.a, dm.b);
    const hi = Math.max(dm.a, dm.b);
    const key = `${lo}|${hi}`;
    let t = typeOf.get(key);
    if (!t) {
      t = { lo, hi, left: 0, members: [] };
      typeOf.set(key, t);
      types.push(t);
    }
    t.left++;
    t.members.push(dm);
  }
  const valueCount = popcount(valueMask);

  // ---- conditions (regions without a condition do not constrain anything)
  const cellRegion = new Int16Array(n).fill(-1);
  const rType: number[] = [];
  const rTarget: number[] = [];
  const rLabel: string[] = [];
  for (const region of puzzle.regions) {
    const k = region.constraint;
    if (!k) continue;
    const r = rType.length;
    rType.push(TYPE_CODE[k.type]);
    rTarget.push('target' in k ? k.target : 0);
    rLabel.push(constraintLabel(k));
    for (const id of region.cells) {
      const i = index.get(id);
      if (i !== undefined) cellRegion[i] = r;
    }
  }
  const R = rType.length;
  const rLeft = new Int32Array(R);
  for (let i = 0; i < n; i++) if (cellRegion[i] >= 0) rLeft[cellRegion[i]]++;
  const rSum = new Int32Array(R);
  const rEq = new Int32Array(R).fill(-1);
  const rMask = new Int32Array(R);

  // Conditions that cannot be met whatever the arrangement, given the pips on the dominoes.
  for (let r = 0; r < R; r++) {
    const size = rLeft[r];
    if (size === 0) continue;
    const t = rTarget[r];
    const cant = (why: string) => unsolvable(`The "${rLabel[r]}" condition can't be met: ${why}`);
    const cellsText = `${size} ${size === 1 ? 'cell' : 'cells'}`;
    if (rType[r] === SUM && (size * minV > t || size * maxV < t)) {
      return cant(`${cellsText} can only add up to ${size * minV}–${size * maxV} with these dominoes.`);
    }
    if (rType[r] === LT && size * minV >= t) return cant(`${cellsText} add up to at least ${size * minV}.`);
    if (rType[r] === GT && size * maxV <= t) return cant(`${cellsText} add up to at most ${size * maxV}.`);
    if (rType[r] === NEQ && size > valueCount) {
      return cant(`${cellsText} can't all differ when the dominoes only show ${valueCount} different pip counts.`);
    }
  }

  // Would placing value `v` on one more cell of region `r` still leave the condition satisfiable?
  const canApply = (r: number, v: number): boolean => {
    const left = rLeft[r] - 1;
    const s = rSum[r] + v;
    const t = rTarget[r];
    switch (rType[r]) {
      case SUM:
        return s <= t && s + left * maxV >= t && s + left * minV <= t;
      case LT:
        return s + left * minV < t;
      case GT:
        return s + left * maxV > t;
      case EQ:
        return rEq[r] < 0 || rEq[r] === v;
      default: // NEQ
        return (rMask[r] & (1 << v)) === 0 && left <= valueCount - popcount(rMask[r]) - 1;
    }
  };
  const apply = (r: number, v: number) => {
    rLeft[r]--;
    rSum[r] += v;
    if (rEq[r] < 0) rEq[r] = v;
    rMask[r] |= 1 << v;
  };
  const undo = (r: number, v: number, prevEq: number) => {
    rLeft[r]++;
    rSum[r] -= v;
    rEq[r] = prevEq;
    rMask[r] &= ~(1 << v);
  };

  // ---- search: always cover the first free cell, trying every tile, domino and turn for it
  const covered = new Uint8Array(n);
  let first = 0;
  let nodes = 0;
  let count = 0;
  let stoppedBy: 'limit' | 'time' | undefined;
  const solutions: Placements[] = [];
  const seen = new Set<string>();
  // The tiles placed so far (cell, cell, domino type, value on the first cell), for `collect`.
  const tileC = new Int32Array(total);
  const tileD = new Int32Array(total);
  const tileT = new Int32Array(total);
  const tileV = new Int32Array(total);

  /** What the conditions (and the squares outside them) see; equal for equivalent solutions. */
  const signature = (): string => {
    const parts: string[] = [];
    const regionValues: number[][] = Array.from({ length: R }, () => []);
    for (let k = 0; k < total; k++) {
      const c = tileC[k];
      const d = tileD[k];
      const type = types[tileT[k]];
      const vc = tileV[k];
      const vd = vc === type.lo ? type.hi : type.lo;
      const rc = cellRegion[c];
      const rd = cellRegion[d];
      if (rc >= 0) regionValues[rc].push(vc);
      if (rd >= 0) regionValues[rd].push(vd);
      if (rc < 0 && rd < 0) parts.push(`${c}-${d}:${Math.min(vc, vd)},${Math.max(vc, vd)}`);
      else {
        if (rc < 0) parts.push(`${c}=${vc}`);
        if (rd < 0) parts.push(`${d}=${vd}`);
      }
    }
    parts.sort();
    return `${parts.join(';')}#${regionValues.map((v) => v.sort((a, b) => a - b).join(',')).join('/')}`;
  };

  const record = () => {
    const used = new Map<DominoType, number>();
    const placements: Placements = {};
    for (let k = 0; k < total; k++) {
      const type = types[tileT[k]];
      const m = used.get(type) ?? 0;
      used.set(type, m + 1);
      const dm = type.members[m];
      // Value `a` of the domino goes on cellA.
      const firstFirst = dm.a === tileV[k];
      const c = cells[tileC[k]].id;
      const d = cells[tileD[k]].id;
      placements[dm.id] = firstFirst ? { cellA: c, cellB: d } : { cellA: d, cellB: c };
    }
    solutions.push(placements);
  };

  const dfs = (remaining: number): void => {
    if (remaining === 0) {
      const key = signature();
      if (!seen.has(key)) {
        seen.add(key);
        count++;
        if (collect) record();
        if (count >= maxSolutions) stoppedBy = 'limit';
      }
      return;
    }
    if ((++nodes & 2047) === 0 && Date.now() >= deadline) {
      stoppedBy = 'time';
      return;
    }
    const savedFirst = first;
    let c = first;
    while (covered[c]) c++;
    first = c;
    covered[c] = 1;
    const depth = total - remaining;

    for (const d of adj[c]) {
      if (covered[d]) continue;
      covered[d] = 1;
      const rc = cellRegion[c];
      const rd = cellRegion[d];
      // Turning the domino only matters when the two squares belong to different conditions.
      const turnMatters = rc !== rd;
      for (let t = 0; t < types.length; t++) {
        const type = types[t];
        if (type.left === 0) continue;
        type.left--;
        const turns = turnMatters && type.lo !== type.hi ? 2 : 1;
        for (let turn = 0; turn < turns; turn++) {
          const vc = turn === 0 ? type.lo : type.hi;
          const vd = turn === 0 ? type.hi : type.lo;
          let eqC = 0;
          let eqD = 0;
          if (rc >= 0) {
            if (!canApply(rc, vc)) continue;
            eqC = rEq[rc];
            apply(rc, vc);
          }
          if (rd >= 0) {
            if (!canApply(rd, vd)) {
              if (rc >= 0) undo(rc, vc, eqC);
              continue;
            }
            eqD = rEq[rd];
            apply(rd, vd);
          }
          tileC[depth] = c;
          tileD[depth] = d;
          tileT[depth] = t;
          tileV[depth] = vc;
          dfs(remaining - 1);
          if (rd >= 0) undo(rd, vd, eqD);
          if (rc >= 0) undo(rc, vc, eqC);
          if (stoppedBy) break;
        }
        type.left++;
        if (stoppedBy) break;
      }
      covered[d] = 0;
      if (stoppedBy) break;
    }
    covered[c] = 0;
    first = savedFirst;
  };

  dfs(total);

  return {
    count,
    complete: !stoppedBy,
    ...(stoppedBy ? { stoppedBy } : {}),
    ...(collect ? { solutions } : {}),
  };
}
