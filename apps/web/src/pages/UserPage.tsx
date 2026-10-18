import { Navigate, useParams } from 'react-router';
import type { PublicProfile } from '#shared';
import { ChapterCard, CrewTag } from '../components/cards.tsx';
import { Avatar, Empty, ErrorNote, Loading, PageError, Section, TopBar } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { useAction, useProfile } from '../lib/queries.ts';

export function UserPage() {
  const { username = '' } = useParams();
  const profile = useProfile(username);
  if (profile.isLoading) return <Loading />;
  if (profile.error || !profile.data) return <PageError error={profile.error} />;
  if (profile.data.friendship === 'self') return <Navigate to="/profile" replace />;
  return <ProfileView p={profile.data} />;
}

function ProfileView({ p }: { p: PublicProfile }) {
  const request = useAction(() => api.post('/friends/requests', { username: p.username }));
  const accept = useAction(() => api.post(`/friends/requests/${p.friendshipId}/accept`));
  const cancel = useAction(() => api.del(`/friends/requests/${p.friendshipId}`));
  const unfriend = useAction(() => api.del(`/friends/${p.id}`));
  const block = useAction(() => api.post('/blocks', { userId: p.id }));
  const unblock = useAction(() => api.del(`/blocks/${p.id}`));
  const error = request.error ?? accept.error ?? cancel.error ?? unfriend.error ?? block.error ?? unblock.error;

  return (
    <>
      <TopBar back />
      <div className="hero" style={{ alignItems: 'center', textAlign: 'center' }}>
        <Avatar user={p} size="xl" />
        <h1 style={{ fontSize: 30 }}>{p.displayName}</h1>
        <span className="muted">@{p.username}</span>
        {p.bio && <p style={{ maxWidth: 460, whiteSpace: 'pre-wrap' }}>{p.bio}</p>}
        <div className="row-wrap" style={{ justifyContent: 'center', marginTop: 6 }}>
          {p.friendship === 'none' && (
            <button className="btn btn-primary btn-sm" onClick={() => request.mutate(undefined)}>
              Add friend
            </button>
          )}
          {p.friendship === 'outgoing' && (
            <button className="btn btn-secondary btn-sm" onClick={() => cancel.mutate(undefined)}>
              Request sent · Cancel
            </button>
          )}
          {p.friendship === 'incoming' && (
            <>
              <button className="btn btn-primary btn-sm" onClick={() => accept.mutate(undefined)}>
                Accept friend request
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => cancel.mutate(undefined)}>
                Decline
              </button>
            </>
          )}
          {p.friendship === 'friends' && (
            <button className="btn btn-secondary btn-sm" onClick={() => confirm(`Remove ${p.displayName} as a friend?`) && unfriend.mutate(undefined)}>
              Friends ✓
            </button>
          )}
          {p.friendship === 'blocked' ? (
            <button className="btn btn-ghost btn-sm" onClick={() => unblock.mutate(undefined)}>
              Unblock
            </button>
          ) : (
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => confirm(`Block ${p.displayName}? They won’t be able to find you or send requests.`) && block.mutate(undefined)}
            >
              Block
            </button>
          )}
        </div>
        <ErrorNote error={error} />
      </div>

      {p.crewsInCommon.length > 0 && (
        <Section title="Crews you share">
          <div className="row-wrap">
            {p.crewsInCommon.map((c) => (
              <CrewTag key={c.id} crew={c} />
            ))}
          </div>
        </Section>
      )}

      <Section title="Lore you can see">
        {p.chapters.length ? (
          <div className="stack">
            {p.chapters.map((c) => (
              <ChapterCard key={c.id} chapter={c} />
            ))}
          </div>
        ) : (
          <Empty title="No shared chapters yet. Go make some." />
        )}
      </Section>
    </>
  );
}
