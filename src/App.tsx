import { useCallback, useEffect, useRef, useState } from 'react';
import { gameReducer, newGame, pauseTimer, type GameAction } from './engine/game';
import { makeCells, normalizePuzzle } from './engine/puzzle';
import { parsePuzzleFile } from './engine/puzzleFile';
import { cellId } from './engine/geometry';
import type { Puzzle } from './engine/types';
import { loadImage, loadState, saveImage, saveState, type StoredState } from './state/storage';
import { loadImageFile, recognizeInWorker } from './vision/client';
import { HomeScreen } from './ui/HomeScreen';
import { EditorScreen } from './ui/EditorScreen';
import { PlayScreen } from './ui/PlayScreen';

export interface ImportProgress {
  stage: string;
  fraction: number;
}

export function App() {
  const [state, setState] = useState<StoredState>(loadState);
  const [image, setImage] = useState<string | null>(loadImage);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const latest = useRef(state);
  latest.current = state;

  useEffect(() => {
    const t = setTimeout(() => saveState(state), 120);
    return () => clearTimeout(t);
  }, [state]);

  useEffect(() => {
    // Persist immediately when the page is hidden or closed.
    const flush = () => {
      const s = latest.current;
      const games = Object.fromEntries(
        Object.entries(s.games).map(([id, g]) => [id, { ...g, timer: pauseTimer(g.timer, Date.now()) }]),
      );
      saveState({ ...s, games });
    };
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, []);

  const goHome = useCallback(() => setState((s) => ({ ...s, screen: 'home' })), []);

  const importFile = useCallback(async (file: Blob) => {
    setImportError(null);
    setProgress({ stage: 'Analyzing image…', fraction: 0 });
    try {
      const { imageData, dataUrl } = await loadImageFile(file);
      const result = await recognizeInWorker(imageData, (stage, fraction) => setProgress({ stage, fraction }));
      const { puzzle, ...meta } = result;
      setImage(dataUrl);
      saveImage(dataUrl);
      setState((s) => ({ ...s, draft: puzzle, recognition: meta, screen: 'editor' }));
    } catch (err) {
      setImportError(
        `${err instanceof Error ? err.message : 'Image analysis failed.'} You can still build the puzzle manually.`,
      );
    } finally {
      setProgress(null);
    }
  }, []);

  const buildManually = useCallback((rows: number, cols: number) => {
    const ids: string[] = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) ids.push(cellId(r, c));
    const draft: Puzzle = { id: '', rows, cols, cells: makeCells(ids), regions: [], dominoes: [] };
    setImage(null);
    saveImage(null);
    setState((s) => ({ ...s, draft, recognition: null, screen: 'editor' }));
  }, []);

  const importPuzzleFile = useCallback(async (file: File) => {
    setImportError(null);
    try {
      const draft = parsePuzzleFile(await file.text());
      setImage(null);
      saveImage(null);
      setState((s) => ({ ...s, draft, recognition: null, screen: 'editor' }));
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'This puzzle file could not be read.');
    }
  }, []);

  const startPuzzle = useCallback((draft: Puzzle) => {
    const puzzle = normalizePuzzle(draft);
    setState((s) => ({
      ...s,
      draft: puzzle,
      active: puzzle,
      games: s.games[puzzle.id] ? s.games : { ...s.games, [puzzle.id]: newGame(puzzle) },
      screen: 'play',
    }));
  }, []);

  const dispatchGame = useCallback((action: GameAction) => {
    setState((s) => {
      if (!s.active) return s;
      const game = s.games[s.active.id] ?? newGame(s.active);
      const next = gameReducer(s.active, game, action);
      if (next === game) return s;
      // Re-insert so the most recently played game is last (used for pruning).
      const { [s.active.id]: _old, ...rest } = s.games;
      return { ...s, games: { ...rest, [s.active.id]: next } };
    });
  }, []);

  const playAgain = useCallback(() => {
    setState((s) => (s.active ? { ...s, games: { ...s.games, [s.active.id]: newGame(s.active) } } : s));
  }, []);

  if (state.screen === 'editor' && state.draft) {
    return (
      <EditorScreen
        draft={state.draft}
        recognition={state.recognition}
        image={image}
        onChange={(draft) => setState((s) => ({ ...s, draft }))}
        onStart={startPuzzle}
        onHome={goHome}
      />
    );
  }

  if (state.screen === 'play' && state.active) {
    const game = state.games[state.active.id] ?? newGame(state.active);
    return (
      <PlayScreen
        puzzle={state.active}
        game={game}
        dispatch={dispatchGame}
        settings={state.settings}
        onSettings={(settings) => setState((s) => ({ ...s, settings }))}
        onBack={() => setState((s) => ({ ...s, screen: s.draft ? 'editor' : 'home' }))}
        onPlayAgain={playAgain}
        onImportAnother={goHome}
      />
    );
  }

  return (
    <HomeScreen
      progress={progress}
      error={importError}
      canResume={!!state.active}
      resumeSolved={!!(state.active && state.games[state.active.id]?.solved)}
      canEdit={!!state.draft}
      onFile={importFile}
      onManual={buildManually}
      onImportFile={importPuzzleFile}
      onResume={() => setState((s) => ({ ...s, screen: 'play' }))}
      onEdit={() => setState((s) => ({ ...s, screen: 'editor' }))}
    />
  );
}
