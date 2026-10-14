/** Cell identifier, always formatted as "row,col". */
export type CellId = string;

export interface Cell {
  id: CellId;
  row: number;
  col: number;
}

export type Constraint =
  | { type: 'sum'; target: number }
  | { type: 'lt'; target: number }
  | { type: 'gt'; target: number }
  | { type: 'eq' }
  | { type: 'neq' };

export type ConstraintType = Constraint['type'];

export interface Region {
  id: string;
  /** Index into the region palette (display only). */
  color: number;
  cells: CellId[];
  constraint: Constraint | null;
}

/** A physical domino. Two dominoes with equal values are still distinct pieces. */
export interface Domino {
  id: string;
  a: number;
  b: number;
}

export interface Puzzle {
  id: string;
  name?: string;
  rows: number;
  cols: number;
  cells: Cell[];
  regions: Region[];
  dominoes: Domino[];
}

/** A domino on the board: value `a` sits on `cellA`, value `b` on `cellB`. */
export interface Placement {
  cellA: CellId;
  cellB: CellId;
}

export type Placements = Record<string, Placement>;

/**
 * Quarter-turn rotation of a domino, clockwise.
 * 0: horizontal, A left | 1: vertical, A top | 2: horizontal, A right | 3: vertical, A bottom
 */
export type Rotation = 0 | 1 | 2 | 3;
