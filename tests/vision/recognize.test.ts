import { existsSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GOLDENS_DIR, browserDecoded, goldenPath, listSamples, loadImage, samplePath, scaleImage } from '../../scripts/load';
import { recognize } from '../../src/vision/recognize';
import { checkConsistency } from '../../src/engine/puzzle';
import { boardComponents } from '../../src/engine/geometry';
import type { RGBAImage } from '../../src/vision/image';
import type { Puzzle } from '../../src/engine/types';
import { canonicalPuzzle, goldenFor } from './goldens';

const samples = listSamples();

function crop(img: RGBAImage, x0: number, y0: number, w: number, h: number): RGBAImage {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    data.set(img.data.subarray(((y + y0) * img.width + x0) * 4, ((y + y0) * img.width + x0 + w) * 4), y * w * 4);
  return { width: w, height: h, data };
}

/** The reconstruction must equal the sample's golden (see goldens.ts for what is compared). */
function expectMatchesGolden(p: Puzzle, name: string) {
  expect(canonicalPuzzle(p)).toEqual(canonicalPuzzle(goldenFor(name).puzzle));
  expect(checkConsistency(p).filter((i) => i.level === 'error')).toEqual([]);
}

describe('samples and goldens', () => {
  it('finds the sample screenshots', () => {
    expect(samples.length).toBeGreaterThan(0);
  });

  it('every sample has a golden, and every golden has a sample', () => {
    expect(
      samples.filter((n) => !existsSync(goldenPath(n))),
      'samples without a golden (run: npm run save:goldens)',
    ).toEqual([]);
    const goldenNames = readdirSync(GOLDENS_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace(/\.json$/, ''));
    expect(
      goldenNames.filter((n) => !samples.includes(n)),
      'goldens without a sample image',
    ).toEqual([]);
  });
});

describe('screenshot reconstruction matches the goldens', () => {
  // Each sample is checked twice: decoded by jpeg-js in Node, and with the exact pixels Chrome
  // produces (its JPEG decoder differs slightly, which once flipped a cell). The Chrome-decoded
  // dump is optional; `npm run check:chrome` runs the real browser pipeline regardless.
  for (const name of samples) {
    it(`${name} (node decode)`, async () => {
      const res = await recognize(loadImage(samplePath(name)));
      expectMatchesGolden(res.puzzle, name);
      expect(res.warnings).toEqual([]);
    });

    it.skipIf(!existsSync(browserDecoded(name)))(`${name} (chrome decode)`, async () => {
      const res = await recognize(loadImage(browserDecoded(name)));
      expectMatchesGolden(res.puzzle, name);
      expect(res.warnings).toEqual([]);
    });
  }
});

describe('recognition is robust to how the screenshot was taken', () => {
  it('finds the two disconnected board pieces in game1', async () => {
    const res = await recognize(loadImage(samplePath('game1')));
    expect(boardComponents(res.puzzle.cells)).toHaveLength(2);
  });

  it('does not depend on screenshot resolution (65% and 140%)', async () => {
    const img = loadImage(samplePath('game1'));
    expectMatchesGolden((await recognize(scaleImage(img, 0.65))).puzzle, 'game1');
    expectMatchesGolden((await recognize(scaleImage(img, 1.4))).puzzle, 'game1');
  });

  it('works on a crop without browser chrome (desktop-style capture)', async () => {
    for (const name of ['game2', 'game6']) {
      const img = loadImage(samplePath(name));
      const top = Math.round(img.height * 0.2);
      const res = await recognize(crop(img, 0, top, img.width, Math.round(img.height * 0.75)));
      expectMatchesGolden(res.puzzle, name);
    }
  });

  it('reports progress through every stage', async () => {
    const stages: string[] = [];
    await recognize(loadImage(samplePath('game3')), { onProgress: (s) => void stages.push(s) });
    for (const s of ['Analyzing image…', 'Detecting board…', 'Finding regions…', 'Detecting dominoes…', 'Recognizing conditions…', 'Building puzzle…'])
      expect(stages).toContain(s);
  });
});
