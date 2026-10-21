import { existsSync, readdirSync, readFileSync } from 'node:fs';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import type { RGBAImage } from '../src/vision/image';

/** Decodes a JPEG or PNG file into RGBA pixels. */
export function loadImage(path: string): RGBAImage {
  const buf = readFileSync(path);
  if (path.toLowerCase().endsWith('.png')) {
    const png = PNG.sync.read(buf);
    return { width: png.width, height: png.height, data: new Uint8Array(png.data) };
  }
  const raw = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true });
  return { width: raw.width, height: raw.height, data: raw.data };
}

export const SAMPLES_DIR = 'samples';
export const GOLDENS_DIR = 'samples/goldens';
export const samplePath = (name: string) => `${SAMPLES_DIR}/${name}.jpg`;
export const goldenPath = (name: string) => `${GOLDENS_DIR}/${name}.json`;

const sampleNumber = (name: string) => Number(/\d+/.exec(name)?.[0] ?? 0);

/** Names of all sample screenshots ("game1", "game2", ...) in samples/, numerically sorted. */
export function listSamples(): string[] {
  if (!existsSync(SAMPLES_DIR)) return [];
  return readdirSync(SAMPLES_DIR)
    .filter((f) => /^game\d+\.jpg$/i.test(f))
    .map((f) => f.replace(/\.jpg$/i, ''))
    .sort((a, b) => sampleNumber(a) - sampleNumber(b));
}

/** Path of a screenshot as decoded by Chrome (exact pixels the app sees in the browser). */
export const browserDecoded = (name: string) => `tests/vision/browser-decoded/${name.replace(/\.jpg$/, '')}.png`;

/** Bilinear resize, used to simulate other screen resolutions. */
export function scaleImage(img: RGBAImage, f: number): RGBAImage {
  const w = Math.round(img.width * f);
  const h = Math.round(img.height * f);
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const sx = Math.min(img.width - 1.001, Math.max(0, (x + 0.5) / f - 0.5));
      const sy = Math.min(img.height - 1.001, Math.max(0, (y + 0.5) / f - 0.5));
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const fx = sx - x0;
      const fy = sy - y0;
      for (let k = 0; k < 4; k++) {
        const p = (yy: number, xx: number) => img.data[(yy * img.width + xx) * 4 + k];
        data[(y * w + x) * 4 + k] =
          p(y0, x0) * (1 - fx) * (1 - fy) + p(y0, x0 + 1) * fx * (1 - fy) + p(y0 + 1, x0) * (1 - fx) * fy + p(y0 + 1, x0 + 1) * fx * fy;
      }
    }
  return { width: w, height: h, data };
}
