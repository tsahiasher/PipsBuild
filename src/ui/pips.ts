/** Pip layout for one domino half, in a unit square (0..1). */
export type PipSpot = 'TL' | 'TR' | 'ML' | 'MR' | 'BL' | 'BR' | 'C';

export const PIP_PATTERNS: Record<number, PipSpot[]> = {
  0: [],
  1: ['C'],
  2: ['TL', 'BR'],
  3: ['TL', 'C', 'BR'],
  4: ['TL', 'TR', 'BL', 'BR'],
  5: ['TL', 'TR', 'C', 'BL', 'BR'],
  6: ['TL', 'ML', 'BL', 'TR', 'MR', 'BR'],
};

const SPOT_XY: Record<PipSpot, [number, number]> = {
  TL: [0.27, 0.27],
  TR: [0.73, 0.27],
  ML: [0.27, 0.5],
  MR: [0.73, 0.5],
  BL: [0.27, 0.73],
  BR: [0.73, 0.73],
  C: [0.5, 0.5],
};

export function pipPositions(value: number): [number, number][] {
  return (PIP_PATTERNS[value] ?? []).map((s) => SPOT_XY[s]);
}
