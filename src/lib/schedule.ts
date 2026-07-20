/** Calendar schedule events for Binky — filled from chat or manual add */

import { invoke } from "@tauri-apps/api/core";
import { mergeDefaultCalendarEvents } from "./defaultCalendar";

/** work = remind 3h before; other = remind 1h before */
export type ScheduleCategory = "work" | "other";

export interface ScheduleEvent {
  id: string;
  /** YYYY-MM-DD — start date (or single day) */
  date: string;
  /**
   * Optional end date YYYY-MM-DD (inclusive) for multi-day events
   * e.g. races / seasons spanning weeks.
   */
  endDate?: string;
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
    .map((e) => {
      const endRaw =
        typeof (e as ScheduleEvent).endDate === "string"
          ? (e as ScheduleEvent).endDate
          : typeof (e as unknown as { end_date?: string }).end_date === "string"
            ? (e as unknown as { end_date: string }).end_date
            : undefined;
      return {
        id: e.id,
        date: e.date,
        endDate: endRaw && /^\d{4}-\d{2}-\d{2}$/.test(endRaw) ? endRaw : undefined,
        title: e.title,
        time: e.time,
        note: e.note,
        category:
          e.category === "work" || e.category === "other"
            ? e.category
            : undefined,
        createdAt:
          typeof e.createdAt === "number"
            ? e.createdAt
            : typeof (e as unknown as { created_at?: number }).created_at ===
                "number"
              ? (e as unknown as { created_at: number }).created_at
              : Date.now(),
      };
    });
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
 * Fire-and-forget disk write (ok for UI toggles).
 */
export function saveSchedule(events: ScheduleEvent[]) {
  memoryCache = events;
  writeLocalStorage(events);
  if (!isTauri()) return;
  void invoke("save_schedule", { events }).catch((e) => {
    console.error("[schedule] disk save failed", e);
  });
}

/** Await disk write — use after chat marks so calendar reload sees data. */
export async function saveScheduleAsync(events: ScheduleEvent[]) {
  memoryCache = events;
  writeLocalStorage(events);
  if (!isTauri()) return;
  try {
    await invoke("save_schedule", { events });
  } catch (e) {
    console.error("[schedule] disk save failed", e);
  }
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

function normalizeYmd(raw: string): string | null {
  let date = String(raw ?? "").trim().replace(/\//g, "-");
  // Chinese: 2026年11月7日
  const cn = date.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?/);
  if (cn) {
    return `${cn[1]}-${cn[2].padStart(2, "0")}-${cn[3].padStart(2, "0")}`;
  }
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(date)) {
    const [y, m, d] = date.split("-");
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  // English: November 7, 2026
  const en = date.match(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})\b/i
  );
  if (en) {
    const months: Record<string, number> = {
      january: 1,
      february: 2,
      march: 3,
      april: 4,
      may: 5,
      june: 6,
      july: 7,
      august: 8,
      september: 9,
      october: 10,
      november: 11,
      december: 12,
    };
    const mo = months[en[1].toLowerCase()];
    if (mo) {
      return `${en[3]}-${String(mo).padStart(2, "0")}-${en[2].padStart(2, "0")}`;
    }
  }
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

function parseEventArray(
  arr: unknown
): Omit<ScheduleEvent, "id" | "createdAt">[] {
  if (!Array.isArray(arr)) return [];
  const events: Omit<ScheduleEvent, "id" | "createdAt">[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const date =
      normalizeYmd(String(o.date ?? o.day ?? o.start ?? o.startDate ?? "")) ??
      "";
    const endDate =
      normalizeYmd(
        String(o.endDate ?? o.end ?? o.until ?? o.end_date ?? "")
      ) || undefined;
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
    const end =
      endDate && endDate >= date && endDate !== date ? endDate : undefined;
    events.push({
      date,
      endDate: end,
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

/** Match key for dedupe / cancel (date + title + optional time + end) */
export function scheduleMatchKey(
  e: Pick<ScheduleEvent, "date" | "title" | "time"> & { endDate?: string }
): string {
  return `${e.date}|${e.endDate || ""}|${e.title.toLowerCase().trim()}|${e.time || ""}`;
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
        endDate:
          e.endDate !== undefined ? e.endDate || undefined : prev.endDate,
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
        (merged.endDate || "") !== (prev.endDate || "") ||
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

/** Extract a balanced JSON array starting at the first `[` after `from`. */
function extractBalancedJsonArray(text: string, from = 0): string | null {
  const start = text.indexOf("[", from);
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escape) escape = false;
      else if (c === "\\") escape = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "[") depth += 1;
    else if (c === "]") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function splitScheduleActions(arr: unknown[]): {
  toAdd: unknown[];
  toCancel: unknown[];
} {
  const toAdd: unknown[] = [];
  const toCancel: unknown[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const action = String(o.action ?? o.op ?? o.operation ?? o.cmd ?? "")
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
      toAdd.push(item);
    }
  }
  return { toAdd, toCancel };
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
  let text = typeof raw === "string" ? raw : String(raw ?? "");
  const events: Omit<ScheduleEvent, "id" | "createdAt">[] = [];
  const cancels: Omit<ScheduleEvent, "id" | "createdAt">[] = [];

  const pullArray = (arr: unknown, intoCancel: boolean) => {
    const parsed = parseEventArray(arr);
    if (intoCancel) cancels.push(...parsed);
    else events.push(...parsed);
  };

  // 0) CANCEL_SCHEDULE_JSON: [...]  (balanced brackets — not first `]`)
  {
    const re = /CANCEL_SCHEDULE_JSON\s*:/gi;
    let m: RegExpExecArray | null;
    const ranges: Array<{ start: number; end: number }> = [];
    let guard = 0;
    while ((m = re.exec(text)) !== null && guard++ < 20) {
      const json = extractBalancedJsonArray(text, m.index + m[0].length);
      if (!json) {
        // avoid zero-width / stuck lastIndex edge cases
        if (re.lastIndex === m.index) re.lastIndex = m.index + 1;
        continue;
      }
      const absStart = m.index;
      const absEnd = text.indexOf(json, m.index) + json.length;
      try {
        pullArray(JSON.parse(json), true);
        ranges.push({ start: absStart, end: absEnd });
      } catch {
        /* ignore */
      }
    }
    // strip from end so indices stay valid
    for (const r of ranges.sort((a, b) => b.start - a.start)) {
      text = text.slice(0, r.start) + text.slice(r.end);
    }
  }

  // 1) SCHEDULE_JSON: [...]
  {
    const re = /SCHEDULE_JSON\s*:/gi;
    let m: RegExpExecArray | null;
    const ranges: Array<{ start: number; end: number }> = [];
    let guard = 0;
    while ((m = re.exec(text)) !== null && guard++ < 20) {
      const json = extractBalancedJsonArray(text, m.index + m[0].length);
      if (!json) {
        if (re.lastIndex === m.index) re.lastIndex = m.index + 1;
        continue;
      }
      const absStart = m.index;
      const absEnd = text.indexOf(json, m.index) + json.length;
      try {
        const arr = JSON.parse(json);
        if (!Array.isArray(arr)) continue;
        const { toAdd, toCancel } = splitScheduleActions(arr);
        if (toCancel.length) pullArray(toCancel, true);
        if (toAdd.length) pullArray(toAdd, false);
        ranges.push({ start: absStart, end: absEnd });
      } catch {
        /* ignore */
      }
    }
    for (const r of ranges.sort((a, b) => b.start - a.start)) {
      text = text.slice(0, r.start) + text.slice(r.end);
    }
  }

  // 2) ```json ... ``` blocks
  const fenceRe = /```(?:json)?\s*([\s\S]*?)```/gi;
  text = text.replace(fenceRe, (_all, body: string) => {
    const b = body.trim();
    if (b.startsWith("[")) {
      try {
        const parsed = JSON.parse(b) as unknown[];
        if (!Array.isArray(parsed)) return _all;
        const { toAdd, toCancel } = splitScheduleActions(parsed);
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

  // 3) Lone JSON array line / block
  const lines = text.split("\n");
  const kept: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith("[") && t.includes("date")) {
      try {
        const json = extractBalancedJsonArray(t, 0) ?? t;
        const ev = parseEventArray(JSON.parse(json));
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

/** Event flyer / race paste with explicit multi-day dates (CN or EN). */
export function looksLikeEventFlyer(text: string): boolean {
  if (/賽事日期|event\s*date|活動日期/i.test(text)) return true;
  if (
    /\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日/.test(text) &&
    /(–|-|—|to|至|到)/i.test(text)
  ) {
    return true;
  }
  if (
    /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2},?\s+\d{4}\b/i.test(
      text
    ) &&
    /(–|-|—|to)\b/i.test(text)
  ) {
    return true;
  }
  return false;
}

function isGenericScheduleTitle(title: string): boolean {
  const t = title.trim().toLowerCase();
  return (
    !t ||
    t === "event" ||
    t === "plan" ||
    t === "reminder" ||
    t === "schedule" ||
    t === "活動" ||
    t === "事件" ||
    t === "reminder" ||
    t === "todo"
  );
}

/**
 * Choose the best events to mark: prefer local flyer/user parse when Grok's
 * SCHEDULE_JSON is missing, generic ("Event"), or wrong-dated vs explicit flyer dates.
 */
export function resolveScheduleEventsFromChat(
  userText: string,
  modelEvents: Omit<ScheduleEvent, "id" | "createdAt">[],
  today: string = todayKey()
): Omit<ScheduleEvent, "id" | "createdAt">[] {
  const fromUser = fallbackEventsFromUserRequest(userText, today);
  if (!fromUser.length) return modelEvents;
  if (!modelEvents.length) return fromUser;

  const user = fromUser[0];
  const modelGeneric = modelEvents.every((e) =>
    isGenericScheduleTitle(e.title)
  );
  const userHasRange = !!(user.endDate && user.endDate > user.date);
  const modelMissingRange =
    userHasRange &&
    !modelEvents.some((e) => !!(e.endDate && e.endDate > e.date));
  const modelMissesFlyerDates =
    looksLikeEventFlyer(userText) &&
    !!user.date &&
    !modelEvents.some(
      (e) =>
        e.date === user.date ||
        (user.endDate && e.endDate === user.endDate) ||
        (user.endDate &&
          e.date >= user.date &&
          e.date <= user.endDate)
    );

  if (modelGeneric || modelMissingRange || modelMissesFlyerDates) {
    return fromUser;
  }

  // Enrich model events that match the flyer start but lost endDate / title
  if (looksLikeEventFlyer(userText) && (user.endDate || user.title)) {
    return modelEvents.map((e) => {
      if (
        e.date === user.date ||
        (user.endDate && e.endDate === user.endDate)
      ) {
        return {
          ...e,
          endDate: e.endDate || user.endDate,
          title: isGenericScheduleTitle(e.title) ? user.title : e.title,
          note: e.note || user.note,
        };
      }
      return e;
    });
  }

  return modelEvents;
}

/** User is asking to mark / schedule something — or pasted event flyer text */
export function looksLikeScheduleRequest(text: string): boolean {
  const t = text.toLowerCase().trim();
  if (!t) return false;
  // Explicit mark / schedule language
  if (
    /\b(mark|schedule|add|put|remember|remind|save|plan|book|set)\b/.test(t) &&
    (/\b(calendar|schedule|plan|agenda|tomorrow|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/.test(
      t
    ) ||
      /\b(會議|約會|calendar|日曆|記|提醒|聽日|明天|今日)\b/i.test(text) ||
      /\d{4}-\d{1,2}-\d{1,2}/.test(t) ||
      /\d{1,2}\/\d{1,2}/.test(t))
  ) {
    return true;
  }
  // Event flyer / race paste (Chinese or English)
  if (looksLikeEventFlyer(text)) return true;
  if (
    /\b(run|race|marathon|virtual|ust|gala|concert|tournament|賽事|馬拉松)\b/i.test(
      text
    ) &&
    (/\d{4}/.test(text) || /年/.test(text))
  ) {
    return true;
  }
  return false;
}

function addDaysYmd(base: string, days: number): string {
  const [y, m, d] = base.split("-").map(Number);
  const dt = new Date(y, m - 1, d + days);
  return toDateKey(dt.getFullYear(), dt.getMonth(), dt.getDate());
}

function nextWeekdayYmd(today: string, weekday: number): string {
  // weekday: 0=Sun … 6=Sat
  const [y, m, d] = today.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const cur = dt.getDay();
  let delta = (weekday - cur + 7) % 7;
  if (delta === 0) delta = 7; // next week if today is that day
  return addDaysYmd(today, delta);
}

/**
 * When Grok forgets SCHEDULE_JSON but the user clearly asked to mark something
 * (or pasted an event flyer), invent a best-effort event from the user message.
 * Supports Chinese dates, English months, and multi-day ranges.
 */
export function fallbackEventsFromUserRequest(
  userText: string,
  today: string = todayKey()
): Omit<ScheduleEvent, "id" | "createdAt">[] {
  if (!looksLikeScheduleRequest(userText)) return [];
  let date = today;
  let endDate: string | undefined;
  const lower = userText.toLowerCase();

  // —— Multi-day / flyer dates (prefer range if present) ——
  const cnDates = [
    ...userText.matchAll(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/g),
  ].map(
    (m) =>
      `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`
  );
  const enDates = [
    ...userText.matchAll(
      /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})\b/gi
    ),
  ].map((m) => {
    const months: Record<string, number> = {
      january: 1,
      february: 2,
      march: 3,
      april: 4,
      may: 5,
      june: 6,
      july: 7,
      august: 8,
      september: 9,
      october: 10,
      november: 11,
      december: 12,
    };
    const mo = months[m[1].toLowerCase()];
    return mo
      ? `${m[3]}-${String(mo).padStart(2, "0")}-${m[2].padStart(2, "0")}`
      : "";
  }).filter(Boolean);
  const isoDates = [
    ...userText.matchAll(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/g),
  ].map(
    (m) =>
      `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`
  );

  const allDates = [...cnDates, ...enDates, ...isoDates].filter(
    (d, i, a) => a.indexOf(d) === i
  );
  if (allDates.length >= 2) {
    allDates.sort();
    date = allDates[0];
    endDate = allDates[allDates.length - 1];
  } else if (allDates.length === 1) {
    date = allDates[0];
  } else if (/\b(today|今日|今天)\b/i.test(userText)) {
    date = today;
  } else if (/\b(tomorrow|聽日|明天|翌日)\b/i.test(userText)) {
    date = addDaysYmd(today, 1);
  } else if (/\b(day after tomorrow|後日|後天)\b/i.test(userText)) {
    date = addDaysYmd(today, 2);
  } else {
    const md = userText.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(20\d{2}))?\b/);
    if (md) {
      const year = md[3] || today.slice(0, 4);
      date = `${year}-${md[1].padStart(2, "0")}-${md[2].padStart(2, "0")}`;
    } else {
      const days = [
        "sunday",
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday",
      ];
      for (let i = 0; i < days.length; i++) {
        if (new RegExp(`\\b${days[i]}\\b`, "i").test(lower)) {
          date = nextWeekdayYmd(today, i);
          break;
        }
      }
    }
  }

  // Time HH:mm or H:mm am/pm
  let time: string | undefined;
  const t24 = userText.match(/\b(\d{1,2}):(\d{2})\b/);
  const t12 = userText.match(/\b(\d{1,2})\s*(am|pm)\b/i);
  if (t24) {
    time = `${t24[1].padStart(2, "0")}:${t24[2]}`;
  } else if (t12) {
    let h = parseInt(t12[1], 10) % 12;
    if (t12[2].toLowerCase() === "pm") h += 12;
    time = `${String(h).padStart(2, "0")}:00`;
  }

  // Prefer a title-looking line (event name), not "Event Date" / 賽事日期 / chat fluff
  const lines = userText
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  const skipTitleLine = (line: string) => {
    if (/^(賽事日期|event\s*date|活動日期|date)\s*$/i.test(line)) return true;
    if (/^\d{4}/.test(line) || /年\s*\d/.test(line)) return true;
    if (
      /^(january|february|march|april|may|june|july|august|september|october|november|december)\b/i.test(
        line
      )
    ) {
      return true;
    }
    if (/(–|-|—|to|至|到)/.test(line) && /\d{4}/.test(line)) return true;
    // Chat instructions — not the event name
    if (
      /\b(please|pls|can you|could you|mark|schedule|add|put|remember|remind|save|on (the )?calendar|日曆)\b/i.test(
        line
      ) &&
      !/\b(run|race|marathon|concert|gala|show|meeting|flight|exam|class)\b/i.test(
        line
      )
    ) {
      return true;
    }
    return false;
  };

  let title = "";
  // Prefer lines that look like event names (run/race/etc.) or ALL-CAPS codes
  for (const line of lines) {
    if (skipTitleLine(line)) continue;
    if (
      /\b(run|race|marathon|virtual|ust|gala|concert|tournament|賽事|馬拉松|show|festival)\b/i.test(
        line
      ) ||
      /[A-Za-z]+[_-]?\d+/i.test(line) ||
      /_[A-Z0-9]+/i.test(line)
    ) {
      if (/[A-Za-z\u4e00-\u9fff]{3,}/.test(line)) {
        title = line;
        break;
      }
    }
  }
  if (!title) {
    for (const line of lines) {
      if (skipTitleLine(line)) continue;
      if (/[A-Za-z\u4e00-\u9fff]{3,}/.test(line)) {
        title = line;
        break;
      }
    }
  }

  if (!title) {
    title = userText
      .replace(
        /\b(please|pls|can you|could you|mark|schedule|add|put|remember|remind|save|plan|book|set|on|the|my|a|an|to|for|calendar|agenda|event\s*date)\b/gi,
        " "
      )
      .replace(/賽事日期|活動日期/g, " ")
      .replace(/\b(today|tomorrow|聽日|明天|今日|今天|後日|後天)\b/gi, " ")
      .replace(/\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日/g, " ")
      .replace(
        /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}\b/gi,
        " "
      )
      .replace(/\b(20\d{2}-\d{1,2}-\d{1,2})\b/g, " ")
      .replace(/\b\d{1,2}:\d{2}\b/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  if (!title || title.length < 2) title = "Event";
  if (title.length > 72) title = title.slice(0, 72).trim();

  const category = looksLikeWork(title) ? "work" : "other";
  const note =
    endDate && endDate !== date
      ? `Until ${endDate}`
      : undefined;
  return [
    {
      date,
      endDate: endDate && endDate > date ? endDate : undefined,
      title,
      time,
      note,
      category,
    },
  ];
}

/** Friendly line shown in chat after marking */
export function formatMarkedSummary(
  events: Omit<ScheduleEvent, "id" | "createdAt">[]
): string {
  if (!events.length) return "";
  const parts = events.map((e) => {
    try {
      const [y, m, d] = e.date.split("-").map(Number);
      const startLabel = new Date(y, m - 1, d).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
      let range = startLabel;
      if (e.endDate && e.endDate !== e.date) {
        const [ey, em, ed] = e.endDate.split("-").map(Number);
        const endLabel = new Date(ey, em - 1, ed).toLocaleDateString(
          undefined,
          { month: "short", day: "numeric", year: "numeric" }
        );
        range = `${startLabel} – ${endLabel}`;
      }
      const cat = eventCategory(e as ScheduleEvent);
      const tag = cat === "work" ? "💼 work" : "📅 other";
      return `${e.time ? e.time + " " : ""}${e.title} (${range} · ${tag})`;
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

/** Inclusive range of YYYY-MM-DD keys from start → end (caps long spans). */
export function eachDateKey(start: string, end?: string): string[] {
  if (!end || end <= start) return [start];
  const out: string[] = [];
  const [ys, ms, ds] = start.split("-").map(Number);
  const [ye, me, de] = end.split("-").map(Number);
  const cur = new Date(ys, ms - 1, ds);
  const last = new Date(ye, me - 1, de);
  // Safety: max ~400 days so a bad parse can't explode the calendar
  for (let i = 0; i < 400 && cur <= last; i++) {
    out.push(
      toDateKey(cur.getFullYear(), cur.getMonth(), cur.getDate())
    );
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

export function eventTouchesDate(e: ScheduleEvent, date: string): boolean {
  if (e.date === date) return true;
  if (e.endDate && e.date <= date && date <= e.endDate) return true;
  return false;
}

export function eventsOnDate(events: ScheduleEvent[], date: string) {
  return events
    .filter((e) => eventTouchesDate(e, date))
    .sort((a, b) => (a.time || "").localeCompare(b.time || ""));
}

export function datesWithEvents(events: ScheduleEvent[]): Set<string> {
  const set = new Set<string>();
  for (const e of events) {
    for (const d of eachDateKey(e.date, e.endDate)) set.add(d);
  }
  return set;
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
