import { useEffect, useMemo, useState } from 'react';
import { countSolutions } from '../engine/solver';
import type { SolveRequest, SolveResponse } from '../engine/solveWorker';
import type { Puzzle } from '../engine/types';
import { SOLVE_LIMITS, type Solvability } from './solveMessage';

/** Wait this long after the last edit before counting, so drag-painting stays smooth. */
const DEBOUNCE_MS = 250;

/** Only what changes the solutions: not colours, ids or the order of regions. */
function signatureOf(p: Puzzle): string {
  return JSON.stringify([
    p.cells.map((c) => c.id).sort(),
    p.regions.map((r) => [[...r.cells].sort(), r.constraint]).sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1)),
    p.dominoes.map((d) => [d.a, d.b]),
  ]);
}

/**
 * Counts the puzzle's solutions in a Web Worker whenever it changes. The previous result stays
 * visible (marked `pending`) while the new one is computed, so the message never flickers.
 */
export function useSolvability(puzzle: Puzzle): Solvability {
  const [state, setState] = useState<Solvability>({ result: null, pending: true });
  const signature = useMemo(() => signatureOf(puzzle), [puzzle]);

  useEffect(() => {
    setState((s) => (s.pending ? s : { ...s, pending: true }));
    let cancelled = false;
    let worker: Worker | null = null;
    const finish = (result: Solvability['result']) => {
      if (!cancelled) setState({ result, pending: false });
    };

    const timer = window.setTimeout(() => {
      try {
        worker = new Worker(new URL('../engine/solveWorker.ts', import.meta.url), { type: 'module' });
        worker.onmessage = (e: MessageEvent<SolveResponse>) => {
          worker?.terminate();
          finish(e.data.result);
        };
        worker.onerror = () => {
          worker?.terminate();
          finish(countSolutions(puzzle, { ...SOLVE_LIMITS, maxMs: 800 })); // no worker support: short inline run
        };
        const request: SolveRequest = { puzzle, options: SOLVE_LIMITS };
        worker.postMessage(request);
      } catch {
        finish(countSolutions(puzzle, { ...SOLVE_LIMITS, maxMs: 800 }));
      }
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      worker?.terminate();
    };
    // `puzzle` is read when the effect runs; the signature says when it actually changed.
  }, [signature]); // eslint-disable-line react-hooks/exhaustive-deps

  return state;
}
