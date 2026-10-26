import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { boardComponents, cellId } from '../engine/geometry';
import { checkConsistency, makeCells, normalizePuzzle } from '../engine/puzzle';
import { serializePuzzle } from '../engine/puzzleFile';
import { firstUnusedDomino, nextUniqueHalf } from '../engine/dominoes';
import { constraintLabel } from '../engine/constraints';
import type { CellId, Constraint, ConstraintType, Domino, Puzzle, Region } from '../engine/types';
import type { RecognitionMeta } from '../state/storage';
import { Board, boardViewBox, clientToBoard } from './Board';
import { DominoShape } from './Domino';
import { SolveBanner } from './SolveBanner';
import { SOLVE_FLAG } from './flags';
import { useSolvability } from './useSolvability';
import { REGION_COLORS, U, regionColor } from './theme';

type Tool = 'cells' | 'paint' | 'erase' | 'select';
type View = 'board' | 'overlay';

interface Props {
  draft: Puzzle;
  recognition: RecognitionMeta | null;
  image: string | null;
  onChange: (p: Puzzle) => void;
  onStart: (p: Puzzle, solve?: boolean) => void;
  onHome: () => void;
}

const TOOLS: { id: Tool; label: string; hint: string }[] = [
  { id: 'cells', label: 'Cells', hint: 'Tap or drag to add/remove playable cells.' },
  { id: 'paint', label: 'Paint region', hint: 'Tap or drag cells to add them to the selected region.' },
  { id: 'erase', label: 'Unassign', hint: 'Tap or drag to remove cells from their region (no condition).' },
  { id: 'select', label: 'Select', hint: 'Tap a cell to select its region.' },
];

const CONSTRAINT_TYPES: { id: ConstraintType | 'none'; label: string }[] = [
  { id: 'none', label: 'No condition' },
  { id: 'sum', label: 'Sum =' },
  { id: 'lt', label: 'Sum <' },
  { id: 'gt', label: 'Sum >' },
  { id: 'eq', label: 'All equal' },
  { id: 'neq', label: 'All different' },
];

