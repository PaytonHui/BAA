import { invoke } from "@tauri-apps/api/core";
import type { ScheduleEvent } from "./schedule";
import { makeEventId, saveSchedule, toDateKey } from "./schedule";

/** Publish Mac calendar to LAN companion so iPhone can pull / receive live. */
export async function publishScheduleToCompanion(
  events: ScheduleEvent[]
): Promise<number> {
  try {
    const snap = await invoke<{ events?: unknown[]; updatedAt?: number }>(
      "publish_schedule",
      {
        events: events.map((e) => ({
          id: String(e.id),
          date: String(e.date),
          title: String(e.title),
          time: e.time ? String(e.time) : null,
          endTime: e.endTime ? String(e.endTime) : null,
          note: e.note ? String(e.note) : null,
          category: e.category ?? "event",
          createdAt: Number(e.createdAt) || Date.now(),
        })),
      }
    );
    const n = Array.isArray(snap?.events) ? snap.events.length : events.length;
    console.log(`[macSync] published ${n} event(s) to companion`);
    return n;
  } catch (e) {
    console.warn("[macSync] publish failed", e);
    return -1;
  }
}

/** Sample week so iPhone has something to show while testing link. */
export function buildSampleWeek(): ScheduleEvent[] {
  const day = (offset: number) => {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() + offset);
    return toDateKey(d.getFullYear(), d.getMonth(), d.getDate());
  };
  const now = Date.now();
  return [
    {
      id: makeEventId(),
      date: day(0),
      title: "Team standup",
      time: "10:00",
      category: "work",
      note: "Sample · Mac BAA",
      createdAt: now,
    },
    {
      id: makeEventId(),
      date: day(1),
      title: "Design review",
      time: "14:30",
      category: "work",
      createdAt: now,
    },
    {
      id: makeEventId(),
      date: day(2),
      title: "Dentist",
      time: "16:00",
      category: "event",
      createdAt: now,
    },
    {
      id: makeEventId(),
      date: day(4),
      title: "Project deadline",
      time: "18:00",
      category: "work",
      createdAt: now,
    },
    {
      id: makeEventId(),
      date: day(6),
      title: "Weekend hangout",
      time: "15:00",
      category: "friends",
      createdAt: now,
    },
  ];
}

/** Save samples to Mac calendar + push to phone. */
export async function pushSampleWeekToPhone(): Promise<number> {
  const samples = buildSampleWeek();
  saveSchedule(samples);
  return publishScheduleToCompanion(samples);
}
