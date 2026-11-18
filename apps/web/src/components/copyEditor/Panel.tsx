// Live text editor: one sheet shell for everything the editor opens. A bottom sheet on phones (above the
// on-screen keyboard), a card anchored under the tapped words or a centred dialog on wider screens.
// Focus stays inside; Esc closes; focus goes back to where it came from.
import { X } from 'lucide-react';
import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const FOCUSABLE = 'button:not(:disabled), [href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])';

/** How far the on-screen keyboard covers the page (no Capacitor Keyboard plugin: the visual viewport tells). */
function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const on = () => setInset(Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)));
    on();
    vv.addEventListener('resize', on);
    vv.addEventListener('scroll', on);
    return () => {
      vv.removeEventListener('resize', on);
      vv.removeEventListener('scroll', on);
    };
  }, []);
  return inset;
}

export function useNarrow(): boolean {
  const query = '(max-width: 599.98px)';
  const [narrow, setNarrow] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setNarrow(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return narrow;
}

export function Panel({
  title,
  titleHint,
  kicker,
  onClose,
  onOutside,
  anchor,
  returnTo,
  wide,
  children,
  footer,
}: {
  title: string;
  /** A tooltip on the title (the code's own name for the place). */
  titleHint?: string;
  kicker?: string;
  /** Esc and the close button. */
  onClose: () => void;
  /** A tap outside (defaults to onClose). */
  onOutside?: () => void;
  /** Wide screens: show as a card under (or above) this rectangle. */
  anchor?: DOMRect | null;
  /** Where focus goes back to. */
  returnTo?: Element | null;
  wide?: boolean;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const narrow = useNarrow();
  const keyboard = useKeyboardInset();
  const titleId = useId();
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const before = document.activeElement;
    const box = ref.current;
    (box?.querySelector<HTMLElement>('[data-autofocus]') ?? box?.querySelector<HTMLElement>(FOCUSABLE))?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        close.current();
      } else if (e.key === 'Tab' && box) {
        const items = [...box.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
        if (!items.length) return;
        const first = items[0]!;
        const last = items[items.length - 1]!;
        if (!box.contains(document.activeElement)) {
          e.preventDefault();
          first.focus();
        } else if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      const back = (returnTo ?? before) as HTMLElement | null;
      if (back && back.isConnected && typeof back.focus === 'function') back.focus({ preventScroll: true });
    };
    // Mount only: focus moves in once and back once.
  }, []);

  let style: CSSProperties | undefined;
  if (!narrow && anchor) {
    const width = Math.min(420, window.innerWidth - 32);
    const left = Math.max(16, Math.min(anchor.left, window.innerWidth - width - 16));
    const below = anchor.bottom + 10;
    const roomBelow = window.innerHeight - below - 16;
    style =
      roomBelow >= 300 || roomBelow >= anchor.top - 26
        ? { position: 'fixed', left, top: below, width, maxHeight: roomBelow }
        : { position: 'fixed', left, bottom: window.innerHeight - anchor.top + 10, width, maxHeight: anchor.top - 26 };
  }

  return createPortal(
    <div
      className={`lce lce-overlay${style ? ' lce-overlay-clear' : ''}${narrow ? ' lce-overlay-sheet' : ''}`}
      data-lore-copy-ui=""
      style={narrow && keyboard ? { paddingBottom: keyboard } : undefined}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) (onOutside ?? onClose)();
      }}
    >
      <div
        ref={ref}
        className={`lce-panel${wide ? ' lce-panel-wide' : ''}${style ? ' lce-panel-anchored' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={style}
      >
        <div className="lce-panel-head">
          <div>
            {kicker && <p className="lce-kicker">{kicker}</p>}
            <h2 id={titleId} title={titleHint}>
              {title}
            </h2>
          </div>
          <button type="button" className="lce-icon" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>
        <div className="lce-panel-body">{children}</div>
        {footer && <div className="lce-panel-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
