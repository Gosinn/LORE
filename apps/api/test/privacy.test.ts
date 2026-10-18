import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, inDays, PNG_1X1, type Client, type TestApp } from './helpers.ts';

// Cast: Ari and Bea are friends. Ari and Cal share a crew. Dan is a stranger to all.
let t: TestApp;
let ari: Client, bea: Client, cal: Client, dan: Client;
let crewId: string;

beforeAll(async () => {
  t = await createTestApp();
  [ari, bea, cal, dan] = (await Promise.all(['ari', 'bea', 'cal', 'dan'].map((u) => t.signUp(u)))) as [Client, Client, Client, Client];
  await t.befriend(ari, bea);
  const crew = await ari.post('/api/crews', { name: 'The Absolute Legends', emoji: '🏔️' });
  crewId = crew.body.id;
  await ari.post(`/api/crews/${crewId}/invites`, { userIds: [bea.user.id] });
  await bea.post(`/api/crews/${crewId}/accept`);
  // Cal reaches the crew through Bea, who is his friend.
  await t.befriend(bea, cal);
  await bea.post(`/api/crews/${crewId}/invites`, { userIds: [cal.user.id] });
  await cal.post(`/api/crews/${crewId}/accept`);
});
afterAll(() => t.close());

const event = (overrides: Record<string, unknown> = {}) => ({
  title: 'Cabin weekend',
  startsAt: inDays(10),
  timeZone: 'Atlantic/Reykjavik',
  ...overrides,
});

describe('personal calendar', () => {
  it('is visible to its owner only, by any route', async () => {
    const entry = await ari.post('/api/personal', { title: 'Dentist', startsAt: inDays(2, 9) });
    expect(entry.status).toBe(201);
    const range = `?from=${encodeURIComponent(inDays(0, 0))}&to=${encodeURIComponent(inDays(5, 0))}`;
    expect((await ari.get(`/api/personal${range}`)).body).toHaveLength(1);
    expect((await bea.get(`/api/personal${range}`)).body).toHaveLength(0);
    expect((await bea.put(`/api/personal/${entry.body.id}`, { title: 'Hacked', startsAt: inDays(2) })).status).toBe(404);
    expect((await bea.del(`/api/personal/${entry.body.id}`)).status).toBe(404);
    // And it never shows up in the shared calendar.
    const shared = await ari.get(`/api/events${range}`);
    expect(shared.body.map((e: any) => e.title)).not.toContain('Dentist');
  });
});

describe('event audiences', () => {
  it('participants: only invited people can see it', async () => {
    const e = await ari.post('/api/events', event({ inviteUserIds: [bea.user.id] }));
    expect(e.status).toBe(201);
    expect((await bea.get(`/api/events/${e.body.id}`)).status).toBe(200);
    expect((await cal.get(`/api/events/${e.body.id}`)).status).toBe(404);
    expect((await dan.get(`/api/events/${e.body.id}`)).status).toBe(404);
  });

  it('friends: the creator’s friends can see and join it', async () => {
    const e = await ari.post('/api/events', event({ audience: 'friends', title: 'Friends only' }));
    expect((await bea.get(`/api/events/${e.body.id}`)).status).toBe(200);
    expect((await cal.get(`/api/events/${e.body.id}`)).status).toBe(404);
    const rsvp = await bea.post(`/api/events/${e.body.id}/rsvp`, { status: 'going' });
    expect(rsvp.body.myRsvp).toBe('going');
    expect((await dan.post(`/api/events/${e.body.id}/rsvp`, { status: 'going' })).status).toBe(404);
  });

  it('crew: active members only, not people merely invited to the crew', async () => {
    const e = await ari.post('/api/events', event({ crewId, title: 'Crew night' }));
    expect(e.body.audience).toBe('crew');
    expect((await cal.get(`/api/events/${e.body.id}`)).status).toBe(200);
    expect((await dan.get(`/api/events/${e.body.id}`)).status).toBe(404);

    const ella = await t.signUp('ella');
    await t.befriend(ari, ella);
    await ari.post(`/api/crews/${crewId}/invites`, { userIds: [ella.user.id] });
    expect((await ella.get(`/api/events/${e.body.id}`)).status).toBe(404);
    await ella.post(`/api/crews/${crewId}/accept`);
    expect((await ella.get(`/api/events/${e.body.id}`)).status).toBe(200);
  });

  it('can’t be used to invite strangers', async () => {
    const res = await ari.post('/api/events', event({ inviteUserIds: [dan.user.id] }));
    expect(res.status).toBe(400);
  });

  it('can’t be attached to a crew you’re not in', async () => {
    const res = await dan.post('/api/events', event({ crewId }));
    expect(res.status).toBe(400);
  });
});

