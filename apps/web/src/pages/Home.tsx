import { Compass, Feather, Plus } from 'lucide-react';
import { Link } from 'react-router';
import { ChapterCard, CrewChip, EventCard, IdeaCard } from '../components/cards.tsx';
import { Empty, Loading, PageError, Section, TopBar, Wordmark } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { fmtLongDay, greeting } from '../lib/dates.ts';
import { useAction, useHome, useMe } from '../lib/queries.ts';

export function HomePage() {
  const me = useMe();
  const home = useHome();
  const acceptCrew = useAction((crewId: string) => api.post(`/crews/${crewId}/accept`));
  const declineCrew = useAction((crewId: string) => api.post(`/crews/${crewId}/leave`));

  if (home.isLoading) return <Loading />;
  if (home.error || !home.data) return <PageError error={home.error} />;
  const h = home.data;
  const firstName = me.data?.displayName.split(' ')[0];
  const nothingPlanned = !h.invitations.length && !h.comingUp.length && !h.continuePlanning.length;

  return (
    <>
      <TopBar title={<Wordmark tag={false} />} />

      <div className="hero" style={{ paddingTop: 0 }}>
        <span className="eyebrow">{fmtLongDay(new Date())}</span>
        <p className="greeting">
          {greeting()}, <em>{firstName}</em>.
        </p>
      </div>

      {h.crewInvites.map((c) => (
        <div className="banner section" key={c.id} style={{ marginTop: 18 }}>
          <span className="crew-emoji">{c.emoji}</span>
          <span className="grow small">
            You’re invited to join <strong>{c.name}</strong>.
          </span>
          <button className="btn btn-primary btn-sm" onClick={() => acceptCrew.mutate(c.id)}>
            Join
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => declineCrew.mutate(c.id)}>
            No thanks
          </button>
        </div>
      ))}

      {/* What is happening? */}
      {h.invitations.length > 0 && (
        <Section title="Needs your answer">
          <div className="stack">
            {h.invitations.map((e) => (
              <EventCard key={e.id} event={e} />
            ))}
          </div>
        </Section>
      )}

      <Section title="Coming up" more={<Link to="/calendar" className="more">Calendar</Link>}>
        {h.comingUp.length ? (
          <div className="stack">
            {h.comingUp.map((e) => (
              <EventCard key={e.id} event={e} />
            ))}
          </div>
        ) : nothingPlanned ? (
          <Empty title="Nothing on the horizon. That’s a plot hook.">
            <div className="row-wrap">
              <Link to="/events/new" className="btn btn-primary btn-sm">
                <Plus size={16} /> Plan something
              </Link>
              <Link to="/ideas/new" className="btn btn-secondary btn-sm">
                Save an idea
              </Link>
            </div>
          </Empty>
        ) : (
          <p className="small muted">Nothing confirmed yet.</p>
        )}
      </Section>

      {h.continuePlanning.length > 0 && (
        <Section title="Still being planned">
          <div className="stack">
            {h.continuePlanning.map((e) => (
              <EventCard key={e.id} event={e} note="You’re organizing" />
            ))}
          </div>
        </Section>
      )}

      {h.toDocument.length > 0 && (
        <Section title="Write it down while it’s fresh">
          <div className="stack">
            {h.toDocument.map((e) => (
              <Link key={e.id} to={`/events/${e.id}`} className="card card-link row">
                <Feather size={20} style={{ color: 'var(--gold)', flex: 'none' }} />
                <span className="grow">
                  <span className="event-title" style={{ display: 'block' }}>
                    {e.title}
                  </span>
                  <span className="small muted">Start the chapter so everyone can add their side.</span>
                </span>
              </Link>
            ))}
          </div>
        </Section>
      )}

      {/* What could we do? */}
      <Section title="Your crews" more={<Link to="/crews/new" className="more">New crew</Link>}>
        {h.crews.length ? (
          <div className="chips">
            {h.crews.map((c) => (
              <CrewChip key={c.id} crew={c} />
            ))}
          </div>
        ) : (
          <Empty title="Crews are the people you make lore with.">
            <Link to="/crews/new" className="btn btn-secondary btn-sm">
              Start a crew
            </Link>
          </Empty>
        )}
      </Section>

      <Section title="Ideas worth doing" more={<Link to="/ideas" className="more">Idea Vault</Link>}>
        {h.ideas.length ? (
          <div className="stack">
            {h.ideas.map((i) => (
              <IdeaCard key={i.id} idea={i} />
            ))}
          </div>
        ) : (
          <Empty title="Got a someday-we-should? Put it in the vault before the group chat forgets it.">
            <Link to="/ideas/new" className="btn btn-secondary btn-sm">
              Add an idea
            </Link>
          </Empty>
        )}
      </Section>

      {/* What should I remember? */}
      {h.onThisDay.length > 0 && (
        <Section title="On this day">
          <div className="stack">
            {h.onThisDay.map((c) => (
              <ChapterCard key={c.id} chapter={c} showYearsAgo />
            ))}
          </div>
        </Section>
      )}

      <Section title="Recent lore" more={<Link to="/lorebook" className="more">Lorebook</Link>}>
        {h.recentLore.length ? (
          <div className="stack">
            {h.recentLore.map((c) => (
              <ChapterCard key={c.id} chapter={c} />
            ))}
          </div>
        ) : (
          <Empty title="Your Lorebook is waiting for its first chapter.">
            <Link to="/chapters/new" className="btn btn-secondary btn-sm">
              Write a memory
            </Link>
          </Empty>
        )}
      </Section>

      <footer className="the-end">
        <Compass size={22} />
        <p className="serif">That’s everything. Go make some lore.</p>
      </footer>
    </>
  );
}
