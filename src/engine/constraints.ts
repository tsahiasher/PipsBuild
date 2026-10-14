import { getBoardValues, unusedDominoes } from './placement';
import type { CellId, Constraint, Placements, Puzzle, Region } from './types';

export interface RegionEvaluation {
  /** Every cell in the region has a value. */
  complete: boolean;
  /** Complete: condition satisfied. Incomplete: not currently known to be violated. */
  valid: boolean;
  /** The partial state can no longer satisfy the condition. */
  impossible: boolean;
}

export const MAX_PIP = 6;

export function evaluateConstraint(constraint: Constraint | null, values: (number | null)[]): RegionEvaluation {
  const placed = values.filter((v): v is number => v !== null);
  const missing = values.length - placed.length;
  const complete = missing === 0;
  if (!constraint) return { complete, valid: true, impossible: false };
  const sum = placed.reduce((s, v) => s + v, 0);

  let impossible: boolean;
  let satisfied: boolean;
  switch (constraint.type) {
    case 'sum':
      satisfied = sum === constraint.target;
      impossible = sum > constraint.target || sum + missing * MAX_PIP < constraint.target;
      break;
    case 'lt':
      satisfied = sum < constraint.target;
      impossible = sum >= constraint.target;
      break;
    case 'gt':
      satisfied = sum > constraint.target;
      impossible = sum + missing * MAX_PIP <= constraint.target;
      break;
    case 'eq':
      satisfied = new Set(placed).size <= 1;
      impossible = !satisfied;
      break;
    case 'neq': {
      satisfied = new Set(placed).size === placed.length;
      impossible = !satisfied || values.length > MAX_PIP + 1;
      break;
    }
  }
  if (complete) return { complete, valid: satisfied, impossible: !satisfied };
  return { complete, valid: !impossible, impossible };
}

export function evaluateRegion(region: Region, boardValues: Map<CellId, number | null>): RegionEvaluation {
  return evaluateConstraint(
    region.constraint,
    region.cells.map((c) => boardValues.get(c) ?? null),
  );
}

export function evaluateAll(puzzle: Puzzle, placements: Placements): Map<string, RegionEvaluation> {
  const values = getBoardValues(puzzle, placements);
  return new Map(puzzle.regions.map((r) => [r.id, evaluateRegion(r, values)]));
}

/** Region ids whose conditions are violated (complete & wrong, or provably impossible). */
export function violatedRegions(puzzle: Puzzle, placements: Placements): Set<string> {
  const out = new Set<string>();
  for (const [id, ev] of evaluateAll(puzzle, placements)) if (!ev.valid) out.add(id);
  return out;
}

export function isBoardFull(puzzle: Puzzle, placements: Placements): boolean {
  const values = getBoardValues(puzzle, placements);
  for (const v of values.values()) if (v === null) return false;
  return true;
}

export function isSolved(puzzle: Puzzle, placements: Placements): boolean {
  if (unusedDominoes(puzzle, placements).length > 0) return false;
  if (!isBoardFull(puzzle, placements)) return false;
  for (const ev of evaluateAll(puzzle, placements).values()) if (!ev.complete || !ev.valid) return false;
  return true;
}

export function describeConstraint(c: Constraint | null): string {
  if (!c) return 'No condition';
  switch (c.type) {
    case 'sum':
      return `Region sum must equal ${c.target}`;
    case 'lt':
      return `Region sum must be less than ${c.target}`;
    case 'gt':
      return `Region sum must be greater than ${c.target}`;
    case 'eq':
      return 'All values in the region must be equal';
    case 'neq':
      return 'All values in the region must be different';
  }
}

export function constraintLabel(c: Constraint | null): string {
  if (!c) return '';
  switch (c.type) {
    case 'sum':
      return String(c.target);
    case 'lt':
      return `<${c.target}`;
    case 'gt':
      return `>${c.target}`;
    case 'eq':
      return '=';
    case 'neq':
      return '≠';
  }
}
