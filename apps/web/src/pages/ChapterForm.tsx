import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { CHAPTER_AUDIENCES, type ChapterDetail } from '#shared';
import { AudiencePicker, CrewSelect, PeoplePicker } from '../components/pickers.tsx';
import { ErrorNote, Field, Loading, TopBar } from '../components/ui.tsx';
import { api, type ApiError } from '../lib/api.ts';
import { todayISO } from '../lib/dates.ts';
import { useAction, useChapter } from '../lib/queries.ts';

type ChapterAudience = (typeof CHAPTER_AUDIENCES)[number];

export function ChapterForm() {
  const { id } = useParams();
  const existing = useChapter(id ?? '');
  if (id && existing.isLoading) return <Loading />;
  return <ChapterFormInner key={id ?? 'new'} existing={id ? existing.data : undefined} />;
}

function ChapterFormInner({ existing }: { existing?: ChapterDetail }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [title, setTitle] = useState(existing?.title ?? '');
  const [summary, setSummary] = useState(existing?.summary ?? '');
  const [occurredOn, setOccurredOn] = useState(existing?.occurredOn ?? todayISO());
  const [endedOn, setEndedOn] = useState(existing?.endedOn ?? '');
  const [locationName, setLocation] = useState(existing?.locationName ?? '');
  const [crewId, setCrewId] = useState<string | null>(existing?.crew?.id ?? params.get('crewId'));
  const [audience, setAudience] = useState<ChapterAudience>(
    (existing?.audience as ChapterAudience) ?? (params.get('crewId') ? 'crew' : 'participants'),
  );
  const [people, setPeople] = useState<string[]>([]);

  useEffect(() => {
    if (!crewId && audience === 'crew') setAudience('participants');
  }, [crewId, audience]);

  const save = useAction(
    () => {
      const body = {
        title,
        summary: summary || null,
        occurredOn,
        endedOn: endedOn || null,
        locationName: locationName || null,
        crewId,
        audience,
      };
      return existing
        ? api.patch<ChapterDetail>(`/chapters/${existing.id}`, body)
        : api.post<ChapterDetail>('/chapters', { ...body, peopleIds: people });
    },
    { onSuccess: (c) => navigate(`/chapters/${c.id}`, { replace: true }) },
  );
  const fe = (save.error as ApiError | null)?.fields ?? {};
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate(undefined);
  };

  return (
    <>
      <TopBar back title={existing ? 'Edit chapter' : 'Write a chapter'} />
      <form className="form-grid" onSubmit={submit}>
        {!existing && (
          <p className="muted small">
            For something that already happened: last weekend, or that summer ten years ago. The people you add can tell
            their side too.
          </p>
        )}
        <input
          className="input input-title"
          placeholder="The time we…"
          aria-label="Chapter title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={120}
          required
          autoFocus={!existing}
        />
        <div className="two-col">
          <Field label="When it happened" error={fe.occurredOn} htmlFor="on">
            <input id="on" className="input" type="date" value={occurredOn} max={todayISO()} onChange={(e) => setOccurredOn(e.target.value)} required />
          </Field>
          <Field label="Until (optional)" error={fe.endedOn} htmlFor="until">
            <input id="until" className="input" type="date" min={occurredOn} value={endedOn} onChange={(e) => setEndedOn(e.target.value)} />
          </Field>
        </div>
        <Field label="Where" htmlFor="where">
          <input id="where" className="input" value={locationName} onChange={(e) => setLocation(e.target.value)} maxLength={200} />
        </Field>
        <Field label="In a few words" hint="Optional. Everyone can add their full story on the chapter page." htmlFor="summary">
          <textarea id="summary" className="textarea" value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={4000} />
        </Field>
        <Field label="Crew" htmlFor="crew" error={fe.crewId}>
          <CrewSelect id="crew" value={crewId} onChange={(v) => {
            setCrewId(v);
            if (v) setAudience('crew');
          }} />
        </Field>
        {!existing && (
          <Field label="Who was there">
            <PeoplePicker crewId={crewId} selected={people} onChange={setPeople} />
          </Field>
        )}
        <Field label="Who can read it">
          <AudiencePicker options={CHAPTER_AUDIENCES} value={audience} onChange={setAudience} hasCrew={!!crewId} />
        </Field>
        <ErrorNote error={Object.keys(fe).length ? null : save.error} />
        <div className="form-actions">
          <button type="button" className="btn btn-ghost" onClick={() => navigate(-1)}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={save.isPending || !title.trim()}>
            {existing ? 'Save changes' : 'Add to the Lorebook'}
          </button>
        </div>
      </form>
    </>
  );
}
