// The Loracle, phase C: "Show to a crew", "Walk with you", the Epic and reports on shared quests,
// with export and account deletion. A scripted mind (never the network, never Claude).
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LORACLE_LINES, NO_LIMIT_KM, type EpicView, type LoracleState, type ModerationReport, type Wish } from '#shared';
import { loracleSpend, notifications, wishAsks, wishes, wishWalkers } from '../src/db/schema.ts';
import type { WorldData } from '../src/lib/world.ts';
import { createTestApp, quietWorld, type Client } from './helpers.ts';
import { PhaseMind, STORM_WISH } from './loracleFixtures.ts';

const REALM = { label: 'Reykjavík, Iceland', lat: 64.14, lon: -21.94, country: 'IS' };
const world: WorldData = {
  ...quietWorld,
  geocode: async (q) => [{ label: q, lat: 64.1, lon: -21.9, country: 'IS' }],
  reverse: async () => ({ label: 'Reykjavík, Iceland', lat: 64.14, lon: -21.94, country: 'IS' }),
};

let t: Awaited<ReturnType<typeof createTestApp>>;
const mind = new PhaseMind();

beforeAll(async () => {
  t = await createTestApp({ mind, world, config: { adminUsernames: ['moderator'] } });
});
afterAll(() => t.close());

async function lorer(name: string): Promise<Client> {
  const c = await t.signUp(name);
  await c.put('/api/loracle/settings', { home: REALM, radiusKm: NO_LIMIT_KM, timeZone: 'Atlantic/Reykjavik' });
  await c.post('/api/loracle/consent');
  return c;
}

async function drawn(c: Client, text = STORM_WISH): Promise<Wish> {
  const res = await c.post<{ wish: Wish }>('/api/loracle/wishes', { text });
  expect(res.status).toBe(202);
  await t.app.wishJobs.idle();
  return (await c.get<Wish>(`/api/loracle/wishes/${res.body.wish.id}`)).body;
}

/** A crew of `owner` with `members` in it (friends first: you can only invite people you can reach). */
async function crewOf(owner: Client, members: Client[], name = 'The Storm Crew'): Promise<string> {
  const crew = await owner.post('/api/crews', { name });
  expect(crew.status).toBe(201);
  for (const m of members) {
    await t.befriend(owner, m);
    expect((await owner.post(`/api/crews/${crew.body.id}/invites`, { userIds: [m.user.id] })).status).toBe(200);
    expect((await m.post(`/api/crews/${crew.body.id}/accept`)).status).toBe(200);
  }
  return crew.body.id;
}

const view = (c: Client, id: string) => c.get<Wish>(`/api/loracle/wishes/${id}`);
const share = (c: Client, id: string, crewId: string | null) =>
  c.put<Wish>(`/api/loracle/wishes/${id}/share`, crewId ? { audience: 'crew', crewId } : { audience: 'only_me', crewId: null });

// ---------------------------------------------------------------------------

