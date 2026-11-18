import '@fontsource/cinzel/600.css';
import '@fontsource/cinzel/700.css';
import '@fontsource/im-fell-english/400.css';
import '@fontsource/im-fell-english/400-italic.css';
import { useId, useState, type CSSProperties, type ReactNode } from 'react';

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

// Elder Futhark runes as strokes in a 10×16 box: drawn, not typed, so they show on
// every phone (many have no runic font).
const RUNES: Record<string, number[][]> = {
  f: [[3, 0, 3, 16], [3, 4, 8, 1], [3, 8, 8, 5]],
  u: [[2, 16, 2, 0, 8, 4, 8, 16]],
  th: [[3, 0, 3, 16], [3, 4, 8, 8, 3, 12]],
  a: [[3, 0, 3, 16], [3, 2, 8, 6], [3, 7, 8, 11]],
  r: [[3, 16, 3, 0, 8, 4, 3, 8, 8, 16]],
  k: [[8, 2, 3, 8, 8, 14]],
  g: [[2, 2, 8, 14], [8, 2, 2, 14]],
  h: [[2, 0, 2, 16], [8, 0, 8, 16], [2, 5, 8, 11]],
  n: [[5, 0, 5, 16], [2, 5, 8, 10]],
  i: [[5, 0, 5, 16]],
  j: [[5, 1, 2, 5, 5, 9], [5, 7, 8, 11, 5, 15]],
  p: [[2, 0, 2, 16], [2, 0, 8, 4], [2, 16, 8, 12]],
  z: [[5, 16, 5, 0], [5, 6, 1, 1], [5, 6, 9, 1]],
  s: [[7, 0, 2, 6, 8, 10, 3, 16]],
  t: [[5, 0, 5, 16], [1, 5, 5, 0, 9, 5]],
  b: [[2, 0, 2, 16], [2, 0, 8, 4, 2, 8, 8, 12, 2, 16]],
  e: [[1, 16, 1, 0, 5, 6, 9, 0, 9, 16]],
  m: [[1, 16, 1, 0, 9, 8], [9, 16, 9, 0, 1, 8]],
  l: [[3, 0, 3, 16], [3, 0, 8, 5]],
  ng: [[5, 2, 9, 8, 5, 14, 1, 8, 5, 2]],
  d: [[1, 0, 1, 16, 9, 0, 9, 16, 1, 0]],
  o: [[1, 16, 8, 6, 5, 1, 2, 6, 9, 16]],
};
/** "LORE" in the middle, old words of luck and journeys around it. */
const RUNE_LINE = ['r', 'a', 'i', 'd', 'o', '·', 'f', 'e', 'h', 'u', '·', 'l', 'o', 'r', 'e', '·', 'j', 'e', 'r', 'a', '·', 's', 'o', 'w', 'i', 'l', 'o'];
const glyph = (c: string) => RUNES[c] ?? (c === 'w' ? [[3, 0, 3, 16], [3, 0, 8, 4, 3, 8]] : null);

/** A carved line of runes that glows like embers; brighter while the stones speak. */
export function RuneRow({ active = false, className = '' }: { active?: boolean; className?: string }) {
  const step = 15;
  return (
    <svg
      viewBox={`0 0 ${RUNE_LINE.length * step} 18`}
      className={`runes${active ? ' active' : ''} ${className}`}
      aria-hidden
      preserveAspectRatio="xMidYMid meet"
    >
      {RUNE_LINE.map((c, i) => {
        const x = i * step + 2.5;
        if (c === '·') return <circle key={i} cx={x + 5} cy={9} r={1.2} className="rune-dot" />;
        return (glyph(c) ?? []).map((line, j) => (
          <polyline
            key={`${i}-${j}`}
            points={line.map((v, k) => (k % 2 === 0 ? v + x : v + 1)).join(' ')}
            className="rune"
            style={{ animationDelay: `${(i % 9) * 0.12}s` }}
          />
        ));
      })}
    </svg>
  );
}

/** One rune, drawn (not typed) so it shows on every phone. */
export function RuneGlyph({ c, className = '' }: { c: string; className?: string }) {
  return (
    <svg viewBox="-1 -1 12 18" className={`rune-glyph ${className}`} aria-hidden>
      {(glyph(c) ?? []).map((line, j) => (
        <polyline key={j} points={line.join(' ')} />
      ))}
    </svg>
  );
}

// Sparks rising from the fire: [sideways drift in px, delay in s].
const EMBERS: [x: number, delay: number][] = [
  [-22, 0],
  [14, 1.5],
  [-6, 2.7],
  [26, 0.8],
  [-16, 2.1],
  [4, 0.3],
  [20, 1.8],
  [-30, 2.9],
  [9, 1.1],
  [-12, 2.4],
];

