// Account deletion (owner's policy: personal data goes, shared history stays
// anonymised), data export, and what native apps need from the API.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, inDays, PNG_1X1, type Client, type TestApp } from './helpers.ts';

let t: TestApp;
let gunna: Client, beggi: Client;
let crewId: string, eventId: string, sharedChapterId: string, journalId: string;
let crewIdeaId: string, privateIdeaId: string, photoUrl: string;

beforeAll(async () => {
  t = await createTestApp();
  gunna = await t.signUp('gunna');
  beggi = await t.signUp('beggi');
  await t.befriend(gunna, beggi);

  crewId = (await gunna.post('/api/crews', { name: 'Legends' })).body.id;
  await gunna.post(`/api/crews/${crewId}/invites`, { userIds: [beggi.user.id] });
  await beggi.post(`/api/crews/${crewId}/accept`);

  eventId = (await gunna.post('/api/events', { title: 'Cabin', startsAt: inDays(5), timeZone: 'UTC', inviteUserIds: [beggi.user.id] })).body.id;
  await beggi.post(`/api/events/${eventId}/rsvp`, { status: 'going' });
  await gunna.post(`/api/events/${eventId}/comments`, { body: 'Bring the sausages' });

  sharedChapterId = (await gunna.post('/api/chapters', { title: 'Shared', occurredOn: '2025-05-01', peopleIds: [beggi.user.id] })).body.id;
  await gunna.post(`/api/chapters/${sharedChapterId}/contributions`, { type: 'story', body: 'My side of it.' });
  const photo = await gunna.upload(`/api/media?chapterId=${sharedChapterId}`, PNG_1X1);
  await gunna.post(`/api/chapters/${sharedChapterId}/contributions`, { type: 'photo', mediaId: photo.body.id });
  await beggi.post(`/api/chapters/${sharedChapterId}/contributions`, { type: 'quote', body: 'Allegations.' });
  photoUrl = photo.body.url;

  journalId = (await gunna.post('/api/chapters', { title: 'Dear diary', occurredOn: '2025-06-01', audience: 'only_me' })).body.id;
  crewIdeaId = (await gunna.post('/api/ideas', { title: 'Crew idea', crewId })).body.id;
  privateIdeaId = (await gunna.post('/api/ideas', { title: 'Secret idea' })).body.id;
  await gunna.post('/api/personal', { title: 'Dentist', startsAt: inDays(1) });
});
afterAll(() => t.close());

describe('data export', () => {
  it('contains what the person put into LORE', async () => {
    const res = await gunna.get('/api/me/export');
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain('lore-gunna.json');
    const data = res.body;
    expect(data.profile.username).toBe('gunna');
    expect(data.chapters.map((c: any) => c.title)).toEqual(expect.arrayContaining(['Shared', 'Dear diary']));
    const shared = data.chapters.find((c: any) => c.title === 'Shared');
    expect(shared.myContributions.map((c: any) => c.type)).toEqual(['story', 'photo']);
    expect(data.personalCalendar[0].title).toBe('Dentist');
    expect(JSON.stringify(data)).not.toMatch(/password|scrypt/i);
  });
});

