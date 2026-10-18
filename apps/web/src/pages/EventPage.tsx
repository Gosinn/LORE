import { BookOpen, CalendarClock, Feather, Lightbulb, MapPin, Pencil, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { EVENT_CATEGORY_LABELS, type ChapterDetail, type EventDetail, type EventParticipant, type RsvpStatus } from '#shared';
import { CommentThread } from '../components/CommentThread.tsx';
import { CrewTag } from '../components/cards.tsx';
import { PeoplePicker } from '../components/pickers.tsx';
import { Avatar, ErrorNote, EventStatusPill, Loading, PageError, Person, PrivacyBadge, Section, Sheet, TopBar } from '../components/ui.tsx';
import { api, ApiError } from '../lib/api.ts';
import { fmtWhen } from '../lib/dates.ts';
import { useAction, useEvent, useMe } from '../lib/queries.ts';

export function EventPage() {
  const { id = '' } = useParams();
  const event = useEvent(id);
  if (event.isLoading) return <Loading />;
  if (event.error || !event.data) return <PageError error={event.error} />;
  return <EventView event={event.data} />;
}

function EventView({ event: e }: { event: EventDetail }) {
  const me = useMe();
  const navigate = useNavigate();
  const [inviting, setInviting] = useState(false);
  const setDetail = (d: EventDetail) => [['event', d.id], d] as [string[], EventDetail];

  const rsvp = useAction((status: Exclude<RsvpStatus, 'invited'>) => api.post<EventDetail>(`/events/${e.id}/rsvp`, { status }), { set: setDetail });
  const setStatus = useAction((status: string) => api.post<EventDetail>(`/events/${e.id}/status`, { status }), { set: setDetail });
  const writeChapter = useAction(() => api.post<ChapterDetail>(`/events/${e.id}/chapter`), {
    onSuccess: (c) => navigate(`/chapters/${c.id}`),
  });
  const leave = useAction(() => api.del(`/events/${e.id}/participants/${me.data!.id}`), { onSuccess: () => navigate('/') });

  const cat = EVENT_CATEGORY_LABELS[e.category];
  const happened = new Date(e.startsAt).getTime() < Date.now();
  const tookPart = e.myRole === 'organizer' || e.myRsvp === 'going';
  const canWriteChapter = !e.chapterId && tookPart && happened && e.status !== 'canceled';
  const existingChapterId = (writeChapter.error as ApiError | null)?.fields?.chapterId;

  const groups: [string, EventParticipant[]][] = [
    ['Going', e.participants.filter((p) => p.rsvp === 'going')],
    ['Maybe', e.participants.filter((p) => p.rsvp === 'maybe')],
    ['Invited', e.participants.filter((p) => p.rsvp === 'invited')],
    ["Can't make it", e.participants.filter((p) => p.rsvp === 'declined')],
  ];

  return (
    <>
      <TopBar
        back
        actions={
          e.canEdit && (
            <Link to={`/events/${e.id}/edit`} className="icon-btn" aria-label="Edit event">
              <Pencil size={19} />
            </Link>
          )
        }
      />

      <div className="hero">
        <div className="kicker">
          <span className="eyebrow">
            {cat.emoji} {cat.label}
          </span>
          <EventStatusPill status={e.status} />
          <PrivacyBadge audience={e.audience} crewName={e.crew?.name} />
        </div>
        <h1>{e.title}</h1>
        <div className="meta" style={{ fontSize: 15 }}>
          <span>
            <CalendarClock size={15} /> {fmtWhen(e)}
          </span>
          {e.locationName && (
            <span>
              <MapPin size={15} /> {e.locationName}
            </span>
          )}
          {e.crew && (
            <Link to={`/crews/${e.crew.id}`}>
              <CrewTag crew={e.crew} />
            </Link>
          )}
        </div>
        {e.ideaId && (
          <Link to={`/ideas/${e.ideaId}`} className="small muted row" style={{ gap: 6 }}>
            <Lightbulb size={14} /> Started as an idea in the vault
          </Link>
        )}
      </div>

      {e.canRsvp && (
        <div className="section" style={{ marginTop: 18 }}>
          <div className="seg" role="group" aria-label="Your answer">
            <button className="going" aria-pressed={e.myRsvp === 'going'} onClick={() => rsvp.mutate('going')} disabled={rsvp.isPending}>
              I’m in
            </button>
            <button aria-pressed={e.myRsvp === 'maybe'} onClick={() => rsvp.mutate('maybe')} disabled={rsvp.isPending}>
              Maybe
            </button>
            <button aria-pressed={e.myRsvp === 'declined'} onClick={() => rsvp.mutate('declined')} disabled={rsvp.isPending}>
              Not this time
            </button>
          </div>
          <ErrorNote error={rsvp.error} />
          {e.capacity && (
            <p className="tiny muted" style={{ marginTop: 6, textAlign: 'center' }}>
              {e.goingCount} of {e.capacity} spots taken
            </p>
          )}
        </div>
      )}

      {e.chapterId && (
        <Link to={`/chapters/${e.chapterId}`} className="card card-link row section" style={{ marginTop: 18, background: 'var(--gold-soft)', borderColor: 'transparent' }}>
          <BookOpen size={22} style={{ color: 'var(--gold)' }} />
          <span className="grow">
            <strong className="serif" style={{ fontSize: 18 }}>
              Read the chapter
            </strong>
            <span className="small muted" style={{ display: 'block' }}>
              This one made it into the Lorebook.
            </span>
          </span>
        </Link>
      )}

      {canWriteChapter && (
        <div className="card section stack" style={{ marginTop: 18 }}>
          <div className="row">
            <Feather size={22} style={{ color: 'var(--gold)' }} />
            <strong className="serif grow" style={{ fontSize: 18 }}>
              How did it go?
            </strong>
          </div>
          <p className="small muted">Start the chapter. Everyone who went can add their side of the story, quotes and photos.</p>
          <button className="btn btn-primary" onClick={() => writeChapter.mutate(undefined)} disabled={writeChapter.isPending}>
            Create Lore chapter
          </button>
          {existingChapterId ? (
            <Link to={`/chapters/${existingChapterId}`} className="btn btn-secondary btn-sm">
              Open the existing chapter
            </Link>
          ) : (
            <ErrorNote error={writeChapter.error} />
          )}
        </div>
      )}

      {e.canEdit && e.status !== 'completed' && e.status !== 'canceled' && (
        <div className="row-wrap section" style={{ marginTop: 18 }}>
          {(e.status === 'proposed' || e.status === 'planning') && (
            <button className="btn btn-secondary btn-sm" onClick={() => setStatus.mutate('confirmed')}>
              It’s happening
            </button>
          )}
          {happened && (
            <button className="btn btn-secondary btn-sm" onClick={() => setStatus.mutate('completed')}>
              Mark as done
            </button>
          )}
          {e.status !== 'postponed' && (
            <button className="btn btn-ghost btn-sm" onClick={() => setStatus.mutate('postponed')}>
              Postpone
            </button>
          )}
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => confirm('Cancel this event? Everyone taking part will be told.') && setStatus.mutate('canceled')}
          >
            Cancel event
          </button>
          <ErrorNote error={setStatus.error} />
        </div>
      )}
      {e.canEdit && e.status === 'canceled' && (
        <button className="btn btn-secondary btn-sm section" onClick={() => setStatus.mutate('planning')}>
          Un-cancel
        </button>
      )}

      {e.description && (
        <Section title="Notes">
          <p style={{ whiteSpace: 'pre-wrap' }}>{e.description}</p>
        </Section>
      )}

      <Section
        title={`People · ${e.goingCount} going`}
        more={
          e.canEdit &&
          e.canRsvp && (
            <button className="more btn btn-ghost btn-sm" onClick={() => setInviting(true)}>
              <UserPlus size={15} /> Invite
            </button>
          )
        }
      >
        <div className="stack">
          {groups.map(([label, people]) =>
            people.length ? (
              <div key={label} className="stack" style={{ gap: 6 }}>
                <span className="tiny muted" style={{ fontWeight: 700 }}>
                  {label} ({people.length})
                </span>
                {people.map((p) => (
                  <ParticipantRow key={p.user.id} event={e} p={p} />
                ))}
              </div>
            ) : null,
          )}
        </div>
      </Section>

      {(tookPart || e.myRsvp === 'maybe' || e.checklist.length > 0) && <Checklist event={e} canEdit={!!e.myRsvp && e.myRsvp !== 'declined'} />}

      <Section title="Discussion">
        <CommentThread kind="events" id={e.id} placeholder="Ask, plan, coordinate…" />
      </Section>

      {e.myRsvp && !(e.myRole === 'organizer' && e.participants.filter((p) => p.role === 'organizer').length === 1) && (
        <div className="section" style={{ textAlign: 'center' }}>
          <button className="btn btn-ghost btn-sm" onClick={() => confirm('Leave this event?') && leave.mutate(undefined)}>
            Leave event
          </button>
          <ErrorNote error={leave.error} />
        </div>
      )}

      {inviting && <InviteSheet event={e} onClose={() => setInviting(false)} />}
    </>
  );
}

