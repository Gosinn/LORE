import { Feather, Plus } from 'lucide-react';
import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { LORACLE_LINES, fillLine, type Future, type OracleReading, type WishSummary } from '#shared';
import { ChapterCard, CrewChip, EventCard, IdeaCard } from '../components/cards.tsx';
import { CompassRose } from '../components/compass.tsx';
import { NoteItem, QuickNote } from '../components/notes.tsx';
import { StoneCircle } from '../components/oracle.tsx';
import { Empty, ErrorNote, Loading, PageError, Section, TopBar, Wordmark } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { fmtLongDay, fmtWhen, greeting } from '../lib/dates.ts';
import { useAction, useHome, useLoracle, useMe, useModerationSummary, useOracleSign } from '../lib/queries.ts';
import '../styles/sign.css';

export function HomePage() {
  const me = useMe();
  const home = useHome();
  useOracleSign(); // Ask for today's sign alongside Home: dealing it can take a moment.
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

      <div className="section" style={{ marginTop: 16 }}>
        <QuickNote />
      </div>

      {me.data?.isAdmin && <ModerationBanner />}

      <LoracleDoor />

      {h.reminders.length > 0 && (
        <Section title="Reminders" more={<Link to="/notes" className="more">All notes</Link>}>
          <div className="list">
            {h.reminders.map((n) => (
              <NoteItem key={n.id} note={n} />
            ))}
          </div>
        </Section>
      )}

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
        <CompassRose />
        <p className="serif">That’s everything. Go make some lore.</p>
      </footer>
    </>
  );
}

/** Under the newest quest's name on Home (kept small: the Loracle's own components load with its page). */
function teaserLine(w: WishSummary): string {
  switch (w.status) {
    case 'listening':
      return 'The stone is drawing your road.';
    case 'moon':
      return 'Written down. It will be read at the new moon.';
    case 'faded':
      return 'The fog won. Try again when you like.';
    case 'silent':
      return 'The stone was silent on this one.';
    case 'fulfilled':
      return 'It came true. It is lore now.';
    default:
      return w.total ? fillLine(LORACLE_LINES.inked, { inked: w.inked, total: w.total }) : LORACLE_LINES.teaserSub;
  }
}

/** The door's own words. */
const L = {
  signAsk: 'The stones showed this today. Will you choose it?',
  chosen: 'You chose it. The road is yours now.',
  whereLine: 'Where do you stand?',
  whereSub: 'Tell the stones, and each day they will show you one thing worth doing near you.',
  whereAction: 'Tell the stones',
} as const;

/** What the plain door says: the newest quest, or an invitation to tell the stones what you long for. */
function doorLines(newest: WishSummary | undefined, asleep: boolean): [string, string] {
  if (newest) return [newest.title ?? newest.text, teaserLine(newest)];
  return [LORACLE_LINES.teaser, asleep ? LORACLE_LINES.asleep : LORACLE_LINES.teaserSub];
}

/**
 * The Loracle door (the edge of the map; through the tear, the stones on the horizon). It carries
 * the stones' sign for today when there is one, and asks where you stand when the stones don't know
 * yet. Otherwise, and while today's sign is being dealt, it is the plain door into the circle.
 */
function LoracleDoor() {
  const sign = useOracleSign();
  const s = sign.data;
  // "Not this one" takes its button away while the keyboard is on it. The door that comes next (the
  // next sign's line, or the plain door) takes the focus instead, which also reads the new sign aloud.
  const waving = useRef(false);
  const focusTarget = useRef<HTMLElement | null>(null);
  const setFocusTarget = useCallback((el: HTMLElement | null) => {
    focusTarget.current = el;
  }, []);
  const onWaving = useCallback((on: boolean) => {
    waving.current = on;
  }, []);
  const shown = s && !s.home ? 'where' : s?.readingId && s.future ? `${s.readingId}:${s.future.index}` : 'plain';
  useEffect(() => {
    if (!waving.current) return;
    waving.current = false;
    focusTarget.current?.focus();
  }, [shown]);

  if (s && !s.home) {
    return (
      <DoorFrame line={L.whereLine} sub={L.whereSub} focusRef={setFocusTarget}>
        <Link to="/welcome/where" className="btn btn-primary btn-sm">
          {L.whereAction}
        </Link>
      </DoorFrame>
    );
  }
  if (s?.readingId && s.future) {
    return <DailySign key={shown} readingId={s.readingId} future={s.future} focusRef={setFocusTarget} onWaving={onWaving} />;
  }
  return <PlainDoor focusRef={setFocusTarget} />;
}

