// Changing your password from inside the app.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type Client } from './helpers.ts';

describe('changing your password', () => {
  let t: Awaited<ReturnType<typeof createTestApp>>;
  let sigga: Client;

  beforeAll(async () => {
    t = await createTestApp();
    sigga = await t.signUp('sigga');
  });
  afterAll(() => t.close());

  const login = (password: string) =>
    t.app.inject({ method: 'POST', url: '/api/auth/login', payload: { login: 'sigga', password } });

  it('needs the current password', async () => {
    const res = await sigga.post('/api/me/password', { currentPassword: 'not it at all', newPassword: 'a whole new password' });
    expect(res.status).toBe(403);
    expect(res.body.error.fields.currentPassword).toBeTruthy();
  });

  it('needs a long enough new password, different from the old one', async () => {
    const short = await sigga.post('/api/me/password', { currentPassword: 'correct horse battery', newPassword: 'short' });
    expect(short.status).toBe(400);
    expect(short.body.error.fields.newPassword).toBeTruthy();
    const same = await sigga.post('/api/me/password', {
      currentPassword: 'correct horse battery',
      newPassword: 'correct horse battery',
    });
    expect(same.status).toBe(400);
  });

  it('changes it, keeps this device signed in, and signs out the others', async () => {
    const other = await login('correct horse battery');
    expect(other.statusCode).toBe(200);
    const otherCookie = `lore_session=${other.cookies.find((c) => c.name === 'lore_session')!.value}`;
    const me = () => t.app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: otherCookie } });
    expect((await me()).statusCode).toBe(200);

    const res = await sigga.post('/api/me/password', {
      currentPassword: 'correct horse battery',
      newPassword: 'a whole new password',
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, signedOutOthers: 1 });

    expect((await sigga.get('/api/auth/me')).status).toBe(200);
    expect((await me()).statusCode).toBe(401);
    expect((await login('correct horse battery')).statusCode).toBe(401);
    expect((await login('a whole new password')).statusCode).toBe(200);
  });
});
