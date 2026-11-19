// The Lore Map (docs/DECISIONS.md D35): places on chapters, plans and ideas, how precisely others get
// them, and GET /map. The privacy rules are the point: no exact coordinate ever reaches someone who
// may only have the rounded one, by any route.
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MAP_CAP, NO_LIMIT_KM, type MapFeature, type MapResponse } from '#shared';
import { chapters, events, ideas, wishes, wishRoads, wishWaypoints } from '../src/db/schema.ts';
import { approximatePoint } from '../src/lib/access.ts';
import type { Weighing } from '../src/lib/loracle/types.ts';
import { createTestApp, inDays, type Client } from './helpers.ts';

// Cast: Ana and Ben are friends; Ben and Cal are friends. Ana, Ben and Cal share a crew. Dan is a
// stranger to everyone.
let t: Awaited<ReturnType<typeof createTestApp>>;
let ana: Client, ben: Client, cal: Client, dan: Client;
let crewId: string;

/** The exact spot, with digits no rounded point can contain. */
const HERE = { lat: 64.123456, lon: -21.987654 };
const THERE = { lat: 65.262781, lon: -14.394521 };

const place = (precision?: 'exact' | 'approximate' | 'only_me', at = HERE, name = 'Elliðaárdalur') => ({
  name,
  lat: at.lat,
  lon: at.lon,
  ...(precision ? { precision } : {}),
});
/** True when the exact point (either coordinate) appears anywhere in a response. */
const leaks = (body: unknown, at = HERE) => {
  const s = JSON.stringify(body);
  return s.includes(String(at.lat)) || s.includes(String(at.lon));
};
const getMap = async (c: Client, query = '') => {
  const res = await c.get<MapResponse>(`/api/map${query}`);
  expect(res.status).toBe(200);
  return res.body;
};
const ids = (m: MapResponse, kind?: MapFeature['kind']) =>
  m.features.filter((f) => f.kind !== 'home' && (!kind || f.kind === kind)).map((f) => f.id);
const feature = (m: MapResponse, id: string) => m.features.find((f) => f.id === id);

beforeAll(async () => {
  t = await createTestApp();
  [ana, ben, cal, dan] = (await Promise.all(['ana', 'ben', 'cal', 'dan'].map((u) => t.signUp(u)))) as [Client, Client, Client, Client];
  await t.befriend(ana, ben);
  await t.befriend(ben, cal);
  crewId = (await ana.post('/api/crews', { name: 'The Cartographers', emoji: '🧭' })).body.id;
  await ana.post(`/api/crews/${crewId}/invites`, { userIds: [ben.user.id] });
  await ben.post(`/api/crews/${crewId}/accept`);
  await ben.post(`/api/crews/${crewId}/invites`, { userIds: [cal.user.id] });
  await cal.post(`/api/crews/${crewId}/accept`);
});
afterAll(() => t.close());

const chapter = (overrides: Record<string, unknown> = {}) => ({ title: 'The long walk', occurredOn: '2026-06-01', ...overrides });
const plan = (overrides: Record<string, unknown> = {}) => ({
  title: 'Meet at the falls',
  startsAt: inDays(10),
  timeZone: 'Atlantic/Reykjavik',
  ...overrides,
});

