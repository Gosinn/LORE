import { and, asc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  CreateCrewInput,
  InviteUsersInput,
  UpdateCrewInput,
  UpdateCrewMemberInput,
  type CrewDetail,
  type CrewSummary,
} from '#shared';
import { requireUser, type AppContext } from '../context.ts';
import type { Db } from '../db/index.ts';
import { crewMembers, crews, users } from '../db/schema.ts';
import { canReach, crewMembership, idParam } from '../lib/access.ts';
import { badRequest, forbidden, notFound } from '../lib/errors.ts';
import { notify } from '../lib/notify.ts';
import { crewSummaries, isoOrNull, iso, toUserSummary, userColumns } from '../lib/queries.ts';
import { parse } from '../lib/validate.ts';

async function loadCrewDetail(db: Db, viewerId: string, crewId: string): Promise<CrewDetail> {
  const [summary] = await crewSummaries(db, viewerId, eq(crews.id, crewId));
  if (!summary) throw notFound('That crew');
  const [crew] = await db.select().from(crews).where(eq(crews.id, crewId)).limit(1);
  const active = summary.myStatus === 'active';
  const members = await db
    .select({ ...userColumns, role: crewMembers.role, status: crewMembers.status, joinedAt: crewMembers.joinedAt })
    .from(crewMembers)
    .innerJoin(users, eq(users.id, crewMembers.userId))
    .where(and(eq(crewMembers.crewId, crewId), active ? undefined : eq(crewMembers.status, 'active')))
    .orderBy(
      sql`case ${crewMembers.role} when 'owner' then 0 when 'admin' then 1 else 2 end`,
      asc(users.displayName),
    );
  const isAdmin = active && (summary.myRole === 'owner' || summary.myRole === 'admin');
  return {
    ...summary,
    membersCanInvite: crew!.membersCanInvite,
    createdAt: iso(crew!.createdAt),
    members: members.map((m) => ({
      user: toUserSummary(m),
      role: m.role,
      status: m.status,
      joinedAt: isoOrNull(m.joinedAt),
    })),
    canManage: isAdmin,
    canInvite: isAdmin || (active && crew!.membersCanInvite),
  };
}

