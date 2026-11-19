import { useMutation } from '@tanstack/react-query';
import { MapPin, Search } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  copy,
  PLACE_PRECISION_DEFAULTS,
  PLACE_PRECISION_LABELS,
  PLACE_PRECISIONS,
  type GeocodeResult,
  type PlaceInput,
  type PlacePoint,
  type PlacePrecision,
} from '#shared';
import { api, qs, type ApiError } from '../lib/api.ts';
import { useMe } from '../lib/queries.ts';
import { ErrorNote } from './ui.tsx';
import '../styles/place-picker.css';

// The Place row (LORE_MAP_SPEC 4 "Composer pickers"): chapters, ideas and plans can stand somewhere on
// the Lore Map. Who gets the point is decided on the server (lib/access.ts); the row only says what the
// Lorer wants. The contract is the shared one: `place` on the create/update inputs (PlaceInput; an
// object sets it, null removes name and point, left out leaves it) and `place: PlacePoint | null` on the
// item, with the place's name in the item's `locationName`.

/** What has a place; sets how exact a new one starts (a plan's meeting point is meant to be found). */
export type PlaceKind = keyof typeof PLACE_PRECISION_DEFAULTS;

/** A place as a form holds it: the name and point, and how others get it. */
export interface PlaceValue {
  name: string;
  lat: number;
  lon: number;
  precision: PlacePrecision;
}

/** The place an item already has, as this viewer got it. None (or someone else's "Only me"): no place. */
export function placeOf(item: { locationName: string | null; place: PlacePoint | null } | null | undefined): PlaceValue | null {
  const p = item?.place;
  if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lon)) return null;
  return { name: item.locationName ?? '', lat: p.lat, lon: p.lon, precision: p.precision };
}

/** A form's place: what it started with, what it holds now, and whether the Lorer touched it. */
export function usePlace(item: { locationName: string | null; place: PlacePoint | null } | null | undefined) {
  const [initial] = useState(() => placeOf(item));
  const [value, setValue] = useState(initial);
  const [touched, setTouched] = useState(false);
  const set = useCallback((next: PlaceValue | null) => {
    setValue(next);
    setTouched(true);
  }, []);
  return { initial, value, touched, set };
}
export type PlaceState = ReturnType<typeof usePlace>;

/**
 * The `place` a form sends. `undefined` (left out of the JSON) leaves the item's place as it is, so an
 * untouched form never sends back a point it was given rounded; `null` removes it, name and point. `name`
 * is the form's own "Where" when it has one (chapters and plans keep the place's name there).
 */
export function placeInput(state: PlaceState, name?: string): PlaceInput | null | undefined {
  if (!state.touched) return undefined;
  if (!state.value) return state.initial ? null : undefined;
  const { lat, lon, precision } = state.value;
  return { name: (name?.trim() || state.value.name).slice(0, 200), lat, lon, precision };
}

/** The server's word on the place (`place`, `place.lat`…), for the row's error line. */
export function placeError(fields: Record<string, string>): string | undefined {
  return Object.entries(fields).find(([k]) => k === 'place' || k.startsWith('place.'))?.[1];
}

/**
 * The Place row: search a town or a spot (the geocoder the Loracle uses: town-level names, never a
 * street), pick it, then say how exact everyone else sees it. "Remove place" takes it off the map.
 * Lives inside the forms' own <form>, so the search is a group, not a nested form: Enter searches.
 */
