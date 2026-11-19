// The Lore Map's look (docs/DECISIONS.md D35; LORE_MAP_SPEC 1 and 4): two MapLibre styles over OpenFreeMap's
// vector tiles (OpenMapTiles schema), night and day, and the layer of places the page lays on top of them (pins,
// approximate circles, clusters), drawn to match the base kit (styles/lore.css): carved stone with glow letters.
//
// Types only from maplibre-gl: importing this file never pulls the map library into a chunk.
//
// The owner (2026-11-19): "I want the map to accurate BUT also in OUR OWN STYLE. ORIGINAL." So the data is the
// real world (OpenStreetMap), drawn as an engraved chart: paper with grain, seas engraved in fine lines with
// rings of water-lines along every coast, forests of tiny inked trees, stippled fields, hatched ice, peaks
// drawn as little engraved mountains, roads as double ink lines, borders as dotted lines over a washed band,
// towns marked with the sign of the One, the lines of latitude and longitude, names carved in LORE's own
// letters. Night is brass ink on dark umber; day (html[data-daylight='day']) is sepia ink on vellum.
// No POI clutter, no sprite: every mark on the map is drawn here.

import type { ExpressionSpecification, LayerSpecification, StyleSpecification } from 'maplibre-gl';
import type { MapFeatureKind } from '#shared';

export type MapHalf = 'day' | 'night';
/** What a pin is (#shared MAP_FEATURE_KINDS): each has its own mark. */
export type PlaceKind = MapFeatureKind;
export const PLACE_KINDS: readonly PlaceKind[] = ['chapter', 'event', 'idea', 'waypoint', 'home'];

/**
 * OpenFreeMap (free, no key, no cookies; attribution required). Checked 2026-11-19: the TileJSON (3.0.0,
 * OpenMapTiles schema 3.16, tiles z0 to z14, CORS open) points at the current weekly build.
 */
export const TILEJSON_URL = 'https://tiles.openfreemap.org/planet';
/** Noto Sans from OpenFreeMap: the fallback while LORE's own map letters are not served. */
export const GLYPHS_URL = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';

// copy:ignore (font stacks on the glyph server, not words)
const NOTO = { carvedBold: ['Noto Sans Bold'], carved: ['Noto Sans Regular'], book: ['Noto Sans Regular'], bookItalic: ['Noto Sans Italic'] };
let FONT = NOTO;
let glyphs = GLYPHS_URL;
/**
 * LORE's own letters for the map (Cinzel for countries and regions, IM Fell English for places and water), served
 * by the app as glyph files (tools/make-map-glyphs.mjs). Call once before the first style is built.
 */
export function useOwnMapLetters(urlTemplate: string, stacks: { carvedBold: string; carved: string; book: string; bookItalic: string }) {
  glyphs = urlTemplate;
  FONT = { carvedBold: [stacks.carvedBold], carved: [stacks.carved], book: [stacks.book], bookItalic: [stacks.bookItalic] };
}

// copy:ignore (a CSS font: the clusters' numbers are carved in Cinzel, like every number in the kit)
export const CARVED_FONT = '700 13px Cinzel, Georgia, serif';

// copy:ignore (a geometry type)
const POINT = 'Point';

/** Names in Latin script where the map has them (Seyðisfjörður stays Seyðisfjörður), else the local name. */
const NAME: ExpressionSpecification = ['coalesce', ['get', 'name:latin'], ['get', 'name']];

interface Palette {
  land: string;
  grain: string;
  grainDark: string;
  wood: string;
  tree: string;
  stipple: string;
  ice: string;
  iceHatch: string;
  town: string;
  water: string;
  seaHatch: string;
  ripple: string;
  coast: string;
  river: string;
  border: string;
  borderWash: string;
  borderFaint: string;
  road: string;
  roadInner: string;
  roadFaint: string;
  rail: string;
  ferry: string;
  graticule: string;
  building: string;
  ink: string;
  inkSoft: string;
  inkMute: string;
  title: string;
  halo: string;
  waterLabel: string;
  waterHalo: string;
  peak: string;
  peakLight: string;
}

const NIGHT: Palette = {
  land: '#211a13',
  grain: 'rgba(240, 217, 168, 0.07)',
  grainDark: 'rgba(0, 0, 0, 0.22)',
  wood: '#221c13',
  tree: 'rgba(201, 163, 98, 0.42)',
  stipple: 'rgba(201, 163, 98, 0.2)',
  ice: '#2b2c30',
  iceHatch: 'rgba(207, 213, 239, 0.22)',
  town: '#2a2118',
  water: '#0b1320',
  seaHatch: 'rgba(143, 169, 192, 0.13)',
  ripple: 'rgba(214, 178, 110, 0.7)',
  coast: 'rgba(214, 178, 110, 0.85)',
  river: 'rgba(143, 169, 192, 0.55)',
  border: 'rgba(233, 199, 102, 0.85)',
  borderWash: 'rgba(255, 140, 70, 0.11)',
  borderFaint: 'rgba(201, 163, 98, 0.4)',
  road: 'rgba(214, 170, 100, 0.62)',
  roadInner: '#211a13',
  roadFaint: 'rgba(214, 170, 100, 0.3)',
  rail: 'rgba(207, 197, 180, 0.35)',
  ferry: 'rgba(143, 169, 192, 0.45)',
  graticule: 'rgba(201, 163, 98, 0.16)',
  building: 'rgba(96, 78, 58, 0.45)',
  ink: '#ecdfc4',
  inkSoft: '#d2c2a2',
  inkMute: '#b3a587',
  title: '#e9c766',
  halo: 'rgba(16, 11, 7, 0.9)',
  waterLabel: '#9fb6c8',
  waterHalo: 'rgba(8, 14, 24, 0.85)',
  peak: '#c9a362',
  peakLight: '#3a2f22',
};

