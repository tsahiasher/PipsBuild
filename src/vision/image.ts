/** Minimal image helpers that work identically in a browser worker and in Node tests. */

export interface RGBAImage {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
}

export interface LabImage {
  width: number;
  height: number;
  L: Float32Array;
  A: Float32Array;
  B: Float32Array;
  /** Chroma sqrt(a² + b²). */
  C: Float32Array;
}

export type Lab = [number, number, number];

const LIN = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  LIN[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);

export function rgbToLab(r: number, g: number, b: number): Lab {
  const R = LIN[r];
  const G = LIN[g];
  const B = LIN[b];
  const x = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047;
  const y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  const z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export function toLab(img: RGBAImage): LabImage {
  const n = img.width * img.height;
  const L = new Float32Array(n);
  const A = new Float32Array(n);
  const B = new Float32Array(n);
  const C = new Float32Array(n);
  // Cache conversions: screenshots contain relatively few distinct colours.
  const cache = new Map<number, number>();
  const store: number[] = [];
  const d = img.data;
  for (let i = 0; i < n; i++) {
    const r = d[i * 4];
    const g = d[i * 4 + 1];
    const b = d[i * 4 + 2];
    const key = (r << 16) | (g << 8) | b;
    let idx = cache.get(key);
    if (idx === undefined) {
      const lab = rgbToLab(r, g, b);
      idx = store.length;
      store.push(lab[0], lab[1], lab[2]);
      cache.set(key, idx);
    }
    L[i] = store[idx];
    A[i] = store[idx + 1];
    B[i] = store[idx + 2];
    C[i] = Math.hypot(store[idx + 1], store[idx + 2]);
  }
  return { width: img.width, height: img.height, L, A, B, C };
}

export const deltaE = (p: Lab, q: Lab): number => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);

export function labAt(lab: LabImage, i: number): Lab {
  return [lab.L[i], lab.A[i], lab.B[i]];
}

export function labToRgbHex([L, a, b]: Lab): string {
  const fy = (L + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const inv = (t: number) => (t ** 3 > 0.008856 ? t ** 3 : (t - 16 / 116) / 7.787);
  const x = inv(fx) * 0.95047;
  const y = inv(fy);
  const z = inv(fz) * 1.08883;
  const lin = [
    3.2406 * x - 1.5372 * y - 0.4986 * z,
    -0.9689 * x + 1.8758 * y + 0.0415 * z,
    0.0557 * x - 0.204 * y + 1.057 * z,
  ];
  const hex = lin
    .map((c) => {
      const s = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(Math.max(c, 0), 1 / 2.4) - 0.055;
      return Math.round(Math.min(1, Math.max(0, s)) * 255)
        .toString(16)
        .padStart(2, '0');
    })
    .join('');
  return '#' + hex;
}

// ---------- masks ----------

export type Mask = Uint8Array;

export interface Component {
  label: number;
  area: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  cx: number;
  cy: number;
}

export const compW = (c: Component) => c.x1 - c.x0 + 1;
export const compH = (c: Component) => c.y1 - c.y0 + 1;

/** Connected-component labelling. Labels start at 1; 0 means background. */
export function labelComponents(
  mask: Mask,
  width: number,
  height: number,
  eightConnected = false,
): { labels: Int32Array; comps: Component[] } {
  const labels = new Int32Array(width * height);
  const comps: Component[] = [];
  const stack = new Int32Array(width * height);
  let next = 1;
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || labels[start]) continue;
    const label = next++;
    let sp = 0;
    stack[sp++] = start;
    labels[start] = label;
    const c: Component = { label, area: 0, x0: width, y0: height, x1: -1, y1: -1, cx: 0, cy: 0 };
    while (sp > 0) {
      const i = stack[--sp];
      const x = i % width;
      const y = (i - x) / width;
      c.area++;
      c.cx += x;
      c.cy += y;
      if (x < c.x0) c.x0 = x;
      if (x > c.x1) c.x1 = x;
      if (y < c.y0) c.y0 = y;
      if (y > c.y1) c.y1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          if (!eightConnected && dx !== 0 && dy !== 0) continue;
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const j = ny * width + nx;
          if (mask[j] && !labels[j]) {
            labels[j] = label;
            stack[sp++] = j;
          }
        }
      }
    }
    c.cx /= c.area;
    c.cy /= c.area;
    comps.push(c);
  }
  return { labels, comps };
}

/** Square-kernel dilation (radius r) using separable sliding counts. */
export function dilate(mask: Mask, w: number, h: number, r: number): Mask {
  if (r <= 0) return mask.slice();
  const tmp = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    let count = 0;
    const row = y * w;
    for (let x = -r; x < w; x++) {
      const add = x + r;
      if (add < w && mask[row + add]) count++;
      const rem = x - r - 1;
      if (rem >= 0 && mask[row + rem]) count--;
      if (x >= 0) tmp[row + x] = count > 0 ? 1 : 0;
    }
  }
  for (let x = 0; x < w; x++) {
    let count = 0;
    for (let y = -r; y < h; y++) {
      const add = y + r;
      if (add < h && tmp[add * w + x]) count++;
      const rem = y - r - 1;
      if (rem >= 0 && tmp[rem * w + x]) count--;
      if (y >= 0) out[y * w + x] = count > 0 ? 1 : 0;
    }
  }
  return out;
}

export function erode(mask: Mask, w: number, h: number, r: number): Mask {
  const inv = new Uint8Array(w * h);
  for (let i = 0; i < inv.length; i++) inv[i] = mask[i] ? 0 : 1;
  const d = dilate(inv, w, h, r);
  for (let i = 0; i < d.length; i++) d[i] = d[i] ? 0 : 1;
  return d;
}

export const open = (m: Mask, w: number, h: number, r: number) => dilate(erode(m, w, h, r), w, h, r);
export const close = (m: Mask, w: number, h: number, r: number) => erode(dilate(m, w, h, r), w, h, r);

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
