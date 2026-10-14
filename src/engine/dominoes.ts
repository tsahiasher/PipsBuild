import type { Domino } from './types';

/** Order-independent identity of a domino: 3|1 and 1|3 are the same piece. */
export const dominoKey = (a: number, b: number): string => (a <= b ? `${a}|${b}` : `${b}|${a}`);

/** Labels of pieces that appear more than once, e.g. ["1|3"]. */
export function duplicateDominoes(dominoes: Domino[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const d of dominoes) {
    const k = dominoKey(d.a, d.b);
    if (seen.has(k)) dup.add(k);
    seen.add(k);
  }
  return [...dup];
}

/**
 * Next pip value for one half of a domino, stepping by `dir` (+1 / -1, wrapping 0–6) and
 * skipping values that would make it identical to another piece. Null if no value fits.
 */
export function nextUniqueHalf(dominoes: Domino[], id: string, half: 'a' | 'b', dir: 1 | -1): number | null {
  const d = dominoes.find((x) => x.id === id);
  if (!d) return null;
  const taken = new Set(dominoes.filter((x) => x.id !== id).map((x) => dominoKey(x.a, x.b)));
  const other = half === 'a' ? d.b : d.a;
  for (let step = 1; step <= 6; step++) {
    const v = (((d[half] + dir * step) % 7) + 7) % 7;
    if (!taken.has(dominoKey(v, other))) return v;
  }
  return null;
}

/** The first piece of a double-six set not yet in use, or null when all 28 are used. */
export function firstUnusedDomino(dominoes: Domino[]): [number, number] | null {
  const taken = new Set(dominoes.map((d) => dominoKey(d.a, d.b)));
  for (let a = 0; a <= 6; a++) for (let b = a; b <= 6; b++) if (!taken.has(dominoKey(a, b))) return [a, b];
  return null;
}
