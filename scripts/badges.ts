import { browserDecoded, loadImage, samplePath, scaleImage } from './load';
import { recognize } from '../src/vision/recognize';
// Usage: vite-node scripts/badges.ts game10 [scale]   (BROWSER=1 for Chrome-decoded pixels)
const f = process.argv[2];
const scale = Number(process.argv[3] ?? 1);
let img = loadImage(process.env.BROWSER === '1' ? browserDecoded(f) : samplePath(f));
if (scale !== 1) img = scaleImage(img, scale);
const res = await recognize(img, { skipClassification: true });
console.log('pitch', res.geometry.pitch.toFixed(1));
for (const b of res.badges) console.log(`${b.corner.row},${b.corner.col} x=${b.x} y=${b.y} w=${b.w} glyphs=${b.glyphs.length} ${b.glyphs.map((g) => g.relW.toFixed(2) + 'x' + g.relH.toFixed(2)).join(' ')}`);