describe('Show to a crew', () => {
  let owner: Client;
  let member: Client;
  let outsider: Client;
  let invitee: Client;
  let crewId: string;
  let wish: Wish;

  beforeAll(async () => {
    owner = await lorer('hrafn');
    member = await lorer('sunna');
    outsider = await lorer('ulfur');
    invitee = await lorer('vala');
    crewId = await crewOf(owner, [member]);
    // Invited, not yet in the crew.
    await t.befriend(owner, invitee);
    await owner.post(`/api/crews/${crewId}/invites`, { userIds: [invitee.user.id] });
    wish = await drawn(owner);
    // The Lorer's private parts: a note, a reminder, a deeper ask.
    await owner.patch(`/api/loracle/waypoints/${wish.road.map[0]!.id}`, { note: 'MY-PRIVATE-NOTE' });
    await owner.post(`/api/loracle/roads/${wish.road.id}/week`, { day: new Date().toISOString().slice(0, 10) });
    await owner.post(`/api/loracle/waypoints/${wish.road.map[0]!.id}/ask`, { question: 'MY-PRIVATE-QUESTION' });
    await t.app.wishJobs.idle();
  });

  it('is private until the Lorer shows it, and only to a crew they are in', async () => {
    expect((await view(member, wish.id)).status).toBe(404);
    const stranger = await owner.post('/api/crews', { name: 'Elsewhere' });
    // A crew the Lorer is not in (made by the outsider) is a 404.
    const theirs = await outsider.post('/api/crews', { name: 'Not yours' });
    expect((await share(owner, wish.id, theirs.body.id)).status).toBe(404);
    expect(stranger.status).toBe(201);
    const res = await share(owner, wish.id, crewId);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ audience: 'crew', crew: { id: crewId, name: 'The Storm Crew' }, mine: true });
  });

  it('shows it to the crew’s members without the Lorer’s realm, notes, links, reminders or asks', async () => {
    const res = await view(member, wish.id);
    expect(res.status).toBe(200);
    const seen = res.body;
    expect(seen).toMatchObject({ mine: false, owner: { username: 'hrafn' }, realm: '', audience: 'crew' });
    const w0 = seen.road.map[0]!;
    if (w0.state === 'sealed') throw new Error('sealed');
    expect(w0.note).toBeNull();
    expect(w0.asks).toEqual([]);
    expect(w0.links).toEqual({ eventId: null, ideaId: null, chapterId: null, reminderId: null });
    // What the stone drew from the Lorer's own answers and life stays theirs: the signs (the scouts'
    // searches), the dawn promise, This week (a door near home) and the provisions.
    expect(seen.road).toMatchObject({ signs: [], dueBy: null, thisWeek: null, provisions: null });
    expect(seen.road.map[2]!.state).toBe('sealed'); // sealed for them as for the Lorer
    const raw = JSON.stringify(seen);
    for (const secret of ['MY-PRIVATE-NOTE', 'MY-PRIVATE-QUESTION', 'Reykjavík, Iceland', 'FORGE', 'DOSSIER']) expect(raw).not.toContain(secret);
    // The Lorer still sees everything.
    const own = (await view(owner, wish.id)).body.road.map[0]!;
    if (own.state === 'sealed') throw new Error('sealed');
    expect(own.note).toBe('MY-PRIVATE-NOTE');
    expect(own.asks).toHaveLength(1);
  });

  it('lists it among the crew’s quests, never in the member’s own log or on their map', async () => {
    const state = (await member.get<LoracleState>('/api/loracle')).body;
    expect(state.crewQuests).toHaveLength(1);
    expect(state.crewQuests[0]).toMatchObject({ id: wish.id, owner: { username: 'hrafn' }, crew: { id: crewId } });
    expect(state.wishes.map((w) => w.id)).not.toContain(wish.id);
    expect((await owner.get<LoracleState>('/api/loracle')).body.crewQuests).toEqual([]);
    const map = await member.get('/api/map?mode=adventures');
    expect(JSON.stringify(map.body)).not.toContain(wish.road.map[0]!.id);
  });

  it('stays hidden from everyone else: outsiders, the invited who have not joined', async () => {
    for (const c of [outsider, invitee]) {
      expect((await view(c, wish.id)).status).toBe(404);
      expect((await c.get<LoracleState>('/api/loracle')).body.crewQuests).toEqual([]);
    }
  });

  it('lets only the Lorer act on it (403 for a crew member)', async () => {
    const w0 = wish.road.map[0]!.id;
    for (const res of [
      await share(member, wish.id, null),
      await member.post(`/api/loracle/wishes/${wish.id}/again`),
      await member.patch(`/api/loracle/wishes/${wish.id}`, { status: 'released' }),
      await member.del(`/api/loracle/wishes/${wish.id}`),
      await member.post(`/api/loracle/waypoints/${w0}/ink`, {}),
      await member.post(`/api/loracle/waypoints/${w0}/ask`, {}),
      await member.post(`/api/loracle/waypoints/${w0}/plan`, {}),
      await member.post(`/api/loracle/waypoints/${wish.road.map[2]!.id}/unseal`),
    ]) {
      expect(res.status).toBe(403);
      expect(res.body.error).toMatchObject({ code: 'not_yours', message: LORACLE_LINES.notYours });
    }
    expect((await view(member, wish.id)).status).toBe(200);
  });

  it('hides it again when a member leaves the crew, or a block stands between them', async () => {
    const leaver = await lorer('ylfa');
    const blocked = await lorer('thora');
    const crew = await crewOf(owner, [leaver, blocked], 'The Night Crew');
    const quest = await drawn(owner, 'I wish to hear the foghorn from the tower.');
    await share(owner, quest.id, crew);
    expect((await view(leaver, quest.id)).status).toBe(200);
    expect((await view(blocked, quest.id)).status).toBe(200);
    await leaver.post(`/api/crews/${crew}/leave`);
    expect((await view(leaver, quest.id)).status).toBe(404);
    await blocked.post('/api/blocks', { userId: owner.user.id });
    expect((await view(blocked, quest.id)).status).toBe(404);
    expect((await blocked.get<LoracleState>('/api/loracle')).body.crewQuests).toEqual([]);
  });
});

