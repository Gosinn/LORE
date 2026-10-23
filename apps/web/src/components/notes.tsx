import { BellRing, CalendarClock, Pin, PinOff, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import type { Note } from '#shared';
import { api } from '../lib/api.ts';
import { fmtWhen, fromLocalInput, toLocalInput } from '../lib/dates.ts';
import { useAction } from '../lib/queries.ts';
import { ensureReminderPermission } from '../lib/reminders.ts';
import { ErrorNote } from './ui.tsx';

interface QuickTime {
  label: string;
  at: () => Date;
}

function quickTimes(): QuickTime[] {
  const now = new Date();
  const at = (days: number, hour: number) => () => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    d.setHours(hour, 0, 0, 0);
    return d;
  };
  const options: QuickTime[] = [{ label: 'In 1 hour', at: () => new Date(Date.now() + 60 * 60 * 1000) }];
  if (now.getHours() < 19) options.push({ label: 'This evening', at: at(0, 20) });
  options.push({ label: 'Tomorrow 9:00', at: at(1, 9) });
  return options;
}

export const whenLabel = (iso: string) => fmtWhen({ startsAt: iso, endsAt: null, allDay: false });

/**
 * One box for everything: type and press enter for a note to self, or tap a time
 * first to make it a reminder.
 */
export function QuickNote({ autoFocus, placeholder = 'Note to self…' }: { autoFocus?: boolean; placeholder?: string }) {
  const [body, setBody] = useState('');
  const [remindAt, setRemindAt] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const times = useMemo(quickTimes, [body.length > 0]);

  const add = useAction(() => api.post<Note>('/notes', { body: body.trim(), remindAt }), {
    onSuccess: (note) => {
      setBody('');
      setRemindAt(null);
      setPicking(false);
      if (note.remindAt) void ensureReminderPermission();
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (body.trim()) add.mutate(undefined);
  };

  return (
    <form className="quick-note" onSubmit={submit}>
      <div className="row">
        <input
          className="input grow"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={placeholder}
          aria-label="Note to self"
          maxLength={2000}
          autoFocus={autoFocus}
        />
        <button className="btn btn-primary" style={{ minWidth: 46, padding: 0 }} disabled={!body.trim() || add.isPending} aria-label="Save note">
          <Plus size={20} />
        </button>
      </div>
      {(body.trim() || remindAt) && (
        <div className="chips" style={{ marginTop: 8 }}>
          <span className="tiny muted row" style={{ gap: 4, flex: 'none' }}>
            <BellRing size={13} /> Remind me
          </span>
          {times.map((t) => {
            const iso = t.at().toISOString();
            const on = !!remindAt && Math.abs(Date.parse(remindAt) - Date.parse(iso)) < 90_000;
            return (
              <button type="button" key={t.label} className="chip" aria-pressed={on} onClick={() => setRemindAt(on ? null : iso)}>
                {t.label}
              </button>
            );
          })}
          <button type="button" className="chip" aria-pressed={picking} onClick={() => setPicking(!picking)}>
            Pick…
          </button>
        </div>
      )}
      {picking && (
        <input
          className="input"
          type="datetime-local"
          style={{ marginTop: 8 }}
          aria-label="Reminder time"
          value={remindAt ? toLocalInput(remindAt) : ''}
          onChange={(e) => setRemindAt(e.target.value ? fromLocalInput(e.target.value) : null)}
        />
      )}
      {remindAt && <p className="tiny muted" style={{ marginTop: 6 }}>Reminder: {whenLabel(remindAt)}</p>}
      <ErrorNote error={add.error} />
    </form>
  );
}

export function NoteItem({ note }: { note: Note }) {
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(note.body);
  const update = useAction((patch: Record<string, unknown>) => api.patch<Note>(`/notes/${note.id}`, patch));
  const remove = useAction(() => api.del(`/notes/${note.id}`));
  const done = !!note.doneAt;
  const overdue = !done && !!note.remindAt && Date.parse(note.remindAt) < Date.now();

  const save = () => {
    setEditing(false);
    if (body.trim() && body.trim() !== note.body) update.mutate({ body: body.trim() });
    else setBody(note.body);
  };

  return (
    <div className={`note-row${done ? ' done' : ''}`}>
      <input
        type="checkbox"
        checked={done}
        onChange={(e) => update.mutate({ done: e.target.checked })}
        aria-label={done ? 'Mark as not done' : 'Mark as done'}
      />
      <div className="grow stack" style={{ gap: 2 }}>
        {editing ? (
          <input
            className="input"
            value={body}
            autoFocus
            maxLength={2000}
            onChange={(e) => setBody(e.target.value)}
            onBlur={save}
            onKeyDown={(e) => {
              if (e.key === 'Enter') save();
              if (e.key === 'Escape') {
                setBody(note.body);
                setEditing(false);
              }
            }}
          />
        ) : (
          <button className="note-body" onClick={() => !done && setEditing(true)} title="Edit">
            {note.body}
          </button>
        )}
        {(note.remindAt || note.event) && (
          <span className="meta">
            {note.remindAt && (
              <span className={overdue ? 'pill pill-ember' : undefined}>
                <BellRing size={12} /> {overdue ? 'Due · ' : ''}
                {whenLabel(note.remindAt)}
              </span>
            )}
            {note.event && (
              <Link to={`/events/${note.event.id}`}>
                <CalendarClock size={12} /> {note.event.title}
              </Link>
            )}
          </span>
        )}
      </div>
      {!done && !note.remindAt && (
        <button className="icon-btn" style={{ width: 34, height: 34 }} onClick={() => update.mutate({ pinned: !note.pinned })} aria-label={note.pinned ? 'Unpin' : 'Pin'}>
          {note.pinned ? <PinOff size={16} /> : <Pin size={16} />}
        </button>
      )}
      <button className="icon-btn" style={{ width: 34, height: 34 }} onClick={() => remove.mutate(undefined)} aria-label="Delete">
        <Trash2 size={16} />
      </button>
    </div>
  );
}
