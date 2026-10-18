import { QueryClient, useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import type {
  AppNotification,
  ChapterDetail,
  ChapterSummary,
  Comment,
  CrewDetail,
  CrewSummary,
  EventDetail,
  EventSummary,
  FriendRequest,
  HomeData,
  IdeaDetail,
  IdeaSummary,
  Me,
  PersonalEntry,
  PublicProfile,
  UserSearchResult,
  UserSummary,
} from '#shared';
import { api, ApiError, qs } from './api.ts';
import { todayISO } from './dates.ts';

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
