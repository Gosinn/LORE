// The Loracle, phases B and C, as the web app reads a wish: its roads ("Ask again"), the deeper asks pinned
// to its waypoints, the dawn lane, and crew quests (shown to a crew, walkers). Shapes: #shared (Wish,
// WishScroll, DeeperView, EpicView). These helpers stay tolerant of a phase A server mid-deploy (no `roads`,
// no `asks`/`walkers` on waypoints).
import { ROAD_IN_PROGRESS, type DeeperView, type UserSummary, type Waypoint, type Wish, type WishScroll } from '#shared';

const IN_PROGRESS: readonly string[] = ROAD_IN_PROGRESS;

/** A road still being drawn (or waiting its turn, or waiting for dawn). */
export const roadInProgress = (r: WishScroll) => IN_PROGRESS.includes(r.status);

/** A road written down for the dawn lane and not yet drawn. */
export const roadAtDawn = (r: WishScroll) => r.lane === 'dawn' && roadInProgress(r);

/** Every road of a wish, first road first. */
export function roadsOf(w: Wish): WishScroll[] {
  const roads = w.roads as WishScroll[] | undefined;
  return roads?.length ? [...roads].sort((a, b) => a.n - b.n) : [w.road];
}

/** The deeper asks pinned to a waypoint, oldest first (only ever the Lorer's own). */
export const asksOf = (wp: Waypoint): DeeperView[] => (wp.state === 'sealed' ? [] : (wp.asks ?? []));

/** Who walks a waypoint with the Lorer (crew members). */
export const walkersOf = (wp: Waypoint): UserSummary[] => (wp.state === 'sealed' ? [] : (wp.walkers ?? []));

/** False only when the server says this quest is someone else's (a crew member reading it). */
export const isMine = (w: Wish) => w.mine !== false;

/** The crew a quest is shown to, if any. */
export const sharedCrew = (w: Wish) => (w.audience === 'crew' ? w.crew : null);

const inkedOn = (r: WishScroll) => r.map.filter((wp) => wp.state === 'inked').length;

/**
 * The road the Lorer walks: the one walked furthest (most waypoints inked; ties: the first), as the server
 * counts a quest's "3 of 6 inked" and draws its epic. Of "Two roads", this is the one the quest keeps.
 */
export function walkedRoad(w: Wish): WishScroll {
  let best = roadsOf(w)[0]!;
  for (const r of roadsOf(w)) if (inkedOn(r) > inkedOn(best)) best = r;
  return best;
}

/** The road has a waypoint inked: it is the Lorer's road, not only a road drawn. */
export const roadWalked = (r: WishScroll) => inkedOn(r) > 0;

/**
 * Which road a quest page shows: the one picked ('newest' right after "Ask again"), else the newest still
 * being drawn now (so its wait shows), else the road walked furthest.
 */
export function pickRoad(w: Wish, picked: string | null): WishScroll {
  const roads = roadsOf(w);
  if (picked === 'newest') return roads[roads.length - 1]!;
  const chosen = picked ? roads.find((r) => r.id === picked) : undefined;
  if (chosen) return chosen;
  const drawing = [...roads].reverse().find((r) => roadInProgress(r) && !roadAtDawn(r));
  return drawing ?? walkedRoad(w);
}

/** True while any deeper ask on any road is being answered now (not at dawn). */
export const asksListening = (w: Wish) => roadsOf(w).some((r) => r.map.some((wp) => asksOf(wp).some((a) => a.status === 'listening')));

/** True while a deeper ask waits for dawn. */
export const asksAtDawn = (w: Wish) => roadsOf(w).some((r) => r.map.some((wp) => asksOf(wp).some((a) => a.status === 'dawn')));
