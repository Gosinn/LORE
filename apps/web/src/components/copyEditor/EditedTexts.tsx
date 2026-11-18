// Live text editor: everything edited, in one sheet (LIVE_TEXT_SPEC 10.5): unpublished, published (with
// "Copy for Claude"), orphans, history with undo, find, and the texts on this screen. Lists are capped at 50
// with a search: never endless.
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, ClipboardCopy, Search } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import type { CopyAdminState, CopyCatalog, CopyOverride, CopyUndoResult } from '#shared';
import { checkOverride, copyProblemText } from '#shared/copy';
import { api, ApiError } from '../../lib/api.ts';
import { copyStore } from '../../lib/copy/runtime.ts';
import { applyCopyState, catchUpCopy } from '../../lib/copy/sync.ts';
import { bakeText } from './bake.ts';
import { ADMIN_KEY, factsOf, orphansOf, plural, when, whereLabel, whereOf, wordsOf, type Orphan } from './data.ts';
import { Panel } from './Panel.tsx';
import { keysOnScreen } from './scanner.ts';

export type EditedTab = 'unpublished' | 'published' | 'orphans' | 'history' | 'find' | 'screen';

const TABS: Array<[EditedTab, string]> = [
  ['unpublished', 'Unpublished'],
  ['published', 'Published'],
  ['orphans', 'Orphans'],
  ['history', 'History'],
  ['find', 'Find'],
  ['screen', 'On this screen'],
];

const CAP = 50;

const matches = (q: string, ...parts: Array<string | null | undefined>) => {
  const needle = q.trim().toLowerCase();
  return !needle || parts.some((p) => p?.toLowerCase().includes(needle));
};

function Row({ title, hint, children, actions }: { title: ReactNode; hint?: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <li className="lce-item">
      <span className="lce-kicker" title={hint}>
        {title}
      </span>
      {children}
      {actions && <div className="lce-row lce-wrap lce-item-actions">{actions}</div>}
    </li>
  );
}

function Capped({ total }: { total: number }) {
  return total > CAP ? <p className="lce-muted lce-small">Showing {CAP} of {total}. Search to narrow it down.</p> : null;
}

function SearchBox({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <label className="lce-search">
      <Search size={16} aria-hidden />
      <input type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={label} aria-label={label} />
    </label>
  );
}

