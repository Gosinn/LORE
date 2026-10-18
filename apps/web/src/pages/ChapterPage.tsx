import { CalendarClock, ImagePlus, MapPin, Pencil, Quote, Trash2, UserPlus } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import type { ChapterDetail, Contribution, MediaRef } from '#shared';
import { CommentThread } from '../components/CommentThread.tsx';
import { CrewTag } from '../components/cards.tsx';
import { PeoplePicker } from '../components/pickers.tsx';
import { Avatar, AvatarStack, ErrorNote, Field, Loading, PageError, PrivacyBadge, Section, Sheet, TopBar } from '../components/ui.tsx';
import { api, mediaSrc } from '../lib/api.ts';
import { fmtChapterDate, timeAgo } from '../lib/dates.ts';
import { prepareImage } from '../lib/images.ts';
import { useAction, useChapter, useMe } from '../lib/queries.ts';

export function ChapterPage() {
  const { id = '' } = useParams();
  const chapter = useChapter(id);
  if (chapter.isLoading) return <Loading />;
  if (chapter.error || !chapter.data) return <PageError error={chapter.error} />;
  return <ChapterView c={chapter.data} />;
}

const setChapter = (d: ChapterDetail) => [['chapter', d.id], d] as [string[], ChapterDetail];

function ChapterView({ c }: { c: ChapterDetail }) {
  const me = useMe();
  const navigate = useNavigate();
  const [adding, setAdding] = useState(false);
  const [lightbox, setLightbox] = useState<MediaRef | null>(null);
  const photos = c.contributions.filter((x) => x.type === 'photo' && x.media);
  const accounts = c.contributions.filter((x) => x.type !== 'photo');
  const leave = useAction(() => api.del(`/chapters/${c.id}/people/${me.data!.id}`), { onSuccess: () => navigate('/lorebook') });
  const remove = useAction(() => api.del(`/chapters/${c.id}`), { onSuccess: () => navigate('/lorebook', { replace: true }) });
  const setCover = useAction((mediaId: string) => api.patch<ChapterDetail>(`/chapters/${c.id}`, { coverMediaId: mediaId }), {
    set: setChapter,
    onSuccess: () => setLightbox(null),
  });

  return (
    <>
      <TopBar
        back
        actions={
          c.canEdit && (
            <Link to={`/chapters/${c.id}/edit`} className="icon-btn" aria-label="Edit chapter">
              <Pencil size={19} />
            </Link>
          )
        }
      />

      {c.cover && (
        <div className="chapter-hero">
          <img src={mediaSrc(c.cover.url)} alt="" />
        </div>
      )}

      <div className="hero" style={{ marginTop: c.cover ? 16 : 0 }}>
        <div className="kicker">
          <span className="chapter-date">{fmtChapterDate(c.occurredOn, c.endedOn)}</span>
          <PrivacyBadge audience={c.audience} crewName={c.crew?.name} />
        </div>
        <h1>{c.title}</h1>
        <div className="meta" style={{ fontSize: 15 }}>
          {c.locationName && (
            <span>
              <MapPin size={15} /> {c.locationName}
            </span>
          )}
          {c.crew && (
            <Link to={`/crews/${c.crew.id}`}>
              <CrewTag crew={c.crew} />
            </Link>
          )}
          {c.event && (
            <Link to={`/events/${c.event.id}`}>
              <span>
                <CalendarClock size={15} /> The plan
              </span>
            </Link>
          )}
        </div>
        {c.summary && (
          <p className="story" style={{ marginTop: 6 }}>
            {c.summary}
          </p>
        )}
      </div>

      <div className="section row" style={{ marginTop: 18 }}>
        <AvatarStack users={c.people.map((p) => p.user)} max={7} />
        <span className="small muted grow">
          {c.people.length === 1 ? '1 person' : `${c.people.length} people`} in this chapter
        </span>
        {c.canEdit && (
          <button className="btn btn-ghost btn-sm" onClick={() => setAdding(true)}>
            <UserPlus size={15} /> Add
          </button>
        )}
      </div>

      {photos.length > 0 && (
        <Section title={`Photos · ${photos.length}`}>
          <div className="photo-grid">
            {photos.map((p) => (
              <figure key={p.id} className="photo" onClick={() => setLightbox(p.media)}>
                <img src={mediaSrc(p.media!.url)} alt={p.caption ?? `Photo by ${p.author.displayName}`} loading="lazy" />
                {p.caption && <figcaption>{p.caption}</figcaption>}
              </figure>
            ))}
          </div>
        </Section>
      )}

      <Section title="Everyone’s side of the story">
        {accounts.length === 0 && photos.length === 0 && (
          <p className="muted small" style={{ marginBottom: 12 }}>
            Nothing written yet. Every account counts. They don’t have to agree.
          </p>
        )}
        <div className="stack-lg">
          {accounts.map((x) => (
            <ContributionView key={x.id} chapterId={c.id} x={x} />
          ))}
        </div>
      </Section>

      {c.canContribute && <Composer chapter={c} />}

      <Section title="Comments">
        <CommentThread kind="chapters" id={c.id} placeholder="Remember when…" />
      </Section>

      <div className="section row-wrap" style={{ justifyContent: 'center' }}>
        {c.isPerson && c.createdBy?.id !== me.data?.id && (
          <button className="btn btn-ghost btn-sm" onClick={() => confirm('Remove yourself from this chapter? Your own contributions stay unless you delete them.') && leave.mutate(undefined)}>
            Remove me from this chapter
          </button>
        )}
        {c.createdBy?.id === me.data?.id && (
          <button className="btn btn-ghost btn-sm" onClick={() => confirm('Delete this chapter?') && remove.mutate(undefined)}>
            Delete chapter
          </button>
        )}
      </div>
      <ErrorNote error={remove.error ?? leave.error} />

      {adding && <AddPeopleSheet chapter={c} onClose={() => setAdding(false)} />}
      {lightbox && (
        <div className="lightbox" onClick={() => setLightbox(null)} role="dialog" aria-label="Photo">
          <img src={mediaSrc(lightbox.url)} alt="" />
          {c.canEdit && c.cover?.id !== lightbox.id && (
            <button
              className="btn btn-secondary btn-sm"
              style={{ position: 'fixed', bottom: 24 }}
              onClick={(e) => {
                e.stopPropagation();
                setCover.mutate(lightbox.id);
              }}
            >
              Use as cover
            </button>
          )}
        </div>
      )}
    </>
  );
}

