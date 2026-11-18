// Live text: the owner's editor (LIVE_TEXT_SPEC 10). Loaded only for the owner with the Profile switch on
// (lib/copy/gate.tsx), as its own chunk. The build transform skips this folder: the tool's own words are
// not editable with the tool.
//
// Pen on = Editing: every editable text is outlined; a tap opens it instead of doing what it normally does.
// Pen off = Using: LORE works normally; unpublished changes stay visible to the owner only.
import { Feather, ListChecks } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { copyStore, stripMarkers } from '../../lib/copy/runtime.ts';
import './copyEditor.css';
import { useCatalog, useCopyAdmin, useCopyTick, orphansOf, whereLabel, wordsOf } from './data.ts';
import { EditedTexts, type EditedTab } from './EditedTexts.tsx';
import { EditSheet } from './EditSheet.tsx';
import { Panel } from './Panel.tsx';
import { DiscardSheet, PublishBar, PublishSheet } from './PublishBar.tsx';
import { hitTest, keysWithin, startScanner, type Hit } from './scanner.ts';

type Open =
  | { type: 'edit'; key: string; anchor: Element | null }
  | { type: 'choose'; keys: string[]; anchor: Element | null }
  | { type: 'publish' }
  | { type: 'discard' }
  | { type: 'list'; tab: EditedTab };

const TEXT_ENTRY = 'input:not([type=button]):not([type=submit]):not([type=checkbox]):not([type=radio]), textarea, select, [contenteditable=""], [contenteditable="true"]';

