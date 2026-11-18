import { Check, LocateFixed, Lock, MapPin, Search, Settings2 } from 'lucide-react';
import { useState, type CSSProperties } from 'react';
import { Link, useNavigate } from 'react-router';
import {
  INTEREST_LABELS,
  INTERESTS,
  NO_LIMIT_KM,
  ORACLE_MODE_LABELS,
  ORACLE_MODES,
  ORACLE_READINGS_PER_DAY,
  type Future,
  type GeocodeResult,
  type Interest,
  type OracleMode,
  type OracleReading,
  type OracleSettings,
} from '#shared';
import { Embers, ReminderScroll, RuneCounter, RuneGlyph, RuneRow, Sigil, StoneCircle } from '../components/oracle.tsx';
import { ErrorNote, PageError, Section, TopBar } from '../components/ui.tsx';
import { api, isNative, qs } from '../lib/api.ts';
import { localTimeZone } from '../lib/dates.ts';
import { useAction, useOracle } from '../lib/queries.ts';

const KIND_LABELS: Record<Future['kind'], string> = {
  interest: 'Your path',
  wildcard: 'Wildcard',
  idea: 'From your vault',
  memory: 'An echo',
};

/** Carved on each mode's stone: gebo (the gift) for mixed, raido (the road) for mine, hagalaz (the storm) for wild. */
const MODE_RUNES: Record<OracleMode, string> = { mixed: 'g', mine: 'r', wild: 'h' };

// How far the stones may look, in km. The slider moves through steps so short distances stay precise:
// every 10 km up to 100, every 25 up to 300, every 50 up to 1000, then bigger leaps, and at the end
// ANYWHERE: no limit, the whole Earth.
const RADIUS_STEPS: number[] = [];
for (let km = 10; km <= 1000; km += km < 100 ? 10 : km < 300 ? 25 : 50) RADIUS_STEPS.push(km);
RADIUS_STEPS.push(1500, 2000, 3000, 5000, 10000, NO_LIMIT_KM);
// Keep in step with JOURNEY_KM and FAR_SHORE_KM in apps/api/src/lib/oracle.ts.
const JOURNEY_KM = 250;
const FAR_SHORE_KM = 1500;
const fmtRadius = (km: number) => (km >= NO_LIMIT_KM ? 'ANYWHERE' : `${km.toLocaleString('en')} km`);

/** The slider's stops, plus the saved distance if it isn't one of them (older realms saved any 10 km), so it never moves by itself. */
function radiusSteps(saved: number) {
  return RADIUS_STEPS.includes(saved) ? RADIUS_STEPS : [...RADIUS_STEPS, saved].sort((a, b) => a - b);
}