function ContributionView({ chapterId, x }: { chapterId: string; x: Contribution }) {
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(x.body ?? '');
  const save = useAction(() => api.patch<ChapterDetail>(`/contributions/${x.id}`, { body }), {
    set: setChapter,
    onSuccess: () => setEditing(false),
  });
  const remove = useAction(() => api.del<ChapterDetail>(`/contributions/${x.id}`), { set: setChapter });
  const speaker = x.speaker?.user?.displayName ?? x.speaker?.name;

  const byline = (
    <div className="contribution-by">
      <Avatar user={x.author} size="sm" />
      <span className="grow">
        {x.type === 'quote' ? 'Remembered by ' : ''}
        <strong style={{ color: 'var(--ink-2)' }}>{x.author.displayName}</strong> · {timeAgo(x.createdAt)}
        {x.updatedAt !== x.createdAt && ' · edited'}
      </span>
      {x.canEdit && !editing && (
        <button className="btn btn-ghost btn-sm" onClick={() => setEditing(true)} aria-label="Edit">
          <Pencil size={14} />
        </button>
      )}
      {x.canDelete && (
        <button className="btn btn-ghost btn-sm" aria-label="Delete" onClick={() => confirm('Delete this?') && remove.mutate(undefined)}>
          <Trash2 size={14} />
        </button>
      )}
    </div>
  );

  if (editing) {
    return (
      <div className="stack">
        {byline}
        <textarea className="textarea" value={body} onChange={(e) => setBody(e.target.value)} />
        <div className="row">
          <button className="btn btn-primary btn-sm" onClick={() => save.mutate(undefined)} disabled={!body.trim()}>
            Save
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>
            Cancel
          </button>
        </div>
        <ErrorNote error={save.error} />
      </div>
    );
  }

  if (x.type === 'quote') {
    return (
      <div className="stack" style={{ gap: 8 }}>
        <blockquote className="quote" style={{ margin: 0 }}>
          <p className="quote-text">{x.body}</p>
          {(speaker || x.context) && (
            <p className="quote-by">
              {speaker ? `— ${speaker}` : ''}
              {x.context && <span className="muted" style={{ fontWeight: 500 }}>{speaker ? ', ' : ''}{x.context}</span>}
            </p>
          )}
        </blockquote>
        {byline}
      </div>
    );
  }
  return (
    <article className="stack" style={{ gap: 8 }}>
      {byline}
      {x.title && <h3 className="story-title">{x.title}</h3>}
      <p className="story">{x.body}</p>
    </article>
  );
}

