/**
 * Prints how many distinct solutions each golden puzzle has (and how long counting took).
 *   npx vite-node scripts/count-solutions.ts [game1 game4 ...] [--show]
 * With --show every solution is drawn as a grid: pips per square, and which squares belong
 * to the same domino (same letter).
 */
import { listSamples } from './load';
import { constraintLabel } from '../src/engine/constraints';
import { countSolutions } from '../src/engine/solver';
import type { Puzzle } from '../src/engine/types';
import { loadGolden } from '../tests/vision/goldens';

const args = process.argv.slice(2);
const show = args.includes('--show');
const given = args.filter((a) => !a.startsWith('--'));
const names = given.length ? given : listSamples();

function draw(p: Puzzle, placements: Record<string, { cellA: string; cellB: string }>): string[] {
  const value = new Map<string, number>();
  const tile = new Map<string, string>();
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  Object.entries(placements).forEach(([id, pl], k) => {
    const dm = p.dominoes.find((d) => d.id === id)!;
    value.set(pl.cellA, dm.a);
    value.set(pl.cellB, dm.b);
    tile.set(pl.cellA, letters[k]);
    tile.set(pl.cellB, letters[k]);
  });
  const lines: string[] = [];
  for (let r = 0; r < p.rows; r++) {
    let pips = '';
    let tiles = '';
    for (let c = 0; c < p.cols; c++) {
      const id = `${r},${c}`;
      pips += value.has(id) ? ` ${value.get(id)}` : ' .';
      tiles += ` ${tile.get(id) ?? '.'}`;
    }
    lines.push(`${pips}    ${tiles}`);
  }
  return lines;
}

for (const name of names) {
  const golden = loadGolden(name);
  if (!golden) {
    console.log(`${name}: no golden`);
    continue;
  }
  const t0 = performance.now();
  const r = countSolutions(golden.puzzle, { maxSolutions: 100000, collect: show });
  const ms = (performance.now() - t0).toFixed(0);
  console.log(`${name.padEnd(7)} ${String(r.count).padStart(6)} solution${r.count === 1 ? ' ' : 's'}${r.complete ? '' : ' (stopped: ' + r.stoppedBy + ')'}  ${ms} ms`);
  if (show) {
    console.log('  conditions:', golden.puzzle.regions.map((x) => `${constraintLabel(x.constraint) || '-'}@${x.cells.join('/')}`).join('  '));
    r.solutions!.forEach((s, i) => {
      console.log(`  solution ${i + 1}:`);
      for (const line of draw(golden.puzzle, s)) console.log('    ' + line);
    });
  }
}
