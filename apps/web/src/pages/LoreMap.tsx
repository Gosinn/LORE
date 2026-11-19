// The Lore Map (docs/MASTER_BRIEF.md PART XVI; LORE_MAP_SPEC 1 and 4): your places, plans and memories on a
// map, reached through the Lorebook (/lorebook/map). MapLibre over OpenFreeMap's free vector tiles, in LORE's
// look (lib/mapStyle.ts), night and day with the world (data-daylight). Never the device's live location: every
// point comes from GET /map, which applies each place's precision for this viewer on the server.
//
// MapLibre is its own chunk, loaded by this page only (a dynamic import below): the page, the modes and the
// accessible list render first, the map draws itself in when the library has arrived.

import 'maplibre-gl/dist/maplibre-gl.css';
import '../styles/map-page.css';
import { BookOpen, CalendarDays, Compass, Feather, MapPin, Sparkles, Star, UserRound, Users } from 'lucide-react';
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
import workerAsset from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Link, useSearchParams } from 'react-router';
import { copy, MAP_MODE_LABELS, MAP_MODES, PLACE_PRECISION_LABELS, type MapFeature, type MapMode } from '#shared';
import { Empty, ErrorNote, Loading, Section, Sheet, TopBar } from '../components/ui.tsx';
import { fmtChapterDate, fmtMonthYear, fmtWhen } from '../lib/dates.ts';
import { useLoreMap, useShowPlaces } from '../lib/map.ts';
import {
  CARVED_FONT,
  CLUSTER_IMAGE,
  drawCluster,
  drawMapMark,
  drawMedal,
  drawPin,
  imageRatio,
  MAP_MARKS,
  loreMapStyle,
  medalImage,
  pinImage,
  PLACE_KINDS,
  placeLayers,
  PLACES_SOURCE,
  PLACE_LAYERS,
  radiusAtZoom0,
  TAP_LAYERS,
  useOwnMapLetters,
  type MapHalf,
  type PlaceKind,
} from '../lib/mapStyle.ts';
import { serverFile } from '../lib/api.ts';
import { useCrews, useMe } from '../lib/queries.ts';
import { LorebookSwitch } from './Lorebook.tsx';

// LORE's own letters on the map (tools/make-map-glyphs.mjs): Cinzel for countries and regions, IM Fell English
// for places and water. Served by the app's server, so the native apps fetch them from it too.
// copy:ignore (glyph file paths and font stack names, not words)
useOwnMapLetters(serverFile('/map-glyphs/{fontstack}/{range}.pbf'), {
  carved: 'LORE-Carved-Regular',
  carvedBold: 'LORE-Carved-Bold',
  book: 'LORE-Book-Regular',
  bookItalic: 'LORE-Book-Italic',
});

// ---------------------------------------------------------------------------------------------- data
// GET /map through lib/map.ts (shapes in #shared: MapFeature, MapResponse). While another mode loads, the
// last mode's pins stay drawn (the map only takes new data when it has some); the list waits for the new one.

const keyOf = (f: MapFeature) => `${f.kind}:${f.id}`;

/** The list under the map shows this many; the map shows all the server sent (it caps them at 400). */
const LIST_CAP = 60;

// ------------------------------------------------------------------------------------------ helpers

/** Day or night, as <html data-daylight> says right now (lib/theme.ts writes it; any value but "day" is night). */
function readHalf(): MapHalf {
  return document.documentElement.getAttribute('data-daylight') === 'day' ? 'day' : 'night';
}
function subscribeHalf(fn: () => void) {
  const observer = new MutationObserver(fn);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-daylight'] });
  return () => observer.disconnect();
}
const useHalf = () => useSyncExternalStore(subscribeHalf, readHalf, readHalf);

const reducedMotion = () => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

/**
 * When, as the rest of LORE writes it: a plan as the calendar does (its start and end are instants, shown in
 * the viewer's zone), a chapter's days as the Lorebook does, a waypoint's month as a month.
 */
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;
function whenOf(f: MapFeature): string | null {
  const { date, endDate } = f;
  if (!date) return null;
  if (f.kind === 'event') {
    if (Number.isNaN(Date.parse(date))) return null;
    return fmtWhen({ startsAt: date, endsAt: endDate && !Number.isNaN(Date.parse(endDate)) ? endDate : null, allDay: !!f.allDay });
  }
  if (MONTH.test(date)) return fmtMonthYear(new Date(`${date}-15T12:00:00`));
  if (DAY.test(date)) return fmtChapterDate(date, endDate && DAY.test(endDate) ? endDate : null);
  return null;
}