export function CopyEditor({ userId }: { userId: string }) {
  useCopyTick();
  const editing = copyStore.isEditing();
  const pendingCount = copyStore.pending().size;
  const { catalog } = useCatalog();
  const admin = useCopyAdmin();
  const [open, setOpen] = useState<Open | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [said, setSaid] = useState('');
  const openRef = useRef(open);
  openRef.current = open;

  const orphanCount = catalog && admin.data ? orphansOf(admin.data.overrides, catalog).length : 0;

  const setEditing = (on: boolean) => {
    copyStore.setEditing(on);
    setSaid(on ? 'Editing words. Tap any text to change it.' : 'Using LORE. Taps work normally again.');
  };

  const openHit = (hit: Hit) => {
    const keys = [...new Set(hit.keys)];
    setOpen(keys.length === 1 ? { type: 'edit', key: keys[0]!, anchor: hit.el } : { type: 'choose', keys, anchor: hit.el });
  };

  // Leaving: no markers, no outlines.
  useEffect(() => () => copyStore.setEditing(false), []);

  // Toasts fade by themselves.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  // Outlines on every editable text while editing.
  useEffect(() => (editing ? startScanner() : undefined), [editing]);

  // Taps open the editor instead of the app (capture phase, before React and links see them).
  useEffect(() => {
    if (!editing || open) return;
    let armed: Hit | null = null;
    const stop = (e: Event) => {
      e.stopImmediatePropagation();
    };
    const point = (e: Event): [number | null, number | null] => {
      if (e instanceof MouseEvent) return [e.clientX, e.clientY];
      if (typeof TouchEvent !== 'undefined' && e instanceof TouchEvent) {
        const t = e.touches[0] ?? e.changedTouches[0];
        return t ? [t.clientX, t.clientY] : [null, null];
      }
      return [null, null];
    };
    const down = (e: Event) => {
      const [x, y] = point(e);
      armed = hitTest(e.target, x, y);
      if (!armed) return;
      // No focus, no text selection, no React handlers. (Touch scrolling still works: touchstart isn't cancelled.)
      if (e.type !== 'touchstart') e.preventDefault();
      stop(e);
    };
    const follow = (e: Event) => {
      if (!armed) return;
      if (e.type !== 'touchend') e.preventDefault();
      stop(e);
    };
    const click = (e: Event) => {
      const [x, y] = point(e);
      const hit = armed ?? hitTest(e.target, x, y);
      armed = null;
      if (!hit) return;
      e.preventDefault(); // links don't navigate, buttons and forms don't fire, labels don't toggle
      stop(e);
      openHit(hit);
    };
    const cancel = () => {
      armed = null;
    };
    const dbl = (e: Event) => {
      const [x, y] = point(e);
      if (!hitTest(e.target, x, y)) return;
      e.preventDefault();
      stop(e);
    };
    const key = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'e' && e.key !== 'E') return;
      const el = document.activeElement;
      if (!el || el === document.body || el.closest('[data-lore-copy-ui]') || el.matches(TEXT_ENTRY)) return;
      const keys = keysWithin(el);
      if (!keys.length) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      openHit({ keys, el });
    };
    const capture = { capture: true } as const;
    const touch = { capture: true, passive: true } as const;
    window.addEventListener('pointerdown', down, capture);
    window.addEventListener('mousedown', follow, capture);
    window.addEventListener('touchstart', follow, touch);
    window.addEventListener('pointerup', follow, capture);
    window.addEventListener('mouseup', follow, capture);
    window.addEventListener('touchend', follow, touch);
    window.addEventListener('pointercancel', cancel, capture);
    window.addEventListener('click', click, capture);
    window.addEventListener('dblclick', dbl, capture);
    window.addEventListener('keydown', key, capture);
    return () => {
      window.removeEventListener('pointerdown', down, capture);
      window.removeEventListener('mousedown', follow, capture);
      window.removeEventListener('touchstart', follow, touch);
      window.removeEventListener('pointerup', follow, capture);
      window.removeEventListener('mouseup', follow, capture);
      window.removeEventListener('touchend', follow, touch);
      window.removeEventListener('pointercancel', cancel, capture);
      window.removeEventListener('click', click, capture);
      window.removeEventListener('dblclick', dbl, capture);
      window.removeEventListener('keydown', key, capture);
    };
  }, [editing, open]);

  // Alt+E switches Editing and Using; Esc leaves Editing when nothing is open. Copied text loses its markers.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyE') {
        e.preventDefault();
        setEditing(!copyStore.isEditing());
      } else if (e.key === 'Escape' && copyStore.isEditing() && !openRef.current) {
        setEditing(false);
      }
    };
    const onCopy = (e: ClipboardEvent) => {
      const selected = document.getSelection()?.toString() ?? '';
      const clean = stripMarkers(selected);
      if (clean === selected || !e.clipboardData) return;
      e.clipboardData.setData('text/plain', clean);
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('copy', onCopy);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('copy', onCopy);
    };
  }, []);

  const close = (message?: string) => {
    setOpen(null);
    if (message) setToast(message);
  };

  return (
    <>
      {createPortal(
        <div className="lce lce-dock" data-lore-copy-ui="" data-owner={userId}>
          {editing && (
            <div className="lce-pill" role="toolbar" aria-label="Editing words">
              <span className="lce-pill-text">Tap any words to change them</span>
              <button type="button" className="lce-pill-btn" onClick={() => setOpen({ type: 'list', tab: pendingCount ? 'unpublished' : 'screen' })}>
                <ListChecks size={16} aria-hidden /> Texts
              </button>
              <button type="button" className="lce-pill-btn lce-pill-done" onClick={() => setEditing(false)}>
                Done
              </button>
            </div>
          )}
          {toast && (
            <p className="lce-toast" role="status">
              {toast}
            </p>
          )}
          {pendingCount > 0 && (
            <PublishBar
              count={pendingCount}
              orphans={orphanCount}
              onPublish={() => setOpen({ type: 'publish' })}
              onDiscard={() => setOpen({ type: 'discard' })}
              onList={() => setOpen({ type: 'list', tab: orphanCount ? 'orphans' : 'unpublished' })}
            />
          )}
          <button
            type="button"
            className={`lce-pen${pendingCount ? ' lce-pen-lift' : ''}`}
            aria-pressed={editing}
            aria-label="Edit words"
            title={editing ? 'Back to using LORE (Alt+E)' : 'Edit words (Alt+E)'}
            onClick={() => setEditing(!editing)}
          >
            <Feather size={24} aria-hidden />
          </button>
          <p className="lce-sr" aria-live="polite">
            {said}
          </p>
        </div>,
        document.body,
      )}

      {open?.type === 'edit' && <EditSheet key={open.key} k={open.key} catalog={catalog} anchor={open.anchor} onClose={close} />}
      {open?.type === 'choose' && (
        <Panel title="Which words?" kicker="More than one text here" onClose={() => close()} anchor={open.anchor?.getBoundingClientRect() ?? null} returnTo={open.anchor}>
          <ul className="lce-list">
            {open.keys.map((k) => (
              <li key={k} className="lce-item">
                <button type="button" className="lce-pick" onClick={() => setOpen({ type: 'edit', key: k, anchor: open.anchor })}>
                  <span className="lce-kicker" title={catalog?.keys[k]?.ctx}>
                    {whereLabel(k, catalog?.keys[k]?.ctx)}
                  </span>
                  <span>{wordsOf(k, catalog) || k}</span>
                </button>
              </li>
            ))}
          </ul>
        </Panel>
      )}
      {open?.type === 'publish' && <PublishSheet catalog={catalog} onClose={() => close()} onDone={close} />}
      {open?.type === 'discard' && <DiscardSheet count={pendingCount} onClose={() => close()} onDone={close} />}
      {open?.type === 'list' && (
        <EditedTexts
          catalog={catalog}
          admin={admin.data}
          adminError={admin.error}
          initialTab={open.tab}
          onEdit={(key) => setOpen({ type: 'edit', key, anchor: null })}
          onClose={() => close()}
        />
      )}
    </>
  );
}
