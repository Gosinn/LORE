import { Feather, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import type { ChapterSummary } from '#shared';
import { ChapterCard } from '../components/cards.tsx';
import { Empty, Loading, TopBar } from '../components/ui.tsx';
import { yearOf } from '../lib/dates.ts';
import { useChapters, useCrews } from '../lib/queries.ts';

export function Lorebook() {
  const [params, setParams] = useSearchParams();
  const crewId = params.get('crewId') ?? undefined;
  const year = params.get('year') ? Number(params.get('year')) : undefined;
  const [search, setSearch] = useState(params.get('q') ?? '');
  const [q, setQ] = useState(search);
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const chapters = useChapters({ crewId, year, q: q || undefined });
  const allYears = useChapters({ crewId });
  const crews = useCrews();
  const activeCrews = (crews.data ?? []).filter((c) => c.myStatus === 'active');

  const years = useMemo(() => [...new Set((allYears.data ?? []).map((c) => yearOf(c.occurredOn)))], [allYears.data]);
  const grouped = useMemo(() => {
    const map = new Map<string, ChapterSummary[]>();
    for (const c of chapters.data ?? []) {
      const y = yearOf(c.occurredOn);
      map.set(y, [...(map.get(y) ?? []), c]);
    }
    return [...map];
  }, [chapters.data]);

  const update = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) v ? next.set(k, v) : next.delete(k);
    setParams(next, { replace: true });
  };

  return (
    <>
      <TopBar
        title="Lorebook"
        actions={
          <Link to="/chapters/new" className="btn btn-primary btn-sm">
            <Feather size={15} /> Write
          </Link>
        }
      />

      <div className="stack" style={{ marginBottom: 6 }}>
        <label className="row input" style={{ gap: 8, paddingTop: 0, paddingBottom: 0 }}>
          <Search size={17} className="muted" />
          <input
            className="grow"
            style={{ border: 0, outline: 0, background: 'transparent', minHeight: 44 }}
            placeholder="Search your history: places, quotes, stories…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search the Lorebook"
          />
        </label>
        {activeCrews.length > 0 && (
          <div className="chips">
            <button className="chip" aria-pressed={!crewId} onClick={() => update({ crewId: undefined })}>
              All my lore
            </button>
            {activeCrews.map((c) => (
              <button key={c.id} className="chip" aria-pressed={crewId === c.id} onClick={() => update({ crewId: c.id, year: undefined })}>
                {c.emoji} {c.name}
              </button>
            ))}
          </div>
        )}
        {years.length > 1 && (
          <div className="chips">
            <button className="chip" aria-pressed={!year} onClick={() => update({ year: undefined })}>
              Every year
            </button>
            {years.map((y) => (
              <button key={y} className="chip" aria-pressed={year === Number(y)} onClick={() => update({ year: y })}>
                {y}
              </button>
            ))}
          </div>
        )}
      </div>

      {chapters.isLoading ? (
        <Loading />
      ) : grouped.length === 0 ? (
        q || year || crewId ? (
          <Empty title="No chapters match that." />
        ) : (
          <Empty title="Every crew has a story. This is where yours gets written down.">
            <p className="small muted">
              Finish an event and turn it into a chapter, or write down something that happened long before LORE.
            </p>
            <Link to="/chapters/new" className="btn btn-secondary btn-sm">
              Write the first chapter
            </Link>
          </Empty>
        )
      ) : (
        <div className="timeline" style={{ marginTop: 16 }}>
          {grouped.map(([y, list]) => (
            <div key={y}>
              <h2 className="timeline-year">{y}</h2>
              {list.map((c) => (
                <div key={c.id} className="timeline-item">
                  <ChapterCard chapter={c} />
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
      {grouped.length > 0 && (
        <footer className="the-end">
          <p className="serif">The story so far.</p>
        </footer>
      )}
    </>
  );
}
