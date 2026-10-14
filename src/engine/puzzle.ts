import { boardComponents, cellId, parseCellId } from './geometry';
import { duplicateDominoes } from './dominoes';
import type { Cell, CellId, Constraint, Puzzle, Region } from './types';

export interface ConsistencyIssue {
  level: 'error' | 'warning';
  message: string;
}

export function makeCells(ids: Iterable<CellId>): Cell[] {
  return [...new Set(ids)]
    .map((id) => ({ id, ...parseCellId(id) }))
    .sort((a, b) => a.row - b.row || a.col - b.col);
}

/** Basic checks run before Play mode is allowed. */
export function checkConsistency(puzzle: Puzzle): ConsistencyIssue[] {
  const issues: ConsistencyIssue[] = [];
  const n = puzzle.cells.length;
  const d = puzzle.dominoes.length;
  if (n === 0) issues.push({ level: 'error', message: 'The board has no playable cells.' });
  if (d === 0) issues.push({ level: 'error', message: 'There are no dominoes.' });
  if (n !== 2 * d && n > 0 && d > 0) {
    issues.push({
      level: 'error',
      message: `${n} playable cells detected, but ${d} dominoes ${n > 2 * d ? 'only ' : ''}cover ${2 * d} cells.`,
    });
  }
  for (const comp of boardComponents(puzzle.cells)) {
    if (comp.length % 2 === 1) {
      issues.push({
        level: 'error',
        message: `A board piece has an odd number of cells (${comp.length}); dominoes cannot cover it.`,
      });
    }
  }
  const cells = new Set(puzzle.cells.map((c) => c.id));
  const seen = new Set<CellId>();
  for (const r of puzzle.regions) {
    for (const c of r.cells) {
      if (!cells.has(c)) issues.push({ level: 'error', message: `Region ${r.id} contains a non-playable cell.` });
      if (seen.has(c)) issues.push({ level: 'error', message: `Cell ${c} belongs to more than one region.` });
      seen.add(c);
    }
    const c = r.constraint;
    if (c && 'target' in c && (!Number.isFinite(c.target) || c.target < 0)) {
      issues.push({ level: 'error', message: `Region ${r.id} has an invalid target.` });
    }
  }
  for (const k of duplicateDominoes(puzzle.dominoes)) {
    issues.push({ level: 'error', message: `Domino ${k} is used more than once; each domino can appear only once.` });
  }
  for (const dm of puzzle.dominoes) {
    if (![dm.a, dm.b].every((v) => Number.isInteger(v) && v >= 0 && v <= 6)) {
      issues.push({ level: 'error', message: `Domino ${dm.id} has invalid pip values.` });
    }
  }
  return issues;
}

/** Drop empty regions, cells that left the board, and renormalise bounds/ids. */
export function normalizePuzzle(p: Puzzle): Puzzle {
  const cells = new Set(p.cells.map((c) => c.id));
  const regions: Region[] = p.regions
    .map((r) => ({ ...r, cells: r.cells.filter((c) => cells.has(c)) }))
    .filter((r) => r.cells.length > 0);
  let rows = 0;
  let cols = 0;
  for (const c of p.cells) {
    rows = Math.max(rows, c.row + 1);
    cols = Math.max(cols, c.col + 1);
  }
  const base = { ...p, rows: Math.max(rows, p.rows), cols: Math.max(cols, p.cols), regions, cells: makeCells(cells) };
  return { ...base, id: puzzleHash(base) };
}

/** Stable content hash so a game can be matched to the puzzle it belongs to. */
export function puzzleHash(p: Omit<Puzzle, 'id'>): string {
  const key = JSON.stringify({
    cells: p.cells.map((c) => c.id).sort(),
    regions: p.regions
      .map((r) => ({ c: [...r.cells].sort(), k: r.constraint }))
      .sort((a, b) => (a.c[0] < b.c[0] ? -1 : 1)),
    dominoes: p.dominoes.map((d) => [d.a, d.b]),
  });
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return 'p' + (h >>> 0).toString(36);
}

/** The cell whose bottom-right corner holds the region's condition badge (lowest row, then rightmost). */
export function badgeCell(region: Region): CellId | null {
  let best: { row: number; col: number } | null = null;
  for (const id of region.cells) {
    const p = parseCellId(id);
    if (!best || p.row > best.row || (p.row === best.row && p.col > best.col)) best = p;
  }
  return best ? cellId(best.row, best.col) : null;
}

export function parseConstraint(text: string): Constraint | null {
  const t = text.trim().replace(/\s+/g, '');
  if (t === '') return null;
  if (t === '=') return { type: 'eq' };
  if (t === '≠' || t === '!=' || t === '!') return { type: 'neq' };
  let m = /^<(\d{1,2})$/.exec(t);
  if (m) return { type: 'lt', target: Number(m[1]) };
  m = /^>(\d{1,2})$/.exec(t);
  if (m) return { type: 'gt', target: Number(m[1]) };
  m = /^(\d{1,2})$/.exec(t);
  if (m) return { type: 'sum', target: Number(m[1]) };
  return null;
}
