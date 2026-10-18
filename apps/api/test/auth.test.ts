import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers.ts';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());

describe('accounts and sessions', () => {
  it('registers, signs in with username or email, and never exposes the password hash', async () => {
    const beggi = await t.signUp('beggi', 'Beggi');
    expect(beggi.user).toMatchObject({ username: 'beggi', displayName: 'Beggi', email: 'beggi@example.test' });
    expect(JSON.stringify(beggi.user)).not.toMatch(/scrypt|password/i);

    const me = await beggi.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.username).toBe('beggi');

    for (const login of ['beggi', 'BEGGI@example.test']) {
      const res = await t.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { login, password: 'correct horse battery' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.cookies.find((c) => c.name === 'lore_session')?.httpOnly).toBe(true);
    }
  });

  it('rejects duplicate usernames and emails with field errors', async () => {
    await t.signUp('dupe');
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'Dupe', displayName: 'Other', email: 'dupe@example.test', password: 'correct horse battery' },
    });
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error.fields).toMatchObject({ username: expect.any(String), email: expect.any(String) });
  });

  it('validates input', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'x', displayName: '', email: 'not-an-email', password: 'short' },
    });
    expect(res.statusCode).toBe(400);
    const fields = JSON.parse(res.body).error.fields;
    expect(Object.keys(fields)).toEqual(expect.arrayContaining(['username', 'displayName', 'email', 'password']));
  });

  it('gives the same answer for a wrong password and an unknown user', async () => {
    await t.signUp('sigga');
    const wrong = await t.app.inject({ method: 'POST', url: '/api/auth/login', payload: { login: 'sigga', password: 'nope nope nope' } });
    const unknown = await t.app.inject({ method: 'POST', url: '/api/auth/login', payload: { login: 'nobody', password: 'nope nope nope' } });
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(JSON.parse(wrong.body)).toEqual(JSON.parse(unknown.body));
  });

  it('logs out by destroying the session server-side', async () => {
    const kalli = await t.signUp('kalli');
    expect((await kalli.post('/api/auth/logout')).status).toBe(200);
    expect((await kalli.get('/api/auth/me')).status).toBe(401);
  });

  it('issues bearer tokens to native clients', async () => {
    await t.signUp('native');
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'x-lore-client': 'native' },
      payload: { login: 'native', password: 'correct horse battery' },
    });
    const { token } = JSON.parse(res.body);
    expect(token).toEqual(expect.any(String));
    const me = await t.app.inject({ method: 'GET', url: '/api/auth/me', headers: { authorization: `Bearer ${token}` } });
    expect(JSON.parse(me.body).username).toBe('native');

    // Browsers never get the token in the body.
    const web = await t.app.inject({ method: 'POST', url: '/api/auth/login', payload: { login: 'native', password: 'correct horse battery' } });
    expect(JSON.parse(web.body).token).toBeUndefined();
  });

  it('blocks cookie-authenticated writes from other sites', async () => {
    const anna = await t.signUp('anna');
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/crews',
      headers: { cookie: anna.cookie, origin: 'https://evil.example' },
      payload: { name: 'Pwned' },
    });
    expect(res.statusCode).toBe(403);
    const ok = await t.app.inject({
      method: 'POST',
      url: '/api/crews',
      headers: { cookie: anna.cookie, origin: 'http://localhost:5173' },
      payload: { name: 'Fine' },
    });
    expect(ok.statusCode).toBe(201);
  });

  it('requires a session for everything but auth and health', async () => {
    for (const url of ['/api/home', '/api/crews', '/api/chapters', '/api/notifications']) {
      const res = await t.app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(401);
    }
    expect((await t.app.inject({ method: 'GET', url: '/api/health' })).statusCode).toBe(200);
  });
});
