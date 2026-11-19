import { QueryClient, useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import type {
  AppNotification,
  AskResult,
  CareView,
  ChapterDetail,
  ChapterSummary,
  Comment,
  CrewDetail,
  CrewSummary,
  DeeperView,
  EpicView,
  EventDetail,
  EventSummary,
  FriendRequest,
  HomeData,
  IdeaDetail,
  IdeaSummary,
  Me,
  ModerationSummary,
  LoracleState,
  NotesData,
  OracleSign,
  PersonalEntry,
  PublicProfile,
  RoadStatus,
  ShareWishInput,
  UserSearchResult,
  UserSummary,
  Wish,
} from '#shared';
import { ROAD_IN_PROGRESS } from '#shared';
import { api, ApiError, qs } from './api.ts';
import { todayISO } from './dates.ts';
import { asksAtDawn, asksListening, roadAtDawn, roadsOf } from './loracle.ts';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 20_000,
      retry: (count, err) => !(err instanceof ApiError && err.status > 0 && err.status < 500) && count < 2,
    },
  },
});

export const useMe = () =>
  useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return await api.get<Me>('/auth/me');
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: Infinity,
  });

export const useHome = () => useQuery({ queryKey: ['home'], queryFn: () => api.get<HomeData>(`/home${qs({ today: todayISO() })}`) });

export const useEvents = (from: string, to: string, crewId?: string) =>
  useQuery({
    queryKey: ['events', from, to, crewId],
    queryFn: () => api.get<EventSummary[]>(`/events${qs({ from, to, crewId })}`),
  });

export const useEvent = (id: string) => useQuery({ queryKey: ['event', id], queryFn: () => api.get<EventDetail>(`/events/${id}`) });

export const usePersonal = (from: string, to: string, enabled = true) =>
  useQuery({
    queryKey: ['personal', from, to],
    queryFn: () => api.get<PersonalEntry[]>(`/personal${qs({ from, to })}`),
    enabled,
  });

/**
 * The Loracle: the stone's mind (awake, asleep or fake), consent, the stone's questions, this week's
 * examples and the quest log. Cheap: the server reads its own tables (and wakes any moon wishes).
 * The old Futures screens (/oracle, /oracle/readings) are no longer called by the web app; only the
 * daily sign below uses that engine.
 */
export const useLoracle = () => useQuery({ queryKey: ['loracle'], queryFn: () => api.get<LoracleState>('/loracle') });

/**
 * The daily sign on Home's Loracle door: one future near where the Lorer stands (GET /oracle/sign).
 * The first ask of their day deals it, which can take a few seconds; Home shows the plain door meanwhile.
 * Answered with the future endpoints (choose / dismiss), which refresh it like any write.
 */
export const useOracleSign = () =>
  useQuery({ queryKey: ['oracle-sign'], queryFn: () => api.get<OracleSign>('/oracle/sign'), staleTime: 5 * 60_000 });

const DRAWING: readonly RoadStatus[] = [...ROAD_IN_PROGRESS, 'ready'];

/**
 * How often to ask about a wish: every 2 s while a road is drawn (until the pins are sealed) or the stone
 * answers a deeper ask; once a minute under the moon or while something waits for dawn.
 */
export function wishPollMs(wish: Wish | undefined): number | false {
  if (!wish) return false;
  if (wish.status === 'moon') return 60_000;
  const roads = roadsOf(wish);
  if (roads.some((r) => DRAWING.includes(r.status) && !roadAtDawn(r)) || asksListening(wish)) return 2_000;
  return roads.some(roadAtDawn) || asksAtDawn(wish) ? 60_000 : false;
}

/** One wish and its road. `background` keeps polling in a hidden tab (for "Tell me when it's sealed"). */
export const useWish = (id: string, background = false) =>
  useQuery({
    queryKey: ['wish', id],
    queryFn: () => api.get<Wish>(`/loracle/wishes/${id}`),
    refetchInterval: (q) => wishPollMs(q.state.data),
    refetchIntervalInBackground: background,
  });

/**
 * The Epic of a fulfilled quest (GET /loracle/wishes/:id/epic): its map, every inked waypoint with the chapter
 * the viewer may read. For the Lorer, and for the crew it was shown to. 409 `not_fulfilled` before it came true.
 */
export const useEpic = (id: string) => useQuery({ queryKey: ['epic', id], queryFn: () => api.get<EpicView>(`/loracle/wishes/${id}/epic`) });

/** A Loracle deed that answers with the whole wish (as the viewer may see it): the quest page takes it at once. */
const wishEntry = (w: Wish): [QueryKey, unknown] | null => (w && typeof w === 'object' && 'roads' in w ? [['wish', w.id], w] : null);

/** "Ask again" (phase B): another road for the same wish (202 Wish; it may wait for dawn). Only the Lorer. */
export const useAskAgain = (wishId: string, onAsked?: () => void) =>
  useAction(() => api.post<Wish>(`/loracle/wishes/${wishId}/again`), { set: wishEntry, onSuccess: () => onAsked?.() });

