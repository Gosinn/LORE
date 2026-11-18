// Live text editor: changing one text (LIVE_TEXT_SPEC 10.4). The screen behind updates as the owner types
// (his device only); Keep leaves it as an unpublished change, Cancel puts back what was there.
import { CornerDownLeft, History, Italic, TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CopyCatalog } from '#shared';
import { checkOverride, copyProblemText, normalizeOverride } from '#shared/copy';
import { copyStore, type Pending } from '../../lib/copy/runtime.ts';
import { factsOf, plural, sameWordsElsewhere, useKeyHistory, when, type KeyFacts } from './data.ts';
import { Panel, useNarrow } from './Panel.tsx';

/** Inside something fixed or sticky (or a sheet over the page): the page's scroll doesn't move it. */
function pinned(el: Element): boolean {
  for (let e: Element | null = el; e && e !== document.body; e = e.parentElement) {
    const p = getComputedStyle(e).position;
    if (p === 'fixed' || p === 'sticky') return true;
  }
  return false;
}

/** The unpublished edit that makes a key show `text` (null: nothing to keep). */
function pendingFor(f: KeyFacts, text: string): Pending | null {
  const live = copyStore.published().get(f.key);
  if (text === f.d) return live !== undefined ? { text: null, original: f.d, context: f.context } : null;
  if (text === live) return null;
  return { text, original: f.d, context: f.context };
}

