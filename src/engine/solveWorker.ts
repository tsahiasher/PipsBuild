import { countSolutions, type SolveOptions, type SolveResult } from './solver';
import type { Puzzle } from './types';

/** Counts solutions off the main thread, so a hard puzzle never freezes the editor. */
export type SolveRequest = { puzzle: Puzzle; options: SolveOptions };
export type SolveResponse = { result: SolveResult };

// Minimal worker scope typing (the project compiles against the DOM lib).
const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<SolveRequest>) => void) | null;
  postMessage: (msg: SolveResponse) => void;
};

ctx.onmessage = (e: MessageEvent<SolveRequest>) => {
  ctx.postMessage({ result: countSolutions(e.data.puzzle, e.data.options) });
};