describe('setting a place', () => {
  it('validates the place', async () => {
    for (const bad of [
      { ...place(), lat: 90.5 },
      { ...place(), lat: -91 },
      { ...place(), lon: 180.01 },
      { ...place(), lon: -181 },
      { ...place(), lat: '64.1' },
      { ...place(), name: 'x'.repeat(201) },
      { ...place(), precision: 'roughly' },
      { lat: 64, lon: -21 },
    ]) {
      expect((await ana.post('/api/chapters', chapter({ place: bad }))).status).toBe(400);
      expect((await ana.post('/api/ideas', { title: 'Somewhere', place: bad })).status).toBe(400);
      expect((await ana.post('/api/events', plan({ place: bad }))).status).toBe(400);
    }
    const edge = await ana.post('/api/chapters', chapter({ place: { name: 'The pole', lat: -90, lon: 180 } }));
    expect(edge.status).toBe(201);
    expect(edge.body.place).toEqual({ lat: -90, lon: 180, precision: 'approximate' });
  });

  it('defaults: chapters and ideas approximate, plans exact; the name is the location name', async () => {
    const c = await ana.post('/api/chapters', chapter({ place: place() }));
    expect(c.status).toBe(201);
    expect(c.body).toMatchObject({ locationName: 'Elliðaárdalur', place: { ...HERE, precision: 'approximate' } });
    const i = await ana.post('/api/ideas', { title: 'Sleep by the river', place: place() });
    expect(i.status).toBe(201);
    expect(i.body).toMatchObject({ locationName: 'Elliðaárdalur', place: { ...HERE, precision: 'approximate' } });
    const e = await ana.post('/api/events', plan({ place: place(), locationName: 'ignored when a place is given' }));
    expect(e.status).toBe(201);
    expect(e.body).toMatchObject({ locationName: 'Elliðaárdalur', place: { ...HERE, precision: 'exact' } });
    // No place: no point, the free-text name still works.
    const plain = await ana.post('/api/events', plan({ locationName: 'Our usual spot' }));
    expect(plain.body).toMatchObject({ locationName: 'Our usual spot', place: null });
  });

  it('updates: a new point keeps the chosen precision, null removes name and point', async () => {
    const c = (await ana.post('/api/chapters', chapter({ place: place('only_me') }))).body;
    const moved = await ana.patch(`/api/chapters/${c.id}`, { place: place(undefined, THERE, 'Egilsstaðir') });
    expect(moved.body).toMatchObject({ locationName: 'Egilsstaðir', place: { ...THERE, precision: 'only_me' } });
    const exact = await ana.patch(`/api/chapters/${c.id}`, { place: place('exact', THERE, 'Egilsstaðir') });
    expect(exact.body.place).toEqual({ ...THERE, precision: 'exact' });
    // Other fields leave the place alone.
    expect((await ana.patch(`/api/chapters/${c.id}`, { title: 'Renamed' })).body.place).toEqual({ ...THERE, precision: 'exact' });
    const removed = await ana.patch(`/api/chapters/${c.id}`, { place: null });
    expect(removed.body).toMatchObject({ locationName: null, place: null });

    const i = (await ana.post('/api/ideas', { title: 'A hut', place: place() })).body;
    expect((await ana.patch(`/api/ideas/${i.id}`, { place: null })).body).toMatchObject({ locationName: null, place: null });
    const e = (await ana.post('/api/events', plan({ place: place() }))).body;
    const ev = await ana.patch(`/api/events/${e.id}`, { place: place('approximate', THERE, 'Egilsstaðir') });
    expect(ev.body).toMatchObject({ locationName: 'Egilsstaðir', place: { ...THERE, precision: 'approximate' } });
    expect((await ana.patch(`/api/events/${e.id}`, { place: null })).body).toMatchObject({ locationName: null, place: null });
    // A name sent with the removal stays: "the cabin", without a pin.
    await ana.patch(`/api/events/${e.id}`, { place: place() });
    const kept = await ana.patch(`/api/events/${e.id}`, { place: null, locationName: 'The cabin' });
    expect(kept.body).toMatchObject({ locationName: 'The cabin', place: null });
    await ana.patch(`/api/chapters/${c.id}`, { place: place() });
    const keptChapter = await ana.patch(`/api/chapters/${c.id}`, { place: null, locationName: 'The cabin' });
    expect(keptChapter.body).toMatchObject({ locationName: 'The cabin', place: null });
  });

  it('a point whose “Where” was cleared can still change how exact it is', async () => {
    const c = (await ana.post('/api/chapters', chapter({ title: 'Nameless spot', place: place('exact') }))).body;
    const cleared = await ana.patch(`/api/chapters/${c.id}`, { locationName: null });
    expect(cleared.body).toMatchObject({ locationName: null, place: { ...HERE, precision: 'exact' } });
    const changed = await ana.patch(`/api/chapters/${c.id}`, { place: { name: '', ...HERE, precision: 'approximate' } });
    expect(changed.status).toBe(200);
    expect(changed.body).toMatchObject({ locationName: null, place: { ...HERE, precision: 'approximate' } });
    const fresh = await ana.post('/api/ideas', { title: 'A spot', place: { name: ' ', ...HERE } });
    expect(fresh.status).toBe(201);
    expect(fresh.body).toMatchObject({ locationName: null, place: { ...HERE, precision: 'approximate' } });
  });

  it('a plan’s point moving tells its people only when what they get of it changed', async () => {
    const e = (await ana.post('/api/events', plan({ title: 'Quiet move', inviteUserIds: [ben.user.id], place: place('only_me') }))).body;
    const changed = async () =>
      ((await ben.get('/api/notifications')).body as { type: string; href: string | null }[]).filter(
        (n) => n.type === 'event_changed' && n.href === `/events/${e.id}`,
      ).length;
    // An "Only me" point moves silently; so does an "About here" one inside its circle.
    await ana.patch(`/api/events/${e.id}`, { place: place(undefined, THERE) });
    expect(await changed()).toBe(0);
    await ana.patch(`/api/events/${e.id}`, { place: place('approximate', THERE) });
    expect(await changed()).toBe(1);
    // (Read, so a new one wouldn't fold into it.)
    await ben.post('/api/notifications/read', {});
    await ana.patch(`/api/events/${e.id}`, { place: place(undefined, { lat: THERE.lat + 0.000001, lon: THERE.lon }) });
    expect(await changed()).toBe(1);
    await ana.patch(`/api/events/${e.id}`, { place: place('exact', THERE) });
    expect(await changed()).toBe(2);
    // With "Show my places on maps" off nobody else gets the point, so its moving tells nobody.
    await ben.post('/api/notifications/read', {});
    await ana.patch('/api/me', { showPlaces: false });
    await ana.patch(`/api/events/${e.id}`, { place: place('exact', HERE) });
    expect(await changed()).toBe(2);
    await ana.patch('/api/me', { showPlaces: true });
    await ana.patch(`/api/events/${e.id}`, { place: place('exact', THERE) });
    expect(await changed()).toBe(3);
  });

  it('only people who may edit the item can set its place', async () => {
    const c = (await ana.post('/api/chapters', chapter({ crewId, place: place() }))).body;
    expect((await cal.patch(`/api/chapters/${c.id}`, { place: place('exact', THERE) })).status).toBe(403);
    expect((await dan.patch(`/api/chapters/${c.id}`, { place: null })).status).toBe(404);
    const i = (await ana.post('/api/ideas', { title: 'Crew hut', crewId, place: place() })).body;
    expect((await cal.patch(`/api/ideas/${i.id}`, { place: null })).status).toBe(403);
  });
});

