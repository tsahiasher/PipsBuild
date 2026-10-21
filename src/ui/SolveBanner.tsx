import { COUNT_RULE, describeSolvability, type Solvability } from './solveMessage';

const ICON = { ok: '✓', bad: '✕', warn: '?', busy: '…' } as const;

/** Always-visible strip: green when the puzzle can be solved, red when it cannot. */
export function SolveBanner({ state }: { state: Solvability }) {
  const { tone, headline, detail } = describeSolvability(state);
  return (
    <div
      className={`solve-banner ${tone}${state.pending && state.result ? ' pending' : ''}`}
      role="status"
      aria-busy={state.pending}
      title={COUNT_RULE}
    >
      <span className="solve-icon" aria-hidden>
        {ICON[tone]}
      </span>
      <div className="solve-text">
        <strong>{headline}</strong>
        {detail && <span className="solve-detail"> {detail}</span>}
      </div>
    </div>
  );
}
