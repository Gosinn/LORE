// Demo data for local development: `npm run seed` while the API is running.
// It goes through the HTTP API like a real client, so every rule (validation,
// privacy, notifications) applies to the demo data too.
//
// Demo accounts (local development only): gunna, beggi, siggi, anna
// Password for all of them: lore-demo-2026

const API = (process.env.SEED_API_URL ?? 'http://127.0.0.1:4000').replace(/\/$/, '') + '/api';
const PASSWORD = 'lore-demo-2026';

interface Session {
  id: string;
  username: string;
  cookie: string;
}

async function call<T = any>(s: Session | null, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(API + path, {
    method,
    headers: { ...(s ? { cookie: s.cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(data)}`);
  return data as T;
}

async function account(username: string, displayName: string): Promise<Session> {
  let res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ login: username, password: PASSWORD }),
  });
  if (res.status === 401) {
    res = await fetch(`${API}/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, displayName, email: `${username}@lore.test`, password: PASSWORD }),
    });
  }
  if (!res.ok) throw new Error(`Could not sign in ${username}: ${res.status} ${await res.text()}`);
  const cookie = res.headers.getSetCookie().find((c) => c.startsWith('lore_session='))!.split(';')[0]!;
  const { user } = (await res.json()) as { user: { id: string } };
  return { id: user.id, username, cookie };
}

const at = (daysFromNow: number, hour = 18, minute = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
};
const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

try {
  await fetch(`${API}/health`);
} catch {
  console.error(`The API isn't reachable at ${API}. Start it first with "npm run dev".`);
  process.exit(1);
}

const gunna = await account('gunna', 'Gunna');
const beggi = await account('beggi', 'Beggi');
const siggi = await account('siggi', 'Siggi');
const anna = await account('anna', 'Anna');

const existing = await call<any[]>(gunna, 'GET', '/crews');
if (existing.some((c) => c.name === 'The Absolute Legends')) {
  console.log('Demo data is already there. Sign in as gunna (see the top of this file for the password).');
  process.exit(0);
}

// Friends and a crew.
for (const other of [beggi, siggi, anna]) {
  await call(gunna, 'POST', '/friends/requests', { username: other.username });
  const requests = await call<any[]>(other, 'GET', '/friends/requests');
  await call(other, 'POST', `/friends/requests/${requests.find((r) => r.user.id === gunna.id).id}/accept`);
}
await call(gunna, 'PATCH', '/me', { bio: 'Organizer of questionable adventures. Keeper of the sausage list.' });

const crew = await call(gunna, 'POST', '/crews', {
  name: 'The Absolute Legends',
  emoji: '🏔️',
  description: 'Four friends, one group chat, too many ideas. Now with a Lorebook.',
});
await call(gunna, 'POST', `/crews/${crew.id}/invites`, { userIds: [beggi.id, siggi.id, anna.id] });
for (const s of [beggi, siggi]) await call(s, 'POST', `/crews/${crew.id}/accept`);
// Anna's invitation stays pending, to show the invite banner.

// The cabin story, start to finish: idea → event → chapter.
const cabinIdea = await call(gunna, 'POST', '/ideas', {
  title: 'We should rent a cabin this winter',
  description: 'Hot tub, board games, northern lights if we are lucky. Somebody bring the good sausages.',
  crewId: crew.id,
  category: 'gathering',
  whereNote: 'Somewhere near Húsafell',
  whenNote: 'A long weekend in winter',
  budgetNote: 'About 15k ISK each',
});
await call(beggi, 'POST', `/ideas/${cabinIdea.id}/interest`);
await call(siggi, 'POST', `/ideas/${cabinIdea.id}/interest`);
const { eventId: cabinEventId } = await call(gunna, 'POST', `/ideas/${cabinIdea.id}/convert`, {
  startsAt: at(-12, 16),
  endsAt: at(-10, 12),
  timeZone: tz,
  title: 'Cabin weekend',
});
await call(beggi, 'POST', `/events/${cabinEventId}/rsvp`, { status: 'going' });
await call(siggi, 'POST', `/events/${cabinEventId}/rsvp`, { status: 'going' });
for (const item of ['Sausages (the good ones)', 'Board games', 'Hot tub towels']) {
  await call(beggi, 'POST', `/events/${cabinEventId}/checklist`, { text: item });
}
const cabin = await call(gunna, 'POST', `/events/${cabinEventId}/chapter`);
await call(gunna, 'PATCH', `/chapters/${cabin.id}`, {
  title: 'The Cabin Incident',
  summary: 'Three days, one hot tub, zero sausages by Saturday morning. Nobody has confessed.',
});
await call(gunna, 'POST', `/chapters/${cabin.id}/contributions`, {
  type: 'story',
  title: 'What I know for certain',
  body:
    'We arrived in the dark, found the key under the third stone (not the first, Beggi), and had the fire going by eight.\n\n' +
    'The sausages were there on Friday night. I counted them. Then they weren’t.',
});
await call(siggi, 'POST', `/chapters/${cabin.id}/contributions`, {
  type: 'quote',
  body: 'I told everyone not to trust Beggi.',
  speakerUserId: siggi.id,
  context: 'Saturday breakfast',
});
await call(beggi, 'POST', `/chapters/${cabin.id}/contributions`, {
  type: 'quote',
  body: 'Allegations.',
  speakerUserId: beggi.id,
});
await call(beggi, 'POST', `/chapters/${cabin.id}/contributions`, {
  type: 'story',
  body: 'For the record: the northern lights came out at 2am and I was the only one awake to see them. You are welcome for the memory I am now describing to you.',
});
await call(siggi, 'POST', `/events/${cabinEventId}/comments`, { body: 'Same time next year?' });

