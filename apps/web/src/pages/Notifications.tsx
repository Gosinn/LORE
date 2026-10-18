import { useQueryClient } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Link } from 'react-router';
import { Avatar, Empty, Loading, TopBar } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { timeAgo } from '../lib/dates.ts';
import { useNotifications } from '../lib/queries.ts';

export function NotificationsPage() {
  const notifications = useNotifications();
  const qc = useQueryClient();
  const marked = useRef(false);

  // Opening the page counts as reading it. The highlight stays until you leave.
  useEffect(() => {
    if (marked.current || !notifications.data?.some((n) => !n.readAt)) return;
    marked.current = true;
    api.post('/notifications/read').then(() => {
      qc.invalidateQueries({ queryKey: ['unread'] });
      qc.invalidateQueries({ queryKey: ['home'] });
    });
  }, [notifications.data, qc]);

  return (
    <>
      <TopBar back title="Updates" />
      {notifications.isLoading ? (
        <Loading />
      ) : !notifications.data?.length ? (
        <Empty title="All quiet. LORE only speaks up when something actually matters." />
      ) : (
        <div className="stack" style={{ gap: 4 }}>
          {notifications.data.map((n) => (
            <Link key={n.id} to={n.href} className={`notification${n.readAt ? '' : ' unread'}`}>
              {n.actor ? (
                <Avatar user={n.actor} />
              ) : (
                <span className="avatar" style={{ background: 'var(--surface-2)', color: 'var(--ink-2)' }}>
                  <Bell size={16} />
                </span>
              )}
              <span className="grow">
                <span style={{ display: 'block', fontWeight: n.readAt ? 500 : 650 }}>{n.title}</span>
                <span className="tiny muted">{timeAgo(n.createdAt)}</span>
              </span>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
