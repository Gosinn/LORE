import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { blocks, comments, supportMessages, users } from '../src/db/schema.ts';
import { createTestApp, inDays, type Client, type TestApp } from './helpers.ts';

describe('safety: terms, reports, moderation, support', () => {
  let t: Awaited<ReturnType<typeof createTestApp>>;
  let mod: Client;
  let ana: Client;
  let troll: Client;
  let stranger: Client;
  let eventId = '';
  let commentId = '';

  beforeAll(async () => {
    t = await createTestApp({ config: { adminUsernames: ['moderator'] } });
    mod = await t.signUp('moderator');
    ana = await t.signUp('anna');
    troll = await t.signUp('trollo');
    stranger = await t.signUp('stranger');
    await t.befriend(ana, troll);
    const event = await ana.post('/api/events', {
      title: 'Hike',
      startsAt: inDays(3),
      timeZone: 'UTC',
      inviteUserIds: [troll.user.id],
    });
    eventId = event.body.id;
    await troll.post(`/api/events/${eventId}/rsvp`, { status: 'going' });
    const comment = await troll.post(`/api/events/${eventId}/comments`, { body: 'something nasty' });
    if (!Array.isArray(comment.body)) throw new Error(`setup: ${event.status} ${JSON.stringify(event.body).slice(0, 200)} | ${comment.status} ${JSON.stringify(comment.body).slice(0, 200)}`);
    commentId = comment.body.at(-1).id;
  });
  afterAll(() => t.close());

  it('asks new people to agree to the Terms, and remembers when they did', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'noterms', displayName: 'No', email: 'noterms@example.test', password: 'correct horse battery' },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.fields.acceptTerms).toBeTruthy();
    const [u] = await t.db.select({ at: users.termsAcceptedAt }).from(users).where(eq(users.id, ana.user.id));
    expect(u!.at).toBeInstanceOf(Date);
  });

  it('tells moderators apart', async () => {
    expect((await mod.get('/api/auth/me')).body.isAdmin).toBe(true);
    expect((await ana.get('/api/auth/me')).body.isAdmin).toBe(false);
    expect((await ana.get('/api/admin/reports')).status).toBe(404);
    expect((await ana.get('/api/admin/summary')).status).toBe(404);
    expect((await ana.get('/api/admin/loracle/failures')).status).toBe(404);
    const failures = await mod.get('/api/admin/loracle/failures');
    expect(failures.status).toBe(200);
    expect(Array.isArray(failures.body.failures)).toBe(true);
  });

  it('only lets you report what you can see', async () => {
    const res = await stranger.post('/api/reports', { targetType: 'comment', targetId: commentId, reason: 'harassment' });
    expect(res.status).toBe(404);
    expect((await stranger.post('/api/reports', { targetType: 'event', targetId: eventId, reason: 'spam' })).status).toBe(404);
    expect((await ana.post('/api/reports', { targetType: 'user', targetId: ana.user.id, reason: 'spam' })).status).toBe(400);
  });

  it('reports a comment and blocks its author in one go', async () => {
    const res = await ana.post('/api/reports', {
      targetType: 'comment',
      targetId: commentId,
      reason: 'harassment',
      details: 'Not okay.',
      block: true,
    });
    expect(res.status).toBe(201);
    expect(res.body.blocked).toBe(true);
    const block = await t.db.select().from(blocks).where(eq(blocks.blockerId, ana.user.id));
    expect(block.map((b) => b.blockedId)).toEqual([troll.user.id]);
    // Reporting twice doesn't pile up.
    await ana.post('/api/reports', { targetType: 'comment', targetId: commentId, reason: 'harassment' });
    const summary = await mod.get('/api/admin/summary');
    expect(summary.body.openReports).toBe(1);
    expect(summary.body.oldestOpenAt).toBeTruthy();
  });

  it('shows moderators what was reported, as it was', async () => {
    await troll.post('/api/reports', { targetType: 'user', targetId: ana.user.id, reason: 'spam' });
    const list = await mod.get('/api/admin/reports');
    expect(list.status).toBe(200);
    const report = list.body.find((r: any) => r.targetType === 'comment');
    expect(report).toMatchObject({
      reason: 'harassment',
      details: 'Not okay.',
      snapshot: 'something nasty',
      href: `/events/${eventId}`,
      status: 'open',
    });
    expect(report.reporter.id).toBe(ana.user.id);
    expect(report.subject).toMatchObject({ id: troll.user.id, suspended: false });
  });

  it('dismisses a report that breaks no rule', async () => {
    const list = await mod.get('/api/admin/reports');
    const report = list.body.find((r: any) => r.targetType === 'user');
    const res = await mod.post(`/api/admin/reports/${report.id}/resolve`, { action: 'dismiss' });
    expect(res.status).toBe(200);
    const closed = await mod.get('/api/admin/reports?status=closed');
    expect(closed.body[0]).toMatchObject({ id: report.id, status: 'dismissed' });
  });

  it('takes content down and suspends the person behind it', async () => {
    const report = (await mod.get('/api/admin/reports')).body[0];
    const res = await mod.post(`/api/admin/reports/${report.id}/resolve`, { action: 'suspend', note: 'Harassment.' });
    expect(res.status).toBe(200);
    expect(res.body.resolution).toContain('Suspended the account and removed the comment.');
    expect(await t.db.select().from(comments).where(eq(comments.id, commentId))).toEqual([]);
    // Signed out everywhere, and can't sign back in.
    expect((await troll.get('/api/auth/me')).status).toBe(401);
    const login = await t.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { login: 'trollo', password: 'correct horse battery' },
    });
    expect(login.statusCode).toBe(403);
    expect(JSON.parse(login.body).error.code).toBe('suspended');
    expect((await mod.get('/api/admin/summary')).body.openReports).toBe(0);

    // A moderator can undo it.
    expect((await mod.post(`/api/admin/users/${troll.user.id}/unsuspend`)).status).toBe(200);
    const again = await t.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { login: 'trollo', password: 'correct horse battery' },
    });
    expect(again.statusCode).toBe(200);
  });

  it('lets only moderators act on reports', async () => {
    await ana.post('/api/reports', { targetType: 'event', targetId: eventId, reason: 'other' });
    const report = (await mod.get('/api/admin/reports')).body[0];
    expect((await ana.post(`/api/admin/reports/${report.id}/resolve`, { action: 'remove' })).status).toBe(404);
    expect((await mod.post(`/api/admin/reports/${report.id}/resolve`, { action: 'remove' })).status).toBe(200);
    expect((await ana.get(`/api/events/${eventId}`)).status).toBe(404);
  });

  it('takes messages from anyone, signed in or not', async () => {
    const anonymous = await t.app.inject({ method: 'POST', url: '/api/support', payload: { topic: 'help', body: 'How do I start a crew?' } });
    expect(anonymous.statusCode).toBe(400);
    const withEmail = await t.app.inject({
      method: 'POST',
      url: '/api/support',
      payload: { topic: 'bug', body: 'The map does not load for me.', replyTo: 'Someone@Example.test' },
    });
    expect(withEmail.statusCode).toBe(201);
    expect((await ana.post('/api/support', { topic: 'privacy', body: 'Please tell me what you store.' })).status).toBe(201);
    expect((await ana.post('/api/support', { topic: 'privacy', body: 'short' })).status).toBe(400);

    const inbox = await mod.get('/api/admin/support');
    expect(inbox.body).toHaveLength(2);
    const fromAna = inbox.body.find((m: any) => m.user?.id === ana.user.id);
    expect(fromAna.replyTo).toBe('anna@example.test');
    expect(inbox.body.find((m: any) => !m.user).replyTo).toBe('someone@example.test');
    expect((await mod.post(`/api/admin/support/${fromAna.id}/handled`)).status).toBe(200);
    expect((await mod.get('/api/admin/summary')).body.openMessages).toBe(1);
    expect((await ana.get('/api/admin/support')).status).toBe(404);
  });

  it('includes reports and messages in the export, and deletes messages with the account', async () => {
    const exp = await ana.get('/api/me/export');
    expect(exp.body.reportsYouFiled.length).toBeGreaterThan(0);
    expect(exp.body.messagesToSupport).toHaveLength(1);
  });
});

describe('deleting an account removes its support messages', () => {
  let t: TestApp & { db: any };
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  it('forgets what they wrote to support', async () => {
    const bea = await t.signUp('beatrix');
    await bea.post('/api/support', { topic: 'other', body: 'Hello there, just saying hi.' });
    const res = await t.app.inject({
      method: 'DELETE',
      url: '/api/me',
      headers: { cookie: bea.cookie },
      payload: { password: 'correct horse battery' },
    });
    expect(res.statusCode).toBe(200);
    expect(await t.db.select().from(supportMessages)).toEqual([]);
  });
});
