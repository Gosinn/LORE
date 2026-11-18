import { useQuery } from '@tanstack/react-query';
import { ExternalLink, Mail } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import {
  REPORT_REASON_LABELS,
  SUPPORT_TOPIC_LABELS,
  type ModerationReport,
  type SupportMessage,
} from '#shared';
import { Empty, ErrorNote, Loading, PageError, TopBar } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { timeAgo } from '../lib/dates.ts';
import { useAction, useMe, useModerationSummary } from '../lib/queries.ts';

/** Moderators only: reports to decide on within 24 hours, and the contact form's inbox. */
export function AdminPage() {
  const me = useMe();
  const [tab, setTab] = useState<'open' | 'closed' | 'messages'>('open');
  const summary = useModerationSummary(!!me.data?.isAdmin);
  const reports = useQuery({
    queryKey: ['admin', 'reports', tab],
    queryFn: () => api.get<ModerationReport[]>(`/admin/reports${tab === 'closed' ? '?status=closed' : ''}`),
    enabled: !!me.data?.isAdmin && tab !== 'messages',
  });
  const messages = useQuery({
    queryKey: ['admin', 'support'],
    queryFn: () => api.get<SupportMessage[]>('/admin/support'),
    enabled: !!me.data?.isAdmin && tab === 'messages',
  });

  if (!me.data?.isAdmin) return <PageError error={{ status: 404, message: 'Nothing here.' }} />;
  const s = summary.data;

  return (
    <>
      <TopBar back title="Moderation" />
      {s && (
        <p className="small muted" style={{ marginBottom: 12 }}>
          {s.openReports ? (
            <>
              <strong>{s.openReports}</strong> open {s.openReports === 1 ? 'report' : 'reports'}, oldest {timeAgo(s.oldestOpenAt!)}.
              Answer within 24 hours.
            </>
          ) : (
            'No open reports.'
          )}{' '}
          {s.openMessages ? `${s.openMessages} unanswered ${s.openMessages === 1 ? 'message' : 'messages'}.` : ''}
        </p>
      )}
      <div className="seg" role="tablist" style={{ marginBottom: 16 }}>
        <button aria-pressed={tab === 'open'} onClick={() => setTab('open')}>
          Open
        </button>
        <button aria-pressed={tab === 'closed'} onClick={() => setTab('closed')}>
          Decided
        </button>
        <button aria-pressed={tab === 'messages'} onClick={() => setTab('messages')}>
          Messages
        </button>
      </div>

      {tab === 'messages' ? (
        messages.isLoading ? (
          <Loading />
        ) : messages.data?.length ? (
          <div className="stack">
            {messages.data.map((m) => (
              <MessageCard key={m.id} m={m} />
            ))}
          </div>
        ) : (
          <Empty title="No messages." />
        )
      ) : reports.isLoading ? (
        <Loading />
      ) : reports.data?.length ? (
        <div className="stack">
          {reports.data.map((r) => (
            <ReportCard key={r.id} r={r} />
          ))}
        </div>
      ) : (
        <Empty title={tab === 'open' ? 'Nothing to decide. LORE is behaving.' : 'No decisions yet.'} />
      )}
    </>
  );
}

function ReportCard({ r }: { r: ModerationReport }) {
  const resolve = useAction((action: 'dismiss' | 'remove' | 'suspend') => api.post(`/admin/reports/${r.id}/resolve`, { action }));
  const unsuspend = useAction(() => api.post(`/admin/users/${r.subject!.id}/unsuspend`));
  const open = r.status === 'open';
  return (
    <article className="card stack mod-card">
      <div className="row">
        <span className="pill pill-danger">{REPORT_REASON_LABELS[r.reason]}</span>
        <span className="grow tiny muted">
          {r.targetType} · {timeAgo(r.createdAt)}
          {r.sameTarget > 0 && ` · ${r.sameTarget + 1} reports about this`}
        </span>
        {r.href && (
          <Link to={r.href} className="more" aria-label="Open what was reported">
            <ExternalLink size={15} />
          </Link>
        )}
      </div>
      {r.snapshot && <blockquote className="mod-snapshot">{r.snapshot}</blockquote>}
      {r.details && <p className="small">“{r.details}”</p>}
      <p className="tiny muted">
        Reported by {r.reporter ? `@${r.reporter.username}` : 'a former member'}
        {r.subject && (
          <>
            {' '}
            · about <Link to={`/u/${r.subject.username}`}>@{r.subject.username}</Link>
            {r.subject.suspended && <strong> (suspended)</strong>}
          </>
        )}
      </p>
      {open ? (
        <div className="row-wrap">
          <button className="btn btn-secondary btn-sm" disabled={resolve.isPending} onClick={() => resolve.mutate('dismiss')}>
            Nothing wrong
          </button>
          {r.targetType !== 'user' && (
            <button className="btn btn-secondary btn-sm" disabled={resolve.isPending} onClick={() => confirm('Take this down?') && resolve.mutate('remove')}>
              Take it down
            </button>
          )}
          {r.subject && !r.subject.suspended && (
            <button
              className="btn btn-danger btn-sm"
              disabled={resolve.isPending}
              onClick={() => confirm(`Suspend @${r.subject!.username}${r.targetType !== 'user' ? ' and take this down' : ''}?`) && resolve.mutate('suspend')}
            >
              Suspend
            </button>
          )}
        </div>
      ) : (
        <p className="small">
          <strong>{r.status === 'dismissed' ? 'Dismissed' : 'Acted on'}</strong> {r.resolvedAt && timeAgo(r.resolvedAt)}: {r.resolution}
          {r.subject?.suspended && (
            <button className="btn btn-ghost btn-sm" onClick={() => unsuspend.mutate(undefined)}>
              Lift suspension
            </button>
          )}
        </p>
      )}
      <ErrorNote error={resolve.error ?? unsuspend.error} />
    </article>
  );
}

function MessageCard({ m }: { m: SupportMessage }) {
  const handled = useAction(() => api.post(`/admin/support/${m.id}/handled`));
  return (
    <article className={`card stack mod-card${m.handledAt ? ' handled' : ''}`}>
      <div className="row">
        <span className="pill">{SUPPORT_TOPIC_LABELS[m.topic]}</span>
        <span className="grow tiny muted">
          {m.user ? `@${m.user.username}` : 'Not signed in'} · {timeAgo(m.createdAt)}
        </span>
      </div>
      <p style={{ whiteSpace: 'pre-wrap' }}>{m.body}</p>
      <div className="row-wrap">
        {m.replyTo && (
          <a className="btn btn-secondary btn-sm" href={`mailto:${m.replyTo}?subject=${encodeURIComponent('Re: your message to LORE')}`}>
            <Mail size={14} /> Reply to {m.replyTo}
          </a>
        )}
        {!m.handledAt ? (
          <button className="btn btn-ghost btn-sm" onClick={() => handled.mutate(undefined)} disabled={handled.isPending}>
            Mark answered
          </button>
        ) : (
          <span className="tiny muted">Answered</span>
        )}
      </div>
    </article>
  );
}
