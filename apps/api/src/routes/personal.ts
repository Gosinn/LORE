import { and, asc, eq, gte, lt, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { PersonalEntryInput, PersonalRangeQuery, type PersonalEntry } from '#shared';
import { requireUser, type AppContext } from '../context.ts';
import { personalEntries } from '../db/schema.ts';
import { idParam } from '../lib/access.ts';
import { notFound } from '../lib/errors.ts';
import { iso, isoOrNull } from '../lib/queries.ts';
import { parse } from '../lib/validate.ts';

const present = (e: typeof personalEntries.$inferSelect): PersonalEntry => ({
  id: e.id,
  title: e.title,
  startsAt: iso(e.startsAt),
  endsAt: isoOrNull(e.endsAt),
  allDay: e.allDay,
  notes: e.notes,
});

/**
 * The personal calendar. Every query is scoped to the owner, and nothing else in
 * the API reads this table: private appointments never leak into shared views.
 */
export async function personalRoutes(app: FastifyInstance, { db }: AppContext) {
  const own = (userId: string, id: string) => and(eq(personalEntries.id, id), eq(personalEntries.userId, userId));

  app.get('/personal', async (req) => {
    const me = requireUser(req);
    const q = parse(PersonalRangeQuery, req.query);
    const rows = await db
      .select()
      .from(personalEntries)
      .where(
        and(
          eq(personalEntries.userId, me),
          lt(personalEntries.startsAt, new Date(q.to)),
          gte(sql`coalesce(${personalEntries.endsAt}, ${personalEntries.startsAt})`, new Date(q.from)),
        ),
      )
      .orderBy(asc(personalEntries.startsAt));
    return rows.map(present);
  });

  app.post('/personal', async (req, reply) => {
    const me = requireUser(req);
    const input = parse(PersonalEntryInput, req.body);
    const [row] = await db
      .insert(personalEntries)
      .values({
        userId: me,
        title: input.title,
        startsAt: new Date(input.startsAt),
        endsAt: input.endsAt ? new Date(input.endsAt) : null,
        allDay: input.allDay ?? false,
        notes: input.notes ?? null,
      })
      .returning();
    reply.status(201);
    return present(row!);
  });

  app.put('/personal/:id', async (req) => {
    const me = requireUser(req);
    const id = idParam(req.params);
    const input = parse(PersonalEntryInput, req.body);
    const [row] = await db
      .update(personalEntries)
      .set({
        title: input.title,
        startsAt: new Date(input.startsAt),
        endsAt: input.endsAt ? new Date(input.endsAt) : null,
        allDay: input.allDay ?? false,
        notes: input.notes ?? null,
        updatedAt: new Date(),
      })
      .where(own(me, id))
      .returning();
    if (!row) throw notFound('That entry');
    return present(row);
  });

  app.delete('/personal/:id', async (req) => {
    const me = requireUser(req);
    const id = idParam(req.params);
    const deleted = await db.delete(personalEntries).where(own(me, id)).returning({ id: personalEntries.id });
    if (!deleted.length) throw notFound('That entry');
    return { ok: true };
  });
}
