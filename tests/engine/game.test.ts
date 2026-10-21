import { describe, expect, it } from 'vitest';
import { gameReducer, newGame, timerElapsed, timerRunning, visibleErrors, type GameAction, type GameState } from '../../src/engine/game';
import { PIP_PATTERNS, pipPositions } from '../../src/ui/pips';
import { smallPuzzle } from './fixtures';

const p = smallPuzzle();
const run = (s: GameState, ...actions: GameAction[]) => actions.reduce((st, a) => gameReducer(p, st, a), s);

/** Fills the board wrongly: both dominoes horizontal. */
function wrongFull(): GameState {
  return run(
    newGame(p),
    { type: 'place', dominoId: 'd1', cellA: '0,0', cellB: '0,1', now: 1000 },
    { type: 'place', dominoId: 'd2', cellA: '1,0', cellB: '1,1', now: 2000 },
  );
}

describe('repair mode and completion', () => {
  it('23. a full but invalid board enters repair mode', () => {
    const s = wrongFull();
    expect(s.validationMode).toBe('repair');
    expect(s.solved).toBe(false);
  });

  it('starts in normal mode without visible errors', () => {
    // 4 lands in the left column whose sum must be 3: already impossible.
    const s = run(newGame(p), { type: 'place', dominoId: 'd2', cellA: '0,1', cellB: '0,0', now: 1 });
    expect(s.validationMode).toBe('normal');
    expect(visibleErrors(p, s).size).toBe(0);
  });

  it('24. violated conditions show the error state in repair mode', () => {
    expect([...visibleErrors(p, wrongFull())].sort()).toEqual(['r1', 'r2']);
  });

  it('25. a corrected condition loses its error', () => {
    // Swap so the left column becomes 2+... : put d1 vertical on the left, d2 still elsewhere is impossible,
    // so instead move d2 to the tray and d1 vertical left -> left region valid (1+2=3).
    let s = run(
      wrongFull(),
      { type: 'returnToTray', dominoId: 'd2', now: 3000 },
      { type: 'place', dominoId: 'd1', cellA: '0,0', cellB: '1,0', now: 3100 },
    );
    expect(s.validationMode).toBe('repair'); // kept after removing a piece
    const errs = visibleErrors(p, s, false);
    expect(errs.has('r1')).toBe(false);
    expect(errs.has('r2')).toBe(false); // empty right column is not yet violated
    s = run(s, { type: 'place', dominoId: 'd2', cellA: '1,1', cellB: '0,1', now: 3200 }); // 4 top, 3 bottom -> still 7
    expect(s.solved).toBe(true);
  });

  it('26. the final repair solves the puzzle and freezes the board', () => {
    const s = run(
      wrongFull(),
      { type: 'returnToTray', dominoId: 'd1', now: 3000 },
      { type: 'returnToTray', dominoId: 'd2', now: 3000 },
      { type: 'place', dominoId: 'd1', cellA: '0,0', cellB: '1,0', now: 4000 },
      { type: 'place', dominoId: 'd2', cellA: '0,1', cellB: '1,1', now: 5000 },
    );
    expect(s.solved).toBe(true);
    expect(visibleErrors(p, s, false).size).toBe(0);
    const frozen = run(s, { type: 'returnToTray', dominoId: 'd1', now: 6000 });
    expect(frozen).toBe(s);
  });

  it('27. reset clears repair state, placements and moves but keeps the timer', () => {
    const s0 = run(wrongFull(), { type: 'enter', now: 2000 });
    const s = run(s0, { type: 'reset', now: 5000 });
    expect(s.validationMode).toBe('normal');
    expect(s.placements).toEqual({});
    expect(s.moves).toBe(0);
    expect(s.solved).toBe(false);
    expect(timerElapsed(s.timer, 5000)).toBe(timerElapsed(s0.timer, 5000));
  });
});

describe('timer', () => {
  it('28. starts on entering play or on the first move', () => {
    const fresh = newGame(p);
    expect(timerRunning(fresh.timer)).toBe(false);
    expect(timerRunning(run(fresh, { type: 'enter', now: 0 }).timer)).toBe(true);
    const moved = run(fresh, { type: 'place', dominoId: 'd1', cellA: '0,0', cellB: '0,1', now: 500 });
    expect(timerRunning(moved.timer)).toBe(true);
  });

  it('29. does not stop on an incorrect full board', () => {
    const s = run(newGame(p), { type: 'enter', now: 0 }, { type: 'place', dominoId: 'd1', cellA: '0,0', cellB: '0,1', now: 1000 }, { type: 'place', dominoId: 'd2', cellA: '1,0', cellB: '1,1', now: 2000 });
    expect(s.validationMode).toBe('repair');
    expect(timerRunning(s.timer)).toBe(true);
    expect(timerElapsed(s.timer, 10_000)).toBe(10_000);
  });

  it('30. stops when the puzzle becomes solved', () => {
    const s = run(newGame(p), { type: 'enter', now: 0 }, { type: 'place', dominoId: 'd1', cellA: '0,0', cellB: '1,0', now: 1000 }, { type: 'place', dominoId: 'd2', cellA: '0,1', cellB: '1,1', now: 3000 });
    expect(s.solved).toBe(true);
    expect(timerRunning(s.timer)).toBe(false);
    expect(timerElapsed(s.timer, 99_999)).toBe(3000);
  });

  it('pauses on leave and resumes from the same time on re-entry', () => {
    let s = run(newGame(p), { type: 'enter', now: 0 }, { type: 'leave', now: 4000 });
    expect(timerElapsed(s.timer, 50_000)).toBe(4000);
    s = run(s, { type: 'enter', now: 60_000 });
    expect(timerElapsed(s.timer, 61_000)).toBe(5000);
  });
});

describe('tray', () => {
  it('rotates a tray domino through four quarter turns', () => {
    let s = newGame(p);
    for (let i = 0; i < 4; i++) s = run(s, { type: 'rotateTray', dominoId: 'd1' });
    expect(s.trayRotation.d1).toBe(0);
    expect(run(newGame(p), { type: 'rotateTray', dominoId: 'd1' }).trayRotation.d1).toBe(1);
  });
});

describe('pip patterns', () => {
  it.each([
    [0, []],
    [1, ['C']],
    [2, ['TL', 'BR']],
    [3, ['TL', 'C', 'BR']],
    [4, ['TL', 'TR', 'BL', 'BR']],
    [5, ['TL', 'TR', 'C', 'BL', 'BR']],
    [6, ['TL', 'ML', 'BL', 'TR', 'MR', 'BR']],
  ])('renders %i pips', (n, spots) => {
    expect(PIP_PATTERNS[n]).toEqual(spots);
    expect(pipPositions(n)).toHaveLength(n);
    expect(new Set(pipPositions(n).map((p) => p.join()))).toHaveProperty('size', n);
  });
});
