/**
 * Saves the recogniser's output for the sample screenshots as their golden files
 * (samples/goldens/gameN.json, the app's puzzle-file format). `npm test` compares against them.
 *
 *   npm run save:goldens                 every sample
 *   npm run save:goldens -- game10 game3 only the named samples
 *
 * A golden is only as right as the recogniser was when it was saved, so review new or changed
 * ones before committing them: `git diff samples/goldens`, or open the file in the app with
 * "Import puzzle file" (or load the sample with the ?debug=1 buttons and compare).
 * Files whose recognised content did not change are left untouched.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { GOLDENS_DIR, browserDecoded, goldenPath, listSamples, loadImage, samplePath } from './load';
import { checkConsistency } from '../src/engine/puzzle';
import { parsePuzzleFile, serializePuzzle } from '../src/engine/puzzleFile';
import { recognize } from '../src/vision/recognize';
import { canonicalPuzzle } from '../tests/vision/goldens';

const all = listSamples();
const requested = process.argv.slice(2).map((n) => n.replace(/\.jpg$/i, ''));
const names = requested.length ? requested : all;
const unknown = names.filter((n) => !all.includes(n));
if (unknown.length) {
  console.error(`Unknown sample(s): ${unknown.join(', ')}.\nSamples in samples/: ${all.join(', ') || '(none)'}`);
  process.exit(1);
}

mkdirSync(GOLDENS_DIR, { recursive: true });
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const counts = { new: 0, changed: 0, unchanged: 0 };
let flagged = 0;

for (const name of names) {
  const res = await recognize(loadImage(samplePath(name)));
  const puzzle = { ...res.puzzle, name };
  const next = canonicalPuzzle(puzzle);
  const path = goldenPath(name);

  let status: keyof typeof counts = 'new';
  if (existsSync(path)) {
    let previous: unknown = null;
    try {
      previous = canonicalPuzzle(parsePuzzleFile(readFileSync(path, 'utf8')));
    } catch {
      /* unreadable golden: replace it */
    }
    status = same(previous, next) ? 'unchanged' : 'changed';
  }
  if (status !== 'unchanged') writeFileSync(path, serializePuzzle(puzzle) + '\n');
  counts[status]++;

  console.log(`${status.padEnd(9)} ${name}: ${puzzle.cells.length} cells, ${puzzle.regions.length} regions, ${puzzle.dominoes.length} dominoes`);
  const problems = [
    ...res.warnings,
    ...checkConsistency(puzzle).filter((i) => i.level === 'error').map((i) => i.message),
  ];
  // Chrome's JPEG decoder differs slightly from jpeg-js; both must give the same result.
  if (existsSync(browserDecoded(name))) {
    const chrome = canonicalPuzzle((await recognize(loadImage(browserDecoded(name)))).puzzle);
    if (!same(chrome, next)) problems.push('the Chrome-decoded pixels (tests/vision/browser-decoded) give a different result');
  }
  for (const p of problems) console.log(`          ⚠ ${p}`);
  if (problems.length) flagged++;
}

console.log(`\n${counts.new} new, ${counts.changed} changed, ${counts.unchanged} unchanged${flagged ? `, ${flagged} with warnings` : ''}.`);
if (counts.new + counts.changed) console.log('Review the new/changed goldens before committing: git diff samples/goldens');