export async function crewRoutes(app: FastifyInstance, { db }: AppContext) {
  async function requireAdmin(crewId: string, userId: string) {
    const m = await crewMembership(db, crewId, userId);
    if (!m || m.status !== 'active') throw notFound('That crew');
    if (m.role !== 'owner' && m.role !== 'admin') throw forbidden('Only crew admins can do that.');
    return m;
  }

  /** Your crews and pending crew invitations. */
  app.get('/crews', async (req): Promise<CrewSummary[]> => crewSummaries(db, requireUser(req)));

  app.post('/crews', async (req, reply) => {
    const me = requireUser(req);
    const input = parse(CreateCrewInput, req.body);
    const crewId = await db.transaction(async (tx) => {
      const [crew] = await tx
        .insert(crews)
        .values({
          name: input.name,
          description: input.description ?? null,
          emoji: input.emoji || '🔥',
          membersCanInvite: input.membersCanInvite ?? true,
          createdBy: me,
        })
        .returning({ id: crews.id });
      await tx
        .insert(crewMembers)
        .values({ crewId: crew!.id, userId: me, role: 'owner', status: 'active', joinedAt: new Date() });
      return crew!.id;
    });
    reply.status(201);
    return loadCrewDetail(db, me, crewId);
  });

  app.get('/crews/:id', async (req) => loadCrewDetail(db, requireUser(req), idParam(req.params)));

  app.patch('/crews/:id', async (req) => {
    const me = requireUser(req);
    const crewId = idParam(req.params);
    await requireAdmin(crewId, me);
    const input = parse(UpdateCrewInput, req.body);
    await db
      .update(crews)
      .set({ ...input, emoji: input.emoji || undefined, updatedAt: new Date() })
      .where(eq(crews.id, crewId));
    return loadCrewDetail(db, me, crewId);
  });

  app.post('/crews/:id/invites', async (req) => {
    const me = requireUser(req);
    const crewId = idParam(req.params);
    const detail = await loadCrewDetail(db, me, crewId);
    if (!detail.canInvite) throw forbidden('Only crew admins can invite people to this crew.');
    const { userIds } = parse(InviteUsersInput, req.body);
    const existing = new Set(detail.members.map((m) => m.user.id));
    const invited: string[] = [];
    for (const userId of userIds) {
      if (existing.has(userId)) continue;
      if (!(await canReach(db, me, userId))) {
        throw badRequest('You can only invite your friends or people you share a crew with.');
      }
      invited.push(userId);
    }
    if (invited.length) {
      await db
        .insert(crewMembers)
        .values(invited.map((userId) => ({ crewId, userId, role: 'member' as const, status: 'invited' as const, invitedBy: me })))
        .onConflictDoNothing();
      const [actor] = await db.select({ name: users.displayName }).from(users).where(eq(users.id, me));
      await notify(db, invited, {
        type: 'crew_invite',
        actorId: me,
        title: `${actor?.name} invited you to join ${detail.emoji} ${detail.name}`,
        href: `/crews/${crewId}`,
      });
    }
    return loadCrewDetail(db, me, crewId);
  });

  app.post('/crews/:id/accept', async (req) => {
    const me = requireUser(req);
    const crewId = idParam(req.params);
    const m = await crewMembership(db, crewId, me);
    if (!m) throw notFound('That crew');
    if (m.status === 'invited') {
      await db
        .update(crewMembers)
        .set({ status: 'active', joinedAt: new Date() })
        .where(and(eq(crewMembers.crewId, crewId), eq(crewMembers.userId, me)));
    }
    return loadCrewDetail(db, me, crewId);
  });

  /** Leave a crew, or decline an invitation to one. */
  app.post('/crews/:id/leave', async (req) => {
    const me = requireUser(req);
    const crewId = idParam(req.params);
    const m = await crewMembership(db, crewId, me);
    if (!m) throw notFound('That crew');
    if (m.role === 'owner') throw forbidden('The owner can’t leave the crew. Hand over ownership first.');
    await db.delete(crewMembers).where(and(eq(crewMembers.crewId, crewId), eq(crewMembers.userId, me)));
    return { ok: true };
  });

  app.patch('/crews/:id/members/:userId', async (req) => {
    const me = requireUser(req);
    const crewId = idParam(req.params);
    const target = idParam(req.params, 'userId');
    const mine = await requireAdmin(crewId, me);
    if (mine.role !== 'owner') throw forbidden('Only the owner can change roles.');
    const { role } = parse(UpdateCrewMemberInput, req.body);
    const theirs = await crewMembership(db, crewId, target);
    if (!theirs || theirs.status !== 'active' || theirs.role === 'owner') throw notFound('That member');
    await db
      .update(crewMembers)
      .set({ role })
      .where(and(eq(crewMembers.crewId, crewId), eq(crewMembers.userId, target)));
    return loadCrewDetail(db, me, crewId);
  });

  app.delete('/crews/:id/members/:userId', async (req) => {
    const me = requireUser(req);
    const crewId = idParam(req.params);
    const target = idParam(req.params, 'userId');
    const mine = await requireAdmin(crewId, me);
    const theirs = await crewMembership(db, crewId, target);
    if (!theirs || target === me) throw notFound('That member');
    if (theirs.role === 'owner' || (theirs.role === 'admin' && mine.role !== 'owner')) {
      throw forbidden('Only the owner can remove an admin.');
    }
    await db.delete(crewMembers).where(and(eq(crewMembers.crewId, crewId), eq(crewMembers.userId, target)));
    return loadCrewDetail(db, me, crewId);
  });
}
