import { desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { CreateCommentInput, type Comment } from '#shared';
import { requireUser, type AppContext } from '../context.ts';
import type { Db } from '../db/index.ts';
import { comments, users } from '../db/schema.ts';
import {
  chapterPerson,
  eventParticipant,
  idParam,
  isCrewAdmin,
  loadVisibleChapter,
  loadVisibleEvent,
  loadVisibleIdea,
} from '../lib/access.ts';
import { forbidden, notFound } from '../lib/errors.ts';
import { iso, toUserSummary, userColumns } from '../lib/queries.ts';
import { parse } from '../lib/validate.ts';

/**
 * One discussion thread per event, idea and chapter. Reading and writing follow the
 * thread's parent; moderators are the parent's organizers.
 */
const targets = {
  events: {
    column: comments.eventId,
    load: loadVisibleEvent,
    isModerator: async (db: Db, id: string, userId: string) =>
      (await eventParticipant(db, id, userId))?.role === 'organizer',
  },
  ideas: {
    column: comments.ideaId,
    load: loadVisibleIdea,
    isModerator: async (db: Db, id: string, userId: string) => {
      const idea = await loadVisibleIdea(db, userId, id);
      return idea.createdBy === userId || (!!idea.crewId && (await isCrewAdmin(db, idea.crewId, userId)));
    },
  },
  chapters: {
    column: comments.chapterId,
    load: loadVisibleChapter,
    isModerator: async (db: Db, id: string, userId: string) => {
      const chapter = await loadVisibleChapter(db, userId, id);
      return chapter.createdBy === userId || (await chapterPerson(db, id, userId))?.role === 'organizer';
    },
  },
} as const;

type TargetKind = keyof typeof targets;

export async function commentRoutes(app: FastifyInstance, { db }: AppContext) {
  async function thread(kind: TargetKind, targetId: string, viewerId: string): Promise<Comment[]> {
    const target = targets[kind];
    const moderator = await target.isModerator(db, targetId, viewerId);
    const rows = await db
      .select({ id: comments.id, body: comments.body, createdAt: comments.createdAt, authorId: comments.authorId, author: userColumns })
      .from(comments)
      .innerJoin(users, eq(users.id, comments.authorId))
      .where(eq(target.column, targetId))
      .orderBy(desc(comments.createdAt))
      .limit(200);
    return rows.reverse().map((r) => ({
      id: r.id,
      body: r.body,
      createdAt: iso(r.createdAt),
      author: toUserSummary(r.author),
      canDelete: r.authorId === viewerId || moderator,
    }));
  }

  for (const kind of Object.keys(targets) as TargetKind[]) {
    app.get(`/${kind}/:id/comments`, async (req) => {
      const me = requireUser(req);
      const id = idParam(req.params);
      await targets[kind].load(db, me, id);
      return thread(kind, id, me);
    });

    app.post(`/${kind}/:id/comments`, { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
      const me = requireUser(req);
      const id = idParam(req.params);
      await targets[kind].load(db, me, id);
      const { body } = parse(CreateCommentInput, req.body);
      const column = kind === 'events' ? 'eventId' : kind === 'ideas' ? 'ideaId' : 'chapterId';
      await db.insert(comments).values({ authorId: me, body, [column]: id });
      reply.status(201);
      return thread(kind, id, me);
    });
  }

  app.delete('/comments/:id', async (req) => {
    const me = requireUser(req);
    const id = idParam(req.params);
    const [c] = await db.select().from(comments).where(eq(comments.id, id)).limit(1);
    if (!c) throw notFound('That comment');
    const kind: TargetKind = c.eventId ? 'events' : c.ideaId ? 'ideas' : 'chapters';
    const targetId = (c.eventId ?? c.ideaId ?? c.chapterId)!;
    await targets[kind].load(db, me, targetId);
    if (c.authorId !== me && !(await targets[kind].isModerator(db, targetId, me))) {
      throw forbidden('You can only delete your own comments.');
    }
    await db.delete(comments).where(eq(comments.id, id));
    return { ok: true };
  });
}
