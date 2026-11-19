import { useQueryClient } from '@tanstack/react-query';
import { Camera, ChevronRight, Dices, Download, Feather, KeyRound, LogOut, ShieldCheck, Users } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { LORACLE_LINES, type Me, type MediaRef } from '#shared';
import { ChapterCard, CrewChip } from '../components/cards.tsx';
import { Avatar, Empty, ErrorNote, Field, Section, Sheet, TopBar } from '../components/ui.tsx';
import { api, setNativeToken } from '../lib/api.ts';
import { canEditCopy, setCopyEditorOn, useCopyEditorOn } from '../lib/copy/gate.tsx';
import { prepareImage } from '../lib/images.ts';
import { useAction, useChapters, useCrews, useFriendRequests, useFriends, useLoracle, useMe } from '../lib/queries.ts';
import {
  DARK_WORLDS,
  DRIVERS,
  DRIVER_LABELS,
  LIGHT_WORLDS,
  THEMES,
  THEME_LABELS,
  chooseAuto,
  chooseDayWorld,
  chooseDriver,
  chooseNightWorld,
  chooseTheme,
  chooseWorld,
  loadTheme,
  rollColors,
  useLook,
  type ThemeChoice,
  type World,
} from '../lib/theme.ts';

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
  const [changingPassword, setChangingPassword] = useState(false);
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
  // The Loracle: wishes go to Anthropic only while the Lorer agrees (Privacy Policy). Stopping keeps the scrolls.
  const loracle = useLoracle();
  const stopWishes = useAction(() => api.del<unknown>('/loracle/consent'));
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
          <YourWorld />
          {/* The looks picker: only when a retired look is brought back (lib/theme.ts THEMES). */}
          {THEMES.length > 1 && (
            <>
              <span className="label">Appearance</span>
              <div className="chips wrap">
                {THEMES.map((t) => (
                  <button
                    key={t}
                    className="chip"
                    aria-pressed={theme === t}
                    onClick={() => {
                      setTheme(t);
                      chooseTheme(t);
                    }}
                  >
                    {THEME_LABELS[t]}
                  </button>
                ))}
                {theme === 'crazy' && (
                  <button className="chip" onClick={rollColors} aria-label="Roll new colors">
                    <Dices size={15} /> Roll
                  </button>
                )}
              </div>
              {THEMES.length < 2 && (
                <p className="tiny muted">One map for every lore maker. The older looks are rolled up in the archive for now.</p>
              )}
              {theme === 'crazy' && <p className="tiny muted">Every part gets its own bright color, new every time. Or roll them yourself.</p>}
            </>
          )}
          <p className="small muted" style={{ marginTop: 8 }}>
            Everything you create starts private. You choose who sees each event, idea and chapter.
          </p>
          <div className="row-wrap" style={{ marginTop: 8 }}>
            <button className="btn btn-secondary" onClick={() => logout.mutate(undefined)}>
              <LogOut size={16} /> Sign out
            </button>
            <button className="btn btn-ghost" onClick={() => setChangingPassword(true)}>
              <KeyRound size={16} /> Change password
            </button>
          </div>
        </div>
      </Section>

      <Section title="Your data">
        <div className="stack">
          <p className="small muted">Everything you’ve put into LORE belongs to you.</p>
          <div className="row-wrap">
            <button className="btn btn-secondary btn-sm" onClick={() => exportData.mutate(undefined)} disabled={exportData.isPending}>
              <Download size={15} /> {exportData.isPending ? 'Preparing…' : 'Download my data'}
            </button>
            {loracle.data?.consented && (
              <button className="btn btn-ghost btn-sm" onClick={() => stopWishes.mutate(undefined)} disabled={stopWishes.isPending}>
                {LORACLE_LINES.consentWithdraw}
              </button>
            )}
            <button className="btn btn-ghost btn-sm" onClick={() => setDeleting(true)}>
              Delete my account
            </button>
          </div>
          {stopWishes.isSuccess && !loracle.data?.consented && (
            <p className="small muted" role="status">The stone no longer reads your wishes. Your scrolls stay.</p>
          )}
          <ErrorNote error={exportData.error ?? stopWishes.error} />
        </div>
      </Section>

      <Section title="Help">
        <div className="stack">
          {me.isAdmin && (
            <Link to="/admin" className="btn btn-secondary btn-sm" style={{ alignSelf: 'flex-start' }}>
              <ShieldCheck size={15} /> Moderation
            </Link>
          )}
          {canEditCopy(me) && <EditTextSwitch />}
          <p className="small">
            <Link to="/support">Help &amp; contact</Link> · <Link to="/terms">Terms</Link> · <Link to="/privacy">Privacy</Link>
          </p>
        </div>
      </Section>

      <p className="tiny muted" style={{ textAlign: 'center', marginTop: 32 }}>
        LORE {__LORE_VERSION__} · build {__LORE_BUILD__}
      </p>

      {editing && <EditProfileSheet me={me} onClose={() => setEditing(false)} />}
      {deleting && <DeleteAccountSheet onClose={() => setDeleting(false)} />}
      {changingPassword && <ChangePasswordSheet onClose={() => setChangingPassword(false)} />}
    </>
  );
}

/**
 * Your world (DECISIONS D34 and its note of 2026-11-19): every world, dark and light, as small live thumbnails of
 * the art. With Auto off (the default) they are one radio group, and the world tapped is the world shown, always.
 * With Auto on the dark ones pick the world by night, the light ones the world by day, and "When" says what tells
 * day from night. One tap applies; the choices stay on this device (lib/theme.ts, whose WORLDS list this follows:
 * a new world shows up here by itself). Native radios, so arrow keys and screen readers work as for any radio
 * group. Styles: styles/worlds.css.
 */
