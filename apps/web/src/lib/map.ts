// The Lore Map's data: GET /map and the "Show my places on maps" switch. Everything the server
// sends is already filtered and rounded for the signed-in Lorer (apps/api/src/lib/access.ts).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MapMode, MapResponse, Me } from '#shared';
import { api, ApiError, qs } from './api.ts';

/**
 * The map for a mode; `crewId` is needed (and only read) in crew mode. A crew you're not an
 * active member of answers 404 (ApiError status 404). Home, when set, is the first feature.
 */
export const useLoreMap = (mode: MapMode, crewId?: string) =>
  useQuery({
    queryKey: ['map', mode, mode === 'crew' ? (crewId ?? null) : null],
    queryFn: () => api.get<MapResponse>(`/map${qs({ mode, crew: mode === 'crew' ? crewId : undefined })}`),
    enabled: mode !== 'crew' || !!crewId,
  });

/** Turns "Show my places on maps" on or off (PATCH /me). Answers the updated Me. */
export function useShowPlaces() {
  const qc = useQueryClient();
  return useMutation<Me, ApiError, boolean>({
    mutationFn: (showPlaces) => api.patch<Me>('/me', { showPlaces }),
    onSuccess: async (me) => {
      qc.setQueryData(['me'], me);
      await qc.invalidateQueries({ queryKey: ['map'] });
    },
  });
}
