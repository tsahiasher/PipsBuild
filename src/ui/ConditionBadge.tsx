import { constraintLabel, describeConstraint } from '../engine/constraints';
import type { Constraint } from '../engine/types';

interface Props {
  constraint: Constraint;
  invalid: boolean;
  /** Board-unit position of the badge centre. */
  x: number;
  y: number;
  color: string;
  selected?: boolean;
}

/**
 * Condition label attached to a region corner, its text centred in the badge. When
 * `invalid`, a red dot sits on its upper-right edge; the state is also exposed to
 * assistive technology.
 */
export function ConditionBadge({ constraint, invalid, x, y, color, selected }: Props) {
  const label = constraintLabel(constraint);
  const desc = describeConstraint(constraint);
  const aria = invalid ? `Region condition ${label} is not satisfied. ${desc}.` : `${desc}.`;
  const size = label.length >= 3 ? 20 : label.length === 2 ? 24 : 29;
  // Place the baseline so the ink is centred: digits are ~0.71em tall (cap height);
  // "=" / "≠" sit on the maths axis, a little lower.
  const baseline = size * (/\d/.test(label) ? 0.355 : 0.3);
  return (
    <g className="badge" transform={`translate(${x} ${y})`} role="img" aria-label={aria} data-invalid={invalid || undefined}>
      <title>{aria}</title>
      {selected && <rect x={-35} y={-35} width={70} height={70} rx={22} fill="none" stroke="#111" strokeWidth={4} strokeDasharray="6 5" />}
      <rect x={-28} y={-28} width={56} height={56} rx={18} fill={color} stroke="#fff" strokeWidth={4} />
      <text
        x={0}
        y={baseline}
        textAnchor="middle"
        fontSize={size}
        fontWeight={800}
        fill="#fff"
        style={{ fontFamily: 'var(--font-ui)' }}
      >
        {label}
      </text>
      {invalid && <ErrorDot x={27} y={-27} />}
    </g>
  );
}

/** Small red dot marking a violated condition; sits on the badge's upper-right corner. */
export function ErrorDot({ x, y }: { x: number; y: number }) {
  return (
    <g className="error-dot" transform={`translate(${x} ${y})`} aria-hidden>
      <circle r={10} fill="#e0262f" stroke="#fff" strokeWidth={3} />
    </g>
  );
}
