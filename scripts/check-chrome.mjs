/**
 * End-to-end recognition check in real Chrome: runs the app's own pipeline (browser JPEG
 * decode -> Web Worker -> recogniser) on every gameN.jpg and compares the result with
 * tests/vision/expected/gameN.json. Uses the locally installed Chrome (set CHROME_PATH to
 * override). Run: npm run check:chrome
 */
import { existsSync, readdirSync } from 'node:fs';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';

const candidates = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
].filter(Boolean);
const executablePath = candidates.find((p) => existsSync(p));
if (!executablePath) throw new Error('Chrome not found; set CHROME_PATH.');

const games = readdirSync('tests/vision/expected')
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace('.json', ''))
  .sort((a, b) => Number(a.replace(/\D/g, '')) - Number(b.replace(/\D/g, '')));

const server = await createServer({ server: { port: 0, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const url = server.resolvedUrls.local[0];
const browser = await chromium.launch({ executablePath });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(url);

let failed = 0;
for (const game of games) {
  const r = await page.evaluate(async (game) => {
    const { loadImageFile, recognizeInWorker } = await import('/src/vision/client.ts');
    const { parsePuzzleFile } = await import('/src/engine/puzzleFile.ts');
    const { constraintLabel } = await import('/src/engine/constraints.ts');
    const want = parsePuzzleFile(await (await fetch(`/tests/vision/expected/${game}.json`)).text());
    const { imageData } = await loadImageFile(await (await fetch(`/${game}.jpg`)).blob());
    const got = (await recognizeInWorker(imageData, () => {})).puzzle;
    const norm = (p) => {
      const r0 = Math.min(...p.cells.map((c) => c.row));
      const c0 = Math.min(...p.cells.map((c) => c.col));
      const n = (id) => {
        const [r, c] = id.split(',').map(Number);
        return `${r - r0},${c - c0}`;
      };
      return {
        cells: p.cells.map((c) => n(c.id)).sort().join(' '),
        regions: p.regions.map((x) => `${x.cells.map(n).sort().join(' ')} => ${constraintLabel(x.constraint)}`).sort().join(' | '),
        dominoes: p.dominoes.map((d) => `${d.a}${d.b}`).join(' '),
      };
    };
    const a = norm(got);
    const b = norm(want);
    const diff = Object.keys(a).filter((k) => a[k] !== b[k]);
    return { diff, got: a, want: b };
  }, game);
  if (r.diff.length === 0) console.log(`PASS ${game}`);
  else {
    failed++;
    console.log(`FAIL ${game}`);
    for (const k of r.diff) console.log(`  ${k}\n    expected: ${r.want[k]}\n    got:      ${r.got[k]}`);
  }
}
await browser.close();
await server.close();
if (errors.length) console.log('Page errors:', errors);
console.log(`${games.length - failed}/${games.length} screenshots match their expected files in Chrome.`);
process.exit(failed || errors.length ? 1 : 0);
