import { createBrowserRouter, type RouteObject } from 'react-router';
import { AppShell } from './components/AppShell.tsx';
import { Loading } from './components/ui.tsx';
import { HomePage } from './pages/Home.tsx';
import { Welcome } from './pages/Welcome.tsx';

// Home and sign-in ship in the main bundle; every other screen loads on first visit.
const page = (load: () => Promise<Record<string, unknown>>, name: string): Pick<RouteObject, 'lazy'> => ({
  lazy: async () => ({ Component: (await load())[name] as React.ComponentType }),
});

export const router = createBrowserRouter([
  { path: '/welcome', element: <Welcome /> },
  {
    path: '/',
    element: <AppShell />,
    hydrateFallbackElement: <Loading />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'calendar', ...page(() => import('./pages/Calendar.tsx'), 'CalendarPage') },
      { path: 'create', ...page(() => import('./pages/Create.tsx'), 'CreatePage') },
      { path: 'lorebook', ...page(() => import('./pages/Lorebook.tsx'), 'Lorebook') },
      { path: 'profile', ...page(() => import('./pages/Profile.tsx'), 'MyProfile') },
      { path: 'events/new', ...page(() => import('./pages/EventForm.tsx'), 'EventForm') },
      { path: 'events/:id', ...page(() => import('./pages/EventPage.tsx'), 'EventPage') },
      { path: 'events/:id/edit', ...page(() => import('./pages/EventForm.tsx'), 'EventForm') },
      { path: 'ideas', ...page(() => import('./pages/IdeaVault.tsx'), 'IdeaVault') },
      { path: 'ideas/new', ...page(() => import('./pages/IdeaForm.tsx'), 'IdeaForm') },
      { path: 'ideas/:id', ...page(() => import('./pages/IdeaPage.tsx'), 'IdeaPage') },
      { path: 'ideas/:id/edit', ...page(() => import('./pages/IdeaForm.tsx'), 'IdeaForm') },
      { path: 'chapters/new', ...page(() => import('./pages/ChapterForm.tsx'), 'ChapterForm') },
      { path: 'chapters/:id', ...page(() => import('./pages/ChapterPage.tsx'), 'ChapterPage') },
      { path: 'chapters/:id/edit', ...page(() => import('./pages/ChapterForm.tsx'), 'ChapterForm') },
      { path: 'crews/new', ...page(() => import('./pages/CrewForm.tsx'), 'CrewForm') },
      { path: 'crews/:id', ...page(() => import('./pages/CrewPage.tsx'), 'CrewPage') },
      { path: 'crews/:id/edit', ...page(() => import('./pages/CrewForm.tsx'), 'CrewForm') },
      { path: 'u/:username', ...page(() => import('./pages/UserPage.tsx'), 'UserPage') },
      { path: 'friends', ...page(() => import('./pages/Friends.tsx'), 'FriendsPage') },
      { path: 'notifications', ...page(() => import('./pages/Notifications.tsx'), 'NotificationsPage') },
      { path: '*', ...page(() => import('./pages/NotFound.tsx'), 'NotFound') },
    ],
  },
]);
