import { ArrowLeft, Bell, Lock, Users, UsersRound, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router';
import {
  AUDIENCE_LABELS,
  copy,
  EVENT_STATUS_LABELS,
  IDEA_STATUS_LABELS,
  type Audience,
  type EventStatus,
  type IdeaStatus,
  type UserSummary,
} from '#shared';
import { mediaSrc, type ApiError } from '../lib/api.ts';
import { useMe, useUnreadCount } from '../lib/queries.ts';

// ---------------------------------------------------------------- avatars

// The retired looks' colours, used as the fallback. The Treasure Map sets --avatar-0..6 (styles/map.css).
const AVATAR_COLORS = ['#1d5c58', '#d4461d', '#a87a12', '#6b4fa0', '#2f6db3', '#8a3d5c', '#3f7d3a'];

export function Avatar({ user, size = 'md' }: { user: Pick<UserSummary, 'displayName' | 'avatarUrl' | 'id'>; size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  const cls = `avatar${size === 'md' ? '' : ` avatar-${size}`}`;
  if (user.avatarUrl) return <img className={cls} src={mediaSrc(user.avatarUrl)} alt="" loading="lazy" />;
  let hash = 0;
  for (const ch of user.id) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  const initials = user.displayName
    .split(/\s+/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  const i = Math.abs(hash) % AVATAR_COLORS.length;
  return (
    <span className={cls} style={{ background: `var(--avatar-${i}, ${AVATAR_COLORS[i]})` }} aria-hidden>
      {initials}
    </span>
  );
}

/** Someone who has deleted their account. Their contributions stay, anonymised. */
// copy:table
export const FORMER_MEMBER = { id: 'former-member', displayName: 'A former member', avatarUrl: null } as const;

export function AvatarStack({ users, max = 5 }: { users: UserSummary[]; max?: number }) {
  const shown = users.slice(0, max);
  return (
    <span className="avatars" title={users.map((u) => u.displayName).join(', ')}>
      {shown.map((u) => (
        <Avatar key={u.id} user={u} size="sm" />
      ))}
      {users.length > max && (
        <span className="avatar avatar-sm" style={{ background: 'var(--surface-2)', color: 'var(--ink-2)' }}>
          +{users.length - max}
        </span>
      )}
    </span>
  );
}

export function Person({ user, sub, link = true }: { user: UserSummary; sub?: ReactNode; link?: boolean }) {
  const body = (
    <span className="person">
      <Avatar user={user} />
      <span className="grow">
        <span className="person-name ellipsis" style={{ display: 'block' }}>
          {user.displayName}
        </span>
        {sub && <span className="tiny muted">{sub}</span>}
      </span>
    </span>
  );
  return link ? <Link to={`/u/${user.username}`}>{body}</Link> : body;
}

// ------------------------------------------------------------------ chrome

export function TopBar({ title, back, actions }: { title?: ReactNode; back?: boolean | string; actions?: ReactNode }) {
  const navigate = useNavigate();
  const me = useMe();
  const unread = useUnreadCount(!!me.data);
  return (
    <header className="topbar">
      {back && (
        <button
          className="icon-btn back"
          aria-label="Back"
          onClick={() => (typeof back === 'string' ? navigate(back) : history.length > 1 ? navigate(-1) : navigate('/'))}
        >
          <ArrowLeft size={22} />
        </button>
      )}
      <h1>{title}</h1>
      {actions}
      <Link to="/notifications" className="icon-btn" aria-label={`Notifications${unread.data?.count ? ` (${unread.data.count} new)` : ''}`}>
        <Bell size={21} />
        {!!unread.data?.count && <span className="badge-dot">{unread.data.count > 9 ? '9+' : unread.data.count}</span>}
      </Link>
    </header>
  );
}

export function Wordmark({ tag = true }: { tag?: boolean }) {
  return (
    <span className="wordmark">
      {/* The logotype is the name itself, not words to reword. */}
      <span className="wordmark-name" data-copy="off">
        L<span className="o">O</span>RE
      </span>
      {tag && <span className="wordmark-tag">No scrolling. Only rolling.</span>}
    </span>
  );
}

/** What the name stands for, with the initials picked out. */
export function Backronym({ className = '' }: { className?: string }) {
  return (
    <span className={`backronym ${className}`} aria-label="Life Of Regular Epics">
      {copy.list(['Life', 'Of', 'Regular', 'Epics']).map((word, i) => (
        <span key={i} aria-hidden>
          <b>{word[0]}</b>
          {word.slice(1)}{' '}
        </span>
      ))}
    </span>
  );
}

export function Section({ title, more, children }: { title: string; more?: ReactNode; children: ReactNode }) {
  return (
    <section className="section">
      <div className="section-head">
        <h2 className="eyebrow">{title}</h2>
        {more}
      </div>
      {children}
    </section>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <p className="serif">{title}</p>
      {children}
    </div>
  );
}

export function Loading() {
  return (
    <div className="loading" role="status" aria-label="Loading">
      <div className="spinner" />
    </div>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p className="form-error" role="alert">
      {(error as ApiError).message ?? 'Something went wrong.'}
    </p>
  );
}

export function PageError({ error }: { error: unknown }) {
  const status = (error as ApiError)?.status;
  return (
    <>
      <TopBar back title="" />
      <Empty title={status === 404 ? 'Nothing here, or it isn’t shared with you.' : 'That didn’t load.'}>
        <p className="small muted">{(error as ApiError)?.message}</p>
        <Link to="/" className="btn btn-secondary btn-sm">
          Go home
        </Link>
      </Empty>
    </>
  );
}

/** What Tab may land on inside a dialog (Sheet, and the Loracle's ScrollSheet). */
// copy:ignore (a CSS selector)
export const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

/**
 * Bottom sheet on phones, dialog on wider screens. Focus moves in (unless something inside already took
 * it, like an autofocused field), Tab stays inside, and focus goes back to what opened it on close.
 */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  // Callers often pass a new onClose each render: the effect below runs once and reads the latest.
  const close = useRef(onClose);
  close.current = onClose;
  // What had focus when the sheet opened (read on the first render, before anything inside autofocuses).
  const [opener] = useState(() => (document.activeElement instanceof HTMLElement ? document.activeElement : null));
  useEffect(() => {
    const node = ref.current;
    if (node && !node.contains(document.activeElement)) node.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close.current();
        return;
      }
      if (e.key !== 'Tab' || !node) return;
      const items = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);
      if (!items.length) return;
      const a = items[0]!;
      const z = items[items.length - 1]!;
      if (e.shiftKey && (document.activeElement === a || document.activeElement === node)) {
        e.preventDefault();
        z.focus();
      } else if (!e.shiftKey && (document.activeElement === z || !node.contains(document.activeElement))) {
        e.preventDefault();
        a.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
      if (opener?.isConnected) opener.focus();
    };
  }, [opener]);
  return createPortal(
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && close.current()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} ref={ref} tabIndex={-1}>
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

// ------------------------------------------------------------------ forms

export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {error ? <span className="error">{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

// ------------------------------------------------------------------- pills

const AUDIENCE_ICONS: Record<Audience, typeof Lock> = {
  only_me: Lock,
  participants: UsersRound,
  friends: Users,
  crew: Users,
};

/** Always visible on shared things, so it's clear who can see them. */
export function PrivacyBadge({ audience, crewName }: { audience: Audience; crewName?: string | null }) {
  const Icon = AUDIENCE_ICONS[audience];
  const label = audience === 'crew' && crewName ? crewName : AUDIENCE_LABELS[audience].label;
  return (
    <span className="privacy" title={AUDIENCE_LABELS[audience].hint}>
      <Icon size={13} /> {label}
    </span>
  );
}

const STATUS_TONE: Partial<Record<EventStatus, string>> = {
  confirmed: 'pill-fjord',
  in_progress: 'pill-ember',
  completed: 'pill-gold',
  canceled: 'pill-danger',
};

export function EventStatusPill({ status }: { status: EventStatus }) {
  return <span className={`pill ${STATUS_TONE[status] ?? ''}`}>{EVENT_STATUS_LABELS[status]}</span>;
}

const IDEA_TONE: Partial<Record<IdeaStatus, string>> = {
  gathering_interest: 'pill-ember',
  planning: 'pill-fjord',
  scheduled: 'pill-fjord',
  completed: 'pill-gold',
};

export function IdeaStatusPill({ status }: { status: IdeaStatus }) {
  return <span className={`pill ${IDEA_TONE[status] ?? ''}`}>{IDEA_STATUS_LABELS[status]}</span>;
}