export function EditSheet({
  k,
  catalog,
  anchor,
  onClose,
}: {
  k: string;
  catalog: CopyCatalog | null;
  /** The tapped element (popover position, focus back on close). */
  anchor: Element | null;
  onClose: (message?: string) => void;
}) {
  const f = useMemo(() => factsOf(k, catalog), [k, catalog]);
  const narrow = useNarrow();
  const before = useRef(copyStore.pending().get(k) ?? null);
  const start = useRef(copyStore.current(k).text ?? f.d);
  const [value, setRaw] = useState(start.current);
  const touched = useRef(false);
  const setValue = (v: string) => {
    touched.current = true;
    setRaw(v);
  };
  const [showHistory, setShowHistory] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const history = useKeyHistory(k, showHistory);
  const rect = useMemo(() => anchor?.getBoundingClientRect() ?? null, [anchor]);

  const text = normalizeOverride(value);
  const problem = f.editable ? checkOverride(text, f.d, f.kind) : null;
  const others = useMemo(() => sameWordsElsewhere(k, f.d, catalog), [k, f.d, catalog]);
  const places = f.entry?.at?.length ?? 0;
  const snippets = f.names.flatMap((n): Array<[string, string]> => {
    const s = f.entry?.ph?.[n];
    return s ? [[n, s]] : [];
  });
  const oneLine = !f.d.includes('\n');
  const longLabel = f.d.length > 0 && f.d.length <= 20 && text.length > f.d.length * 1.5;
  const skew = !!catalog && !f.entry;

  // Phones: bring the words above the sheet. Not for words in pinned chrome (tab bar, top bar, an app
  // sheet): scrolling the page behind wouldn't move them, only lose the owner's place.
  useEffect(() => {
    if (!narrow || !anchor || pinned(anchor)) return;
    const r = anchor.getBoundingClientRect();
    if (r.top < 64 || r.bottom > window.innerHeight * 0.3) window.scrollBy({ top: r.top - 64 });
  }, [narrow, anchor]);

  // Live preview, 150 ms after the last keystroke (only valid words reach the screen).
  useEffect(() => {
    if (!f.editable || problem || !touched.current) return;
    const t = setTimeout(() => copyStore.setPending(k, pendingFor(f, text)), 150);
    return () => clearTimeout(t);
  }, [text, problem, f, k]);

  // Auto-grow.
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight + 2, window.innerHeight * 0.4)}px`;
  }, [value]);

  const keep = () => {
    if (!f.editable) return onClose();
    if (problem) return;
    if (touched.current) copyStore.setPending(k, pendingFor(f, text));
    onClose();
  };
  const cancel = () => {
    copyStore.setPending(k, before.current);
    onClose();
  };

  const insert = (open: string, close = '') => {
    const el = area.current;
    const s = el?.selectionStart ?? value.length;
    const e = el?.selectionEnd ?? value.length;
    const next = value.slice(0, s) + open + value.slice(s, e) + close + value.slice(e);
    setValue(next);
    requestAnimationFrame(() => {
      el?.focus();
      const at = e + open.length + close.length;
      el?.setSelectionRange(close ? s + open.length : at, close ? e + open.length : at);
    });
  };

  const changeOthers = () => {
    if (problem) return;
    let done = 0;
    copyStore.setPendingMany(
      others.flatMap((other) => {
        const g = factsOf(other, catalog);
        if (!g.editable || checkOverride(text, g.d, g.kind)) return [];
        done++;
        return [[other, pendingFor(g, text)] as [string, Pending | null]];
      }),
    );
    setNote(done === others.length ? `Changed ${plural(done, 'more place', 'more places')} too.` : `Changed ${done} of ${others.length}; the rest can’t hold these words.`);
  };

  return (
    <Panel
      title={f.label}
      titleHint={f.context ?? undefined}
      kicker="Change the words"
      anchor={rect}
      returnTo={anchor}
      onClose={cancel}
      onOutside={keep}
      footer={
        <div className="lce-actions">
          <button type="button" className="lce-btn lce-btn-ghost" onClick={cancel}>
            Cancel
          </button>
          <button type="button" className="lce-btn lce-btn-wax" onClick={keep} disabled={!!problem}>
            Keep
          </button>
        </div>
      }
    >
      {f.legal && (
        <p className="lce-banner lce-banner-legal">
          <TriangleAlert size={16} aria-hidden /> Legal or consent words: what they promise must stay true.
        </p>
      )}
      {!f.editable ? (
        <p className="lce-muted">
          {f.d
            ? 'This message is built from what’s in it (a name, a title), so it can’t be changed here.'
            : 'LORE doesn’t know these words yet. Find them under Edited texts → Find.'}
        </p>
      ) : (
        <>
          {skew && <p className="lce-banner">Not in this build’s word list: publishing it may be refused.</p>}
          <textarea
            ref={area}
            className="lce-textarea"
            data-autofocus=""
            value={value}
            rows={2}
            spellCheck
            aria-label="New words"
            aria-invalid={!!problem}
            aria-describedby={problem ? `${k}-problem` : undefined}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || oneLine)) {
                e.preventDefault();
                keep();
              }
            }}
          />
          <div className="lce-row lce-meta">
            <span>{plural(text.length, 'character', 'characters')}</span>
            {places > 1 && <span>· {places} places in this file, one edit</span>}
          </div>
          {problem && (
            <p className="lce-error" role="alert" id={`${k}-problem`}>
              {copyProblemText(problem)}
            </p>
          )}
          {longLabel && !problem && <p className="lce-warn">Long labels can break the tab bar and buttons.</p>}

          {(f.names.length > 0 || f.kind === 'n') && (
            <div className="lce-row lce-wrap">
              {f.names.length > 0 && <span className="lce-muted lce-small">Keep these:</span>}
              {f.names.map((n) => (
                <button
                  key={n}
                  type="button"
                  className="lce-chip"
                  title={f.entry?.ph?.[n] ?? undefined}
                  onClick={() => insert(`{${n}}`)}
                >
                  {`{${n}}`}
                </button>
              ))}
              {f.kind === 'n' && (
                <>
                  <button type="button" className="lce-chip" onClick={() => insert('<em>', '</em>')} title="Wrap the selection in emphasis">
                    <Italic size={14} aria-hidden /> Emphasis
                  </button>
                  <button type="button" className="lce-chip" onClick={() => insert('<br/>')} title="Line break">
                    <CornerDownLeft size={14} aria-hidden /> Line break
                  </button>
                </>
              )}
            </div>
          )}
          {snippets.length > 0 && (
            // Phones have no hover: what fills each placeholder, in the code's own words.
            <p className="lce-muted lce-small lce-full">
              {snippets.map(([n, s], i) => (
                <span key={n}>
                  {i > 0 ? ' · ' : ''}
                  {`{${n}}`} is filled with <code>{s.length > 40 ? `${s.slice(0, 39)}…` : s}</code>
                </span>
              ))}
            </p>
          )}

          <div className="lce-original">
            <span className="lce-kicker">Original</span>
            <p>{f.d}</p>
            {text !== f.d && (
              <button type="button" className="lce-link" onClick={() => setValue(f.d)}>
                Use original
              </button>
            )}
          </div>

          {others.length > 0 && (
            <div className="lce-row lce-wrap">
              <span className="lce-muted lce-small">Same words in {plural(others.length, 'other file', 'other files')}.</span>
              <button type="button" className="lce-link" onClick={changeOthers} disabled={!!problem || text === f.d}>
                Change those too
              </button>
            </div>
          )}
          {note && (
            <p className="lce-muted lce-small" role="status">
              {note}
            </p>
          )}

          <button type="button" className="lce-link" onClick={() => setShowHistory((s) => !s)} aria-expanded={showHistory}>
            <History size={14} aria-hidden /> Earlier versions
          </button>
          {showHistory && (
            <div className="lce-history">
              {history.isLoading && <p className="lce-muted lce-small">Unrolling the old maps…</p>}
              {history.error && <p className="lce-error">{(history.error as Error).message}</p>}
              {history.data && !history.data.entries.length && <p className="lce-muted lce-small">Never published before.</p>}
              {history.data?.entries.map((h) => (
                <div key={h.revisionId} className="lce-history-row">
                  <p>{h.after ?? <em>the original words</em>}</p>
                  <span className="lce-muted lce-small">
                    {when(h.createdAt)}
                    {h.kind !== 'publish' ? ` · ${h.kind === 'undo' ? 'undo' : 'moved after an update'}` : ''}
                  </span>
                  <button type="button" className="lce-link" onClick={() => setValue(h.after ?? f.d)}>
                    Use this
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Panel>
  );
}
