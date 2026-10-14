/**
 * Screenshot -> Puzzle reconstruction. Pure TypeScript, no DOM: runs in a Web Worker
 * in the browser and directly in Node for tests.
 *
 * All measurements are normalised by the detected cell pitch; nothing depends on the
 * screenshot resolution or on where the puzzle sits in the image.
 */
import { badgeCell, makeCells, normalizePuzzle, parseConstraint } from '../engine/puzzle';
import { cellId } from '../engine/geometry';
import type { CellId, Domino, Puzzle, Region } from '../engine/types';
import { classifyGlyph, glyphFeatures, type GlyphFeatures } from './glyphs';
import {
  compH,
  compW,
  deltaE,
  labAt,
  labelComponents,
  median,
  open,
  rgbToLab,
  toLab,
  type Component,
  type Lab,
  type LabImage,
  type Mask,
  type RGBAImage,
} from './image';
import { nearestPaletteIndex } from './palette';

export type ProgressStage =
  | 'Analyzing image…'
  | 'Detecting board…'
  | 'Finding regions…'
  | 'Detecting dominoes…'
  | 'Recognizing conditions…'
  | 'Building puzzle…';

export interface DetectedDomino {
  x: number;
  y: number;
  w: number;
  h: number;
  a: number;
  b: number;
  confidence: number;
}

export interface DetectedBadge {
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  regionId: string | null;
  confidence: number;
  glyphs: GlyphFeatures[];
  /** Image-pixel bounding box of each glyph (same order as `glyphs`). */
  glyphBoxes: { x0: number; y0: number; x1: number; y1: number }[];
  /** Grid corner (row, col) of the badge centre, i.e. bottom-right of cell (row-1, col-1). */
  corner: { row: number; col: number };
}

export interface Geometry {
  /** Image-pixel position of the top-left of grid cell (0,0). */
  originX: number;
  originY: number;
  pitch: number;
}

export interface RecognitionResult {
  puzzle: Puzzle;
  geometry: Geometry;
  imageWidth: number;
  imageHeight: number;
  dominoes: DetectedDomino[];
  badges: DetectedBadge[];
  confidence: {
    overall: number;
    cells: number;
    regions: number;
    conditions: number;
    dominoes: number;
  };
  /** Cells whose playable/not-playable decision was uncertain. */
  uncertainCells: CellId[];
  warnings: string[];
}

export interface RecognizeOptions {
  onProgress?: (stage: ProgressStage, fraction: number) => void | Promise<void>;
  /** Skip glyph classification (used when building templates). */
  skipClassification?: boolean;
}

// Reference colours of the board frame and of empty (unconstrained) cells.
const FRAME = rgbToLab(217, 196, 184);
const NEUTRAL = rgbToLab(223, 204, 197);
/** Frame margin around cells, as a fraction of the cell pitch. */
const MARGIN = 0.053;
/** Typical tray domino width as a multiple of the board cell pitch. */
const DOMINO_W_PER_PITCH = 1.45;
/** Same-region seams score >= 0.7 on references, region boundaries <= 0.35. */
const SEAM_THRESHOLD = 0.53;

const isStrong = (lab: LabImage, i: number) => lab.L[i] < 68 && lab.C[i] > 20;

