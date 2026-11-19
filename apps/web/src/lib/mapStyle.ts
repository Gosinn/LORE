// The Lore Map's look (docs/DECISIONS.md D35; LORE_MAP_SPEC 1 and 4): two MapLibre styles over OpenFreeMap's
// vector tiles (OpenMapTiles schema), night and day, and the layer of places the page lays on top of them (pins,
// approximate circles, clusters), drawn to match the base kit (styles/lore.css): carved stone with glow letters.
//
// Types only from maplibre-gl: importing this file never pulls the map library into a chunk.
//
// Night: umber land, deep ink water, faint brass roads and coasts, carve-coloured labels with dark halos.
// Day (html[data-daylight='day']): vellum land, grey-blue water, ink labels. No POI clutter, no sprite: the
// only icons on the map are LORE's own.

import type { ExpressionSpecification, LayerSpecification, StyleSpecification } from 'maplibre-gl';
import type { MapFeatureKind } from '#shared';

export type MapHalf = 'day' | 'night';
/** What a pin is (#shared MAP_FEATURE_KINDS): each has its own mark. */
export type PlaceKind = MapFeatureKind;
export const PLACE_KINDS: readonly PlaceKind[] = ['chapter', 'event', 'idea', 'waypoint', 'home'];

/**
 * OpenFreeMap (free, no key, no cookies; attribution required). Checked 2026-11-19: the TileJSON (3.0.0,
 * OpenMapTiles schema 3.16, tiles z0 to z14, CORS open) points at the current weekly build; the three Noto Sans
 * glyph stacks below answer.
 */
export const TILEJSON_URL = 'https://tiles.openfreemap.org/planet';
export const GLYPHS_URL = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';

// copy:ignore (font stacks on the glyph server, not words)
const FONT = { regular: ['Noto Sans Regular'], bold: ['Noto Sans Bold'], italic: ['Noto Sans Italic'] };

// copy:ignore (a CSS font: the clusters' numbers are carved in Cinzel, like every number in the kit)
export const CARVED_FONT = '700 13px Cinzel, Georgia, serif';

// copy:ignore (a geometry type)
const POINT = 'Point';

/** Names in Latin script where the map has them (Seyðisfjörður stays Seyðisfjörður), else the local name. */
const NAME: ExpressionSpecification = ['coalesce', ['get', 'name:latin'], ['get', 'name']];

interface Palette {
  land: string;
  wood: string;
  grass: string;
  sand: string;
  ice: string;
  wetland: string;
  park: string;
  town: string;
  water: string;
  river: string;
  coast: string;
  border: string;
  borderFaint: string;
  roadMajor: string;
  roadMid: string;
  roadMinor: string;
  rail: string;
  ferry: string;
  building: string;
  ink: string;
  inkSoft: string;
  inkMute: string;
  halo: string;
  waterLabel: string;
  waterHalo: string;
}

const NIGHT: Palette = {
  land: '#231b14',
  wood: '#262116',
  grass: '#251d15',
  sand: '#2d2418',
  ice: '#36383d',
  wetland: '#20201a',
  park: '#262015',
  town: '#2a2118',
  water: '#0a1220',
  river: '#0f1a2a',
  coast: 'rgba(201, 163, 98, 0.32)',
  border: 'rgba(201, 163, 98, 0.55)',
  borderFaint: 'rgba(201, 163, 98, 0.26)',
  roadMajor: 'rgba(214, 170, 100, 0.42)',
  roadMid: 'rgba(214, 170, 100, 0.28)',
  roadMinor: 'rgba(214, 170, 100, 0.15)',
  rail: 'rgba(207, 197, 180, 0.2)',
  ferry: 'rgba(143, 169, 192, 0.35)',
  building: 'rgba(96, 78, 58, 0.45)',
  ink: '#e9e1d3',
  inkSoft: '#cfc5b4',
  inkMute: '#b3aa9b',
  halo: 'rgba(10, 8, 6, 0.92)',
  waterLabel: '#8fa9c0',
  waterHalo: 'rgba(6, 12, 22, 0.9)',
};

const DAY: Palette = {
  land: '#efe5cd',
  wood: '#e2dbbd',
  grass: '#e8dfc3',
  sand: '#efe1bf',
  ice: '#f7f5ef',
  wetland: '#e1dfc9',
  park: '#e1dabb',
  town: '#e7dabd',
  water: '#a9bccb',
  river: '#9fb4c5',
  coast: 'rgba(60, 82, 102, 0.35)',
  border: 'rgba(74, 54, 32, 0.55)',
  borderFaint: 'rgba(74, 54, 32, 0.28)',
  roadMajor: 'rgba(74, 54, 32, 0.4)',
  roadMid: 'rgba(74, 54, 32, 0.27)',
  roadMinor: 'rgba(74, 54, 32, 0.15)',
  rail: 'rgba(42, 29, 16, 0.22)',
  ferry: 'rgba(40, 70, 96, 0.4)',
  building: 'rgba(140, 107, 61, 0.24)',
  ink: '#2a1d10',
  inkSoft: '#4a3620',
  inkMute: '#68512f',
  halo: 'rgba(248, 240, 220, 0.92)',
  waterLabel: '#3d5566',
  waterHalo: 'rgba(214, 226, 234, 0.75)',
};

