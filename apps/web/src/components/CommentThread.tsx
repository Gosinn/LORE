import { Send, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { Comment } from '#shared';
import { api } from '../lib/api.ts';
import { timeAgo } from '../lib/dates.ts';
import { useAction, useComments, type CommentKind } from '../lib/queries.ts';
import { Avatar, ErrorNote, FORMER_MEMBER } from './ui.tsx';

export function CommentThread({ kind, id, placeholder = 'Say something…' }: { kind: CommentKind; id: string; placeholder?: string }) {
  const comments = useComments(kind, id);
  const [body, setBody] = useState('');
  const post = useAction((text: string) => api.post<Comment[]>(`/${kind}/${id}/comments`, { body: text }), {
    onSuccess: () => setBody(''),
  });
  const remove = useAction((commentId: string) => api.del(`/comments/${commentId}`));

  return (
    <div className="stack">
      {comments.data?.length === 0 && <p className="small muted">No messages yet.</p>}
      {comments.data?.map((c) => (
        <div className="comment" key={c.id}>
          <Avatar user={c.author ?? FORMER_MEMBER} size="sm" />
          <div className="stack" style={{ gap: 4 }}>
            <span className="tiny muted">
              <strong style={{ color: 'var(--ink-2)' }}>{(c.author ?? FORMER_MEMBER).displayName}</strong> · {timeAgo(c.createdAt)}
              {c.canDelete && (
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ minHeight: 24, padding: '0 6px', marginLeft: 4 }}
                  aria-label="Delete message"
                  onClick={() => remove.mutate(c.id)}
                >
                  <Trash2 size={13} />
                </button>
              )}
            </span>
            <div className="comment-body">{c.body}</div>
          </div>
        </div>
      ))}
      <form
        className="comment-composer"
        onSubmit={(e) => {
          e.preventDefault();
          if (body.trim()) post.mutate(body.trim());
        }}
      >
        <textarea
          className="textarea"
          value={body}
          placeholder={placeholder}
          aria-label="Message"
          maxLength={4000}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              if (body.trim()) post.mutate(body.trim());
            }
          }}
        />
        <button className="btn btn-primary" style={{ minWidth: 46, padding: 0 }} disabled={!body.trim() || post.isPending} aria-label="Send">
          <Send size={18} />
        </button>
      </form>
      <ErrorNote error={post.error} />
    </div>
  );
}