export function EditedTexts({
  catalog,
  admin,
  adminError,
  initialTab,
  onEdit,
  onClose,
}: {
  catalog: CopyCatalog | null;
  admin: CopyAdminState | undefined;
  adminError: unknown;
  initialTab: EditedTab;
  onEdit: (key: string) => void;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<EditedTab>(initialTab);
  const [q, setQ] = useState('');
  const [home, setHome] = useState<CopyOverride | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [bake, setBake] = useState<string | null>(null);

  const pending = [...copyStore.pending()];
  const overrides = admin?.overrides ?? [];
  const orphans = useMemo(() => orphansOf(overrides, catalog), [overrides, catalog]);
  const orphanKeys = new Set(orphans.map((o) => o.o.key));
  const published = overrides.filter((o) => !orphanKeys.has(o.key));

  const go = (t: EditedTab) => {
    setTab(t);
    setQ('');
    setMessage(null);
    setError(null);
    if (t !== 'find') setHome(null);
  };

  const revert = (o: Pick<CopyOverride, 'key' | 'original' | 'context'>) =>
    copyStore.setPending(o.key, { text: null, original: o.original, context: o.context });

  const undo = async (revisionId: string) => {
    setBusy(true);
    setError(null);
    try {
      const run = () => api.post<CopyUndoResult>('/admin/copy/undo', { revisionId, baseVersion: copyStore.version() });
      let res: CopyUndoResult;
      try {
        res = await run();
      } catch (err) {
        if (!(err instanceof ApiError) || err.status !== 409) throw err;
        await catchUpCopy();
        res = await run();
      }
      applyCopyState(res);
      void qc.invalidateQueries({ queryKey: ADMIN_KEY });
      setMessage(
        res.skipped.length
          ? `Undone. ${plural(res.skipped.length, 'text was', 'texts were')} changed again since, so left alone.`
          : 'Undone. Everyone sees the earlier words on their next tap.',
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That didn’t go through.');
    } finally {
      setBusy(false);
    }
  };

  const copyForClaude = async () => {
    const text = bakeText(overrides, catalog);
    try {
      await navigator.clipboard.writeText(text);
      setMessage('Copied. Paste it to Claude in a code session; the words then move into the code.');
      setBake(null);
    } catch {
      setBake(text);
    }
  };

  const adopt = (target: string) => {
    if (!home) return;
    const f = factsOf(target, catalog);
    const problem = checkOverride(home.text, f.d, f.kind);
    if (problem) {
      setError(`Those words don’t fit there: ${copyProblemText(problem)}`);
      return;
    }
    copyStore.setPendingMany([
      [target, { text: home.text, original: f.d, context: f.context }],
      [home.key, { text: null, original: home.original, context: home.context }],
    ]);
    setHome(null);
    go('unpublished');
    setMessage('Moved. Publish to make it live.');
  };

  const cleanable = orphans.filter((o) => o.status !== 'lost');

  let body: ReactNode;
  if (tab === 'unpublished') {
    body = pending.length ? (
      <ul className="lce-list">
        {pending.map(([k, p]) => (
          <Row
            key={k}
            title={whereOf(k, catalog, p.context).label}
            hint={whereOf(k, catalog, p.context).hint}
            actions={
              <>
                <button type="button" className="lce-link" onClick={() => onEdit(k)}>
                  Edit
                </button>
                <button type="button" className="lce-link" onClick={() => copyStore.setPending(k, null)}>
                  Undo this change
                </button>
              </>
            }
          >
            <p className="lce-before">{copyStore.published().get(k) ?? p.original}</p>
            <p className="lce-after">
              <ArrowRight size={14} aria-hidden /> {p.text ?? <em>back to the original</em>}
            </p>
          </Row>
        ))}
      </ul>
    ) : (
      <p className="lce-empty">Nothing waiting. Tap any words to change them.</p>
    );
  } else if (tab === 'published') {
    const list = published.filter((o) => matches(q, o.text, o.original, o.context, o.key));
    body = (
      <>
        <div className="lce-row lce-wrap">
          <button type="button" className="lce-btn lce-btn-quiet lce-btn-sm" onClick={() => void copyForClaude()} disabled={!overrides.length}>
            <ClipboardCopy size={15} aria-hidden /> Copy for Claude
          </button>
          <span className="lce-muted lce-small">Hands the edits to a code session, so the code says them too.</span>
        </div>
        {bake !== null && (
          <textarea className="lce-textarea lce-bake" readOnly value={bake} aria-label="Edits for Claude" onFocus={(e) => e.currentTarget.select()} />
        )}
        {published.length > 8 && <SearchBox value={q} onChange={setQ} label="Search published words" />}
        {list.length ? (
          <ul className="lce-list">
            {list.slice(0, CAP).map((o) => (
              <Row
                key={o.key}
                hint={whereOf(o.key, catalog, o.context).hint}
                title={
                  <>
                    {whereOf(o.key, catalog, o.context).label}
                    {copyStore.problem(o.key) && <span className="lce-tag lce-tag-bad"> doesn’t fit, original shown</span>}
                    {copyStore.pending().has(o.key) && <span className="lce-tag"> changed again, unpublished</span>}
                  </>
                }
                actions={
                  <>
                    <button type="button" className="lce-link" onClick={() => onEdit(o.key)}>
                      Edit
                    </button>
                    <button type="button" className="lce-link" onClick={() => revert(o)}>
                      Back to original
                    </button>
                  </>
                }
              >
                <p className="lce-after">{o.text}</p>
                <p className="lce-before">Original: {o.original}</p>
                <span className="lce-muted lce-small">
                  {o.updatedBy ? `${o.updatedBy.displayName} · ` : ''}
                  {when(o.updatedAt)}
                  {o.followedFrom ? ' · moved here after an update' : ''}
                </span>
              </Row>
            ))}
          </ul>
        ) : (
          <p className="lce-empty">{published.length ? 'No published words match.' : 'Nothing published yet.'}</p>
        )}
        <Capped total={list.length} />
      </>
    );
  } else if (tab === 'orphans') {
    body = !catalog ? (
      <p className="lce-empty">Can’t tell without this build’s word list (copy-catalog.json didn’t load).</p>
    ) : orphans.length ? (
      <>
        <p className="lce-muted lce-small">Published words whose text changed in the code. They show nowhere now.</p>
        {cleanable.length > 1 && (
          <button
            type="button"
            className="lce-btn lce-btn-quiet lce-btn-sm"
            onClick={() => {
              copyStore.setPendingMany(cleanable.map((o) => [o.o.key, { text: null, original: o.o.original, context: o.o.context }]));
              setMessage(`${plural(cleanable.length, 'clean-up', 'clean-ups')} waiting: publish to finish.`);
            }}
          >
            Clean up all {cleanable.length}
          </button>
        )}
        <ul className="lce-list">
          {orphans.slice(0, CAP).map((o: Orphan) => (
            <Row
              key={o.o.key}
              title={whereLabel(o.o.key, o.o.context)}
              hint={o.o.context ?? undefined}
              actions={
                copyStore.pending().get(o.o.key)?.text === null ? (
                  <span className="lce-muted lce-small">Clean-up waiting for Publish.</span>
                ) : o.status === 'lost' ? (
                  <>
                    <button
                      type="button"
                      className="lce-link"
                      onClick={() => {
                        setHome(o.o);
                        setTab('find');
                        setQ('');
                      }}
                    >
                      Find new home
                    </button>
                    <button type="button" className="lce-link" onClick={() => revert(o.o)}>
                      Delete
                    </button>
                  </>
                ) : (
                  <button type="button" className="lce-link" onClick={() => revert(o.o)}>
                    Clean up
                  </button>
                )
              }
            >
              <p className="lce-after">{o.o.text}</p>
              <p className="lce-before">Original: {o.o.original}</p>
              <span className="lce-muted lce-small">
                {o.status === 'followed'
                  ? `Followed to ${whereLabel(o.to!, catalog.keys[o.to!]?.ctx)} after the update.`
                  : o.status === 'in-code'
                    ? 'Already in the code.'
                    : 'The code changed under it.'}{' '}
                {when(o.o.updatedAt)}
              </span>
            </Row>
          ))}
        </ul>
        <Capped total={orphans.length} />
      </>
    ) : (
      <p className="lce-empty">No orphans. Every published word has a home.</p>
    );
  } else if (tab === 'history') {
    const revisions = admin?.revisions ?? [];
    body = revisions.length ? (
      <ul className="lce-list">
        {revisions.map((r) => (
          <Row
            key={r.id}
            title={`${when(r.createdAt)} · ${r.kind === 'follow' ? 'moved after an update' : r.kind === 'undo' ? 'undo' : (r.publishedBy?.displayName ?? 'published')}`}
            actions={
              <button type="button" className="lce-link" disabled={busy} onClick={() => void undo(r.id)}>
                Undo
              </button>
            }
          >
            <p className="lce-muted lce-small">{plural(r.changes.length, 'text', 'texts')}</p>
            {r.changes.slice(0, 3).map((c) => (
              <p key={c.key} className="lce-after">
                <ArrowRight size={14} aria-hidden /> {c.after ?? <em>the original: {c.original}</em>}
              </p>
            ))}
            {r.changes.length > 3 && <p className="lce-muted lce-small">and {r.changes.length - 3} more</p>}
          </Row>
        ))}
      </ul>
    ) : (
      <p className="lce-empty">No publishes yet.</p>
    );
  } else if (tab === 'find') {
    const entries = catalog ? Object.entries(catalog.keys) : [];
    const found = q.trim()
      ? entries.filter(([k, e]) => matches(q, e.text, copyStore.published().get(k), whereLabel(k, e.ctx), e.ctx, ...(e.at ?? [])))
      : [];
    body = !catalog ? (
      <p className="lce-empty">This build’s word list didn’t load, so there’s nothing to search.</p>
    ) : (
      <>
        {home && (
          <p className="lce-banner">
            Pick the new home for “{home.text}”.{' '}
            <button type="button" className="lce-link" onClick={() => setHome(null)}>
              Stop
            </button>
          </p>
        )}
        <SearchBox value={q} onChange={setQ} label="Search every text, by words or screen" />
        {q.trim() && !found.length && <p className="lce-empty">No text says that.</p>}
        <ul className="lce-list">
          {found.slice(0, CAP).map(([k, e]) => (
            <li key={k} className="lce-item">
              <button type="button" className="lce-pick" onClick={() => (home ? adopt(k) : onEdit(k))}>
                <span className="lce-kicker" title={e.ctx}>
                  {whereLabel(k, e.ctx)}
                </span>
                <span>{copyStore.published().get(k) ?? e.text}</span>
              </button>
            </li>
          ))}
        </ul>
        <Capped total={found.length} />
      </>
    );
  } else {
    const { shown, hidden } = keysOnScreen();
    const recent = copyStore.recent().filter((k) => !shown.has(k) && !hidden.has(k));
    const list = (keys: Iterable<string>) => (
      <ul className="lce-list">
        {[...keys].slice(0, CAP).map((k) => (
          <li key={k} className="lce-item">
            <button type="button" className="lce-pick" onClick={() => onEdit(k)}>
              <span className="lce-kicker" title={factsOf(k, catalog).context ?? undefined}>
                {factsOf(k, catalog).label}
              </span>
              <span>{wordsOf(k, catalog)}</span>
            </button>
          </li>
        ))}
      </ul>
    );
    body = (
      <>
        <h3 className="lce-h3">Hidden on this screen</h3>
        <p className="lce-muted lce-small">Placeholders, labels for screen readers, tooltips, disabled buttons.</p>
        {hidden.size ? list(hidden) : <p className="lce-empty">None here.</p>}
        <h3 className="lce-h3">Recently shown</h3>
        <p className="lce-muted lce-small">Used in the last 2 minutes but not on screen now: confirm dialogs, errors.</p>
        {recent.length ? list(recent) : <p className="lce-empty">None. Switch the pen to Using, make it appear, then come back.</p>}
        <h3 className="lce-h3">Shown</h3>
        {shown.size ? (
          list(shown)
        ) : (
          <p className="lce-empty">{copyStore.isEditing() ? 'Nothing marked on screen.' : 'Lift the quill first: then this screen’s words show up here.'}</p>
        )}
      </>
    );
  }

  const counts: Partial<Record<EditedTab, number>> = { unpublished: pending.length, published: published.length, orphans: orphans.length };

  return (
    <Panel title="Edited texts" kicker="The words of LORE" onClose={onClose} wide>
      <div className="lce-tabs" role="tablist" aria-label="Edited texts">
        {TABS.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className="lce-tab" onClick={() => go(id)}>
            {label}
            {counts[id] ? <span className="lce-count">{counts[id]}</span> : null}
          </button>
        ))}
      </div>
      {adminError && tab !== 'unpublished' && tab !== 'find' && tab !== 'screen' ? (
        <p className="lce-error" role="alert">
          {adminError instanceof Error ? adminError.message : 'The published words didn’t load.'}
        </p>
      ) : null}
      {admin && !admin.enabled && (
        <p className="lce-banner lce-banner-legal">Live text is switched off on the server: nothing shows, nothing publishes.</p>
      )}
      {message && (
        <p className="lce-ok" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="lce-error" role="alert">
          {error}
        </p>
      )}
      <div role="tabpanel">{body}</div>
    </Panel>
  );
}
