import type { SolveResult } from '../engine/solver';

/** What the editor knows about solvability: nothing yet, or a result (possibly out of date). */
export interface Solvability {
  result: SolveResult | null;
  /** The puzzle changed and the shown result is being recomputed. */
  pending: boolean;
}

/** How long (ms) and how far the editor searches before it reports what it has found. */
export const SOLVE_LIMITS = { maxSolutions: 1000, maxMs: 2500 } as const;

export type Tone = 'ok' | 'bad' | 'warn' | 'busy';

export interface SolveMessage {
  tone: Tone;
  headline: string;
  detail?: string;
}

/** Explains the counting rule; shown as a tooltip on the banner. */
export const COUNT_RULE =
  'Counted without duplicates: solutions that put the same pips in every condition (and the same pip on every square outside the conditions) count once. ' +
  'For example identical dominoes swapped, a double like 3|3 turned around, or 2|3 against 3|2 inside a "sum 5" condition.';

const number = (n: number) => n.toLocaleString('en-US');
const seconds = (ms: number) => `${ms / 1000} s`;

export function describeSolvability({ result }: Solvability): SolveMessage {
  if (!result) return { tone: 'busy', headline: 'Checking whether the puzzle can be solved…' };

  if (result.count > 0) {
    if (result.complete) {
      return { tone: 'ok', headline: `Solvable: ${number(result.count)} ${result.count === 1 ? 'solution' : 'solutions'}` };
    }
    if (result.stoppedBy === 'limit') {
      return { tone: 'ok', headline: `Solvable: ${number(result.count)} or more solutions` };
    }
    return {
      tone: 'ok',
      headline: `Solvable: at least ${number(result.count)} ${result.count === 1 ? 'solution' : 'solutions'}`,
      detail: `(stopped counting after ${seconds(SOLVE_LIMITS.maxMs)})`,
    };
  }

  if (result.complete) {
    return {
      tone: 'bad',
      headline: 'Not solvable',
      detail: result.reason ?? 'No way of placing every domino meets all the conditions.',
    };
  }
  return {
    tone: 'warn',
    headline: "Couldn't tell whether this puzzle can be solved",
    detail: `(gave up after ${seconds(SOLVE_LIMITS.maxMs)})`,
  };
}