/** The whole door is the way in. */
function PlainDoor({ focusRef }: { focusRef: (el: HTMLElement | null) => void }) {
  const loracle = useLoracle();
  const [line, sub] = doorLines(loracle.data?.wishes[0], loracle.data?.mind === 'asleep');
  return (
    <Link to="/oracle" viewTransition className="loracle-door" ref={focusRef}>
      <span className="door-text">
        <span className="eyebrow">The Loracle</span>
        <strong className="door-line">{line}</strong>
        <span className="door-sub">{sub}</span>
        <span className="door-enter">Enter the circle</span>
      </span>
      <span className="door-sky" aria-hidden>
        <StoneCircle />
      </span>
    </Link>
  );
}

/** A door with something to answer: the buttons, then "Enter the circle" (the sky leads in too). */
function DoorFrame({
  line,
  meta,
  sub,
  error,
  focusRef,
  children,
}: {
  line: ReactNode;
  meta?: string;
  sub: string;
  error?: unknown;
  focusRef: (el: HTMLElement | null) => void;
  children: ReactNode;
}) {
  return (
    <section className="loracle-door door-sign">
      <div className="door-text">
        <span className="eyebrow">The Loracle</span>
        {/* Focusable from script only (LoracleDoor), never a tab stop. */}
        <strong className="door-line" tabIndex={-1} ref={focusRef}>
          {line}
        </strong>
        {meta && <span className="door-meta">{meta}</span>}
        <span className="door-sub">{sub}</span>
        <div className="door-actions">{children}</div>
        <ErrorNote error={error} />
        <Link to="/oracle" viewTransition className="door-enter">
          Enter the circle
        </Link>
      </div>
      <Link to="/oracle" viewTransition className="door-sky" aria-hidden tabIndex={-1}>
        <StoneCircle />
      </Link>
    </section>
  );
}

/** When it starts and where: "Tomorrow · 22:30 · Old Light, 52 km". */
const signMeta = (f: Future) =>
  [fmtWhen({ startsAt: f.startsAt, endsAt: null, allDay: false }), f.place && `${f.place.name}, ${f.place.distanceKm} km`]
    .filter(Boolean)
    .join(' · ');

/**
 * Today's sign. "Choose it" makes it a plan (yours alone: invite people from the plan) and opens it;
 * "Not this one" waves it away and the stones show the next, at most three a day.
 */
function DailySign({
  readingId,
  future,
  focusRef,
  onWaving,
}: {
  readingId: string;
  future: Future;
  focusRef: (el: HTMLElement | null) => void;
  onWaving: (on: boolean) => void;
}) {
  const navigate = useNavigate();
  const path = `/oracle/readings/${readingId}/futures/${future.index}`;
  const choose = useAction(() => api.post<OracleReading>(`${path}/choose`, { crewId: null }), {
    onSuccess: (reading) => {
      const eventId = reading.futures.find((f) => f.index === future.index)?.eventId;
      if (eventId) navigate(`/events/${eventId}`);
    },
  });
  const dismiss = useAction(() => api.post<OracleReading>(`${path}/dismiss`));
  const busy = choose.isPending || dismiss.isPending;
  const chosen = future.status === 'chosen' ? future.eventId : null;

  return (
    <DoorFrame
      line={
        <>
          <span className="door-emoji" aria-hidden>
            {future.emoji}
          </span>{' '}
          {future.title}
        </>
      }
      meta={signMeta(future)}
      sub={chosen ? L.chosen : L.signAsk}
      error={choose.error ?? dismiss.error}
      focusRef={focusRef}
    >
      {chosen ? (
        <Link to={`/events/${chosen}`} className="btn btn-primary btn-sm">
          Open the plan
        </Link>
      ) : (
        <>
          <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => choose.mutate(undefined)}>
            {choose.isPending ? 'Making it a plan…' : 'Choose it'}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={busy}
            onClick={() => {
              onWaving(true);
              dismiss.mutate(undefined, { onError: () => onWaving(false) });
            }}
          >
            Not this one
          </button>
        </>
      )}
    </DoorFrame>
  );
}

/** Moderators only: open reports are a 24-hour promise. */
function ModerationBanner() {
  const summary = useModerationSummary(true);
  const s = summary.data;
  if (!s || (!s.openReports && !s.openMessages)) return null;
  return (
    <Link to="/admin" className="banner section" style={{ marginTop: 18 }}>
      <span className="grow small">
        <strong>Moderation:</strong> {s.openReports} open {s.openReports === 1 ? 'report' : 'reports'}
        {s.openMessages ? `, ${s.openMessages} ${s.openMessages === 1 ? 'message' : 'messages'}` : ''}
      </span>
    </Link>
  );
}