export function PlacePicker({
  value,
  onChange,
  kind,
  mine,
  error,
}: {
  value: PlaceValue | null;
  onChange: (next: PlaceValue | null) => void;
  /** Sets how exact a newly picked place starts: chapters and ideas "About here", plans "Exact". */
  kind: PlaceKind;
  /** The Lorer is the item's author (or it's new): the server gives them the exact point and their setting. */
  mine: boolean;
  error?: string;
}) {
  const id = useId();
  const me = useMe();
  // Someone else's "About here" reaches this Lorer already rounded. Sent back with another precision it
  // would replace the author's point with the rounded one, so only a newly picked place can change it.
  const [firstPrecision] = useState(value?.precision);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<GeocodeResult[] | null>(null);
  const [repicked, setRepicked] = useState(false);
  // A place picked again after "Remove place" keeps the choice the Lorer had made.
  const lastPrecision = useRef<PlacePrecision | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const picked = useRef<HTMLDivElement>(null);
  const focusNext = useRef<'input' | 'picked' | null>(null);

  // A search is a read: it shouldn't refresh everything on screen the way a write does.
  const search = useMutation<GeocodeResult[], ApiError, string>({
    mutationFn: (query) => api.get<GeocodeResult[]>(`/oracle/geocode${qs({ q: query })}`),
    onSuccess: setResults,
  });

  // Keep the focus where the eye goes: on the picked place after a pick, in the search after a removal.
  useEffect(() => {
    if (focusNext.current === 'input') input.current?.focus();
    else if (focusNext.current === 'picked') picked.current?.focus();
    focusNext.current = null;
  });

  const run = () => {
    const query = q.trim();
    if (query.length >= 2) search.mutate(query);
  };
  const closeSearch = () => {
    setOpen(false);
    setQ('');
    setResults(null);
    search.reset();
  };
  const pick = (r: GeocodeResult) => {
    const precision = value?.precision ?? lastPrecision.current ?? PLACE_PRECISION_DEFAULTS[kind];
    onChange({ name: r.label, lat: r.lat, lon: r.lon, precision });
    setRepicked(true);
    closeSearch();
    focusNext.current = 'picked';
  };
  const remove = () => {
    lastPrecision.current = value?.precision ?? null;
    onChange(null);
    setOpen(true);
    focusNext.current = 'input';
  };

  const locked = !mine && firstPrecision === 'approximate' && !repicked;
  const searching = !value || open;
  // The words, and what may be chosen. The server gives the exact spot, and "Only me", to the item's author
  // (whoever created it) alone: someone else editing it (a co-organiser, a crew admin) reads words that name
  // the author, and can't choose "Only me" (it would hide the place from them, not keep it to them).
  const hint = !value
    ? ''
    : locked
      ? copy('Only the one who placed it can change how exact it is.')
      : !mine
        ? value.precision === 'approximate'
          ? copy('Others, you included, see a circle about 8 km across. Only whoever made this sees the spot.')
          : value.precision === 'only_me'
            ? copy('Only whoever made this sees it on a map, not you.')
            : PLACE_PRECISION_LABELS[value.precision].hint
        : me.data?.showPlaces === false
          ? copy('“Show my places on maps” is off: only you see it on a map.')
          : PLACE_PRECISION_LABELS[value.precision].hint;
  // A plan's or chapter's place name is its "Where", which everyone who sees it reads, map or not.
  const nameStays =
    !!value && kind !== 'idea' && (value.precision === 'only_me' || (mine && me.data?.showPlaces === false));
  return (
    <div className="field place-picker" role="group" aria-labelledby={`${id}-label`}>
      <span id={`${id}-label`} className="label">
        Place
      </span>

      {value && (
        <div className="place-picked" ref={picked} tabIndex={-1}>
          <div className="place-picked-head">
            <MapPin size={18} aria-hidden />
            <span className="place-picked-name">{value.name || 'A spot on the map'}</span>
          </div>
          <div className="chips wrap" role="radiogroup" aria-label="Who sees the exact spot" aria-describedby={`${id}-precision`}>
            {PLACE_PRECISIONS.map((p) => (
              <button
                type="button"
                key={p}
                className="chip"
                role="radio"
                aria-checked={value.precision === p}
                disabled={(locked && value.precision !== p) || (!mine && p === 'only_me' && value.precision !== p)}
                onClick={() => onChange({ ...value, precision: p })}
              >
                {PLACE_PRECISION_LABELS[p].label}
              </button>
            ))}
          </div>
          <span id={`${id}-precision`} className="hint">
            {hint}
            {nameStays && <> Its name still shows in “Where” to everyone who can see it.</>}
          </span>
          <div className="place-picked-actions">
            {open ? (
              <button type="button" className="btn btn-ghost btn-sm" onClick={closeSearch}>
                Keep this place
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setOpen(true);
                  focusNext.current = 'input';
                }}
              >
                Pick another place
              </button>
            )}
            <button type="button" className="btn btn-ghost btn-sm" onClick={remove}>
              Remove place
            </button>
          </div>
        </div>
      )}

      {searching && (
        <>
          <div className="place-search" role="search">
            <label htmlFor={`${id}-q`} className="sr-only">
              Search for a place
            </label>
            <input
              id={`${id}-q`}
              ref={input}
              className="input"
              placeholder="A town, a lake, a peak…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                // Enter searches here; it must not send the whole form.
                if (e.key === 'Enter') {
                  e.preventDefault();
                  run();
                } else if (e.key === 'Escape' && value) {
                  e.preventDefault();
                  closeSearch();
                  focusNext.current = 'picked';
                }
              }}
              maxLength={120}
              autoComplete="off"
              enterKeyHint="search"
            />
            <button type="button" className="btn btn-secondary" disabled={search.isPending || q.trim().length < 2} aria-label="Search for a place" onClick={run}>
              <Search size={18} aria-hidden />
            </button>
          </div>
          <p className="sr-only" role="status">
            {search.isPending
              ? 'Looking for the place…'
              : results
                ? results.length
                  ? `${results.length} ${results.length === 1 ? 'place' : 'places'} found`
                  : 'No place by that name.'
                : ''}
          </p>
          <ErrorNote error={search.error} />
          {results &&
            (results.length ? (
              <div className="place-results">
                {results.map((r) => (
                  <button key={`${r.lat},${r.lon}`} type="button" className="place-result" onClick={() => pick(r)}>
                    <MapPin size={16} aria-hidden />
                    <span className="grow">{r.label}</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="hint">No place by that name. Try another spelling, or a bigger town nearby.</p>
            ))}
        </>
      )}

      {error ? <span className="error">{error}</span> : !value && <span className="hint">Optional. A town or a spot, to put it on the Lore Map.</span>}
    </div>
  );
}
