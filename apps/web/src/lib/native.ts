// Behaviour that only exists inside the Android/iOS app (Capacitor).
import { App } from '@capacitor/app';
import { CapacitorUpdater } from '@capgo/capacitor-updater';
import { SplashScreen } from '@capacitor/splash-screen';
import { StatusBar, Style } from '@capacitor/status-bar';

interface MinimalRouter {
  state: { location: { pathname: string } };
  navigate: (to: number) => unknown;
}

const ROOTS = new Set(['/', '/welcome']);

export async function setupNativeShell(router: MinimalRouter) {
  // Live updates: confirm this web build started fine. If a downloaded update ever
  // fails to get this far, the updater rolls back to the previous build by itself.
  await CapacitorUpdater.notifyAppReady().catch(() => undefined);

  // Android back button: go back inside the app; on Home, leave it.
  await App.addListener('backButton', () => {
    if (ROOTS.has(router.state.location.pathname)) void App.exitApp();
    else void router.navigate(-1);
  });

  // Match the status bar to the theme, now and when it changes.
  const dark = window.matchMedia('(prefers-color-scheme: dark)');
  const sync = () => {
    const theme = document.documentElement.getAttribute('data-theme');
    const isDark = theme ? theme === 'dark' : dark.matches;
    void StatusBar.setStyle({ style: isDark ? Style.Dark : Style.Light }).catch(() => undefined);
  };
  sync();
  dark.addEventListener('change', sync);
  new MutationObserver(sync).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  await SplashScreen.hide().catch(() => undefined);
}
