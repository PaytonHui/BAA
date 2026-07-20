import * as Notifications from "expo-notifications";
import type { ScheduleEvent } from "../types";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

/** work = 3h before; other = 1h before (same as Mac BAA) */
function leadHours(e: ScheduleEvent): number {
  return e.category === "work" ? 3 : 1;
}

function eventStart(e: ScheduleEvent): Date | null {
  if (!e.date) return null;
  const [y, m, d] = e.date.split("-").map(Number);
  let hh = 9;
  let mm = 0;
  if (e.time) {
    const m1 = e.time.match(/(\d{1,2}):(\d{2})/);
    if (m1) {
      hh = Number(m1[1]);
      mm = Number(m1[2]);
    }
  }
  const dt = new Date(y, m - 1, d, hh, mm, 0, 0);
  if (Number.isNaN(dt.getTime())) return null;
  return dt;
}

export async function ensureNotificationPermission(): Promise<boolean> {
  const cur = await Notifications.getPermissionsAsync();
  if (cur.granted) return true;
  const req = await Notifications.requestPermissionsAsync();
  return req.granted;
}

/**
 * Schedule local notifications for important events.
 * Works offline — does not need Mac connection after sync.
 */
export async function rescheduleNotifications(
  events: ScheduleEvent[]
): Promise<number> {
  const ok = await ensureNotificationPermission();
  if (!ok) return 0;

  await Notifications.cancelAllScheduledNotificationsAsync();
  const now = Date.now();
  let n = 0;

  for (const e of events) {
    const start = eventStart(e);
    if (!start) continue;
    const fire = new Date(start.getTime() - leadHours(e) * 60 * 60 * 1000);
    if (fire.getTime() <= now) continue;
    // Skip if more than 30 days out (iOS limits)
    if (fire.getTime() - now > 30 * 24 * 60 * 60 * 1000) continue;

    const isWork = e.category === "work";
    await Notifications.scheduleNotificationAsync({
      content: {
        title: isWork ? "💼 BAA · Work" : "🐰 BAA · Reminder",
        body: e.time
          ? `${e.title} · ${e.time}`
          : e.title,
        data: { eventId: e.id, category: e.category ?? "other" },
        sound: true,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: fire,
      },
    });
    n++;
  }
  return n;
}
