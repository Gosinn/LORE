import '@fontsource-variable/fraunces/opsz.css';
import '@fontsource-variable/fraunces/opsz-italic.css';
import '@fontsource-variable/instrument-sans';
import './styles/app.css';

import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router/dom';
import { isNative } from './lib/api.ts';
import { setupNativeShell } from './lib/native.ts';
import { queryClient } from './lib/queries.ts';
import { applyTheme, loadTheme } from './lib/theme.ts';
import { router } from './router.tsx';

applyTheme(loadTheme());

if (isNative) {
  // The app's files ship inside the APK, so no service worker; wire up the back
  // button, status bar and splash screen instead.
  void setupNativeShell(router);
} else {
  void import('virtual:pwa-register').then(({ registerSW }) => registerSW({ immediate: true }));
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
