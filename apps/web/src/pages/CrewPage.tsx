import { Feather, Lightbulb, Pencil, Plus, UserPlus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { CREW_ROLE_LABELS, type CrewDetail, type CrewMember } from '#shared';
import { ChapterCard, EventCard, IdeaCard } from '../components/cards.tsx';
import { PeoplePicker } from '../components/pickers.tsx';
import { Empty, ErrorNote, Loading, PageError, Person, Section, Sheet, TopBar } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { useAction, useChapters, useCrew, useEvents, useIdeas, useMe } from '../lib/queries.ts';

export function CrewPage() {
  const { id = '' } = useParams();
  const crew = useCrew(id);
  if (crew.isLoading) return <Loading />;
  if (crew.error || !crew.data) return <PageError error={crew.error} />;
  return <CrewView crew={crew.data} />;
}

const setCrew = (d: CrewDetail) => [['crew', d.id], d] as [string[], CrewDetail];

function CrewView({ crew }: { crew: CrewDetail }) {
  const navigate = useNavigate();
  const [inviting, setInviting] = useState(false);
  const active = crew.myStatus === 'active';
  const accept = useAction(() => api.post<CrewDetail>(`/crews/${crew.id}/accept`), { set: setCrew });
  const leave = useAction(() => api.post(`/crews/${crew.id}/leave`), { onSuccess: () => navigate('/', { replace: true }) });

  return (
    <>
      <TopBar
        back
        actions={
          crew.canManage && (
            <Link to={`/crews/${crew.id}/edit`} className="icon-btn" aria-label="Edit crew">
              <Pencil size={19} />
            </Link>
          )
        }
      />
      <div className="hero row" style={{ alignItems: 'center', gap: 16 }}>
        <span className="crew-emoji crew-emoji-lg">{crew.emoji}</span>
        <div className="grow stack" style={{ gap: 4 }}>
          <h1 style={{ fontSize: 30 }}>{crew.name}</h1>
          <span className="small muted">
            {crew.memberCount} {crew.memberCount === 1 ? 'member' : 'members'} · Private crew
          </span>
        </div>
      </div>
      {crew.description && <p style={{ marginTop: 8, whiteSpace: 'pre-wrap' }}>{crew.description}</p>}

      {crew.myStatus === 'invited' && (
        <div className="banner section" style={{ marginTop: 18 }}>
          <span className="grow small">You’ve been invited to join this crew.</span>
          <button className="btn btn-primary btn-sm" onClick={() => accept.mutate(undefined)}>
            Join
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => leave.mutate(undefined)}>
            Decline
          </button>
        </div>
      )}

      {active && <CrewWorkspace crew={crew} />}

      <Section
        title="Members"
        more={
          crew.canInvite && (
            <button className="more btn btn-ghost btn-sm" onClick={() => setInviting(true)}>
              <UserPlus size={15} /> Invite
            </button>
          )
        }
      >
        <div className="stack">
          {crew.members.map((m) => (
            <MemberRow key={m.user.id} crew={crew} m={m} />
          ))}
        </div>
      </Section>

      {active && crew.myRole !== 'owner' && (
        <div className="section" style={{ textAlign: 'center' }}>
          <button className="btn btn-ghost btn-sm" onClick={() => confirm(`Leave ${crew.name}?`) && leave.mutate(undefined)}>
            Leave crew
          </button>
          <ErrorNote error={leave.error} />
        </div>
      )}
      {inviting && <InviteSheet crew={crew} onClose={() => setInviting(false)} />}
    </>
  );
}

