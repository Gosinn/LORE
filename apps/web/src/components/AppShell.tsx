import { BookOpen, CalendarDays, Home, Plus, Sparkles, UserRound } from 'lucide-react';
import { useEffect } from 'react';
import { Navigate, NavLink, Outlet, useLocation } from 'react-router';
import { isNative } from '../lib/api.ts';
import { useMe, useNotes } from '../lib/queries.ts';
import { syncReminderNotifications } from '../lib/reminders.ts';
import { Avatar, Backronym, Loading, Wordmark } from './ui.tsx';

const NAV = [
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/calendar', label: 'Calendar', icon: CalendarDays },
  // Phones reach the Oracle from Home and Create; the tab bar keeps five tabs.
  { to: '/oracle', label: 'Loracle', icon: Sparkles, railOnly: true },
  { to: '/create', label: 'Create', icon: Plus, create: true },
  { to: '/lorebook', label: 'Lorebook', icon: BookOpen },
  { to: '/profile', label: 'Profile', icon: UserRound },
] as const;

/** Keeps the phone's scheduled reminder notifications in step with the server. */
function ReminderSync() {
  const notes = useNotes(isNative);
  useEffect(() => {
    if (notes.data) void syncReminderNotifications(notes.data.reminders);
  }, [notes.data]);
  return null;
}

export function AppShell() {
  const me = useMe();
  const location = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);
  // The browser bar matches the page: the look's own paper (--bg; map paper today), or stone in the temple.
  useEffect(() => {
    const temple = location.pathname === '/oracle' || location.pathname.startsWith('/oracle/');
    const paper = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#efe3c8';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', temple ? '#24211e' : paper);
  }, [location.pathname]);

  if (me.isLoading) return <Loading />;
  if (!me.data) return <Navigate to="/welcome" replace state={{ from: location.pathname }} />;

  return (
    <div className="app">
      <nav className="rail" aria-label="Main">
        <div className="wordmark">
          <Wordmark />
        </div>
        {NAV.map((item) =>
          'create' in item ? (
            <NavLink key={item.to} to={item.to} className="btn btn-primary rail-create">
              <Plus size={18} /> Create
            </NavLink>
          ) : (
            <NavLink
              key={item.to}
              to={item.to}
              end={'end' in item}
              // The step into the temple cross-fades (styles/map.css); every other link is instant.
              viewTransition={item.to === '/oracle'}
              className={({ isActive }) => `rail-link${isActive ? ' active' : ''}`}
            >
              {item.to === '/profile' ? <Avatar user={me.data!} size="sm" /> : <item.icon size={20} />}
              {item.label}
            </NavLink>
          ),
        )}
        <p className="rail-foot">
          <Backronym />
        </p>
      </nav>

      <main className="main">
        <Outlet />
      </main>
      {isNative && <ReminderSync />}

      <nav className="tabbar" aria-label="Main">
        {NAV.filter((item) => !('railOnly' in item)).map((item) =>
          'create' in item ? (
            <NavLink key={item.to} to={item.to} className="tab-create" aria-label="Create">
              <Plus size={26} strokeWidth={2.4} />
            </NavLink>
          ) : (
            <NavLink key={item.to} to={item.to} end={'end' in item} className={({ isActive }) => `tab${isActive ? ' active' : ''}`}>
              <item.icon size={22} />
              {item.label}
              <span className="dot" />
            </NavLink>
          ),
        )}
      </nav>
    </div>
  );
}