describe('account deletion', () => {
  it('requires the password', async () => {
    const res = await t.app.inject({
      method: 'DELETE',
      url: '/api/me',
      headers: { cookie: gunna.cookie },
      payload: { password: 'not my password' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('removes the person and their private things', async () => {
    const res = await t.app.inject({
      method: 'DELETE',
      url: '/api/me',
      headers: { cookie: gunna.cookie },
      payload: { password: 'correct horse battery' },
    });
    expect(res.statusCode).toBe(200);
    expect((await gunna.get('/api/auth/me')).status).toBe(401);
    expect((await beggi.get('/api/users/gunna')).status).toBe(404);
    expect((await beggi.get('/api/friends')).body).toHaveLength(0);
    expect((await beggi.get(`/api/ideas/${privateIdeaId}`)).status).toBe(404);
    // The username is free again.
    await expect(t.signUp('gunna')).resolves.toBeTruthy();
  });

  it('keeps shared history, anonymised', async () => {
    const chapter = await beggi.get(`/api/chapters/${sharedChapterId}`);
    expect(chapter.status).toBe(200);
    const [story, photo, quote] = chapter.body.contributions;
    expect(story).toMatchObject({ type: 'story', body: 'My side of it.', author: null });
    expect(photo).toMatchObject({ type: 'photo', author: null });
    expect(quote.author.username).toBe('beggi');
    // The chapter has a new organizer, and the photo still loads.
    expect(chapter.body.canEdit).toBe(true);
    expect((await beggi.get(photo.media.url)).status).toBe(200);

    const comments = await beggi.get(`/api/events/${eventId}/comments`);
    expect(comments.body[0]).toMatchObject({ body: 'Bring the sausages', author: null });
  });

  it('hands over what they ran', async () => {
    const crew = await beggi.get(`/api/crews/${crewId}`);
    expect(crew.body).toMatchObject({ myRole: 'owner', memberCount: 1 });
    const event = await beggi.get(`/api/events/${eventId}`);
    expect(event.body).toMatchObject({ myRole: 'organizer', canEdit: true, createdBy: null });
    const idea = await beggi.get(`/api/ideas/${crewIdeaId}`);
    expect(idea.body.createdBy).toBeNull();
  });

  it('deletes private journal chapters entirely', async () => {
    // Nobody could see it before; make sure it's gone, not just hidden.
    const fresh = await t.signUp('auditor');
    expect((await fresh.get(`/api/chapters/${journalId}`)).status).toBe(404);
    const exportOfBeggi = await beggi.get('/api/me/export');
    expect(exportOfBeggi.body.chapters.map((c: any) => c.title)).not.toContain('Dear diary');
  });
});

describe('native apps', () => {
  it('answers CORS preflight for the app origins only', async () => {
    const ok = await t.app.inject({
      method: 'OPTIONS',
      url: '/api/auth/login',
      headers: { origin: 'https://localhost', 'access-control-request-method': 'POST' },
    });
    expect(ok.statusCode).toBe(204);
    expect(ok.headers['access-control-allow-origin']).toBe('https://localhost');
    expect(ok.headers['access-control-allow-credentials']).toBeUndefined();

    const evil = await t.app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { origin: 'https://evil.example' },
    });
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('signs in from the app origin and works with the bearer token', async () => {
    await t.signUp('phone');
    const login = await t.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: 'https://localhost', 'x-lore-client': 'native' },
      payload: { login: 'phone', password: 'correct horse battery' },
    });
    expect(login.statusCode).toBe(200);
    const { token } = JSON.parse(login.body);
    const crew = await t.app.inject({
      method: 'POST',
      url: '/api/crews',
      headers: { origin: 'https://localhost', authorization: `Bearer ${token}` },
      payload: { name: 'Phone crew' },
    });
    expect(crew.statusCode).toBe(201);
  });
});

describe('photo links', () => {
  it('work without a session only with a valid signature', async () => {
    const signed = await t.app.inject({ method: 'GET', url: photoUrl });
    expect(signed.statusCode).toBe(200);
    expect(signed.headers['content-type']).toBe('image/png');

    const tampered = await t.app.inject({ method: 'GET', url: photoUrl.replace(/sig=.{4}/, 'sig=AAAA') });
    expect(tampered.statusCode).toBe(401);
    const unsigned = await t.app.inject({ method: 'GET', url: photoUrl.split('?')[0]! });
    expect(unsigned.statusCode).toBe(401);
    const expired = await t.app.inject({ method: 'GET', url: photoUrl.replace(/exp=\d+/, 'exp=1000') });
    expect(expired.statusCode).toBe(401);
  });
});
