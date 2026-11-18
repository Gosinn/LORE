import { Flag } from 'lucide-react';
import { useState } from 'react';
import { REPORT_REASON_LABELS, REPORT_REASONS, type ReportReason, type ReportTarget } from '#shared';
import { api } from '../lib/api.ts';
import { useAction, useMe } from '../lib/queries.ts';
import { ErrorNote, Sheet } from './ui.tsx';

// copy:table
const WHAT: Record<ReportTarget, string> = {
  user: 'this person',
  event: 'this plan',
  idea: 'this idea',
  chapter: 'this chapter',
  contribution: 'this',
  comment: 'this message',
};

/**
 * "Report": tell the people running LORE about something that breaks the Terms,
 * and optionally block whoever is behind it. Hidden on your own things.
 */
export function ReportButton({
  targetType,
  targetId,
  subject,
  variant = 'icon',
}: {
  targetType: ReportTarget;
  targetId: string;
  /** Who's behind it (null when unknown or a former member). */
  subject?: { id: string; displayName: string } | null;
  variant?: 'icon' | 'link' | 'button';
}) {
  const me = useMe();
  const [open, setOpen] = useState(false);
  if (subject && subject.id === me.data?.id) return null;

  const trigger =
    variant === 'icon' ? (
      <button className="btn btn-ghost btn-sm report-btn" aria-label={`Report ${WHAT[targetType]}`} onClick={() => setOpen(true)}>
        <Flag size={13} />
      </button>
    ) : variant === 'button' ? (
      <button className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}>
        <Flag size={14} /> Report
      </button>
    ) : (
      <button className="report-link" onClick={() => setOpen(true)}>
        <Flag size={13} /> Report {WHAT[targetType]}
      </button>
    );

  return (
    <>
      {trigger}
      {open && <ReportSheet targetType={targetType} targetId={targetId} subject={subject ?? null} onClose={() => setOpen(false)} />}
    </>
  );
}

function ReportSheet({
  targetType,
  targetId,
  subject,
  onClose,
}: {
  targetType: ReportTarget;
  targetId: string;
  subject: { id: string; displayName: string } | null;
  onClose: () => void;
}) {
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState('');
  const [block, setBlock] = useState(false);
  const send = useAction(() =>
    api.post<{ ok: true; blocked: boolean }>('/reports', {
      targetType,
      targetId,
      reason,
      details: details.trim() || undefined,
      block: subject ? block : undefined,
    }),
  );

  if (send.isSuccess) {
    return (
      <Sheet title="Thanks for telling us" onClose={onClose}>
        <div className="stack">
          <p>We’ll look at it within 24 hours. If it breaks the Terms, it comes down and the person behind it may be suspended.</p>
          {send.data.blocked && <p className="small muted">You’ve blocked {subject?.displayName}. You can undo that from their profile.</p>}
          <p className="small muted">
            If someone is in danger right now, call your local emergency number.
          </p>
          <button className="btn btn-primary btn-block" onClick={onClose}>
            Done
          </button>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet title={`Report ${WHAT[targetType]}`} onClose={onClose}>
      <div className="stack">
        <p className="small muted">What’s wrong? Only the people who run LORE see reports; nobody is told who sent it.</p>
        <div className="chips wrap" role="radiogroup" aria-label="Reason">
          {REPORT_REASONS.map((r) => (
            <button key={r} className="chip" role="radio" aria-checked={reason === r} aria-pressed={reason === r} onClick={() => setReason(r)}>
              {REPORT_REASON_LABELS[r]}
            </button>
          ))}
        </div>
        <textarea
          className="textarea"
          placeholder="Anything we should know? (optional)"
          maxLength={1000}
          value={details}
          onChange={(e) => setDetails(e.target.value)}
        />
        {subject && (
          <label className="row small check">
            <input type="checkbox" checked={block} onChange={(e) => setBlock(e.target.checked)} /> Also block {subject.displayName}
          </label>
        )}
        <ErrorNote error={send.error} />
        <button className="btn btn-primary btn-block" disabled={!reason || send.isPending} onClick={() => send.mutate(undefined)}>
          {send.isPending ? 'Sending…' : 'Send report'}
        </button>
      </div>
    </Sheet>
  );
}
