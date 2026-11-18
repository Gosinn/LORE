// Reminders as real phone notifications (Android app only). The server keeps the
// reminders; this schedules each upcoming one on the device itself, so it fires on
// time even with the app closed and no connection. Re-synced whenever the list
// changes. In a browser (or an app version without the plugin) it does nothing.
import { LocalNotifications } from '@capacitor/local-notifications';
import type { Note } from '#shared';
import { isNative } from './api.ts';

/** Android notification ids are 32-bit ints; derive a stable one from the note id. */
function notificationId(noteId: string): number {
  let h = 0;
  for (const ch of noteId) h = (Math.imul(h, 31) + ch.charCodeAt(0)) | 0;
  return Math.abs(h) || 1;
}

/** Ask once, at the moment it matters: when someone sets their first reminder. */
export async function ensureReminderPermission(): Promise<void> {
  if (!isNative) return;
  try {
    const { display } = await LocalNotifications.checkPermissions();
    if (display === 'prompt' || display === 'prompt-with-rationale') await LocalNotifications.requestPermissions();
  } catch {
    // Older app version without the notification plugin.
  }
}

export async function syncReminderNotifications(reminders: Note[]): Promise<void> {
  if (!isNative) return;
  try {
    if ((await LocalNotifications.checkPermissions()).display !== 'granted') return;
    // Only reminders are replaced: the Loracle's "Tell me when it's sealed" notice (href
    // /oracle/quest/…) is left alone.
    const pending = (await LocalNotifications.getPending()).notifications.filter((n) => {
      const href: unknown = (n.extra as { href?: unknown } | undefined)?.href;
      return !(typeof href === 'string' && href.startsWith('/oracle/quest/'));
    });
    if (pending.length) {
      await LocalNotifications.cancel({ notifications: pending.map((n) => ({ id: n.id })) });
    }
    const upcoming = reminders
      .filter((r) => r.remindAt && !r.doneAt && Date.parse(r.remindAt) > Date.now())
      .slice(0, 60);
    if (upcoming.length) {
      await LocalNotifications.schedule({
        notifications: upcoming.map((r) => ({
          id: notificationId(r.id),
          // copy:plain (a phone notification: rewordable, never marked)
          title: r.event ? `Reminder · ${r.event.title}` : 'LORE reminder',
          body: r.body,
          schedule: { at: new Date(r.remindAt!), allowWhileIdle: true },
          extra: { href: r.event ? `/events/${r.event.id}` : '/notes' },
        })),
      });
    }
  } catch {
    // Older app version without the notification plugin: Home still shows reminders.
  }
}
