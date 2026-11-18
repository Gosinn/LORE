import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { countAccounts, findAccounts, resetPassword } from '../src/lib/recovery.ts';
import { createTestApp, type Client } from './helpers.ts';

describe('getting back into an account', () => {
  let t: Awaited<ReturnType<typeof createTestApp>>;
  let ola: Client;

  beforeAll(async () => {
    t = await createTestApp();
    ola = await t.signUp('olafur');
    await t.signUp('olga');
  });
  afterAll(() => t.close());

  const login = (login: string, password: string) =>
    t.app.inject({ method: 'POST', url: '/api/auth/login', payload: { login, password } });

  it('finds an account by username or email, exactly', async () => {
    expect(await countAccounts(t.db)).toBe(2);
    const byName = await findAccounts(t.db, '@Olafur');
    expect(byName).toMatchObject({ exact: true, accounts: [{ id: ola.user.id }] });
    const byEmail = await findAccounts(t.db, 'OLAFUR@example.test');
    expect(byEmail.accounts[0]!.id).toBe(ola.user.id);
  });

  it('suggests close matches when nothing matches exactly', async () => {
    const near = await findAccounts(t.db, 'ol');
    expect(near.exact).toBe(false);
    expect(near.accounts.map((a) => a.username).sort()).toEqual(['olafur', 'olga']);
    expect((await findAccounts(t.db, '%')).accounts).toEqual([]);
    expect((await findAccounts(t.db, 'nobody')).accounts).toEqual([]);
  });

  it('sets a new password and signs the account out everywhere', async () => {
    expect((await ola.get('/api/auth/me')).status).toBe(200);
    await expect(resetPassword(t.db, ola.user.id, 'short', { cost: 2 ** 10 })).rejects.toThrow();
    const { signedOut } = await resetPassword(t.db, ola.user.id, 'a brand new password', { cost: 2 ** 10 });
    expect(signedOut).toBe(1);
    expect((await ola.get('/api/auth/me')).status).toBe(401);
    expect((await login('olafur', 'correct horse battery')).statusCode).toBe(401);
    expect((await login('olafur', 'a brand new password')).statusCode).toBe(200);
  });
});
