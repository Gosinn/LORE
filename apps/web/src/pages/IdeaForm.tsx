import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { IDEA_AUDIENCES, IDEA_STATUSES, IDEA_STATUS_LABELS, type EventCategory, type IdeaDetail, type IdeaStatus } from '#shared';
import { AudiencePicker, CategoryPicker, CrewSelect } from '../components/pickers.tsx';
import { ErrorNote, Field, Loading, TopBar } from '../components/ui.tsx';
import { api, type ApiError } from '../lib/api.ts';
import { useAction, useIdea } from '../lib/queries.ts';

type IdeaAudience = (typeof IDEA_AUDIENCES)[number];

export function IdeaForm() {
  const { id } = useParams();
  const existing = useIdea(id ?? '');
  if (id && existing.isLoading) return <Loading />;
  return <IdeaFormInner key={id ?? 'new'} existing={id ? existing.data : undefined} />;
}

function IdeaFormInner({ existing }: { existing?: IdeaDetail }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [title, setTitle] = useState(existing?.title ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [category, setCategory] = useState<EventCategory>(existing?.category ?? 'custom');
  const [crewId, setCrewId] = useState<string | null>(existing?.crew?.id ?? params.get('crewId'));
  const [audience, setAudience] = useState<IdeaAudience>(
    (existing?.audience as IdeaAudience) ?? (params.get('crewId') ? 'crew' : 'only_me'),
  );
  const [status, setStatus] = useState<IdeaStatus>(existing?.status ?? 'dreaming');
  const [whereNote, setWhere] = useState(existing?.whereNote ?? '');
  const [whenNote, setWhen] = useState(existing?.whenNote ?? '');
  const [budgetNote, setBudget] = useState(existing?.budgetNote ?? '');

  useEffect(() => {
    if (!crewId && audience === 'crew') setAudience('only_me');
  }, [crewId, audience]);

  const save = useAction(
    () => {
      const body = {
        title,
        description: description || null,
        category,
        crewId,
        audience,
        whereNote: whereNote || null,
        whenNote: whenNote || null,
        budgetNote: budgetNote || null,
      };
      return existing
        ? api.patch<IdeaDetail>(`/ideas/${existing.id}`, { ...body, status })
        : api.post<IdeaDetail>('/ideas', body);
    },
    { onSuccess: (idea) => navigate(`/ideas/${idea.id}`, { replace: true }) },
  );
  const fe = (save.error as ApiError | null)?.fields ?? {};
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate(undefined);
  };

  return (
    <>
      <TopBar back title={existing ? 'Edit idea' : 'Save an idea'} />
      <form className="form-grid" onSubmit={submit}>
        <input
          className="input input-title"
          placeholder="We should…"
          aria-label="The idea"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={120}
          required
          autoFocus={!existing}
        />
        <CategoryPicker value={category} onChange={setCategory} />
        <Field label="Tell people more" htmlFor="desc">
          <textarea id="desc" className="textarea" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={4000} />
        </Field>
        <div className="card form-grid">
          <Field label="Where" hint="A destination, or a few options." htmlFor="where">
            <input id="where" className="input" value={whereNote} onChange={(e) => setWhere(e.target.value)} maxLength={200} />
          </Field>
          <div className="two-col">
            <Field label="Best time" hint="“Winter”, “a long weekend”…" htmlFor="when">
              <input id="when" className="input" value={whenNote} onChange={(e) => setWhen(e.target.value)} maxLength={200} />
            </Field>
            <Field label="Rough budget" htmlFor="budget">
              <input id="budget" className="input" value={budgetNote} onChange={(e) => setBudget(e.target.value)} maxLength={200} />
            </Field>
          </div>
        </div>
        <Field label="Crew" htmlFor="crew" error={fe.crewId}>
          <CrewSelect id="crew" value={crewId} onChange={(v) => {
            setCrewId(v);
            if (v) setAudience('crew');
          }} />
        </Field>
        <Field label="Who can see it">
          <AudiencePicker options={IDEA_AUDIENCES} value={audience} onChange={setAudience} hasCrew={!!crewId} />
        </Field>
        {existing && (
          <Field label="Status">
            <div className="chips wrap">
              {IDEA_STATUSES.map((s) => (
                <button type="button" key={s} className="chip" aria-pressed={status === s} onClick={() => setStatus(s)}>
                  {IDEA_STATUS_LABELS[s]}
                </button>
              ))}
            </div>
          </Field>
        )}
        <ErrorNote error={Object.keys(fe).length ? null : save.error} />
        <div className="form-actions">
          <button type="button" className="btn btn-ghost" onClick={() => navigate(-1)}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={save.isPending || !title.trim()}>
            {existing ? 'Save changes' : 'Put it in the vault'}
          </button>
        </div>
      </form>
    </>
  );
}
