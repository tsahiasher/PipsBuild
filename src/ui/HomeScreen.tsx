import { useEffect, useRef, useState } from 'react';
import type { ImportProgress } from '../App';
import { DominoShape } from './Domino';

/** ?debug=1 shows buttons that load the sample screenshots (served from samples/, see vite.config.ts). */
const DEBUG = new URLSearchParams(window.location.search).get('debug') === '1';
const sampleUrl = (path: string) => new URL(`samples/${path}`, document.baseURI).href;

const STAGES = [
  'Analyzing image…',
  'Detecting dominoes…',
  'Detecting board…',
  'Finding regions…',
  'Recognizing conditions…',
  'Building puzzle…',
];

interface Props {
  progress: ImportProgress | null;
  error: string | null;
  canResume: boolean;
  resumeSolved: boolean;
  canEdit: boolean;
  onFile: (file: Blob) => void;
  onManual: (rows: number, cols: number) => void;
  onImportFile: (file: File) => void;
  onResume: () => void;
  onEdit: () => void;
}

export function HomeScreen({ progress, error, canResume, resumeSolved, canEdit, onFile, onManual, onImportFile, onResume, onEdit }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const puzzleInput = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [manual, setManual] = useState(false);
  const [rows, setRows] = useState(6);
  const [cols, setCols] = useState(6);
  const [samples, setSamples] = useState<string[]>([]);
  const [debugError, setDebugError] = useState<string | null>(null);

  useEffect(() => {
    if (!DEBUG) return;
    fetch(sampleUrl('index.json'))
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((names: string[]) => setSamples(names))
      .catch(() => setDebugError('Could not list the samples.'));
  }, []);

  const loadSample = async (name: string) => {
    setDebugError(null);
    try {
      const res = await fetch(sampleUrl(`${name}.jpg`));
      if (!res.ok) throw new Error(`${res.status}`);
      onFile(await res.blob());
    } catch (e) {
      setDebugError(`Could not load ${name}: ${e instanceof Error ? e.message : e}`);
    }
  };

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'));
      const file = item?.getAsFile();
      if (file) {
        e.preventDefault();
        onFile(file);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [onFile]);

  if (progress) {
    const current = STAGES.indexOf(progress.stage);
    return (
      <main className="screen center-screen" aria-busy="true">
        <div className="card progress-card">
          <h1 className="h2">Reading your screenshot</h1>
          <p className="muted small">Everything happens on this device. Nothing is uploaded.</p>
          <div className="progress-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress.fraction * 100)}>
            <div style={{ width: `${Math.max(4, progress.fraction * 100)}%` }} />
          </div>
          <ol className="stage-list" aria-live="polite">
            {STAGES.map((s, i) => (
              <li key={s} className={i < current ? 'done' : i === current ? 'active' : ''}>
                <span className="stage-dot" aria-hidden />
                {s}
              </li>
            ))}
          </ol>
        </div>
      </main>
    );
  }

  return (
    <main
      className={`screen home ${over ? 'drag-over' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const file = [...e.dataTransfer.files].find((f) => f.type.startsWith('image/'));
        if (file) onFile(file);
      }}
    >
      <header className="home-head">
        <svg viewBox="0 0 200 100" width="64" height="32" aria-hidden>
          <DominoShape a={6} b={3} />
        </svg>
        <div>
          <h1 className="brand">Pips Build</h1>
          <p className="muted">Turn a domino-logic puzzle screenshot into a playable board.</p>
        </div>
      </header>

      {canResume && (
        <section className="card resume-card">
          <div>
            <h2 className="h3">{resumeSolved ? 'Your last puzzle is solved' : 'Puzzle in progress'}</h2>
            <p className="muted small">Pick up where you left off, or start a new one below.</p>
          </div>
          <div className="row gap">
            <button className="btn primary" onClick={onResume}>
              {resumeSolved ? 'View puzzle' : 'Resume puzzle'}
            </button>
            {canEdit && (
              <button className="btn" onClick={onEdit}>
                Edit
              </button>
            )}
          </div>
        </section>
      )}

      <section
        className="card dropzone"
        role="button"
        tabIndex={0}
        onClick={() => input.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            input.current?.click();
          }
        }}
        aria-label="Choose a puzzle screenshot"
      >
        <div className="drop-icon" aria-hidden>
          <svg viewBox="0 0 48 48" width="44" height="44">
            <rect x="6" y="9" width="36" height="30" rx="6" fill="none" stroke="currentColor" strokeWidth="3" />
            <circle cx="17" cy="20" r="4" fill="currentColor" />
            <path d="M9 35l11-11 7 7 5-5 9 9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" />
          </svg>
        </div>
        <p className="drop-text">Drop screenshot here, or click to browse</p>
        <input
          ref={input}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) onFile(f);
          }}
        />
      </section>

      {error && (
        <p className="alert error" role="alert">
          {error}
        </p>
      )}

      <section className="card manual-card">
        {!manual ? (
          <div className="row gap wrap center">
            <button className="btn" onClick={() => setManual(true)}>
              Build manually
            </button>
            <button className="btn" onClick={() => puzzleInput.current?.click()}>
              Import puzzle file
            </button>
            <input
              ref={puzzleInput}
              type="file"
              accept=".json,application/json"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) onImportFile(f);
              }}
            />
          </div>
        ) : (
          <form
            className="row wrap gap align-end"
            onSubmit={(e) => {
              e.preventDefault();
              onManual(rows, cols);
            }}
          >
            <label className="field">
              Rows
              <input type="number" min={1} max={14} value={rows} onChange={(e) => setRows(clampInt(e.target.value, 1, 14))} />
            </label>
            <label className="field">
              Columns
              <input type="number" min={1} max={14} value={cols} onChange={(e) => setCols(clampInt(e.target.value, 1, 14))} />
            </label>
            <button className="btn primary" type="submit">
              Create grid
            </button>
            <button className="btn ghost" type="button" onClick={() => setManual(false)}>
              Cancel
            </button>
          </form>
        )}
      </section>

      {DEBUG && (
        <section className="card debug-card" aria-label="Debug: sample screenshots">
          <h2 className="h3">Debug: load a sample</h2>
          <div className="row gap-sm wrap">
            {samples.map((name) => (
              <button key={name} className="btn small" onClick={() => loadSample(name)}>
                {name}
              </button>
            ))}
            {samples.length === 0 && !debugError && <span className="muted small">No samples found in samples/.</span>}
          </div>
          {debugError && (
            <p className="alert error small" role="alert">
              {debugError}
            </p>
          )}
        </section>
      )}
    </main>
  );
}

function clampInt(v: string, lo: number, hi: number) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo;
}