/**
 * "Ask the stone about this" (phase B): a deeper ask on an open waypoint, with an optional question (202
 * DeeperView; the wish is then polled while it is answered). Only the Lorer. A question at the care floor
 * comes back as the care screen instead (200 { route: 'care' }; nothing was stored or sent).
 */
export const useAskStone = (waypointId: string, on: { asked?: (ask: DeeperView) => void; care?: (care: CareView) => void } = {}) =>
  useAction((question: string | null) => api.post<AskResult>(`/loracle/waypoints/${waypointId}/ask`, { question }), {
    onSuccess: (r) => {
      if ('route' in r) on.care?.(r.care);
      else on.asked?.(r);
    },
  });

/** "Show to a crew" / "Keep it to myself again" (phase C). Only the Lorer; one crew they are an active member of. */
export const useShareWish = (wishId: string, onShared?: () => void) =>
  useAction((body: ShareWishInput) => api.put<Wish>(`/loracle/wishes/${wishId}/share`, body), { set: wishEntry, onSuccess: () => onShared?.() });

/** "Walk with you" (true) / "Walk no more" (false) on an open waypoint of a quest shown to the viewer's crew (phase C). */
export const useWalk = (waypointId: string) =>
  useAction((on: boolean) => (on ? api.post<Wish>(`/loracle/waypoints/${waypointId}/walk`) : api.del<Wish>(`/loracle/waypoints/${waypointId}/walk`)), {
    set: wishEntry,
  });

/** Moderators only. */
export const useModerationSummary = (enabled: boolean) =>
  useQuery({ queryKey: ['admin', 'summary'], queryFn: () => api.get<ModerationSummary>('/admin/summary'), enabled });

export const useNotes = (enabled = true) =>
  useQuery({ queryKey: ['notes'], queryFn: () => api.get<NotesData>('/notes'), enabled });

export const useIdeas = (crewId?: string, includeArchived = false) =>
  useQuery({
    queryKey: ['ideas', crewId, includeArchived],
    queryFn: () => api.get<IdeaSummary[]>(`/ideas${qs({ crewId, includeArchived: includeArchived ? 'true' : undefined })}`),
  });

export const useIdea = (id: string) => useQuery({ queryKey: ['idea', id], queryFn: () => api.get<IdeaDetail>(`/ideas/${id}`) });

export interface ChapterFilters {
  crewId?: string;
  personId?: string;
  year?: number;
  q?: string;
}
export const useChapters = (f: ChapterFilters) =>
  useQuery({
    queryKey: ['chapters', f],
    queryFn: () => api.get<ChapterSummary[]>(`/chapters${qs({ ...f })}`),
  });

export const useChapter = (id: string) =>
  useQuery({ queryKey: ['chapter', id], queryFn: () => api.get<ChapterDetail>(`/chapters/${id}`) });

export const useCrews = () => useQuery({ queryKey: ['crews'], queryFn: () => api.get<CrewSummary[]>('/crews') });
export const useCrew = (id: string | undefined) =>
  useQuery({ queryKey: ['crew', id], queryFn: () => api.get<CrewDetail>(`/crews/${id}`), enabled: !!id });

export const useFriends = () => useQuery({ queryKey: ['friends'], queryFn: () => api.get<UserSummary[]>('/friends') });
export const useFriendRequests = () =>
  useQuery({ queryKey: ['friend-requests'], queryFn: () => api.get<FriendRequest[]>('/friends/requests') });

export const useUserSearch = (q: string) =>
  useQuery({
    queryKey: ['user-search', q],
    queryFn: () => api.get<UserSearchResult[]>(`/users/search${qs({ q })}`),
    enabled: q.trim().length > 0,
  });

export const useProfile = (username: string) =>
  useQuery({ queryKey: ['profile', username], queryFn: () => api.get<PublicProfile>(`/users/${username}`) });

export const useNotifications = () =>
  useQuery({ queryKey: ['notifications'], queryFn: () => api.get<AppNotification[]>('/notifications') });

export const useUnreadCount = (enabled: boolean) =>
  useQuery({
    queryKey: ['unread'],
    queryFn: () => api.get<{ count: number }>('/notifications/unread-count'),
    enabled,
    refetchInterval: 60_000,
  });

export type CommentKind = 'events' | 'ideas' | 'chapters';
export const useComments = (kind: CommentKind, id: string) =>
  useQuery({ queryKey: ['comments', kind, id], queryFn: () => api.get<Comment[]>(`/${kind}/${id}/comments`) });

/**
 * A write. On success it refreshes whatever is on screen (everything except the
 * signed-in user), since one change, say an RSVP, shows up in several places.
 */
export function useAction<V, R>(
  fn: (vars: V) => Promise<R>,
  opts: { onSuccess?: (result: R, vars: V) => void; set?: (result: R, vars: V) => [QueryKey, unknown] | null } = {},
) {
  const qc = useQueryClient();
  return useMutation<R, ApiError, V>({
    mutationFn: fn,
    onSuccess: async (result, vars) => {
      const entry = opts.set?.(result, vars);
      if (entry) qc.setQueryData(entry[0], entry[1]);
      await qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'me' && (!entry || q.queryKey !== entry[0]) });
      opts.onSuccess?.(result, vars);
    },
  });
}
