import { and, asc, eq, ilike, isNull, ne, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { UpdateProfileInput, UserSearchQuery, username, type PublicProfile, type UserSearchResult } from '#shared';
import { requireUser, type AppContext } from '../context.ts';
import { blocks, chapterPeople, chapters, crewMembers, crews, media, users } from '../db/schema.ts';
import { badRequest, notFound } from '../lib/errors.ts';
import { friendshipStates } from '../lib/friends.ts';
import { chapterSummaries, iso, toUserSummary, userColumns } from '../lib/queries.ts';
import { parse } from '../lib/validate.ts';
import { loadMe } from './auth.ts';

const escapeLike = (s: string) => s.replace(/[\\%_]/g, '\\$&');

const notBlockedEitherWay = (viewerId: string) =>
  sql`not exists (select 1 from ${blocks} where (${blocks.blockerId} = ${viewerId} and ${blocks.blockedId} = ${users.id}) or (${blocks.blockerId} = ${users.id} and ${blocks.blockedId} = ${viewerId}))`;

export async function userRoutes(app: FastifyInstance, { db }: AppContext) {
  /** Find people by username (prefix) or display name. Ten results, no browsing. */
  app.get('/users/search', async (req): Promise<UserSearchResult[]> => {
    const me = requireUser(req);
    const { q } = parse(UserSearchQuery, req.query);
    const rows = await db
      .select(userColumns)
      .from(users)
      .where(
        and(
          ne(users.id, me),
          or(ilike(users.username, `${escapeLike(q)}%`), ilike(users.displayName, `%${escapeLike(q)}%`)),
          notBlockedEitherWay(me),
        ),
      )
      .orderBy(asc(users.username))
      .limit(10);
    const states = await friendshipStates(db, me, rows.map((r) => r.id));
    return rows.map((r) => ({ ...toUserSummary(r), friendship: states.get(r.id)?.state ?? 'none' }));
  });

  app.get('/users/:username', async (req): Promise<PublicProfile> => {
    const me = requireUser(req);
    const name = username.safeParse((req.params as { username?: string }).username);
    if (!name.success) throw notFound('That person');
    const [user] = await db
      .select()
      .from(users)
      .where(
        and(
          eq(users.username, name.data),
          // Someone who blocked you simply isn't there.
          sql`not exists (select 1 from ${blocks} where ${blocks.blockerId} = ${users.id} and ${blocks.blockedId} = ${me})`,
        ),
      )
      .limit(1);
    if (!user) throw notFound('That person');

    const state = (await friendshipStates(db, me, [user.id])).get(user.id)!;
    const theirChapters = await chapterSummaries(
      db,
      me,
      or(
        eq(chapters.createdBy, user.id),
        sql`exists (select 1 from ${chapterPeople} where ${chapterPeople.chapterId} = ${chapters.id} and ${chapterPeople.userId} = ${user.id})`,
      ),
      { limit: 12 },
    );
    const crewsInCommon =
      user.id === me
        ? []
        : await db
            .select({ id: crews.id, name: crews.name, emoji: crews.emoji })
            .from(crews)
            .where(
              sql`exists (select 1 from ${crewMembers} a where a.crew_id = ${crews.id} and a.user_id = ${me} and a.status = 'active')
                  and exists (select 1 from ${crewMembers} b where b.crew_id = ${crews.id} and b.user_id = ${user.id} and b.status = 'active')`,
            )
            .orderBy(asc(crews.name));

    return {
      ...toUserSummary(user),
      bio: user.bio,
      createdAt: iso(user.createdAt),
      friendship: state.state,
      friendshipId: state.friendshipId,
      chapters: theirChapters,
      crewsInCommon,
    };
  });

  app.patch('/me', async (req) => {
    const me = requireUser(req);
    const input = parse(UpdateProfileInput, req.body);
    if (input.avatarMediaId) {
      const [m] = await db
        .select({ id: media.id })
        .from(media)
        .where(
          and(
            eq(media.id, input.avatarMediaId),
            eq(media.ownerId, me),
            isNull(media.chapterId),
            isNull(media.eventId),
            isNull(media.crewId),
          ),
        )
        .limit(1);
      if (!m) throw badRequest('Upload the picture first.', { avatarMediaId: 'Unknown picture' });
    }
    await db
      .update(users)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(users.id, me));
    return loadMe(db, me);
  });
}
