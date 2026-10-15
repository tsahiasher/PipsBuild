/**
 * Every condition value must be readable, not just the ones that happen to appear in the
 * reference screenshots. This test rewrites the badges of a real screenshot with every sum
 * from 0 to 24 (plus <, >, =, ≠ forms), composed from real glyph pixels cut out of other
 * screenshots, and runs the full recogniser at phone and desktop scale.
 */
import { describe, expect, it } from 'vitest';
import { browserDecoded, loadImage, scaleImage } from '../../scripts/load';
import { recognize, type DetectedBadge } from '../../src/vision/recognize';
import { badgeCell } from '../../src/engine/puzzle';
import { constraintLabel } from '../../src/engine/constraints';
import { rgbToLab, type RGBAImage } from '../../src/vision/image';
import { parseTruth, truthFor, type Truth } from './groundTruth';

interface GlyphSource {
  img: RGBAImage;
  box: { x0: number; y0: number; x1: number; y1: number };
  pitch: number;
}

const whiteness = (img: RGBAImage, x: number, y: number) => {
  const i = (Math.round(y) * img.width + Math.round(x)) * 4;
  const [L, a, b] = rgbToLab(img.data[i], img.data[i + 1], img.data[i + 2]);
  return L - 2 * Math.hypot(a, b);
};

/** Recognised badges paired with their ground-truth label. */
async function labelledBadges(t: Truth, img: RGBAImage) {
  const res = await recognize(img, { skipClassification: true });
  const { regions } = parseTruth(t);
  const out: { badge: DetectedBadge; label: string }[] = [];
  for (const b of res.badges) {
    const cell = `${b.corner.row - 1},${b.corner.col - 1}`;
    const key = [...regions.entries()].find(([, cells]) => badgeCell({ id: '', color: 0, cells, constraint: null }) === cell)?.[0];
    if (key) out.push({ badge: b, label: t.labels[key] });
  }
  return { res, out };
}

async function glyphSources(): Promise<Map<string, GlyphSource>> {
  const sources = new Map<string, GlyphSource>();
  for (const name of ['game4', 'game6', 'game1', 'game2', 'game3', 'game7']) {
    const t = truthFor(`${name}.jpg`);
    const img = loadImage(browserDecoded(name));
    const { res, out } = await labelledBadges(t, img);
    for (const { badge, label } of out) {
      const chars = [...label];
      if (chars.length !== badge.glyphBoxes.length) continue;
      chars.forEach((ch, i) => {
        if (!sources.has(ch)) sources.set(ch, { img, box: badge.glyphBoxes[i], pitch: res.geometry.pitch });
      });
    }
  }
  return sources;
}

