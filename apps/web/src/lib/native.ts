// Behaviour that only exists inside the Android/iOS app (Capacitor).
import { App } from '@capacitor/app';
import { LocalNotifications } from '@capacitor/local-notifications';
import { CapacitorUpdater } from '@capgo/capacitor-updater';
import { SplashScreen } from '@capacitor/splash-screen';
import { StatusBar, Style } from '@capacitor/status-bar';
import { isDarkTheme } from './theme.ts';

interface MinimalRouter {
  state: { location: { pathname: string } };
  navigate: { (to: number): unknown; (to: string): unknown };
  subscribe(fn: () => void): unknown;
}

/** Pages drawn dark in every theme (the Oracle's stone temple), so the status bar needs light icons there. */
const isAlwaysDark = (pathname: string) => pathname === '/oracle' || pathname.startsWith('/oracle/');

const ROOTS = new Set(['/', '/welcome']);

export async function setupNativeShell(router: MinimalRouter) {
  // Live updates: confirm this web build started fine. If a downloaded update ever
  // fails to get this far, the updater rolls back to the previous build by itself.
  await CapacitorUpdater.notifyAppReady().catch(() => undefined);

  // Android back button: go back inside the app; on Home, or with nowhere to go back to, leave it.
  // (Right after sign-up, "Where do you stand?" replaced Welcome, so it is the only page in the history;
  // reached from Home's door it isn't, and back returns to Home.)
  await App.addListener('backButton', ({ canGoBack }) => {
    if (!canGoBack || ROOTS.has(router.state.location.pathname)) void App.exitApp();
    else void router.navigate(-1);
  });

  // Tapping a reminder notification opens what it's about.
  await LocalNotifications.addListener('localNotificationActionPerformed', (action) => {
    const href = (action.notification.extra as { href?: string } | undefined)?.href;
    void router.navigate(href ?? '/notes');
  }).catch(() => undefined);

  // Match the status bar to the theme (or to an always-dark page), now and whenever either changes.
  const dark = window.matchMedia('(prefers-color-scheme: dark)');
  let current: Style | null = null;
  const sync = () => {
    const style = isDarkTheme() || isAlwaysDark(router.state.location.pathname) ? Style.Dark : Style.Light;
    if (style === current) return;
    current = style;
    void StatusBar.setStyle({ style }).catch(() => undefined);
  };
  sync();
  dark.addEventListener('change', sync);
  new MutationObserver(sync).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  router.subscribe(sync);

  await SplashScreen.hide().catch(() => undefined);
}
