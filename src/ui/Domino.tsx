import { memo } from 'react';
import { pipPositions } from './pips';

export type DominoLook = 'normal' | 'selected' | 'preview-ok' | 'preview-bad' | 'invalid' | 'lifted';

interface ShapeProps {
  a: number;
  b: number;
  look?: DominoLook;
  /** Placed on the board: the body lets the region colour show through slightly. */
  translucent?: boolean;
}

/** Pip renderer for one half, drawn into a 100×100 box at (x, 0). */
export function Pips({ value, x }: { value: number; x: number }) {
  return (
    <g>
      {pipPositions(value).map(([px, py], i) => (
        <circle key={i} cx={x + 10 + px * 80} cy={10 + py * 80} r={8.6} fill="#2b2b2e" />
      ))}
    </g>
  );
}

/**
 * Horizontal domino occupying a 200×100 box with its top-left at the origin.
 * Value `a` is on the left half. Rotate the parent to change orientation.
 */
export const DominoShape = memo(function DominoShape({ a, b, look = 'normal', translucent = false }: ShapeProps) {
  const stroke =
    look === 'selected' ? '#000' : look === 'preview-ok' ? '#2f9e5b' : look === 'preview-bad' || look === 'invalid' ? '#e0262f' : '#3d3d42';
  const fill = look === 'preview-bad' || look === 'invalid' ? '#fde7e7' : look === 'preview-ok' ? '#e5f6ea' : '#fdfcf9';
  const strokeWidth = look === 'selected' ? 9 : look === 'normal' || look === 'lifted' ? 3.5 : 5;
  return (
    <g opacity={look === 'preview-ok' || look === 'preview-bad' ? 0.6 : 1}>
      {!translucent && (look === 'normal' || look === 'lifted' || look === 'selected') && (
        <rect x={6} y={look === 'lifted' ? 13 : 9} width={190} height={88} rx={17} fill="rgba(40,30,20,0.28)" />
      )}
      <rect
        x={5}
        y={5}
        width={190}
        height={88}
        rx={17}
        fill={fill}
        fillOpacity={translucent ? 0.5 : 1}
        stroke={stroke}
        strokeWidth={strokeWidth}
      />
      <line x1={100} y1={18} x2={100} y2={80} stroke="#c9c6c0" strokeWidth={3} strokeLinecap="round" />
      <g transform="translate(0,-1)">
        <Pips value={a} x={0} />
        <Pips value={b} x={100} />
      </g>
    </g>
  );
});

/** SVG transform placing a domino with the given rotation centred at (cx, cy). */
export function dominoTransform(cx: number, cy: number, rotation: number): string {
  return `translate(${cx} ${cy}) rotate(${rotation * 90}) translate(-100 -50)`;
}

export function dominoAriaLabel(a: number, b: number, rotation: number): string {
  const orient = rotation % 2 === 0 ? 'horizontal' : 'vertical';
  const order = rotation === 0 || rotation === 1 ? `${a} and ${b}` : `${b} and ${a}`;
  return `Domino ${order}, ${orient}`;
}
