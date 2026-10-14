import { normalizePuzzle, makeCells } from './puzzle';
import type { Constraint, Puzzle } from './types';

/** On-disk format for a saved puzzle (the play state is not included). */
export interface PuzzleFile {
  format: 'pips-build-puzzle';
  version: 1;
  name?: string;
  rows: number;
  cols: number;
  /** Playable cells as "row,col". */
  cells: string[];
  regions: { color: number; cells: string[]; condition: string | null }[];
  /** Dominoes as [a, b] pairs. */
  dominoes: [number, number][];
}

const FORMAT = 'pips-build-puzzle';
/** Files saved before the app was renamed. */
const LEGACY_FORMATS = ['pip-studio-puzzle'];

export function serializePuzzle(p: Puzzle): string {
  const file: PuzzleFile = {
    format: FORMAT,
    version: 1,
    ...(p.name ? { name: p.name } : {}),
    rows: p.rows,
    cols: p.cols,
    cells: p.cells.map((c) => c.id),
    regions: p.regions.map((r) => ({ color: r.color, cells: r.cells, condition: conditionText(r.constraint) })),
    dominoes: p.dominoes.map((d) => [d.a, d.b]),
  };
  return JSON.stringify(file, null, 2);
}

function conditionText(c: Constraint | null): string | null {
  if (!c) return null;
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

function parseCondition(text: unknown): Constraint | null {
  if (text === null || text === undefined || text === '') return null;
  if (typeof text !== 'string') throw new Error('A region condition must be text such as "11", "<4", ">2", "=" or "≠".');
  const t = text.trim();
  if (t === '=') return { type: 'eq' };
  if (t === '≠' || t === '!=') return { type: 'neq' };
  const m = /^([<>]?)(\d{1,2})$/.exec(t);
  if (!m) throw new Error(`Unknown condition "${text}".`);
  const target = Number(m[2]);
  return m[1] === '<' ? { type: 'lt', target } : m[1] === '>' ? { type: 'gt', target } : { type: 'sum', target };
}

const CELL = /^\d{1,2},\d{1,2}$/;

/** Parses and validates a saved puzzle file. Throws an Error with a readable message. */
export function parsePuzzleFile(json: string): Puzzle {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error('This file is not valid JSON.');
  }
  const f = raw as Partial<PuzzleFile>;
  if (!f || typeof f !== 'object' || (f.format !== FORMAT && !LEGACY_FORMATS.includes(String(f.format)))) {
    throw new Error('This is not a Pips Build puzzle file.');
  }
  if (f.version !== 1) throw new Error(`Unsupported puzzle file version (${String(f.version)}).`);
  if (!Array.isArray(f.cells) || !f.cells.every((c) => typeof c === 'string' && CELL.test(c))) {
    throw new Error('The puzzle file has invalid cells.');
  }
  const cells = new Set(f.cells);
  const regions = (Array.isArray(f.regions) ? f.regions : []).map((r, i) => {
    if (!r || !Array.isArray(r.cells) || !r.cells.every((c) => typeof c === 'string' && cells.has(c))) {
      throw new Error(`Region ${i + 1} refers to cells that are not on the board.`);
    }
    return {
      id: `r${i + 1}`,
      color: Number.isInteger(r.color) ? r.color : i,
      cells: [...new Set(r.cells)],
      constraint: parseCondition(r.condition),
    };
  });
  if (!Array.isArray(f.dominoes)) throw new Error('The puzzle file has no dominoes.');
  const dominoes = f.dominoes.map((d, i) => {
    if (!Array.isArray(d) || d.length !== 2 || !d.every((v) => Number.isInteger(v) && v >= 0 && v <= 6)) {
      throw new Error(`Domino ${i + 1} must be a pair of pip counts from 0 to 6.`);
    }
    return { id: `d${i + 1}`, a: d[0], b: d[1] };
  });
  const max = (k: 0 | 1) => Math.max(0, ...f.cells!.map((c) => Number(c.split(',')[k]) + 1));
  return normalizePuzzle({
    id: '',
    ...(typeof f.name === 'string' && f.name ? { name: f.name } : {}),
    rows: Math.max(Number(f.rows) || 0, max(0)),
    cols: Math.max(Number(f.cols) || 0, max(1)),
    cells: makeCells(cells),
    regions,
    dominoes,
  });
}
