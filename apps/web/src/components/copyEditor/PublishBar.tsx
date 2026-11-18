// Live text editor: the bar of unpublished changes, the publish sheet and the discard check (LIVE_TEXT_SPEC
// 10.5). Publishing is one tap on the wax seal: it goes live for everyone at once.
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, ListChecks } from 'lucide-react';
import { useState } from 'react';
import type { CopyCatalog, CopyPublishResult } from '#shared';
import { MAX_COPY_BATCH } from '#shared/copy';
import { api, ApiError } from '../../lib/api.ts';
import { copyStore, type Pending } from '../../lib/copy/runtime.ts';
import { applyCopyState, catchUpCopy } from '../../lib/copy/sync.ts';
import { ADMIN_KEY, factsOf, plural, whereOf } from './data.ts';
import { Panel } from './Panel.tsx';

export function PublishBar({
  count,
  orphans,
  onPublish,
  onDiscard,
  onList,
}: {
  count: number;
  orphans: number;
  onPublish: () => void;
  onDiscard: () => void;
  onList: () => void;
}) {
  return (
    <div className="lce-bar" role="region" aria-label="Unpublished changes">
      <span className="lce-bar-count">{count === 1 ? '1 change not live yet' : `${count} changes not live yet`}</span>
      <button type="button" className="lce-btn lce-btn-ghost lce-btn-sm" onClick={onDiscard}>
        Discard
      </button>
      <button type="button" className="lce-btn lce-btn-wax lce-btn-sm" onClick={onPublish}>
        Publish
      </button>
      <button type="button" className="lce-icon lce-dotted" onClick={onList} aria-label={orphans ? `Edited texts (${orphans} need a look)` : 'Edited texts'}>
        <ListChecks size={20} />
        {orphans > 0 && <span className="lce-dot" aria-hidden />}
      </button>
    </div>
  );
}

function Change({ k, p, catalog }: { k: string; p: Pending; catalog: CopyCatalog | null }) {
  const live = copyStore.published().get(k) ?? p.original;
  const w = whereOf(k, catalog, p.context);
  return (
    <li className="lce-change">
      <span className="lce-kicker" title={w.hint}>
        {w.label}
      </span>
      <p className="lce-before">{live}</p>
      <p className="lce-after">
        <ArrowRight size={14} aria-hidden /> {p.text ?? <em>back to the original: {p.original}</em>}
      </p>
    </li>
  );
}

/** What one publish sends: new words in `set`, back-to-the-code in `revert`, in the order of `items`. */
function split(items: Array<[string, Pending]>) {
  const set: Array<{ key: string; text: string; original: string; context: string | null }> = [];
  const revert: string[] = [];
  for (const [key, p] of items) {
    if (p.text === null) revert.push(key);
    else set.push({ key, text: p.text, original: p.original, context: p.context });
  }
  return { set, revert };
}

async function send(items: Array<[string, Pending]>, baseVersion: string | null) {
  return api.put<CopyPublishResult>('/admin/copy', { baseVersion, ...split(items) });
}

/** The change a 400 is about (`set.3.text`, `revert.0`), with the server's words for what's wrong. */
function refusedChange(err: ApiError, items: Array<[string, Pending]>): { key: string; message: string } | null {
  const { set, revert } = split(items);
  for (const [field, message] of Object.entries(err.fields)) {
    const m = /^(set|revert)\.(\d+)/.exec(field);
    const key = m ? (m[1] === 'set' ? set[Number(m[2])]?.key : revert[Number(m[2])]) : undefined;
    if (key) return { key, message: message || err.message };
  }
  return null;
}