export async function recognize(img: RGBAImage, opts: RecognizeOptions = {}): Promise<RecognitionResult> {
  const progress = async (s: ProgressStage, f: number) => {
    await opts.onProgress?.(s, f);
  };
  const warnings: string[] = [];
  await progress('Analyzing image…', 0.05);
  const lab = toLab(img);
  const { width: w, height: h } = img;

  await progress('Detecting dominoes…', 0.2);
  const dominoes = detectDominoes(lab);
  if (dominoes.length === 0) warnings.push('No dominoes were found in the screenshot.');

  await progress('Detecting board…', 0.35);
  const board = detectBoard(lab);
  if (board.pieces.length === 0) throw new Error('Could not find a puzzle board in this image.');

  const domW = median(dominoes.map((d) => Math.max(d.w, d.h)));
  const grid = fitGrid(board.pieces, dominoes.length, domW, board.cellMask, w);
  const { pitch } = grid;

  // Playable cells.
  const cellBoxes = new Map<CellId, { x: number; y: number }>();
  const uncertain: CellId[] = [];
  let clarity = 0;
  let clarityN = 0;
  for (const pc of grid.pieces) {
    for (let r = 0; r < pc.rows; r++) {
      for (let c = 0; c < pc.cols; c++) {
        const x = pc.x + c * pitch;
        const y = pc.y + r * pitch;
        const cov = coverage(board.cellMask, w, h, x + 0.3 * pitch, y + 0.3 * pitch, 0.4 * pitch);
        clarity += Math.abs(cov - 0.5) * 2;
        clarityN++;
        const id = cellId(pc.row0 + r, pc.col0 + c);
        if (cov > 0.2 && cov < 0.8) uncertain.push(id);
        if (cov >= 0.5) cellBoxes.set(id, { x, y });
      }
    }
  }
  const cellConfidence = clarityN ? clarity / clarityN : 0;

  await progress('Finding regions…', 0.55);
  // Cell colours.
  const cellColor = new Map<CellId, Lab>();
  for (const [id, b] of cellBoxes) cellColor.set(id, sampleColor(lab, b.x, b.y, pitch));
  const neutral = new Set<CellId>();
  for (const [id, col] of cellColor) if (deltaE(col, NEUTRAL) < 9 || deltaE(col, FRAME) < 7) neutral.add(id);

  // Union adjacent cells that share a region (same colour and no boundary between them).
  const parent = new Map<CellId, CellId>();
  const find = (x: CellId): CellId => {
    let p = parent.get(x) ?? x;
    if (p !== x) {
      p = find(p);
      parent.set(x, p);
    }
    return p;
  };
  let linkMargins: number[] = [];
  for (const [id, b] of cellBoxes) {
    if (neutral.has(id)) continue;
    const [r, c] = id.split(',').map(Number);
    for (const [dr, dc] of [
      [0, 1],
      [1, 0],
    ]) {
      const nid = cellId(r + dr, c + dc);
      if (!cellBoxes.has(nid) || neutral.has(nid)) continue;
      const ca = cellColor.get(id)!;
      const cb = cellColor.get(nid)!;
      // Cells of one region are joined by a seam in their own colour; region boundaries
      // show the frame gap and dashed borders instead. Very different colours never join.
      if (deltaE(ca, cb) > 25) continue;
      const frac = Math.min(
        seamSimilarity(lab, b.x, b.y, pitch, dc === 1, ca),
        seamSimilarity(lab, b.x, b.y, pitch, dc === 1, cb),
      );
      linkMargins.push(Math.min(1, Math.abs(frac - SEAM_THRESHOLD) / 0.18));
      if (frac > SEAM_THRESHOLD) parent.set(find(nid), find(id));
    }
  }
  const groups = new Map<CellId, CellId[]>();
  for (const id of cellBoxes.keys()) {
    if (neutral.has(id)) continue;
    const root = find(id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(id);
  }
  const regions: Region[] = [];
  const regionOf = new Map<CellId, Region>();
  let n = 0;
  for (const cells of groups.values()) {
    const avg: Lab = [0, 0, 0];
    for (const c of cells) {
      const col = cellColor.get(c)!;
      avg[0] += col[0] / cells.length;
      avg[1] += col[1] / cells.length;
      avg[2] += col[2] / cells.length;
    }
    const region: Region = { id: `r${++n}`, color: nearestPaletteIndex(avg), cells, constraint: null };
    regions.push(region);
    for (const c of cells) regionOf.set(c, region);
  }
  regions.sort((a, b) => cmpCell(badgeCell(a)!, badgeCell(b)!));
  regions.forEach((r, i) => (r.id = `r${i + 1}`));

  await progress('Recognizing conditions…', 0.75);
  const badges = detectBadges(lab, grid, board.boardMask);
  let condConf = 1;
  for (const bd of badges) {
    // Badge sits on the bottom-right corner of its region's last cell.
    const cands: CellId[] = [
      cellId(bd.corner.row - 1, bd.corner.col - 1),
      cellId(bd.corner.row - 1, bd.corner.col),
      cellId(bd.corner.row, bd.corner.col - 1),
      cellId(bd.corner.row, bd.corner.col),
    ];
    const badgeLab = bd.color;
    let best: Region | null = null;
    let bestScore = Infinity;
    cands.forEach((cid, k) => {
      const reg = regionOf.get(cid);
      if (!reg || reg.constraint || badgeCell(reg) !== cid) return;
      const score = hueDistance(badgeLab, cellColor.get(cid)!) + k * 25;
      if (score < bestScore) {
        bestScore = score;
        best = reg;
      }
    });
    const reg = best as Region | null;
    if (!opts.skipClassification) {
      const cls = bd.glyphs.map((g) => classifyGlyph(g));
      bd.text = cls.map((c) => c.ch).join('');
      bd.confidence = cls.length ? Math.min(...cls.map((c) => c.confidence)) : 0;
      const constraint = parseConstraint(bd.text);
      if (!constraint) {
        warnings.push(`Could not read a condition badge ("${bd.text}").`);
        bd.confidence = 0;
      }
      if (reg && constraint) {
        reg.constraint = constraint;
        bd.regionId = reg.id;
      }
    } else if (reg) {
      bd.regionId = reg.id;
    }
    if (!reg) warnings.push('A condition badge could not be matched to a region.');
    condConf = Math.min(condConf, reg ? bd.confidence : 0);
  }

  await progress('Building puzzle…', 0.9);
  const ordered = [...dominoes].sort((p, q) => (Math.abs(p.y - q.y) > p.h / 2 ? p.y - q.y : p.x - q.x));
  const pieces: Domino[] = ordered.map((d, i) => ({ id: `d${i + 1}`, a: d.a, b: d.b }));
  const puzzle = normalizePuzzle({
    id: '',
    rows: grid.rows,
    cols: grid.cols,
    cells: makeCells(cellBoxes.keys()),
    regions,
    dominoes: pieces,
  });

  const dominoConf = dominoes.length ? Math.min(...dominoes.map((d) => d.confidence)) : 0;
  const regionConf = linkMargins.length ? Math.min(...linkMargins) : 1;
  linkMargins = [];
  const confidence = {
    cells: round2(cellConfidence),
    regions: round2(regionConf),
    conditions: round2(badges.length ? condConf : 1),
    dominoes: round2(dominoConf),
    overall: 0,
  };
  confidence.overall = round2(Math.min(confidence.cells, confidence.regions, confidence.conditions, confidence.dominoes));
  await progress('Building puzzle…', 1);

  return {
    puzzle,
    geometry: { originX: grid.originX, originY: grid.originY, pitch },
    imageWidth: w,
    imageHeight: h,
    dominoes: ordered,
    badges: badges.map(({ color: _c, ...b }) => b),
    confidence,
    uncertainCells: uncertain,
    warnings,
  };
}

const round2 = (v: number) => Math.round(v * 100) / 100;

function cmpCell(a: CellId, b: CellId): number {
  const [ar, ac] = a.split(',').map(Number);
  const [br, bc] = b.split(',').map(Number);
  return ar - br || ac - bc;
}

// ---------------------------------------------------------------- dominoes

export function detectDominoes(lab: LabImage): DetectedDomino[] {
  const { width: w, height: h } = lab;
  const dark = new Uint8Array(w * h);
  // Generous threshold: on small captures the 1px outline's rounded corners are anti-aliased to mid-grey.
  for (let i = 0; i < w * h; i++) dark[i] = lab.L[i] < 72 && lab.C[i] < 12 ? 1 : 0;
  const { labels, comps } = labelComponents(dark, w, h, true);

  // Outline candidates: thin dark rings with a domino-like aspect ratio and a light interior.
  const cands = comps.filter((c) => {
    const W = compW(c);
    const H = compH(c);
    const ar = Math.max(W, H) / Math.min(W, H);
    if (W < 20 || H < 10 || ar < 1.5 || ar > 2.9) return false;
    if (c.area / (W * H) > 0.45) return false;
    const ci = Math.round(c.cy) * w + Math.round((c.x0 + c.x1) / 2);
    return lab.L[ci] > 80;
  });
  if (cands.length === 0) return [];

  // Dominoes share one size: keep the largest group of similarly sized outlines.
  let best: Component[] = [];
  for (const c of cands) {
    const group = cands.filter(
      (o) => Math.abs(compW(o) - compW(c)) <= 0.08 * compW(c) && Math.abs(compH(o) - compH(c)) <= 0.12 * compH(c),
    );
    if (group.length > best.length) best = group;
  }

  // Bucket small dark blobs (pips) by the outline that encloses them.
  const outlineLabels = new Set(best.map((c) => c.label));
  const out: DetectedDomino[] = [];
  for (const o of best) {
    const W = compW(o);
    const H = compH(o);
    const horizontal = W >= H;
    const short = Math.min(W, H);
    const halves = [0, 0];
    const sizes: number[] = [];
    const seen = new Set<number>();
    for (let y = o.y0 + 2; y < o.y1 - 1; y++) {
      for (let x = o.x0 + 2; x < o.x1 - 1; x++) {
        const l = labels[y * w + x];
        if (!l || seen.has(l) || outlineLabels.has(l)) continue;
        seen.add(l);
      }
    }
    for (const l of seen) {
      const p = comps[l - 1];
      if (p.x0 <= o.x0 || p.x1 >= o.x1 || p.y0 <= o.y0 || p.y1 >= o.y1) continue;
      const pw = compW(p);
      const ph = compH(p);
      const rel = Math.max(pw, ph) / short;
      if (rel < 0.06 || rel > 0.3 || Math.max(pw, ph) / Math.min(pw, ph) > 1.6) continue;
      sizes.push(p.area);
      const first = horizontal ? p.cx < (o.x0 + o.x1) / 2 : p.cy < (o.y0 + o.y1) / 2;
      halves[first ? 0 : 1]++;
    }
    const medSize = median(sizes);
    const spread = sizes.length ? Math.max(...sizes.map((s) => Math.abs(s - medSize) / medSize)) : 0;
    const valid = halves[0] <= 6 && halves[1] <= 6;
    out.push({
      x: o.x0,
      y: o.y0,
      w: W,
      h: H,
      a: Math.min(halves[0], 6),
      b: Math.min(halves[1], 6),
      confidence: round2(valid ? Math.max(0.3, 1 - spread) : 0.1),
    });
  }
  return out;
}

// ---------------------------------------------------------------- board

interface BoardPiece {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function detectBoard(lab: LabImage): { pieces: BoardPiece[]; cellMask: Mask; boardMask: Mask } {
  const { width: w, height: h } = lab;
  const n = w * h;
  const mid = new Uint8Array(n);
  const union = new Uint8Array(n);
  const frame = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const L = lab.L[i];
    const strong = isStrong(lab, i) || (L < 40 && lab.C[i] > 12);
    mid[i] = L < 95 && L > 40 && !strong ? 1 : 0;
    // Badges and dashed borders count as board for connectivity, so a cell boxed in by
    // borders and badges on every side is never cut off from its board piece.
    union[i] = mid[i] || strong ? 1 : 0;
    frame[i] = deltaE(labAt(lab, i), FRAME) < 9 ? 1 : 0;
  }
  const { labels, comps } = labelComponents(open(union, w, h, 1), w, h, false);
  const frameCount = new Int32Array(comps.length + 1);
  for (let i = 0; i < n; i++) if (frame[i] && labels[i]) frameCount[labels[i]]++;
  const keep = comps.filter((c) => frameCount[c.label] > Math.max(40, 0.008 * c.area) && compW(c) > 20 && compH(c) > 20);
  const maxArea = Math.max(0, ...keep.map((c) => c.area));
  const kept = keep.filter((c) => c.area > 0.05 * maxArea);
  const keepLabels = new Set(kept.map((c) => c.label));
  const boardMask = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (keepLabels.has(labels[i])) boardMask[i] = 1;

  // Piece outlines come from the pastel/frame pixels only: badges overhang the board,
  // so including them would inflate the bounding boxes used to fit the grid.
  const body = open(mid, w, h, 2);
  const boxes = new Map<number, BoardPiece>();
  const cellMask = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const l = labels[i];
    if (!body[i] || !keepLabels.has(l)) continue;
    cellMask[i] = 1;
    const x = i % w;
    const y = (i - x) / w;
    const b = boxes.get(l);
    if (!b) boxes.set(l, { x0: x, y0: y, x1: x, y1: y });
    else {
      if (x < b.x0) b.x0 = x;
      if (x > b.x1) b.x1 = x;
      if (y < b.y0) b.y0 = y;
      if (y > b.y1) b.y1 = y;
    }
  }
  return { pieces: [...boxes.values()], cellMask, boardMask };
}

