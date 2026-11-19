// The Lore Map (docs/DECISIONS.md D35): your places, plans and memories on a map. Everything is
// filtered and rounded for the viewer in lib/queries.ts (mapFeatures) through the rules in
// lib/access.ts; this route only checks who is asking and which crew.
import type { FastifyInstance } from 'fastify';
import { MapQuery, type MapResponse } from '#shared';
import { requireUser, type AppContext } from '../context.ts';
import { isActiveCrewMember } from '../lib/access.ts';
import { notFound } from '../lib/errors.ts';
import { mapFeatures } from '../lib/queries.ts';
import { parse } from '../lib/validate.ts';

export async function mapRoutes(app: FastifyInstance, { db }: AppContext) {
  /** GET /map?mode=mine|crew|memories|adventures&crew=<id>. A crew you're not an active member of is a 404. */
  app.get('/map', async (req): Promise<MapResponse> => {
    const me = requireUser(req);
    const q = parse(MapQuery, req.query);
    if (q.mode === 'crew' && !(await isActiveCrewMember(db, q.crew!, me))) throw notFound('That crew');
    return mapFeatures(db, me, { mode: q.mode, crewId: q.mode === 'crew' ? q.crew : undefined });
  });
}
