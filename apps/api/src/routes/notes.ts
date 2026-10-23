import { and, asc, desc, eq, isNotNull, isNull, lte, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { CreateNoteInput, UpdateNoteInput, type Note, type NotesData } from '#shared';
import { requireUser, type AppContext } from '../context.ts';
import type { Db } from '../db/index.ts';
import { events, notes } from '../db/schema.ts';
import { idParam, loadVisibleEvent } from '../lib/access.ts';
import { notFound } from '../lib/errors.ts';
import { iso, isoOrNull } from '../lib/queries.ts';
import { parse } from '../lib/validate.ts';

/** The owner's notes matching `where`. Nobody else's notes are ever reachable. */
export async function listNotes(db: Db, userId: string, where: SQL | undefined, order: SQL[], limit: number): Promise<Note[]> {
  const rows = await db
    .select({ n: notes, eventId: events.id, eventTitle: events.title })
    .from(notes)
    .leftJoin(events, eq(events.id, notes.eventId))
    .where(and(eq(notes.userId, userId), where))
    .orderBy(...order)
    .limit(limit);
  return rows.map(({ n, eventId, eventTitle }) => ({
    id: n.id,
    body: n.body,
    remindAt: isoOrNull(n.remindAt),
    doneAt: isoOrNull(n.doneAt),
    pinned: n.pinned,
    event: eventId && eventTitle ? { id: eventId, title: eventTitle } : null,
    createdAt: iso(n.createdAt),
    updatedAt: iso(n.updatedAt),
  }));
}

/** Open reminders due within the next day (overdue ones included), for Home. */
export function upcomingReminders(db: Db, userId: string) {
  const soon = new Date(Date.now() + 24 * 60 * 60 * 1000);
  return listNotes(db, userId, and(isNull(notes.doneAt), isNotNull(notes.remindAt), lte(notes.remindAt, soon)), [asc(notes.remindAt)], 5);
}

/**
 * Notes to self and reminders. Like the personal calendar, these belong to one
 * person only: every query is scoped to the signed-in owner.
 */
export async function noteRoutes(app: FastifyInstance, { db }: AppContext) {
  async function loadOwn(userId: string, id: string) {
    const [row] = await db
      .select({ id: notes.id })
      .from(notes)
      .where(and(eq(notes.id, id), eq(notes.userId, userId)))
      .limit(1);
    if (!row) throw notFound('That note');
  }

  async function one(userId: string, id: string): Promise<Note> {
    const [note] = await listNotes(db, userId, eq(notes.id, id), [asc(notes.createdAt)], 1);
    if (!note) throw notFound('That note');
    return note;
  }

  app.get('/notes', async (req): Promise<NotesData> => {
    const me = requireUser(req);
    const [reminders, plain, done] = await Promise.all([
      listNotes(db, me, and(isNull(notes.doneAt), isNotNull(notes.remindAt)), [asc(notes.remindAt)], 200),
      listNotes(db, me, and(isNull(notes.doneAt), isNull(notes.remindAt)), [desc(notes.pinned), desc(notes.createdAt)], 200),
      listNotes(db, me, isNotNull(notes.doneAt), [desc(notes.doneAt)], 10),
    ]);
    return { reminders, notes: plain, done };
  });

  app.post('/notes', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (req, reply) => {
    const me = requireUser(req);
    const input = parse(CreateNoteInput, req.body);
    if (input.eventId) await loadVisibleEvent(db, me, input.eventId);
    const [row] = await db
      .insert(notes)
      .values({
        userId: me,
        body: input.body,
        remindAt: input.remindAt ? new Date(input.remindAt) : null,
        pinned: input.pinned ?? false,
        eventId: input.eventId ?? null,
      })
      .returning({ id: notes.id });
    reply.status(201);
    return one(me, row!.id);
  });

  app.patch('/notes/:id', async (req) => {
    const me = requireUser(req);
    const id = idParam(req.params);
    await loadOwn(me, id);
    const input = parse(UpdateNoteInput, req.body);
    await db
      .update(notes)
      .set({
        body: input.body,
        remindAt: input.remindAt === undefined ? undefined : input.remindAt ? new Date(input.remindAt) : null,
        pinned: input.pinned,
        doneAt: input.done === undefined ? undefined : input.done ? sql`now()` : null,
        updatedAt: new Date(),
      })
      .where(and(eq(notes.id, id), eq(notes.userId, me)));
    return one(me, id);
  });

  app.delete('/notes/:id', async (req) => {
    const me = requireUser(req);
    const id = idParam(req.params);
    await loadOwn(me, id);
    await db.delete(notes).where(and(eq(notes.id, id), eq(notes.userId, me)));
    return { ok: true };
  });
}
