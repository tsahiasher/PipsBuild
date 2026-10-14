import { anchorOf, areAdjacent, cellId, cellSet, cellsForRotation, parseCellId, rotationOf } from './geometry';
import type { CellId, Domino, Placement, Placements, Puzzle, Rotation } from './types';

export type PlacementError = 'missing-cell' | 'same-cell' | 'not-adjacent' | 'occupied' | 'unknown-domino';

/** Map cell -> id of the domino occupying it, optionally ignoring one domino. */
export function occupancy(placements: Placements, ignoreId?: string): Map<CellId, string> {
  const occ = new Map<CellId, string>();
  for (const [id, p] of Object.entries(placements)) {
    if (id === ignoreId) continue;
    occ.set(p.cellA, id);
    occ.set(p.cellB, id);
  }
  return occ;
}

export function placementError(
  puzzle: Puzzle,
  placements: Placements,
  domino: Domino,
  cellA: CellId,
  cellB: CellId,
): PlacementError | null {
  if (!puzzle.dominoes.some((d) => d.id === domino.id)) return 'unknown-domino';
  const cells = cellSet(puzzle);
  if (!cells.has(cellA) || !cells.has(cellB)) return 'missing-cell';
  if (cellA === cellB) return 'same-cell';
  // Adjacent playable cells are always in the same board component, so this also
  // rules out bridging holes or separate components.
  if (!areAdjacent(cellA, cellB)) return 'not-adjacent';
  const occ = occupancy(placements, domino.id);
  if (occ.has(cellA) || occ.has(cellB)) return 'occupied';
  return null;
}

/** True when the domino may occupy the two cells (moving it if it is already on the board). */
export function canPlaceDomino(
  puzzle: Puzzle,
  placements: Placements,
  domino: Domino,
  cellA: CellId,
  cellB: CellId,
): boolean {
  return placementError(puzzle, placements, domino, cellA, cellB) === null;
}

/** Returns new placements with the domino placed, or null if illegal. */
export function placeDomino(
  puzzle: Puzzle,
  placements: Placements,
  domino: Domino,
  cellA: CellId,
  cellB: CellId,
): Placements | null {
  if (!canPlaceDomino(puzzle, placements, domino, cellA, cellB)) return null;
  return { ...placements, [domino.id]: { cellA, cellB } };
}

export function removeDomino(placements: Placements, dominoId: string): Placements {
  if (!(dominoId in placements)) return placements;
  const next = { ...placements };
  delete next[dominoId];
  return next;
}

/**
 * Rotates a placement a quarter turn clockwise around a fixed pivot cell (one of its two
 * cells); the other half moves right -> below -> left -> above. Keeping the same pivot,
 * four rotations return to the original placement. The pivot defaults to the top/left cell.
 */
export function rotatePlacement(p: Placement, pivot: CellId = anchorOf(p.cellA, p.cellB)): Placement {
  if (rotationOf(p.cellA, p.cellB) === null) return p;
  const other = pivot === p.cellA ? p.cellB : pivot === p.cellB ? p.cellA : null;
  if (other === null) return p;
  const a = parseCellId(pivot);
  const b = parseCellId(other);
  // Clockwise on screen (rows grow downwards): (dr, dc) -> (dc, -dr).
  const moved = cellId(a.row + (b.col - a.col), a.col - (b.row - a.row));
  return pivot === p.cellA ? { cellA: pivot, cellB: moved } : { cellA: moved, cellB: pivot };
}

/** Rotates a placed domino in place. Returns null if the rotated position is illegal. */
export function rotateDomino(puzzle: Puzzle, placements: Placements, domino: Domino): Placements | null {
  const p = placements[domino.id];
  if (!p) return null;
  const r = rotatePlacement(p);
  return placeDomino(puzzle, placements, domino, r.cellA, r.cellB);
}

export function placementFor(anchor: CellId, rotation: Rotation): Placement {
  return cellsForRotation(anchor, rotation);
}

/** Value shown on each playable cell (null when empty). */
export function getBoardValues(puzzle: Puzzle, placements: Placements): Map<CellId, number | null> {
  const values = new Map<CellId, number | null>();
  for (const c of puzzle.cells) values.set(c.id, null);
  const byId = new Map(puzzle.dominoes.map((d) => [d.id, d]));
  for (const [id, p] of Object.entries(placements)) {
    const d = byId.get(id);
    if (!d) continue;
    values.set(p.cellA, d.a);
    values.set(p.cellB, d.b);
  }
  return values;
}

export function unusedDominoes(puzzle: Puzzle, placements: Placements): Domino[] {
  return puzzle.dominoes.filter((d) => !placements[d.id]);
}
