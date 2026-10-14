/**
 * Condition-badge character recognition over a closed vocabulary: 0-9 < > =
 * Each glyph becomes a small coverage grid plus its size relative to the cell pitch,
 * matched against templates learned from reference screenshots (scripts/train-glyphs.ts).
 */
import { GLYPH_TEMPLATES } from './glyphTemplates';

export const GRID_W = 8;
export const GRID_H = 12;

export interface GlyphFeatures {
  /** Glyph width / cell pitch. */
  relW: number;
  /** Glyph height / cell pitch. */
  relH: number;
  /** Coverage grid (GRID_W x GRID_H, row-major), values 0..1. */
  grid: number[];
}

export interface GlyphTemplate extends GlyphFeatures {
  ch: string;
}

export function glyphFeatures(
  on: (x: number, y: number) => boolean,
  width: number,
  height: number,
  pitch: number,
): GlyphFeatures {
  const grid = new Array(GRID_W * GRID_H).fill(0);
  const counts = new Array(GRID_W * GRID_H).fill(0);
  // Supersample so tiny glyphs still fill every grid cell.
  const ss = 4;
  for (let y = 0; y < height * ss; y++) {
    for (let x = 0; x < width * ss; x++) {
      const gx = Math.min(GRID_W - 1, Math.floor((x / (width * ss)) * GRID_W));
      const gy = Math.min(GRID_H - 1, Math.floor((y / (height * ss)) * GRID_H));
      const k = gy * GRID_W + gx;
      counts[k]++;
      if (on(Math.floor(x / ss), Math.floor(y / ss))) grid[k]++;
    }
  }
  return {
    relW: width / pitch,
    relH: height / pitch,
    grid: grid.map((v, i) => (counts[i] ? Math.round((v / counts[i]) * 100) / 100 : 0)),
  };
}

export function glyphDistance(a: GlyphFeatures, b: GlyphFeatures): number {
  let d = 0;
  for (let i = 0; i < a.grid.length; i++) d += Math.abs(a.grid[i] - b.grid[i]);
  d /= a.grid.length;
  // Size matters: "1" is narrow, "=" and "<" are short.
  d += Math.abs(Math.log(a.relW / b.relW)) * 0.35;
  d += Math.abs(Math.log(a.relH / b.relH)) * 0.6;
  return d;
}

export function classifyGlyph(
  g: GlyphFeatures,
  templates: GlyphTemplate[] = GLYPH_TEMPLATES,
): { ch: string; distance: number; confidence: number } {
  const best = new Map<string, number>();
  for (const t of templates) {
    const d = glyphDistance(g, t);
    if (!best.has(t.ch) || d < best.get(t.ch)!) best.set(t.ch, d);
  }
  const ranked = [...best.entries()].sort((a, b) => a[1] - b[1]);
  if (ranked.length === 0) return { ch: '?', distance: Infinity, confidence: 0 };
  const [ch, d1] = ranked[0];
  const d2 = ranked[1]?.[1] ?? d1 + 1;
  // Confidence from the separation between the best and runner-up characters.
  const confidence = Math.max(0, Math.min(1, (d2 - d1) / Math.max(0.05, d2) * 2));
  return { ch, distance: d1, confidence: Math.round(confidence * 100) / 100 };
}
