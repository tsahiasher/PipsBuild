/** Original region palette: pastel fill + strong accent (border & badge). */
export interface RegionColor {
  name: string;
  fill: string;
  accent: string;
}

export const REGION_COLORS: RegionColor[] = [
  { name: 'Lilac', fill: '#d4bfe0', accent: '#7446a6' },
  { name: 'Rose', fill: '#f4bccb', accent: '#c02c68' },
  { name: 'Lagoon', fill: '#acd9d3', accent: '#11807b' },
  { name: 'Apricot', fill: '#f7d2a6', accent: '#c45f16' },
  { name: 'Slate', fill: '#bcc1d3', accent: '#2c4778' },
  { name: 'Moss', fill: '#cdd39f', accent: '#587a1b' },
  { name: 'Sky', fill: '#bcd8f4', accent: '#2468b4' },
  { name: 'Sand', fill: '#e9d8a8', accent: '#8a6a17' },
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