describe('precision', () => {
  it('approximate: the author has the spot; everyone else a rounded point, by every route', async () => {
    const c = (await ana.post('/api/chapters', chapter({ crewId, title: 'Crew camp', peopleIds: [ben.user.id], place: place('approximate') }))).body;
    const i = (await ana.post('/api/ideas', { title: 'Crew dream', crewId, place: place('approximate') })).body;
    const e = (await ana.post('/api/events', plan({ crewId, title: 'Crew meet', inviteUserIds: [ben.user.id], place: place('approximate') }))).body;
    const rounded = { ...approximatePoint(HERE.lat, HERE.lon), precision: 'approximate' };
    // About 5 km, no more: within half a cell of the spot.
    expect(Math.abs(rounded.lat - HERE.lat)).toBeLessThanOrEqual(0.025);
    expect(Math.abs(rounded.lon - HERE.lon) * Math.cos((HERE.lat * Math.PI) / 180)).toBeLessThanOrEqual(0.03);
    expect(rounded.lat).not.toBe(HERE.lat);

    expect((await ana.get(`/api/chapters/${c.id}`)).body.place).toEqual({ ...HERE, precision: 'approximate' });
    for (const viewer of [ben, cal]) {
      const responses = [
        await viewer.get(`/api/chapters/${c.id}`),
        await viewer.get(`/api/ideas/${i.id}`),
        await viewer.get(`/api/events/${e.id}`),
        await viewer.get('/api/chapters'),
        await viewer.get(`/api/chapters?crewId=${crewId}`),
        await viewer.get('/api/ideas'),
        await viewer.get(`/api/events?from=${encodeURIComponent(inDays(0, 0))}&to=${encodeURIComponent(inDays(30, 0))}`),
        await viewer.get('/api/home'),
        await viewer.get('/api/users/ana'),
        await viewer.get(`/api/crews/${crewId}`),
        await viewer.get('/api/map'),
        await viewer.get(`/api/map?mode=crew&crew=${crewId}`),
        await viewer.get('/api/map?mode=memories'),
        await viewer.get('/api/map?mode=adventures'),
        await viewer.get('/api/me/export'),
      ];
      for (const res of responses) {
        expect(res.status).toBe(200);
        expect(leaks(res.body)).toBe(false);
      }
      expect(responses[0]!.body.place).toEqual(rounded);
      expect(responses[1]!.body.place).toEqual(rounded);
      expect(responses[2]!.body.place).toEqual(rounded);
      const crewMap = responses[11]!.body as MapResponse;
      for (const id of [c.id, i.id, e.id]) {
        expect(feature(crewMap, id)).toMatchObject({ lat: rounded.lat, lon: rounded.lon, precision: 'approximate', who: 'Ana' });
        expect(feature(crewMap, id)!.sharing).toBeUndefined();
      }
    }
    // The author's own map: the spot, drawn as a pin, with how others get it.
    const own = await getMap(ana, `?mode=crew&crew=${crewId}`);
    expect(feature(own, c.id)).toMatchObject({ ...HERE, precision: 'exact', sharing: 'approximate' });
    expect(feature(own, c.id)!.who).toBeUndefined();
  });

  it('exact: everyone who can see the item gets the point, nobody else', async () => {
    const e = (await ana.post('/api/events', plan({ title: 'At the falls', inviteUserIds: [ben.user.id], place: place('exact', THERE) }))).body;
    expect((await ben.get(`/api/events/${e.id}`)).body.place).toEqual({ ...THERE, precision: 'exact' });
    expect(feature(await getMap(ben), e.id)).toMatchObject({ ...THERE, precision: 'exact', kind: 'event' });
    expect((await cal.get(`/api/events/${e.id}`)).status).toBe(404);
    expect(ids(await getMap(cal))).not.toContain(e.id);
    expect(leaks((await getMap(dan)).features, THERE)).toBe(false);
  });

  it('only me: on the author’s map only; others never get coordinates', async () => {
    const e = (await ana.post('/api/events', plan({ title: 'Secret spring', inviteUserIds: [ben.user.id], place: place('only_me') }))).body;
    const c = (await ana.post('/api/chapters', chapter({ title: 'Secret camp', peopleIds: [ben.user.id], place: place('only_me') }))).body;
    for (const id of [e.id, c.id]) expect(feature(await getMap(ana), id)).toMatchObject({ ...HERE, precision: 'exact', sharing: 'only_me' });
    const seen = await ben.get(`/api/events/${e.id}`);
    expect(seen.body).toMatchObject({ locationName: 'Elliðaárdalur', place: null });
    expect((await ben.get(`/api/chapters/${c.id}`)).body.place).toBeNull();
    const benMap = await getMap(ben);
    expect(ids(benMap)).not.toContain(e.id);
    expect(ids(benMap)).not.toContain(c.id);
    expect(leaks(benMap)).toBe(false);
    expect(leaks((await ben.get('/api/me/export')).body)).toBe(false);
  });
});