interface GridPiece {
  /** Pixel position of the top-left of this piece's first cell. */
  x: number;
  y: number;
  rows: number;
  cols: number;
  row0: number;
  col0: number;
}

interface Grid {
  pitch: number;
  originX: number;
  originY: number;
  rows: number;
  cols: number;
  pieces: GridPiece[];
}

function fitGrid(pieces: BoardPiece[], dominoCount: number, dominoW: number, cellMask: Mask, imgW: number): Grid {
  const dims: number[] = [];
  for (const p of pieces) dims.push(p.x1 - p.x0 + 1, p.y1 - p.y0 + 1);

  const tryPitch = (p0: number) => {
    const counts = dims.map((d) => Math.max(1, Math.round(d / p0 - 2 * MARGIN)));
    const pitch = dims.reduce((s, d) => s + d, 0) / counts.reduce((s, k) => s + k + 2 * MARGIN, 0);
    const residual = dims.reduce((s, d, i) => s + Math.abs(d / pitch - 2 * MARGIN - counts[i]), 0) / dims.length;
    return { pitch, residual };
  };

  const candidates: number[] = [];
  if (dominoW > 0) candidates.push(dominoW / DOMINO_W_PER_PITCH);
  // Fallback search when dominoes are missing or the estimate disagrees with the board.
  const maxDim = Math.max(...dims);
  for (let k = 1; k <= 14; k++) candidates.push(maxDim / (k + 2 * MARGIN));

  const h = cellMask.length / imgW;
  const build = (pitch: number): Grid => {
    const m = MARGIN * pitch;
    const raw = pieces.map((p) => ({
      x: p.x0 + m,
      y: p.y0 + m,
      cols: Math.max(1, Math.round((p.x1 - p.x0 + 1) / pitch - 2 * MARGIN)),
      rows: Math.max(1, Math.round((p.y1 - p.y0 + 1) / pitch - 2 * MARGIN)),
    }));
    const ox = Math.min(...raw.map((r) => r.x));
    const oy = Math.min(...raw.map((r) => r.y));
    const gp = raw.map((r) => ({
      ...r,
      col0: Math.round((r.x - ox) / pitch),
      row0: Math.round((r.y - oy) / pitch),
    }));
    return {
      pitch,
      originX: ox,
      originY: oy,
      cols: Math.max(...gp.map((g) => g.col0 + g.cols)),
      rows: Math.max(...gp.map((g) => g.row0 + g.rows)),
      pieces: gp,
    };
  };
  const countCells = (g: Grid) => {
    let cnt = 0;
    let fuzz = 0;
    for (const pc of g.pieces)
      for (let r = 0; r < pc.rows; r++)
        for (let c = 0; c < pc.cols; c++) {
          const cov = coverage(cellMask, imgW, h, pc.x + (c + 0.3) * g.pitch, pc.y + (r + 0.3) * g.pitch, 0.4 * g.pitch);
          if (cov >= 0.5) cnt++;
          fuzz += 1 - Math.abs(cov - 0.5) * 2;
        }
    return { cnt, fuzz };
  };

  let best: { grid: Grid; score: number } | null = null;
  candidates.forEach((p0, idx) => {
    if (p0 < 8) return;
    const { pitch, residual } = tryPitch(p0);
    const grid = build(pitch);
    const { cnt, fuzz } = countCells(grid);
    let score = residual * 4 + fuzz / Math.max(1, cnt) * 2;
    if (dominoCount > 0) score += cnt === 2 * dominoCount ? 0 : 3;
    // Prefer the domino-derived estimate, then larger pitches (half-pitch grids also "fit").
    if (idx === 0 && dominoW > 0) score -= 0.5;
    score -= pitch / maxDim * 0.1;
    if (!best || score < best.score) best = { grid, score };
  });
  return best!.grid;
}

