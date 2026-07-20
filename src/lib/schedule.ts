/** Calendar schedule events for Binky — filled from chat or manual add */

import { invoke } from "@tauri-apps/api/core";
import { mergeDefaultCalendarEvents } from "./defaultCalendar";

/** work = remind 3h before; other = remind 1h before */
export type ScheduleCategory = "work" | "other";

export interface ScheduleEvent {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  title: string;
  /** optional "HH:mm" or free text */
  time?: string;
  note?: string;
  /** work | other — controls reminder lead time */
  category?: ScheduleCategory;
  createdAt: number;
}

const STORAGE_KEY = "baa-schedule";

/** In-memory cache (per webview). Disk is the source of truth across restarts. */
let memoryCache: ScheduleEvent[] | null = null;
let hydratePromise: Promise<ScheduleEvent[]> | null = null;

function normalizeList(raw: unknown): ScheduleEvent[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (e): e is ScheduleEvent =>
        !!e &&
        typeof e === "object" &&
        typeof (e as ScheduleEvent).id === "string" &&
        typeof (e as ScheduleEvent).date === "string" &&
        typeof (e as ScheduleEvent).title === "string"
    )
    .map((e) => ({
      id: e.id,
      date: e.date,
      title: e.title,
      time: e.time,
      note: e.note,
      category:
        e.category === "work" || e.category === "other" ? e.category : undefined,
      createdAt:
        typeof e.createdAt === "number"
          ? e.createdAt
          : typeof (e as unknown as { created_at?: number }).created_at ===
              "number"
            ? (e as unknown as { created_at: number }).created_at
            : Date.now(),
    }));
}

function readLocalStorage(): ScheduleEvent[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return normalizeList(JSON.parse(raw));
  } catch {
    return [];
  }
}

function writeLocalStorage(events: ScheduleEvent[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
  } catch {
    /* ignore */
  }
}

function isTauri(): boolean {
  return (
    typeof window !== "undefined" &&
    !!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
  );
}

/**
 * Load schedule (sync). Prefer memory → localStorage.
 * Call `hydrateSchedule()` on app/window start so disk data is pulled in.
 */
export function loadSchedule(): ScheduleEvent[] {
  if (memoryCache) return memoryCache;
  const local = readLocalStorage();
  memoryCache = local;
  return local;
}

/**
 * Persist schedule to memory + localStorage + disk (survives quit).
 */
export function saveSchedule(events: ScheduleEvent[]) {
  memoryCache = events;
  writeLocalStorage(events);
  if (!isTauri()) return;
  void invoke("save_schedule", { events }).catch((e) => {
    console.error("[schedule] disk save failed", e);
  });
}

/**
 * Ensure default holidays / NJ days exist, then persist if anything was added.
 */
function withDefaults(list: ScheduleEvent[]): ScheduleEvent[] {
  const { events, added } = mergeDefaultCalendarEvents(list);
  if (added > 0) {
    memoryCache = events;
    writeLocalStorage(events);
    if (isTauri()) {
      void invoke("save_schedule", { events }).catch(() => undefined);
    }
    return events;
  }
  memoryCache = events;
  return events;
}

/**
 * Load from disk (shared across all windows) and seed local caches.
 * Migrates localStorage → disk when disk is empty.
 * Always merges default public holidays + NewJeans days if missing.
 */
export async function hydrateSchedule(): Promise<ScheduleEvent[]> {
  if (hydratePromise) return hydratePromise;
  hydratePromise = (async () => {
    if (!isTauri()) {
      const local = readLocalStorage();
      return withDefaults(local);
    }
    try {
      const disk = normalizeList(await invoke<unknown>("load_schedule"));
      if (disk.length > 0) {
        writeLocalStorage(disk);
        return withDefaults(disk);
      }
      // Disk empty → migrate any old localStorage data to disk
      const local = readLocalStorage();
      if (local.length > 0) {
        const merged = withDefaults(local);
        await invoke("save_schedule", { events: merged }).catch(() => undefined);
        return merged;
      }
      return withDefaults([]);
    } catch (e) {
      console.error("[schedule] hydrate failed", e);
      const local = readLocalStorage();
      return withDefaults(local);
    }
  })().finally(() => {
    hydratePromise = null;
  });
  return hydratePromise;
}