export function OraclePage() {
  const oracle = useOracle();
  const [editing, setEditing] = useState(false);
  const [mode, setMode] = useState<OracleMode>('mixed');
  const read = useAction((m: OracleMode) => api.post<OracleReading>('/oracle/readings', { mode: m }));

  if (oracle.isLoading)
    return (
      <div className="oracle-page">
        <TopBar back title="The Loracle" />
        <div className="oracle-waking" role="status">
          <div className="stone-window" aria-hidden>
            <StoneCircle active />
            <Embers active />
          </div>
          <p>The stones are waking…</p>
        </div>
      </div>
    );
  if (oracle.error || !oracle.data)
    return (
      <div className="oracle-page">
        <PageError error={oracle.error} />
      </div>
    );
  const { settings, reading } = oracle.data;
  const left = reading?.readingsLeftToday ?? ORACLE_READINGS_PER_DAY;
  const setUp = !!settings.home && !editing;
  const speaking = read.isPending;

  return (
    <div className="oracle-page">
      <TopBar
        back
        title="The Loracle"
        actions={
          setUp && (
            <button className="icon-btn" onClick={() => setEditing(true)} aria-label="Change your realm">
              <Settings2 size={20} />
            </button>
          )
        }
      />

      <section className={`oracle-stone${speaking ? ' speaking' : ''}`}>
        <RuneRow active={speaking} />
        <div className="stone-window">
          <StoneCircle active={speaking} />
          <Embers active={speaking} />
        </div>
        <h1>These stones see what you do not</h1>
        <p>
          Possible futures from the sky, the weather, the wild places around you and your free time. Which one becomes lore is
          up to you.
        </p>
        <RuneRow active={speaking} className="runes-low" />
      </section>

      <ReminderScroll />

      {!setUp ? (
        <RealmForm settings={settings} onDone={() => setEditing(false)} onCancel={settings.home ? () => setEditing(false) : undefined} />
      ) : (
        <>
          {/* The altar: one carved tablet holding the realm, the modes and the read. */}
          <section className="oracle-altar" aria-label="Read the stones">
            <p className="row oracle-realm">
              <MapPin size={15} />
              <span>
                Your realm: <strong>{settings.home!.label}</strong>{settings.radiusKm >= NO_LIMIT_KM ? <>, and the whole world beyond</> : <>, {fmtRadius(settings.radiusKm)} around</>}
                {settings.interests.length ? ` · ${settings.interests.length} interests` : ''}
              </span>
            </p>

            <div className="seg" role="group" aria-label="Which futures">
              {ORACLE_MODES.map((m) => (
                <button key={m} aria-pressed={mode === m} onClick={() => setMode(m)}>
                  <RuneGlyph c={MODE_RUNES[m]} className="seg-rune" />
                  <span>{ORACLE_MODE_LABELS[m].label}</span>
                </button>
              ))}
            </div>
            <p className="oracle-mode-hint">
              {mode === 'mine' && !settings.interests.length
                ? 'Pick some interests first (gear icon), or the stones go wild.'
                : ORACLE_MODE_LABELS[mode].hint}
            </p>

            <button
              className={`btn btn-block oracle-read${speaking ? ' pending' : ''}`}
              disabled={left === 0 || speaking}
              onClick={() => read.mutate(mode)}
            >
              <Sigil moon={left === 0 && !speaking} />
              <span>{speaking ? 'The stones are listening…' : left === 0 ? 'The stones rest until tomorrow' : 'Read the stones'}</span>
            </button>
            <RuneCounter left={left} total={ORACLE_READINGS_PER_DAY} />
            <p className="oracle-count">
              {left} of {ORACLE_READINGS_PER_DAY} readings left today
            </p>
            <ErrorNote error={read.error} />
          </section>

          {reading && (
            <Section title="What the stones reveal">
              <div className="stack-lg">
                {reading.futures.map((f) => (
                  <FutureCard key={`${reading.id}-${f.index}`} readingId={reading.id} future={f} />
                ))}
              </div>
            </Section>
          )}
        </>
      )}

      <p className="oracle-oath">
        <Lock size={16} /> Only you see your realm and your readings.
      </p>
      <p className="oracle-colophon">
        The stones read places from Wikidata, weather from Open-Meteo (CC BY 4.0), the aurora forecast from NOAA SWPC and
        place search from OpenStreetMap (© OpenStreetMap contributors). They can be wrong: check conditions, opening hours
        and safety before you go.
      </p>
    </div>
  );
}