/** Erases a badge's text and draws `label` in its place from real glyph pixels. */
function paintBadge(img: RGBAImage, badge: DetectedBadge, label: string, pitch: number, sources: Map<string, GlyphSource>) {
  const boxes = badge.glyphBoxes;
  const tx0 = Math.min(...boxes.map((b) => b.x0));
  const tx1 = Math.max(...boxes.map((b) => b.x1));
  const ty0 = Math.min(...boxes.map((b) => b.y0));
  const ty1 = Math.max(...boxes.map((b) => b.y1));
  const cx = (tx0 + tx1) / 2;
  const cy = (ty0 + ty1) / 2;

  // Badge colour: median of saturated pixels around the text.
  const px: number[][] = [];
  for (let y = Math.round(badge.y + badge.h * 0.3); y < badge.y + badge.h * 0.7; y++)
    for (let x = Math.round(badge.x + badge.w * 0.3); x < badge.x + badge.w * 0.7; x++)
      if (whiteness(img, x, y) < 20) {
        const i = (y * img.width + x) * 4;
        px.push([img.data[i], img.data[i + 1], img.data[i + 2]]);
      }
  const med = [0, 1, 2].map((k) => px.map((p) => p[k]).sort((a, b) => a - b)[px.length >> 1]);
  const set = (x: number, y: number, rgb: number[]) => {
    const i = (y * img.width + x) * 4;
    img.data[i] = rgb[0];
    img.data[i + 1] = rgb[1];
    img.data[i + 2] = rgb[2];
  };

  // Erase the original text.
  const m = 0.05 * pitch;
  for (let y = Math.floor(ty0 - m); y <= ty1 + m; y++) for (let x = Math.floor(tx0 - m); x <= tx1 + m; x++) set(x, y, med);

  // Compose the new text, centred where the old text was.
  const gap = 0.03 * pitch;
  let parts = [...label].map((ch) => {
    const s = sources.get(ch);
    if (!s) throw new Error(`no glyph source for ${ch}`);
    const k = pitch / s.pitch;
    return { s, k, w: (s.box.x1 - s.box.x0 + 2) * k, h: (s.box.y1 - s.box.y0 + 2) * k };
  });
  // Long labels are set smaller so they fit inside the diamond (as badges do).
  const natural = parts.reduce((sum, p) => sum + p.w, 0) + gap * (parts.length - 1);
  const fit = Math.min(1, (0.46 * pitch) / natural);
  parts = parts.map((p) => ({ ...p, k: p.k * fit, w: p.w * fit, h: p.h * fit }));
  const total = parts.reduce((sum, p) => sum + p.w, 0) + gap * (parts.length - 1);
  let left = cx - total / 2;
  for (const { s, k, w, h } of parts) {
    const top = cy - h / 2;
    // Alpha from the source glyph's whiteness relative to its own badge background.
    let wbg = Infinity;
    let wpk = -Infinity;
    for (let y = s.box.y0 - 2; y <= s.box.y1 + 2; y++)
      for (let x = s.box.x0 - 2; x <= s.box.x1 + 2; x++) {
        const v = whiteness(s.img, x, y);
        wbg = Math.min(wbg, v);
        wpk = Math.max(wpk, v);
      }
    for (let y = Math.floor(top); y <= top + h; y++)
      for (let x = Math.floor(left); x <= left + w; x++) {
        const sx = s.box.x0 - 1 + (x - left) / k;
        const sy = s.box.y0 - 1 + (y - top) / k;
        const a = Math.min(1, Math.max(0, (whiteness(s.img, sx, sy) - wbg) / (wpk - wbg)));
        if (a <= 0) continue;
        set(x, y, med.map((c) => Math.round(c * (1 - a) + 255 * a)));
      }
    left += w + gap;
  }
}

const LABELS = [
  ...Array.from({ length: 25 }, (_, n) => String(n)),
  '<3',
  '>5',
  '<10',
  '>12',
  '>20',
  '=',
  '≠',
];

describe('condition values 0–24', () => {
  it('reads every sum from 0 to 24 and every operator, at phone and desktop scale', async () => {
    const sources = await glyphSources();
    const base = truthFor('game4.jpg');
    const img = loadImage(browserDecoded('game4'));
    const { res, out } = await labelledBadges(base, img);
    expect(out.length).toBe(LABELS.length);

    // Assign a new label to every badge and repaint it.
    const { regions } = parseTruth(base);
    const truth: Truth = { ...base, labels: { ...base.labels } };
    out.forEach(({ badge }, i) => {
      const cell = `${badge.corner.row - 1},${badge.corner.col - 1}`;
      const key = [...regions.entries()].find(([, cells]) => badgeCell({ id: '', color: 0, cells, constraint: null }) === cell)![0];
      truth.labels[key] = LABELS[i];
      paintBadge(img, badge, LABELS[i], res.geometry.pitch, sources);
    });

    for (const [scale, image] of [
      ['phone', img],
      ['desktop', scaleImage(img, 0.45)],
    ] as const) {
      const got = (await recognize(image)).puzzle;
      const want = new Map([...regions.entries()].map(([k, cells]) => [badgeCell({ id: '', color: 0, cells, constraint: null }), truth.labels[k]]));
      const read = new Map(got.regions.map((r) => [badgeCell(r), constraintLabel(r.constraint)]));
      const wrong = [...want].filter(([cell, label]) => read.get(cell) !== label).map(([cell, label]) => `${label}→${read.get(cell)} @${cell}`);
      expect(wrong, `${scale} misreads`).toEqual([]);
    }
  });
});