const DAY: Palette = {
  land: '#eee3c6',
  grain: 'rgba(120, 84, 34, 0.07)',
  grainDark: 'rgba(90, 60, 20, 0.09)',
  wood: '#e6dcbb',
  tree: 'rgba(58, 74, 36, 0.55)',
  stipple: 'rgba(92, 84, 40, 0.28)',
  ice: '#f6f3ea',
  iceHatch: 'rgba(70, 96, 128, 0.32)',
  town: '#e6d7b4',
  water: '#c8d5d2',
  seaHatch: 'rgba(40, 70, 90, 0.2)',
  ripple: 'rgba(42, 62, 80, 0.7)',
  coast: 'rgba(42, 29, 16, 0.85)',
  river: 'rgba(40, 70, 96, 0.6)',
  border: 'rgba(120, 36, 18, 0.8)',
  borderWash: 'rgba(163, 48, 26, 0.12)',
  borderFaint: 'rgba(74, 54, 32, 0.45)',
  road: 'rgba(74, 54, 32, 0.68)',
  roadInner: '#eee3c6',
  roadFaint: 'rgba(74, 54, 32, 0.35)',
  rail: 'rgba(42, 29, 16, 0.4)',
  ferry: 'rgba(40, 70, 96, 0.5)',
  graticule: 'rgba(74, 54, 32, 0.2)',
  building: 'rgba(140, 107, 61, 0.28)',
  ink: '#2a1d10',
  inkSoft: '#4a3620',
  inkMute: '#68512f',
  title: '#7a2a14',
  halo: 'rgba(246, 238, 216, 0.88)',
  waterLabel: '#2f4a5c',
  waterHalo: 'rgba(214, 226, 226, 0.7)',
  peak: '#4a3620',
  peakLight: '#f4ead2',
};

const cls = (...values: string[]): ExpressionSpecification => ['match', ['get', 'class'], values, true, false];
const notTunnel: ExpressionSpecification = ['!=', ['get', 'brunnel'], 'tunnel'];
/** Line width growing with the zoom: [zoom, width] pairs. */
const widths = (...stops: [number, number][]): ExpressionSpecification =>
  ['interpolate', ['exponential', 1.4], ['zoom'], ...stops.flat()] as ExpressionSpecification;
const sizes = (...stops: [number, number][]): ExpressionSpecification => ['interpolate', ['linear'], ['zoom'], ...stops.flat()] as ExpressionSpecification;

// ------------------------------------------------------------------------- the engraver's marks
// Patterns and map symbols, drawn on small canvases and handed to map.addImage on every style load
// (LoreMap.tsx), in the half's own inks.

export const MAP_MARKS = ['lore-paper', 'lore-sea', 'lore-wood', 'lore-stipple', 'lore-ice', 'lore-town', 'lore-city', 'lore-peak'] as const;
export type MapMark = (typeof MAP_MARKS)[number];