describe('who sees places at all', () => {
  it('“Show my places on maps” off: no one else gets any of your points; your own map still works', async () => {
    const e = (await ana.post('/api/events', plan({ title: 'Switch test', inviteUserIds: [ben.user.id], place: place('exact', THERE) }))).body;
    const off = await ana.patch('/api/me', { showPlaces: false });
    expect(off.status).toBe(200);
    expect(off.body.showPlaces).toBe(false);
    expect((await ana.get('/api/auth/me')).body.showPlaces).toBe(false);

    expect((await ben.get(`/api/events/${e.id}`)).body).toMatchObject({ title: 'Switch test', place: null });
    const benMap = await getMap(ben);
    expect(ids(benMap)).not.toContain(e.id);
    expect(leaks(benMap, THERE)).toBe(false);
    expect(leaks((await getMap(cal, `?mode=crew&crew=${crewId}`)).features.filter((f) => f.who === 'Ana'))).toBe(false);
    expect((await getMap(cal, `?mode=crew&crew=${crewId}`)).features.some((f) => f.who === 'Ana')).toBe(false);
    expect(feature(await getMap(ana), e.id)).toMatchObject({ ...THERE, precision: 'exact' });
    expect((await ana.get(`/api/events/${e.id}`)).body.place).toEqual({ ...THERE, precision: 'exact' });

    expect((await ana.patch('/api/me', { showPlaces: true })).body.showPlaces).toBe(true);
    expect((await ben.get(`/api/events/${e.id}`)).body.place).toEqual({ ...THERE, precision: 'exact' });
    expect(ids(await getMap(ben))).toContain(e.id);
  });

  it('blocked users never see each other’s places, either way', async () => {
    const c = (await ben.post('/api/chapters', chapter({ crewId, title: 'Ben’s crew walk', place: place('exact', THERE) }))).body;
    const i = (await cal.post('/api/ideas', { title: 'Cal’s crew idea', crewId, place: place('exact', THERE) })).body;
    expect(ids(await getMap(cal, `?mode=crew&crew=${crewId}`))).toContain(c.id);
    expect(ids(await getMap(ben, `?mode=crew&crew=${crewId}`))).toContain(i.id);

    expect((await cal.post('/api/blocks', { userId: ben.user.id })).status).toBe(200);
    // The items stay visible through the crew; their places don't, for the blocker or the blocked.
    const chapterForCal = await cal.get(`/api/chapters/${c.id}`);
    expect(chapterForCal.status).toBe(200);
    expect(chapterForCal.body.place).toBeNull();
    const ideaForBen = await ben.get(`/api/ideas/${i.id}`);
    expect(ideaForBen.status).toBe(200);
    expect(ideaForBen.body.place).toBeNull();
    expect(ids(await getMap(cal, `?mode=crew&crew=${crewId}`))).not.toContain(c.id);
    expect(ids(await getMap(ben, `?mode=crew&crew=${crewId}`))).not.toContain(i.id);
    // Everyone else still sees both.
    expect(ids(await getMap(ana, `?mode=crew&crew=${crewId}`))).toEqual(expect.arrayContaining([c.id, i.id]));

    await cal.del(`/api/blocks/${ben.user.id}`);
    expect((await cal.get(`/api/chapters/${c.id}`)).body.place).toEqual({ ...THERE, precision: 'exact' });
    expect(ids(await getMap(ben, `?mode=crew&crew=${crewId}`))).toContain(i.id);
  });

  it('an idea’s place name goes only where its point goes', async () => {
    const name = 'Tiny Hamlet, Iceland';
    const secret = (await ana.post('/api/ideas', { title: 'Hamlet secret', audience: 'friends', place: place('only_me', HERE, name) })).body;
    expect((await ana.get(`/api/ideas/${secret.id}`)).body.locationName).toBe(name);
    expect((await ben.get(`/api/ideas/${secret.id}`)).body).toMatchObject({ title: 'Hamlet secret', locationName: null, place: null });
    for (const res of [await ben.get('/api/ideas'), await ben.get('/api/home'), await ben.get('/api/map')]) {
      expect(res.status).toBe(200);
      expect(JSON.stringify(res.body)).not.toContain('Tiny Hamlet');
    }
    const circle = (await ana.post('/api/ideas', { title: 'Hamlet circle', crewId, audience: 'crew', place: place('approximate', HERE, name) })).body;
    expect((await ben.get(`/api/ideas/${circle.id}`)).body.locationName).toBe(name);
    // Ana's switch off: neither point nor name.
    await ana.patch('/api/me', { showPlaces: false });
    expect((await ben.get(`/api/ideas/${circle.id}`)).body).toMatchObject({ title: 'Hamlet circle', locationName: null, place: null });
    await ana.patch('/api/me', { showPlaces: true });
    // Across a block (Cal and Ana share only the crew): neither.
    await cal.post('/api/blocks', { userId: ana.user.id });
    expect((await cal.get(`/api/ideas/${circle.id}`)).body).toMatchObject({ title: 'Hamlet circle', locationName: null, place: null });
    await cal.del(`/api/blocks/${ana.user.id}`);
    expect((await cal.get(`/api/ideas/${circle.id}`)).body.locationName).toBe(name);
  });

  it('matches the item routes: whatever is on someone’s map they can open, and nothing they can’t', async () => {
    // Ana's private journal entry and a friends-only idea: Ben (a friend) may see the idea, Cal may not.
    const journal = (await ana.post('/api/chapters', chapter({ title: 'Dear diary', audience: 'only_me', place: place('exact') }))).body;
    const friendsIdea = (await ana.post('/api/ideas', { title: 'Friends’ idea', audience: 'friends', place: place('exact') })).body;
    // Ben is only connected to the idea once he is in for it.
    expect(ids(await getMap(ben))).not.toContain(friendsIdea.id);
    expect((await ben.post(`/api/ideas/${friendsIdea.id}/interest`)).status).toBe(200);
    expect(ids(await getMap(ben))).toContain(friendsIdea.id);

    for (const viewer of [ben, cal, dan]) {
      const queries = ['', '?mode=memories', '?mode=adventures', ...(viewer === dan ? [] : [`?mode=crew&crew=${crewId}`])];
      for (const q of queries) {
        const m = await getMap(viewer, q);
        expect(ids(m)).not.toContain(journal.id);
        for (const f of m.features) {
          if (f.kind === 'chapter' || f.kind === 'event' || f.kind === 'idea') {
            expect((await viewer.get(`/api/${f.kind}s/${f.id}`)).status).toBe(200);
          }
          expect(f.kind).not.toBe('waypoint');
        }
      }
    }
    expect((await cal.get(`/api/ideas/${friendsIdea.id}`)).status).toBe(404);
    expect(ids(await getMap(cal))).not.toContain(friendsIdea.id);
    expect(ids(await getMap(dan))).toEqual([]);
  });
});