function CrewWorkspace({ crew }: { crew: CrewDetail }) {
  const range = useMemo(() => {
    const from = new Date();
    from.setHours(0, 0, 0, 0);
    const to = new Date(from);
    to.setMonth(to.getMonth() + 6);
    return { from: from.toISOString(), to: to.toISOString() };
  }, []);
  const events = useEvents(range.from, range.to, crew.id);
  const ideas = useIdeas(crew.id);
  const chapters = useChapters({ crewId: crew.id });
  const upcoming = (events.data ?? []).filter((e) => e.status !== 'canceled').slice(0, 5);
  const openIdeas = (ideas.data ?? []).filter((i) => ['dreaming', 'gathering_interest', 'planning'].includes(i.status)).slice(0, 4);
  const lore = (chapters.data ?? []).slice(0, 4);

  return (
    <>
      <div className="row-wrap section" style={{ marginTop: 18 }}>
        <Link to={`/events/new?crewId=${crew.id}`} className="btn btn-primary btn-sm">
          <Plus size={15} /> Plan something
        </Link>
        <Link to={`/ideas/new?crewId=${crew.id}`} className="btn btn-secondary btn-sm">
          <Lightbulb size={15} /> Idea
        </Link>
        <Link to={`/chapters/new?crewId=${crew.id}`} className="btn btn-secondary btn-sm">
          <Feather size={15} /> Chapter
        </Link>
      </div>

      <Section title="Coming up">
        {upcoming.length ? (
          <div className="stack">
            {upcoming.map((e) => (
              <EventCard key={e.id} event={e} />
            ))}
          </div>
        ) : (
          <p className="small muted">Nothing on the crew calendar yet.</p>
        )}
      </Section>

      <Section title="Crew Idea Vault" more={<Link to={`/ideas?crewId=${crew.id}`} className="more">All ideas</Link>}>
        {openIdeas.length ? (
          <div className="stack">
            {openIdeas.map((i) => (
              <IdeaCard key={i.id} idea={i} />
            ))}
          </div>
        ) : (
          <Empty title="No ideas in the vault. Somebody say “we should…”." />
        )}
      </Section>

      <Section title="Crew Lorebook" more={<Link to={`/lorebook?crewId=${crew.id}`} className="more">All chapters</Link>}>
        {lore.length ? (
          <div className="stack">
            {lore.map((c) => (
              <ChapterCard key={c.id} chapter={c} />
            ))}
          </div>
        ) : (
          <p className="small muted">The crew’s history starts with its first chapter.</p>
        )}
      </Section>
    </>
  );
}

function MemberRow({ crew, m }: { crew: CrewDetail; m: CrewMember }) {
  const me = useMe();
  const setRole = useAction((role: 'admin' | 'member') => api.patch<CrewDetail>(`/crews/${crew.id}/members/${m.user.id}`, { role }), { set: setCrew });
  const remove = useAction(() => api.del<CrewDetail>(`/crews/${crew.id}/members/${m.user.id}`), { set: setCrew });
  const isMe = m.user.id === me.data?.id;
  const sub = m.status === 'invited' ? 'Invited' : `${CREW_ROLE_LABELS[m.role]}${isMe ? ' · You' : ''}`;
  const canRemove = crew.canManage && !isMe && m.role !== 'owner' && (m.role !== 'admin' || crew.myRole === 'owner');
  return (
    <div className="spread">
      <Person user={m.user} sub={sub} />
      <span className="row" style={{ gap: 4 }}>
        {crew.myRole === 'owner' && !isMe && m.status === 'active' && m.role !== 'owner' && (
          <button className="btn btn-ghost btn-sm" onClick={() => setRole.mutate(m.role === 'admin' ? 'member' : 'admin')}>
            {m.role === 'admin' ? 'Make member' : 'Make admin'}
          </button>
        )}
        {canRemove && (
          <button className="btn btn-ghost btn-sm" onClick={() => confirm(`Remove ${m.user.displayName} from the crew?`) && remove.mutate(undefined)}>
            Remove
          </button>
        )}
      </span>
    </div>
  );
}

function InviteSheet({ crew, onClose }: { crew: CrewDetail; onClose: () => void }) {
  const [selected, setSelected] = useState<string[]>([]);
  const invite = useAction(() => api.post<CrewDetail>(`/crews/${crew.id}/invites`, { userIds: selected }), { set: setCrew, onSuccess: onClose });
  return (
    <Sheet title={`Invite to ${crew.name}`} onClose={onClose}>
      <div className="stack-lg">
        <p className="small muted">You can invite your friends. Add friends from your profile first if they aren’t listed.</p>
        <PeoplePicker crewId={null} selected={selected} onChange={setSelected} exclude={crew.members.map((m) => m.user.id)} />
        <ErrorNote error={invite.error} />
        <button className="btn btn-primary btn-block" disabled={!selected.length || invite.isPending} onClick={() => invite.mutate(undefined)}>
          Send invites
        </button>
      </div>
    </Sheet>
  );
}
