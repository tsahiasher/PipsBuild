/** Original region palette: fill (measured from real screenshots) + strong accent (border & badge). */
export interface RegionColor {
  name: string;
  fill: string;
  accent: string;
}

export const REGION_COLORS: RegionColor[] = [
  { name: 'Lilac', fill: '#c3a3bc', accent: '#7446a6' },
  { name: 'Rose', fill: '#e6a0ac', accent: '#c02c68' },
  { name: 'Lagoon', fill: '#9bbfbf', accent: '#11807b' },
  { name: 'Apricot', fill: '#e8bd8e', accent: '#c45f16' },
  { name: 'Slate', fill: '#a1a1ad', accent: '#2c4778' },
  { name: 'Moss', fill: '#b4b389', accent: '#587a1b' },
  { name: 'Sky', fill: '#9fbde0', accent: '#2468b4' },
  { name: 'Sand', fill: '#dcc58a', accent: '#8a6a17' },
];

export const regionColor = (i: number): RegionColor => REGION_COLORS[((i % REGION_COLORS.length) + REGION_COLORS.length) % REGION_COLORS.length];

export const BOARD = {
  frame: '#e3d6c8',
  emptyCell: '#f3ebe2',
  gridGhost: '#cfc6bb',
  error: '#e0262f',
  selection: '#111111',
  previewOk: '#2f9e5b',
  previewBad: '#e0262f',
};

/** Board drawing unit: one cell is 100×100 SVG units. */
export const U = 100;