function YourWorld() {
  const look = useLook();
  const id = useId();
  const tiles = <W extends World>(worlds: readonly W[], name: string, picked: string, pick: (world: W['id']) => void) => (
    <div className="world-grid">
      {worlds.map((w) => (
        <label key={w.id} className="world-pick">
          <input type="radio" className="world-radio" name={name} value={w.id} checked={picked === w.id} onChange={() => pick(w.id)} />
          <span className="world-thumb" data-world={w.id} aria-hidden />
          <span className="world-name">{w.label}</span>
        </label>
      ))}
    </div>
  );
  return (
    <div className="slab your-world">
      <span className="label" id={`${id}-title`}>
        Your world
      </span>
      <div className="world-auto">
        <button
          type="button"
          role="switch"
          className="chip world-switch"
          aria-checked={look.auto}
          aria-describedby={`${id}-auto`}
          onClick={() => chooseAuto(!look.auto)}
        >
          <span className="world-lamp" aria-hidden />
          Auto
        </button>
        <p className="tiny muted world-hint" id={`${id}-auto`}>
          A dark world by night and a light one by day, changing by itself.
        </p>
      </div>
      {look.auto ? (
        <>
          <fieldset className="world-set">
            <legend className="world-legend">By night</legend>
            {tiles(DARK_WORLDS, `${id}-night`, look.night, chooseNightWorld)}
          </fieldset>
          <fieldset className="world-set">
            <legend className="world-legend">By day</legend>
            {tiles(LIGHT_WORLDS, `${id}-day`, look.day, chooseDayWorld)}
          </fieldset>
          <fieldset className="world-set">
            <legend className="world-legend">When</legend>
            <div className="chips wrap">
              {DRIVERS.map((d) => (
                <label key={d} className={`chip world-when${look.driver === d ? ' on' : ''}`}>
                  <input
                    type="radio"
                    className="world-radio"
                    name={`${id}-when`}
                    value={d}
                    checked={look.driver === d}
                    onChange={() => chooseDriver(d)}
                  />
                  <span className="world-when-name">{DRIVER_LABELS[d]}</span>
                </label>
              ))}
            </div>
            {look.driver === 'sun' && !look.sunKnown && (
              <p className="tiny muted world-hint">
                Until you say where you stand, your phone decides. <Link to="/welcome/where?next=/profile">Say where you stand</Link>
              </p>
            )}
          </fieldset>
        </>
      ) : (
        <fieldset className="world-set" aria-labelledby={`${id}-title`}>
          <div className="world-tone" role="group" aria-labelledby={`${id}-dark`}>
            <p className="world-legend" id={`${id}-dark`}>
              Dark
            </p>
            {tiles(DARK_WORLDS, `${id}-world`, look.world, chooseWorld)}
          </div>
          <div className="world-tone" role="group" aria-labelledby={`${id}-light`}>
            <p className="world-legend" id={`${id}-light`}>
              Light
            </p>
            {tiles(LIGHT_WORLDS, `${id}-world`, look.world, chooseWorld)}
          </div>
        </fieldset>
      )}
    </div>
  );
}

/** Owner only: the switch that brings out the quill for changing LORE's words live (lib/copy). */
function EditTextSwitch() {
  const on = useCopyEditorOn();
  return (
    <div className="stack" style={{ gap: 4 }}>
      <button type="button" className="chip" aria-pressed={on} onClick={() => setCopyEditorOn(!on)} style={{ alignSelf: 'flex-start' }}>
        <Feather size={15} /> Edit text
      </button>
      <p className="tiny muted">
        {on ? 'The quill is out, bottom right. Tap it, then tap any words.' : 'Change any words in LORE yourself and publish them live.'}
      </p>
    </div>
  );
}

function ChangePasswordSheet({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const change = useAction(() =>
    api.post<{ ok: true; signedOutOthers: number }>('/me/password', { currentPassword: current, newPassword: next }),
  );
  const mismatch = repeat.length > 0 && repeat !== next;
  const fields = change.error?.fields ?? {};

  if (change.isSuccess) {
    return (
      <Sheet title="Change password" onClose={onClose}>
        <div className="stack">
          <p>Password changed. Other devices were signed out.</p>
          <button className="btn btn-primary btn-block" onClick={onClose}>
            Done
          </button>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet title="Change password" onClose={onClose}>
      <form
        className="form-grid"
        onSubmit={(e) => {
          e.preventDefault();
          if (next === repeat) change.mutate(undefined);
        }}
      >
        <Field label="Current password" htmlFor="pw-current" error={fields.currentPassword}>
          <input
            id="pw-current"
            className="input"
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            required
          />
        </Field>
        <Field label="New password" htmlFor="pw-new" hint="At least 10 characters." error={fields.newPassword}>
          <input
            id="pw-new"
            className="input"
            type="password"
            autoComplete="new-password"
            minLength={10}
            value={next}
            onChange={(e) => setNext(e.target.value)}
            required
          />
        </Field>
        <Field label="New password again" htmlFor="pw-repeat" error={mismatch ? 'Those aren’t the same' : undefined}>
          <input
            id="pw-repeat"
            className="input"
            type="password"
            autoComplete="new-password"
            value={repeat}
            onChange={(e) => setRepeat(e.target.value)}
            required
          />
        </Field>
        {change.error && !Object.keys(fields).length && <ErrorNote error={change.error} />}
        <button className="btn btn-primary btn-block" disabled={!current || next.length < 10 || next !== repeat || change.isPending}>
          {change.isPending ? 'Changing…' : 'Change password'}
        </button>
      </form>
    </Sheet>
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
