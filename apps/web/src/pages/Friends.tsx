import { Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import type { UserSearchResult } from '#shared';
import { Avatar, Empty, ErrorNote, Person, Section, TopBar } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { useAction, useFriendRequests, useFriends, useMe, useUserSearch } from '../lib/queries.ts';

export function FriendsPage() {
  const me = useMe().data!;
  const friends = useFriends();
  const requests = useFriendRequests();
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim().toLowerCase()), 250);
    return () => clearTimeout(t);
  }, [search]);
  const results = useUserSearch(q);

  const accept = useAction((id: string) => api.post(`/friends/requests/${id}/accept`));
  const dismiss = useAction((id: string) => api.del(`/friends/requests/${id}`));
  const add = useAction((username: string) => api.post('/friends/requests', { username }));
  const incoming = (requests.data ?? []).filter((r) => r.direction === 'incoming');
  const outgoing = (requests.data ?? []).filter((r) => r.direction === 'outgoing');

  return (
    <>
      <TopBar back title="Friends" />
      <label className="row input" style={{ gap: 8, paddingTop: 0, paddingBottom: 0 }}>
        <Search size={17} className="muted" />
        <input
          className="grow"
          style={{ border: 0, outline: 0, background: 'transparent', minHeight: 44 }}
          placeholder="Find people by username or name"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Find people"
          autoCapitalize="none"
        />
      </label>
      <p className="tiny muted" style={{ marginTop: 6 }}>
        Your username is <strong>@{me.username}</strong>. Share it with friends so they can add you.
      </p>

      {q && (
        <Section title="People">
          {results.data?.length ? (
            <div className="list">
              {results.data.map((u) => (
                <SearchRow key={u.id} u={u} onAdd={() => add.mutate(u.username)} />
              ))}
            </div>
          ) : (
            <p className="small muted">{results.isLoading ? 'Searching…' : 'Nobody by that name.'}</p>
          )}
          <ErrorNote error={add.error} />
        </Section>
      )}

      {incoming.length > 0 && (
        <Section title="Want to be friends">
          <div className="list">
            {incoming.map((r) => (
              <div key={r.id} className="list-item">
                <Person user={r.user} />
                <span className="grow" />
                <button className="btn btn-primary btn-sm" onClick={() => accept.mutate(r.id)}>
                  Accept
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => dismiss.mutate(r.id)}>
                  Decline
                </button>
              </div>
            ))}
          </div>
        </Section>
      )}

      {outgoing.length > 0 && (
        <Section title="Waiting on them">
          <div className="list">
            {outgoing.map((r) => (
              <div key={r.id} className="list-item">
                <Person user={r.user} />
                <span className="grow" />
                <button className="btn btn-ghost btn-sm" onClick={() => dismiss.mutate(r.id)}>
                  Cancel
                </button>
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section title={`Friends · ${friends.data?.length ?? 0}`}>
        {friends.data?.length ? (
          <div className="list">
            {friends.data.map((f) => (
              <div key={f.id} className="list-item">
                <Person user={f} sub={`@${f.username}`} />
              </div>
            ))}
          </div>
        ) : (
          <Empty title="No friends here yet. Search for them above." />
        )}
      </Section>
    </>
  );
}

function SearchRow({ u, onAdd }: { u: UserSearchResult; onAdd: () => void }) {
  const label: Record<string, string> = { friends: 'Friends', outgoing: 'Requested', incoming: 'Wants to be friends', blocked: 'Blocked' };
  return (
    <div className="list-item">
      <Link to={`/u/${u.username}`} className="person grow">
        <Avatar user={u} />
        <span>
          <span className="person-name">{u.displayName}</span>
          <span className="tiny muted" style={{ display: 'block' }}>
            @{u.username}
          </span>
        </span>
      </Link>
      {u.friendship === 'none' ? (
        <button className="btn btn-secondary btn-sm" onClick={onAdd}>
          Add
        </button>
      ) : (
        <span className="pill">{label[u.friendship]}</span>
      )}
    </div>
  );
}