/** Embers drifting up from the stone circle's fire: a few at rest, all of them while the stones speak. */
export function Embers({ active = false }: { active?: boolean }) {
  return (
    <span className={`embers${active ? ' active' : ''}`} aria-hidden>
      {EMBERS.map(([x, d], i) => (
        <i key={i} style={{ '--x': `${x}px`, '--d': `${d}s` } as CSSProperties} />
      ))}
    </span>
  );
}

const COUNTER_RUNES = ['f', 'r', 'l'];

/** One rune tablet per reading today: lit while it's still yours, cracked once it's spent. */
export function RuneCounter({ left, total }: { left: number; total: number }) {
  return (
    <div className="rune-counter" aria-hidden>
      {Array.from({ length: total }, (_, i) => {
        const lines = (glyph(COUNTER_RUNES[i % COUNTER_RUNES.length]!) ?? []).map((l) => l.join(' '));
        return (
          <span key={i} className={`rune-tablet ${i >= total - left ? 'lit' : 'spent'}`}>
            <svg viewBox="0 0 24 32">
              <g transform="translate(7 8)">
                {lines.map((p, j) => (
                  <polyline key={`d${j}`} points={p} className="rt-rune rt-dim" />
                ))}
                {lines.map((p, j) => (
                  <polyline key={`l${j}`} points={p} className="rt-rune rt-lit" />
                ))}
              </g>
              <path d="M5 2 9.5 10 7.5 14 14 21 12 30M9.5 10 14.5 12" className="rt-crack" />
            </svg>
          </span>
        );
      })}
    </div>
  );
}

/** The Oracle's mark: raido (the journey) bound to laguz (the flow) in a ring. A crescent moon while the stones rest. */
export function Sigil({ moon = false }: { moon?: boolean }) {
  return (
    <svg viewBox="0 0 22 22" className="sigil" aria-hidden>
      <circle cx="11" cy="11" r="9.6" />
      {moon ? (
        <path d="M12.6 5.2A6 6 0 1 0 16.6 15A6.8 6.8 0 0 1 12.6 5.2Z" className="sigil-fill" />
      ) : (
        <path d="M10.5 17V5l4 3-4 3 4.5 6M10.5 5 6.5 9" />
      )}
    </svg>
  );
}

/** A piece of parchment with rolled ends. */
export function Scroll({ children, className = '', as: Tag = 'div' }: { children: ReactNode; className?: string; as?: 'div' | 'article' | 'section' }) {
  return <Tag className={`scroll ${className}`}>{children}</Tag>;
}

const ROLLED_KEY = 'lore.reminder.rolled';

/**
 * The friendly reminder, for the lore makers and everyone who comes after.
 * Written in LORE's own words (the owner's idea, retold without borrowing anyone's characters).
 */
export function ReminderScroll({ collapsible = true }: { collapsible?: boolean }) {
  const [rolled, setRolled] = useState(() => {
    try {
      return collapsible && localStorage.getItem(ROLLED_KEY) === '1';
    } catch {
      return false;
    }
  });
  const toggle = () => {
    const next = !rolled;
    setRolled(next);
    try {
      localStorage.setItem(ROLLED_KEY, next ? '1' : '0');
    } catch {
      // Private mode: it just won't be remembered.
    }
  };

  if (rolled) {
    return (
      <button className="scroll-rolled" onClick={toggle}>
        <span className="seal" aria-hidden /> A friendly reminder
      </button>
    );
  }
  return (
    <Scroll as="section" className="reminder-scroll">
      <p className="scroll-kicker">A friendly reminder</p>
      <h2>The one who almost stayed home</h2>
      <p>
        Once there was someone who loved their armchair, their books and their garden. When a wanderer knocked at the
        door and spoke of a grand adventure, they said <em>no</em>. Then <em>no</em> again.
      </p>
      <p>
        The wanderer only smiled: the world isn’t kept on a shelf. It waits past the garden gate.
      </p>
      <p>
        By morning the armchair was empty. They had left everything as it was and run down the road after the company,
        and they turned out to be exactly the one the company needed.
      </p>
      <div className="ink-rule" aria-hidden />
      <p className="scroll-moral">Every legend starts with someone who almost stayed home.</p>
      <span className="seal scroll-seal" aria-hidden>
        <RuneGlyph c="l" />
      </span>
      {collapsible && (
        <button className="scroll-roll-up" onClick={toggle}>
          Roll it up
        </button>
      )}
    </Scroll>
  );
}
