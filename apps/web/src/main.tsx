import '@fontsource-variable/fraunces/opsz.css';
import '@fontsource-variable/fraunces/opsz-italic.css';
import '@fontsource-variable/instrument-sans';
// Cinzel (carved) and IM Fell English (scroll) are used across the Treasure Map, not only in the Loracle.
import '@fontsource/cinzel/600.css';
import '@fontsource/cinzel/700.css';
import '@fontsource/im-fell-english/400.css';
import '@fontsource/im-fell-english/400-italic.css';
import './styles/app.css';
import './styles/map.css';

import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router/dom';
import { isNative } from './lib/api.ts';
import { CopyEditorGate } from './lib/copy/gate.tsx';
import { CopyCrashBoundary } from './lib/copy/guard.tsx';
import { startCopySync } from './lib/copy/sync.ts';
import { setupNativeShell } from './lib/native.ts';
import { queryClient } from './lib/queries.ts';
import { applyTheme, loadTheme } from './lib/theme.ts';
import { router } from './router.tsx';

applyTheme(loadTheme());
// Live text: the owner's published words (cached ones are already applied) stay current from here on.
startCopySync();

if (isNative) {
  // The app's files ship inside the APK, so no service worker; wire up the back
  // button, status bar and splash screen instead.
  void setupNativeShell(router);
} else {
  void import('virtual:pwa-register').then(({ registerSW }) => registerSW({ immediate: true }));
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <CopyCrashBoundary>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
        {/* Live text: the owner's drafts and, when his switch is on, the editor (own chunk). */}
        <CopyEditorGate />
      </QueryClientProvider>
    </CopyCrashBoundary>
  </StrictMode>,
);