function seeded(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** One of the map's own marks, in the inks of the half. */
export function drawMapMark(mark: MapMark, half: MapHalf, ratio: number): DrawnImage {
  const p = half === 'day' ? DAY : NIGHT;
  const R = seeded(mark.length * 977 + (half === 'day' ? 7 : 3));
  if (mark === 'lore-paper') {
    // The land: paper with grain and the faintest engraved hatching.
    const { ctx, done } = surface(128, 128, ratio);
    ctx.fillStyle = p.land;
    ctx.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 520; i++) {
      ctx.fillStyle = i % 3 ? p.grain : p.grainDark;
      ctx.fillRect(R() * 128, R() * 128, 0.6 + R() * 0.9, 0.6 + R() * 0.9);
    }
    ctx.strokeStyle = p.grain;
    ctx.lineWidth = 0.5;
    for (let x = -128; x < 128; x += 7) {
      ctx.beginPath();
      ctx.moveTo(x, 128);
      ctx.lineTo(x + 128, 0);
      ctx.stroke();
    }
    return done();
  }
  if (mark === 'lore-sea') {
    // The sea, engraved in fine level lines.
    const { ctx, done } = surface(48, 6, ratio);
    ctx.strokeStyle = p.seaHatch;
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(0, 3);
    ctx.lineTo(48, 3);
    ctx.stroke();
    return done();
  }
  if (mark === 'lore-wood') {
    // A forest: little inked trees, a few to a tile, never in rows.
    const { ctx, done } = surface(44, 44, ratio);
    ctx.strokeStyle = p.tree;
    ctx.fillStyle = p.tree;
    ctx.lineWidth = 0.9;
    const spots = [
      [8, 12],
      [27, 7],
      [38, 25],
      [17, 31],
      [33, 40],
    ];
    for (const [x, y] of spots) {
      ctx.beginPath();
      ctx.arc(x!, y! - 3.2, 3, Math.PI * 0.9, Math.PI * 2.1);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x! - 2.6, y! - 2.2);
      ctx.quadraticCurveTo(x!, y! - 0.6, x! + 2.6, y! - 2.2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x!, y! - 1.2);
      ctx.lineTo(x!, y! + 2);
      ctx.stroke();
      ctx.fillRect(x! + 1.2, y! - 3.6, 1.2, 1.2);
    }
    return done();
  }
  if (mark === 'lore-stipple') {
    // Fields and sand: a stipple of dots.
    const { ctx, done } = surface(26, 26, ratio);
    ctx.fillStyle = p.stipple;
    for (let i = 0; i < 9; i++) {
      ctx.beginPath();
      ctx.arc(R() * 26, R() * 26, 0.55 + R() * 0.35, 0, Math.PI * 2);
      ctx.fill();
    }
    return done();
  }
  if (mark === 'lore-ice') {
    // Ice and glaciers: crossed hatching.
    const { ctx, done } = surface(16, 16, ratio);
    ctx.strokeStyle = p.iceHatch;
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(0, 16);
    ctx.lineTo(16, 0);
    ctx.moveTo(-8, 8);
    ctx.lineTo(8, -8);
    ctx.moveTo(8, 24);
    ctx.lineTo(24, 8);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(4, 4, 0.6, 0, Math.PI * 2);
    ctx.arc(12, 12, 0.6, 0, Math.PI * 2);
    ctx.fillStyle = p.iceHatch;
    ctx.fill();
    return done();
  }
  if (mark === 'lore-town' || mark === 'lore-city') {
    // Towns carry the sign of the One (the circle and point); cities ring it twice.
    const big = mark === 'lore-city';
    const s = big ? 16 : 12;
    const { ctx, done } = surface(s, s, ratio);
    const c = s / 2;
    ctx.fillStyle = p.land;
    ctx.strokeStyle = p.ink;
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.arc(c, c, big ? 6.2 : 4.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    if (big) {
      ctx.beginPath();
      ctx.arc(c, c, 4, 0, Math.PI * 2);
      ctx.lineWidth = 0.7;
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(c, c, big ? 1.6 : 1.3, 0, Math.PI * 2);
    ctx.fillStyle = p.ink;
    ctx.fill();
    return done();
  }
  // A peak: a little engraved mountain, its shadow side hatched.
  const { ctx, done } = surface(22, 16, ratio);
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(1.5, 15);
  ctx.lineTo(9, 2.5);
  ctx.lineTo(12.5, 7.5);
  ctx.lineTo(14.5, 5);
  ctx.lineTo(20.5, 15);
  ctx.closePath();
  ctx.fillStyle = p.peakLight;
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = p.peak;
  ctx.lineWidth = 0.6;
  for (let x = 9; x < 24; x += 2.1) {
    ctx.beginPath();
    ctx.moveTo(x, 2);
    ctx.lineTo(x - 4.5, 16);
    ctx.stroke();
  }
  ctx.restore();
  ctx.strokeStyle = p.peak;
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.moveTo(1.5, 15);
  ctx.lineTo(9, 2.5);
  ctx.lineTo(12.5, 7.5);
  ctx.lineTo(14.5, 5);
  ctx.lineTo(20.5, 15);
  ctx.stroke();
  return done();
}

/** The lines of latitude and longitude every 10 degrees (straight lines in this projection: two points each). */
function graticule() {
  const features: { type: 'Feature'; properties: { major: boolean }; geometry: { type: 'LineString'; coordinates: [number, number][] } }[] = [];
  for (let lon = -180; lon <= 180; lon += 10) {
    features.push({ type: 'Feature', properties: { major: lon % 30 === 0 }, geometry: { type: 'LineString', coordinates: [[lon, -85], [lon, 85]] } });
  }
  for (let lat = -80; lat <= 80; lat += 10) {
    features.push({ type: 'Feature', properties: { major: lat === 0 }, geometry: { type: 'LineString', coordinates: [[-180, lat], [180, lat]] } });
  }
  return { type: 'FeatureCollection' as const, features };
}

/** The base map, night or day: the real world, engraved. Nothing on it is tapped; the places go on top. */
export function loreMapStyle(half: MapHalf): StyleSpecification {
  const p = half === 'day' ? DAY : NIGHT;
  const source = 'openmaptiles';
  const textPaint = (color: string, halo = p.halo, width = 1.4) => ({ 'text-color': color, 'text-halo-color': halo, 'text-halo-width': width, 'text-halo-blur': 0.5 });
  /** Water-lines along every coast, inside the water: offsets grow with the zoom. */
  const ripple = (id: string, near: number, far: number, opacity: number): LayerSpecification => ({
    id,
    type: 'line',
    source,
    'source-layer': 'water',
    minzoom: 3,
    filter: notTunnel,
    layout: { 'line-join': 'round' },
    paint: {
      'line-color': p.ripple,
      'line-opacity': ['interpolate', ['linear'], ['zoom'], 3, 0, 4, opacity],
      'line-width': widths([3, 0.7], [10, 1.2]),
      // Kept within the tiles' 8 px buffer: farther out, the tiles' own cut edges would show as stray lines.
      'line-offset': sizes([3, near], [8, far]),
    },
  });

  const layers: LayerSpecification[] = [
    { id: 'paper', type: 'background', paint: { 'background-color': p.land, 'background-pattern': 'lore-paper' } },

    // Land: forests of little trees, stippled fields and sand, hatched ice, faint towns.
    { id: 'landcover-wood', type: 'fill', source, 'source-layer': 'landcover', filter: cls('wood', 'forest'), paint: { 'fill-color': p.wood, 'fill-opacity': 0.7 } },
    { id: 'landcover-wood-trees', type: 'fill', source, 'source-layer': 'landcover', minzoom: 5, filter: cls('wood', 'forest'), paint: { 'fill-pattern': 'lore-wood' } },
    {
      id: 'landcover-fields',
      type: 'fill',
      source,
      'source-layer': 'landcover',
      minzoom: 7,
      filter: cls('grass', 'farmland', 'wetland', 'sand', 'rock'),
      paint: { 'fill-pattern': 'lore-stipple' },
    },
    { id: 'landcover-ice', type: 'fill', source, 'source-layer': 'landcover', filter: cls('ice', 'glacier'), paint: { 'fill-color': p.ice } },
    { id: 'landcover-ice-hatch', type: 'fill', source, 'source-layer': 'landcover', filter: cls('ice', 'glacier'), paint: { 'fill-pattern': 'lore-ice' } },
    {
      id: 'landuse-town',
      type: 'fill',
      source,
      'source-layer': 'landuse',
      minzoom: 8,
      filter: cls('residential', 'suburb', 'quarter', 'neighbourhood', 'commercial', 'retail', 'industrial'),
      paint: { 'fill-color': p.town, 'fill-opacity': sizes([8, 0], [10, 0.75]) },
    },

    // The sea: engraved level lines, rings of water-lines along the coast, the coast inked.
    { id: 'water', type: 'fill', source, 'source-layer': 'water', filter: notTunnel, paint: { 'fill-color': p.water } },
    { id: 'water-engraved', type: 'fill', source, 'source-layer': 'water', filter: notTunnel, paint: { 'fill-pattern': 'lore-sea' } },
    ripple('water-ripple-3', 6, 7, 0.32),
    ripple('water-ripple-2', 3.8, 4.6, 0.5),
    ripple('water-ripple-1', 1.8, 2.2, 0.75),
    {
      id: 'waterway-river',
      type: 'line',
      source,
      'source-layer': 'waterway',
      minzoom: 6,
      filter: ['all', cls('river', 'canal'), notTunnel],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': p.river, 'line-width': widths([6, 0.6], [12, 1.8], [16, 5]) },
    },
    {
      id: 'waterway-stream',
      type: 'line',
      source,
      'source-layer': 'waterway',
      minzoom: 12,
      filter: ['all', cls('stream'), notTunnel],
      paint: { 'line-color': p.river, 'line-width': widths([12, 0.5], [16, 1.4]) },
    },
    {
      id: 'water-coast',
      type: 'line',
      source,
      'source-layer': 'water',
      filter: notTunnel,
      layout: { 'line-join': 'round' },
      paint: { 'line-color': p.coast, 'line-width': widths([0, 0.5], [6, 1], [12, 1.6]) },
    },

    // The lines of latitude and longitude, as on every old chart.
    {
      id: 'graticule',
      type: 'line',
      source: 'lore-graticule',
      maxzoom: 9,
      paint: {
        'line-color': p.graticule,
        'line-width': ['case', ['get', 'major'], 0.9, 0.5],
        'line-dasharray': [6, 4],
      },
    },

    // Buildings: very faint, only close in.
    {
      id: 'building',
      type: 'fill',
      source,
      'source-layer': 'building',
      minzoom: 14,
      paint: { 'fill-color': p.building, 'fill-opacity': sizes([14, 0], [15, 1]) },
    },

    // Borders: a washed band, dotted down its middle. Sea borders are left out.
    {
      id: 'boundary-country-wash',
      type: 'line',
      source,
      'source-layer': 'boundary',
      minzoom: 2,
      filter: ['all', ['==', ['get', 'admin_level'], 2], ['!=', ['get', 'maritime'], 1]],
      layout: { 'line-join': 'round' },
      paint: { 'line-color': p.borderWash, 'line-width': widths([2, 3], [6, 7], [12, 14]), 'line-blur': 2 },
    },
    {
      id: 'boundary-state',
      type: 'line',
      source,
      'source-layer': 'boundary',
      minzoom: 4,
      filter: ['all', ['>=', ['get', 'admin_level'], 3], ['<=', ['get', 'admin_level'], 4], ['!=', ['get', 'maritime'], 1]],
      paint: { 'line-color': p.borderFaint, 'line-width': widths([4, 0.5], [10, 1]), 'line-dasharray': [3, 3] },
    },
    {
      id: 'boundary-country',
      type: 'line',
      source,
      'source-layer': 'boundary',
      filter: ['all', ['==', ['get', 'admin_level'], 2], ['!=', ['get', 'maritime'], 1]],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': p.border, 'line-width': widths([1, 1], [6, 1.6], [12, 2.4]), 'line-dasharray': [0.1, 2.4] },
    },

    // Roads as an engraver draws them: the great ones a double ink line, the rest single, the small ones dashed.
    {
      id: 'road-ferry',
      type: 'line',
      source,
      'source-layer': 'transportation',
      minzoom: 6,
      filter: cls('ferry'),
      paint: { 'line-color': p.ferry, 'line-width': widths([6, 0.6], [12, 1.2]), 'line-dasharray': [4, 3] },
    },
    {
      id: 'road-minor',
      type: 'line',
      source,
      'source-layer': 'transportation',
      minzoom: 12,
      filter: cls('minor', 'service', 'track', 'path'),
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': p.roadFaint, 'line-width': widths([12, 0.5], [16, 1.6]), 'line-dasharray': [3, 2] },
    },
    {
      id: 'road-mid',
      type: 'line',
      source,
      'source-layer': 'transportation',
      minzoom: 8,
      filter: cls('secondary', 'tertiary'),
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': p.road, 'line-width': widths([8, 0.4], [12, 1.1], [16, 3]) },
    },
    {
      id: 'road-major-casing',
      type: 'line',
      source,
      'source-layer': 'transportation',
      minzoom: 5,
      filter: cls('motorway', 'trunk', 'primary'),
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': p.road, 'line-width': widths([5, 0.6], [8, 2.2], [12, 4.4], [16, 10]) },
    },
    {
      id: 'road-major-inner',
      type: 'line',
      source,
      'source-layer': 'transportation',
      minzoom: 7.5,
      filter: cls('motorway', 'trunk', 'primary'),
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': p.roadInner, 'line-width': widths([7.5, 0], [8, 0.8], [12, 2.4], [16, 7]) },
    },
    {
      id: 'rail',
      type: 'line',
      source,
      'source-layer': 'transportation',
      minzoom: 10,
      filter: cls('rail'),
      paint: { 'line-color': p.rail, 'line-width': widths([10, 0.8], [16, 2]), 'line-dasharray': [0.6, 2.4] },
    },

    // Names: the seas in italics spread wide, peaks as little mountains, towns under the sign of the One, then
    // regions and countries in carved capitals (the large win collisions).
    {
      id: 'water-name-ocean',
      type: 'symbol',
      source,
      'source-layer': 'water_name',
      filter: ['all', ['==', ['geometry-type'], POINT], cls('ocean', 'sea')],
      layout: {
        'text-field': NAME,
        'text-font': FONT.bookItalic,
        'text-size': sizes([1, 12], [6, 17]),
        'text-letter-spacing': 0.32,
        'text-max-width': 6,
      },
      paint: textPaint(p.waterLabel, p.waterHalo, 1),
    },
    {
      id: 'water-name-lake',
      type: 'symbol',
      source,
      'source-layer': 'water_name',
      minzoom: 8,
      filter: ['all', ['==', ['geometry-type'], POINT], ['!', cls('ocean', 'sea')]],
      layout: { 'text-field': NAME, 'text-font': FONT.bookItalic, 'text-size': 12.5, 'text-letter-spacing': 0.08, 'text-max-width': 6 },
      paint: textPaint(p.waterLabel, p.waterHalo, 1),
    },
    {
      id: 'peak',
      type: 'symbol',
      source,
      'source-layer': 'mountain_peak',
      minzoom: 8,
      layout: {
        'icon-image': 'lore-peak',
        'icon-anchor': 'bottom',
        'text-field': ['step', ['zoom'], '', 11, NAME],
        'text-font': FONT.bookItalic,
        'text-size': 11.5,
        'text-anchor': 'top',
        'text-offset': [0, 0.25],
        'text-max-width': 7,
        'text-optional': true,
        'symbol-sort-key': ['coalesce', ['get', 'rank'], 99],
      },
      paint: textPaint(p.inkMute),
    },
    {
      id: 'place-hamlet',
      type: 'symbol',
      source,
      'source-layer': 'place',
      minzoom: 12,
      filter: cls('hamlet', 'suburb', 'neighbourhood', 'quarter', 'isolated_dwelling', 'locality'),
      layout: { 'text-field': NAME, 'text-font': FONT.bookItalic, 'text-size': 12, 'text-max-width': 7 },
      paint: textPaint(p.inkMute),
    },
    {
      id: 'place-village',
      type: 'symbol',
      source,
      'source-layer': 'place',
      minzoom: 10,
      filter: cls('village'),
      layout: { 'text-field': NAME, 'text-font': FONT.book, 'text-size': sizes([10, 12], [14, 15]), 'text-max-width': 7 },
      paint: textPaint(p.inkSoft),
    },
    {
      id: 'place-town',
      type: 'symbol',
      source,
      'source-layer': 'place',
      minzoom: 6,
      filter: cls('town'),
      layout: {
        'icon-image': 'lore-town',
        'text-field': NAME,
        'text-font': FONT.book,
        'text-size': sizes([6, 12], [12, 16]),
        'text-anchor': 'left',
        'text-offset': [0.75, 0],
        'text-max-width': 7,
        'text-optional': true,
      },
      paint: textPaint(p.inkSoft),
    },
    {
      id: 'place-city',
      type: 'symbol',
      source,
      'source-layer': 'place',
      minzoom: 3,
      filter: cls('city'),
      layout: {
        'icon-image': 'lore-city',
        'text-field': NAME,
        'text-font': FONT.book,
        'text-size': sizes([4, 12.5], [8, 16], [12, 20]),
        'text-anchor': 'left',
        'text-offset': [0.8, 0],
        'text-max-width': 7,
        'text-optional': true,
        'symbol-sort-key': ['coalesce', ['get', 'rank'], 99],
      },
      paint: textPaint(p.ink),
    },
    {
      id: 'place-state',
      type: 'symbol',
      source,
      'source-layer': 'place',
      minzoom: 4,
      maxzoom: 9,
      filter: cls('state', 'province'),
      layout: {
        'text-field': NAME,
        'text-font': FONT.carved,
        'text-size': sizes([4, 10], [8, 13]),
        'text-transform': 'uppercase',
        'text-letter-spacing': 0.22,
        'text-max-width': 8,
      },
      paint: textPaint(p.inkMute, p.halo, 1.2),
    },
    {
      id: 'place-country',
      type: 'symbol',
      source,
      'source-layer': 'place',
      minzoom: 1,
      maxzoom: 10,
      filter: cls('country'),
      layout: {
        'text-field': NAME,
        'text-font': FONT.carvedBold,
        'text-size': sizes([1, 10], [4, 14], [7, 19]),
        'text-transform': 'uppercase',
        'text-letter-spacing': 0.24,
        'text-max-width': 7,
        'symbol-sort-key': ['coalesce', ['get', 'rank'], 99],
      },
      paint: textPaint(p.title, p.halo, 1.6),
    },
    {
      id: 'place-continent',
      type: 'symbol',
      source,
      'source-layer': 'place',
      maxzoom: 1.5,
      // The seven continents only: OpenStreetMap also labels "Afro-Eurasia" and "Eurasia", which crowd the world view.
      filter: [
        'all',
        cls('continent'),
        [
          'in',
          ['coalesce', ['get', 'name:en'], ['get', 'name']],
          // copy:ignore (OpenStreetMap's own names to match against, not words LORE shows)
          ['literal', ['Africa', 'Antarctica', 'Asia', 'Europe', 'North America', 'South America', 'Oceania', 'Australia']],
        ],
      ],
      layout: { 'text-field': NAME, 'text-font': FONT.carvedBold, 'text-size': 12, 'text-transform': 'uppercase', 'text-letter-spacing': 0.4 },
      paint: textPaint(p.inkSoft, p.halo, 1.4),
    },
  ];

  return {
    version: 8,
    name: half === 'day' ? 'lore-day' : 'lore-night',
    glyphs,
    sources: {
      [source]: { type: 'vector', url: TILEJSON_URL },
      'lore-graticule': { type: 'geojson', data: graticule() },
    },
    layers,
  };
}

// ------------------------------------------------------------------------------------- the places

export const PLACES_SOURCE = 'lore-places';
export const PLACE_LAYERS = {
  halo: 'lore-approx-halo',
  ring: 'lore-approx-ring',
  medal: 'lore-approx-medal',
  pins: 'lore-pins',
  clusters: 'lore-clusters',
} as const;
/** Layers a tap looks at, the clusters first, then pins, then circles (they are large). */
export const TAP_LAYERS = [PLACE_LAYERS.clusters, PLACE_LAYERS.pins, PLACE_LAYERS.medal, PLACE_LAYERS.halo];
export const CLUSTER_IMAGE = 'lore-cluster-';
export const pinImage = (kind: PlaceKind) => `lore-pin-${kind}`;
export const medalImage = (kind: PlaceKind) => `lore-medal-${kind}`;

/**
 * An approximate place is a circle about 8 km across (4 km radius): the server rounds the spot to a node of
 * its grid (PLACE_GRID_DEG, cells about 5.5 km a side, lib/access.ts approximatePoint), so the spot can be up
 * to half a cell's diagonal (about 3.9 km) from the node, and the circle holds every spot that rounds to it.
 * A circle layer's radius is in pixels, so each place carries r0, its radius in pixels at zoom 0 at its
 * latitude (512 px tiles), and the radius doubles with every zoom step. Never under 9 px, so a far-out
 * circle is still something to tap.
 */
export const APPROX_RADIUS_M = 4000;
export function radiusAtZoom0(lat: number): number {
  const cos = Math.max(0.05, Math.cos((lat * Math.PI) / 180));
  return (APPROX_RADIUS_M * 512) / (40_075_016.686 * cos);
}
const r0: ExpressionSpecification = ['get', 'r0'];
const APPROX_RADIUS: ExpressionSpecification = [
  'interpolate',
  ['exponential', 2],
  ['zoom'],
  0,
  9,
  6,
  ['max', 9, ['*', r0, 64]],
  10,
  ['max', 9, ['*', r0, 1024]],
  14,
  ['max', 9, ['*', r0, 16384]],
  20,
  ['*', r0, 1048576],
];

const notCluster: ExpressionSpecification = ['!', ['has', 'point_count']];
/**
 * One circle per spot: approximate places in one town round to the same node, and each would draw its own
 * halo and ring (stacked washes, and two full-screen fills apiece when zoomed in). Only the first at a
 * spot ("lead") draws; a tap on it lists every place there.
 */
const approximate: ExpressionSpecification = [
  'all',
  notCluster,
  ['==', ['get', 'precision'], 'approximate'],
  ['==', ['get', 'lead'], true],
];
const exact: ExpressionSpecification = ['all', notCluster, ['!=', ['get', 'precision'], 'approximate']];

/** The places' layers, on top of the base map. Circles glow by night, vermilion by day; pins are stone either way. */
export function placeLayers(half: MapHalf): LayerSpecification[] {
  const tint = half === 'day' ? '#a3301a' : '#ffb36b';
  const source = PLACES_SOURCE;
  return [
    {
      id: PLACE_LAYERS.halo,
      type: 'circle',
      source,
      filter: approximate,
      paint: {
        'circle-radius': APPROX_RADIUS,
        'circle-color': tint,
        'circle-opacity': half === 'day' ? 0.16 : 0.18,
        'circle-blur': 0.45,
        'circle-pitch-alignment': 'map',
      },
    },
    {
      id: PLACE_LAYERS.ring,
      type: 'circle',
      source,
      filter: approximate,
      paint: {
        'circle-radius': APPROX_RADIUS,
        'circle-opacity': 0,
        'circle-stroke-width': 1.3,
        'circle-stroke-color': tint,
        'circle-stroke-opacity': half === 'day' ? 0.55 : 0.5,
        'circle-pitch-alignment': 'map',
      },
    },
    {
      id: PLACE_LAYERS.medal,
      type: 'symbol',
      source,
      filter: approximate,
      layout: {
        'icon-image': ['concat', 'lore-medal-', ['get', 'kind']],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
    },
    {
      id: PLACE_LAYERS.pins,
      type: 'symbol',
      source,
      filter: exact,
      layout: {
        'icon-image': ['concat', 'lore-pin-', ['get', 'kind']],
        'icon-anchor': 'bottom',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
    },
    {
      id: PLACE_LAYERS.clusters,
      type: 'symbol',
      source,
      filter: ['has', 'point_count'],
      layout: {
        'icon-image': ['concat', CLUSTER_IMAGE, ['to-string', ['get', 'point_count_abbreviated']]],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
    },
  ];
}

// ------------------------------------------------------------------------- drawing the kit's pieces
// Small canvases handed to map.addImage. Stone faces are the kit's block gradient (#6a645b to #3a3632) with
// its near-black edge (#141210); the marks inside are the glow (#ffb36b) with the ember's halo.

const GLOW = '#ffb36b';
const GLOW_HALO = 'rgba(255, 106, 61, 0.9)';
const EDGE = '#141210';
const WELL = '#1b1916';
const CARVED_INK = '#ffdeb8';

export interface DrawnImage {
  data: ImageData;
  pixelRatio: number;
}

/** Device pixels per CSS pixel for the images (1 to 3). */
export const imageRatio = () => Math.min(3, Math.max(1, Math.round((typeof window !== 'undefined' && window.devicePixelRatio) || 1)));

function surface(w: number, h: number, ratio: number) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(w * ratio);
  canvas.height = Math.ceil(h * ratio);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d');
  ctx.scale(ratio, ratio);
  return { ctx, done: (): DrawnImage => ({ data: ctx.getImageData(0, 0, canvas.width, canvas.height), pixelRatio: ratio }) };
}

function stoneFill(ctx: CanvasRenderingContext2D, top: number, bottom: number) {
  const g = ctx.createLinearGradient(0, top, 0, bottom);
  g.addColorStop(0, '#6e675e');
  g.addColorStop(1, '#36322e');
  return g;
}

/** The compass rose of components/compass.tsx (viewBox 64): the star, and its north arm. */
const ROSE = 'M32 1L34.3 26.5L51.8 12.2L37.5 29.7L63 32L37.5 34.3L51.8 51.8L34.3 37.5L32 63L29.7 37.5L12.2 51.8L26.5 34.3L1 32L26.5 29.7L12.2 12.2L29.7 26.5Z';
const ROSE_NORTH = 'M32 1L34.3 26.5L32 32L29.7 26.5Z';
/** Raido, the journey (components/oracle.tsx RUNES.r, box 0..8 by 0..16). */
const RAIDO = [3, 16, 3, 0, 8, 4, 3, 8, 8, 16];

/** One mark in glow, centred on (cx, cy), about 14 px across at s = 1. */
function drawMark(ctx: CanvasRenderingContext2D, kind: PlaceKind, cx: number, cy: number, s: number) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(s, s);
  ctx.shadowColor = GLOW_HALO;
  ctx.shadowBlur = 5;
  ctx.fillStyle = GLOW;
  ctx.strokeStyle = GLOW;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  if (kind === 'chapter') {
    // An open book: two pages and the spine.
    ctx.lineWidth = 1.5;
    ctx.moveTo(0, -3.6);
    ctx.quadraticCurveTo(-3, -5.4, -6.2, -4.3);
    ctx.lineTo(-6.2, 4.3);
    ctx.quadraticCurveTo(-3, 3.3, 0, 5);
    ctx.quadraticCurveTo(3, 3.3, 6.2, 4.3);
    ctx.lineTo(6.2, -4.3);
    ctx.quadraticCurveTo(3, -5.4, 0, -3.6);
    ctx.lineTo(0, 5);
    ctx.stroke();
  } else if (kind === 'event') {
    // The calendar's plan mark: an ember diamond.
    ctx.moveTo(0, -5.6);
    ctx.lineTo(5.6, 0);
    ctx.lineTo(0, 5.6);
    ctx.lineTo(-5.6, 0);
    ctx.closePath();
    ctx.fill();
  } else if (kind === 'idea') {
    // A five-point star.
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? 6.4 : 2.7;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      if (i === 0) ctx.moveTo(r * Math.cos(a), r * Math.sin(a));
      else ctx.lineTo(r * Math.cos(a), r * Math.sin(a));
    }
    ctx.closePath();
    ctx.fill();
  } else if (kind === 'waypoint') {
    // Raido.
    ctx.lineWidth = 1.8;
    const k = 0.7;
    for (let i = 0; i < RAIDO.length; i += 2) {
      const x = (RAIDO[i]! - 5.5) * k;
      const y = (RAIDO[i + 1]! - 8) * k;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  } else {
    // The compass rose, north in ember.
    ctx.scale(0.235, 0.235);
    ctx.translate(-32, -32);
    ctx.fillStyle = '#ffd2a1';
    ctx.fill(new Path2D(ROSE));
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ff6a3d';
    ctx.fill(new Path2D(ROSE_NORTH));
  }
  ctx.restore();
}

/** The sunk well a mark sits in. */
function drawWell(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = WELL;
  ctx.fill();
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  g.addColorStop(0, 'rgba(255, 154, 90, 0.2)');
  g.addColorStop(1, 'rgba(255, 154, 90, 0)');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
  ctx.stroke();
}

/** A stone pin: a carved head on a point, the mark glowing in its well. 34 x 46 CSS px, the tip at the bottom. */
export function drawPin(kind: PlaceKind, ratio: number): DrawnImage {
  const { ctx, done } = surface(34, 46, ratio);
  const cx = 17;
  const cy = 16;
  const R = 13;
  const tip = 42;
  const a = Math.acos(R / (tip - cy));
  const outline = () => {
    ctx.beginPath();
    ctx.moveTo(cx, tip);
    ctx.arc(cx, cy, R, Math.PI / 2 + a, Math.PI * 2.5 - a);
    ctx.closePath();
  };
  // The stone, with its drop.
  outline();
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetY = 2;
  ctx.fillStyle = stoneFill(ctx, cy - R, tip);
  ctx.fill();
  ctx.restore();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = EDGE;
  ctx.stroke();
  // The top catches the light.
  ctx.beginPath();
  ctx.arc(cx, cy, R - 1.6, Math.PI * 1.15, Math.PI * 1.85);
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
  ctx.stroke();
  drawWell(ctx, cx, cy, 9.2);
  drawMark(ctx, kind, cx, cy, 0.95);
  return done();
}

/** A round stone medal for the middle of an approximate circle (not a pin: it marks an area). 28 x 28 CSS px. */
export function drawMedal(kind: PlaceKind, ratio: number): DrawnImage {
  const { ctx, done } = surface(28, 28, ratio);
  const c = 14;
  ctx.beginPath();
  ctx.arc(c, c, 11, 0, Math.PI * 2);
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
  ctx.shadowBlur = 3;
  ctx.shadowOffsetY = 1.5;
  ctx.fillStyle = stoneFill(ctx, c - 11, c + 11);
  ctx.fill();
  ctx.restore();
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = EDGE;
  ctx.stroke();
  drawWell(ctx, c, c, 7.6);
  drawMark(ctx, kind, c, c, 0.78);
  return done();
}

/** A cluster: a stone disc with the count carved in Cinzel, glowing a little (the kit's main face). */
export function drawCluster(label: string, ratio: number): DrawnImage {
  const pad = 8;
  const probe = surface(1, 1, 1).ctx;
  probe.font = CARVED_FONT;
  const width = probe.measureText(label).width;
  const d = Math.max(34, Math.ceil(width + 20));
  const size = d + pad * 2;
  const { ctx, done } = surface(size, size, ratio);
  const c = size / 2;
  const r = d / 2;
  ctx.beginPath();
  ctx.arc(c, c, r, 0, Math.PI * 2);
  ctx.save();
  ctx.shadowColor = 'rgba(255, 106, 61, 0.55)';
  ctx.shadowBlur = 9;
  ctx.fillStyle = stoneFill(ctx, c - r, c + r);
  ctx.fill();
  ctx.restore();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = EDGE;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(c, c, r - 3.5, 0, Math.PI * 2);
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
  ctx.stroke();
  ctx.font = CARVED_FONT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // Engraved: a dark cut above, then the ember letters in their glow.
  ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
  ctx.fillText(label, c, c);
  ctx.shadowColor = 'rgba(255, 120, 60, 0.6)';
  ctx.shadowBlur = 6;
  ctx.fillStyle = CARVED_INK;
  ctx.fillText(label, c, c + 1);
  return done();
}
