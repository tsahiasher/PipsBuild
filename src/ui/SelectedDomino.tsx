import { useEffect, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { rotationOf } from '../engine/geometry';
import type { CellId, Placement } from '../engine/types';
import { cellCenter, placementCenter } from './boardGeometry';
import { DominoShape, dominoTransform } from './Domino';

interface Props {
  a: number;
  b: number;
  /** Where the domino sat when it was selected; the turns are applied to this pose. */
  original: Placement;
  /** The square the domino turns around. */
  pivot: CellId;
  /** Quarter turns clockwise since selection. Not wrapped, so the spin always continues forward. */
  turns: number;
  /** The pose after those turns is allowed. */
  legal: boolean;
  label: string;
  onPointerDown: (e: PointerEvent<SVGGElement>) => void;
  onKeyDown: (e: KeyboardEvent<SVGGElement>) => void;
}

/**
 * The domino being rotated on the board. Rotating it is animated: it is drawn in the pose it had
 * when selected, inside a group that CSS turns a quarter turn around the pivot square on each tap
 * (a matching transform list, so the browser interpolates the angle instead of jumping).
 */
export function SelectedDomino({ a, b, original, pivot, turns, legal, label, onPointerDown, onKeyDown }: Props) {
  // Mount at 0 turns and move to `turns` after the first paint, so even a domino that is
  // selected and turned in one step (the R key) visibly turns.
  const [shown, setShown] = useState(0);
  useEffect(() => setShown(turns), [turns]);

  const c = placementCenter(original);
  const rot = rotationOf(original.cellA, original.cellB) ?? 0;
  const p = cellCenter(pivot);

  return (
    <g
      className="board-domino is-selected"
      style={{ transform: `translate(${p.x}px, ${p.y}px) rotate(${shown * 90}deg) translate(${-p.x}px, ${-p.y}px)` }}
      tabIndex={0}
      role="button"
      aria-pressed
      aria-label={label}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
    >
      <g transform={dominoTransform(c.x, c.y, rot)}>
        <DominoShape a={a} b={b} look={legal ? 'selected' : 'invalid'} translucent />
        {!legal && <rect x={2} y={2} width={196} height={94} rx={19} fill="none" stroke="#000" strokeWidth={6} />}
      </g>
    </g>
  );
}
