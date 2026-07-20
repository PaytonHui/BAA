import AsyncStorage from "@react-native-async-storage/async-storage";
import type { ScheduleEvent, ScheduleSnapshot } from "../types";

const KEY = "baa-calendar-v1";

export async function loadLocalSchedule(): Promise<ScheduleEvent[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return [];
    const snap = JSON.parse(raw) as ScheduleSnapshot;
    return Array.isArray(snap.events) ? snap.events : [];
  } catch {
    return [];
  }
}

export async function saveLocalSchedule(events: ScheduleEvent[]): Promise<void> {
  const snap: ScheduleSnapshot = { updatedAt: Date.now(), events };
  await AsyncStorage.setItem(KEY, JSON.stringify(snap));
}

export function todayKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function eventsOnDate(events: ScheduleEvent[], date: string): ScheduleEvent[] {
  return events
    .filter((e) => e.date === date)
    .sort((a, b) => (a.time || "").localeCompare(b.time || ""));
}

export function upcoming(events: ScheduleEvent[], days = 14): ScheduleEvent[] {
  const start = todayKey();
  const endD = new Date();
  endD.setDate(endD.getDate() + days);
  const end = todayKey(endD);
  return events
    .filter((e) => e.date >= start && e.date <= end)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.time || "").localeCompare(b.time || ""));
}

export type DayBucket = {
  /** YYYY-MM-DD */
  date: string;
  /** Date object at local midnight */
  day: Date;
  label: string;
  weekday: string;
  isToday: boolean;
  events: ScheduleEvent[];
};

/**
 * Next 7 days starting today (today + 6) for Dynamic Island calendar.
 */
export function nextSevenDays(events: ScheduleEvent[], from = new Date()): DayBucket[] {
  const buckets: DayBucket[] = [];
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];

  for (let i = 0; i < 7; i++) {
    const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + i);
    const key = todayKey(d);
    const isToday = i === 0;
    buckets.push({
      date: key,
      day: d,
      isToday,
      weekday: isToday ? "Today" : weekdays[d.getDay()],
      label: `${months[d.getMonth()]} ${d.getDate()}`,
      events: eventsOnDate(events, key),
    });
  }
  return buckets;
}

/** Count events in the next 7 days (for island badge) */
export function countNext7Days(events: ScheduleEvent[]): number {
  return nextSevenDays(events).reduce((n, b) => n + b.events.length, 0);
}

/** YYYY-MM-DD set for next 7 days (today inclusive) */
export function next7DateKeys(from = new Date()): Set<string> {
  return new Set(nextSevenDays([], from).map((b) => b.date));
}

export function toDateKey(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Month grid cells (null = empty), same as Mac BAA */
export function buildMonthGrid(year: number, month: number): (number | null)[] {
  const first = new Date(year, month, 1);
  const startPad = first.getDay(); // 0 = Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < startPad; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export function monthLabel(year: number, month: number): string {
  return new Date(year, month, 1).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
}

export function datesWithEvents(events: ScheduleEvent[]): Set<string> {
  return new Set(events.map((e) => e.date));
}

export function formatSelectedLabel(dateKey: string): string {
  try {
    const [y, m, d] = dateKey.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  } catch {
    return dateKey;
  }
}

export function eventCategory(e: ScheduleEvent): "work" | "other" {
  if (e.category === "work" || e.category === "other") return e.category;
  return "other";
}