describe('Walk with you', () => {
  it('lets crew members walk open waypoints, invites them when the Lorer makes it a plan, and lets go when hidden', async () => {
    const owner = await lorer('arna');
    const member = await lorer('bragi');
    const late = await lorer('dis');
    const outsider = await lorer('egill');
    const crewId = await crewOf(owner, [member, late]);
    const wish = await drawn(owner);
    const [w0, , w2] = wish.road.map;
    // Not shown yet: no one can walk it.
    expect((await member.post(`/api/loracle/waypoints/${w0!.id}/walk`)).status).toBe(404);
    await share(owner, wish.id, crewId);

    const walked = await member.post<Wish>(`/api/loracle/waypoints/${w0!.id}/walk`);
    expect(walked.status).toBe(201);
    const mine = walked.body.road.map[0]!;
    if (mine.state === 'sealed') throw new Error('sealed');
    expect(mine.walking).toBe(true);
    expect(mine.walkers.map((u) => u.username)).toEqual(['bragi']);
    expect((await member.post(`/api/loracle/waypoints/${w2!.id}/walk`)).body.error.code).toBe('sealed');
    expect((await outsider.post(`/api/loracle/waypoints/${w0!.id}/walk`)).status).toBe(404);
    expect((await owner.post(`/api/loracle/waypoints/${w0!.id}/walk`)).body.error.code).toBe('own');
    const seen = (await view(owner, wish.id)).body.road.map[0]!;
    if (seen.state === 'sealed') throw new Error('sealed');
    expect(seen.walkers.map((u) => u.username)).toEqual(['bragi']);
    expect(seen.walking).toBe(false);

    // The Lorer makes it a plan: the walker is invited (a real invitation, notified).
    const plan = await owner.post<Wish>(`/api/loracle/waypoints/${w0!.id}/plan`, {});
    expect(plan.status).toBe(201);
    const open = plan.body.road.map[0]!;
    if (open.state === 'sealed') throw new Error('sealed');
    const eventId = open.links.eventId!;
    expect((await member.get(`/api/events/${eventId}`)).status).toBe(200);
    expect((await outsider.get(`/api/events/${eventId}`)).status).toBe(404);
    const told = await t.db.select().from(notifications).where(eq(notifications.userId, member.user.id));
    expect(told.some((n) => n.type === 'event_invite' && n.href === `/events/${eventId}`)).toBe(true);
    // One who walks later is invited when the Lorer makes it a plan again.
    expect((await late.get(`/api/events/${eventId}`)).status).toBe(404);
    await late.post(`/api/loracle/waypoints/${w0!.id}/walk`);
    await owner.post(`/api/loracle/waypoints/${w0!.id}/plan`, {});
    expect((await late.get(`/api/events/${eventId}`)).status).toBe(200);

    // Walk no more; then the Lorer keeps it to themself again: every walker is let go.
    await late.del(`/api/loracle/waypoints/${w0!.id}/walk`);
    const after = (await view(owner, wish.id)).body.road.map[0]!;
    if (after.state === 'sealed') throw new Error('sealed');
    expect(after.walkers.map((u) => u.username)).toEqual(['bragi']);
    await share(owner, wish.id, null);
    expect((await view(member, wish.id)).status).toBe(404);
    expect(await t.db.select().from(wishWalkers).where(eq(wishWalkers.waypointId, w0!.id))).toEqual([]);
  });
});

