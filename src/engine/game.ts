import { isBoardFull, isSolved, violatedRegions } from './constraints';
import { nextRotation } from './geometry';
import { placeDomino, removeDomino } from './placement';
import type { CellId, Placements, Puzzle, Rotation } from './types';

export type ValidationMode = 'normal' | 'repair';

export interface TimerState {
  /** Time accumulated before the current running span. */
  elapsedMs: number;
  /** Timestamp the current running span began, or null when paused/stopped. */
  startedAt: number | null;
}

export interface GameState {
  puzzleId: string;
  placements: Placements;
  /** Rotation of each domino while it sits in the tray. */
  trayRotation: Record<string, Rotation>;
  validationMode: ValidationMode;
  moves: number;
  solved: boolean;
  timer: TimerState;
}

// ---------- timer ----------

export const timerElapsed = (t: TimerState, now: number): number =>
  t.elapsedMs + (t.startedAt !== null ? Math.max(0, now - t.startedAt) : 0);

export const timerRunning = (t: TimerState): boolean => t.startedAt !== null;

export const startTimer = (t: TimerState, now: number): TimerState =>
  t.startedAt !== null ? t : { ...t, startedAt: now };

export const pauseTimer = (t: TimerState, now: number): TimerState =>
  t.startedAt === null ? t : { elapsedMs: timerElapsed(t, now), startedAt: null };

export function formatTime(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

// ---------- state ----------

export function newGame(puzzle: Puzzle): GameState {
  return {
    puzzleId: puzzle.id,
    placements: {},
    trayRotation: Object.fromEntries(puzzle.dominoes.map((d) => [d.id, 0 as Rotation])),
    validationMode: 'normal',
    moves: 0,
    solved: false,
    timer: { elapsedMs: 0, startedAt: null },
  };
}

/** Called whenever the board changes: detects completion and switches to repair mode. */
function settle(puzzle: Puzzle, state: GameState, now: number): GameState {
  if (!isBoardFull(puzzle, state.placements)) return state;
  if (isSolved(puzzle, state.placements)) {
    return { ...state, solved: true, timer: pauseTimer(state.timer, now) };
  }
  return { ...state, validationMode: 'repair' };
}

export type GameAction =
  | { type: 'enter'; now: number }
  | { type: 'leave'; now: number }
  | { type: 'place'; dominoId: string; cellA: CellId; cellB: CellId; now: number }
  | { type: 'returnToTray'; dominoId: string; now: number; rotation?: Rotation }
  | { type: 'rotateTray'; dominoId: string }
  | { type: 'reset'; now: number };

export function gameReducer(puzzle: Puzzle, state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case 'enter':
      return state.solved ? state : { ...state, timer: startTimer(state.timer, action.now) };
    case 'leave':
      return { ...state, timer: pauseTimer(state.timer, action.now) };
    case 'rotateTray': {
      if (state.solved || state.placements[action.dominoId]) return state;
      const cur = state.trayRotation[action.dominoId] ?? 0;
      return { ...state, trayRotation: { ...state.trayRotation, [action.dominoId]: nextRotation(cur) } };
    }
    case 'place': {
      if (state.solved) return state;
      const domino = puzzle.dominoes.find((d) => d.id === action.dominoId);
      if (!domino) return state;
      const prev = state.placements[domino.id];
      if (prev && prev.cellA === action.cellA && prev.cellB === action.cellB) return state;
      const placements = placeDomino(puzzle, state.placements, domino, action.cellA, action.cellB);
      if (!placements) return state;
      const next: GameState = {
        ...state,
        placements,
        moves: state.moves + 1,
        timer: startTimer(state.timer, action.now),
      };
      return settle(puzzle, next, action.now);
    }
    case 'returnToTray': {
      if (state.solved || !state.placements[action.dominoId]) return state;
      // Repair mode is intentionally kept so feedback stays visible.
      const trayRotation =
        action.rotation !== undefined ? { ...state.trayRotation, [action.dominoId]: action.rotation } : state.trayRotation;
      return { ...state, placements: removeDomino(state.placements, action.dominoId), trayRotation, moves: state.moves + 1 };
    }
    case 'reset': {
      const fresh = newGame(puzzle);
      // The timer keeps its accumulated time; it keeps running if it was running.
      const timer = state.solved ? startTimer(state.timer, action.now) : state.timer;
      return { ...fresh, timer };
    }
  }
}

/** Region ids that should display a red error dot. */
export function visibleErrors(puzzle: Puzzle, state: GameState, showWhilePlaying: boolean): Set<string> {
  if (state.solved) return new Set();
  if (state.validationMode !== 'repair' && !showWhilePlaying) return new Set();
  return violatedRegions(puzzle, state.placements);
}
