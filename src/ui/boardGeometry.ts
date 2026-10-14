import { parseCellId } from '../engine/geometry';
import type { CellId } from '../engine/types';
import { U } from './theme';

type Pt = [number, number];

/**
 * Outline loops of a set of grid cells (in board units), clockwise on screen with the
 * interior on the right of the direction of travel. Holes produce extra loops.
 */
export function outlineLoops(cells: CellId[]): Pt[][] {
  const edges = new Map<string, Pt[]>(); // key "x,y>x2,y2"
  const key = (a: Pt, b: Pt) => `${a[0]},${a[1]}>${b[0]},${b[1]}`;
  const add = (a: Pt, b: Pt) => {
    const rev = key(b, a);
    if (edges.has(rev)) edges.delete(rev);
    else edges.set(key(a, b), [a, b]);
  };
  for (const id of cells) {
    const { row: r, col: c } = parseCellId(id);
    add([c, r], [c + 1, r]);
    add([c + 1, r], [c + 1, r + 1]);
    add([c + 1, r + 1], [c, r + 1]);
    add([c, r + 1], [c, r]);
  }
  const byStart = new Map<string, Pt[][]>();
  for (const e of edges.values()) {
    const k = `${e[0][0]},${e[0][1]}`;
    if (!byStart.has(k)) byStart.set(k, []);
    byStart.get(k)!.push(e);
  }
  const used = new Set<Pt[]>();
  const loops: Pt[][] = [];
  for (const start of edges.values()) {
    if (used.has(start)) continue;
    const loop: Pt[] = [];
    let e = start;
    while (!used.has(e)) {
      used.add(e);
      loop.push(e[0]);
      const options = (byStart.get(`${e[1][0]},${e[1][1]}`) ?? []).filter((o) => !used.has(o));
      if (options.length === 0) break;
      // At pinch points prefer the right turn so loops stay separate.
      const dir: Pt = [e[1][0] - e[0][0], e[1][1] - e[0][1]];
      const right: Pt = [-dir[1], dir[0]];
      e = options.find((o) => o[1][0] - o[0][0] === right[0] && o[1][1] - o[0][1] === right[1]) ?? options[0];
    }
    loops.push(simplify(loop));
  }
  return loops;
}

function simplify(loop: Pt[]): Pt[] {
  const out: Pt[] = [];
  const n = loop.length;
  for (let i = 0; i < n; i++) {
    const p = loop[(i - 1 + n) % n];
    const c = loop[i];
    const q = loop[(i + 1) % n];
    const collinear = (c[0] - p[0]) * (q[1] - c[1]) - (c[1] - p[1]) * (q[0] - c[0]) === 0;
    if (!collinear) out.push(c);
  }
  return out;
}

/** Offsets an orthogonal loop inward by d board units, returning an SVG path segment. */
export function insetPath(loops: Pt[][], d: number): string {
  return loops
    .map((loop) => {
      const n = loop.length;
      const pts = loop.map((v, i) => {
        const prev = loop[(i - 1 + n) % n];
        const next = loop[(i + 1) % n];
        const nIn = normal(prev, v);
        const nOut = normal(v, next);
        return [(v[0] * U + d * (nIn[0] + nOut[0])), (v[1] * U + d * (nIn[1] + nOut[1]))];
      });
      return 'M' + pts.map((p) => `${round(p[0])} ${round(p[1])}`).join('L') + 'Z';
    })
    .join('');
}

function normal(a: Pt, b: Pt): Pt {
  const dx = Math.sign(b[0] - a[0]);
  const dy = Math.sign(b[1] - a[1]);
  return [-dy, dx];
}

const round = (v: number) => Math.round(v * 10) / 10;

export interface Bounds {
  minRow: number;
  minCol: number;
  maxRow: number;
  maxCol: number;
}

export function cellBounds(cells: { row: number; col: number }[]): Bounds {
  if (cells.length === 0) return { minRow: 0, minCol: 0, maxRow: 0, maxCol: 0 };
  return {
    minRow: Math.min(...cells.map((c) => c.row)),
    minCol: Math.min(...cells.map((c) => c.col)),
    maxRow: Math.max(...cells.map((c) => c.row)),
    maxCol: Math.max(...cells.map((c) => c.col)),
  };
}