export function EditorScreen({ draft, recognition, image, onChange, onStart, onHome }: Props) {
  const [tool, setTool] = useState<Tool>(recognition ? 'select' : 'cells');
  const [view, setView] = useState<View>('board');
  const [selected, setSelected] = useState<string | null>(null);
  const [imgOpacity, setImgOpacity] = useState(1);
  const [overlayOpacity, setOverlayOpacity] = useState(0.6);
  const [showDominoBoxes, setShowDominoBoxes] = useState(true);
  const svgRef = useRef<SVGSVGElement>(null);
  const gesture = useRef<{ mode: 'add' | 'remove'; visited: Set<CellId> } | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  const solvability = useSolvability(draft);
  const issues = useMemo(() => checkConsistency(draft), [draft]);
  const errors = issues.filter((i) => i.level === 'error');
  const components = useMemo(() => boardComponents(draft.cells).length, [draft.cells]);
  const selectedRegion = draft.regions.find((r) => r.id === selected) ?? null;
  const canOverlay = !!(image && recognition);

  // ---------- edits ----------
  const update = (fn: (p: Puzzle) => Puzzle) => onChange(fn(draftRef.current));

  const applyCell = (id: CellId, mode: 'add' | 'remove') => {
    update((p) => {
      const cells = new Set(p.cells.map((c) => c.id));
      if (tool === 'cells') {
        if (mode === 'add') cells.add(id);
        else cells.delete(id);
        return { ...p, cells: makeCells(cells), regions: p.regions.map((r) => ({ ...r, cells: r.cells.filter((c) => cells.has(c)) })) };
      }
      if (!cells.has(id)) return p;
      if (tool === 'erase' || (tool === 'paint' && mode === 'remove')) {
        return { ...p, regions: p.regions.map((r) => ({ ...r, cells: r.cells.filter((c) => c !== id) })) };
      }
      if (tool === 'paint' && selected) {
        return {
          ...p,
          regions: p.regions.map((r) =>
            r.id === selected ? (r.cells.includes(id) ? r : { ...r, cells: [...r.cells, id] }) : { ...r, cells: r.cells.filter((c) => c !== id) },
          ),
        };
      }
      return p;
    });
  };

  const cellAtPointer = (e: ReactPointerEvent): CellId | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    let x: number;
    let y: number;
    if (view === 'overlay' && recognition) {
      const rect = svg.getBoundingClientRect();
      const s = Math.min(rect.width / recognition.imageWidth, rect.height / recognition.imageHeight);
      const ix = (e.clientX - rect.left - (rect.width - recognition.imageWidth * s) / 2) / s;
      const iy = (e.clientY - rect.top - (rect.height - recognition.imageHeight * s) / 2) / s;
      x = ((ix - recognition.geometry.originX) / recognition.geometry.pitch) * U;
      y = ((iy - recognition.geometry.originY) / recognition.geometry.pitch) * U;
    } else {
      const p = clientToBoard(svg, boardViewBox(draft, true), e.clientX, e.clientY);
      x = p.x;
      y = p.y;
    }
    const r = Math.floor(y / U);
    const c = Math.floor(x / U);
    if (r < 0 || c < 0 || r >= draft.rows || c >= draft.cols) return null;
    return cellId(r, c);
  };

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    const id = cellAtPointer(e);
    if (!id) return;
    if (tool === 'select') {
      const reg = draft.regions.find((r) => r.cells.includes(id));
      setSelected(reg?.id ?? null);
      return;
    }
    if (tool === 'paint' && !selected) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const playable = draft.cells.some((c) => c.id === id);
    const inSelected = !!selectedRegion?.cells.includes(id);
    const mode: 'add' | 'remove' = tool === 'cells' ? (playable ? 'remove' : 'add') : tool === 'paint' && inSelected ? 'remove' : 'add';
    gesture.current = { mode, visited: new Set([id]) };
    applyCell(id, mode);
  };

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const g = gesture.current;
    if (!g) return;
    const id = cellAtPointer(e);
    if (!id || g.visited.has(id)) return;
    g.visited.add(id);
    applyCell(id, g.mode);
  };

  const endGesture = () => (gesture.current = null);

  const addRegion = () => {
    const used = draft.regions.map((r) => r.color);
    const color = REGION_COLORS.map((_, i) => i).sort((a, b) => used.filter((u) => u === a).length - used.filter((u) => u === b).length)[0];
    let n = draft.regions.length + 1;
    while (draft.regions.some((r) => r.id === `r${n}`)) n++;
    const region: Region = { id: `r${n}`, color, cells: [], constraint: null };
    update((p) => ({ ...p, regions: [...p.regions, region] }));
    setSelected(region.id);
    setTool('paint');
  };

  const setRegion = (id: string, patch: Partial<Region>) =>
    update((p) => ({ ...p, regions: p.regions.map((r) => (r.id === id ? { ...r, ...patch } : r)) }));

  const setConstraintType = (r: Region, type: ConstraintType | 'none') => {
    const target = r.constraint && 'target' in r.constraint ? r.constraint.target : 0;
    const c: Constraint | null =
      type === 'none' ? null : type === 'eq' || type === 'neq' ? { type } : { type, target };
    setRegion(r.id, { constraint: c });
  };

  const resize = (dRows: number, dCols: number) =>
    update((p) => {
      const rows = Math.min(16, Math.max(1, p.rows + dRows));
      const cols = Math.min(16, Math.max(1, p.cols + dCols));
      const cells = p.cells.filter((c) => c.row < rows && c.col < cols).map((c) => c.id);
      const keep = new Set(cells);
      return { ...p, rows, cols, cells: makeCells(cells), regions: p.regions.map((r) => ({ ...r, cells: r.cells.filter((c) => keep.has(c)) })) };
    });

  // Each piece may appear only once (3|1 and 1|3 are the same domino), so stepping a half
  // skips values that would duplicate another piece.
  const stepDomino = (id: string, half: 'a' | 'b', dir: 1 | -1) =>
    update((p) => {
      const v = nextUniqueHalf(p.dominoes, id, half, dir);
      if (v === null) return p;
      return { ...p, dominoes: p.dominoes.map((d) => (d.id === id ? ({ ...d, [half]: v } as Domino) : d)) };
    });

  const addDomino = () =>
    update((p) => {
      const pair = firstUnusedDomino(p.dominoes);
      if (!pair) return p;
      let n = p.dominoes.length + 1;
      while (p.dominoes.some((d) => d.id === `d${n}`)) n++;
      return { ...p, dominoes: [...p.dominoes, { id: `d${n}`, a: pair[0], b: pair[1] }] };
    });

  // ---------- render ----------
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const conf = recognition?.confidence;

  const boardProps = {
    puzzle: draft,
    fullGrid: true,
    selectedRegion: selected,
    top:
      recognition && view === 'board' ? (
        <g pointerEvents="none">
          {recognition.uncertainCells.map((id) => {
            const [r, c] = id.split(',').map(Number);
            return <rect key={id} x={c * U + 3} y={r * U + 3} width={U - 6} height={U - 6} rx={14} fill="none" stroke="#e08a00" strokeWidth={5} />;
          })}
        </g>
      ) : null,
  };

  return (
    <div className="screen editor">
      <div className="editor-head">
        <header className="topbar">
          <button className="btn ghost" onClick={onHome} aria-label="Back">
            ← Back
          </button>
          <h1 className="h3 title">{recognition ? 'Check the puzzle' : 'Build the puzzle'}</h1>
          <div className="row gap-sm">
            {SOLVE_FLAG && (
              <button className="btn" disabled={errors.length > 0} onClick={() => onStart(draft, true)}>
                Solve
              </button>
            )}
            <button className="btn primary" disabled={errors.length > 0} onClick={() => onStart(draft)}>
              Start puzzle
            </button>
          </div>
        </header>
        <SolveBanner state={solvability} />
      </div>

      <div className="editor-body">
        <section className="editor-canvas card">
          {canOverlay && (
            <div className="segmented" role="tablist" aria-label="View">
              <button role="tab" aria-selected={view === 'board'} className={view === 'board' ? 'on' : ''} onClick={() => setView('board')}>
                Board
              </button>
              <button role="tab" aria-selected={view === 'overlay'} className={view === 'overlay' ? 'on' : ''} onClick={() => setView('overlay')}>
                Compare
              </button>
            </div>
          )}
          <div
            className="canvas-wrap"
            style={{
              // Size the canvas to the content's shape so phones don't show empty bands.
              aspectRatio:
                view === 'overlay' && recognition
                  ? `${recognition.imageWidth} / ${recognition.imageHeight}`
                  : `${boardViewBox(draft, true).w} / ${boardViewBox(draft, true).h}`,
            }}
          >
            {view === 'overlay' && recognition && image ? (
              <svg
                ref={svgRef}
                className="editor-svg"
                viewBox={`0 0 ${recognition.imageWidth} ${recognition.imageHeight}`}
                preserveAspectRatio="xMidYMid meet"
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={endGesture}
                onPointerCancel={endGesture}
              >
                <image href={image} width={recognition.imageWidth} height={recognition.imageHeight} opacity={imgOpacity} />
                <g
                  opacity={overlayOpacity}
                  transform={`translate(${recognition.geometry.originX} ${recognition.geometry.originY}) scale(${recognition.geometry.pitch / U})`}
                >
                  <Board {...boardProps} asGroup />
                </g>
                {showDominoBoxes &&
                  recognition.dominoes.map((d, i) => (
                    <g key={i}>
                      <rect x={d.x} y={d.y} width={d.w} height={d.h} fill="none" stroke="#1b7cff" strokeWidth={3} rx={8} />
                      <text x={d.x + d.w / 2} y={d.y - 6} textAnchor="middle" fontSize={Math.max(14, d.h * 0.3)} fontWeight={700} fill="#1b7cff">
                        {draft.dominoes[i] ? `${draft.dominoes[i].a}|${draft.dominoes[i].b}` : `${d.a}|${d.b}`}
                      </text>
                    </g>
                  ))}
              </svg>
            ) : (
              <Board
                ref={svgRef}
                {...boardProps}
                className="editor-svg"
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={endGesture}
                onPointerCancel={endGesture}
              />
            )}
          </div>
          {view === 'overlay' && (
            <div className="sliders">
              <label className="slider">
                <span>Original</span>
                <input type="range" min={0} max={1} step={0.05} value={imgOpacity} onChange={(e) => setImgOpacity(Number(e.target.value))} />
                <span className="num">{pct(imgOpacity)}</span>
              </label>
              <label className="slider">
                <span>Overlay</span>
                <input type="range" min={0} max={1} step={0.05} value={overlayOpacity} onChange={(e) => setOverlayOpacity(Number(e.target.value))} />
                <span className="num">{pct(overlayOpacity)}</span>
              </label>
              <label className="check small">
                <input type="checkbox" checked={showDominoBoxes} onChange={(e) => setShowDominoBoxes(e.target.checked)} />
                Show detected dominoes
              </label>
            </div>
          )}
          <div className="tools" role="toolbar" aria-label="Editing tools">
            {TOOLS.map((t) => (
              <button key={t.id} className={`chip ${tool === t.id ? 'on' : ''}`} aria-pressed={tool === t.id} onClick={() => setTool(t.id)} title={t.hint}>
                {t.label}
              </button>
            ))}
          </div>
          <p className="muted small hint">
            {TOOLS.find((t) => t.id === tool)?.hint}
            {tool === 'paint' && !selectedRegion && ' Select or create a region first.'}
          </p>
        </section>

        <aside className="editor-side">
          <section className="card">
            <h2 className="h3">Status</h2>
            <ul className="stats">
              <li>
                <b>{draft.cells.length}</b> cells
              </li>
              <li>
                <b>{draft.dominoes.length}</b> dominoes
              </li>
              <li>
                <b>{draft.regions.length}</b> regions
              </li>
              <li>
                <b>{components}</b> board piece{components === 1 ? '' : 's'}
              </li>
            </ul>
            {conf && (
              <div className="confidence">
                {(['cells', 'regions', 'conditions', 'dominoes'] as const).map((k) => (
                  <span key={k} className={`conf ${conf[k] >= 0.6 ? 'good' : conf[k] >= 0.35 ? 'mid' : 'low'}`} title="Recognition confidence">
                    {k} {pct(conf[k])}
                  </span>
                ))}
              </div>
            )}
            {errors.length === 0 ? (
              <p className="ok small">✓ Ready to play: {draft.cells.length} cells, {draft.dominoes.length} dominoes.</p>
            ) : (
              <ul className="issues">
                {errors.map((i, k) => (
                  <li key={k} className="alert error small">
                    {i.message}
                  </li>
                ))}
              </ul>
            )}
            {recognition?.warnings.map((w, k) => (
              <p key={k} className="alert warn small">
                {w}
              </p>
            ))}
            <div className="row gap-sm wrap grid-size">
              <span className="small muted">
                Grid {draft.rows}×{draft.cols}
              </span>
              <button className="btn small" onClick={() => resize(1, 0)}>+ row</button>
              <button className="btn small" onClick={() => resize(-1, 0)}>− row</button>
              <button className="btn small" onClick={() => resize(0, 1)}>+ col</button>
              <button className="btn small" onClick={() => resize(0, -1)}>− col</button>
            </div>
            <div className="row gap-sm wrap grid-size">
              <button className="btn small" onClick={() => downloadPuzzle(draft)}>
                Save puzzle to file
              </button>
            </div>
          </section>

          <section className="card">
            <div className="row between">
              <h2 className="h3">Regions &amp; conditions</h2>
              <button className="btn small" onClick={addRegion}>
                + New region
              </button>
            </div>
            {draft.regions.length === 0 && <p className="muted small">No regions yet. Cells without a region have no condition.</p>}
            <ul className="region-list">
              {draft.regions.map((r) => {
                const col = regionColor(r.color);
                const type = r.constraint?.type ?? 'none';
                return (
                  <li key={r.id} className={selected === r.id ? 'sel' : ''} onClick={() => setSelected(r.id)}>
                    <button
                      className="swatch"
                      style={{ background: col.fill, borderColor: col.accent }}
                      aria-label={`Change colour (${col.name})`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setRegion(r.id, { color: (r.color + 1) % REGION_COLORS.length });
                      }}
                    />
                    <span className="badge-preview" style={{ background: col.accent }}>
                      {constraintLabel(r.constraint) || '–'}
                    </span>
                    <select
                      value={type}
                      aria-label="Condition type"
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setConstraintType(r, e.target.value as ConstraintType | 'none')}
                    >
                      {CONSTRAINT_TYPES.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                    {r.constraint && 'target' in r.constraint && (
                      <input
                        type="number"
                        min={0}
                        max={99}
                        aria-label="Target"
                        value={r.constraint.target}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => setRegion(r.id, { constraint: { ...(r.constraint as { type: 'sum' }), target: Math.max(0, Math.min(99, Math.round(Number(e.target.value) || 0))) } })}
                      />
                    )}
                    <span className="muted small cells-count">{r.cells.length}c</span>
                    <button
                      className="btn ghost small icon-btn"
                      aria-label="Delete region"
                      onClick={(e) => {
                        e.stopPropagation();
                        update((p) => ({ ...p, regions: p.regions.filter((x) => x.id !== r.id) }));
                        if (selected === r.id) setSelected(null);
                      }}
                    >
                      ✕
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="card">
            <div className="row between">
              <h2 className="h3">Dominoes</h2>
              <button className="btn small" onClick={addDomino} disabled={draft.dominoes.length >= 28}>
                + Add
              </button>
            </div>
            <p className="muted small">Tap a half to add a pip (wraps 6 → 0). Right-click or long-press subtracts. Each domino can be used only once.</p>
            <ul className="domino-edit">
              {draft.dominoes.map((d) => (
                <li key={d.id}>
                  <svg viewBox="0 0 200 100" className="domino-edit-svg">
                    <DominoShape a={d.a} b={d.b} />
                    {(['a', 'b'] as const).map((half, i) => (
                      <rect
                        key={half}
                        x={i * 100}
                        y={0}
                        width={100}
                        height={100}
                        fill="transparent"
                        role="button"
                        tabIndex={0}
                        aria-label={`Half ${i + 1}: ${d[half]} pips. Activate to increase.`}
                        style={{ cursor: 'pointer' }}
                        onClick={() => stepDomino(d.id, half, 1)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          stepDomino(d.id, half, -1);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowUp') {
                            e.preventDefault();
                            stepDomino(d.id, half, 1);
                          } else if (e.key === 'ArrowDown') {
                            e.preventDefault();
                            stepDomino(d.id, half, -1);
                          }
                        }}
                      />
                    ))}
                  </svg>
                  <button
                    className="btn ghost small icon-btn"
                    aria-label={`Remove domino ${d.a}-${d.b}`}
                    onClick={() => update((p) => ({ ...p, dominoes: p.dominoes.filter((x) => x.id !== d.id) }))}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}

/** Saves the puzzle as a JSON file the user can import again from the home screen. */
function downloadPuzzle(draft: Puzzle) {
  const puzzle = normalizePuzzle(draft);
  const blob = new Blob([serializePuzzle(puzzle)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `pips-build-${puzzle.cells.length}cells-${puzzle.id}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