export function PublishSheet({
  catalog,
  onClose,
  onDone,
}: {
  catalog: CopyCatalog | null;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const qc = useQueryClient();
  // Changes the owner left out of this publish (the server refused them): they stay on his device.
  const [left, setLeft] = useState<ReadonlySet<string>>(new Set());
  const all = [...copyStore.pending()].filter(([k]) => !left.has(k));
  const items = all.slice(0, MAX_COPY_BATCH);
  const legal = items.filter(([k]) => factsOf(k, catalog).legal);
  const rest = items.filter(([k]) => !factsOf(k, catalog).legal);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refused, setRefused] = useState<{ key: string; message: string } | null>(null);
  const [clash, setClash] = useState<string[] | null>(null);

  const leaveOut = (key: string) => {
    setLeft(new Set([...left, key]));
    setRefused(null);
  };

  const publish = async (overwrite: boolean) => {
    setBusy(true);
    setError(null);
    setRefused(null);
    const seen = new Map(copyStore.published());
    try {
      let res: CopyPublishResult;
      try {
        res = await send(items, copyStore.version());
      } catch (err) {
        if (!(err instanceof ApiError) || err.status !== 409) throw err;
        // Published from somewhere else meanwhile: catch up, then go on unless the same words changed.
        await catchUpCopy();
        const now = copyStore.published();
        const changed = items.filter(([k]) => seen.get(k) !== now.get(k)).map(([k]) => k);
        if (changed.length && !overwrite) {
          setClash(changed);
          return;
        }
        res = await send(items, copyStore.version());
      }
      applyCopyState(res);
      copyStore.settle(items);
      void qc.invalidateQueries({ queryKey: ADMIN_KEY });
      const waiting = all.length - items.length + left.size;
      onDone(waiting ? `Live. ${waiting} more still waiting: publish again.` : 'Live. Everyone sees it on their next tap.');
    } catch (err) {
      // One change the server won't take (a text this server's build lacks, words it refuses): say which.
      const one = err instanceof ApiError && err.status === 400 ? refusedChange(err, items) : null;
      if (one) setRefused(one);
      else setError(err instanceof Error ? err.message : 'That didn’t go through.');
    } finally {
      setBusy(false);
    }
  };

  if (clash) {
    return (
      <Panel
        title="Changed elsewhere"
        kicker="Before you seal it"
        onClose={onClose}
        footer={
          <div className="lce-actions">
            <button type="button" className="lce-btn lce-btn-ghost" onClick={onClose}>
              Not yet
            </button>
            <button type="button" className="lce-btn lce-btn-wax" disabled={busy} onClick={() => void publish(true)}>
              {busy ? 'Sealing…' : 'Publish mine'}
            </button>
          </div>
        }
      >
        <p>
          {plural(clash.length, 'of these texts was', 'of these texts were')} published from another device or tab
          since you started. Publish yours over {clash.length === 1 ? 'it' : 'them'}?
        </p>
        <ul className="lce-list">
          {clash.map((k) => (
            <li key={k} className="lce-change">
              <span className="lce-kicker" title={factsOf(k, catalog).context ?? undefined}>
                {factsOf(k, catalog).label}
              </span>
              <p className="lce-before">Live now: {copyStore.published().get(k) ?? factsOf(k, catalog).d}</p>
              <p className="lce-after">
                <ArrowRight size={14} aria-hidden /> {copyStore.pending().get(k)?.text ?? <em>the original</em>}
              </p>
            </li>
          ))}
        </ul>
        {error && (
          <p className="lce-error" role="alert">
            {error}
          </p>
        )}
      </Panel>
    );
  }

  return (
    <Panel
      title={items.length === 1 ? 'Publish 1 change' : `Publish ${items.length} changes`}
      kicker="Everyone sees it on their next tap"
      onClose={onClose}
      wide
      footer={
        <div className="lce-actions">
          <button type="button" className="lce-btn lce-btn-ghost" onClick={onClose}>
            Not yet
          </button>
          <button
            type="button"
            className="lce-btn lce-btn-wax"
            data-autofocus=""
            disabled={busy || !items.length || (legal.length > 0 && !checked)}
            onClick={() => void publish(false)}
          >
            {busy ? 'Sealing…' : 'Publish'}
          </button>
        </div>
      }
    >
      {legal.length > 0 && (
        <div className="lce-legal">
          <p className="lce-banner lce-banner-legal">Legal or consent words: people agreed to what these say.</p>
          <ul className="lce-list">
            {legal.map(([k, p]) => (
              <Change key={k} k={k} p={p} catalog={catalog} />
            ))}
          </ul>
          <label className="lce-tick">
            <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
            <span>I’ve checked these are still true.</span>
          </label>
          <p className="lce-muted lce-small">Changed the Terms or Privacy? Update “Last updated” on that page too.</p>
        </div>
      )}
      <ul className="lce-list">
        {rest.map(([k, p]) => (
          <Change key={k} k={k} p={p} catalog={catalog} />
        ))}
      </ul>
      {all.length > items.length && (
        <p className="lce-muted lce-small">
          {MAX_COPY_BATCH} at a time: the other {all.length - items.length} wait for the next publish.
        </p>
      )}
      {left.size > 0 && (
        <p className="lce-muted lce-small">
          {plural(left.size, 'change stays', 'changes stay')} on this device, left out of this publish.
        </p>
      )}
      {refused && (
        <div className="lce-refused" role="alert">
          <p className="lce-error">The server turned one change away: {refused.message}</p>
          <ul className="lce-list">
            {(() => {
              const p = copyStore.pending().get(refused.key);
              return p ? <Change k={refused.key} p={p} catalog={catalog} /> : null;
            })()}
          </ul>
          <div className="lce-row lce-wrap">
            <button type="button" className="lce-btn lce-btn-quiet lce-btn-sm" onClick={() => leaveOut(refused.key)}>
              Leave it out
            </button>
            <span className="lce-muted lce-small">It stays here unpublished; the rest goes live.</span>
          </div>
        </div>
      )}
      {error && (
        <p className="lce-error" role="alert">
          {error}
        </p>
      )}
    </Panel>
  );
}

export function DiscardSheet({ count, onClose, onDone }: { count: number; onClose: () => void; onDone: (message: string) => void }) {
  return (
    <Panel
      title={count === 1 ? 'Throw away 1 unpublished change?' : `Throw away ${count} unpublished changes?`}
      onClose={onClose}
      footer={
        <div className="lce-actions">
          <button type="button" className="lce-btn lce-btn-ghost" data-autofocus="" onClick={onClose}>
            Keep them
          </button>
          <button
            type="button"
            className="lce-btn lce-btn-danger"
            onClick={() => {
              copyStore.discardPending();
              onDone('Thrown away. The words are back as they were.');
            }}
          >
            Throw away
          </button>
        </div>
      }
    >
      <p className="lce-muted">Nobody saw them: they were only on this device.</p>
    </Panel>
  );
}
