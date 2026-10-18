import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { IdeaCard } from '../components/cards.tsx';
import { Empty, Loading, Section, TopBar } from '../components/ui.tsx';
import { useCrews, useIdeas } from '../lib/queries.ts';

export function IdeaVault() {
  const [params, setParams] = useSearchParams();
  const crewId = params.get('crewId') ?? undefined;
  const [archived, setArchived] = useState(false);
  const ideas = useIdeas(crewId, archived);
  const crews = useCrews();
  const activeCrews = (crews.data ?? []).filter((c) => c.myStatus === 'active');

  const list = ideas.data ?? [];
  const open = list.filter((i) => ['dreaming', 'gathering_interest', 'planning'].includes(i.status));
  const scheduled = list.filter((i) => i.status === 'scheduled');
  const done = list.filter((i) => i.status === 'completed' || i.status === 'archived');

  return (
    <>
      <TopBar
        back
        title="Idea Vault"
        actions={
          <Link to={`/ideas/new${crewId ? `?crewId=${crewId}` : ''}`} className="btn btn-primary btn-sm">
            <Plus size={16} /> Idea
          </Link>
        }
      />
      <p className="muted small" style={{ marginBottom: 14 }}>
        Things worth doing someday. No dates, no pressure, just not forgotten.
      </p>
      <div className="chips" style={{ marginBottom: 8 }}>
        <button className="chip" aria-pressed={!crewId} onClick={() => setParams({})}>
          Everything
        </button>
        {activeCrews.map((c) => (
          <button key={c.id} className="chip" aria-pressed={crewId === c.id} onClick={() => setParams({ crewId: c.id })}>
            {c.emoji} {c.name}
          </button>
        ))}
      </div>

      {ideas.isLoading ? (
        <Loading />
      ) : list.length === 0 ? (
        <Empty title="The vault is empty. What have you always said you’d do?">
          <Link to={`/ideas/new${crewId ? `?crewId=${crewId}` : ''}`} className="btn btn-secondary btn-sm">
            Add the first idea
          </Link>
        </Empty>
      ) : (
        <>
          {open.length > 0 && (
            <Section title="Open">
              <div className="stack">
                {open.map((i) => (
                  <IdeaCard key={i.id} idea={i} />
                ))}
              </div>
            </Section>
          )}
          {scheduled.length > 0 && (
            <Section title="Happening">
              <div className="stack">
                {scheduled.map((i) => (
                  <IdeaCard key={i.id} idea={i} />
                ))}
              </div>
            </Section>
          )}
          {done.length > 0 && (
            <Section title="Done">
              <div className="stack">
                {done.map((i) => (
                  <IdeaCard key={i.id} idea={i} />
                ))}
              </div>
            </Section>
          )}
        </>
      )}
      <div className="section" style={{ textAlign: 'center' }}>
        <button className="btn btn-ghost btn-sm" onClick={() => setArchived(!archived)}>
          {archived ? 'Hide archived ideas' : 'Show archived ideas'}
        </button>
      </div>
    </>
  );
}
