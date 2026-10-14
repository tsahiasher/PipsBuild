import type { Cell, CellId, Puzzle, Rotation } from './types';

export const cellId = (row: number, col: number): CellId => `${row},${col}`;

export function parseCellId(id: CellId): { row: number; col: number } {
  const [r, c] = id.split(',');
  return { row: Number(r), col: Number(c) };
}

export function cellSet(puzzle: Puzzle): Set<CellId> {
  return new Set(puzzle.cells.map((c) => c.id));
}

export function areAdjacent(a: CellId, b: CellId): boolean {
  const p = parseCellId(a);
  const q = parseCellId(b);
  return Math.abs(p.row - q.row) + Math.abs(p.col - q.col) === 1;
}

export function neighbors(id: CellId): CellId[] {
  const { row, col } = parseCellId(id);
  return [cellId(row - 1, col), cellId(row + 1, col), cellId(row, col - 1), cellId(row, col + 1)];
}

/** Connected components of playable cells (orthogonal adjacency). */
export function boardComponents(cells: Cell[]): CellId[][] {
  const all = new Set(cells.map((c) => c.id));
  const seen = new Set<CellId>();
  const out: CellId[][] = [];
  for (const c of cells) {
    if (seen.has(c.id)) continue;
    const comp: CellId[] = [];
    const stack = [c.id];
    seen.add(c.id);
    while (stack.length) {
      const cur = stack.pop()!;
      comp.push(cur);
      for (const n of neighbors(cur)) {
        if (all.has(n) && !seen.has(n)) {
          seen.add(n);
          stack.push(n);
        }
      }
    }
    out.push(comp);
  }
  return out;
}

/** Cells covered by a domino whose top/left cell is `anchor` with the given rotation. */
export function cellsForRotation(anchor: CellId, rotation: Rotation): { cellA: CellId; cellB: CellId } {
  const { row, col } = parseCellId(anchor);
  const other = rotation % 2 === 0 ? cellId(row, col + 1) : cellId(row + 1, col);
  return rotation === 0 || rotation === 1 ? { cellA: anchor, cellB: other } : { cellA: other, cellB: anchor };
}

/** Rotation implied by where A and B sit. Returns null if the cells are not adjacent. */
export function rotationOf(cellA: CellId, cellB: CellId): Rotation | null {
  const a = parseCellId(cellA);
  const b = parseCellId(cellB);
  if (a.row === b.row && b.col === a.col + 1) return 0;
  if (a.col === b.col && b.row === a.row + 1) return 1;
  if (a.row === b.row && b.col === a.col - 1) return 2;
  if (a.col === b.col && b.row === a.row - 1) return 3;
  return null;
}

/** The top-most / left-most of the two cells. */
export function anchorOf(cellA: CellId, cellB: CellId): CellId {
  const a = parseCellId(cellA);
  const b = parseCellId(cellB);
  return a.row < b.row || (a.row === b.row && a.col < b.col) ? cellA : cellB;
}

export const nextRotation = (r: Rotation): Rotation => (((r + 1) % 4) as Rotation);