const cls = (...values: string[]): ExpressionSpecification => ['match', ['get', 'class'], values, true, false];
const notTunnel: ExpressionSpecification = ['!=', ['get', 'brunnel'], 'tunnel'];
/** Line width growing with the zoom: [zoom, width] pairs. */
const widths = (...stops: [number, number][]): ExpressionSpecification =>
  ['interpolate', ['exponential', 1.4], ['zoom'], ...stops.flat()] as ExpressionSpecification;
const sizes = (...stops: [number, number][]): ExpressionSpecification => ['interpolate', ['linear'], ['zoom'], ...stops.flat()] as ExpressionSpecification;

/** The base map, night or day. Background, water, land, borders, faint roads, names; nothing to tap. */
export function loreMapStyle(half: MapHalf): StyleSpecification {
  const p = half === 'day' ? DAY : NIGHT;
  const source = 'openmaptiles';
  const textPaint = (color: string, halo = p.halo, width = 1.4) => ({ 'text-color': color, 'text-halo-color': halo, 'text-halo-width': width, 'text-halo-blur': 0.4 });

  const layers: LayerSpecification[] = [
    { id: 'background', type: 'background', paint: { 'background-color': p.land } },

    // Land: wood and grass a shade off the land, ice pale, towns faint.
    { id: 'landcover-wood', type: 'fill', source, 'source-layer': 'landcover', filter: cls('wood', 'forest'), paint: { 'fill-color': p.wood } },
    { id: 'landcover-grass', type: 'fill', source, 'source-layer': 'landcover', filter: cls('grass', 'farmland'), paint: { 'fill-color': p.grass, 'fill-opacity': 0.7 } },
    { id: 'landcover-wetland', type: 'fill', source, 'source-layer': 'landcover', filter: cls('wetland'), paint: { 'fill-color': p.wetland } },
    { id: 'landcover-sand', type: 'fill', source, 'source-layer': 'landcover', filter: cls('sand', 'rock'), paint: { 'fill-color': p.sand } },
    { id: 'landcover-ice', type: 'fill', source, 'source-layer': 'landcover', filter: cls('ice', 'glacier'), paint: { 'fill-color': p.ice } },
    { id: 'park', type: 'fill', source, 'source-layer': 'park', paint: { 'fill-color': p.park, 'fill-opacity': 0.8 } },
    {
      id: 'landuse-town',
      type: 'fill',
      source,
      'source-layer': 'landuse',
      minzoom: 8,
      filter: cls('residential', 'suburb', 'quarter', 'neighbourhood', 'commercial', 'retail', 'industrial'),
      paint: { 'fill-color': p.town, 'fill-opacity': sizes([8, 0], [10, 0.8]) },
    },

    // Water, its coasts, rivers.
    { id: 'water', type: 'fill', source, 'source-layer': 'water', filter: notTunnel, paint: { 'fill-color': p.water } },
    {
      id: 'waterway-river',
      type: 'line',
      source,
      'source-layer': 'waterway',
      filter: ['all', cls('river', 'canal'), notTunnel],
      paint: { 'line-color': p.river, 'line-width': widths([8, 0.8], [12, 2], [16, 5]) },
    },
    {
      id: 'waterway-stream',
      type: 'line',
      source,
      'source-layer': 'waterway',
      minzoom: 12,
      filter: ['all', cls('stream'), notTunnel],
      paint: { 'line-color': p.river, 'line-width': widths([12, 0.6], [16, 1.6]) },
    },
    {
      id: 'water-coast',
      type: 'line',
      source,
      'source-layer': 'water',
      filter: notTunnel,
      paint: { 'line-color': p.coast, 'line-width': widths([0, 0.4], [6, 0.8], [12, 1.2]) },
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

    // Borders: dashed. Sea borders are left out.
    {
      id: 'boundary-state',
      type: 'line',
      source,
      'source-layer': 'boundary',
      minzoom: 3,
      filter: ['all', ['>=', ['get', 'admin_level'], 3], ['<=', ['get', 'admin_level'], 4], ['!=', ['get', 'maritime'], 1]],
      paint: { 'line-color': p.borderFaint, 'line-width': widths([3, 0.5], [10, 1.2]), 'line-dasharray': [2, 2] },
    },
    {
      id: 'boundary-country',
      type: 'line',
      source,
      'source-layer': 'boundary',
      filter: ['all', ['==', ['get', 'admin_level'], 2], ['!=', ['get', 'maritime'], 1]],
      paint: { 'line-color': p.border, 'line-width': widths([1, 0.6], [6, 1.1], [12, 1.8]), 'line-dasharray': [3, 2] },
    },

    // Roads: faint brass (by day, faint ink); the small ones only close in. Ferries are a dashed sea line.
    {
      id: 'road-ferry',
      type: 'line',
      source,
      'source-layer': 'transportation',
      minzoom: 6,
      filter: cls('ferry'),
      paint: { 'line-color': p.ferry, 'line-width': widths([6, 0.6], [12, 1.4]), 'line-dasharray': [3, 3] },
    },
    {
      id: 'road-minor',
      type: 'line',
      source,
      'source-layer': 'transportation',
      minzoom: 12,
      filter: cls('minor', 'service', 'track', 'path'),
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': p.roadMinor, 'line-width': widths([12, 0.5], [16, 3]) },
    },
    {
      id: 'road-mid',
      type: 'line',
      source,
      'source-layer': 'transportation',
      minzoom: 8,
      filter: cls('secondary', 'tertiary'),
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': p.roadMid, 'line-width': widths([8, 0.4], [12, 1.2], [16, 5]) },
    },
    {
      id: 'road-major',
      type: 'line',
      source,
      'source-layer': 'transportation',
      minzoom: 5,
      filter: cls('motorway', 'trunk', 'primary'),
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': p.roadMajor, 'line-width': widths([5, 0.4], [10, 1.4], [16, 7]) },
    },
    {
      id: 'rail',
      type: 'line',
      source,
      'source-layer': 'transportation',
      minzoom: 10,
      filter: cls('rail'),
      paint: { 'line-color': p.rail, 'line-width': widths([10, 0.6], [16, 1.6]), 'line-dasharray': [2, 2] },
    },

    // Names: water in italics, peaks close in, then the places from small to large (the large win collisions).
    {
      id: 'water-name-ocean',
      type: 'symbol',
      source,
      'source-layer': 'water_name',
      filter: ['all', ['==', ['geometry-type'], POINT], cls('ocean', 'sea')],
      layout: {
        'text-field': NAME,
        'text-font': FONT.italic,
        'text-size': sizes([1, 11], [6, 15]),
        'text-letter-spacing': 0.18,
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
      layout: { 'text-field': NAME, 'text-font': FONT.italic, 'text-size': 12, 'text-max-width': 6 },
      paint: textPaint(p.waterLabel, p.waterHalo, 1),
    },
    {
      id: 'peak',
      type: 'symbol',
      source,
      'source-layer': 'mountain_peak',
      minzoom: 11,
      layout: { 'text-field': NAME, 'text-font': FONT.italic, 'text-size': 11.5, 'text-max-width': 7 },
      paint: textPaint(p.inkMute),
    },
    {
      id: 'place-hamlet',
      type: 'symbol',
      source,
      'source-layer': 'place',
      minzoom: 12,
      filter: cls('hamlet', 'suburb', 'neighbourhood', 'quarter', 'isolated_dwelling', 'locality'),
      layout: { 'text-field': NAME, 'text-font': FONT.regular, 'text-size': 11.5, 'text-max-width': 7 },
      paint: textPaint(p.inkMute),
    },
    {
      id: 'place-village',
      type: 'symbol',
      source,
      'source-layer': 'place',
      minzoom: 10,
      filter: cls('village'),
      layout: { 'text-field': NAME, 'text-font': FONT.regular, 'text-size': sizes([10, 11], [14, 14]), 'text-max-width': 7 },
      paint: textPaint(p.inkSoft),
    },
    {
      id: 'place-town',
      type: 'symbol',
      source,
      'source-layer': 'place',
      minzoom: 6,
      filter: cls('town'),
      layout: { 'text-field': NAME, 'text-font': FONT.regular, 'text-size': sizes([6, 11], [12, 15]), 'text-max-width': 7 },
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
        'text-field': NAME,
        'text-font': FONT.regular,
        'text-size': sizes([4, 11], [8, 15], [12, 19]),
        'text-max-width': 7,
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
        'text-font': FONT.regular,
        'text-size': sizes([4, 9.5], [8, 12]),
        'text-transform': 'uppercase',
        'text-letter-spacing': 0.12,
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
        'text-font': FONT.bold,
        'text-size': sizes([1, 9.5], [4, 13], [7, 17]),
        'text-transform': 'uppercase',
        'text-letter-spacing': 0.14,
        'text-max-width': 7,
        'symbol-sort-key': ['coalesce', ['get', 'rank'], 99],
      },
      paint: textPaint(p.ink, p.halo, 1.6),
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
          ['literal', ['Africa', 'Antarctica', 'Asia', 'Europe', 'North America', 'South America', 'Oceania', 'Australia']],
        ],
      ],
      layout: { 'text-field': NAME, 'text-font': FONT.bold, 'text-size': 11, 'text-transform': 'uppercase', 'text-letter-spacing': 0.3 },
      paint: textPaint(p.inkSoft, p.halo, 1.4),
    },
  ];

  return {
    version: 8,
    name: half === 'day' ? 'lore-day' : 'lore-night',
    glyphs: GLYPHS_URL,
    sources: { [source]: { type: 'vector', url: TILEJSON_URL } },
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
