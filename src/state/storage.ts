import type { GameState } from '../engine/game';
import type { Puzzle } from '../engine/types';
import type { RecognitionResult } from '../vision/recognize';

export type RecognitionMeta = Omit<RecognitionResult, 'puzzle'>;

export interface Settings {
  showValidationWhilePlaying: boolean;
}

export interface StoredState {
  /** Puzzle being verified / edited. */
  draft: Puzzle | null;
  recognition: RecognitionMeta | null;
  /** Puzzle currently being played. */
  active: Puzzle | null;
  /** Games keyed by puzzle id, so leaving and re-entering a puzzle keeps its timer. */
  games: Record<string, GameState>;
  settings: Settings;
  screen: 'home' | 'editor' | 'play';
  savedAt: number;
}

const KEY = 'pips-studio/state/v1';
const IMAGE_KEY = 'pips-studio/image/v1';
const MAX_GAMES = 8;

export const defaultState = (): StoredState => ({
  draft: null,
  recognition: null,
  active: null,
  games: {},
  settings: { showValidationWhilePlaying: false },
  screen: 'home',
  savedAt: Date.now(),
});

export function loadState(): StoredState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultState();
    const s = { ...defaultState(), ...(JSON.parse(raw) as StoredState) };
    // After a reload, offer "Resume puzzle" / "New puzzle" instead of jumping into play.
    if (s.screen === 'play') s.screen = 'home';
    // Time while the browser was closed is not counted: freeze running timers at the last save.
    for (const g of Object.values(s.games)) {
      if (g.timer.startedAt !== null) {
        g.timer = { elapsedMs: g.timer.elapsedMs + Math.max(0, s.savedAt - g.timer.startedAt), startedAt: null };
      }
    }
    return s;
  } catch {
    return defaultState();
  }
}

export function saveState(s: StoredState) {
  try {
    // Keep only the most recently touched games.
    const ids = Object.keys(s.games);
    let games = s.games;
    if (ids.length > MAX_GAMES) {
      const keep = new Set([s.active?.id, ...ids.slice(-MAX_GAMES + 1)]);
      games = Object.fromEntries(Object.entries(s.games).filter(([id]) => keep.has(id)));
    }
    localStorage.setItem(KEY, JSON.stringify({ ...s, games, savedAt: Date.now() }));
  } catch {
    /* storage full or unavailable: the app keeps working in memory */
  }
}

export function loadImage(): string | null {
  try {
    return localStorage.getItem(IMAGE_KEY);
  } catch {
    return null;
  }
}

export function saveImage(dataUrl: string | null) {
  try {
    if (dataUrl) localStorage.setItem(IMAGE_KEY, dataUrl);
    else localStorage.removeItem(IMAGE_KEY);
  } catch {
    // The screenshot is optional; skip it if it does not fit.
    try {
      localStorage.removeItem(IMAGE_KEY);
    } catch {
      /* ignore */
    }
  }
}
