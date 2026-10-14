import { browserDecoded, loadImage } from './load';
import { recognize } from '../src/vision/recognize';
const f = process.argv[2];
const res = await recognize(loadImage(process.env.BROWSER === '1' ? browserDecoded(f) : `${f}.jpg`), { skipClassification: true });
for (const b of res.badges) console.log(`${b.corner.row},${b.corner.col} x=${b.x} y=${b.y} w=${b.w} glyphs=${b.glyphs.length} ${b.glyphs.map((g) => g.relW.toFixed(2) + 'x' + g.relH.toFixed(2)).join(' ')}`);
