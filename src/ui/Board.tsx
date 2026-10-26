import { forwardRef, useMemo, type ReactNode, type SVGProps } from 'react';
import { badgeCell } from '../engine/puzzle';
import { parseCellId } from '../engine/geometry';
import type { Puzzle } from '../engine/types';
import { cellBounds, insetPath, outlineLoops } from './boardGeometry';
import { ConditionBadge } from './ConditionBadge';
import { BOARD, U, regionColor } from './theme';

export interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Room around the cells for the frame and for badges overhanging the bottom/right edges. */
const PAD = 46;

export function boardViewBox(puzzle: Puzzle, fullGrid = false): ViewBox {
  const b = fullGrid
    ? { minRow: 0, minCol: 0, maxRow: puzzle.rows - 1, maxCol: puzzle.cols - 1 }
    : cellBounds(puzzle.cells);
  return {
    x: b.minCol * U - PAD,
    y: b.minRow * U - PAD,
    w: (b.maxCol - b.minCol + 1) * U + 2 * PAD,
    h: (b.maxRow - b.minRow + 1) * U + 2 * PAD,
  };
}

interface Props extends Omit<SVGProps<SVGSVGElement>, 'ref'> {
  puzzle: Puzzle;
  errors?: Set<string>;
  /** Show every grid slot (editor). */
  fullGrid?: boolean;
  selectedRegion?: string | null;
  /** Drawn above regions, below badges (placed dominoes, previews). */
  pieces?: ReactNode;
  /** Drawn above everything (selected domino). */
  top?: ReactNode;
  /** Render as a <g> inside another SVG instead of a standalone <svg>. */
  asGroup?: boolean;
}

export const Board = forwardRef<SVGSVGElement, Props>(function Board(
  { puzzle, errors, fullGrid, selectedRegion, pieces, top, asGroup, ...svgProps },
  ref,
) {
  const vb = boardViewBox(puzzle, fullGrid);
  const regionOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of puzzle.regions) for (const c of r.cells) m.set(c, r.id);
    return m;
  }, [puzzle]);
  const regionPaths = useMemo(
    () =>
      puzzle.regions.map((r) => {
        const loops = outlineLoops(r.cells);
        return { region: r, fill: insetPath(loops, 5), dash: insetPath(loops, 12) };
      }),
    [puzzle],
  );

  const badges = puzzle.regions.flatMap((region) => {
    const bc = region.constraint ? badgeCell(region) : null;
    if (!bc) return [];
    const { row, col } = parseCellId(bc);
    return [{ region, x: (col + 1) * U, y: (row + 1) * U }];
  });

  const content = (
    <>
      {fullGrid &&
        Array.from({ length: puzzle.rows * puzzle.cols }, (_, i) => {
          const r = Math.floor(i / puzzle.cols);
          const c = i % puzzle.cols;
          return (
            <rect
              key={`g${i}`}
              x={c * U + 8}
              y={r * U + 8}
              width={U - 16}
              height={U - 16}
              rx={14}
              fill="none"
              stroke={BOARD.gridGhost}
              strokeWidth={2.5}
              strokeDasharray="7 7"
            />
          );
        })}
      {/* Board frame: overlapping rounded tiles merge into each board piece. */}
      <g fill={BOARD.frame}>
        {puzzle.cells.map((c) => (
          <rect key={c.id} x={c.col * U - 8} y={c.row * U - 8} width={U + 16} height={U + 16} rx={20} />
        ))}
      </g>
      {puzzle.cells
        .filter((c) => !regionOf.has(c.id))
        .map((c) => (
          <rect key={`e${c.id}`} x={c.col * U + 6} y={c.row * U + 6} width={U - 12} height={U - 12} rx={14} fill={BOARD.emptyCell} />
        ))}
      {regionPaths.map(({ region, fill, dash }) => {
        const col = regionColor(region.color);
        const sel = selectedRegion === region.id;
        return (
          <g key={region.id}>
            <path d={fill} fill={col.fill} stroke={col.fill} strokeWidth={8} strokeLinejoin="round" fillRule="evenodd" />
            {region.cells.map((id) => {
              const { row, col: c } = parseCellId(id);
              return <rect key={id} x={c * U + 13} y={row * U + 13} width={U - 26} height={U - 26} rx={12} fill="#fff" opacity={0.06} />;
            })}
            <path
              d={dash}
              fill="none"
              stroke={col.accent}
              strokeWidth={sel ? 6 : 3.6}
              strokeDasharray={sel ? '14 6' : '10 8'}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>
        );
      })}
      {pieces}
      {/* Conditions sit on the bottom-right corner of their region's last cell, above the dominoes. */}
      <g pointerEvents="none">
        {badges.map(({ region: r, x, y }) => (
          <ConditionBadge
            key={r.id}
            constraint={r.constraint!}
            invalid={!!errors?.has(r.id)}
            x={x}
            y={y}
            color={regionColor(r.color).accent}
            selected={selectedRegion === r.id}
          />
        ))}
      </g>
      {top}
    </>
  );

  if (asGroup) return <g>{content}</g>;
  return (
    <svg
      ref={ref}
      viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
      preserveAspectRatio="xMidYMid meet"
      overflow="visible"
      {...svgProps}
    >
      {content}
    </svg>
  );
});

/** Converts a client point to board units for an SVG rendered by <Board>. */
export function clientToBoard(svg: SVGSVGElement, vb: ViewBox, clientX: number, clientY: number) {
  const rect = svg.getBoundingClientRect();
  const scale = Math.min(rect.width / vb.w, rect.height / vb.h);
  const offX = (rect.width - vb.w * scale) / 2;
  const offY = (rect.height - vb.h * scale) / 2;
  return {
    x: (clientX - rect.left - offX) / scale + vb.x,
    y: (clientY - rect.top - offY) / scale + vb.y,
    scale,
  };
}

export function boardToClient(svg: SVGSVGElement, vb: ViewBox, x: number, y: number) {
  const rect = svg.getBoundingClientRect();
  const scale = Math.min(rect.width / vb.w, rect.height / vb.h);
  const offX = (rect.width - vb.w * scale) / 2;
  const offY = (rect.height - vb.h * scale) / 2;
  return { x: rect.left + offX + (x - vb.x) * scale, y: rect.top + offY + (y - vb.y) * scale, scale };
}
