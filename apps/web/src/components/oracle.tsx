import { useId } from 'react';

const STONES = 11;

/** A small circle of standing stones with a fire in the middle. Pulses while reading. */
export function StoneCircle({ active = false, className = '' }: { active?: boolean; className?: string }) {
  const glowId = useId();
  const cx = 120;
  const cy = 80;
  const rx = 92;
  const ry = 24;
  const stones = Array.from({ length: STONES }, (_, i) => {
    const a = (i / STONES) * Math.PI * 2 + 0.35;
    const depth = (Math.sin(a) + 1) / 2; // 0 = far side, 1 = near side
    const x = cx + Math.cos(a) * rx;
    const y = cy + Math.sin(a) * ry;
    const h = 20 + depth * 22 + ((i * 7) % 5) * 1.6;
    const w = 8 + depth * 8;
    const lean = ((i * 5) % 3) - 1;
    const d = `M${x - w / 2},${y} L${x - w / 2 + 1 + lean},${y - h + 4} Q${x + lean},${y - h - 2} ${x + w / 2 - 1 + lean},${y - h + 3} L${x + w / 2},${y} Z`;
    return { i, d, depth };
  }).sort((a, b) => a.depth - b.depth);
  const far = stones.filter((s) => s.depth < 0.5);
  const near = stones.filter((s) => s.depth >= 0.5);

  return (
    <svg viewBox="0 0 240 118" className={`stones${active ? ' active' : ''} ${className}`} role="img" aria-label="A circle of standing stones">
      <defs>
        <radialGradient id={glowId}>
          <stop offset="0" stopColor="#ffb36b" stopOpacity="1" />
          <stop offset="0.35" stopColor="#ff6a3d" stopOpacity="0.7" />
          <stop offset="1" stopColor="#ff6a3d" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx={cx} cy={cy + 2} rx={rx + 16} ry={ry + 9} className="stones-ground" />
      {far.map((s) => (
        <path key={s.i} d={s.d} className="stone" style={{ opacity: 0.6 + s.depth * 0.4 }} />
      ))}
      <ellipse cx={cx} cy={cy - 10} rx="54" ry="38" fill={`url(#${glowId})`} className="stones-glow" />
      <circle cx={cx} cy={cy - 2} r="3.2" className="stones-ember" />
      {near.map((s) => (
        <path key={s.i} d={s.d} className="stone" />
      ))}
    </svg>
  );
}