/**
 * MapLibre and its worker, once per visit. The worker ships as its own file (maplibre-gl-worker.mjs); it is
 * handed to MapLibre as a blob of its own text, so no web view has to know what an .mjs file is (iOS's
 * may not) and a strict worker-src only needs `blob:`. The kit's Cinzel is loaded first for the clusters.
 */
let mapLib: Promise<typeof import('maplibre-gl')> | null = null;
function loadMapLib() {
  mapLib ??= (async () => {
    const [lib, worker] = await Promise.all([
      import('maplibre-gl'),
      fetch(workerAsset)
        .then((res) => (res.ok ? res.text() : null))
        .catch(() => null),
      document.fonts?.load(CARVED_FONT).catch(() => undefined),
    ]);
    lib.setWorkerUrl(worker ? URL.createObjectURL(new Blob([worker], { type: 'text/javascript' })) : new URL(workerAsset, location.href).href);
    return lib;
  })();
  mapLib.catch(() => {
    mapLib = null;
  });
  return mapLib;
}

interface PlaceProps {
  key: string;
  kind: PlaceKind;
  precision: 'exact' | 'approximate';
  r0: number;
  /** The first approximate place at its spot: the only one that draws the circle (mapStyle.ts). */
  lead: boolean;
}

const spotOf = (f: MapFeature) => `${f.lat},${f.lon}`;

function toGeoJSON(features: MapFeature[]) {
  const seen = new Set<string>();
  return {
    type: 'FeatureCollection' as const,
    features: features.map((f) => {
      const spot = spotOf(f);
      const lead = f.precision !== 'approximate' || !seen.has(spot);
      if (f.precision === 'approximate') seen.add(spot);
      return {
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [f.lon, f.lat] },
        properties: { key: keyOf(f), kind: f.kind, precision: f.precision, r0: radiusAtZoom0(f.lat), lead } satisfies PlaceProps,
      };
    }),
  };
}

// ------------------------------------------------------------------------------------------ the map

/** 'offline': MapLibre itself didn't arrive (it isn't kept for offline use; nor are the tiles). 'failed': no WebGL2. */
type CanvasState = 'loading' | 'ready' | 'failed' | 'offline';

/** Pins cluster up to this zoom; a cluster still whole past it is places at (nearly) one spot. */
const CLUSTER_MAX_ZOOM = 13;

