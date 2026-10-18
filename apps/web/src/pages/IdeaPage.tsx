import { CalendarPlus, Coins, Hand, MapPin, Pencil, Sun } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { EVENT_CATEGORY_LABELS, type IdeaDetail } from '#shared';
import { CommentThread } from '../components/CommentThread.tsx';
import { CrewTag, EventCard } from '../components/cards.tsx';
import { AvatarStack, ErrorNote, Field, IdeaStatusPill, Loading, PageError, PrivacyBadge, Section, Sheet, TopBar } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { fromLocalInput, localTimeZone, toLocalInput } from '../lib/dates.ts';
import { useAction, useIdea } from '../lib/queries.ts';

export function IdeaPage() {
  const { id = '' } = useParams();
  const idea = useIdea(id);
  if (idea.isLoading) return <Loading />;
  if (idea.error || !idea.data) return <PageError error={idea.error} />;
  return <IdeaView idea={idea.data} />;
}

function IdeaView({ idea }: { idea: IdeaDetail }) {
  const navigate = useNavigate();
  const [converting, setConverting] = useState(false);
  const set = (d: IdeaDetail) => [['idea', d.id], d] as [string[], IdeaDetail];
  const interest = useAction(
    (on: boolean) => (on ? api.post<IdeaDetail>(`/ideas/${idea.id}/interest`) : api.del<IdeaDetail>(`/ideas/${idea.id}/interest`)),
    { set },
  );
  const remove = useAction(() => api.del(`/ideas/${idea.id}`), { onSuccess: () => navigate('/ideas', { replace: true }) });
  const cat = EVENT_CATEGORY_LABELS[idea.category];
  const notes = [
    idea.whereNote && { icon: MapPin, label: 'Where', text: idea.whereNote },
    idea.whenNote && { icon: Sun, label: 'When', text: idea.whenNote },
    idea.budgetNote && { icon: Coins, label: 'Budget', text: idea.budgetNote },
  ].filter(Boolean) as { icon: typeof MapPin; label: string; text: string }[];

  return (
    <>
      <TopBar
        back
        actions={
          idea.canEdit && (
            <Link to={`/ideas/${idea.id}/edit`} className="icon-btn" aria-label="Edit idea">
              <Pencil size={19} />
            </Link>
          )
        }
      />
      <div className="hero">
        <div className="kicker">
          <span className="eyebrow">
            {cat.emoji} Idea
          </span>
          <IdeaStatusPill status={idea.status} />
          <PrivacyBadge audience={idea.audience} crewName={idea.crew?.name} />
        </div>
        <h1>{idea.title}</h1>
        <div className="meta">
          {idea.createdBy && <span>Added by {idea.createdBy.displayName}</span>}
          {idea.crew && (
            <Link to={`/crews/${idea.crew.id}`}>
              <CrewTag crew={idea.crew} />
            </Link>
          )}
        </div>
      </div>

      {idea.description && <p style={{ whiteSpace: 'pre-wrap', marginTop: 14 }}>{idea.description}</p>}

      {notes.length > 0 && (
        <div className="card stack section" style={{ marginTop: 18 }}>
          {notes.map((n) => (
            <div key={n.label} className="row">
              <n.icon size={17} className="muted" />
              <span className="small muted" style={{ width: 64 }}>
                {n.label}
              </span>
              <span className="grow">{n.text}</span>
            </div>
          ))}
        </div>
      )}

      <div className="section stack" style={{ marginTop: 22 }}>
        <div className="row-wrap">
          <button
            className={`btn ${idea.iAmInterested ? 'btn-secondary' : 'btn-primary'}`}
            onClick={() => interest.mutate(!idea.iAmInterested)}
            disabled={interest.isPending}
          >
            <Hand size={17} /> {idea.iAmInterested ? 'You’re in' : 'I’m in'}
          </button>
          {idea.canEdit && (
            <button className="btn btn-secondary" onClick={() => setConverting(true)}>
              <CalendarPlus size={17} /> Make it happen
            </button>
          )}
        </div>
        {idea.interested.length > 0 && (
          <div className="row small">
            <AvatarStack users={idea.interested} />
            <span className="muted">
              {idea.interested.map((u) => u.displayName).join(', ')} {idea.interested.length === 1 ? 'is' : 'are'} in
            </span>
          </div>
        )}
        <ErrorNote error={interest.error} />
      </div>

      {idea.events.length > 0 && (
        <Section title="Plans made from this">
          <div className="stack">
            {idea.events.map((e) => (
              <EventCard key={e.id} event={e} />
            ))}
          </div>
        </Section>
      )}

      <Section title="Talk it over">
        <CommentThread kind="ideas" id={idea.id} placeholder="Thoughts, options, links…" />
      </Section>

      {idea.canEdit && (
        <div className="section" style={{ textAlign: 'center' }}>
          <button className="btn btn-ghost btn-sm" onClick={() => confirm('Delete this idea for everyone?') && remove.mutate(undefined)}>
            Delete idea
          </button>
        </div>
      )}

      {converting && <ConvertSheet idea={idea} onClose={() => setConverting(false)} />}
    </>
  );
}

function ConvertSheet({ idea, onClose }: { idea: IdeaDetail; onClose: () => void }) {
  const navigate = useNavigate();
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 7);
  tomorrow.setHours(18, 0, 0, 0);
  const [start, setStart] = useState(toLocalInput(tomorrow.toISOString()));
  const [end, setEnd] = useState('');
  const [title, setTitle] = useState(idea.title);
  const [inviteInterested, setInvite] = useState(true);
  const convert = useAction(
    () =>
      api.post<{ eventId: string }>(`/ideas/${idea.id}/convert`, {
        startsAt: fromLocalInput(start),
        endsAt: end ? fromLocalInput(end) : null,
        timeZone: localTimeZone(),
        title,
        inviteInterested,
      }),
    { onSuccess: (r) => navigate(`/events/${r.eventId}`) },
  );
  return (
    <Sheet title="Make it happen" onClose={onClose}>
      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          convert.mutate(undefined);
        }}
      >
        <p className="small muted">Everything the idea already knows comes along. You just pick when.</p>
        <Field label="Event name" htmlFor="ctitle">
          <input id="ctitle" className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} required />
        </Field>
        <div className="two-col">
          <Field label="Starts" htmlFor="cstart">
            <input id="cstart" className="input" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} required />
          </Field>
          <Field label="Ends" htmlFor="cend">
            <input id="cend" className="input" type="datetime-local" min={start} value={end} onChange={(e) => setEnd(e.target.value)} />
          </Field>
        </div>
        {idea.interested.length > 0 && (
          <label className="check">
            <input type="checkbox" checked={inviteInterested} onChange={(e) => setInvite(e.target.checked)} />
            Invite the {idea.interested.length} {idea.interested.length === 1 ? 'person' : 'people'} who said they’re in
          </label>
        )}
        <ErrorNote error={convert.error} />
        <button className="btn btn-primary btn-block" disabled={convert.isPending}>
          Create the event
        </button>
      </form>
    </Sheet>
  );
}
