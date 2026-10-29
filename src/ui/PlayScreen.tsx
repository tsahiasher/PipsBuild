import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { formatTime, timerElapsed, timerRunning, visibleErrors, type GameAction, type GameState } from '../engine/game';
import { anchorOf, cellId, parseCellId, rotationOf } from '../engine/geometry';
import { canPlaceDomino, placementFor, rotatePlacement } from '../engine/placement';
import { describeConstraint } from '../engine/constraints';
import { countSolutions } from '../engine/solver';
import type { CellId, Placement, Placements, Puzzle, Rotation } from '../engine/types';
import type { BestTime } from '../state/storage';
import { Board, boardToClient, boardViewBox, clientToBoard } from './Board';
import { DominoShape, dominoAriaLabel, dominoTransform } from './Domino';
import { Confetti } from './Confetti';
import { SelectedDomino } from './SelectedDomino';
import { placementCenter } from './boardGeometry';
import { Dialog } from './Dialog';
import { SOLVE_FLAG } from './flags';
import { U } from './theme';

const SELECT_TIMEOUT_MS = 2000;
const DRAG_THRESHOLD_PX = 6;
const RETURN_MS = 220;
/** Duration of the quarter-turn animation; keep in step with `.board-domino.is-selected` in styles.css. */
const TURN_MS = 180;
/** Solve animation: how long a domino takes to fly from the tray to the board, and the pause between steps. */
const FLY_MS = 650;
const STEP_PAUSE_MS = 280;
const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

type Source = 'tray' | 'board';

interface Preview {
  placement: Placement;
  legal: boolean;
}

interface Drag {
  id: string;
  source: Source;
  rot: Rotation;
  x: number;
  y: number;
  /** Pointer offset from the domino centre as a fraction of its on-screen box. */
  fx: number;
  fy: number;
  cellPx: number;
  preview: Preview | null;
  /** Client-space centre the piece animates back to after an illegal drop. */
  returning: { x: number; y: number } | null;
  /** Duration of that animation (default `RETURN_MS`). */
  flyMs?: number;
  /** Dragged out of a rotation selection: where (and how rotated) it goes back to on an illegal drop. */
  revertTo: Placement | null;
}

interface Pending {
  id: string;
  source: Source;
  pointerId: number;
  startX: number;
  startY: number;
  fx: number;
  fy: number;
}

interface Selection {
  id: string;
  tentative: Placement;
  legal: boolean;
  /** Square the domino turns around for the whole selection: its left (horizontal) or top (vertical) half. */
  pivot: CellId;
  /** Placement when the selection began; an illegal drag-and-drop returns the domino here. */
  original: Placement;
  /** Quarter turns clockwise since the selection began (drawn as an animated turn around the pivot). */
  turns: number;
  /** `turns` at the last legal pose, which is where an illegal turn snaps back to. */
  legalTurns: number;
}

interface KeyboardMove {
  id: string;
  anchor: CellId;
  rot: Rotation;
}

interface Props {
  puzzle: Puzzle;
  game: GameState;
  dispatch: (a: GameAction) => void;
  onBack: () => void;
  onPlayAgain: () => void;
  onImportAnother: () => void;
  /** Start solving as soon as the screen opens (Solve pressed in the editor). */
  autoSolve?: boolean;
  onAutoSolveStarted?: () => void;
  /** Fastest solve of this puzzle so far (including the one just finished). */
  best?: BestTime;
}