function MapCanvas({
  features,
  frameKey,
  onPick,
}: {
  features: MapFeature[] | null;
  /** Changes when a new set of places should be framed (another mode or crew); null while they load. */
  frameKey: string | null;
  /** The places tapped: one, or all those at a spot (a cluster that never parts, pins on one point). */
  onPick: (keys: string[]) => void;
}) {
  const half = useHalf();
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const libRef = useRef<typeof import('maplibre-gl') | null>(null);
  const featuresRef = useRef(features);
  const halfRef = useRef(half);
  const pickRef = useRef(onPick);
  const framed = useRef<string | null>(null);
  const [state, setState] = useState<CanvasState>('loading');
  // Each try at loading MapLibre (again when back online, or on "Try again").
  const [attempt, setAttempt] = useState(0);
  featuresRef.current = features;
  pickRef.current = onPick;
  const retry = useCallback(() => {
    setState('loading');
    setAttempt((n) => n + 1);
  }, []);

  // Create the map once (per try); tear it down when the page goes.
  useEffect(() => {
    let cancelled = false;
    let map: MapLibreMap | null = null;
    void (async () => {
      let lib: typeof import('maplibre-gl');
      try {
        lib = await loadMapLib();
      } catch {
        // Offline, a dropped connection, or a deploy that renamed MapLibre's file: not the device's fault.
        if (!cancelled) setState('offline');
        return;
      }
      const el = box.current;
      if (cancelled || !el) return;
      const ratio = imageRatio();
      try {
        map = new lib.Map({
          container: el,
          style: loreMapStyle(halfRef.current),
          center: [10, 30],
          zoom: Math.max(0, Math.log2(el.clientWidth / 512)),
          minZoom: 0,
          maxZoom: 16,
          // North stays up: no rotating or tilting, so nothing on the map is ever upside down or hidden.
          dragRotate: false,
          pitchWithRotate: false,
          touchPitch: false,
          maxPitch: 0,
          attributionControl: false,
          fadeDuration: reducedMotion() ? 0 : 200,
          validateStyle: import.meta.env.DEV,
          locale: {
            'Map.Title': copy('Map of your places'),
            'NavigationControl.ZoomIn': copy('Zoom in'),
            'NavigationControl.ZoomOut': copy('Zoom out'),
          },
        });
      } catch {
        // No WebGL2 on this device: the list below still holds every place.
        if (!cancelled) setState('failed');
        return;
      }
      mapRef.current = map;
      libRef.current = lib;
      map.touchZoomRotate.disableRotation();
      map.keyboard.disableRotation();
      map.addControl(new lib.NavigationControl({ showCompass: false }), 'top-right');

      const m = map;
      // Every style load (the first, and each day/night switch) starts empty: the places go back on.
      m.on('style.load', () => {
        // The engraver's marks (paper, sea lines, trees, stipple, ice, towns, peaks) in this half's inks.
        for (const mark of MAP_MARKS) {
          if (m.hasImage(mark)) m.removeImage(mark);
          const drawn = drawMapMark(mark, halfRef.current, ratio);
          m.addImage(mark, drawn.data, { pixelRatio: drawn.pixelRatio });
        }
        for (const kind of PLACE_KINDS) {
          if (!m.hasImage(pinImage(kind))) m.addImage(pinImage(kind), drawPin(kind, ratio).data, { pixelRatio: ratio });
          if (!m.hasImage(medalImage(kind))) m.addImage(medalImage(kind), drawMedal(kind, ratio).data, { pixelRatio: ratio });
        }
        if (!m.getSource(PLACES_SOURCE)) {
          m.addSource(PLACES_SOURCE, {
            type: 'geojson',
            data: toGeoJSON(featuresRef.current ?? []),
            cluster: true,
            clusterRadius: 46,
            clusterMaxZoom: CLUSTER_MAX_ZOOM,
          });
        }
        for (const layer of placeLayers(halfRef.current)) if (!m.getLayer(layer.id)) m.addLayer(layer);
      });
      // A cluster's count is drawn when it is first needed. MapLibre 6 asks a resolver before it gives up on an
      // image (the old `styleimagemissing` event only fires after the warning, too late for this frame).
      m.setMissingStyleImageResolver((id) => {
        if (m.hasImage(id)) return;
        if (id.startsWith(CLUSTER_IMAGE)) {
          m.addImage(id, drawCluster(id.slice(CLUSTER_IMAGE.length), ratio).data, { pixelRatio: ratio });
        } else if ((MAP_MARKS as readonly string[]).includes(id)) {
          const drawn = drawMapMark(id as (typeof MAP_MARKS)[number], halfRef.current, ratio);
          m.addImage(id, drawn.data, { pixelRatio: drawn.pixelRatio });
        }
      });

      // A finger is not a point: look a few pixels around it. (Nothing while a new style is loading.)
      const hits = (x: number, y: number, pad: number) => {
        const layers = TAP_LAYERS.filter((id) => m.getLayer(id));
        if (!layers.length) return [];
        return m.queryRenderedFeatures(
          [
            [x - pad, y - pad],
            [x + pad, y + pad],
          ],
          { layers },
        );
      };
      m.on('click', (e) => {
        const found = hits(e.point.x, e.point.y, 10);
        // The topmost kind of thing under the finger (clusters, then pins, medals, circles), all of it.
        const layer = TAP_LAYERS.find((id) => found.some((f) => f.layer.id === id));
        const hit = found.find((f) => f.layer.id === layer);
        if (!layer || !hit) return;
        if (layer === PLACE_LAYERS.clusters) {
          const source = m.getSource<GeoJSONSource>(PLACES_SOURCE);
          const id = Number(hit.properties.cluster_id);
          const center = (hit.geometry as { coordinates: [number, number] }).coordinates;
          void source
            ?.getClusterExpansionZoom(id)
            .then(async (zoom) => {
              // Places at one spot never part: list them rather than zoom in on a pile.
              if (zoom > CLUSTER_MAX_ZOOM) {
                const leaves = await source.getClusterLeaves(id, 400, 0);
                pickRef.current(leaves.map((l) => String(l.properties?.key)));
              } else {
                m.easeTo({ center, zoom: zoom + 0.5, duration: reducedMotion() ? 0 : 500 });
              }
            })
            .catch(() => undefined);
          return;
        }
        pickRef.current([...new Set(found.filter((f) => f.layer.id === layer).map((f) => String(f.properties.key)))]);
      });
      m.on('mousemove', (e) => {
        m.getCanvas().style.cursor = hits(e.point.x, e.point.y, 4).length ? 'pointer' : '';
      });
      setState('ready');
    })();
    return () => {
      cancelled = true;
      map?.remove();
      mapRef.current = null;
      libRef.current = null;
    };
  }, [attempt]);

  // Offline: try again as soon as the connection is back.
  useEffect(() => {
    if (state !== 'offline') return;
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, [state, retry]);

  // Day and night: the other style, then the places again (style.load above).
  useEffect(() => {
    if (halfRef.current === half) return;
    halfRef.current = half;
    mapRef.current?.setStyle(loreMapStyle(half), { diff: false });
  }, [half]);

  // New places: onto the map.
  useEffect(() => {
    if (state !== 'ready' || !features) return;
    mapRef.current?.getSource<GeoJSONSource>(PLACES_SOURCE)?.setData(toGeoJSON(features));
  }, [features, state]);

  // Framed on what's shown; with nothing shown, on where you stand; else the whole world. The first framing
  // is instant, later ones (another mode) glide unless motion is reduced.
  useEffect(() => {
    const map = mapRef.current;
    const lib = libRef.current;
    const el = box.current;
    if (state !== 'ready' || !map || !lib || !el || !features || frameKey === null || framed.current === frameKey) return;
    const first = framed.current === null;
    framed.current = frameKey;
    const duration = first || reducedMotion() ? 0 : 700;
    const items = features.filter((f) => f.kind !== 'home');
    const home = features.find((f) => f.kind === 'home');
    if (items.length) {
      const bounds = new lib.LngLatBounds();
      for (const f of items) bounds.extend([f.lon, f.lat]);
      map.fitBounds(bounds, { padding: Math.min(64, el.clientWidth / 6), maxZoom: items.length === 1 ? 9 : 11, duration });
    } else if (home) {
      map.easeTo({ center: [home.lon, home.lat], zoom: 6, duration });
    } else {
      map.easeTo({ center: [10, 30], zoom: Math.max(0, Math.log2(el.clientWidth / 512)), duration });
    }
  }, [features, frameKey, state]);

  return (
    <>
      <div ref={box} className="lore-map-canvas" />
      <div className="lore-map-rose" aria-hidden="true" />
      {state === 'loading' && (
        <div className="lore-map-state">
          <Loading />
        </div>
      )}
      {state === 'offline' && (
        <div className="lore-map-state">
          <p className="small" role="status">
            The map needs a connection to draw itself.
          </p>
          <button type="button" className="btn btn-secondary btn-sm" onClick={retry}>
            Try again
          </button>
        </div>
      )}
      {state === 'failed' && (
        <div className="lore-map-state failed">
          <p className="small" role="status">
            This device can’t draw the map. Every place on it is listed below.
          </p>
        </div>
      )}
    </>
  );
}

// ----------------------------------------------------------------------------------------- the page

function KindIcon({ kind }: { kind: PlaceKind }) {
  if (kind === 'chapter') return <BookOpen size={17} />;
  if (kind === 'event') return <CalendarDays size={17} />;
  if (kind === 'idea') return <Star size={17} />;
  if (kind === 'waypoint') return <Sparkles size={17} />;
  return <Compass size={17} />;
}

function KindName({ kind }: { kind: PlaceKind }) {
  if (kind === 'chapter') return <>Chapter</>;
  if (kind === 'event') return <>Plan</>;
  if (kind === 'idea') return <>Idea</>;
  if (kind === 'waypoint') return <>Loracle waypoint</>;
  return <>Where you stand</>;
}

/** One place as a row: "Places on this map", and the sheet of several places at one spot. */
function PlaceRow({ f }: { f: MapFeature }) {
  const when = whenOf(f);
  return (
    <li className="list-item">
      <Link to={f.href} className="lore-map-row">
        <span className="lore-map-mark" aria-hidden>
          {f.emoji || <KindIcon kind={f.kind} />}
        </span>
        <span className="lore-map-row-text">
          <span className="sr-only">
            <KindName kind={f.kind} />:{' '}
          </span>
          <span className="lore-map-title">{f.title || <KindName kind={f.kind} />}</span>
          {(when || f.placeName) && <span className="meta">{[when, f.placeName].filter(Boolean).join(' · ')}</span>}
        </span>
      </Link>
    </li>
  );
}

/** The blank map's words, by what it was asked to show. */
function blankTitle(mode: MapMode): string {
  if (mode === 'memories') return copy('No memories on the map yet. Chapters and past plans with a place show here.');
  if (mode === 'adventures') return copy('No adventures on the map yet. Plans ahead and ideas with a place show here.');
  if (mode === 'crew') return copy('Nothing of this crew’s is on the map yet.');
  return copy('Your map is still blank. Give a chapter or a plan a place.');
}

export function LoreMapPage() {
  const [params, setParams] = useSearchParams();
  const asked = params.get('mode');
  const mode: MapMode = (MAP_MODES as readonly string[]).includes(asked ?? '') ? (asked as MapMode) : 'mine';
  const crewParam = params.get('crew') ?? undefined;
  const crews = useCrews();
  const me = useMe();
  const showPlaces = useShowPlaces();
  const activeCrews = useMemo(() => (crews.data ?? []).filter((c) => c.myStatus === 'active'), [crews.data]);
  // Crew mode: the crew asked for while your crews load, then one of yours (a crew you've left gives way to
  // your first, rather than an error).
  const crew =
    mode !== 'crew' ? undefined : !crews.data ? crewParam : activeCrews.some((c) => c.id === crewParam) ? crewParam : activeCrews[0]?.id;
  const map = useLoreMap(mode, crew);
  // What a tap picked: one place, or several at one spot.
  const [picked, setPicked] = useState<string[] | null>(null);

  const update = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) v ? next.set(k, v) : next.delete(k);
    setParams(next, { replace: true });
  };
  const pickMode = (m: MapMode) => update(m === 'crew' ? { mode: 'crew' } : { mode: m === 'mine' ? undefined : m, crew: undefined });

  // Crew mode before a crew is known asks nothing.
  const asking = mode !== 'crew' || !!crew;
  const features = asking ? (map.data?.features ?? null) : null;
  const byKey = useMemo(() => new Map((features ?? []).map((f) => [keyOf(f), f])), [features]);
  const items = useMemo(() => (features ?? []).filter((f) => f.kind !== 'home'), [features]);
  // The list holds what the map holds (where you stand first), up to LIST_CAP.
  const listed = (features ?? []).slice(0, LIST_CAP);
  // The places a tap opens: those picked, and (a single pick) every other place at the very same point,
  // which sits under it on the map (one circle per spot; pins on one point).
  const stack = useMemo(() => {
    if (!picked?.length) return [];
    const first = byKey.get(picked[0]!);
    const keys =
      picked.length > 1 ? picked : first ? (features ?? []).filter((f) => f.lat === first.lat && f.lon === first.lon).map(keyOf) : [];
    return keys.map((k) => byKey.get(k)).filter((f): f is MapFeature => !!f);
  }, [picked, byKey, features]);
  const shown = stack.length === 1 ? stack[0] : undefined;
  const crewOf = (id: string | undefined) => (id ? (crews.data ?? []).find((c) => c.id === id) : undefined);
  const close = useCallback(() => setPicked(null), []);
  // The places of the mode on screen have arrived.
  const settled = asking && map.isSuccess;
  const noCrews = mode === 'crew' && crews.isSuccess && activeCrews.length === 0;
  const blank = settled && items.length === 0;
  const placesOn = showPlaces.isPending ? !!showPlaces.variables : me.data?.showPlaces !== false;
  const shownWhen = shown ? whenOf(shown) : null;
  const shownCrew = shown ? crewOf(shown.crewId) : undefined;

  return (
    <>
      <TopBar
        title="Lorebook"
        actions={
          <Link to="/chapters/new" className="btn btn-primary btn-sm">
            <Feather size={15} /> Write
          </Link>
        }
      />
      <LorebookSwitch value="map" crewId={crew} />

      <div className="chips lore-map-modes" role="group" aria-label="What the map shows">
        {MAP_MODES.map((m) => (
          <button key={m} type="button" className="chip" aria-pressed={mode === m} onClick={() => pickMode(m)}>
            {MAP_MODE_LABELS[m]}
          </button>
        ))}
      </div>
      {mode === 'crew' && activeCrews.length > 0 && (
        <div className="chips lore-map-crews" role="group" aria-label="Which crew">
          {activeCrews.map((c) => (
            <button key={c.id} type="button" className="chip" aria-pressed={crew === c.id} onClick={() => update({ mode: 'crew', crew: c.id })}>
              {c.emoji} {c.name}
            </button>
          ))}
        </div>
      )}

      <div className="lore-map-frame" aria-busy={map.isFetching}>
        <MapCanvas features={features} frameKey={settled ? `${mode}|${crew ?? ''}` : null} onPick={setPicked} />
        {blank && (
          <div className="lore-map-blank">
            <Empty title={blankTitle(mode)}>
              <Link to="/lorebook" className="btn btn-secondary btn-sm">
                To the Lorebook
              </Link>
            </Empty>
          </div>
        )}
        {noCrews && (
          <div className="lore-map-blank">
            <Empty title="You’re not in a crew yet.">
              <Link to="/crews/new" className="btn btn-secondary btn-sm">
                Start a crew
              </Link>
            </Empty>
          </div>
        )}
        {/* The tiles' required credit: not words to reword (the providers' names and their terms). */}
        <p className="lore-map-credit" data-copy="off">
          <a href="https://openfreemap.org" target="_blank" rel="noopener noreferrer">
            OpenFreeMap
          </a>{' '}
          <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener noreferrer">
            © OpenMapTiles
          </a>{' '}
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">
            © OpenStreetMap contributors
          </a>
        </p>
      </div>

      {asking && map.error && <ErrorNote error={map.error} />}
      {settled && (map.data?.hidden ?? 0) > 0 && (
        <p className="small lore-map-note">{map.data!.hidden} more aren’t shown. The map keeps to the newest and nearest.</p>
      )}

      {listed.length > 0 && (
        <Section title="Places on this map">
          <ul className="list lore-map-list">
            {listed.map((f) => (
              <PlaceRow key={keyOf(f)} f={f} />
            ))}
          </ul>
          {(features?.length ?? 0) > listed.length && (
            <p className="tiny lore-map-note">
              The first {listed.length} are listed here; the map holds all {features!.length}.
            </p>
          )}
        </Section>
      )}

      <Section title="Your places">
        <div className="card stack lore-map-switch">
          <label className="check">
            <input type="checkbox" checked={placesOn} disabled={!me.data || showPlaces.isPending} onChange={(e) => showPlaces.mutate(e.target.checked)} />
            Show my places on maps
          </label>
          {placesOn ? (
            <p className="small muted">Others see the places of what you share with them, as exact as you set each one.</p>
          ) : (
            <p className="small muted">Off: nobody else sees anything you created on a map. Your own map still shows it to you.</p>
          )}
          <p className="small muted">The map never asks where your phone is. Every place on it was given by someone.</p>
          <ErrorNote error={showPlaces.error} />
        </div>
      </Section>

      {stack.length > 1 && (
        <Sheet title={copy('{count} places here', { count: stack.length })} onClose={close}>
          <ul className="list lore-map-list">
            {stack.map((f) => (
              <PlaceRow key={keyOf(f)} f={f} />
            ))}
          </ul>
        </Sheet>
      )}
      {shown && (
        // Where you stand may have no name (a point picked where no town is named): the sheet still needs a title.
        <Sheet title={`${shown.emoji ? `${shown.emoji} ` : ''}${shown.title || copy('Where you stand')}`} onClose={close}>
          <div className="stack lore-map-sheet">
            <p className="eyebrow">
              <KindName kind={shown.kind} />
            </p>
            {shownWhen && (
              <p className="meta">
                <CalendarDays size={15} aria-hidden /> {shownWhen}
              </p>
            )}
            {shown.placeName && (
              <p className="meta">
                <MapPin size={15} aria-hidden /> {shown.placeName}
              </p>
            )}
            {shownCrew && (
              <p className="meta">
                <Users size={15} aria-hidden /> {shownCrew.emoji} {shownCrew.name}
              </p>
            )}
            {shown.who && (
              <p className="meta">
                <UserRound size={15} aria-hidden /> By {shown.who}
              </p>
            )}
            {shown.kind === 'home' || shown.kind === 'waypoint' ? (
              <p className="tiny muted">Only you see this on a map.</p>
            ) : shown.sharing ? (
              placesOn ? (
                <p className="tiny muted">{PLACE_PRECISION_LABELS[shown.sharing].hint}</p>
              ) : (
                <p className="tiny muted">“Show my places on maps” is off: only you see it on a map.</p>
              )
            ) : (
              shown.precision === 'approximate' && <p className="tiny muted">Shown within about 5 km, not the exact spot.</p>
            )}
            <Link to={shown.href} className="btn btn-primary">
              Open
            </Link>
          </div>
        </Sheet>
      )}
    </>
  );
}
