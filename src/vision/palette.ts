import { rgbToLab, type Lab } from './image';

/**
 * Pastel region colours seen in screenshots, in the same order as the app's own
 * display palette (src/ui/theme.ts). Recognition only uses these to pick a matching
 * colour family for display; region grouping never depends on exact RGB values.
 */
const REFERENCE: Lab[] = [
  rgbToLab(196, 164, 188), // purple
  rgbToLab(231, 161, 172), // pink
  rgbToLab(156, 192, 192), // teal
  rgbToLab(232, 190, 142), // orange
  rgbToLab(162, 162, 174), // slate
  rgbToLab(181, 180, 136), // olive
];

export function nearestPaletteIndex(color: Lab): number {
  let best = 0;
  let bestD = Infinity;
  REFERENCE.forEach((ref, i) => {
    const d = Math.hypot(color[0] - ref[0], color[1] - ref[1], color[2] - ref[2]);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}
