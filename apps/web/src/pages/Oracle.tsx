import { Check, LocateFixed, Lock, MapPin, Search, Settings2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import {
  INTEREST_LABELS,
  INTERESTS,
  ORACLE_MODE_LABELS,
  ORACLE_MODES,
  type Future,
  type GeocodeResult,
  type Interest,
  type OracleMode,
  type OracleReading,
  type OracleSettings,
} from '#shared';
import { StoneCircle } from '../components/oracle.tsx';
import { ErrorNote, Field, Loading, PageError, Section, TopBar } from '../components/ui.tsx';
import { api, isNative, qs } from '../lib/api.ts';
import { localTimeZone } from '../lib/dates.ts';
import { useAction, useOracle } from '../lib/queries.ts';

const KIND_LABELS: Record<Future['kind'], string> = {
  interest: 'Your path',
  wildcard: 'Wildcard',
  idea: 'From your vault',
  memory: 'An echo',
};

export function OraclePage() {
  const oracle = useOracle();
  const [editing, setEditing] = useState(false);
  const [mode, setMode] = useState<OracleMode>('mixed');
  const read = useAction((m: OracleMode) => api.post<OracleReading>('/oracle/readings', { mode: m }));

  if (oracle.isLoading) return <Loading />;
  if (oracle.error || !oracle.data) return <PageError error={oracle.error} />;
  const { settings, reading } = oracle.data;
  const left = reading?.readingsLeftToday ?? 3;
  const setUp = !!settings.home && !editing;

  return (
    <>
      <TopBar
        back
        title="The Oracle"
        actions={
          setUp && (
            <button className="icon-btn" onClick={() => setEditing(true)} aria-label="Change your realm">
              <Settings2 size={20} />
            </button>
          )
        }
      />

      <section className="oracle-hero">
        <StoneCircle active={read.isPending} />
        <h1>The stones see what you don’t.</h1>
        <p>
          Possible futures from the sky, the weather, the wild places around you and your free time. Which one becomes lore is
          up to you.
        </p>
      </section>

      {!setUp ? (
        <RealmForm settings={settings} onDone={() => setEditing(false)} onCancel={settings.home ? () => setEditing(false) : undefined} />
      ) : (
        <>
          <p className="small muted row oracle-realm">
            <MapPin size={14} />
            <span className="grow">
              Your realm: <strong>{settings.home!.label}</strong>, {settings.radiusKm} km around
              {settings.interests.length ? ` · ${settings.interests.length} interests` : ''}
            </span>
          </p>

          <div className="seg" role="group" aria-label="Which futures">
            {ORACLE_MODES.map((m) => (
              <button key={m} aria-pressed={mode === m} onClick={() => setMode(m)}>
                {ORACLE_MODE_LABELS[m].label}
              </button>
            ))}
          </div>
          <p className="small muted" style={{ margin: '8px 4px 14px' }}>
            {mode === 'mine' && !settings.interests.length
              ? 'Pick some interests first (gear icon), or the stones go wild.'
              : ORACLE_MODE_LABELS[mode].hint}
          </p>

          <button className="btn btn-primary btn-block oracle-read" disabled={left === 0 || read.isPending} onClick={() => read.mutate(mode)}>
            {read.isPending ? 'The stones are listening…' : left === 0 ? 'The stones rest until tomorrow' : 'Read the stones'}
          </button>
          <p className="small muted center" style={{ marginTop: 8 }}>
            {left} of 3 readings left today
          </p>
          <ErrorNote error={read.error} />

          {reading && (
            <Section title="Possible futures">
              <div className="stack-lg">
                {reading.futures.map((f) => (
                  <FutureCard key={`${reading.id}-${f.index}`} readingId={reading.id} future={f} />
                ))}
              </div>
            </Section>
          )}
        </>
      )}

      <p className="small muted row" style={{ gap: 6, marginTop: 28 }}>
        <Lock size={14} /> Only you see your realm and your readings.
      </p>
      <p className="tiny muted" style={{ marginTop: 6 }}>
        The stones read places from Wikidata, weather from Open-Meteo (CC BY 4.0), the aurora forecast from NOAA SWPC and
        place search from OpenStreetMap (© OpenStreetMap contributors). They can be wrong: check conditions, opening hours
        and safety before you go.
      </p>
    </>
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
      <article className="card future dismissed">
        <span className="future-emoji">{f.emoji}</span>
        <span className="grow small muted">
          <s>{f.title}</s>. You let this one go.
        </span>
      </article>
    );
  }

  return (
    <article className={`card future ${f.status}`}>
      <div className="future-head">
        <span className="future-emoji" aria-hidden>
          {f.emoji}
        </span>
        <div className="grow">
          <span className={`pill future-kind ${f.kind}`}>{KIND_LABELS[f.kind]}</span>
          <h3>{f.title}</h3>
          <p className="small muted">{fmtFutureWhen(f)}</p>
        </div>
      </div>

      <p className="future-story">{f.story}</p>

      {f.place && (
        <p className="small row future-place">
          <MapPin size={14} />
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

      <div className="chips wrap future-signs" aria-label="The signs">
        {f.signs.map((s) => (
          <span key={s} className="pill">
            {s}
          </span>
        ))}
      </div>

      {f.status === 'chosen' && f.eventId ? (
        <div className="row future-done">
          <Check size={18} />
          <span className="grow">Destiny chosen.</span>
          <Link to={`/events/${f.eventId}`} className="btn btn-secondary btn-sm">
            Open the plan
          </Link>
        </div>
      ) : (
        <>
          {f.crew && (
            <button className="chip future-crew" aria-pressed={withCrew} onClick={() => setWithCrew(!withCrew)}>
              {withCrew ? <Check size={14} /> : null} With {f.crew.emoji} {f.crew.name}
            </button>
          )}
          <div className="future-actions">
            <button className="btn btn-primary" disabled={busy} onClick={() => choose.mutate(undefined)}>
              {choose.isPending ? 'Making it real…' : 'Choose this destiny'}
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
  return `${day.format(start)} · ${time.format(start)}${end ? `–${time.format(end)}` : ''}${zone}`;
}

function RealmForm({ settings, onDone, onCancel }: { settings: OracleSettings; onDone: () => void; onCancel?: () => void }) {
  const [home, setHome] = useState(settings.home);
  const [radius, setRadius] = useState(settings.radiusKm);
  const [interests, setInterests] = useState<Interest[]>(settings.interests);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<GeocodeResult[] | null>(null);
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);

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
    <div className="card stack-lg oracle-realm-form">
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
            <button className="btn btn-secondary" disabled={search.isPending || q.trim().length < 2} aria-label="Search">
              <Search size={18} />
            </button>
          </form>
          {!isNative && 'geolocation' in navigator && (
            <button className="btn btn-ghost btn-sm" onClick={locate} disabled={locating} style={{ alignSelf: 'flex-start' }}>
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

      <Field label={`How far will you go? ${radius} km`} htmlFor="realm-radius">
        <input
          id="realm-radius"
          type="range"
          min={10}
          max={300}
          step={10}
          value={radius}
          onChange={(e) => setRadius(Number(e.target.value))}
          className="range"
        />
      </Field>

      <div>
        <p className="label">What calls to you?</p>
        <p className="small muted" style={{ marginBottom: 10 }}>
          The stones lean towards these. Wildcards ignore them on purpose.
        </p>
        <div className="chips wrap">
          {INTERESTS.map((i) => (
            <button key={i} className="chip" aria-pressed={interests.includes(i)} onClick={() => toggle(i)}>
              {INTEREST_LABELS[i].emoji} {INTEREST_LABELS[i].label}
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
          <button className="btn btn-ghost" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
