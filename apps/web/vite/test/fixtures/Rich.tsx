// @ts-nocheck
// Render fixture for the live-text transform: compiled twice (normally, and as `?nocopy`) and the two
// renders must match exactly with no overrides.
import { Children, type ReactNode } from 'react';

function A({ to, children }: { to: string; children: ReactNode }) {
  return <a href={to}>{children}</a>;
}

/** Counts its children: a message must not change what Children sees. */
function Count({ children }: { children: ReactNode }) {
  return <span data-count={Children.count(children)}>{Children.map(children, (c) => c)}</span>;
}

export function Rich({ busy = false, who = 'Ada', n = 3 }: { busy?: boolean; who?: string; n?: number }) {
  return (
    <div>
      <p>
        Once there was one who thought he wanted to stay at home with his books and his <em>garden</em>. But when a
        grey wizard came knocking, he said <em>“no…”</em> and then <em>“NO.”</em>
      </p>
      <p>
        Read the <A to="/terms">Terms</A> before you start, {who}.
      </p>
      <label>
        Your name <input defaultValue="x" /> please
      </label>
      <select defaultValue="">
        <option value="">No crew</option>
        <option value="a">{n} days</option>
      </select>
      <Count>
        Hello <b className="x">you</b> there
      </Count>
      <button>{busy ? 'Sending…' : 'Send report'}</button>
      <p title="A title" aria-label={`For ${who}`}>
        Help &amp; contact&nbsp;
      </p>
      <p>
        {n} people ·{' '}
        <br />
        second line
      </p>
      <ul>
        {['Life', 'Of'].map((w, i) => (
          <li key={i}>{w}</li>
        ))}
      </ul>
    </div>
  );
}

export const Arrow = ({ who = 'Ada' }: { who?: string }) => <p className="arrow">Hi {who}, welcome back</p>;

/** A confirm() sink with a name in it: one string message, the name a placeholder. */
export function askLeave(crew: { name: string }) {
  return confirm(`Leave ${crew.name}? You can come back if they invite you.`);
}
