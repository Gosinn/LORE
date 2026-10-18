import { and, asc, desc, eq, ne, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  ConvertIdeaInput,
  CreateIdeaInput,
  IdeaListQuery,
  UpdateIdeaInput,
  type Audience,
  type IdeaDetail,
} from '#shared';
import { requireUser, type AppContext } from '../context.ts';
import type { Db } from '../db/index.ts';
import { eventParticipants, events, ideaInterest, ideas, users } from '../db/schema.ts';
import { idParam, isActiveCrewMember, isCrewAdmin, loadVisibleIdea } from '../lib/access.ts';
import { badRequest, forbidden, notFound } from '../lib/errors.ts';
import { notify } from '../lib/notify.ts';
import { eventSummaries, ideaSummaries, toUserSummary, userColumns, userSummary } from '../lib/queries.ts';
import { parse } from '../lib/validate.ts';
import { inviteToEvent } from './events.ts';

async function loadIdeaDetail(db: Db, viewerId: string, ideaId: string): Promise<IdeaDetail> {
  const [summary] = await ideaSummaries(db, viewerId, eq(ideas.id, ideaId));
  if (!summary) throw notFound('That idea');
  const [idea] = await db.select().from(ideas).where(eq(ideas.id, ideaId)).limit(1);
  const interested = await db
    .select(userColumns)
    .from(ideaInterest)
    .innerJoin(users, eq(users.id, ideaInterest.userId))
    .where(eq(ideaInterest.ideaId, ideaId))
    .orderBy(asc(ideaInterest.createdAt));
  return {
    ...summary,
    description: idea!.description,
    whereNote: idea!.whereNote,
    whenNote: idea!.whenNote,
    budgetNote: idea!.budgetNote,
    interested: interested.map(toUserSummary),
    events: await eventSummaries(db, viewerId, eq(events.ideaId, ideaId), { order: 'desc' }),
    canEdit: await canEditIdea(db, viewerId, idea!),
  };
}

async function canEditIdea(db: Db, userId: string, idea: { createdBy: string | null; crewId: string | null }) {
  if (idea.createdBy === userId) return true;
  return !!idea.crewId && (await isCrewAdmin(db, idea.crewId, userId));
}

/** Ideas don't know dates; their audience maps onto who sees the resulting event. */
const eventAudienceFor = (a: Audience): 'participants' | 'friends' | 'crew' =>
  a === 'crew' ? 'crew' : a === 'friends' ? 'friends' : 'participants';