function coverage(mask: Mask, w: number, h: number, x: number, y: number, size: number): number {
  const x0 = Math.max(0, Math.round(x));
  const y0 = Math.max(0, Math.round(y));
  const x1 = Math.min(w - 1, Math.round(x + size));
  const y1 = Math.min(h - 1, Math.round(y + size));
  let on = 0;
  let total = 0;
  for (let yy = y0; yy <= y1; yy += 1)
    for (let xx = x0; xx <= x1; xx += 1) {
      total++;
      if (mask[yy * w + xx]) on++;
    }
  return total ? on / total : 0;
}

function sampleColor(lab: LabImage, x: number, y: number, pitch: number): Lab {
  const Ls: number[] = [];
  const As: number[] = [];
  const Bs: number[] = [];
  const w = lab.width;
  for (let yy = Math.round(y + 0.25 * pitch); yy < y + 0.75 * pitch; yy += 2)
    for (let xx = Math.round(x + 0.25 * pitch); xx < x + 0.75 * pitch; xx += 2) {
      const i = yy * w + xx;
      if (lab.L[i] > 95 || isStrong(lab, i)) continue;
      Ls.push(lab.L[i]);
      As.push(lab.A[i]);
      Bs.push(lab.B[i]);
    }
  return [median(Ls), median(As), median(Bs)];
}