describe('the Epic', () => {
  it('opens only once the wish came true, and shows each viewer only the chapters they may see', async () => {
    const owner = await lorer('freyja');
    const member = await lorer('gunnar');
    const crewId = await crewOf(owner, [member]);
    const wish = await drawn(owner);
    await share(owner, wish.id, crewId);
    expect((await owner.get(`/api/loracle/wishes/${wish.id}/epic`)).body.error.code).toBe('not_fulfilled');
    // A private chapter, linked to the first waypoint.
    const chapter = await owner.post('/api/chapters', { title: 'MY-JOURNAL', occurredOn: '2026-11-01', audience: 'only_me' });
    expect(chapter.status).toBe(201);
    const [w0] = wish.road.map;
    await member.post(`/api/loracle/waypoints/${w0!.id}/walk`);
    await owner.put(`/api/loracle/waypoints/${w0!.id}/link`, { chapterId: chapter.body.id });
    for (const w of wish.road.map) {
      await owner.post(`/api/loracle/waypoints/${w.id}/unseal`);
      await owner.post(`/api/loracle/waypoints/${w.id}/ink`, {});
    }
    expect((await view(owner, wish.id)).body.status).toBe('fulfilled');
    const mine = await owner.get<EpicView>(`/api/loracle/wishes/${wish.id}/epic`);
    expect(mine.status).toBe(200);
    expect(mine.body).toMatchObject({ mine: true, title: 'The First Road', roadN: 1, crew: { id: crewId } });
    expect(mine.body.map[0]).toMatchObject({ chapter: { id: chapter.body.id, title: 'MY-JOURNAL' }, walkers: [{ username: 'gunnar' }] });
    expect(mine.body.map.every((w) => w.inkedOn)).toBe(true);
    const theirs = await member.get<EpicView>(`/api/loracle/wishes/${wish.id}/epic`);
    expect(theirs.status).toBe(200);
    expect(theirs.body.mine).toBe(false);
    expect(theirs.body.map[0]!.chapter).toBeNull();
    expect(JSON.stringify(theirs.body)).not.toContain('MY-JOURNAL');
    const outsider = await lorer('hekla');
    expect((await outsider.get(`/api/loracle/wishes/${wish.id}/epic`)).status).toBe(404);
  });
});

describe('reports on a shared quest (D29)', () => {
  let mod: Client;
  beforeAll(async () => {
    mod = await t.signUp('moderator');
  });

  it('lets a crew member report it, keeps a snapshot, and taking it down hides it from the crew', async () => {
    const owner = await lorer('ingrid');
    const member = await lorer('jokull');
    const outsider = await lorer('kari');
    const crewId = await crewOf(owner, [member]);
    const wish = await drawn(owner);
    expect((await member.post('/api/reports', { targetType: 'quest', targetId: wish.id, reason: 'other' })).status).toBe(404);
    await share(owner, wish.id, crewId);
    const report = await member.post('/api/reports', { targetType: 'quest', targetId: wish.id, reason: 'harassment', details: 'names a stranger' });
    expect(report.status).toBe(201);
    expect((await outsider.post('/api/reports', { targetType: 'quest', targetId: wish.id, reason: 'other' })).status).toBe(404);
    const open = (await mod.get<ModerationReport[]>('/api/admin/reports')).body.find((r) => r.targetId === wish.id)!;
    expect(open).toMatchObject({ targetType: 'quest', href: `/oracle/quest/${wish.id}`, subject: { username: 'ingrid' } });
    expect(open.snapshot).toContain('The First Road');
    expect(open.snapshot).toContain('Waypoint 0');
    const resolved = await mod.post(`/api/admin/reports/${open.id}/resolve`, { action: 'remove' });
    expect(resolved.status).toBe(200);
    expect((await view(member, wish.id)).status).toBe(404);
    // Still the Lorer's own, and it stays theirs alone: it can't be shown to the crew again.
    expect((await view(owner, wish.id)).body).toMatchObject({ audience: 'only_me', crew: null });
    const again = await share(owner, wish.id, crewId);
    expect(again.status).toBe(409);
    expect((again.body as unknown as { error: unknown }).error).toMatchObject({ code: 'removed', message: LORACLE_LINES.shareRemoved });
    expect((await view(member, wish.id)).status).toBe(404);
  });

  it('keeps the wish itself in a crew member’s report: what the crew reads first', async () => {
    const owner = await lorer('oskar');
    const member = await lorer('petra');
    const crewId = await crewOf(owner, [member]);
    const wish = await drawn(owner, 'I wish to ring the storm bell at midnight.');
    await share(owner, wish.id, crewId);
    expect((await member.post('/api/reports', { targetType: 'quest', targetId: wish.id, reason: 'other' })).status).toBe(201);
    const report = (await mod.get<ModerationReport[]>('/api/admin/reports')).body.find((r) => r.targetId === wish.id)!;
    expect(report.snapshot!.startsWith('I wish to ring the storm bell at midnight.')).toBe(true);
    expect(report.snapshot).toContain('The First Road');
  });

  it('lets the Lorer report the stone’s own words, with no one’s account as its subject', async () => {
    const owner = await lorer('lara');
    const wish = await drawn(owner);
    expect((await owner.post('/api/reports', { targetType: 'quest', targetId: wish.id, reason: 'other' })).status).toBe(201);
    const report = (await mod.get<ModerationReport[]>('/api/admin/reports')).body.find((r) => r.targetId === wish.id)!;
    expect(report).toMatchObject({ targetType: 'quest', subject: null });
  });
});