/** Force re-read from disk (after another window saved). */
export async function reloadScheduleFromDisk(): Promise<ScheduleEvent[]> {
  hydratePromise = null;
  memoryCache = null;
  if (!isTauri()) {
    return withDefaults(loadSchedule());
  }
  try {
    const disk = normalizeList(await invoke<unknown>("load_schedule"));
    writeLocalStorage(disk);
    return withDefaults(disk);
  } catch {
    return withDefaults(loadSchedule());
  }
}

export function makeEventId() {
  return `ev-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function parseEventArray(
  arr: unknown
): Omit<ScheduleEvent, "id" | "createdAt">[] {
  if (!Array.isArray(arr)) return [];
  const events: Omit<ScheduleEvent, "id" | "createdAt">[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    let date = String(o.date ?? o.day ?? "").trim();
    // tolerate 2026/07/18
    date = date.replace(/\//g, "-");
    if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(date)) {
      const [y, m, d] = date.split("-");
      date = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
    }
    const title = String(o.title ?? o.name ?? o.event ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !title) continue;
    const timeRaw = o.time ?? o.when;
    const noteRaw = o.note ?? o.notes ?? o.desc;
    const catRaw = String(
      o.category ?? o.type ?? o.kind ?? o.tag ?? ""
    )
      .trim()
      .toLowerCase();
    let category: ScheduleCategory | undefined;
    if (
      catRaw === "work" ||
      catRaw === "job" ||
      catRaw === "office" ||
      catRaw === "meeting" ||
      catRaw === "business"
    ) {
      category = "work";
    } else if (
      catRaw === "other" ||
      catRaw === "personal" ||
      catRaw === "life" ||
      catRaw === "event" ||
      catRaw === "private" ||
      catRaw === "fun"
    ) {
      category = "other";
    } else if (looksLikeWork(title, noteRaw ? String(noteRaw) : "")) {
      category = "work";
    } else {
      category = "other";
    }
    events.push({
      date,
      title,
      time: timeRaw ? String(timeRaw).trim() || undefined : undefined,
      note: noteRaw ? String(noteRaw).trim() || undefined : undefined,
      category,
    });
  }
  return events;
}

/** Heuristic: title/note mentions work-like things */
export function looksLikeWork(title: string, note = ""): boolean {
  const s = `${title} ${note}`.toLowerCase();
  const keys = [
    "work",
    "job",
    "office",
    "meeting",
    "standup",
    "stand-up",
    "interview",
    "deadline",
    "project",
    "client",
    "shift",
    "conference",
    "call",
    "1:1",
    "sync",
    "sprint",
    "工作",
    "会議",
    "上班",
    "開會",
    "面試",
  ];
  return keys.some((k) => s.includes(k));
}

export function eventCategory(e: ScheduleEvent): ScheduleCategory {
  if (e.category === "work" || e.category === "other") return e.category;
  return looksLikeWork(e.title, e.note || "") ? "work" : "other";
}

/** Hours before event to remind: work=3, other=1 */
export function reminderLeadHours(e: ScheduleEvent): number {
  return eventCategory(e) === "work" ? 3 : 1;
}

/** Parse event local Date from date + optional time (defaults 09:00 if missing) */
export function eventStartDate(e: ScheduleEvent): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date)) return null;
  const [y, m, d] = e.date.split("-").map(Number);
  let hh = 9;
  let mm = 0;
  if (e.time) {
    const t = e.time.trim();
    // 14:30, 14.30, 2:30pm, 2pm
    const m24 = t.match(/^(\d{1,2})[:.：](\d{2})/);
    const m12 = t.match(/^(\d{1,2})\s*(am|pm)/i);
    const mHour = t.match(/^(\d{1,2})$/);
    if (m24) {
      hh = Math.min(23, parseInt(m24[1], 10));
      mm = Math.min(59, parseInt(m24[2], 10));
    } else if (m12) {
      hh = parseInt(m12[1], 10) % 12;
      if (m12[2].toLowerCase() === "pm") hh += 12;
    } else if (mHour) {
      hh = Math.min(23, parseInt(mHour[1], 10));
    }
  }
  const dt = new Date(y, m - 1, d, hh, mm, 0, 0);
  if (Number.isNaN(dt.getTime())) return null;
  return dt;
}

const REMINDED_KEY = "baa-schedule-reminded";
let remindedCache: Record<string, number> | null = null;

function loadReminded(): Record<string, number> {
  if (remindedCache) return { ...remindedCache };
  try {
    const raw = localStorage.getItem(REMINDED_KEY);
    if (!raw) return {};
    const o = JSON.parse(raw) as Record<string, number>;
    remindedCache = o && typeof o === "object" ? o : {};
    return { ...remindedCache };
  } catch {
    return {};
  }
}

function saveReminded(map: Record<string, number>) {
  remindedCache = map;
  try {
    localStorage.setItem(REMINDED_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
  if (isTauri()) {
    void invoke("save_schedule_reminded", { map }).catch(() => undefined);
  }
}

export async function hydrateReminded(): Promise<void> {
  if (!isTauri()) return;
  try {
    const map = await invoke<Record<string, number>>("load_schedule_reminded");
    if (map && typeof map === "object") {
      remindedCache = map;
      localStorage.setItem(REMINDED_KEY, JSON.stringify(map));
    }
  } catch {
    /* keep local */
  }
}

export function wasReminded(eventId: string): boolean {
  return !!loadReminded()[eventId];
}

export function markReminded(eventId: string) {
  const map = loadReminded();
  map[eventId] = Date.now();
  // prune old entries (> 14 days)
  const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
  for (const k of Object.keys(map)) {
    if (map[k] < cutoff) delete map[k];
  }
  saveReminded(map);
}

export interface DueReminder {
  event: ScheduleEvent;
  start: Date;
  leadHours: number;
  /** human message for care bubble */
  message: string;
  emoji: string;
}

/**
 * Events that should fire a care-bubble reminder now:
 * work → within 3h before start; other → within 1h before start.
 * Only once per event id.
 */
export function getDueReminders(
  events: ScheduleEvent[],
  now = new Date()
): DueReminder[] {
  const due: DueReminder[] = [];
  const t = now.getTime();

  for (const e of events) {
    // Default holiday / NJ marks are calendar decorations — no care chime
    if (e.id.startsWith("baa-default:")) continue;
    if (wasReminded(e.id)) continue;
    const start = eventStartDate(e);
    if (!start) continue;
    const startMs = start.getTime();
    // Skip past events (more than 5 min after start)
    if (t > startMs + 5 * 60_000) continue;

    const leadH = reminderLeadHours(e);
    const remindAt = startMs - leadH * 60 * 60 * 1000;
    // Fire once we've entered the lead window (and before/at start)
    if (t < remindAt) continue;

    const cat = eventCategory(e);
    const timeLabel = e.time?.trim() || start.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
    const hoursLeft = Math.max(0, (startMs - t) / (60 * 60 * 1000));
    const when =
      hoursLeft < 0.2
        ? "soon"
        : hoursLeft < 1
          ? `in ${Math.max(1, Math.round(hoursLeft * 60))} min`
          : `in ~${Math.round(hoursLeft * 10) / 10}h`;

    due.push({
      event: e,
      start,
      leadHours: leadH,
      emoji: cat === "work" ? "💼" : "📅",
      message:
        cat === "work"
          ? `Work soon: “${e.title}” at ${timeLabel} (${when})!`
          : `Coming up: “${e.title}” at ${timeLabel} (${when})!`,
    });
  }

  // Soonest first
  due.sort((a, b) => a.start.getTime() - b.start.getTime());
  return due;
}

/** Match key for dedupe / cancel (date + title + optional time) */
export function scheduleMatchKey(
  e: Pick<ScheduleEvent, "date" | "title" | "time">
): string {
  return `${e.date}|${e.title.toLowerCase().trim()}|${e.time || ""}`;
}

/** Loose match: same date, title contains or equals (ignore case); time optional */
export function matchesScheduleCancel(
  existing: ScheduleEvent,
  cancel: Pick<ScheduleEvent, "date" | "title" | "time">
): boolean {
  if (existing.date !== cancel.date) return false;
  const a = existing.title.toLowerCase().trim();
  const b = cancel.title.toLowerCase().trim();
  if (!a || !b) return false;
  const titleOk = a === b || a.includes(b) || b.includes(a);
  if (!titleOk) return false;
  if (cancel.time && existing.time) {
    return normalizeTime(existing.time) === normalizeTime(cancel.time);
  }
  return true;
}

function normalizeTime(t: string): string {
  const m = t.trim().match(/(\d{1,2}):(\d{2})/);
  if (!m) return t.trim().toLowerCase();
  return `${m[1].padStart(2, "0")}:${m[2]}`;
}

/**
 * Remove events that match cancel specs. Returns remaining list + removed.
 */
export function applyScheduleCancels(
  schedule: ScheduleEvent[],
  cancels: Omit<ScheduleEvent, "id" | "createdAt">[]
): { remaining: ScheduleEvent[]; removed: ScheduleEvent[] } {
  if (!cancels.length) return { remaining: schedule, removed: [] };
  const removed: ScheduleEvent[] = [];
  const remaining = schedule.filter((ev) => {
    const hit = cancels.some((c) => matchesScheduleCancel(ev, c));
    if (hit) removed.push(ev);
    return !hit;
  });
  return { remaining, removed };
}

/**
 * Add new events or update matching ones (date + title, optional time).
 * Used when user asks to change type: work ↔ other, or edit time/note.
 */
export function applyScheduleUpserts(
  schedule: ScheduleEvent[],
  incoming: Omit<ScheduleEvent, "id" | "createdAt">[]
): {
  next: ScheduleEvent[];
  added: ScheduleEvent[];
  updated: ScheduleEvent[];
} {
  if (!incoming.length) {
    return { next: schedule, added: [], updated: [] };
  }
  const next = [...schedule];
  const added: ScheduleEvent[] = [];
  const updated: ScheduleEvent[] = [];

  for (const e of incoming) {
    const idx = next.findIndex((x) =>
      matchesScheduleCancel(x, {
        date: e.date,
        title: e.title,
        time: e.time,
      })
    );
    if (idx >= 0) {
      const prev = next[idx];
      const merged: ScheduleEvent = {
        ...prev,
        // Keep title/date unless a richer title was sent
        title: e.title.trim() || prev.title,
        date: e.date || prev.date,
        time: e.time !== undefined ? e.time : prev.time,
        note: e.note !== undefined ? e.note : prev.note,
        // Category always applied when provided (work | other)
        category:
          e.category === "work" || e.category === "other"
            ? e.category
            : prev.category,
      };
      const changed =
        eventCategory(merged) !== eventCategory(prev) ||
        (merged.time || "") !== (prev.time || "") ||
        (merged.note || "") !== (prev.note || "") ||
        merged.title !== prev.title;
      next[idx] = merged;
      if (changed) updated.push(merged);
    } else {
      const created: ScheduleEvent = {
        ...e,
        id: makeEventId(),
        createdAt: Date.now(),
        category:
          e.category === "work" || e.category === "other"
            ? e.category
            : looksLikeWork(e.title, e.note || "")
              ? "work"
              : "other",
      };
      next.push(created);
      added.push(created);
    }
  }
  return { next, added, updated };
}

/**
 * Pull calendar add/cancel ops from Grok's reply and strip machine lines
 * so the user only sees natural language in chat.
 */
export function extractScheduleFromReply(raw: string): {
  message: string;
  events: Omit<ScheduleEvent, "id" | "createdAt">[];
  cancels: Omit<ScheduleEvent, "id" | "createdAt">[];
} {
  let text = raw;
  const events: Omit<ScheduleEvent, "id" | "createdAt">[] = [];
  const cancels: Omit<ScheduleEvent, "id" | "createdAt">[] = [];

  const pullArray = (arr: unknown, intoCancel: boolean) => {
    const parsed = parseEventArray(arr);
    if (intoCancel) cancels.push(...parsed);
    else events.push(...parsed);
  };

  // 0) CANCEL_SCHEDULE_JSON:[...] — explicit cancels
  const cancelLabelRe = /CANCEL_SCHEDULE_JSON\s*:\s*(\[[\s\S]*?\])/gi;
  let m: RegExpExecArray | null;
  while ((m = cancelLabelRe.exec(text)) !== null) {
    try {
      pullArray(JSON.parse(m[1]), true);
    } catch {
      /* ignore */
    }
  }
  text = text.replace(cancelLabelRe, "");

  // 1) SCHEDULE_JSON:[...] — may include action:"cancel"|"delete"|"remove"
  const labelRe = /SCHEDULE_JSON\s*:\s*(\[[\s\S]*?\])/gi;
  while ((m = labelRe.exec(text)) !== null) {
    try {
      const arr = JSON.parse(m[1]);
      if (Array.isArray(arr)) {
        const toAdd: unknown[] = [];
        const toCancel: unknown[] = [];
        for (const item of arr) {
          if (!item || typeof item !== "object") continue;
          const o = item as Record<string, unknown>;
          const action = String(
            o.action ?? o.op ?? o.operation ?? o.cmd ?? ""
          )
            .trim()
            .toLowerCase();
          if (
            action === "cancel" ||
            action === "delete" ||
            action === "remove" ||
            action === "unmark" ||
            o.cancel === true ||
            o.delete === true
          ) {
            toCancel.push(item);
          } else {
            // "update" / "change" / "edit" / default add → upsert list
            toAdd.push(item);
          }
        }
        if (toCancel.length) pullArray(toCancel, true);
        if (toAdd.length) pullArray(toAdd, false);
      }
    } catch {
      /* ignore */
    }
  }
  text = text.replace(labelRe, "");

  // 2) ```json ... ``` blocks
  const fenceRe = /```(?:json)?\s*([\s\S]*?)```/gi;
  text = text.replace(fenceRe, (_all, body: string) => {
    const b = body.trim();
    if (b.startsWith("[")) {
      try {
        const parsed = JSON.parse(b) as unknown[];
        if (!Array.isArray(parsed)) return _all;
        const toAdd: unknown[] = [];
        const toCancel: unknown[] = [];
        for (const item of parsed) {
          if (!item || typeof item !== "object") continue;
          const o = item as Record<string, unknown>;
          const action = String(o.action ?? o.op ?? "").toLowerCase();
          if (
            action === "cancel" ||
            action === "delete" ||
            action === "remove"
          ) {
            toCancel.push(item);
          } else {
            toAdd.push(item);
          }
        }
        const addEv = parseEventArray(toAdd);
        const cancelEv = parseEventArray(toCancel);
        if (addEv.length || cancelEv.length) {
          events.push(...addEv);
          cancels.push(...cancelEv);
          return "";
        }
      } catch {
        /* keep fence */
      }
    }
    if (b.startsWith("{")) {
      try {
        const obj = JSON.parse(b) as Record<string, unknown>;
        if (obj.events || obj.schedule) {
          events.push(...parseEventArray(obj.events ?? obj.schedule));
          return "";
        }
        if (obj.cancel || obj.cancels || obj.remove || obj.deletes) {
          cancels.push(
            ...parseEventArray(
              obj.cancel ?? obj.cancels ?? obj.remove ?? obj.deletes
            )
          );
          return "";
        }
      } catch {
        /* keep */
      }
    }
    return _all;
  });

  // 3) Lone JSON array line
  const lines = text.split("\n");
  const kept: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith("[") && t.endsWith("]") && t.includes("date")) {
      try {
        const ev = parseEventArray(JSON.parse(t));
        if (ev.length) {
          events.push(...ev);
          continue;
        }
      } catch {
        /* keep line */
      }
    }
    kept.push(line);
  }

  const dedupe = (list: Omit<ScheduleEvent, "id" | "createdAt">[]) => {
    const seen = new Set<string>();
    return list.filter((e) => {
      const k = scheduleMatchKey(e);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  };

  const message = kept
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return {
    message: message || raw.trim(),
    events: dedupe(events),
    cancels: dedupe(cancels),
  };
}

/** Friendly line shown in chat after marking */
export function formatMarkedSummary(
  events: Omit<ScheduleEvent, "id" | "createdAt">[]
): string {
  if (!events.length) return "";
  const parts = events.map((e) => {
    try {
      const [y, m, d] = e.date.split("-").map(Number);
      const label = new Date(y, m - 1, d).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      });
      const cat = eventCategory(e as ScheduleEvent);
      const tag = cat === "work" ? "💼 work" : "📅 other";
      return `${e.time ? e.time + " " : ""}${e.title} (${label} · ${tag})`;
    } catch {
      return e.title;
    }
  });
  return `📅 Marked on calendar: ${parts.join(" · ")}`;
}

/** Friendly line after changing category / fields on existing events */
export function formatUpdatedSummary(events: ScheduleEvent[]): string {
  if (!events.length) return "";
  const parts = events.map((e) => {
    try {
      const [y, m, d] = e.date.split("-").map(Number);
      const label = new Date(y, m - 1, d).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      });
      const cat = eventCategory(e);
      const tag = cat === "work" ? "💼 work · 3h remind" : "📅 other · 1h remind";
      return `${e.time ? e.time + " " : ""}${e.title} → ${tag} (${label})`;
    } catch {
      return e.title;
    }
  });
  return `✏️ Updated on calendar: ${parts.join(" · ")}`;
}

/** Friendly line after cancelling */
export function formatCancelledSummary(events: ScheduleEvent[]): string {
  if (!events.length) return "";
  const parts = events.map((e) => {
    try {
      const [y, m, d] = e.date.split("-").map(Number);
      const label = new Date(y, m - 1, d).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      });
      return `${e.time ? e.time + " " : ""}${e.title} (${label})`;
    } catch {
      return e.title;
    }
  });
  return `🗑️ Removed from calendar: ${parts.join(" · ")}`;
}

export function eventsOnDate(events: ScheduleEvent[], date: string) {
  return events
    .filter((e) => e.date === date)
    .sort((a, b) => (a.time || "").localeCompare(b.time || ""));
}

export function datesWithEvents(events: ScheduleEvent[]): Set<string> {
  return new Set(events.map((e) => e.date));
}

export function monthLabel(year: number, month: number) {
  return new Date(year, month, 1).toLocaleString(undefined, {
    month: "long",
    year: "numeric",
  });
}

/** Days in calendar grid (Sun-start), null = padding */
export function buildMonthGrid(year: number, month: number): (number | null)[] {
  const first = new Date(year, month, 1);
  const startPad = first.getDay(); // 0 Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < startPad; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export function toDateKey(year: number, month: number, day: number) {
  const m = String(month + 1).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  return `${year}-${m}-${d}`;
}

export function todayKey() {
  const n = new Date();
  return toDateKey(n.getFullYear(), n.getMonth(), n.getDate());
}
