import { browserDecoded, loadImage } from './load';
import { recognize } from '../src/vision/recognize';
import { constraintLabel } from '../src/engine/constraints';
import { cellId } from '../src/engine/geometry';

const files = process.argv.slice(2).length ? process.argv.slice(2) : ['game1', 'game2', 'game3', 'game4', 'game6'];
const skip = process.env.SKIP === '1';
// BROWSER=1 analyses the Chrome-decoded pixel dumps instead of decoding the JPEG in Node.
const browser = process.env.BROWSER === '1';
for (const f of files) {
  const t0 = Date.now();
  const res = await recognize(loadImage(browser ? browserDecoded(f) : `${f}.jpg`), { skipClassification: skip });
  const p = res.puzzle;
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const regOf = new Map<string, number>();
  p.regions.forEach((r, i) => r.cells.forEach((c) => regOf.set(c, i)));
  const cells = new Set(p.cells.map((c) => c.id));
  console.log(`\n== ${f} (${Date.now() - t0}ms) pitch=${res.geometry.pitch.toFixed(1)} origin=${res.geometry.originX.toFixed(0)},${res.geometry.originY.toFixed(0)} ${p.rows}x${p.cols} cells=${p.cells.length} dominoes=${p.dominoes.length}`);
  for (let r = 0; r < p.rows; r++) {
    let line = '  ';
    for (let c = 0; c < p.cols; c++) {
      const id = cellId(r, c);
      line += !cells.has(id) ? '.' : regOf.has(id) ? letters[regOf.get(id)!] : '_';
    }
    console.log(line);
  }
  console.log('  regions:', p.regions.map((r, i) => `${letters[i]}:${constraintLabel(r.constraint) || '-'}`).join(' '));
  console.log('  badges:', res.badges.map((b) => `${b.corner.row},${b.corner.col}->${b.regionId}[${b.text || b.glyphs.length}]`).join(' '));
  console.log('  dominoes:', p.dominoes.map((d) => `${d.a}${d.b}`).join(' '));
  console.log('  confidence:', JSON.stringify(res.confidence), 'uncertain:', res.uncertainCells.join(' '));
  if (res.warnings.length) console.log('  warnings:', res.warnings);
}
