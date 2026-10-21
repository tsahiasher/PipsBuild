/**
 * End-to-end check in real Chrome: runs the app's own pipeline (browser JPEG decode -> Web
 * Worker -> recogniser) on every samples/gameN.jpg and compares the result with its golden
 * samples/goldens/gameN.json. It also checks the ?debug=1 sample buttons on the home screen and
 * the solvability strip of the editor (computed in a Web Worker) and the animated turning of a domino,
 * on the dev server and on a real production build.
 * Uses the locally installed Chrome (set CHROME_PATH to override). Run: npm run check:chrome
 */
import { existsSync, readdirSync } from 'node:fs';
import { build, createServer, preview as createPreview } from 'vite';
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

const num = (n) => Number(n.replace(/\D/g, ''));
const games = readdirSync('samples')
  .filter((f) => /^game\d+\.jpg$/i.test(f))
  .map((f) => f.replace(/\.jpg$/i, ''))
  .sort((a, b) => num(a) - num(b));

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
    const res = await fetch(`/samples/goldens/${game}.json`);
    if (!res.ok) return { missing: true };
    const want = parsePuzzleFile(await res.text());
    const { imageData } = await loadImageFile(await (await fetch(`/samples/${game}.jpg`)).blob());
    const got = (await recognizeInWorker(imageData, () => {})).puzzle;
    // Same canonical form as tests/vision/goldens.ts: no ids, colours or grid offset.
    const norm = (p) => {
      const r0 = Math.min(...p.cells.map((c) => c.row));
      const c0 = Math.min(...p.cells.map((c) => c.col));
      const n = (id) => {
        const [r, c] = id.split(',').map(Number);
        return `${r - r0},${c - c0}`;
      };
      return {
        cells: p.cells.map((c) => n(c.id)).sort().join(' '),
        regions: p.regions.map((x) => `${x.cells.map(n).sort().join(' ')} => ${constraintLabel(x.constraint) || '-'}`).sort().join(' | '),
        dominoes: p.dominoes.map((d) => `${d.a}${d.b}`).join(' '),
      };
    };
    const a = norm(got);
    const b = norm(want);
    const diff = Object.keys(a).filter((k) => a[k] !== b[k]);
    return { diff, got: a, want: b };
  }, game);
  if (r.missing) {
    failed++;
    console.log(`FAIL ${game}\n  no golden: run npm run save:goldens -- ${game}`);
  } else if (r.diff.length === 0) console.log(`PASS ${game}`);
  else {
    failed++;
    console.log(`FAIL ${game}`);
    for (const k of r.diff) console.log(`  ${k}\n    golden: ${r.want[k]}\n    got:    ${r.got[k]}`);
  }
}

// The ?debug=1 buttons and the editor's solvability strip, on the dev server AND on a real
// production build (what gets deployed): one button per sample, absent without the flag, and
// clicking one loads it; the strip must turn green for it.
async function checkDebug(baseUrl, label) {
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  await page.goto(`${baseUrl}?debug=1`);
  await page.waitForSelector('.debug-card button', { timeout: 10000 }).catch(() => {});
  const buttons = await page.$$eval('.debug-card button', (bs) => bs.map((b) => b.textContent.trim()));
  const last = games[games.length - 1];
  let loaded = JSON.stringify(buttons) === JSON.stringify(games);
  if (loaded) {
    await page.click(`.debug-card button:text-is("${last}")`);
    loaded = await page.waitForSelector('text=Start puzzle', { timeout: 30000 }).then(() => true, () => false);
  }
  const solveText = loaded
    ? await page
        .waitForSelector('.solve-banner.ok:not(.pending)', { timeout: 15000 })
        .then(() => page.textContent('.solve-banner'))
        .then((t) => t.replace(/\s+/g, ' ').trim(), () => '')
    : '';
  const plain = await browser.newPage();
  await plain.goto(baseUrl);
  await plain.waitForSelector('.dropzone');
  const hiddenWithoutFlag = (await plain.$$('.debug-card')).length === 0;
  if (loaded && /Solvable: \d+ solutions?/.test(solveText) && hiddenWithoutFlag) {
    console.log(`PASS ${label}: ?debug=1 shows ${games.length} sample buttons, loads ${last}, strip says "${solveText.replace(/^\S+\s*/, '')}"; hidden without the flag`);
  } else {
    failed++;
    console.log(`FAIL ${label}: buttons [${buttons.join(', ')}], loaded ${last}: ${loaded}, strip "${solveText}", hidden without flag: ${hiddenWithoutFlag}`);
  }
}
await checkDebug(url, 'dev server');

