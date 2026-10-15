import { describe, expect, it } from 'vitest';
import { browserDecoded, loadImage, scaleImage } from '../../scripts/load';
import { recognize } from '../../src/vision/recognize';
import { constraintLabel } from '../../src/engine/constraints';
import { checkConsistency } from '../../src/engine/puzzle';
import { boardComponents } from '../../src/engine/geometry';
import type { RGBAImage } from '../../src/vision/image';
import type { Puzzle } from '../../src/engine/types';
import { TRUTH, parseTruth, truthFor, type Truth } from './groundTruth';

function crop(img: RGBAImage, x0: number, y0: number, w: number, h: number): RGBAImage {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    data.set(img.data.subarray(((y + y0) * img.width + x0) * 4, ((y + y0) * img.width + x0 + w) * 4), y * w * 4);
  return { width: w, height: h, data };
}

/** Compares a reconstruction with the ground truth, independent of region ids and grid offset. */
function expectMatches(p: Puzzle, t: Truth) {
  const { regions, playable } = parseTruth(t);
  const minR = Math.min(...p.cells.map((c) => c.row));
  const minC = Math.min(...p.cells.map((c) => c.col));
  const norm = (id: string) => {
    const [r, c] = id.split(',').map(Number);
    return `${r - minR},${c - minC}`;
  };
  expect(p.cells.map((c) => norm(c.id)).sort()).toEqual([...playable].sort());

  const got = p.regions
    .map((r) => `${r.cells.map(norm).sort().join(' ')} => ${constraintLabel(r.constraint)}`)
    .sort();
  const want = [...regions.entries()].map(([k, cells]) => `${[...cells].sort().join(' ')} => ${t.labels[k]}`).sort();
  expect(got).toEqual(want);

  expect(p.dominoes.map((d) => `${d.a}${d.b}`).join(' ')).toBe(t.dominoes);
  expect(checkConsistency(p).filter((i) => i.level === 'error')).toEqual([]);
}

describe('screenshot reconstruction', () => {
  // Each screenshot is checked twice: decoded by jpeg-js in Node, and with the exact pixels
  // Chrome produces (its JPEG decoder differs slightly, which once flipped a cell).
  for (const t of TRUTH) {
    for (const decoder of ['node', 'chrome'] as const) {
      it(`reconstructs ${t.file} exactly (${decoder} decode)`, async () => {
        const img = loadImage(decoder === 'node' ? t.file : browserDecoded(t.file));
        const res = await recognize(img);
        expectMatches(res.puzzle, t);
        expect(res.warnings).toEqual([]);
      });
    }
  }

  it('finds the two disconnected board pieces in game1', async () => {
    const res = await recognize(loadImage('game1.jpg'));
    expect(boardComponents(res.puzzle.cells)).toHaveLength(2);
  });

  it('does not depend on screenshot resolution (65% and 140%)', async () => {
    const t = truthFor('game1.jpg');
    const img = loadImage(t.file);
    expectMatches((await recognize(scaleImage(img, 0.65))).puzzle, t);
    expectMatches((await recognize(scaleImage(img, 1.4))).puzzle, t);
  });

  it('works on a crop without browser chrome (desktop-style capture)', async () => {
    for (const t of [truthFor('game2.jpg'), truthFor('game6.jpg')]) {
      const img = loadImage(t.file);
      const top = Math.round(img.height * 0.2);
      const res = await recognize(crop(img, 0, top, img.width, Math.round(img.height * 0.75)));
      expectMatches(res.puzzle, t);
    }
  });

  it('reports progress through every stage', async () => {
    const stages: string[] = [];
    await recognize(loadImage('game3.jpg'), { onProgress: (s) => void stages.push(s) });
    for (const s of ['Analyzing image…', 'Detecting board…', 'Finding regions…', 'Detecting dominoes…', 'Recognizing conditions…', 'Building puzzle…'])
      expect(stages).toContain(s);
  });
});