describe('GET /map', () => {
  it('modes: mine, memories, adventures and crew pick what they should', async () => {
    const [mo, mi] = (await Promise.all(['moa', 'mia'].map((u) => t.signUp(u)))) as [Client, Client];
    await t.befriend(mo, mi);
    const crew = (await mo.post('/api/crews', { name: 'Moa and Mia' })).body.id as string;
    await mo.post(`/api/crews/${crew}/invites`, { userIds: [mi.user.id] });
    await mi.post(`/api/crews/${crew}/accept`);

    const memory = (await mo.post('/api/chapters', chapter({ title: 'Last summer', place: place() }))).body;
    const past = (await mo.post('/api/events', plan({ title: 'Past plan', startsAt: inDays(-20), place: place() }))).body;
    const ahead = (await mo.post('/api/events', plan({ title: 'Plan ahead', startsAt: inDays(5), category: 'expedition', place: place() }))).body;
    const dream = (await mo.post('/api/ideas', { title: 'A dream', category: 'outdoor', place: place() })).body;
    const shelved = (await mo.post('/api/ideas', { title: 'Shelved', place: place() })).body;
    await mo.patch(`/api/ideas/${shelved.id}`, { status: 'archived' });
    const canceled = (await mo.post('/api/events', plan({ title: 'Called off', place: place() }))).body;
    await mo.post(`/api/events/${canceled.id}/status`, { status: 'canceled' });
    const declined = (await mi.post('/api/events', plan({ title: 'Mi’s party', inviteUserIds: [mo.user.id], place: place() }))).body;
    await mo.post(`/api/events/${declined.id}/rsvp`, { status: 'declined' });
    const noPlace = (await mo.post('/api/events', plan({ title: 'Nowhere yet' }))).body;
    const crewPlan = (await mi.post('/api/events', plan({ title: 'Crew plan', crewId: crew, place: place() }))).body;
    const crewChapter = (await mi.post('/api/chapters', chapter({ title: 'Crew memory', crewId: crew, place: place() }))).body;

    const mine = await getMap(mo);
    expect(ids(mine).sort()).toEqual([memory.id, past.id, ahead.id, dream.id].sort());
    expect(mine.hidden).toBe(0);
    expect(ids(await getMap(mo, '?mode=memories')).sort()).toEqual([memory.id, past.id].sort());
    expect(ids(await getMap(mo, '?mode=adventures')).sort()).toEqual([ahead.id, dream.id].sort());
    const crewMap = await getMap(mo, `?mode=crew&crew=${crew}`);
    expect(ids(crewMap).sort()).toEqual([crewPlan.id, crewChapter.id].sort());
    for (const f of crewMap.features) expect(f).toMatchObject({ crewId: crew, who: 'Mia' });
    expect(ids(mine)).not.toContain(noPlace.id);

    // The shape of each kind.
    expect(feature(mine, memory.id)).toEqual({
      kind: 'chapter',
      id: memory.id,
      title: 'Last summer',
      date: '2026-06-01',
      placeName: 'Elliðaárdalur',
      ...HERE,
      precision: 'exact',
      sharing: 'approximate',
      href: `/chapters/${memory.id}`,
    });
    expect(feature(mine, ahead.id)).toEqual({
      kind: 'event',
      id: ahead.id,
      title: 'Plan ahead',
      emoji: '🧭',
      date: ahead.startsAt,
      allDay: false,
      timeZone: 'Atlantic/Reykjavik',
      placeName: 'Elliðaárdalur',
      ...HERE,
      precision: 'exact',
      sharing: 'exact',
      href: `/events/${ahead.id}`,
    });
    expect(feature(mine, dream.id)).toMatchObject({ kind: 'idea', emoji: '🏔️', href: `/ideas/${dream.id}`, sharing: 'approximate' });
    // Nearest in time first: the plan ahead (5 days) before the past plan (20 days ago).
    expect(ids(mine).indexOf(ahead.id)).toBeLessThan(ids(mine).indexOf(past.id));

    // A plan written up as a chapter shows once, as the chapter, which carries its place.
    const written = await mo.post(`/api/events/${past.id}/chapter`);
    expect(written.status).toBe(201);
    expect(written.body.place).toEqual({ ...HERE, precision: 'approximate' });
    const after = await getMap(mo, '?mode=memories');
    expect(ids(after)).toContain(written.body.id);
    expect(ids(after)).not.toContain(past.id);
  });

  it('an all-day plan is an adventure all through its day; a plan marked done is a memory', async () => {
    const kim = await t.signUp('kim');
    const midnight = new Date();
    midnight.setUTCHours(0, 0, 0, 0);
    // Reykjavik keeps UTC, so this is the plan's own midnight, as the forms and the Loracle store all-day plans.
    const today = (await kim.post('/api/events', plan({ title: 'All day today', startsAt: midnight.toISOString(), allDay: true, place: place() }))).body;
    const done = (await kim.post('/api/events', plan({ title: 'Done early', startsAt: inDays(4), place: place() }))).body;
    expect((await kim.post(`/api/events/${done.id}/status`, { status: 'completed' })).status).toBe(200);
    const ahead = ids(await getMap(kim, '?mode=adventures'));
    const behind = ids(await getMap(kim, '?mode=memories'));
    expect(ahead).toContain(today.id);
    expect(behind).not.toContain(today.id);
    expect(behind).toContain(done.id);
    expect(ahead).not.toContain(done.id);
  });

  it('crew mode is for the crew’s active members only', async () => {
    expect((await dan.get(`/api/map?mode=crew&crew=${crewId}`)).status).toBe(404);
    expect((await dan.get(`/api/map?mode=crew&crew=${randomUUID()}`)).status).toBe(404);
    const eli = await t.signUp('eli');
    await t.befriend(ana, eli);
    await ana.post(`/api/crews/${crewId}/invites`, { userIds: [eli.user.id] });
    // Invited isn't in.
    expect((await eli.get(`/api/map?mode=crew&crew=${crewId}`)).status).toBe(404);
    await eli.post(`/api/crews/${crewId}/accept`);
    expect((await eli.get(`/api/map?mode=crew&crew=${crewId}`)).status).toBe(200);
    expect((await ana.get('/api/map?mode=crew')).status).toBe(400);
    expect((await ana.get('/api/map?mode=everything')).status).toBe(400);
    expect((await ana.get('/api/map?mode=crew&crew=not-a-uuid')).status).toBe(400);
    expect((await t.app.inject({ method: 'GET', url: '/api/map' })).statusCode).toBe(401);
  });

  it('waypoints reach only the wish’s owner', async () => {
    const weighing: Weighing = {
      tags: [],
      desire: 'to cross the highlands',
      binds: [],
      companion: null,
      clock: null,
      obvious: [],
      terms: [],
      hostLanguage: null,
      roadPlan: [],
      keeperPlan: [],
    };
    const [wish] = await t.db
      .insert(wishes)
      .values({
        userId: ana.user.id,
        text: 'I wish to cross the highlands',
        textKey: randomUUID(),
        context: { age: null, money: null, time: null, body: null, languages: null, passport: null, callings: [] },
        realm: { label: 'Reykjavík, Iceland', country: 'IS', radiusKm: NO_LIMIT_KM },
        timeZone: 'Atlantic/Reykjavik',
        day: '2026-11-18',
        status: 'revealed',
        weighing,
      })
      .returning({ id: wishes.id });
    const [road] = await t.db.insert(wishRoads).values({ wishId: wish!.id, status: 'ready', signs: [] }).returning({ id: wishRoads.id });
    const waypoint = (position: number, extra: Partial<typeof wishWaypoints.$inferInsert>) => ({
      roadId: road!.id,
      wishId: wish!.id,
      position,
      kind: 'door' as const,
      emblem: 'ship' as const,
      name: `Waypoint ${position}`,
      when: 'this week',
      place: 'The hut',
      town: 'Landmannalaugar',
      country: 'Iceland',
      geoQuery: 'Landmannalaugar',
      clue: 'A clue',
      trial: 'A trial',
      steps: [],
      ...extra,
    });
    const rows = await t.db
      .insert(wishWaypoints)
      .values([
        waypoint(0, { lat: 63.99, lon: -19.06, precision: 'place', at: '2026-12' }),
        waypoint(1, { lat: 63.98, lon: -19.07, precision: 'place', inkedAt: new Date(), inkedOn: '2026-11-18' }),
        waypoint(2, {}),
      ])
      .returning({ id: wishWaypoints.id });
    const [open, inked, unpinned] = rows.map((r) => r.id) as [string, string, string];

    const mine = await getMap(ana);
    expect(ids(mine, 'waypoint').sort()).toEqual([open, inked].sort());
    expect(feature(mine, open)).toEqual({
      kind: 'waypoint',
      id: open,
      title: 'Waypoint 0',
      date: '2026-12',
      placeName: 'The hut, Landmannalaugar, Iceland',
      lat: 63.99,
      lon: -19.06,
      precision: 'exact',
      href: `/oracle/quest/${wish!.id}`,
    });
    expect(ids(await getMap(ana, '?mode=adventures'), 'waypoint')).toEqual([open]);
    expect(ids(await getMap(ana, '?mode=memories'), 'waypoint')).toEqual([]);
    expect(ids(await getMap(ana, `?mode=crew&crew=${crewId}`), 'waypoint')).toEqual([]);
    expect(ids(mine)).not.toContain(unpinned);
    for (const other of [ben, cal, dan]) {
      for (const q of ['', '?mode=adventures', '?mode=memories']) {
        const m = await getMap(other, q);
        expect(m.features.some((f) => f.kind === 'waypoint')).toBe(false);
        expect(JSON.stringify(m)).not.toContain('63.99');
      }
    }
    // Kept as an idea with a place: it shows once, as the idea; without its place, as the waypoint again.
    const kept = (await ana.post('/api/ideas', { title: 'Waypoint 0', audience: 'only_me', place: { name: 'The hut', lat: 63.99, lon: -19.06 } })).body;
    await t.db.update(wishWaypoints).set({ ideaId: kept.id }).where(eq(wishWaypoints.id, open));
    const deduped = await getMap(ana);
    expect(ids(deduped, 'waypoint')).toEqual([inked]);
    expect(ids(deduped, 'idea')).toContain(kept.id);
    await ana.patch(`/api/ideas/${kept.id}`, { place: null });
    expect(ids(await getMap(ana), 'waypoint').sort()).toEqual([open, inked].sort());
    // Linked to someone else's plan whose point Ana doesn't get ("Only me"): still the waypoint, and the plan
    // is no pin either (the waypoint's staying says nothing about a point she can't have).
    const bens = (await ben.post('/api/events', plan({ title: 'Ben’s hidden hut', inviteUserIds: [ana.user.id], place: place('only_me', { lat: 63.711111, lon: -19.322222 }) }))).body;
    await t.db.update(wishWaypoints).set({ eventId: bens.id }).where(eq(wishWaypoints.id, inked));
    expect(ids(await getMap(ana), 'waypoint').sort()).toEqual([open, inked].sort());
    expect(ids(await getMap(ana))).not.toContain(bens.id);
    // Let go: off the map.
    await t.db.update(wishes).set({ status: 'released' }).where(eq(wishes.id, wish!.id));
    expect(ids(await getMap(ana), 'waypoint')).toEqual([]);
  });

  it('home: only yours, first, in every mode', async () => {
    const res = await ana.put('/api/loracle/settings', { home: { label: 'Reykjavík, Iceland', lat: 64.146582, lon: -21.942635, country: 'IS' } });
    expect(res.status).toBe(200);
    for (const q of ['', '?mode=memories', '?mode=adventures', `?mode=crew&crew=${crewId}`]) {
      const m = await getMap(ana, q);
      expect(m.features[0]).toEqual({
        kind: 'home',
        id: 'home',
        title: 'Reykjavík, Iceland',
        placeName: 'Reykjavík, Iceland',
        lat: 64.146582,
        lon: -21.942635,
        precision: 'exact',
        href: '/oracle',
      });
      expect(m.features.filter((f) => f.kind === 'home')).toHaveLength(1);
    }
    for (const other of [ben, cal, dan]) {
      for (const q of ['', ...(other === dan ? [] : [`?mode=crew&crew=${crewId}`])]) {
        const m = await getMap(other, q);
        expect(m.features.some((f) => f.kind === 'home')).toBe(false);
        expect(JSON.stringify(m)).not.toContain('64.146582');
      }
    }
  });

  it(`shows at most ${MAP_CAP}, nearest in time first, and counts the rest as hidden`, async () => {
    const pat = await t.signUp('pat');
    const n = MAP_CAP + 5;
    // Memory k happened k + 1 days ago.
    const day = (k: number) => new Date(Date.now() - (k + 1) * 86_400_000).toISOString().slice(0, 10);
    await t.db.insert(chapters).values(
      Array.from({ length: n }, (_, k) => ({
        title: `Memory ${k}`,
        occurredOn: day(k),
        createdBy: pat.user.id,
        audience: 'only_me' as const,
        lat: 60 + k / 1000,
        lon: 10,
      })),
    );
    const m = await getMap(pat);
    expect(m.features).toHaveLength(MAP_CAP);
    expect(m.hidden).toBe(5);
    const titles = new Set(m.features.map((f) => f.title));
    // The five furthest back are the ones left out.
    for (let k = MAP_CAP; k < n; k++) expect(titles.has(`Memory ${k}`)).toBe(false);
    expect(titles.has('Memory 0')).toBe(true);
    expect((await getMap(pat, '?mode=memories')).hidden).toBe(5);
    expect((await getMap(pat, '?mode=adventures')).hidden).toBe(0);
  });
});

