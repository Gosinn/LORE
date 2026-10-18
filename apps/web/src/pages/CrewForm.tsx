import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import type { CrewDetail } from '#shared';
import { ErrorNote, Field, Loading, TopBar } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { useAction, useCrew } from '../lib/queries.ts';

const EMOJI = ['🔥', '🏔️', '⛵', '🚐', '🍻', '🎲', '⚽', '🎸', '🌋', '🐺', '🦅', '🌊', '🏕️', '🎨', '🍕', '✨'];

export function CrewForm() {
  const { id } = useParams();
  const existing = useCrew(id);
  if (id && existing.isLoading) return <Loading />;
  return <CrewFormInner key={id ?? 'new'} existing={id ? existing.data : undefined} />;
}

function CrewFormInner({ existing }: { existing?: CrewDetail }) {
  const navigate = useNavigate();
  const [name, setName] = useState(existing?.name ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [emoji, setEmoji] = useState(existing?.emoji ?? '🔥');
  const [membersCanInvite, setMembersCanInvite] = useState(existing?.membersCanInvite ?? true);
  const save = useAction(
    () => {
      const body = { name, description: description || null, emoji, membersCanInvite };
      return existing ? api.patch<CrewDetail>(`/crews/${existing.id}`, body) : api.post<CrewDetail>('/crews', body);
    },
    { onSuccess: (c) => navigate(`/crews/${c.id}`, { replace: true }) },
  );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate(undefined);
  };
  return (
    <>
      <TopBar back title={existing ? 'Edit crew' : 'Start a crew'} />
      <form className="form-grid" onSubmit={submit}>
        <div className="row">
          <span className="crew-emoji crew-emoji-lg" aria-hidden>
            {emoji}
          </span>
          <input
            className="input input-title grow"
            placeholder="The Absolute Legends"
            aria-label="Crew name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
            required
            autoFocus={!existing}
          />
        </div>
        <Field label="Emblem">
          <div className="chips wrap">
            {EMOJI.map((e) => (
              <button type="button" key={e} className="chip" aria-pressed={emoji === e} onClick={() => setEmoji(e)} style={{ fontSize: 18 }}>
                {e}
              </button>
            ))}
          </div>
        </Field>
        <Field label="What’s this crew about?" htmlFor="desc">
          <textarea id="desc" className="textarea" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} />
        </Field>
        <label className="check">
          <input type="checkbox" checked={membersCanInvite} onChange={(e) => setMembersCanInvite(e.target.checked)} />
          Members can invite their friends
        </label>
        <p className="small muted">Crews are private. Nobody can find or see this crew unless they’re invited.</p>
        <ErrorNote error={save.error} />
        <div className="form-actions">
          <button type="button" className="btn btn-ghost" onClick={() => navigate(-1)}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={save.isPending || !name.trim()}>
            {existing ? 'Save' : 'Create crew'}
          </button>
        </div>
      </form>
    </>
  );
}
