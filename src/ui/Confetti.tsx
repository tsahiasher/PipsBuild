import { useMemo } from 'react';

const COLORS = ['#c02c68', '#11807b', '#c45f16', '#7446a6', '#587a1b', '#2468b4'];

/** A short burst of falling paper pieces for a solved puzzle. Pure CSS animation; hidden for reduced motion. */
export function Confetti() {
  const pieces = useMemo(
    () =>
      Array.from({ length: 56 }, (_, i) => ({
        left: Math.random() * 100,
        delay: Math.random() * 0.6,
        duration: 1.9 + Math.random() * 1.5,
        size: 7 + Math.random() * 7,
        drift: (Math.random() - 0.5) * 220,
        color: COLORS[i % COLORS.length],
      })),
    [],
  );
  return (
    <div className="confetti" aria-hidden>
      {pieces.map((p, i) => (
        <span
          key={i}
          style={{
            left: `${p.left}%`,
            width: p.size,
            height: p.size * 0.5,
            background: p.color,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
            ['--drift' as string]: `${p.drift}px`,
          }}
        />
      ))}
    </div>
  );
}
