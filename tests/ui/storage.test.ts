import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadState } from '../../src/state/storage';
import { smallPuzzle } from '../engine/fixtures';

const KEY = 'pips-studio/state/v1';
const puzzle = smallPuzzle();

/** What the app saved before best times existed. */
const oldSave = {
  draft: null,
  recognition: null,
  active: puzzle,
  games: {
    [puzzle.id]: {
      puzzleId: puzzle.id,
      placements: { d1: { cellA: '0,0', cellB: '1,0' } },
      trayRotation: { d1: 0, d2: 1 },
      validationMode: 'normal',
      moves: 1,
      solved: false,
      timer: { elapsedMs: 5000, startedAt: 10_000 },
    },
  },
  settings: { showValidationWhilePlaying: true },
  screen: 'play',
  savedAt: 12_000,
};

describe('loading a game saved by an older version', () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('keeps the game and the settings, and starts with no best times', () => {
    store.set(KEY, JSON.stringify(oldSave));
    const s = loadState();
    expect(s.settings).toEqual({ showValidationWhilePlaying: true });
    expect(s.bests).toEqual({});
    expect(s.games[puzzle.id].placements).toEqual(oldSave.games[puzzle.id].placements);
  });

  it('keeps best times that were saved', () => {
    store.set(KEY, JSON.stringify({ ...oldSave, bests: { [puzzle.id]: { ms: 4200, solves: 3 } } }));
    expect(loadState().bests).toEqual({ [puzzle.id]: { ms: 4200, solves: 3 } });
  });

  it('still reopens on the home screen with the timer frozen at the last save', () => {
    store.set(KEY, JSON.stringify(oldSave));
    const s = loadState();
    expect(s.screen).toBe('home');
    expect(s.games[puzzle.id].timer).toEqual({ elapsedMs: 5000 + 2000, startedAt: null });
  });

  it('starts fresh when nothing is saved or the save is unreadable', () => {
    expect(loadState().games).toEqual({});
    store.set(KEY, '{ not json');
    expect(loadState().active).toBeNull();
  });
});
