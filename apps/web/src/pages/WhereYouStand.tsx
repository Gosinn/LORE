import { useMutation } from '@tanstack/react-query';
import { LocateFixed, MapPin, Search } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { copy, type GeocodeResult, type LoracleSettings } from '#shared';
import { CompassRose } from '../components/compass.tsx';
import { ErrorNote, Loading } from '../components/ui.tsx';
import { api, ApiError, qs } from '../lib/api.ts';
import { localTimeZone } from '../lib/dates.ts';
import { useAction, useMe } from '../lib/queries.ts';
import '../styles/sign.css';

/** Two decimals: about a kilometre north–south, less east–west. The exact point never leaves the device. */
const roughly = (x: number) => Math.round(x * 100) / 100;

/** Where to go afterwards: a path inside LORE only (never another site, never back to sign-in). */
function nextPath(raw: string | null): string {
  // "/\host" reads as "//host" to a URL parser, so it's refused like "//host".
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\') || raw.startsWith('/welcome')) return '/';
  return raw;
}

/**
 * The device's answer, with a watchdog of our own: time spent on the permission prompt doesn't count
 * toward `timeout`, and some browsers never answer when the prompt is dismissed or left open.
 */
function where(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    // copy:ignore (never shown: the catch below words it)
    const watchdog = setTimeout(() => reject(Object.assign(new Error('No answer from the device'), { code: 3 })), 30_000);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        clearTimeout(watchdog);
        resolve(position);
      },
      (err) => {
        clearTimeout(watchdog);
        reject(err);
      },
      { enableHighAccuracy: false, timeout: 15_000, maximumAge: 10 * 60_000 },
    );
  });
}

/**
 * The town the point lies in (GET /oracle/reverse: town level, never a street). Best effort: without
 * one the place is "Near me", and the Loracle names it from the point later (realmOf, routes/loracle.ts).
 */
async function townAt(lat: number, lon: number): Promise<GeocodeResult | null> {
  try {
    const [town] = await api.get<GeocodeResult[]>(`/oracle/reverse${qs({ lat, lon })}`);
    return town ?? null;
  } catch {
    return null;
  }
}

/**
 * "Where do you stand?": the step right after a new account, before Home (and the Home door's way
 * to answer later). The stones need a place to look around: the device's location (recommended,
 * rounded to about a kilometre) or a town by name. Saved as the same home the Loracle uses.
 */