describe('places that travel', () => {
  it('idea → plan keeps the idea’s precision; plan → chapter is never shared more widely than a chapter', async () => {
    const idea = (await ana.post('/api/ideas', { title: 'Hot river', audience: 'friends', place: place('approximate') })).body;
    await ben.post(`/api/ideas/${idea.id}/interest`);
    const converted = await ana.post(`/api/ideas/${idea.id}/convert`, { startsAt: inDays(3), timeZone: 'Atlantic/Reykjavik' });
    expect(converted.status).toBe(201);
    const eventId = converted.body.eventId as string;
    expect((await ana.get(`/api/events/${eventId}`)).body).toMatchObject({ locationName: 'Elliðaárdalur', place: { ...HERE, precision: 'approximate' } });
    const forBen = await ben.get(`/api/events/${eventId}`);
    expect(forBen.body.place).toEqual({ ...approximatePoint(HERE.lat, HERE.lon), precision: 'approximate' });
    expect(leaks(forBen.body)).toBe(false);

    // Ana writes up her own exact plan: her chapter has the point, shared no more widely than a chapter's.
    const own = (await ana.post('/api/events', plan({ title: 'Ana’s glacier day', startsAt: inDays(-3), place: place('exact', THERE) }))).body;
    const ownChapter = await ana.post(`/api/events/${own.id}/chapter`);
    expect(ownChapter.status).toBe(201);
    expect(ownChapter.body.place).toEqual({ ...THERE, precision: 'approximate' });

    // A hidden point never travels: Ben writes up a plan whose point only Ana has.
    const secret = (await ana.post('/api/events', plan({ title: 'Secret day', startsAt: inDays(-2), inviteUserIds: [ben.user.id], place: place('only_me') }))).body;
    await ben.post(`/api/events/${secret.id}/rsvp`, { status: 'going' });
    const secretChapter = await ben.post(`/api/events/${secret.id}/chapter`);
    expect(secretChapter.status).toBe(201);
    expect(secretChapter.body).toMatchObject({ locationName: 'Elliðaárdalur', place: null });
    const [row] = await t.db.select({ lat: chapters.lat }).from(chapters).where(eq(chapters.id, secretChapter.body.id));
    expect(row!.lat).toBeNull();
  });

  it('a point travels only with its author, never into something someone else owns', async () => {
    // Owned by someone else, a copy would slip past the author's blocks, their "Show my places on maps" and
    // the first item's audience (who gets a point is decided by the item's created_by).
    const fay = await t.signUp('fay');
    await t.befriend(ana, fay);
    // Ben writes up Ana's exact crew plan: his chapter keeps the name, not her point.
    const e = (await ana.post('/api/events', plan({ title: 'Crew glacier', crewId, startsAt: inDays(-4), inviteUserIds: [ben.user.id], place: place('exact', THERE) }))).body;
    await ben.post(`/api/events/${e.id}/rsvp`, { status: 'going' });
    const written = await ben.post(`/api/events/${e.id}/chapter`);
    expect(written.status).toBe(201);
    expect(written.body).toMatchObject({ locationName: 'Elliðaárdalur', place: null });
    const [row] = await t.db.select({ lat: chapters.lat }).from(chapters).where(eq(chapters.id, written.body.id));
    expect(row!.lat).toBeNull();
    // On Ben's own map the plan's pin stands in for his chapter.
    expect(ids(await getMap(ben, '?mode=memories'))).toContain(e.id);

    // Ana (the crew's admin) plans Ben's crew-only idea for her friends: Fay, outside the crew, never gets
    // his point.
    const idea = (await ben.post('/api/ideas', { title: 'Ben’s crew spring', crewId, audience: 'crew', place: place('exact', THERE) })).body;
    const converted = await ana.post(`/api/ideas/${idea.id}/convert`, { startsAt: inDays(6), timeZone: 'Atlantic/Reykjavik', audience: 'friends' });
    expect(converted.status).toBe(201);
    expect((await fay.get(`/api/ideas/${idea.id}`)).status).toBe(404);
    const forFay = await fay.get(`/api/events/${converted.body.eventId}`);
    expect(forFay.status).toBe(200);
    expect(forFay.body.place).toBeNull();
    expect(leaks(forFay.body, THERE)).toBe(false);
    expect(leaks(await getMap(fay), THERE)).toBe(false);

    // An "Only me" idea planned by someone else: its place name stays hidden too (the idea's own note goes).
    const hidden = (
      await ben.post('/api/ideas', {
        title: 'Ben’s secret pool',
        crewId,
        audience: 'crew',
        whereNote: 'Past the old bridge',
        place: place('only_me', THERE, 'Tiny Hamlet, Iceland'),
      })
    ).body;
    const planned = await ana.post(`/api/ideas/${hidden.id}/convert`, { startsAt: inDays(7), timeZone: 'Atlantic/Reykjavik' });
    expect(planned.status).toBe(201);
    expect((await ana.get(`/api/events/${planned.body.eventId}`)).body).toMatchObject({ locationName: 'Past the old bridge', place: null });
  });
});