// Turning a domino is animated: a sweep through several angles, not a switch (tray and board).
async function checkRotation(baseUrl, label) {
  const problems = [];
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  await page.goto(`${baseUrl}?debug=1`);
  await page.waitForSelector('.debug-card button');
  await page.click(`.debug-card button:text-is("${games.includes('game3') ? 'game3' : games[0]}")`);
  await page.click('text=Start puzzle');
  await page.waitForSelector('.tray');
  await page.waitForTimeout(300);

  // Number of distinct angles an element passes through during `ms` (a smooth turn passes through many).
  const sweep = (selector, ms) =>
    page.evaluate(
      ([selector, ms]) =>
        new Promise((resolve) => {
          const el = document.querySelector(selector);
          const angles = new Set();
          const t0 = performance.now();
          const tick = () => {
            const m = getComputedStyle(el).transform.match(/matrix\(([^)]+)\)/);
            const [a, b] = m ? m[1].split(',').map(Number) : [1, 0];
            angles.add(Math.round((Math.atan2(b, a) * 180) / Math.PI));
            if (performance.now() - t0 < ms) requestAnimationFrame(tick);
            else resolve(angles.size);
          };
          tick();
        }),
      [selector, ms],
    );
  const centre = (selector) =>
    page.$eval(selector, (e) => {
      const r = e.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });

  // Tray: tapping the first domino turns it.
  const first = await centre('.slot:nth-child(1)');
  const trayTurn = sweep('.slot:nth-child(1) .tray-domino', 400);
  await page.mouse.click(first.x, first.y);
  if ((await trayTurn) < 4) problems.push('turning a tray domino is not animated');

  // Board: put the second domino on the first row of the second piece (cells 1,0 and 1,1 of game3), select it, turn it.
  const second = await centre('.slot:nth-child(2)');
  const to = await page.evaluate(([x, y]) => {
    const svg = document.querySelector('.board-svg');
    const [vx, vy, vw, vh] = svg.getAttribute('viewBox').split(' ').map(Number);
    const r = svg.getBoundingClientRect();
    const s = Math.min(r.width / vw, r.height / vh);
    return { x: r.left + (r.width - vw * s) / 2 + (x - vx) * s, y: r.top + (r.height - vh * s) / 2 + (y - vy) * s };
  }, [100, 150]);
  await page.mouse.move(second.x, second.y);
  await page.mouse.down();
  for (let k = 1; k <= 14; k++) await page.mouse.move(second.x + ((to.x - second.x) * k) / 14, second.y + ((to.y - second.y) * k) / 14);
  await page.mouse.up();
  await page.waitForTimeout(350);
  if ((await page.$$('.board-domino')).length !== 1) problems.push('the domino did not land on the board');
  else {
    const p = await centre('.board-domino');
    await page.mouse.click(p.x, p.y); // select
    await page.waitForSelector('.is-selected');
    await page.waitForTimeout(250);
    const boardTurn = sweep('.is-selected', 400);
    await page.mouse.click(p.x, p.y);
    if ((await boardTurn) < 4) problems.push('turning a domino on the board is not animated');
  }

  await page.close();
  if (problems.length === 0) console.log(`PASS ${label}: turning a domino is animated (tray and board)`);
  else {
    failed++;
    console.log(`FAIL ${label}: rotation\n  - ${problems.join('\n  - ')}`);
  }
}
await checkRotation(url, 'dev server');


// A real production build, served the way a static host would serve it.
const outDir = 'node_modules/.cache/pips-check-dist';
await build({ logLevel: 'error', build: { outDir, emptyOutDir: true } });
const preview = await createPreview({ logLevel: 'error', build: { outDir }, preview: { port: 0, host: '127.0.0.1' } });
await checkDebug(preview.resolvedUrls.local[0], 'production build');
await checkRotation(preview.resolvedUrls.local[0], 'production build');
preview.httpServer.close();

await browser.close();
await server.close();
if (errors.length) console.log('Page errors:', errors);
console.log(`${games.length} screenshots checked against their goldens in Chrome; ${failed ? `${failed} FAILED` : 'all passed'}.`);
process.exit(failed || errors.length ? 1 : 0);