/** Fraction of pixels on the boundary between two cells that look like the cells' own colour. */
function seamSimilarity(lab: LabImage, x: number, y: number, pitch: number, horizontal: boolean, ref: Lab): number {
  let ok = 0;
  let total = 0;
  const w = lab.width;
  for (let t = 0.3; t <= 0.7; t += 0.02) {
    for (let s = -0.1; s <= 0.1; s += 0.02) {
      const px = horizontal ? x + (1 + s) * pitch : x + t * pitch;
      const py = horizontal ? y + t * pitch : y + (1 + s) * pitch;
      const i = Math.round(py) * w + Math.round(px);
      total++;
      if (deltaE(labAt(lab, i), ref) < 12) ok++;
    }
  }
  return total ? ok / total : 0;
}

function hueDistance(p: Lab, q: Lab): number {
  const hp = Math.atan2(p[2], p[1]);
  const hq = Math.atan2(q[2], q[1]);
  let d = Math.abs(hp - hq);
  if (d > Math.PI) d = 2 * Math.PI - d;
  return (d * 180) / Math.PI;
}

// ---------------------------------------------------------------- badges

interface RawBadge extends DetectedBadge {
  color: Lab;
}

function detectBadges(lab: LabImage, grid: Grid, boardMask: Mask): RawBadge[] {
  const { width: w, height: h } = lab;
  const { pitch } = grid;
  // Restrict to the board area plus a margin where badges overhang.
  const pad = 0.7 * pitch;
  const bx0 = Math.max(0, Math.floor(grid.originX - pad));
  const by0 = Math.max(0, Math.floor(grid.originY - pad));
  const bx1 = Math.min(w - 1, Math.ceil(grid.originX + grid.cols * pitch + pad));
  const by1 = Math.min(h - 1, Math.ceil(grid.originY + grid.rows * pitch + pad));
  const strong = new Uint8Array(w * h);
  for (let y = by0; y <= by1; y++)
    for (let x = bx0; x <= bx1; x++) {
      const i = y * w + x;
      if (isStrong(lab, i) || (lab.L[i] < 40 && lab.C[i] > 12)) strong[i] = 1;
    }
  void boardMask;
  // Fill enclosed holes (the white badge text), then an opening removes the thin
  // dashed region borders, leaving the solid badges.
  fillHoles(strong, w, h, bx0, by0, bx1, by1);
  const r = Math.max(2, Math.round(0.06 * pitch));
  const solid = open(strong, w, h, r);
  const { labels: badgeLabels, comps } = labelComponents(solid, w, h, false);
  const out: RawBadge[] = [];
  for (const c of comps) {
    const W = compW(c);
    const H = compH(c);
    if (W < 0.35 * pitch || H < 0.35 * pitch || W > 1.3 * pitch || H > 1.3 * pitch) continue;
    if (c.area < 0.12 * pitch * pitch) continue;
    const cx = (c.x0 + c.x1) / 2;
    const cy = (c.y0 + c.y1) / 2;
    const corner = {
      row: Math.round((cy - grid.originY) / pitch),
      col: Math.round((cx - grid.originX) / pitch),
    };
    // Badge colour: median of strong pixels.
    const Ls: number[] = [];
    const As: number[] = [];
    const Bs: number[] = [];
    for (let y = c.y0; y <= c.y1; y += 2)
      for (let x = c.x0; x <= c.x1; x += 2) {
        const i = y * w + x;
        if (!solid[i]) continue;
        Ls.push(lab.L[i]);
        As.push(lab.A[i]);
        Bs.push(lab.B[i]);
      }
    const color: Lab = [median(Ls), median(As), median(Bs)];
    const extracted = extractGlyphs(lab, c, pitch, color, (i) => badgeLabels[i] === c.label);
    const glyphs = extracted.map((e) => e.features);
    const glyphBoxes = extracted.map((e) => e.box);
    out.push({
      x: c.x0,
      y: c.y0,
      w: W,
      h: H,
      text: '',
      regionId: null,
      confidence: 1,
      glyphs,
      glyphBoxes,
      corner,
      color,
    });
  }
  return out;
}