describe('your data', () => {
  it('the export has your places exactly, and other people’s only as you may see them', async () => {
    const mine = (await ana.post('/api/chapters', chapter({ title: 'Export walk', peopleIds: [ben.user.id], place: place('approximate') }))).body;
    const data = (await ana.get('/api/me/export')).body;
    expect(data.profile.showPlacesOnMaps).toBe(true);
    expect(data.chapters.find((c: any) => c.id === mine.id).place).toEqual({ ...HERE, precision: 'approximate' });
    expect(data.ideas.created.find((i: any) => i.title === 'Sleep by the river').place).toEqual({ ...HERE, precision: 'approximate' });
    expect(data.events.find((e: any) => e.title === 'Meet at the falls' && e.place)?.place).toEqual({ ...HERE, precision: 'exact' });
    const bens = (await ben.get('/api/me/export')).body;
    expect(bens.chapters.find((c: any) => c.id === mine.id).place).toEqual({ ...approximatePoint(HERE.lat, HERE.lon), precision: 'approximate' });
    expect(leaks(bens)).toBe(false);
  });

  it('deleting an account keeps no point only that person could have', async () => {
    const del = (c: Client) =>
      t.app.inject({ method: 'DELETE', url: '/api/me', headers: { cookie: c.cookie }, payload: { password: 'correct horse battery' } });
    const row = async (table: typeof chapters | typeof events | typeof ideas, id: string) => {
      const [r] = await t.db.select({ lat: table.lat, lon: table.lon }).from(table).where(eq(table.id, id));
      return r;
    };

    const gus = await t.signUp('gus');
    await t.befriend(gus, ben);
    const approx = (await gus.post('/api/chapters', chapter({ title: 'Gus’s walk', peopleIds: [ben.user.id], place: place('approximate') }))).body;
    const hidden = (await gus.post('/api/events', plan({ title: 'Gus’s secret', inviteUserIds: [ben.user.id], place: place('only_me') }))).body;
    const open = (await gus.post('/api/events', plan({ title: 'Gus’s meet', inviteUserIds: [ben.user.id], place: place('exact', THERE) }))).body;
    expect((await del(gus)).statusCode).toBe(200);
    expect(await row(chapters, approx.id)).toEqual(approximatePoint(HERE.lat, HERE.lon));
    expect(await row(events, hidden.id)).toEqual({ lat: null, lon: null });
    expect(await row(events, open.id)).toEqual(THERE);
    // What everyone left sees is unchanged.
    expect((await ben.get(`/api/chapters/${approx.id}`)).body.place).toEqual({ ...approximatePoint(HERE.lat, HERE.lon), precision: 'approximate' });
    expect((await ben.get(`/api/events/${hidden.id}`)).body.place).toBeNull();

    // With the switch off, nothing of theirs keeps a point.
    const hal = await t.signUp('hal');
    await t.befriend(hal, ben);
    const halMeet = (await hal.post('/api/events', plan({ title: 'Hal’s meet', inviteUserIds: [ben.user.id], place: place('exact', THERE) }))).body;
    await hal.patch('/api/me', { showPlaces: false });
    expect((await del(hal)).statusCode).toBe(200);
    expect(await row(events, halMeet.id)).toEqual({ lat: null, lon: null });

    // Nor with a block, either way: the block goes with the account, and a former member's point reaches
    // everyone who sees the item, the people on the other side of the block too.
    const ivy = await t.signUp('ivy');
    await t.befriend(ivy, ben);
    const ivyMeet = (await ivy.post('/api/events', plan({ title: 'Ivy’s meet', inviteUserIds: [ben.user.id], place: place('exact', THERE) }))).body;
    const ivyWalk = (await ivy.post('/api/chapters', chapter({ title: 'Ivy’s walk', peopleIds: [ben.user.id], place: place('approximate') }))).body;
    expect((await ivy.post('/api/blocks', { userId: dan.user.id })).status).toBe(200);
    expect((await del(ivy)).statusCode).toBe(200);
    expect(await row(events, ivyMeet.id)).toEqual({ lat: null, lon: null });
    expect(await row(chapters, ivyWalk.id)).toEqual({ lat: null, lon: null });
  });
});
