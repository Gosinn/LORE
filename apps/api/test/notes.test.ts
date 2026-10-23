// Notes to self and reminders: always private to their owner.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, inDays, type Client, type TestApp } from './helpers.ts';

let t: TestApp;
let ari: Client, bea: Client;

beforeAll(async () => {
  t = await createTestApp();
  ari = await t.signUp('ari');
  bea = await t.signUp('bea');
  await t.befriend(ari, bea);
});
afterAll(() => t.close());

const inMinutes = (m: number) => new Date(Date.now() + m * 60_000).toISOString();

describe('notes and reminders', () => {
  it('sorts reminders by time and notes pinned-first, and moves finished ones to done', async () => {
    const later = await ari.post('/api/notes', { body: 'Call the cabin owner', remindAt: inMinutes(120) });
    const soon = await ari.post('/api/notes', { body: 'Buy sausages', remindAt: inMinutes(30) });
    await ari.post('/api/notes', { body: 'Idea: sauna night' });
    const pinned = await ari.post('/api/notes', { body: 'Wifi password for the cabin', pinned: true });
    expect(soon.status).toBe(201);
    expect(soon.body).toMatchObject({ body: 'Buy sausages', doneAt: null, pinned: false, event: null });

    const all = (await ari.get('/api/notes')).body;
    expect(all.reminders.map((n: any) => n.body)).toEqual(['Buy sausages', 'Call the cabin owner']);
    expect(all.notes.map((n: any) => n.id)[0]).toBe(pinned.body.id);

    const done = await ari.patch(`/api/notes/${soon.body.id}`, { done: true });
    expect(done.body.doneAt).not.toBeNull();
    const after = (await ari.get('/api/notes')).body;
    expect(after.reminders.map((n: any) => n.id)).toEqual([later.body.id]);
    expect(after.done.map((n: any) => n.id)).toContain(soon.body.id);

    // Undo, then turn the reminder back into a plain note.
    await ari.patch(`/api/notes/${soon.body.id}`, { done: false });
    const plain = await ari.patch(`/api/notes/${soon.body.id}`, { remindAt: null });
    expect(plain.body).toMatchObject({ remindAt: null, doneAt: null });
  });

  it('shows reminders due within a day on Home, and not later ones', async () => {
    const tomorrowish = await ari.post('/api/notes', { body: 'Pack the car', remindAt: inMinutes(60 * 20) });
    const nextWeek = await ari.post('/api/notes', { body: 'Book ferry', remindAt: inDays(7) });
    const home = (await ari.get('/api/home')).body;
    const ids = home.reminders.map((n: any) => n.id);
    expect(ids).toContain(tomorrowish.body.id);
    expect(ids).not.toContain(nextWeek.body.id);
  });

  it('can be about a plan you can see, never one you can’t', async () => {
    const event = await ari.post('/api/events', { title: 'Cabin', startsAt: inDays(5), timeZone: 'UTC' });
    const note = await ari.post('/api/notes', { body: 'Cabin tomorrow!', remindAt: inDays(4), eventId: event.body.id });
    expect(note.body.event).toEqual({ id: event.body.id, title: 'Cabin' });
    expect((await bea.post('/api/notes', { body: 'Snoop', eventId: event.body.id })).status).toBe(404);
  });

  it('are invisible and untouchable for everyone else', async () => {
    const secret = await ari.post('/api/notes', { body: 'Surprise party for Bea!' });
    const beas = (await bea.get('/api/notes')).body;
    expect([...beas.reminders, ...beas.notes, ...beas.done]).toHaveLength(0);
    expect((await bea.patch(`/api/notes/${secret.body.id}`, { body: 'gotcha' })).status).toBe(404);
    expect((await bea.del(`/api/notes/${secret.body.id}`)).status).toBe(404);
    expect((await ari.get('/api/notes')).body.notes.map((n: any) => n.body)).toContain('Surprise party for Bea!');
  });

  it('are part of the data export and deleted with the account', async () => {
    const exported = (await ari.get('/api/me/export')).body;
    expect(exported.notesAndReminders.map((n: any) => n.body)).toContain('Surprise party for Bea!');
    const id = (await ari.post('/api/notes', { body: 'gone soon' })).body.id;
    await t.app.inject({ method: 'DELETE', url: '/api/me', headers: { cookie: ari.cookie }, payload: { password: 'correct horse battery' } });
    const ari2 = await t.signUp('ari');
    expect((await ari2.patch(`/api/notes/${id}`, { body: 'x' })).status).toBe(404);
    expect((await ari2.get('/api/notes')).body.notes).toHaveLength(0);
  });
});