/** Sets every background pixel inside the box that is not connected to the box border. */
function fillHoles(mask: Mask, w: number, _h: number, x0: number, y0: number, x1: number, y1: number) {
  const bw = x1 - x0 + 1;
  const bh = y1 - y0 + 1;
  const reach = new Uint8Array(bw * bh);
  const stack: number[] = [];
  const push = (x: number, y: number) => {
    const k = y * bw + x;
    if (reach[k] || mask[(y + y0) * w + (x + x0)]) return;
    reach[k] = 1;
    stack.push(k);
  };
  for (let x = 0; x < bw; x++) {
    push(x, 0);
    push(x, bh - 1);
  }
  for (let y = 0; y < bh; y++) {
    push(0, y);
    push(bw - 1, y);
  }
  while (stack.length) {
    const k = stack.pop()!;
    const x = k % bw;
    const y = (k - x) / bw;
    if (x > 0) push(x - 1, y);
    if (x < bw - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < bh - 1) push(x, y + 1);
  }
  for (let y = 0; y < bh; y++)
    for (let x = 0; x < bw; x++) if (!reach[y * bw + x]) mask[(y + y0) * w + (x + x0)] = 1;
}

/** Badge crops are resampled so the cell pitch is this many pixels before reading text. */
const GLYPH_REF_PITCH = 120;

