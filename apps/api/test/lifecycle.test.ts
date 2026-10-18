// The Phase 1 success condition from the brief (part XXXII), end to end:
// create a crew, invite friends, suggest an idea, turn it into an event,
// coordinate attendance, complete it, write the chapter together, revisit it.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, inDays, PNG_1X1, type Client, type TestApp } from './helpers.ts';

let t: TestApp;
let gunna: Client, beggi: Client, siggi: Client, outsider: Client;

beforeAll(async () => {
  t = await createTestApp();
  gunna = await t.signUp('gunna', 'Gunna');
  beggi = await t.signUp('beggi', 'Beggi');
  siggi = await t.signUp('siggi', 'Siggi');
  outsider = await t.signUp('outsider', 'Outsider');
  await t.befriend(gunna, beggi);
  await t.befriend(gunna, siggi);
});
afterAll(() => t.close());

describe('the first complete LORE experience', () => {
  let crewId: string, ideaId: string, eventId: string, chapterId: string;

  it('1. creates a crew and invites friends', async () => {
    const crew = await gunna.post('/api/crews', { name: 'The Absolute Legends', emoji: '🏔️' });
    expect(crew.status).toBe(201);
    crewId = crew.body.id;
    expect(crew.body).toMatchObject({ myRole: 'owner', memberCount: 1 });

    const invited = await gunna.post(`/api/crews/${crewId}/invites`, { userIds: [beggi.user.id, siggi.user.id] });
    expect(invited.body.members).toHaveLength(3);

    const inbox = await beggi.get('/api/notifications');
    expect(inbox.body[0]).toMatchObject({ type: 'crew_invite', href: `/crews/${crewId}` });

    await beggi.post(`/api/crews/${crewId}/accept`);
    const accepted = await siggi.post(`/api/crews/${crewId}/accept`);
    expect(accepted.body.memberCount).toBe(3);
  });

  it('2. suggests an idea the crew can get behind', async () => {
    const idea = await gunna.post('/api/ideas', {
      title: 'We should rent a cabin this winter',
      crewId,
      category: 'gathering',
      whereNote: 'Somewhere near Húsafell',
    });
    ideaId = idea.body.id;
    expect(idea.body.status).toBe('dreaming');

    const interest = await beggi.post(`/api/ideas/${ideaId}/interest`);
    expect(interest.body).toMatchObject({ iAmInterested: true, interestedCount: 1, status: 'gathering_interest' });
    await siggi.post(`/api/ideas/${ideaId}/interest`);

    const home = await siggi.get('/api/home');
    expect(home.body.ideas.map((i: any) => i.id)).toContain(ideaId);
  });

  it('3. turns the idea into an event without re-entering anything', async () => {
    expect((await beggi.post(`/api/ideas/${ideaId}/convert`, { startsAt: inDays(-3), timeZone: 'Atlantic/Reykjavik' })).status).toBe(403);

    const converted = await gunna.post(`/api/ideas/${ideaId}/convert`, {
      startsAt: inDays(-3, 15),
      endsAt: inDays(-1, 12),
      timeZone: 'Atlantic/Reykjavik',
      title: 'Cabin weekend',
    });
    expect(converted.status).toBe(201);
    eventId = converted.body.eventId;

    const event = await gunna.get(`/api/events/${eventId}`);
    expect(event.body).toMatchObject({
      title: 'Cabin weekend',
      category: 'gathering',
      locationName: 'Somewhere near Húsafell',
      audience: 'crew',
      crew: { id: crewId },
      ideaId,
      canEdit: true,
    });
    // Everyone who said they were in got invited.
    const rsvps = Object.fromEntries(event.body.participants.map((p: any) => [p.user.username, p.rsvp]));
    expect(rsvps).toEqual({ gunna: 'going', beggi: 'invited', siggi: 'invited' });
    expect((await gunna.get(`/api/ideas/${ideaId}`)).body.status).toBe('scheduled');
    expect((await beggi.get('/api/notifications')).body[0].type).toBe('idea_scheduled');
  });

  it('4. coordinates attendance and a packing list', async () => {
    await beggi.post(`/api/events/${eventId}/rsvp`, { status: 'going' });
    const maybe = await siggi.post(`/api/events/${eventId}/rsvp`, { status: 'maybe' });
    expect(maybe.body.goingCount).toBe(2);
    const going = await siggi.post(`/api/events/${eventId}/rsvp`, { status: 'going' });
    expect(going.body.goingCount).toBe(3);

    const list = await beggi.post(`/api/events/${eventId}/checklist`, { text: 'Sausages' });
    const item = list.body.checklist[0];
    const done = await siggi.patch(`/api/events/${eventId}/checklist/${item.id}`, { done: true, assigneeId: beggi.user.id });
    expect(done.body.checklist[0]).toMatchObject({ done: true, assignee: { username: 'beggi' } });

    const thread = await siggi.post(`/api/events/${eventId}/comments`, { body: 'Who is bringing the sausages?' });
    expect(thread.body).toHaveLength(1);
    expect((await outsider.get(`/api/events/${eventId}/comments`)).status).toBe(404);

    // Only organizers change the plan.
    expect((await beggi.patch(`/api/events/${eventId}`, { title: 'Beggi’s weekend' })).status).toBe(403);
  });

  it('5. completes the event and drafts a chapter from it', async () => {
    const draft = await gunna.post(`/api/events/${eventId}/chapter`);
    expect(draft.status).toBe(201);
    chapterId = draft.body.id;
    expect(draft.body).toMatchObject({
      title: 'Cabin weekend',
      locationName: 'Somewhere near Húsafell',
      audience: 'crew',
      event: { id: eventId },
      canEdit: true,
    });
    expect(draft.body.occurredOn).toBe(inDays(-3).slice(0, 10));
    expect(draft.body.people.map((p: any) => p.user.username).sort()).toEqual(['beggi', 'gunna', 'siggi']);

    const event = await gunna.get(`/api/events/${eventId}`);
    expect(event.body).toMatchObject({ status: 'completed', chapterId });
    expect((await gunna.get(`/api/ideas/${ideaId}`)).body.status).toBe('completed');
    expect((await gunna.post(`/api/events/${eventId}/chapter`)).status).toBe(409);
  });

  it('6. collects everyone’s side of the story', async () => {
    await gunna.patch(`/api/chapters/${chapterId}`, { title: 'The Cabin Incident' });
    await gunna.post(`/api/chapters/${chapterId}/contributions`, {
      type: 'story',
      body: 'The sausages were there. Then they weren’t.',
    });
    await siggi.post(`/api/chapters/${chapterId}/contributions`, {
      type: 'quote',
      body: 'I told everyone not to trust Beggi.',
      speakerUserId: siggi.user.id,
    });
    const reply = await beggi.post(`/api/chapters/${chapterId}/contributions`, { type: 'quote', body: 'Allegations.', speakerUserId: beggi.user.id });
    expect(reply.status).toBe(201);

    const photo = await beggi.upload(`/api/media?chapterId=${chapterId}`, PNG_1X1);
    const withPhoto = await beggi.post(`/api/chapters/${chapterId}/contributions`, { type: 'photo', mediaId: photo.body.id, caption: 'Evidence' });
    expect(withPhoto.body.cover?.id).toBe(photo.body.id);

    const chapter = await gunna.get(`/api/chapters/${chapterId}`);
    expect(chapter.body.contributions.map((c: any) => c.type)).toEqual(['story', 'quote', 'quote', 'photo']);
    // You edit your own words, not other people's.
    const siggisQuote = chapter.body.contributions[1];
    expect((await beggi.patch(`/api/contributions/${siggisQuote.id}`, { body: 'Beggi is innocent.' })).status).toBe(403);
    // Ten updates to one chapter collapse into one unread notification.
    const unread = (await gunna.get('/api/notifications')).body.filter(
      (n: any) => n.type === 'chapter_contribution' && n.readAt === null,
    );
    expect(unread).toHaveLength(1);
  });

  it('7. keeps history accurate when the event is edited later', async () => {
    await gunna.patch(`/api/events/${eventId}`, { title: 'Renamed event', locationName: 'Elsewhere' });
    const chapter = await gunna.get(`/api/chapters/${chapterId}`);
    expect(chapter.body).toMatchObject({ title: 'The Cabin Incident', locationName: 'Somewhere near Húsafell' });
  });

  it('8. is there to revisit later, for the people it belongs to', async () => {
    const lorebook = await siggi.get(`/api/chapters?crewId=${crewId}`);
    expect(lorebook.body.map((c: any) => c.title)).toContain('The Cabin Incident');
    const search = await beggi.get('/api/chapters?q=sausages');
    expect(search.body.map((c: any) => c.id)).toContain(chapterId);
    const home = await siggi.get('/api/home');
    expect(home.body.recentLore.map((c: any) => c.id)).toContain(chapterId);
    expect((await outsider.get(`/api/chapters/${chapterId}`)).status).toBe(404);
    expect((await outsider.get('/api/chapters?q=sausages')).body).toHaveLength(0);
  });

  it('9. won’t let one person erase shared history', async () => {
    expect((await gunna.del(`/api/chapters/${chapterId}`)).status).toBe(409);
  });
});

describe('spontaneous memories', () => {
  it('can be written without ever being scheduled, years after the fact', async () => {
    const ch = await gunna.post('/api/chapters', {
      title: 'The time we got lost in Seyðisfjörður',
      occurredOn: '2019-10-09',
      peopleIds: [beggi.user.id],
    });
    expect(ch.status).toBe(201);
    expect(ch.body.event).toBeNull();
    expect((await beggi.get('/api/notifications')).body[0].type).toBe('chapter_added');
    const onThisDay = await beggi.get('/api/home?today=2026-10-09');
    expect(onThisDay.body.onThisDay.map((c: any) => c.id)).toContain(ch.body.id);
  });
});