function FutureCard({ readingId, future: f }: { readingId: string; future: Future }) {
  const navigate = useNavigate();
  const [withCrew, setWithCrew] = useState(true);
  const base = `/oracle/readings/${readingId}/futures/${f.index}`;
  const choose = useAction(() => api.post<OracleReading>(`${base}/choose`, { crewId: f.crew && withCrew ? f.crew.id : null }), {
    onSuccess: (r) => {
      const eventId = r.futures.find((x) => x.index === f.index)?.eventId;
      if (eventId) navigate(`/events/${eventId}`);
    },
  });
  const save = useAction(() => api.post<OracleReading>(`${base}/save`));
  const dismiss = useAction(() => api.post<OracleReading>(`${base}/dismiss`));
  const busy = choose.isPending || save.isPending || dismiss.isPending;

  if (f.status === 'dismissed') {
    return (
      <article className="future scroll dismissed">
        <span className="future-emoji seal" aria-hidden>
          <span className="seal-mark">{f.emoji}</span>
        </span>
        <span className="grow small muted">
          <s>{f.title}</s>. You let this one go.
        </span>
      </article>
    );
  }

  return (
    <article className={`future scroll ${f.status}`} style={{ '--i': f.index } as CSSProperties}>
      <div className="future-head">
        <span className={`future-emoji seal ${f.kind}`} aria-hidden>
          <span className="seal-mark">{f.emoji}</span>
        </span>
        <div className="grow">
          <span className={`future-kind ${f.kind}`}>{KIND_LABELS[f.kind]}</span>
          <h3>{f.title}</h3>
          <p className="future-when">{fmtFutureWhen(f)}</p>
        </div>
      </div>

      <p className="future-story">{f.story}</p>

      {f.place && (
        <p className="row future-place">
          <MapPin size={15} />
          <span className="grow">
            {f.place.name} · {f.place.distanceKm} km
          </span>
          <a
            className="more"
            href={`https://www.openstreetmap.org/?mlat=${f.place.lat}&mlon=${f.place.lon}#map=12/${f.place.lat}/${f.place.lon}`}
            target="_blank"
            rel="noreferrer"
          >
            Map
          </a>
        </p>
      )}

      {f.signs.length > 0 && (
        <>
          <div className="ink-rule" aria-hidden />
          <div className="chips wrap future-signs" aria-label="The signs">
            {f.signs.map((s) => (
              <span key={s} className="future-sign">
                {s}
              </span>
            ))}
          </div>
        </>
      )}

      {f.status === 'chosen' && f.eventId ? (
        <div className="row future-done">
          <span className="seal seal-ok" aria-hidden>
            <Check size={22} strokeWidth={3} />
          </span>
          <span className="grow">Destiny chosen.</span>
          <Link to={`/events/${f.eventId}`} className="btn btn-secondary btn-sm">
            Open the plan
          </Link>
        </div>
      ) : (
        <>
          {f.crew && (
            <button className="chip future-crew" aria-pressed={withCrew} onClick={() => setWithCrew(!withCrew)}>
              With {f.crew.emoji} {f.crew.name}
            </button>
          )}
          <div className="future-actions">
            <button className={`btn btn-primary${choose.isPending ? ' pending' : ''}`} disabled={busy} onClick={() => choose.mutate(undefined)}>
              <Sigil />
              <span>{choose.isPending ? 'Making it real…' : 'Choose this destiny'}</span>
            </button>
            {f.status === 'saved' && f.savedIdeaId ? (
              <Link to={`/ideas/${f.savedIdeaId}`} className="btn btn-secondary">
                In your vault
              </Link>
            ) : (
              <button className="btn btn-secondary" disabled={busy} onClick={() => save.mutate(undefined)}>
                Save to vault
              </button>
            )}
            <button className="btn btn-ghost" disabled={busy} onClick={() => dismiss.mutate(undefined)}>
              Not this path
            </button>
          </div>
          <ErrorNote error={choose.error ?? save.error ?? dismiss.error} />
        </>
      )}
    </article>
  );
}

function fmtFutureWhen(f: Future) {
  const day = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'short', timeZone: f.timeZone });
  const time = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', timeZone: f.timeZone });
  const start = new Date(f.startsAt);
  const end = f.endsAt ? new Date(f.endsAt) : null;
  const zone = f.timeZone !== localTimeZone() ? ` (${f.timeZone.split('/').pop()!.replace(/_/g, ' ')} time)` : '';
  if (end && day.format(end) !== day.format(start)) {
    return `${day.format(start)} ${time.format(start)} – ${day.format(end)} ${time.format(end)}${zone}`;
  }
  return `${day.format(start)} · ${time.format(start)}${end ? `–${time.format(end)}` : ''}${zone}`;
}

