import { useQueryClient } from '@tanstack/react-query';
import { Camera, ChevronRight, LogOut, Users } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import type { Me, MediaRef } from '#shared';
import { ChapterCard, CrewChip } from '../components/cards.tsx';
import { Avatar, Empty, ErrorNote, Field, Section, Sheet, TopBar } from '../components/ui.tsx';
import { api, setNativeToken } from '../lib/api.ts';
import { prepareImage } from '../lib/images.ts';
import { useAction, useChapters, useCrews, useFriendRequests, useFriends, useMe } from '../lib/queries.ts';
import { applyTheme, loadTheme, type ThemeChoice } from '../lib/theme.ts';

export function MyProfile() {
  const me = useMe().data!;
  const qc = useQueryClient();
  const navigate = useNavigate();
  const friends = useFriends();
  const requests = useFriendRequests();
  const crews = useCrews();
  const lore = useChapters({ personId: me.id });
  const [editing, setEditing] = useState(false);
  const [theme, setTheme] = useState<ThemeChoice>(loadTheme());
  const fileRef = useRef<HTMLInputElement>(null);
  const incoming = (requests.data ?? []).filter((r) => r.direction === 'incoming').length;

  const avatar = useAction(
    async (file: File) => {
      const { blob, name } = await prepareImage(file);
      const m = await api.upload<MediaRef>('/media', blob, name);
      return api.patch<Me>('/me', { avatarMediaId: m.id });
    },
    { onSuccess: (updated) => qc.setQueryData(['me'], updated) },
  );
  const logout = useAction(() => api.post('/auth/logout'), {
    onSuccess: () => {
      setNativeToken(null);
      qc.clear();
      qc.setQueryData(['me'], null);
      navigate('/welcome', { replace: true });
    },
  });

  return (
    <>
      <TopBar title="Profile" />
      <div className="hero" style={{ alignItems: 'center', textAlign: 'center' }}>
        <button
          className="icon-btn"
          style={{ width: 'auto', height: 'auto', padding: 0, position: 'relative' }}
          onClick={() => fileRef.current?.click()}
          aria-label="Change profile picture"
        >
          <Avatar user={me} size="xl" />
          <span className="badge-dot" style={{ top: 'auto', bottom: 2, right: 2, display: 'grid', placeItems: 'center', width: 28, height: 28, padding: 0 }}>
            <Camera size={14} />
          </span>
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) avatar.mutate(f);
          }}
        />
        <h1 style={{ fontSize: 30 }}>{me.displayName}</h1>
        <span className="muted">@{me.username}</span>
        {me.bio && <p style={{ maxWidth: 460, whiteSpace: 'pre-wrap' }}>{me.bio}</p>}
        <button className="btn btn-secondary btn-sm" onClick={() => setEditing(true)}>
          Edit profile
        </button>
        <ErrorNote error={avatar.error} />
      </div>

      <Link to="/friends" className="card card-link row section" style={{ marginTop: 22 }}>
        <Users size={20} />
        <span className="grow">
          <strong>Friends</strong>
          <span className="small muted" style={{ display: 'block' }}>
            {friends.data?.length ?? 0} friends{incoming ? ` · ${incoming} new request${incoming > 1 ? 's' : ''}` : ''}
          </span>
        </span>
        {incoming > 0 && <span className="pill pill-ember">{incoming}</span>}
        <ChevronRight size={18} className="muted" />
      </Link>

      <Section title="My crews" more={<Link to="/crews/new" className="more">New crew</Link>}>
        {crews.data?.some((c) => c.myStatus === 'active') ? (
          <div className="chips wrap">
            {crews.data
              .filter((c) => c.myStatus === 'active')
              .map((c) => (
                <CrewChip key={c.id} crew={c} />
              ))}
          </div>
        ) : (
          <p className="small muted">No crews yet.</p>
        )}
      </Section>

      <Section title="My lore" more={<Link to="/lorebook" className="more">Lorebook</Link>}>
        {lore.data?.length ? (
          <div className="stack">
            {lore.data.slice(0, 4).map((c) => (
              <ChapterCard key={c.id} chapter={c} />
            ))}
          </div>
        ) : (
          <Empty title="No chapters yet." />
        )}
      </Section>

      <Section title="Settings">
        <div className="stack">
          <span className="label">Appearance</span>
          <div className="chips">
            {(['system', 'light', 'dark'] as const).map((t) => (
              <button
                key={t}
                className="chip"
                aria-pressed={theme === t}
                onClick={() => {
                  setTheme(t);
                  applyTheme(t);
                }}
              >
                {t === 'system' ? 'Match device' : t === 'light' ? 'Paper' : 'Campfire'}
              </button>
            ))}
          </div>
          <p className="small muted" style={{ marginTop: 8 }}>
            Everything you create starts private. You choose who sees each event, idea and chapter.
          </p>
          <button className="btn btn-secondary" style={{ alignSelf: 'flex-start', marginTop: 8 }} onClick={() => logout.mutate(undefined)}>
            <LogOut size={16} /> Sign out
          </button>
        </div>
      </Section>

      {editing && <EditProfileSheet me={me} onClose={() => setEditing(false)} />}
    </>
  );
}

function EditProfileSheet({ me, onClose }: { me: Me; onClose: () => void }) {
  const qc = useQueryClient();
  const [displayName, setDisplayName] = useState(me.displayName);
  const [bio, setBio] = useState(me.bio ?? '');
  const save = useAction(() => api.patch<Me>('/me', { displayName, bio: bio || null }), {
    onSuccess: (updated) => {
      qc.setQueryData(['me'], updated);
      onClose();
    },
  });
  return (
    <Sheet title="Edit profile" onClose={onClose}>
      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(undefined);
        }}
      >
        <Field label="Name" htmlFor="dn">
          <input id="dn" className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={60} required />
        </Field>
        <Field label="About you" hint="Shown to people who view your profile." htmlFor="bio">
          <textarea id="bio" className="textarea" value={bio} onChange={(e) => setBio(e.target.value)} maxLength={500} />
        </Field>
        <ErrorNote error={save.error} />
        <button className="btn btn-primary btn-block" disabled={save.isPending}>
          Save
        </button>
      </form>
    </Sheet>
  );
}