describe('ideas', () => {
  it('are private by default', async () => {
    const idea = await ari.post('/api/ideas', { title: 'Sail to the Westfjords' });
    expect(idea.body.audience).toBe('only_me');
    expect((await bea.get(`/api/ideas/${idea.body.id}`)).status).toBe(404);
    expect((await bea.get('/api/ideas')).body.map((i: any) => i.id)).not.toContain(idea.body.id);
  });

  it('in a crew are shared with the crew by default', async () => {
    const idea = await ari.post('/api/ideas', { title: 'Rent a cabin', crewId });
    expect(idea.body.audience).toBe('crew');
    expect((await cal.get(`/api/ideas/${idea.body.id}`)).status).toBe(200);
    expect((await dan.get(`/api/ideas/${idea.body.id}`)).status).toBe(404);
  });
});

describe('chapters and media', () => {
  it('only_me chapters stay private even from people listed in them', async () => {
    const ch = await ari.post('/api/chapters', {
      title: 'Journal',
      occurredOn: '2024-06-01',
      audience: 'only_me',
      peopleIds: [bea.user.id],
    });
    expect(ch.status).toBe(201);
    expect((await bea.get(`/api/chapters/${ch.body.id}`)).status).toBe(404);
  });

  it('participant chapters are visible to their people, and so are their photos', async () => {
    const ch = await ari.post('/api/chapters', { title: 'The sausage incident', occurredOn: '2025-07-14', peopleIds: [bea.user.id] });
    const id = ch.body.id;
    const upload = await ari.upload(`/api/media?chapterId=${id}`, PNG_1X1);
    expect(upload.status).toBe(201);
    expect(upload.body).toMatchObject({ mimeType: 'image/png', width: 1, height: 1 });
    await ari.post(`/api/chapters/${id}/contributions`, { type: 'photo', mediaId: upload.body.id });

    expect((await bea.get(`/api/chapters/${id}`)).status).toBe(200);
    expect((await bea.get(upload.body.url)).status).toBe(200);
    // Cal shares a crew with Ari, but the chapter isn't shared with the crew: he
    // can't open it, so he never receives a signed link to its photos, and the
    // file itself, asked for without a signature, is hidden from him too.
    expect((await cal.get(`/api/chapters/${id}`)).status).toBe(404);
    const unsigned = upload.body.url.split('?')[0];
    expect((await bea.get(unsigned)).status).toBe(200);
    expect((await cal.get(unsigned)).status).toBe(404);
    expect((await dan.get(unsigned)).status).toBe(404);
  });

  it('rejects files that aren’t images, whatever they claim to be', async () => {
    const ch = await ari.post('/api/chapters', { title: 'Uploads', occurredOn: '2025-01-01' });
    const res = await ari.upload(`/api/media?chapterId=${ch.body.id}`, Buffer.from('<script>alert(1)</script>'), 'x.png');
    expect(res.status).toBe(400);
  });

  it('don’t let outsiders add photos', async () => {
    const ch = await ari.post('/api/chapters', { title: 'Closed', occurredOn: '2025-01-02' });
    expect((await dan.upload(`/api/media?chapterId=${ch.body.id}`, PNG_1X1)).status).toBe(404);
  });
});

describe('blocking', () => {
  it('hides people from each other and stops friend requests', async () => {
    const pest = await t.signUp('pest');
    await dan.post('/api/blocks', { userId: pest.user.id });
    expect((await pest.post('/api/friends/requests', { username: 'dan' })).status).toBe(404);
    expect((await pest.get('/api/users/dan')).status).toBe(404);
    expect((await pest.get('/api/users/search?q=dan')).body).toHaveLength(0);
  });

  it('ends an existing friendship', async () => {
    const x = await t.signUp('xena');
    const y = await t.signUp('yuri');
    await t.befriend(x, y);
    expect((await x.get('/api/friends')).body).toHaveLength(1);
    await x.post('/api/blocks', { userId: y.user.id });
    expect((await x.get('/api/friends')).body).toHaveLength(0);
    expect((await y.get('/api/friends')).body).toHaveLength(0);
  });
});