function Composer({ chapter }: { chapter: ChapterDetail }) {
  const me = useMe();
  const [kind, setKind] = useState<'story' | 'quote' | 'photo'>('story');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [speakerUserId, setSpeakerUserId] = useState<string>(me.data?.id ?? '');
  const [speakerName, setSpeakerName] = useState('');
  const [context, setContext] = useState('');
  const [progress, setProgress] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setTitle('');
    setBody('');
    setContext('');
    setSpeakerName('');
  };
  const add = useAction(
    () =>
      api.post<ChapterDetail>(
        `/chapters/${chapter.id}/contributions`,
        kind === 'story'
          ? { type: 'story', title: title || null, body }
          : {
              type: 'quote',
              body,
              speakerUserId: speakerUserId && speakerUserId !== 'other' ? speakerUserId : null,
              speakerName: speakerUserId === 'other' ? speakerName || null : null,
              context: context || null,
            },
      ),
    { set: setChapter, onSuccess: reset },
  );
  const upload = useAction(
    async (files: File[]) => {
      let last: ChapterDetail | null = null;
      for (const [i, file] of files.entries()) {
        setProgress(`Adding photo ${i + 1} of ${files.length}…`);
        const { blob, name } = await prepareImage(file);
        const m = await api.upload<MediaRef>(`/media?chapterId=${chapter.id}`, blob, name);
        last = await api.post<ChapterDetail>(`/chapters/${chapter.id}/contributions`, { type: 'photo', mediaId: m.id });
      }
      return last;
    },
    {
      onSuccess: () => {
        setProgress(null);
        if (fileRef.current) fileRef.current.value = '';
      },
    },
  );

  return (
    <section className="section card stack" aria-label="Add to this chapter">
      <div className="spread">
        <h2 className="serif" style={{ fontSize: 20 }}>
          Add your side
        </h2>
      </div>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={kind === 'story'} onClick={() => setKind('story')}>
          Story
        </button>
        <button role="tab" aria-selected={kind === 'quote'} onClick={() => setKind('quote')}>
          <Quote size={14} /> Quote
        </button>
        <button role="tab" aria-selected={kind === 'photo'} onClick={() => setKind('photo')}>
          <ImagePlus size={14} /> Photos
        </button>
      </div>

      {kind === 'photo' ? (
        <div className="stack">
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            multiple
            className="input"
            onChange={(e) => {
              const files = [...(e.target.files ?? [])];
              if (files.length) upload.mutate(files);
            }}
            disabled={upload.isPending}
            aria-label="Choose photos"
          />
          <p className="tiny muted">Photos are resized on your device and their location data is removed before upload.</p>
          {progress && <p className="small">{progress}</p>}
          <ErrorNote error={upload.error} />
        </div>
      ) : (
        <form
          className="form-grid"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate(undefined);
          }}
        >
          {kind === 'story' ? (
            <>
              <input className="input" placeholder="A title, if you like" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
              <textarea
                className="textarea"
                placeholder="What happened, the way you remember it…"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                maxLength={20000}
                style={{ minHeight: 150, fontFamily: 'var(--font-display)', fontSize: 17 }}
              />
            </>
          ) : (
            <>
              <textarea
                className="textarea"
                placeholder="The exact words…"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                maxLength={1000}
                style={{ minHeight: 80, fontFamily: 'var(--font-display)', fontStyle: 'italic', fontSize: 18 }}
              />
              <div className="two-col">
                <Field label="Who said it" htmlFor="speaker">
                  <select id="speaker" className="select" value={speakerUserId} onChange={(e) => setSpeakerUserId(e.target.value)}>
                    {chapter.people.map((p) => (
                      <option key={p.user.id} value={p.user.id}>
                        {p.user.displayName}
                      </option>
                    ))}
                    <option value="other">Someone else…</option>
                  </select>
                </Field>
                {speakerUserId === 'other' ? (
                  <Field label="Their name" htmlFor="sname">
                    <input id="sname" className="input" value={speakerName} onChange={(e) => setSpeakerName(e.target.value)} maxLength={80} />
                  </Field>
                ) : (
                  <Field label="Context" htmlFor="ctx">
                    <input id="ctx" className="input" placeholder="e.g. at 3am" value={context} onChange={(e) => setContext(e.target.value)} maxLength={500} />
                  </Field>
                )}
              </div>
            </>
          )}
          <ErrorNote error={add.error} />
          <button className="btn btn-primary" disabled={!body.trim() || add.isPending}>
            Add to the chapter
          </button>
        </form>
      )}
    </section>
  );
}

function AddPeopleSheet({ chapter, onClose }: { chapter: ChapterDetail; onClose: () => void }) {
  const [selected, setSelected] = useState<string[]>([]);
  const add = useAction(() => api.post<ChapterDetail>(`/chapters/${chapter.id}/people`, { userIds: selected }), {
    set: setChapter,
    onSuccess: onClose,
  });
  return (
    <Sheet title="Who else was there?" onClose={onClose}>
      <div className="stack-lg">
        <PeoplePicker crewId={chapter.crew?.id ?? null} selected={selected} onChange={setSelected} exclude={chapter.people.map((p) => p.user.id)} />
        <ErrorNote error={add.error} />
        <button className="btn btn-primary btn-block" disabled={!selected.length || add.isPending} onClick={() => add.mutate(undefined)}>
          Add to the chapter
        </button>
      </div>
    </Sheet>
  );
}