/**
 * White glyph blobs fully enclosed by the badge, grouped into characters left-to-right.
 * The crop is resampled to a fixed scale with bilinear interpolation of a "whiteness"
 * score, so tiny desktop captures and large phone captures are segmented the same way.
 */
function extractGlyphs(
  lab: LabImage,
  badge: Component,
  pitch: number,
  badgeColor: Lab,
  inBadge: (i: number) => boolean,
): { features: GlyphFeatures; box: { x0: number; y0: number; x1: number; y1: number } }[] {
  const w = lab.width;
  const m = Math.round(0.04 * pitch) + 2;
  const x0 = Math.max(0, badge.x0 - m);
  const y0 = Math.max(0, badge.y0 - m);
  const x1 = Math.min(w - 1, badge.x1 + m);
  const y1 = Math.min(lab.height - 1, badge.y1 + m);
  const s = GLYPH_REF_PITCH / pitch;
  const bw = Math.max(1, Math.round((x1 - x0 + 1) * s));
  const bh = Math.max(1, Math.round((y1 - y0 + 1) * s));
  // White text scores ~100; saturated badge colours and pastel cells score far below.
  const whiteness = (i: number) => lab.L[i] - 2 * lab.C[i];
  // Adaptive threshold halfway between the badge colour and its brightest text pixels:
  // on small captures anti-aliasing keeps thin strokes from ever reaching full white.
  const bg = badgeColor[0] - 2 * Math.hypot(badgeColor[1], badgeColor[2]);
  const core: number[] = [];
  const cx0 = Math.round(badge.x0 + 0.25 * (badge.x1 - badge.x0));
  const cx1 = Math.round(badge.x0 + 0.75 * (badge.x1 - badge.x0));
  const cy0 = Math.round(badge.y0 + 0.25 * (badge.y1 - badge.y0));
  const cy1 = Math.round(badge.y0 + 0.75 * (badge.y1 - badge.y0));
  for (let y = cy0; y <= cy1; y++) for (let x = cx0; x <= cx1; x++) core.push(whiteness(y * w + x));
  core.sort((a, b) => b - a);
  const peak = core[Math.min(core.length - 1, Math.floor(core.length * 0.03))] ?? 100;
  const threshold = Math.max(bg + 15, (bg + peak) / 2, peak - 50);
  const white = new Uint8Array(bw * bh);
  for (let y = 0; y < bh; y++)
    for (let x = 0; x < bw; x++) {
      const sx = Math.min(x1 - 1e-3, Math.max(x0, x0 + (x + 0.5) / s - 0.5));
      const sy = Math.min(y1 - 1e-3, Math.max(y0, y0 + (y + 0.5) / s - 0.5));
      const ix = Math.floor(sx);
      const iy = Math.floor(sy);
      const fx = sx - ix;
      const fy = sy - iy;
      const ix1 = Math.min(x1, ix + 1);
      const iy1 = Math.min(y1, iy + 1);
      const v =
        whiteness(iy * w + ix) * (1 - fx) * (1 - fy) +
        whiteness(iy * w + ix1) * fx * (1 - fy) +
        whiteness(iy1 * w + ix) * (1 - fx) * fy +
        whiteness(iy1 * w + ix1) * fx * fy;
      // Only text inside the badge's own (hole-filled) shape counts, never pastel pockets nearby.
      const inside = inBadge(Math.round(sy) * w + Math.round(sx));
      white[y * bw + x] = inside && v > threshold ? 1 : 0;
    }
  const { labels, comps } = labelComponents(white, bw, bh, true);
  const R = GLYPH_REF_PITCH;
  // Text sits in the middle of the badge; pockets in the badge's notch sit near its edge.
  const inner = comps.filter(
    (c) =>
      c.x0 > 0 &&
      c.y0 > 0 &&
      c.x1 < bw - 1 &&
      c.y1 < bh - 1 &&
      c.area >= 0.0015 * R * R &&
      c.y1 - c.y0 + 1 >= 0.035 * R &&
      c.cx > 0.1 * bw &&
      c.cx < 0.9 * bw &&
      c.cy > 0.22 * bh &&
      c.cy < 0.78 * bh,
  );

  // A glyph is a set of label ids within a column range (ranges allow splitting touching characters).
  interface Glyph {
    labels: Set<number>;
    x0: number;
    x1: number;
  }
  inner.sort((a, b) => a.x0 - b.x0);
  const byLabel = new Map(inner.map((c) => [c.label, c]));
  const glyphHeight = (g: Glyph) => {
    const cs = [...g.labels].map((l) => byLabel.get(l)!);
    return Math.max(...cs.map((c) => c.y1)) - Math.min(...cs.map((c) => c.y0)) + 1;
  };
  const groups: Glyph[] = [];
  for (const c of inner) {
    // Merge blobs that overlap horizontally (the two bars of "=", the pieces of "≠").
    const g = groups.find((gr) => {
      const ov = Math.min(gr.x1, c.x1) - Math.max(gr.x0, c.x0);
      return ov > 0.5 * Math.min(gr.x1 - gr.x0, c.x1 - c.x0);
    });
    if (g) {
      g.labels.add(c.label);
      g.x0 = Math.min(g.x0, c.x0);
      g.x1 = Math.max(g.x1, c.x1);
    } else groups.push({ labels: new Set([c.label]), x0: c.x0, x1: c.x1 });
  }

  // Re-join pieces of one character broken apart by anti-aliasing at small sizes.
  for (let k = 0; k < groups.length - 1; ) {
    const a = groups[k];
    const b = groups[k + 1];
    const unionW = Math.max(a.x1, b.x1) - Math.min(a.x0, b.x0) + 1;
    const gap = b.x0 - a.x1;
    // "≠" is the only symbol taller than a digit (its slash overhangs); it may lose the end of a bar.
    const tall = (g: typeof a) => glyphHeight(g) > 0.29 * R;
    // Pieces of a broken "0": a sliver thinner than any character, or two equal-height halves.
    const wa = a.x1 - a.x0 + 1;
    const wb = b.x1 - b.x0 + 1;
    const ha = glyphHeight(a);
    const hb = glyphHeight(b);
    const halves =
      unionW <= 0.235 * R &&
      (Math.min(wa, wb) < 0.06 * R || (Math.min(wa, wb) < 0.09 * R && Math.min(ha, hb) / Math.max(ha, hb) > 0.8));
    if (gap <= 0.05 * R && (halves || ((tall(a) || tall(b)) && unionW <= 0.36 * R))) {
      for (const l of b.labels) a.labels.add(l);
      a.x0 = Math.min(a.x0, b.x0);
      a.x1 = Math.max(a.x1, b.x1);
      groups.splice(k + 1, 1);
    } else k++;
  }

  // Split a single blob that is too wide for one character at its narrowest column
  // (two digits or "<4" touching at low resolution).
  const glyphs: Glyph[] = [];
  for (const g of groups) {
    if (g.labels.size === 1 && g.x1 - g.x0 + 1 > 0.27 * R) {
      const cols: number[] = [];
      for (let x = g.x0; x <= g.x1; x++) {
        let n = 0;
        for (let y = 0; y < bh; y++) if (g.labels.has(labels[y * bw + x])) n++;
        cols.push(n);
      }
      const lo = Math.floor(cols.length * 0.3);
      const hi = Math.ceil(cols.length * 0.7);
      let cut = -1;
      for (let k = lo; k < hi; k++) if (cut < 0 || cols[k] < cols[cut]) cut = k;
      if (cut >= 0 && cols[cut] <= 0.12 * Math.max(...cols)) {
        glyphs.push({ labels: g.labels, x0: g.x0, x1: g.x0 + cut - 1 });
        glyphs.push({ labels: g.labels, x0: g.x0 + cut + 1, x1: g.x1 });
        continue;
      }
    }
    glyphs.push(g);
  }

  return glyphs.map((g) => {
    let gy0 = bh;
    let gy1 = -1;
    let gx0 = bw;
    let gx1 = -1;
    for (let y = 0; y < bh; y++)
      for (let x = g.x0; x <= g.x1; x++)
        if (g.labels.has(labels[y * bw + x])) {
          if (y < gy0) gy0 = y;
          if (y > gy1) gy1 = y;
          if (x < gx0) gx0 = x;
          if (x > gx1) gx1 = x;
        }
    return {
      features: glyphFeatures(
        (x, y) => g.labels.has(labels[(gy0 + y) * bw + (gx0 + x)]),
        gx1 - gx0 + 1,
        gy1 - gy0 + 1,
        R,
      ),
      box: { x0: x0 + gx0 / s, y0: y0 + gy0 / s, x1: x0 + (gx1 + 1) / s, y1: y0 + (gy1 + 1) / s },
    };
  });
}
