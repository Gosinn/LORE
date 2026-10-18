import { ChevronLeft, ChevronRight, Lock, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import type { EventSummary, PersonalEntry } from '#shared';
import { EventCard } from '../components/cards.tsx';
import { Empty, ErrorNote, Field, Section, Sheet, TopBar } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { dateKey, fmtLongDay, fmtMonthYear, fmtTime, fromDateInput, fromLocalInput, todayISO, toLocalInput } from '../lib/dates.ts';
import { useAction, useEvents, usePersonal } from '../lib/queries.ts';

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function monthGrid(month: Date): Date[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7; // Monday-first weeks
  const start = new Date(first);
  start.setDate(first.getDate() - offset);
  return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
}

/** Every calendar day an event or entry touches, so multi-day plans mark each day. */
function daysTouched(item: { startsAt: string; endsAt: string | null }): string[] {
  const start = new Date(item.startsAt);
  const end = item.endsAt ? new Date(item.endsAt) : start;
  const days: string[] = [];
  const d = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  while (d <= end && days.length < 62) {
    days.push(todayISO(d));
    d.setDate(d.getDate() + 1);
  }
  return days.length ? days : [dateKey(item.startsAt)];
}

export function CalendarPage() {
  const [view, setView] = useState<'month' | 'agenda'>('month');
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [selected, setSelected] = useState(todayISO());
  const [showLore, setShowLore] = useState(true);
  const [showPersonal, setShowPersonal] = useState(true);
  const [editing, setEditing] = useState<PersonalEntry | 'new' | null>(null);

  const grid = useMemo(() => monthGrid(month), [month]);
  const range = useMemo(() => {
    if (view === 'agenda') {
      const from = new Date();
      from.setHours(0, 0, 0, 0);
      const to = new Date(from);
      to.setDate(to.getDate() + 45);
      return { from: from.toISOString(), to: to.toISOString() };
    }
    const to = new Date(grid[41]!);
    to.setDate(to.getDate() + 1);
    return { from: grid[0]!.toISOString(), to: to.toISOString() };
  }, [grid, view]);

  const events = useEvents(range.from, range.to);
  const personal = usePersonal(range.from, range.to, showPersonal);

  const byDay = useMemo(() => {
    const map = new Map<string, { events: EventSummary[]; personal: PersonalEntry[] }>();
    const slot = (k: string) => map.get(k) ?? map.set(k, { events: [], personal: [] }).get(k)!;
    if (showLore) for (const e of events.data ?? []) for (const k of daysTouched(e)) slot(k).events.push(e);
    if (showPersonal) for (const p of personal.data ?? []) for (const k of daysTouched(p)) slot(k).personal.push(p);
    return map;
  }, [events.data, personal.data, showLore, showPersonal]);

  const shift = (n: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1));
  const today = todayISO();
  const day = byDay.get(selected);

  return (
    <>
      <TopBar title="Calendar" />
      <div className="spread" style={{ marginBottom: 14 }}>
        <div className="tabs" role="tablist" style={{ flex: 'none' }}>
          <button role="tab" aria-selected={view === 'month'} onClick={() => setView('month')} style={{ padding: '0 16px' }}>
            Month
          </button>
          <button role="tab" aria-selected={view === 'agenda'} onClick={() => setView('agenda')} style={{ padding: '0 16px' }}>
            Agenda
          </button>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <button className="chip" aria-pressed={showLore} onClick={() => setShowLore(!showLore)}>
            LORE
          </button>
          <button className="chip" aria-pressed={showPersonal} onClick={() => setShowPersonal(!showPersonal)}>
            <Lock size={13} /> Mine
          </button>
        </div>
      </div>

      {view === 'month' ? (
        <>
          <div className="month-head">
            <h2>{fmtMonthYear(month)}</h2>
            <button className="icon-btn" aria-label="Previous month" onClick={() => shift(-1)}>
              <ChevronLeft size={20} />
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
                setSelected(today);
              }}
            >
              Today
            </button>
            <button className="icon-btn" aria-label="Next month" onClick={() => shift(1)}>
              <ChevronRight size={20} />
            </button>
          </div>
          <div className="month-grid" style={{ marginTop: 8 }}>
            {DOW.map((d) => (
              <span key={d} className="dow">
                {d}
              </span>
            ))}
            {grid.map((d) => {
              const key = todayISO(d);
              const items = byDay.get(key);
              const cls = ['day', d.getMonth() !== month.getMonth() && 'out', key === today && 'today', key === selected && 'selected']
                .filter(Boolean)
                .join(' ');
              return (
                <button key={key} className={cls} onClick={() => setSelected(key)} aria-label={fmtLongDay(d)} aria-pressed={key === selected}>
                  <span className="num">{d.getDate()}</span>
                  <span className="dots">
                    {items?.events.slice(0, 3).map((e) => <i key={e.id} />)}
                    {items?.personal.slice(0, 2).map((p) => <i key={p.id} className="personal" />)}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="legend" style={{ marginTop: 10 }}>
            <span>
              <i /> Shared plans
            </span>
            <span>
              <i className="personal" /> Personal (only you)
            </span>
          </div>

          <Section title={fmtLongDay(new Date(`${selected}T12:00`))}>
            <DayAgenda date={selected} events={day?.events ?? []} personal={day?.personal ?? []} onEdit={setEditing} />
          </Section>
        </>
      ) : (
        <Agenda byDay={byDay} onEdit={setEditing} />
      )}

      <ErrorNote error={events.error ?? personal.error} />
      {editing && <PersonalSheet entry={editing === 'new' ? null : editing} date={selected} onClose={() => setEditing(null)} />}
    </>
  );
}

function DayAgenda({
  date,
  events,
  personal,
  onEdit,
}: {
  date: string;
  events: EventSummary[];
  personal: PersonalEntry[];
  onEdit: (e: PersonalEntry | 'new') => void;
}) {
  return (
    <div className="stack">
      {personal.map((p) => (
        <PersonalRow key={p.id} entry={p} onEdit={onEdit} />
      ))}
      {events.map((e) => (
        <EventCard key={e.id} event={e} />
      ))}
      {!events.length && !personal.length && <p className="small muted">Nothing planned. Wide open.</p>}
      <div className="row-wrap" style={{ marginTop: 4 }}>
        <Link to={`/events/new?date=${date}`} className="btn btn-primary btn-sm">
          <Plus size={15} /> Plan something
        </Link>
        <button className="btn btn-secondary btn-sm" onClick={() => onEdit('new')}>
          <Lock size={14} /> Add a personal entry
        </button>
      </div>
    </div>
  );
}

function Agenda({
  byDay,
  onEdit,
}: {
  byDay: Map<string, { events: EventSummary[]; personal: PersonalEntry[] }>;
  onEdit: (e: PersonalEntry | 'new') => void;
}) {
  const days = [...byDay.keys()].filter((k) => k >= todayISO()).sort();
  if (!days.length) {
    return (
      <Empty title="The next six weeks are wide open.">
        <Link to="/events/new" className="btn btn-primary btn-sm">
          Plan something
        </Link>
      </Empty>
    );
  }
  return (
    <>
      {days.map((k) => {
        const d = byDay.get(k)!;
        return (
          <Section key={k} title={fmtLongDay(new Date(`${k}T12:00`))}>
            <div className="stack">
              {d.personal.map((p) => (
                <PersonalRow key={p.id} entry={p} onEdit={onEdit} />
              ))}
              {d.events.map((e) => (
                <EventCard key={e.id} event={e} />
              ))}
            </div>
          </Section>
        );
      })}
    </>
  );
}

function PersonalRow({ entry, onEdit }: { entry: PersonalEntry; onEdit: (e: PersonalEntry) => void }) {
  return (
    <button className="personal-row" onClick={() => onEdit(entry)} style={{ border: 0, textAlign: 'left', cursor: 'pointer', width: '100%' }}>
      <span className="time">{entry.allDay ? 'All day' : fmtTime(entry.startsAt)}</span>
      <span className="grow">
        <strong>{entry.title}</strong>
        {entry.notes && (
          <span className="tiny muted ellipsis" style={{ display: 'block' }}>
            {entry.notes}
          </span>
        )}
      </span>
      <Lock size={14} className="muted" aria-label="Private" />
    </button>
  );
}

function PersonalSheet({ entry, date, onClose }: { entry: PersonalEntry | null; date: string; onClose: () => void }) {
  const [title, setTitle] = useState(entry?.title ?? '');
  const [allDay, setAllDay] = useState(entry?.allDay ?? false);
  const [start, setStart] = useState(entry ? toLocalInput(entry.startsAt) : `${date}T09:00`);
  const [end, setEnd] = useState(entry?.endsAt ? toLocalInput(entry.endsAt) : '');
  const [notes, setNotes] = useState(entry?.notes ?? '');

  const save = useAction(
    () => {
      const body = {
        title,
        allDay,
        startsAt: allDay ? fromDateInput(start.slice(0, 10)) : fromLocalInput(start),
        endsAt: end ? (allDay ? fromDateInput(end.slice(0, 10)) : fromLocalInput(end)) : null,
        notes: notes || null,
      };
      return entry ? api.put(`/personal/${entry.id}`, body) : api.post('/personal', body);
    },
    { onSuccess: onClose },
  );
  const remove = useAction(() => api.del(`/personal/${entry!.id}`), { onSuccess: onClose });

  return (
    <Sheet title={entry ? 'Personal entry' : 'Add to your calendar'} onClose={onClose}>
      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(undefined);
        }}
      >
        <p className="small muted row" style={{ gap: 6 }}>
          <Lock size={14} /> Only you can see this. It never shows up in shared calendars.
        </p>
        <Field label="What" htmlFor="ptitle">
          <input id="ptitle" className="input" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={120} autoFocus />
        </Field>
        <label className="check">
          <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} /> All day
        </label>
        <div className="two-col">
          <Field label="Starts" htmlFor="pstart">
            <input
              id="pstart"
              className="input"
              type={allDay ? 'date' : 'datetime-local'}
              value={allDay ? start.slice(0, 10) : start}
              onChange={(e) => setStart(allDay ? `${e.target.value}T00:00` : e.target.value)}
              required
            />
          </Field>
          <Field label="Ends" htmlFor="pend">
            <input
              id="pend"
              className="input"
              type={allDay ? 'date' : 'datetime-local'}
              value={allDay ? end.slice(0, 10) : end}
              onChange={(e) => setEnd(allDay ? `${e.target.value}T00:00` : e.target.value)}
            />
          </Field>
        </div>
        <Field label="Notes" htmlFor="pnotes">
          <textarea id="pnotes" className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} style={{ minHeight: 70 }} />
        </Field>
        <ErrorNote error={save.error ?? remove.error} />
        <div className="form-actions">
          {entry && (
            <button type="button" className="btn btn-danger" onClick={() => remove.mutate(undefined)} style={{ marginRight: 'auto' }}>
              Delete
            </button>
          )}
          <button className="btn btn-primary" disabled={!title.trim() || save.isPending}>
            Save
          </button>
        </div>
      </form>
    </Sheet>
  );
}