describe('what showing a quest must never leak or leave behind', () => {
  it('gives a crew member no map points while the Lorer hides their places (D35); names stay', async () => {
    const owner = await lorer('runa');
    const member = await lorer('saga');
    const crewId = await crewOf(owner, [member]);
    const wish = await drawn(owner);
    await share(owner, wish.id, crewId);
    const seen = (await view(member, wish.id)).body;
    expect(seen.road.map[0]!.where.lat).not.toBeNull();
    expect((await owner.patch('/api/me', { showPlaces: false })).status).toBe(200);
    const hidden = (await view(member, wish.id)).body;
    expect(hidden.road.map.every((w) => w.where.lat === null && w.where.lon === null)).toBe(true);
    expect(hidden.road.map[0]!.where.place).toBe(seen.road.map[0]!.where.place);
    // The Lorer still has their own points.
    expect((await view(owner, wish.id)).body.road.map[0]!.where.lat).not.toBeNull();
  });

  it('"Make it a plan" asks walkers along only to a plan the Lorer organizes: a linked event stays its host’s', async () => {
    const host = await lorer('tyr');
    const owner = await lorer('unn');
    const walker = await lorer('vigdis');
    await t.befriend(host, owner);
    const crewId = await crewOf(owner, [walker]);
    // The host's friends-only night, which the walker (blocked by the host) may never see.
    await host.post('/api/blocks', { userId: walker.user.id });
    const event = await host.post('/api/events', { title: 'The host’s night', startsAt: new Date(Date.now() + 5 * 86_400_000).toISOString(), timeZone: 'UTC', audience: 'friends' });
    expect(event.status).toBe(201);
    const wish = await drawn(owner);
    await share(owner, wish.id, crewId);
    const w0 = wish.road.map[0]!.id;
    expect((await owner.put(`/api/loracle/waypoints/${w0}/link`, { eventId: event.body.id })).status).toBe(200);
    expect((await walker.post(`/api/loracle/waypoints/${w0}/walk`)).status).toBe(201);
    expect((await owner.post(`/api/loracle/waypoints/${w0}/plan`, {})).status).toBe(200);
    expect((await walker.get(`/api/events/${event.body.id}`)).status).toBe(404);
  });

  it('shows no walker the Lorer has blocked, and the block ends the walk', async () => {
    const owner = await lorer('wilma');
    const walker = await lorer('xavier');
    const third = await lorer('yngvi');
    const crewId = await crewOf(owner, [walker, third]);
    const wish = await drawn(owner);
    await share(owner, wish.id, crewId);
    const w0 = wish.road.map[0]!;
    await walker.post(`/api/loracle/waypoints/${w0.id}/walk`);
    const walkersSeen = async () => {
      const wp = (await view(third, wish.id)).body.road.map[0]!;
      if (wp.state === 'sealed') throw new Error('sealed');
      return wp.walkers.map((u) => u.username);
    };
    expect(await walkersSeen()).toEqual(['xavier']);
    await owner.post('/api/blocks', { userId: walker.user.id });
    expect(await t.db.select().from(wishWalkers).where(eq(wishWalkers.waypointId, w0.id))).toEqual([]);
    // Even a walk left over from before is never shown across the block.
    await t.db.insert(wishWalkers).values({ waypointId: w0.id, userId: walker.user.id });
    expect(await walkersSeen()).toEqual([]);
  });

  it('lets go for good when someone leaves the crew: a rejoin shows nothing again, and walks are gone', async () => {
    const host = await lorer('zelda');
    const owner = await lorer('arnor');
    const member = await lorer('birta');
    const crewId = await crewOf(host, [owner, member]);
    const rejoin = async (c: Client) => {
      expect((await host.post(`/api/crews/${crewId}/invites`, { userIds: [c.user.id] })).status).toBe(200);
      expect((await c.post(`/api/crews/${crewId}/accept`)).status).toBe(200);
    };
    const wish = await drawn(owner);
    await share(owner, wish.id, crewId);
    const w0 = wish.road.map[0]!.id;
    const walks = () => t.db.select().from(wishWalkers).where(eq(wishWalkers.waypointId, w0));
    // A walker who leaves walks no more, in their download too, and not after coming back.
    expect((await member.post(`/api/loracle/waypoints/${w0}/walk`)).status).toBe(201);
    expect((await member.post(`/api/crews/${crewId}/leave`)).status).toBe(200);
    expect((await member.get('/api/me/export')).body.loracle.walking).toEqual([]);
    await rejoin(member);
    expect(await walks()).toEqual([]);
    expect((await view(member, wish.id)).status).toBe(200);
    // The Lorer leaves and comes back: the quest is theirs alone until they show it again.
    await member.post(`/api/loracle/waypoints/${w0}/walk`);
    expect((await owner.post(`/api/crews/${crewId}/leave`)).status).toBe(200);
    await rejoin(owner);
    expect((await view(member, wish.id)).status).toBe(404);
    expect((await view(owner, wish.id)).body).toMatchObject({ audience: 'only_me', crew: null });
    expect(await walks()).toEqual([]);
  });
});