export function WhereYouStand() {
  const me = useMe();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = nextPath(params.get('next'));
  const canLocate = typeof navigator !== 'undefined' && 'geolocation' in navigator;

  const [q, setQ] = useState('');
  const [results, setResults] = useState<GeocodeResult[] | null>(null);
  const [locating, setLocating] = useState(false);
  const [locateNote, setLocateNote] = useState<string | null>(null);
  const townInput = useRef<HTMLInputElement>(null);
  // A town picked while the device is still being asked wins; a late location answer is then ignored.
  const picked = useRef(false);
  const inputId = useId();
  const noteId = useId();

  const save = useAction(
    (r: GeocodeResult) =>
      api.put<LoracleSettings>('/loracle/settings', {
        home: { label: r.label, lat: r.lat, lon: r.lon, country: r.country ?? null },
        timeZone: localTimeZone(),
      }),
    { onSuccess: () => navigate(next, { replace: true }) },
  );
  // A search is a read: it shouldn't refresh everything on screen the way a write does.
  const search = useMutation<GeocodeResult[], ApiError, string>({
    mutationFn: (query) => api.get<GeocodeResult[]>(`/oracle/geocode${qs({ q: query })}`),
    onSuccess: setResults,
  });

  if (me.isLoading) return <Loading />;
  if (!me.data) return <Navigate to="/welcome" replace />;

  async function locate() {
    setLocating(true);
    setLocateNote(null);
    picked.current = false;
    try {
      const { coords } = await where();
      const lat = roughly(coords.latitude);
      const lon = roughly(coords.longitude);
      const town = await townAt(lat, lon);
      if (picked.current) return;
      // The rounded point is what's kept, whatever the town's own centre is.
      // What a found point is called when no town's name comes back for it (saved: plain, never marked).
      save.mutate({ label: town?.label ?? copy.plain('Near me'), lat, lon, country: town?.country ?? null });
    } catch (err) {
      if (picked.current) return;
      const denied = (err as GeolocationPositionError | undefined)?.code === 1;
      setLocateNote(
        denied
          ? copy('Your device kept your location to itself. Name your town instead.')
          : copy('Your device couldn’t find you just now. Name your town instead.'),
      );
      townInput.current?.focus();
    } finally {
      setLocating(false);
    }
  }

  const busy = locating || save.isPending;
  return (
    <div className="welcome where-you-stand">
      <CompassRose className="welcome-rose" />
      <div className="welcome-inner">
        <div className="stack" style={{ gap: 10 }}>
          <span className="eyebrow">Before you set out</span>
          <h1 className="serif">
            Where do you <em>stand?</em>
          </h1>
          <p className="muted">The stones need to know where you stand to show you what’s near. Only you see it.</p>
        </div>
        <div className="trail" aria-hidden />

        <div className="stack" style={{ gap: 10 }}>
          {canLocate && (
            <button type="button" className="btn btn-primary btn-block" disabled={busy} onClick={locate}>
              <LocateFixed size={18} aria-hidden /> {locating ? 'Finding where you stand…' : 'Allow location (recommended)'}
            </button>
          )}
          {canLocate && <p className="tiny muted where-fine-print">Rounded to about a kilometre before it leaves your device.</p>}
          {/* Always in the page, so a screen reader hears the note when its words change. */}
          <p id={noteId} className={locateNote ? 'small' : 'sr-only'} role="status">
            {locateNote ?? ''}
          </p>
        </div>

        <div className="stack" style={{ gap: 10 }}>
          <p className="where-or">{canLocate ? 'or name your town' : 'Name your town'}</p>
          <form
            className="row"
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              if (q.trim().length >= 2) search.mutate(q.trim());
            }}
          >
            <label htmlFor={inputId} className="sr-only">
              Your town
            </label>
            <input
              id={inputId}
              ref={townInput}
              className="input grow"
              placeholder="Your town"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              maxLength={120}
              autoComplete="address-level2"
              aria-describedby={locateNote ? noteId : undefined}
            />
            <button className="btn btn-secondary" disabled={search.isPending || q.trim().length < 2} aria-label="Search for your town">
              <Search size={18} aria-hidden />
            </button>
          </form>
          <p className="sr-only" role="status">
            {search.isPending
              ? 'Looking for your town…'
              : results
                ? results.length
                  ? `${results.length} ${results.length === 1 ? 'town' : 'towns'} found`
                  : 'The stones know no town by that name.'
                : ''}
          </p>
          <ErrorNote error={search.error ?? save.error} />
          {results &&
            (results.length ? (
              <div className="list">
                {results.map((r) => (
                  <button
                    key={`${r.lat},${r.lon}`}
                    type="button"
                    className="list-item where-result"
                    // Not tied to the location request: a prompt left open must not block the typed town.
                    disabled={save.isPending}
                    onClick={() => {
                      picked.current = true;
                      setLocateNote(null);
                      save.mutate(r);
                    }}
                  >
                    <MapPin size={16} aria-hidden />
                    <span className="grow">{r.label}</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="small muted">The stones know no town by that name. Try another spelling, or a bigger town nearby.</p>
            ))}
        </div>

        <button type="button" className="btn btn-ghost btn-block" disabled={save.isPending} onClick={() => navigate(next, { replace: true })}>
          Later
        </button>
        <p className="tiny muted" style={{ textAlign: 'center' }}>
          You can change it any time in The Loracle.
        </p>
      </div>
    </div>
  );
}