export async function ideaRoutes(app: FastifyInstance, { db }: AppContext) {
  async function requireEditable(ideaId: string, userId: string) {
    const idea = await loadVisibleIdea(db, userId, ideaId);
    if (!(await canEditIdea(db, userId, idea))) throw forbidden('Only whoever added the idea can change it.');
    return idea;
  }

  /** The Idea Vault: open ideas first, then the ones already done. */
  app.get('/ideas', async (req) => {
    const me = requireUser(req);
    const q = parse(IdeaListQuery, req.query);
    return ideaSummaries(
      db,
      me,
      and(
        q.crewId ? eq(ideas.crewId, q.crewId) : undefined,
        q.includeArchived === 'true' ? undefined : ne(ideas.status, 'archived'),
      ),
      {
        orderBy: [
          sql`case ${ideas.status} when 'planning' then 0 when 'gathering_interest' then 1 when 'dreaming' then 2 when 'scheduled' then 3 when 'completed' then 4 else 5 end`,
          desc(ideas.createdAt),
        ],
      },
    );
  });

  app.post('/ideas', async (req, reply) => {
    const me = requireUser(req);
    const input = parse(CreateIdeaInput, req.body);
    if (input.crewId && !(await isActiveCrewMember(db, input.crewId, me))) {
      throw badRequest("You're not in that crew.", { crewId: 'Not your crew' });
    }
    const [idea] = await db
      .insert(ideas)
      .values({
        title: input.title,
        description: input.description ?? null,
        category: input.category ?? 'custom',
        status: input.status ?? 'dreaming',
        crewId: input.crewId ?? null,
        audience: input.audience ?? (input.crewId ? 'crew' : 'only_me'),
        whereNote: input.whereNote ?? null,
        whenNote: input.whenNote ?? null,
        budgetNote: input.budgetNote ?? null,
        createdBy: me,
      })
      .returning({ id: ideas.id });
    reply.status(201);
    return loadIdeaDetail(db, me, idea!.id);
  });

  app.get('/ideas/:id', async (req) => loadIdeaDetail(db, requireUser(req), idParam(req.params)));

  app.patch('/ideas/:id', async (req) => {
    const me = requireUser(req);
    const ideaId = idParam(req.params);
    const idea = await requireEditable(ideaId, me);
    const input = parse(UpdateIdeaInput, req.body);
    const crewId = input.crewId === undefined ? idea.crewId : input.crewId;
    if ((input.audience ?? idea.audience) === 'crew' && !crewId) {
      throw badRequest('Pick a crew to share with the crew', { crewId: 'Required' });
    }
    if (input.crewId && input.crewId !== idea.crewId && !(await isActiveCrewMember(db, input.crewId, me))) {
      throw badRequest("You're not in that crew.", { crewId: 'Not your crew' });
    }
    await db
      .update(ideas)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(ideas.id, ideaId));
    return loadIdeaDetail(db, me, ideaId);
  });

  app.delete('/ideas/:id', async (req) => {
    const me = requireUser(req);
    const ideaId = idParam(req.params);
    await requireEditable(ideaId, me);
    await db.delete(ideas).where(eq(ideas.id, ideaId));
    return { ok: true };
  });

  app.post('/ideas/:id/interest', async (req) => {
    const me = requireUser(req);
    const ideaId = idParam(req.params);
    const idea = await loadVisibleIdea(db, me, ideaId);
    await db.insert(ideaInterest).values({ ideaId, userId: me }).onConflictDoNothing();
    // The first "I'm in" moves a daydream along on its own.
    if (idea.status === 'dreaming' && idea.createdBy !== me) {
      await db.update(ideas).set({ status: 'gathering_interest', updatedAt: new Date() }).where(eq(ideas.id, ideaId));
    }
    return loadIdeaDetail(db, me, ideaId);
  });

  app.delete('/ideas/:id/interest', async (req) => {
    const me = requireUser(req);
    const ideaId = idParam(req.params);
    await loadVisibleIdea(db, me, ideaId);
    await db.delete(ideaInterest).where(and(eq(ideaInterest.ideaId, ideaId), eq(ideaInterest.userId, me)));
    return loadIdeaDetail(db, me, ideaId);
  });

  /**
   * IDEA → EVENT. Everything the idea already knows carries over; the only new
   * information is when. Interested people are invited automatically.
   */
  app.post('/ideas/:id/convert', async (req, reply) => {
    const me = requireUser(req);
    const ideaId = idParam(req.params);
    const idea = await requireEditable(ideaId, me);
    const input = parse(ConvertIdeaInput, req.body);
    const crewId = idea.crewId && (await isActiveCrewMember(db, idea.crewId, me)) ? idea.crewId : null;
    const audience = input.audience ?? eventAudienceFor(idea.audience);
    if (audience === 'crew' && !crewId) throw badRequest('This idea has no crew to share the event with.');

    const eventId = await db.transaction(async (tx) => {
      const [event] = await tx
        .insert(events)
        .values({
          title: input.title ?? idea.title,
          description: idea.description,
          category: idea.category,
          status: 'planning',
          startsAt: new Date(input.startsAt),
          endsAt: input.endsAt ? new Date(input.endsAt) : null,
          allDay: input.allDay ?? false,
          timeZone: input.timeZone,
          locationName: input.locationName === undefined ? idea.whereNote : input.locationName,
          crewId,
          audience,
          ideaId,
          createdBy: me,
        })
        .returning({ id: events.id });
      await tx.insert(eventParticipants).values({
        eventId: event!.id,
        userId: me,
        role: 'organizer',
        rsvp: 'going',
        respondedAt: new Date(),
      });
      await tx.update(ideas).set({ status: 'scheduled', updatedAt: new Date() }).where(eq(ideas.id, ideaId));
      return event!.id;
    });

    let invited: string[] = [];
    if (input.inviteInterested ?? true) {
      const interested = await db
        .select({ userId: ideaInterest.userId })
        .from(ideaInterest)
        .where(eq(ideaInterest.ideaId, ideaId));
      // People who said they're in could already see the idea; still respect blocks.
      invited = await inviteToEvent(db, eventId, me, interested.map((i) => i.userId), { skipUnreachable: true });
    }
    const actor = await userSummary(db, me);
    await notify(db, invited, {
      type: 'idea_scheduled',
      actorId: me,
      title: `${actor?.displayName} turned “${idea.title}” into a plan`,
      href: `/events/${eventId}`,
    });
    reply.status(201);
    return { eventId };
  });
}