describe('export and account deletion', () => {
  it('exports sharing, deeper asks and walks; deleting either account removes their part', async () => {
    const owner = await lorer('magni');
    const member = await lorer('nanna');
    const crewId = await crewOf(owner, [member], 'Export Crew');
    const wish = await drawn(owner);
    await share(owner, wish.id, crewId);
    const w0 = wish.road.map[0]!;
    await owner.post(`/api/loracle/waypoints/${w0.id}/ask`, { question: 'How do I begin?' });
    await t.app.wishJobs.idle();
    await member.post(`/api/loracle/waypoints/${w0.id}/walk`);

    const mine = (await owner.get('/api/me/export')).body.loracle;
    expect(mine.wishes[0]).toMatchObject({ audience: 'crew', crew: 'Export Crew' });
    expect(mine.wishes[0].roads[0].lane).toBe('now');
    expect(mine.wishes[0].roads[0].waypoints[0].asks[0]).toMatchObject({ question: 'How do I begin?', status: 'answered' });
    const theirs = (await member.get('/api/me/export')).body.loracle;
    expect(theirs.walking).toEqual([expect.objectContaining({ waypoint: 'Waypoint 0', quest: 'The First Road' })]);
    expect(JSON.stringify(theirs)).not.toContain('How do I begin?');

    // The walker goes: their walk goes with them.
    const gone = await t.app.inject({ method: 'DELETE', url: '/api/me', headers: { cookie: member.cookie }, payload: { password: 'correct horse battery' } });
    expect(gone.statusCode).toBe(200);
    expect(await t.db.select().from(wishWalkers).where(eq(wishWalkers.waypointId, w0.id))).toEqual([]);
    // The Lorer goes: every wish, road, waypoint and ask with them; the spend rows lose their name.
    const del = await t.app.inject({ method: 'DELETE', url: '/api/me', headers: { cookie: owner.cookie }, payload: { password: 'correct horse battery' } });
    expect(del.statusCode).toBe(200);
    expect(await t.db.select().from(wishes).where(eq(wishes.id, wish.id))).toEqual([]);
    expect(await t.db.select().from(wishAsks).where(eq(wishAsks.wishId, wish.id))).toEqual([]);
    expect(await t.db.select().from(loracleSpend).where(eq(loracleSpend.userId, owner.user.id))).toEqual([]);
  });
});
