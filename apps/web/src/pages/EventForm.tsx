import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { EVENT_AUDIENCES, type EventCategory, type EventDetail } from '#shared';
import { AudiencePicker, CategoryPicker, CrewSelect, PeoplePicker } from '../components/pickers.tsx';
import { ErrorNote, Field, Loading, TopBar } from '../components/ui.tsx';
import { api, type ApiError } from '../lib/api.ts';
import { fromDateInput, fromLocalInput, localTimeZone, toLocalInput } from '../lib/dates.ts';
import { useAction, useEvent } from '../lib/queries.ts';

type EventAudience = (typeof EVENT_AUDIENCES)[number];

function defaultStart(date: string | null): string {
  const d = date ? new Date(`${date}T18:00`) : new Date();
  if (!date) {
    d.setDate(d.getDate() + 1);
    d.setHours(18, 0, 0, 0);
  }
  return toLocalInput(d.toISOString());
}

export function EventForm() {
  const { id } = useParams();
  const existing = useEvent(id ?? '');
  if (id && existing.isLoading) return <Loading />;
  return <EventFormInner key={id ?? 'new'} existing={id ? existing.data : undefined} />;
}

function EventFormInner({ existing }: { existing?: EventDetail }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [title, setTitle] = useState(existing?.title ?? params.get('title') ?? '');
  const [category, setCategory] = useState<EventCategory>(existing?.category ?? 'gathering');
  const [allDay, setAllDay] = useState(existing?.allDay ?? false);
  const [start, setStart] = useState(existing ? toLocalInput(existing.startsAt) : defaultStart(params.get('date')));
  const [end, setEnd] = useState(existing?.endsAt ? toLocalInput(existing.endsAt) : '');
  const [showEnd, setShowEnd] = useState(!!existing?.endsAt);
  const [locationName, setLocationName] = useState(existing?.locationName ?? '');
  const [crewId, setCrewId] = useState<string | null>(existing?.crew?.id ?? params.get('crewId'));
  const [audience, setAudience] = useState<EventAudience>(
    (existing?.audience as EventAudience) ?? (params.get('crewId') ? 'crew' : 'participants'),
  );
  const [invite, setInvite] = useState<string[]>([]);
  const [description, setDescription] = useState(existing?.description ?? '');
  const [capacity, setCapacity] = useState(existing?.capacity ? String(existing.capacity) : '');

  // Choosing a crew usually means "for the crew"; clearing it can't stay crew-only.
  useEffect(() => {
    if (!crewId && audience === 'crew') setAudience('participants');
  }, [crewId, audience]);

  const startDate = start.slice(0, 10);
  const save = useAction(
    async () => {
      const body = {
        title,
        category,
        allDay,
        startsAt: allDay ? fromDateInput(startDate) : fromLocalInput(start),
        endsAt: showEnd && end ? (allDay ? fromDateInput(end.slice(0, 10)) : fromLocalInput(end)) : null,
        timeZone: existing?.timeZone ?? localTimeZone(),
        locationName: locationName || null,
        crewId,
        audience,
        description: description || null,
        capacity: capacity ? Number(capacity) : null,
      };
      return existing
        ? api.patch<EventDetail>(`/events/${existing.id}`, body)
        : api.post<EventDetail>('/events', { ...body, inviteUserIds: invite });
    },
    { onSuccess: (event) => navigate(`/events/${event.id}`, { replace: true }) },
  );

  const fe = (save.error as ApiError | null)?.fields ?? {};
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate(undefined);
  };

  return (
    <>
      <TopBar back title={existing ? 'Edit event' : 'Plan something'} />
      <form className="form-grid" onSubmit={submit}>
        <input
          className="input input-title"
          placeholder="What’s the plan?"
          aria-label="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={120}
          required
          autoFocus={!existing}
        />
        <CategoryPicker value={category} onChange={setCategory} />

        <div className="card form-grid">
          <label className="check">
            <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} /> All day
          </label>
          <div className={showEnd ? 'two-col' : undefined}>
            <Field label="Starts" error={fe.startsAt} htmlFor="start">
              {allDay ? (
                <input id="start" className="input" type="date" value={startDate} onChange={(e) => setStart(`${e.target.value}T00:00`)} required />
              ) : (
                <input id="start" className="input" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} required />
              )}
            </Field>
            {showEnd && (
              <Field label="Ends" error={fe.endsAt} htmlFor="end">
                {allDay ? (
                  <input id="end" className="input" type="date" min={startDate} value={end.slice(0, 10)} onChange={(e) => setEnd(`${e.target.value}T00:00`)} />
                ) : (
                  <input id="end" className="input" type="datetime-local" min={start} value={end} onChange={(e) => setEnd(e.target.value)} />
                )}
              </Field>
            )}
          </div>
          {!showEnd && (
            <button type="button" className="btn btn-ghost btn-sm" style={{ justifySelf: 'start' }} onClick={() => setShowEnd(true)}>
              + Add an end
            </button>
          )}
          <Field label="Where" hint="A meeting point, an address, or just “the cabin”." htmlFor="where">
            <input id="where" className="input" value={locationName} onChange={(e) => setLocationName(e.target.value)} maxLength={200} />
          </Field>
        </div>

        <Field label="Crew" htmlFor="crew" error={fe.crewId}>
          <CrewSelect id="crew" value={crewId} onChange={(v) => {
            setCrewId(v);
            if (v) setAudience('crew');
          }} />
        </Field>

        <Field label="Who can see it">
          <AudiencePicker options={EVENT_AUDIENCES} value={audience} onChange={setAudience} hasCrew={!!crewId} />
        </Field>

        {!existing && (
          <Field label="Invite">
            <PeoplePicker crewId={crewId} selected={invite} onChange={setInvite} />
          </Field>
        )}

        <details className="more-options" open={!!existing?.description || !!existing?.capacity}>
          <summary>Details</summary>
          <div className="form-grid" style={{ marginTop: 14 }}>
            <Field label="Notes" hint="Plans, what to bring, anything people should know." htmlFor="desc">
              <textarea id="desc" className="textarea" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={4000} />
            </Field>
            <Field label="Spots" hint="Leave empty for no limit." htmlFor="cap">
              <input id="cap" className="input" type="number" min={1} max={10000} value={capacity} onChange={(e) => setCapacity(e.target.value)} />
            </Field>
          </div>
        </details>

        <ErrorNote error={Object.keys(fe).length ? null : save.error} />
        <div className="form-actions">
          <button type="button" className="btn btn-ghost" onClick={() => navigate(-1)}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={save.isPending || !title.trim()}>
            {save.isPending ? 'Saving…' : existing ? 'Save changes' : 'Create event'}
          </button>
        </div>
      </form>
    </>
  );
}