function ParticipantRow({ event, p }: { event: EventDetail; p: EventParticipant }) {
  const me = useMe();
  const setDetail = (d: EventDetail) => [['event', d.id], d] as [string[], EventDetail];
  const organizer = useAction(
    (on: boolean) => api.put<EventDetail>(`/events/${event.id}/participants/${p.user.id}/organizer`, { organizer: on }),
    { set: setDetail },
  );
  const remove = useAction(() => api.del(`/events/${event.id}/participants/${p.user.id}`));
  const isMe = p.user.id === me.data?.id;
  return (
    <div className="spread">
      <Person user={p.user} sub={p.role === 'organizer' ? 'Organizer' : isMe ? 'You' : undefined} />
      {event.canEdit && !isMe && (
        <span className="row" style={{ gap: 4 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => organizer.mutate(p.role !== 'organizer')}>
            {p.role === 'organizer' ? 'Unmake organizer' : 'Make organizer'}
          </button>
          {p.role !== 'organizer' && (
            <button className="btn btn-ghost btn-sm" onClick={() => confirm(`Remove ${p.user.displayName}?`) && remove.mutate(undefined)}>
              Remove
            </button>
          )}
        </span>
      )}
    </div>
  );
}

function Checklist({ event, canEdit }: { event: EventDetail; canEdit: boolean }) {
  const me = useMe();
  const [text, setText] = useState('');
  const setDetail = (d: EventDetail) => [['event', d.id], d] as [string[], EventDetail];
  const add = useAction((t: string) => api.post<EventDetail>(`/events/${event.id}/checklist`, { text: t }), {
    set: setDetail,
    onSuccess: () => setText(''),
  });
  const update = useAction(
    ({ itemId, ...body }: { itemId: string; done?: boolean; assigneeId?: string | null }) =>
      api.patch<EventDetail>(`/events/${event.id}/checklist/${itemId}`, body),
    { set: setDetail },
  );
  const remove = useAction((itemId: string) => api.del<EventDetail>(`/events/${event.id}/checklist/${itemId}`), { set: setDetail });
  const done = event.checklist.filter((i) => i.done).length;

  return (
    <Section title={`Packing list${event.checklist.length ? ` · ${done}/${event.checklist.length}` : ''}`}>
      <div className="list">
        {event.checklist.map((item) => (
          <div key={item.id} className={`checklist-item${item.done ? ' done' : ''}`}>
            <input
              type="checkbox"
              aria-label={item.text}
              checked={item.done}
              disabled={!canEdit}
              onChange={(ev) => update.mutate({ itemId: item.id, done: ev.target.checked })}
              style={{ width: 20, height: 20, accentColor: 'var(--ember)' }}
            />
            <span className="text grow">{item.text}</span>
            {item.assignee ? (
              <button
                className="btn btn-ghost btn-sm"
                title={`${item.assignee.displayName} is on it`}
                disabled={!canEdit}
                onClick={() => item.assignee?.id === me.data?.id && update.mutate({ itemId: item.id, assigneeId: null })}
              >
                <Avatar user={item.assignee} size="sm" />
              </button>
            ) : (
              canEdit && (
                <button className="btn btn-ghost btn-sm" onClick={() => update.mutate({ itemId: item.id, assigneeId: me.data!.id })}>
                  I’ll bring it
                </button>
              )
            )}
            {canEdit && (item.createdById === me.data?.id || event.canEdit) && (
              <button className="btn btn-ghost btn-sm" aria-label={`Remove ${item.text}`} onClick={() => remove.mutate(item.id)}>
                ✕
              </button>
            )}
          </div>
        ))}
      </div>
      {canEdit && (
        <form
          className="row"
          style={{ marginTop: 10 }}
          onSubmit={(ev) => {
            ev.preventDefault();
            if (text.trim()) add.mutate(text.trim());
          }}
        >
          <input className="input grow" placeholder="Add something to bring…" value={text} onChange={(ev) => setText(ev.target.value)} maxLength={200} />
          <button className="btn btn-secondary" disabled={!text.trim()}>
            Add
          </button>
        </form>
      )}
    </Section>
  );
}

function InviteSheet({ event, onClose }: { event: EventDetail; onClose: () => void }) {
  const [selected, setSelected] = useState<string[]>([]);
  const invite = useAction(() => api.post<EventDetail>(`/events/${event.id}/invites`, { userIds: selected }), {
    set: (d) => [['event', d.id], d],
    onSuccess: onClose,
  });
  return (
    <Sheet title="Invite people" onClose={onClose}>
      <div className="stack-lg">
        <PeoplePicker crewId={event.crew?.id ?? null} selected={selected} onChange={setSelected} exclude={event.participants.map((p) => p.user.id)} />
        <ErrorNote error={invite.error} />
        <button className="btn btn-primary btn-block" disabled={!selected.length || invite.isPending} onClick={() => invite.mutate(undefined)}>
          Invite {selected.length || ''}
        </button>
      </div>
    </Sheet>
  );
}