export function PlayScreen({ puzzle, game, dispatch, onBack, onPlayAgain, onImportAnother, autoSolve, onAutoSolveStarted, best }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const trayRef = useRef<HTMLDivElement>(null);
  const dominoCount = puzzle.dominoes.length;

  // Side tray (landscape): pick the column count that makes the dominoes as large as possible while all of them fit.
  useEffect(() => {
    const tray = trayRef.current;
    if (!tray) return;
    const SLOT_RATIO = 1.5; // slot width / height; keep in sync with .slot in styles.css
    const fit = () => {
      const cs = getComputedStyle(tray);
      const gap = parseFloat(cs.rowGap) || 0;
      const w = tray.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const h = tray.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      let best = dominoCount;
      for (let c = 1; c <= dominoCount; c++) {
        const slotW = (w - (c - 1) * gap) / c;
        const rows = Math.ceil(dominoCount / c);
        if (slotW > 0 && rows * (slotW / SLOT_RATIO) + (rows - 1) * gap <= h) {
          best = c;
          break; // fewer columns = larger slots, so the first that fits is the biggest
        }
      }
      tray.style.setProperty('--tray-cols', String(best));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(tray);
    return () => ro.disconnect();
  }, [dominoCount]);
  const slotRefs = useRef(new Map<string, HTMLDivElement>());
  const pending = useRef<Pending | null>(null);
  const selTimer = useRef<number | null>(null);

  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  dragRef.current = drag;
  const [selection, setSelectionState] = useState<Selection | null>(null);
  const selectionRef = useRef<Selection | null>(null);
  const setSelection = useCallback((s: Selection | null) => {
    selectionRef.current = s;
    setSelectionState(s);
  }, []);
  const [kbd, setKbd] = useState<KeyboardMove | null>(null);
  const [announce, setAnnounce] = useState('');
  const [confirmReset, setConfirmReset] = useState(false);
  const [doneDismissed, setDoneDismissed] = useState(false);

  const gameRef = useRef(game);
  gameRef.current = game;
  const vb = useMemo(() => boardViewBox(puzzle), [puzzle]);
  const dominoById = useMemo(() => new Map(puzzle.dominoes.map((d) => [d.id, d])), [puzzle]);
  const errors = visibleErrors(puzzle, game);

  // ---------- timer ----------
  useEffect(() => {
    dispatch({ type: 'enter', now: Date.now() });
    const onVis = () => dispatch({ type: document.hidden ? 'leave' : 'enter', now: Date.now() });
    document.addEventListener('visibilitychange', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      dispatch({ type: 'leave', now: Date.now() });
    };
  }, [dispatch, puzzle.id]);

  const [now, setNow] = useState(Date.now());
  const running = timerRunning(game.timer);
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(t);
  }, [running]);
  const elapsed = timerElapsed(game.timer, running ? Math.max(now, game.timer.startedAt ?? 0) : now);

  useEffect(() => {
    if (game.solved) {
      setSelection(null);
      setKbd(null);
      setAnnounce(`Puzzle solved in ${formatTime(timerElapsed(game.timer, Date.now()))}.`);
    } else setDoneDismissed(false);
  }, [game.solved]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- helpers ----------
  const canPlace = useCallback(
    (id: string, p: Placement) => {
      const d = dominoById.get(id);
      return !!d && canPlaceDomino(puzzle, gameRef.current.placements, d, p.cellA, p.cellB);
    },
    [dominoById, puzzle],
  );

  const cellPx = () => (svgRef.current ? boardToClient(svgRef.current, vb, 0, 0).scale * U : 60);

  const clearSelection = useCallback(() => {
    if (selTimer.current) window.clearTimeout(selTimer.current);
    selTimer.current = null;
    setSelection(null);
  }, [setSelection]);

  const armSelectionTimer = useCallback(() => {
    if (selTimer.current) window.clearTimeout(selTimer.current);
    // After 2 s without taps the selection ends; an illegal tentative position reverts
    // to the last legal placement (which is what the game state still holds).
    selTimer.current = window.setTimeout(() => {
      const sel = selectionRef.current;
      if (sel && !sel.legal) {
        // Turn it back to the last legal pose (what the game still holds), then let go.
        setSelection({ ...sel, turns: sel.legalTurns, tentative: gameRef.current.placements[sel.id] ?? sel.original, legal: true });
        selTimer.current = window.setTimeout(() => {
          selTimer.current = null;
          setSelection(null);
        }, TURN_MS + 40);
      } else {
        selTimer.current = null;
        setSelection(null);
      }
    }, SELECT_TIMEOUT_MS);
  }, [setSelection]);

  useEffect(() => () => clearSelection(), [clearSelection]);

  /** Finds the nearest legal placement for a piece whose centre is at a client point. */
  const computePreview = useCallback(
    (id: string, rot: Rotation, cx: number, cy: number): Preview | null => {
      const svg = svgRef.current;
      if (!svg) return null;
      const p = clientToBoard(svg, vb, cx, cy);
      const horizontal = rot % 2 === 0;
      const fc = (p.x - (horizontal ? U : U / 2)) / U;
      const fr = (p.y - (horizontal ? U / 2 : U)) / U;
      let best: { pl: Placement; d: number } | null = null;
      for (let r = Math.floor(fr) - 1; r <= Math.ceil(fr) + 1; r++)
        for (let c = Math.floor(fc) - 1; c <= Math.ceil(fc) + 1; c++) {
          const d = Math.hypot(r - fr, c - fc);
          if (d > 0.72) continue;
          const pl = placementFor(cellId(r, c), rot);
          if (canPlace(id, pl) && (!best || d < best.d)) best = { pl, d };
        }
      if (best) return { placement: best.pl, legal: true };
      const rr = Math.round(fr);
      const cc = Math.round(fc);
      if (Math.hypot(rr - fr, cc - fc) > 0.72) return null;
      const pl = placementFor(cellId(rr, cc), rot);
      const cells = new Set(puzzle.cells.map((c) => c.id));
      if (!cells.has(pl.cellA) && !cells.has(pl.cellB)) return null;
      return { placement: pl, legal: false };
    },
    [canPlace, puzzle.cells, vb],
  );

  // ---------- pointer interaction ----------
  const onMove = useCallback(
    (e: PointerEvent) => {
      const pd = pending.current;
      if (!pd || e.pointerId !== pd.pointerId) return;
      let d = dragRef.current;
      if (!d) {
        if (Math.hypot(e.clientX - pd.startX, e.clientY - pd.startY) < DRAG_THRESHOLD_PX) return;
        const g = gameRef.current;
        const placed = g.placements[pd.id];
        // A domino being rotated is picked up in its current (possibly not yet legal) rotation.
        const sel = selectionRef.current?.id === pd.id ? selectionRef.current : null;
        const shown = sel ? sel.tentative : placed;
        const rot: Rotation = pd.source === 'board' && shown ? rotationOf(shown.cellA, shown.cellB) ?? 0 : g.trayRotation[pd.id] ?? 0;
        clearSelection();
        d = {
          id: pd.id,
          source: pd.source,
          rot,
          x: e.clientX,
          y: e.clientY,
          fx: pd.fx,
          fy: pd.fy,
          cellPx: cellPx(),
          preview: null,
          returning: null,
          revertTo: sel ? sel.original : null,
        };
      }
      const W = (d.rot % 2 === 0 ? 2 : 1) * d.cellPx;
      const H = (d.rot % 2 === 0 ? 1 : 2) * d.cellPx;
      const preview = computePreview(d.id, d.rot, e.clientX - d.fx * W, e.clientY - d.fy * H);
      const next = { ...d, x: e.clientX, y: e.clientY, preview };
      dragRef.current = next;
      setDrag(next);
    },
    [clearSelection, computePreview], // eslint-disable-line react-hooks/exhaustive-deps
  );

  /**
   * First tap selects a placed domino; each further tap turns it a quarter turn around the
   * same square (four taps make a full circle). `rotateNow` selects and turns in one step.
   */
  const handleBoardTap = useCallback(
    (id: string, rotateNow = false) => {
      const placed = gameRef.current.placements[id];
      if (!placed) return;
      const current = selectionRef.current;
      const fresh = !current || current.id !== id;
      const sel: Selection = fresh
        ? { id, tentative: placed, legal: true, pivot: anchorOf(placed.cellA, placed.cellB), original: placed, turns: 0, legalTurns: 0 }
        : current;
      let next: Selection;
      if (fresh && !rotateNow) {
        next = sel;
        setAnnounce(`Selected. ${dominoLabel(id)} Tap again to rotate.`);
      } else {
        const tentative = rotatePlacement(sel.tentative, sel.pivot);
        const legal = canPlace(id, tentative);
        if (legal) dispatch({ type: 'place', dominoId: id, cellA: tentative.cellA, cellB: tentative.cellB, now: Date.now() });
        setAnnounce(legal ? 'Rotated.' : 'Rotated into an illegal position; it will snap back unless rotated again.');
        const turns = sel.turns + 1;
        next = { ...sel, tentative, legal, turns, legalTurns: legal ? turns : sel.legalTurns };
      }
      setSelection(next);
      armSelectionTimer();
    },
    [armSelectionTimer, canPlace, dispatch, setSelection], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const onUp = useCallback(
    (e: PointerEvent) => {
      const pd = pending.current;
      if (!pd || e.pointerId !== pd.pointerId) return;
      pending.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      const d = dragRef.current;
      const now = Date.now();
      if (!d) {
        if (e.type === 'pointercancel') return;
        if (pd.source === 'tray') {
          clearSelection();
          dispatch({ type: 'rotateTray', dominoId: pd.id });
        } else handleBoardTap(pd.id);
        return;
      }
      if (e.type !== 'pointercancel' && d.preview?.legal) {
        dispatch({ type: 'place', dominoId: d.id, cellA: d.preview.placement.cellA, cellB: d.preview.placement.cellB, now });
        setAnnounce(`Placed. ${dominoLabel(d.id)}`);
        dragRef.current = null;
        setDrag(null);
        return;
      }
      const tray = trayRef.current?.getBoundingClientRect();
      const overTray = tray && e.clientX >= tray.left && e.clientX <= tray.right && e.clientY >= tray.top && e.clientY <= tray.bottom;
      if (overTray && d.source === 'board' && e.type !== 'pointercancel') {
        dispatch({ type: 'returnToTray', dominoId: d.id, now, rotation: 0 });
        setAnnounce('Returned to the tray.');
        // Turn the piece upright and glide it into its own tray slot.
        const slot = slotRefs.current.get(d.id)?.getBoundingClientRect();
        if (!slot) {
          dragRef.current = null;
          setDrag(null);
          return;
        }
        const home = { ...d, rot: 0 as Rotation, preview: null, returning: { x: slot.left + slot.width / 2, y: slot.top + slot.height / 2 } };
        dragRef.current = home;
        setDrag(home);
        window.setTimeout(() => {
          if (dragRef.current === home) {
            dragRef.current = null;
            setDrag(null);
          }
        }, RETURN_MS + 30);
        return;
      }
      // Illegal drop: animate back to where the piece came from.
      let target: { x: number; y: number } | null = null;
      let placed = gameRef.current.placements[d.id];
      let rot = d.rot;
      if (d.source === 'board' && d.revertTo) {
        // Dragged out of a rotation: restore the placement and rotation from before the selection.
        const o = d.revertTo;
        if (!placed || placed.cellA !== o.cellA || placed.cellB !== o.cellB) {
          dispatch({ type: 'place', dominoId: d.id, cellA: o.cellA, cellB: o.cellB, now });
        }
        placed = o;
        rot = rotationOf(o.cellA, o.cellB) ?? 0;
      }
      if (d.source === 'board' && placed && svgRef.current) {
        const c = placementCenter(placed);
        target = boardToClient(svgRef.current, vb, c.x, c.y);
      } else {
        const slot = slotRefs.current.get(d.id)?.getBoundingClientRect();
        if (slot) target = { x: slot.left + slot.width / 2, y: slot.top + slot.height / 2 };
      }
      if (!target) {
        dragRef.current = null;
        setDrag(null);
        return;
      }
      const back = { ...d, rot, preview: null, returning: target };
      dragRef.current = back;
      setDrag(back);
      window.setTimeout(() => {
        if (dragRef.current === back) {
          dragRef.current = null;
          setDrag(null);
        }
      }, RETURN_MS + 30);
    },
    [clearSelection, dispatch, handleBoardTap, onMove, vb], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const onPiecePointerDown = (e: ReactPointerEvent<Element>, id: string, source: Source) => {
    if (game.solved || pending.current || dragRef.current || solvingRef.current) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    setKbd(null);
    if (selection && selection.id !== id) clearSelection();
    const rect = (e.currentTarget as Element).getBoundingClientRect();
    pending.current = {
      id,
      source,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      fx: (e.clientX - (rect.left + rect.width / 2)) / Math.max(1, rect.width),
      fy: (e.clientY - (rect.top + rect.height / 2)) / Math.max(1, rect.height),
    };
    // Capture on the stable root so moving/unmounting pieces never loses the gesture.
    try {
      rootRef.current?.setPointerCapture(e.pointerId);
    } catch {
      /* not supported: window listeners still work */
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  useEffect(
    () => () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    },
    [onMove, onUp],
  );

  // ---------- keyboard ----------
  const bounds = useMemo(() => {
    const rows = puzzle.cells.map((c) => c.row);
    const cols = puzzle.cells.map((c) => c.col);
    return { r0: Math.min(...rows), r1: Math.max(...rows), c0: Math.min(...cols), c1: Math.max(...cols) };
  }, [puzzle.cells]);

  const firstLegalAnchor = (id: string, rot: Rotation): CellId => {
    for (const c of puzzle.cells) if (canPlace(id, placementFor(c.id, rot))) return c.id;
    return puzzle.cells[0]?.id ?? '0,0';
  };

  function dominoLabel(id: string): string {
    const d = dominoById.get(id);
    if (!d) return '';
    const g = gameRef.current;
    const p = g.placements[id];
    const rot = p ? rotationOf(p.cellA, p.cellB) ?? 0 : g.trayRotation[id] ?? 0;
    return dominoAriaLabel(d.a, d.b, rot) + (p ? ', on the board.' : ', in the tray.');
  }

  const onPieceKey = (e: ReactKeyboardEvent, id: string, source: Source) => {
    if (game.solved) return;
    const key = e.key;
    if (kbd && kbd.id === id) {
      let { anchor, rot } = kbd;
      const { row, col } = parseCellId(anchor);
      const move = (dr: number, dc: number) =>
        cellId(Math.min(bounds.r1, Math.max(bounds.r0, row + dr)), Math.min(bounds.c1, Math.max(bounds.c0, col + dc)));
      if (key === 'ArrowUp') anchor = move(-1, 0);
      else if (key === 'ArrowDown') anchor = move(1, 0);
      else if (key === 'ArrowLeft') anchor = move(0, -1);
      else if (key === 'ArrowRight') anchor = move(0, 1);
      else if (key === 'r' || key === 'R') rot = (((rot + 1) % 4) as Rotation);
      else if (key === 'Escape') {
        e.preventDefault();
        setKbd(null);
        setAnnounce('Cancelled.');
        return;
      } else if (key === 'Enter' || key === ' ') {
        e.preventDefault();
        const pl = placementFor(anchor, rot);
        if (canPlace(id, pl)) {
          dispatch({ type: 'place', dominoId: id, cellA: pl.cellA, cellB: pl.cellB, now: Date.now() });
          setKbd(null);
          setAnnounce(`Placed. ${dominoLabel(id)}`);
        } else setAnnounce('That position is not allowed.');
        return;
      } else return;
      e.preventDefault();
      setKbd({ id, anchor, rot });
      setAnnounce(`${canPlace(id, placementFor(anchor, rot)) ? 'Legal' : 'Illegal'} position, row ${parseCellId(anchor).row + 1}, column ${parseCellId(anchor).col + 1}.`);
      return;
    }
    if (key === 'Enter' || key === ' ') {
      e.preventDefault();
      clearSelection();
      const p = game.placements[id];
      const rot: Rotation = p ? rotationOf(p.cellA, p.cellB) ?? 0 : game.trayRotation[id] ?? 0;
      const anchor = p ? anchorOf(p.cellA, p.cellB) : firstLegalAnchor(id, rot);
      setKbd({ id, anchor, rot });
      setAnnounce('Picked up. Use arrow keys to move, R to rotate, Enter to drop, Escape to cancel.');
    } else if (key === 'r' || key === 'R') {
      e.preventDefault();
      if (source === 'tray') dispatch({ type: 'rotateTray', dominoId: id });
      else {
        handleBoardTap(id, true);
      }
    } else if ((key === 'Delete' || key === 'Backspace') && source === 'board') {
      e.preventDefault();
      dispatch({ type: 'returnToTray', dominoId: id, now: Date.now(), rotation: 0 });
      setAnnounce('Returned to the tray.');
    }
  };

  // ---------- render ----------
  const boardPieces = puzzle.dominoes
    .filter((d) => game.placements[d.id] && selection?.id !== d.id)
    .map((d) => {
      const p = game.placements[d.id];
      const c = placementCenter(p);
      const rot = rotationOf(p.cellA, p.cellB) ?? 0;
      const hidden = drag?.id === d.id || kbd?.id === d.id;
      return (
        <g
          key={d.id}
          className="board-domino"
          transform={dominoTransform(c.x, c.y, rot)}
          opacity={hidden ? 0.25 : 1}
          tabIndex={game.solved ? -1 : 0}
          role="button"
          aria-label={dominoAriaLabel(d.a, d.b, rot) + ', on the board'}
          onPointerDown={(e) => onPiecePointerDown(e, d.id, 'board')}
          onKeyDown={(e) => onPieceKey(e, d.id, 'board')}
        >
          <DominoShape a={d.a} b={d.b} translucent />
        </g>
      );
    });

  const previewOf = (id: string, pv: Preview | null) => {
    if (!pv) return null;
    const d = dominoById.get(id)!;
    const c = placementCenter(pv.placement);
    const rot = rotationOf(pv.placement.cellA, pv.placement.cellB) ?? 0;
    return (
      <g transform={dominoTransform(c.x, c.y, rot)} pointerEvents="none">
        <DominoShape a={d.a} b={d.b} look={pv.legal ? 'preview-ok' : 'preview-bad'} />
      </g>
    );
  };

  const kbdPreview = kbd ? previewOf(kbd.id, { placement: placementFor(kbd.anchor, kbd.rot), legal: canPlace(kbd.id, placementFor(kbd.anchor, kbd.rot)) }) : null;

  let selected = null;
  if (selection) {
    const d = dominoById.get(selection.id)!;
    const rot = rotationOf(selection.tentative.cellA, selection.tentative.cellB) ?? 0;
    selected = (
      <SelectedDomino
        key={selection.id}
        a={d.a}
        b={d.b}
        original={selection.original}
        pivot={selection.pivot}
        turns={selection.turns}
        legal={selection.legal}
        label={dominoAriaLabel(d.a, d.b, rot) + (selection.legal ? ', selected' : ', selected, illegal position')}
        onPointerDown={(e) => onPiecePointerDown(e, d.id, 'board')}
        onKeyDown={(e) => onPieceKey(e, d.id, 'board')}
      />
    );
  }

  // ---------- solve (?solve=1): plays the engine's solution out, domino by domino ----------
  const [solving, setSolving] = useState(false);
  const solvingRef = useRef(false);
  const solveRun = useRef(0);
  const solution = useRef<{ puzzleId: string; placements: Placements } | null>(null);
  const [solveNote, setSolveNote] = useState('');

  const stopSolving = useCallback(() => {
    solveRun.current++; // ends the running loop at its next step
    solvingRef.current = false;
    setSolving(false);
    dragRef.current = null;
    setDrag(null);
  }, []);

  const startSolving = useCallback(async () => {
    const run = ++solveRun.current;
    const alive = () => solveRun.current === run;
    clearSelection();
    setKbd(null);
    setSolveNote('');
    solvingRef.current = true;
    setSolving(true);
    await sleep(0); // let the first render show the Stop button before the (possibly slow) search

    // Find the solution once; stopping and solving again carries on with the same one.
    if (solution.current?.puzzleId !== puzzle.id) {
      const found = countSolutions(puzzle, { maxSolutions: 1, maxMs: 4000, collect: true });
      const first = found.solutions?.[0];
      if (!first) {
        setSolveNote(found.reason ?? (found.complete ? 'This puzzle has no solution.' : 'No solution found in time.'));
        stopSolving();
        return;
      }
      solution.current = { puzzleId: puzzle.id, placements: first };
    }
    const target = solution.current.placements;

    // A board that has left the solution (the player moved things) starts over from an empty one.
    const off = Object.entries(gameRef.current.placements).some(([id, p]) => {
      const t = target[id];
      return !t || t.cellA !== p.cellA || t.cellB !== p.cellB;
    });
    if (off) {
      dispatch({ type: 'reset', now: Date.now() });
      await sleep(STEP_PAUSE_MS);
    }

    for (const d of puzzle.dominoes) {
      if (!alive()) return;
      if (gameRef.current.placements[d.id]) continue;
      const want = target[d.id];
      const wantRot = rotationOf(want.cellA, want.cellB) ?? 0;

      // Turn it in the tray (animated by the tray's own transition).
      for (let i = 0; i < 4 && (gameRef.current.trayRotation[d.id] ?? 0) !== wantRot; i++) {
        dispatch({ type: 'rotateTray', dominoId: d.id });
        await sleep(TURN_MS + 120);
        if (!alive()) return;
      }

      // Fly it to its place: the drag ghost starts over the tray slot and slides to the board.
      const slot = slotRefs.current.get(d.id)?.getBoundingClientRect();
      const svg = svgRef.current;
      if (slot && svg) {
        const c = placementCenter(want);
        const to = boardToClient(svg, vb, c.x, c.y);
        const from = { x: slot.left + slot.width / 2, y: slot.top + slot.height / 2 };
        const base: Drag = { id: d.id, source: 'tray', rot: wantRot, x: 0, y: 0, fx: 0, fy: 0, cellPx: cellPx(), preview: null, returning: from, revertTo: null, flyMs: FLY_MS };
        dragRef.current = base;
        setDrag(base);
        await sleep(40);
        if (!alive()) return;
        const flying = { ...base, returning: { x: to.x, y: to.y } };
        dragRef.current = flying;
        setDrag(flying);
        await sleep(FLY_MS + 40);
        if (!alive()) return;
      }
      dispatch({ type: 'place', dominoId: d.id, cellA: want.cellA, cellB: want.cellB, now: Date.now() });
      dragRef.current = null;
      setDrag(null);
      await sleep(STEP_PAUSE_MS);
    }
    if (alive()) {
      solvingRef.current = false;
      setSolving(false);
    }
  }, [clearSelection, dispatch, puzzle, stopSolving, vb]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (SOLVE_FLAG && autoSolve) {
      onAutoSolveStarted?.();
      void startSolving();
    }
    return () => {
      solveRun.current++;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const violated = puzzle.regions.filter((r) => errors.has(r.id));
  const placedCount = Object.keys(game.placements).length;
  const solvedTime = timerElapsed(game.timer, Date.now());
  const newBest = !!best && best.solves > 1 && solvedTime <= best.ms;

  return (
    <div ref={rootRef} className={`screen play ${drag ? 'dragging' : ''}`}>
      <header className="topbar">
        <button className="btn ghost icon-btn" onClick={onBack} aria-label="Back">
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
            <path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="timer" aria-label={`Elapsed time ${formatTime(elapsed)}`} role="timer">
          {formatTime(elapsed)}
        </div>
        <div className="row gap-sm">
          {SOLVE_FLAG && !game.solved && (
            <button className="btn" onClick={() => (solving ? stopSolving() : void startSolving())}>
              {solving ? 'Stop' : 'Solve'}
            </button>
          )}
          <button
            className="btn ghost"
            onClick={() => (game.moves > 0 || placedCount > 0 ? setConfirmReset(true) : dispatch({ type: 'reset', now: Date.now() }))}
            disabled={game.solved || solving}
          >
            Reset
          </button>
        </div>
      </header>

      <div className="status-line" aria-live="polite">
        {solveNote
          ? solveNote
          : game.solved
          ? 'Solved!'
          : violated.length > 0
            ? `${violated.length} condition${violated.length > 1 ? 's' : ''} not satisfied (marked with a red dot)`
            : game.validationMode === 'repair'
              ? 'Keep going: fill the board to finish.'
              : ''}
      </div>

      <section className="board-area" aria-label="Puzzle board">
        <Board
          ref={svgRef}
          puzzle={puzzle}
          errors={errors}
          className="board-svg"
          role="group"
          aria-label={`Board with ${puzzle.cells.length} cells`}
          pieces={
            <>
              {boardPieces}
              {drag && previewOf(drag.id, drag.preview)}
              {kbdPreview}
            </>
          }
          top={selected}
        />
        <ul className="sr-only">
          {puzzle.regions
            .filter((r) => r.constraint)
            .map((r) => (
              <li key={r.id}>
                {describeConstraint(r.constraint)}
                {errors.has(r.id) ? ' (not satisfied)' : ''}
              </li>
            ))}
        </ul>
      </section>

      <section className="tray" ref={trayRef} aria-label="Domino tray">
        {puzzle.dominoes.map((d) => {
          const placed = !!game.placements[d.id];
          return (
            <div
              key={d.id}
              className="slot"
              ref={(el) => {
                if (el) slotRefs.current.set(d.id, el);
                else slotRefs.current.delete(d.id);
              }}
            >
              {!placed && (
                <TrayDomino
                  a={d.a}
                  b={d.b}
                  rotation={game.trayRotation[d.id] ?? 0}
                  hidden={drag?.id === d.id || kbd?.id === d.id}
                  disabled={game.solved}
                  onPointerDown={(e) => onPiecePointerDown(e, d.id, 'tray')}
                  onKeyDown={(e) => onPieceKey(e, d.id, 'tray')}
                />
              )}
            </div>
          );
        })}
      </section>

      {drag && <DragGhost drag={drag} domino={dominoById.get(drag.id)!} />}

      <div className="sr-only" aria-live="assertive">
        {announce}
      </div>

      {confirmReset && (
        <Dialog
          title="Reset puzzle?"
          onClose={() => setConfirmReset(false)}
          actions={
            <>
              <button className="btn" onClick={() => setConfirmReset(false)}>
                Cancel
              </button>
              <button
                className="btn danger"
                onClick={() => {
                  clearSelection();
                  setKbd(null);
                  dispatch({ type: 'reset', now: Date.now() });
                  setConfirmReset(false);
                }}
              >
                Reset
              </button>
            </>
          }
        >
          <p>All dominoes go back to the tray. The timer keeps running.</p>
        </Dialog>
      )}

      {game.solved && !doneDismissed && (
        <>
          <Confetti />
          <Dialog
            title="Puzzle solved!"
            onClose={() => setDoneDismissed(true)}
            actions={
              <>
                <button className="btn" onClick={onImportAnother}>
                  Import another puzzle
                </button>
                <button className="btn primary" onClick={onPlayAgain}>
                  Play again
                </button>
              </>
            }
          >
            <div className="result">
              <div>
                <div className="muted small">Time</div>
                <div className="result-time">{formatTime(solvedTime)}</div>
              </div>
              <div>
                <div className="muted small">Moves</div>
                <div className="result-moves">{game.moves}</div>
              </div>
              {best && (
                <div>
                  <div className="muted small">Best</div>
                  <div className="result-moves">{formatTime(best.ms)}</div>
                </div>
              )}
            </div>
            {newBest && <p className="new-best">New best time!</p>}
          </Dialog>
        </>
      )}
    </div>
  );
}

interface TrayDominoProps {
  a: number;
  b: number;
  rotation: Rotation;
  hidden: boolean;
  disabled: boolean;
  onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onKeyDown: (e: ReactKeyboardEvent<HTMLDivElement>) => void;
}

/** Tray piece; tapping rotates it a quarter turn around its centre (animated). */
function TrayDomino({ a, b, rotation, hidden, disabled, onPointerDown, onKeyDown }: TrayDominoProps) {
  // Accumulate turns so 270° -> 0° keeps spinning forward instead of unwinding.
  const turns = useRef(rotation);
  const prev = useRef(rotation);
  if (prev.current !== rotation) {
    turns.current += (rotation - prev.current + 4) % 4;
    prev.current = rotation;
  }
  return (
    <div
      className="tray-domino"
      style={{ visibility: hidden ? 'hidden' : 'visible', transform: `rotate(${turns.current * 90}deg)` }}
      tabIndex={disabled ? -1 : 0}
      role="button"
      aria-label={dominoAriaLabel(a, b, rotation) + ', in the tray. Tap to rotate, drag to place.'}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
    >
      <svg viewBox="0 0 200 100" aria-hidden>
        <DominoShape a={a} b={b} />
      </svg>
    </div>
  );
}

function DragGhost({ drag, domino }: { drag: Drag; domino: { a: number; b: number } }) {
  const W = (drag.rot % 2 === 0 ? 2 : 1) * drag.cellPx;
  const H = (drag.rot % 2 === 0 ? 1 : 2) * drag.cellPx;
  const cx = drag.returning ? drag.returning.x : drag.x - drag.fx * W;
  const cy = drag.returning ? drag.returning.y : drag.y - drag.fy * H;
  const w = 2 * drag.cellPx;
  const h = drag.cellPx;
  return (
    <div
      className={`drag-ghost ${drag.returning ? 'returning' : ''}`}
      style={{
        width: w,
        height: h,
        transform: `translate(${cx - w / 2}px, ${cy - h / 2}px) rotate(${drag.rot * 90}deg) scale(${drag.returning ? 1 : 1.06})`,
        transitionDuration: drag.returning ? `${drag.flyMs ?? RETURN_MS}ms` : '0ms',
      }}
      aria-hidden
    >
      <svg viewBox="0 0 200 100" width={w} height={h}>
        <DominoShape a={domino.a} b={domino.b} look="lifted" />
      </svg>
    </div>
  );
}