function RealmForm({ settings, onDone, onCancel }: { settings: OracleSettings; onDone: () => void; onCancel?: () => void }) {
  const [home, setHome] = useState(settings.home);
  const [steps] = useState(() => radiusSteps(settings.radiusKm));
  const [step, setStep] = useState(() => steps.indexOf(settings.radiusKm));
  const [interests, setInterests] = useState<Interest[]>(settings.interests);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<GeocodeResult[] | null>(null);
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);
  const radius = steps[step]!;

  const search = useAction((query: string) => api.get<GeocodeResult[]>(`/oracle/geocode${qs({ q: query })}`), {
    onSuccess: (r) => setResults(r),
  });
  const save = useAction(
    () => api.put<OracleSettings>('/oracle/settings', { home, radiusKm: radius, interests, timeZone: localTimeZone() }),
    { onSuccess: onDone },
  );

  const locate = () => {
    setLocating(true);
    setLocateError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        // Rounded to about a kilometre: the stones don't need your doorstep.
        setHome({ label: 'Near me', lat: Math.round(pos.coords.latitude * 100) / 100, lon: Math.round(pos.coords.longitude * 100) / 100 });
        setResults(null);
      },
      () => {
        setLocating(false);
        setLocateError('Couldn’t get your location. Search for your town instead.');
      },
      { timeout: 15_000, maximumAge: 600_000 },
    );
  };

  const toggle = (i: Interest) => setInterests(interests.includes(i) ? interests.filter((x) => x !== i) : [...interests, i]);

  return (
    <div className="oracle-realm-form">
      <div>
        <h2>Your realm</h2>
        <p className="small muted">Where should the stones look? A town is enough.</p>
      </div>

      {home ? (
        <div className="row banner">
          <MapPin size={16} />
          <strong className="grow">{home.label}</strong>
          <button className="btn btn-ghost btn-sm" onClick={() => setHome(null)}>
            Change
          </button>
        </div>
      ) : (
        <>
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              if (q.trim().length >= 2) search.mutate(q.trim());
            }}
          >
            <input
              className="input grow"
              placeholder="Your town or area"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Your town or area"
              autoFocus
            />
            <button className="btn carved realm-search" disabled={search.isPending || q.trim().length < 2} aria-label="Search">
              <Search size={18} />
            </button>
          </form>
          {!isNative && 'geolocation' in navigator && (
            <button className="btn carved btn-sm realm-locate" onClick={locate} disabled={locating}>
              <LocateFixed size={16} /> {locating ? 'Finding you…' : 'Use my location'}
            </button>
          )}
          {locateError && <p className="small muted">{locateError}</p>}
          <ErrorNote error={search.error} />
          {results &&
            (results.length ? (
              <div className="list">
                {results.map((r) => (
                  <button key={`${r.lat},${r.lon}`} className="list-item realm-result" onClick={() => setHome(r)}>
                    <MapPin size={16} /> {r.label}
                  </button>
                ))}
              </div>
            ) : (
              <p className="small muted">Nothing found. Try a bigger town nearby.</p>
            ))}
        </>
      )}

      <div className="realm-distance">
        <label htmlFor="realm-radius" className="realm-km">
          How far will you go? <b>{fmtRadius(radius)}</b>
        </label>
        <input
          id="realm-radius"
          type="range"
          min={0}
          max={steps.length - 1}
          step={1}
          value={step}
          onChange={(e) => setStep(Number(e.target.value))}
          aria-valuetext={fmtRadius(radius)}
          className="range"
          style={{ '--fill': `${(step / (steps.length - 1)) * 100}%` } as CSSProperties}
        />
        {radius >= NO_LIMIT_KM ? (
          <p className="realm-far">The whole world. The stones may send you anywhere on Earth.</p>
        ) : radius > FAR_SHORE_KM ? (
          <p className="realm-far">Past the end of the roads: the stones may send you across seas.</p>
        ) : radius > JOURNEY_KM ? (
          <p className="realm-far">Far roads: the stones may send you on a journey of days.</p>
        ) : null}
      </div>

      <div>
        <p className="label">What calls to you?</p>
        <p className="small muted" style={{ marginBottom: 10 }}>
          The stones lean towards these. Wildcards ignore them on purpose.
        </p>
        <div className="chips wrap">
          {INTERESTS.map((i) => (
            <button key={i} className="chip" aria-pressed={interests.includes(i)} onClick={() => toggle(i)}>
              <span className="chip-mark" aria-hidden>
                {INTEREST_LABELS[i].emoji}
              </span>{' '}
              {INTEREST_LABELS[i].label}
            </button>
          ))}
        </div>
      </div>

      <ErrorNote error={save.error} />
      <div className="row">
        <button className="btn btn-primary grow" disabled={!home || save.isPending} onClick={() => save.mutate(undefined)}>
          {save.isPending ? 'Saving…' : 'Set my realm'}
        </button>
        {onCancel && (
          <button className="btn carved realm-cancel" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