// Coming up.
const roadTrip = await call(gunna, 'POST', '/events', {
  title: 'Westfjords road trip',
  category: 'road_trip',
  startsAt: at(9, 8),
  endsAt: at(11, 20),
  timeZone: tz,
  locationName: 'Meet at the Ísafjörður turnoff',
  crewId: crew.id,
  description: 'Two nights, one car, every hot pot we can find.',
  inviteUserIds: [beggi.id, siggi.id],
});
await call(siggi, 'POST', `/events/${roadTrip.id}/rsvp`, { status: 'going' });
await call(beggi, 'POST', `/events/${roadTrip.id}/rsvp`, { status: 'maybe' });

await call(siggi, 'POST', '/events', {
  title: 'Game night',
  category: 'gathering',
  startsAt: at(2, 20),
  timeZone: tz,
  locationName: 'Siggi’s place',
  crewId: crew.id,
  status: 'confirmed',
  inviteUserIds: [gunna.id, beggi.id],
});

await call(anna, 'POST', '/events', {
  title: 'Sunrise hike up Esja',
  category: 'outdoor',
  startsAt: at(5, 6, 30),
  timeZone: tz,
  locationName: 'Esja parking lot',
  status: 'proposed',
  inviteUserIds: [gunna.id],
});

// More ideas in the vault.
await call(siggi, 'POST', '/ideas', {
  title: 'Sail to Flatey',
  crewId: crew.id,
  category: 'expedition',
  whenNote: 'Next summer',
});
await call(beggi, 'POST', '/ideas', {
  title: 'Organize the first annual Homie Olympics',
  crewId: crew.id,
  category: 'competition',
  description: 'Trivia, petanque, and a sausage-eating contest (in memory).',
});

// Older history, including one that lands "on this day".
const thisDay = new Date();
const onThisDay = `2021-${String(thisDay.getMonth() + 1).padStart(2, '0')}-${String(thisDay.getDate()).padStart(2, '0')}`;
const lost = await call(gunna, 'POST', '/chapters', {
  title: 'The time we got lost in Seyðisfjörður',
  occurredOn: onThisDay,
  locationName: 'Seyðisfjörður',
  crewId: crew.id,
  summary: 'The GPS said left. The mountain said otherwise.',
  peopleIds: [beggi.id, siggi.id],
});
await call(siggi, 'POST', `/chapters/${lost.id}/contributions`, {
  type: 'quote',
  body: 'Trust me, I know a shortcut.',
  speakerUserId: gunna.id,
  context: 'An hour before we were lost',
});
await call(gunna, 'POST', '/chapters', {
  title: 'First night of the crew',
  occurredOn: '2019-06-21',
  locationName: 'Grótta lighthouse',
  crewId: crew.id,
  summary: 'Midsummer, no sunset, and the night the group chat got its name.',
  peopleIds: [beggi.id, siggi.id],
});

// Gunna's private calendar.
await call(gunna, 'POST', '/personal', { title: 'Dentist', startsAt: at(1, 9), endsAt: at(1, 10) });
await call(gunna, 'POST', '/personal', { title: 'Work trip', startsAt: at(4, 0), endsAt: at(5, 0), allDay: true });

console.log('Demo data created. Sign in as gunna, beggi, siggi or anna (password at the top of apps/api/src/seed.ts).');
