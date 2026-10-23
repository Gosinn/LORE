import { useQueryClient } from '@tanstack/react-query';
import { Camera, ChevronRight, Dices, Download, LogOut, Users } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import type { Me, MediaRef } from '#shared';
import { ChapterCard, CrewChip } from '../components/cards.tsx';
import { Avatar, Empty, ErrorNote, Field, Section, Sheet, TopBar } from '../components/ui.tsx';
import { api, setNativeToken } from '../lib/api.ts';
import { prepareImage } from '../lib/images.ts';
import { useAction, useChapters, useCrews, useFriendRequests, useFriends, useMe } from '../lib/queries.ts';
import { applyTheme, loadTheme, rollNeon, type ThemeChoice } from '../lib/theme.ts';

const THEME_LABELS: Record<ThemeChoice, string> = {
  system: 'Match device',
  light: 'Paper',
  dark: 'Campfire',
  crazy: 'Crazy',
};

export function MyProfile() {
  const me = useMe().data!;
  const qc = useQueryClient();
  const navigate = useNavigate();
  const friends = useFriends();
  const requests = useFriendRequests();
  const crews = useCrews();
  const lore = useChapters({ personId: me.id });
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
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
  const exportData = useAction(() => api.download('/me/export', `lore-${me.username}.json`));
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
          <div className="chips wrap">
            {(['system', 'light', 'dark', 'crazy'] as const).map((t) => (
              <button
                key={t}
                className="chip"
                aria-pressed={theme === t}
                onClick={() => {
                  setTheme(t);
                  applyTheme(t);
                }}
              >
                {THEME_LABELS[t]}
              </button>
            ))}
            {theme === 'crazy' && (
              <button className="chip" onClick={rollNeon} aria-label="Roll new colors">
                <Dices size={15} /> Roll
              </button>
            )}
          </div>
          {theme === 'crazy' && <p className="tiny muted">New colors every time you open LORE. Or roll them yourself.</p>}
          <p className="small muted" style={{ marginTop: 8 }}>
            Everything you create starts private. You choose who sees each event, idea and chapter.
          </p>
          <button className="btn btn-secondary" style={{ alignSelf: 'flex-start', marginTop: 8 }} onClick={() => logout.mutate(undefined)}>
            <LogOut size={16} /> Sign out
          </button>
        </div>
      </Section>

      <Section title="Your data">
        <div className="stack">
          <p className="small muted">Everything you’ve put into LORE belongs to you.</p>
          <div className="row-wrap">
            <button className="btn btn-secondary btn-sm" onClick={() => exportData.mutate(undefined)} disabled={exportData.isPending}>
              <Download size={15} /> {exportData.isPending ? 'Preparing…' : 'Download my data'}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setDeleting(true)}>
              Delete my account
            </button>
          </div>
          <ErrorNote error={exportData.error} />
        </div>
      </Section>

      <p className="tiny muted" style={{ textAlign: 'center', marginTop: 32 }}>
        LORE {__LORE_VERSION__} · build {__LORE_BUILD__}
      </p>

      {editing && <EditProfileSheet me={me} onClose={() => setEditing(false)} />}
      {deleting && <DeleteAccountSheet onClose={() => setDeleting(false)} />}
    </>
  );
}

function DeleteAccountSheet({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const remove = useAction(() => api.del('/me', { password }), {
    onSuccess: () => {
      setNativeToken(null);
      qc.clear();
      qc.setQueryData(['me'], null);
      navigate('/welcome', { replace: true });
    },
  });
  return (
    <Sheet title="Delete your account" onClose={onClose}>
      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          remove.mutate(undefined);
        }}
      >
        <div className="stack small">
          <p>This can’t be undone.</p>
          <p className="muted">
            <strong>Goes:</strong> your profile, friends, crew memberships, private calendar, private chapters and ideas
            only you could see.
          </p>
          <p className="muted">
            <strong>Stays, anonymised as “a former member”:</strong> stories, quotes, photos and messages you added to
            chapters and plans shared with other people, so their history stays whole. Crews, plans and chapters you ran
            are handed to someone else in them.
          </p>
          <p className="muted">Want a copy first? Use “Download my data”.</p>
        </div>
        <Field label="Your password" htmlFor="delpw">
          <input id="delpw" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        <ErrorNote error={remove.error} />
        <button className="btn btn-danger btn-block" disabled={!password || remove.isPending}>
          {remove.isPending ? 'Deleting…' : 'Delete my account for good'}
        </button>
      </form>
    </Sheet>
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
