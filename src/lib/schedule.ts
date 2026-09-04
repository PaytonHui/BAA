/** Calendar schedule events for Binky — filled from chat or manual add */

import { invoke } from "@tauri-apps/api/core";
import { mergeDefaultCalendarEvents } from "./defaultCalendar";

/**
 * Plan types (emoji shown on calendar + add form).
 * work = remind 3h before; others = 1h before.
 * Legacy stored value `"other"` is treated as `"event"`.
 */
export type ScheduleCategory =
  | "work"
  | "event"
  | "family"
  | "friends"
  | "school";

export const SCHEDULE_CATEGORIES: ScheduleCategory[] = [
  "work",
  "school",
  "event",
  "family",
  "friends",
];

export const CATEGORY_META: Record<
  ScheduleCategory,
  {
    emoji: string;
    label: string;
    leadHours: number;
    /** Tailwind classes for chips in list / form */
    chip: string;
    /** Soft day-cell fill when this type is present */
    dayBg: string;
    dayText: string;
  }
> = {
  work: {
    emoji: "💼",
    label: "work",
    leadHours: 3,
    chip: "bg-sky-600/15 text-sky-800 border-sky-300",
    dayBg: "bg-sky-100/90",
    dayText: "text-sky-900",
  },
  school: {
    emoji: "📚",
    label: "school",
    leadHours: 1,
    chip: "bg-emerald-600/12 text-emerald-900 border-emerald-300",
    dayBg: "bg-emerald-100/90",
    dayText: "text-emerald-950",
  },
  event: {
    emoji: "🎉",
    label: "event",
    leadHours: 1,
    chip: "bg-violet-600/12 text-violet-800 border-violet-300",
    dayBg: "bg-violet-100/90",
    dayText: "text-violet-900",
  },
  family: {
    emoji: "🏠",
    label: "family",
    leadHours: 1,
    chip: "bg-amber-500/15 text-amber-900 border-amber-300",
    dayBg: "bg-amber-100/90",
    dayText: "text-amber-950",
  },
  friends: {
    emoji: "🤝",
    label: "friends",
    leadHours: 1,
    chip: "bg-rose-500/15 text-rose-800 border-rose-300",
    dayBg: "bg-rose-100/90",
    dayText: "text-rose-900",
  },
};

/** Normalize any stored / chat value → a known type */
export function normalizeCategory(raw: unknown): ScheduleCategory {
  const s = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (
    s === "work" ||
    s === "job" ||
    s === "office" ||
    s === "meeting" ||
    s === "business"
  ) {
    return "work";
  }
  if (
    s === "school" ||
    s === "class" ||
    s === "lecture" ||
    s === "homework" ||
    s === "study" ||
    s === "exam" ||
    s === "uni" ||
    s === "university" ||
    s === "college" ||
    s === "上課" ||
    s === "學校" ||
    s === "功课" ||
    s === "功課" ||
    s === "考試"
  ) {
    return "school";
  }
  if (s === "family" || s === "home" || s === "家人" || s === "家庭") {
    return "family";
  }
  if (
    s === "friends" ||
    s === "friend" ||
    s === "social" ||
    s === "朋友" ||
    s === "friendship"
  ) {
    return "friends";
  }
  // event + legacy "other"
  if (
    s === "event" ||
    s === "other" ||
    s === "personal" ||
    s === "life" ||
    s === "private" ||
    s === "fun" ||
    s === "活動"
  ) {
    return "event";
  }
  return "event";
}

export function categoryEmoji(cat: ScheduleCategory): string {
  return CATEGORY_META[cat].emoji;
}

export function categoryLabel(cat: ScheduleCategory): string {
  return CATEGORY_META[cat].label;
}

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
  /** optional start "HH:mm" (24h) */
  time?: string;
  /** optional end "HH:mm" (24h), same calendar day as `date` */
  endTime?: string;
  note?: string;
  /** work | event | family | friends — type + reminder lead time */
  category?: ScheduleCategory;
  createdAt: number;
}

/** "14:00" or "14:00–16:00" for UI */
export function formatTimeRange(
  time?: string | null,
  endTime?: string | null
): string {
  const start = (time || "").trim();
  const end = (endTime || "").trim();
  if (!start && !end) return "";
  if (start && end) return `${start}–${end}`;
  return start || end;
}

/** Normalize to "HH:mm" or undefined */
export function normalizeHhmm(raw: unknown): string | undefined {
  if (raw == null) return undefined;
  const s = String(raw).trim();
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return undefined;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (h > 23 || min > 59 || Number.isNaN(h) || Number.isNaN(min)) return undefined;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/** Minutes from midnight for "HH:mm"; null if invalid */
export function hhmmToMinutes(raw: string | undefined | null): number | null {
  const n = normalizeHhmm(raw);
  if (!n) return null;
  const [h, min] = n.split(":").map(Number);
  return h * 60 + min;
}

/** Add minutes to "HH:mm", wrapping at midnight */
export function addMinutesToHhmm(raw: string, deltaMin: number): string {
  const base = hhmmToMinutes(raw);
  if (base == null) return raw;
  let t = (base + deltaMin) % (24 * 60);
  if (t < 0) t += 24 * 60;
  const h = Math.floor(t / 60);
  const m = t % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

const STORAGE_KEY = "baa-schedule";
const DELETED_KEY = "baa-schedule-deleted-v1";

/** In-memory cache (per webview). Disk is the source of truth across restarts. */
let memoryCache: ScheduleEvent[] | null = null;
let hydratePromise: Promise<ScheduleEvent[]> | null = null;
/** Bumps on every local write — used to avoid clobbering a just-added plan. */
let scheduleWriteGen = 0;
/** Ids the user deleted — never resurrect from another window's cache. */
const deletedIds = new Set<string>();

function loadDeletedIds() {
  try {
    const raw = localStorage.getItem(DELETED_KEY);
    if (!raw) return;
    const arr = JSON.parse(raw) as unknown;
    if (Array.isArray(arr)) {
      for (const id of arr) {
        if (typeof id === "string" && id) deletedIds.add(id);
      }
    }
  } catch {
    /* ignore */
  }
}

function persistDeletedIds() {
  try {
    localStorage.setItem(DELETED_KEY, JSON.stringify([...deletedIds]));
  } catch {
    /* ignore */
  }
}

function dropDeleted<T extends { id?: string }>(list: T[] | null | undefined): T[] {
  if (!list?.length) return [];
  if (!deletedIds.size) return list.slice();
  return list.filter((e) => !e?.id || !deletedIds.has(e.id));
}

/** Forget ids in this webview so hydrate/merge cannot bring them back. */
export function forgetScheduleIds(ids: string[]) {
  if (!ids.length) return;
  loadDeletedIds();
  for (const id of ids) {
    if (id) deletedIds.add(id);
  }
  persistDeletedIds();
  if (memoryCache) {
    memoryCache = dropDeleted(memoryCache);
    writeLocalStorage(memoryCache);
  } else {
    writeLocalStorage(dropDeleted(readLocalStorage()));
  }
  scheduleWriteGen += 1;
  if (isTauri()) {
    void invoke("remember_deleted_ids", { ids }).catch(() => undefined);
  }
}

async function pullDiskDeletedIds() {
  if (!isTauri()) return;
  try {
    const ids = await invoke<string[]>("load_deleted_ids");
    if (Array.isArray(ids)) {
      for (const id of ids) {
        if (id) deletedIds.add(id);
      }
      persistDeletedIds();
    }
  } catch {
    /* optional */
  }
}

/**
 * Merge event lists by id. Prefer higher createdAt (newer edit wins).
 * Never drops an id that exists only on one side — prevents partial UI saves
 * from wiping disk plans on quit/relaunch.
 */
function mergeByIdPreferNewer(
  ...lists: Array<ScheduleEvent[] | null | undefined>
): ScheduleEvent[] {
  const byId = new Map<string, ScheduleEvent>();
  const order: string[] = [];
  for (const list of lists) {
    if (!list?.length) continue;
    for (const e of list) {
      if (!e?.id || !e.date || !e.title) continue;
      if (deletedIds.has(e.id)) continue;
      const prev = byId.get(e.id);
      if (!prev) {
        byId.set(e.id, e);
        order.push(e.id);
        continue;
      }
      if ((e.createdAt || 0) >= (prev.createdAt || 0)) {
        byId.set(e.id, { ...prev, ...e, id: e.id });
      }
    }
  }
  return order.map((id) => byId.get(id)!).filter(Boolean);
}

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
        time: normalizeHhmm(e.time),
        endTime: normalizeHhmm(
          (e as ScheduleEvent).endTime ??
            (e as unknown as { end_time?: string }).end_time
        ),
        note: e.note,
        category:
          (e as { category?: unknown }).category != null &&
          String((e as { category?: unknown }).category).length > 0
            ? normalizeCategory((e as { category?: unknown }).category)
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
  if (typeof window === "undefined") return false;
  const w = window as unknown as {
    isTauri?: boolean;
    __TAURI_INTERNALS__?: unknown;
    __TAURI__?: unknown;
  };
  // Tauri 2 sets window.isTauri; older code checked __TAURI_INTERNALS__ only
  return !!(w.isTauri || w.__TAURI_INTERNALS__ || w.__TAURI__);
}

/**
 * Load schedule (sync). Prefer memory → localStorage.
 * Call `hydrateSchedule()` on app/window start so disk data is pulled in.
 */
export function loadSchedule(): ScheduleEvent[] {
  loadDeletedIds();
  if (memoryCache) {
    memoryCache = dropDeleted(memoryCache);
    return memoryCache;
  }
  const local = dropDeleted(readLocalStorage());
  memoryCache = local;
  return local;
}

/** Strip lone UTF-16 surrogates that break JSON / Rust serde (emoji edge cases). */
function sanitizeText(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\uD800-\uDFFF]/g, "\uFFFD");
}

/** Wire shape for Rust save_schedule (always JSON-safe). */
function toDiskPayload(events: ScheduleEvent[]) {
  return events.map((e) => ({
    id: sanitizeText(String(e.id)),
    date: sanitizeText(String(e.date)),
    title: sanitizeText(String(e.title)),
    time: e.time ? sanitizeText(String(e.time)) : null,
    endTime: e.endTime ? sanitizeText(String(e.endTime)) : null,
    endDate: e.endDate ? sanitizeText(String(e.endDate)) : null,
    note: e.note ? sanitizeText(String(e.note)) : null,
    category: e.category ? sanitizeText(String(e.category)) : null,
    createdAt:
      typeof e.createdAt === "number" && Number.isFinite(e.createdAt)
        ? Math.floor(e.createdAt)
        : Date.now(),
  }));
}

async function invokeSaveToDisk(events: ScheduleEvent[]): Promise<number> {
  if (!events.length) {
    console.warn("[schedule] invokeSaveToDisk skipped — empty list");
    return 0;
  }
  const payload = toDiskPayload(events);
  const json = JSON.stringify(payload);
  console.log(
    `[schedule] saving ${events.length} events to disk (${json.length} bytes)`
  );
  // Only use the JSON-string command — array IPC was parsing to 0 events.
  try {
    const n = await invoke<number>("save_schedule_json", { json });
    console.log(`[schedule] disk save ok (${n})`);
    return n;
  } catch (e1) {
    console.error("[schedule] save_schedule_json failed", e1);
    throw e1;
  }
}

/** Load disk list (empty if unavailable). */
async function loadDiskList(): Promise<ScheduleEvent[]> {
  if (!isTauri()) return [];
  try {
    return normalizeList(
      await Promise.race([
        invoke<unknown>("load_schedule"),
        new Promise<never>((_, rej) =>
          window.setTimeout(
            () => rej(new Error("load_schedule timed out")),
            4000
          )
        ),
      ])
    );
  } catch {
    return [];
  }
}

/**
 * Union current UI list with disk so a partial window never overwrites
 * other plans when saving (add/update).
 */
async function unionWithDisk(events: ScheduleEvent[]): Promise<ScheduleEvent[]> {
  const disk = await loadDiskList();
  const local = readLocalStorage();
  return mergeByIdPreferNewer(disk, local, events, memoryCache);
}

export type ScheduleSaveMode = "merge" | "replace";

/**
 * Persist schedule to memory + localStorage + disk (survives quit).
 * Fire-and-forget disk write (merges with disk first — safe for add).
 */
export function saveSchedule(
  events: ScheduleEvent[],
  mode: ScheduleSaveMode = "merge"
) {
  scheduleWriteGen += 1;
  memoryCache = events;
  writeLocalStorage(events);
  void saveScheduleAsync(events, mode).catch((e) => {
    console.error("[schedule] disk save failed", e);
  });
}

/**
 * Await disk write.
 * - `merge` (default): union with disk/local so a partial UI list cannot wipe plans
 * - `replace`: write this list as authority (use for delete after a full load)
 */
export async function saveScheduleAsync(
  events: ScheduleEvent[],
  mode: ScheduleSaveMode = "merge"
) {
  const gen = ++scheduleWriteGen;
  memoryCache = events;
  writeLocalStorage(events);
  try {
    loadDeletedIds();
    let toWrite =
      mode === "replace"
        ? dropDeleted(mergeByIdPreferNewer(events))
        : dropDeleted(await unionWithDisk(events));
    // If a newer write landed while we merged, prefer that memory
    if (scheduleWriteGen !== gen && memoryCache) {
      toWrite =
        mode === "replace"
          ? memoryCache
          : mergeByIdPreferNewer(toWrite, memoryCache);
    }
    memoryCache = toWrite;
    writeLocalStorage(toWrite);

    // Never write [] over real data (race: flush before hydrate)
    if (toWrite.length === 0) {
      console.warn("[schedule] refuse empty save");
      return 0;
    }

    const n = await Promise.race([
      invokeSaveToDisk(toWrite),
      new Promise<never>((_, rej) =>
        window.setTimeout(
          () => rej(new Error("save_schedule timed out")),
          8000
        )
      ),
    ]);
    // Verify every user plan id is on disk
    try {
      const disk = await loadDiskList();
      const diskIds = new Set(disk.map((e) => e.id));
      const missing = toWrite.filter(
        (e) =>
          !e.id.startsWith("baa-default:") &&
          !!e.title?.trim() &&
          !!e.date?.trim() &&
          !diskIds.has(e.id)
      );
      if (missing.length > 0) {
        console.warn(
          `[schedule] disk missing ${missing.length} id(s), rewriting full list`,
          missing.map((m) => m.title)
        );
        const again =
          mode === "replace"
            ? toWrite
            : mergeByIdPreferNewer(disk, toWrite);
        await invokeSaveToDisk(again);
        memoryCache = again;
        writeLocalStorage(again);
      }
    } catch {
      /* verify optional */
    }
    console.log(`[schedule] disk save ok (${n} events, mode=${mode})`);
    return n;
  } catch (e) {
    console.error("[schedule] disk save failed", e);
    throw e;
  }
}

/**
 * Force current in-memory schedule onto disk (for Sync / multi-window).
 * Returns the list that was written.
 */
export async function flushScheduleToDisk(): Promise<ScheduleEvent[]> {
  const list = loadSchedule();
  // Never flush an empty in-memory cache over real disk data
  if (!list.length) {
    const disk = await loadDiskList();
    if (disk.length > 0) {
      memoryCache = disk;
      writeLocalStorage(disk);
      return disk;
    }
    return list;
  }
  try {
    await saveScheduleAsync(list, "merge");
  } catch {
    saveSchedule(list, "merge");
    await new Promise<void>((r) => window.setTimeout(r, 300));
  }
  return loadSchedule();
}

/**
 * Ensure default holidays / NJ days exist, then persist if anything was added.
 */
function withDefaults(list: ScheduleEvent[]): ScheduleEvent[] {
  const { events, added } = mergeDefaultCalendarEvents(list);
  memoryCache = events;
  writeLocalStorage(events);
  // Only persist when defaults were newly seeded AND we have real rows
  if (added > 0 && events.length > 0) {
    void invokeSaveToDisk(events).catch(() => undefined);
  }
  return events;
}

/**
 * Load from disk (shared across all windows) and seed local caches.
 * Always merges disk + localStorage so a failed prior disk write cannot
 * drop plans that still live in the browser store.
 * Always merges default public holidays + NewJeans days if missing.
 */
export async function hydrateSchedule(): Promise<ScheduleEvent[]> {
  if (hydratePromise) return hydratePromise;
  hydratePromise = (async () => {
    const local = readLocalStorage();
    if (!isTauri()) {
      return withDefaults(local);
    }
    try {
      loadDeletedIds();
      await pullDiskDeletedIds();
      const disk = await loadDiskList();
      // Union disk + localStorage + memory — never clobber newer local plans
      const merged = dropDeleted(
        mergeByIdPreferNewer(disk, local, memoryCache)
      );
      const withDef = withDefaults(merged);
      writeLocalStorage(withDef);
      // If local/memory had anything disk didn't, push union back to disk
      const diskIds = new Set(disk.map((e) => e.id));
      const needsWrite =
        withDef.length > 0 &&
        (withDef.some(
          (e) =>
            !diskIds.has(e.id) &&
            !e.id.startsWith("baa-default:")
        ) ||
          withDef.length > disk.length ||
          disk.length === 0);
      if (needsWrite) {
        await invokeSaveToDisk(withDef).catch((e) =>
          console.error("[schedule] hydrate backfill save failed", e)
        );
      }
      return withDef;
    } catch (e) {
      console.error("[schedule] hydrate failed", e);
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
  // Keep a snapshot of in-flight local writes so a slow disk read cannot
  // erase a plan the user just added in this webview.
  const memSnap = memoryCache;
  const localSnap = readLocalStorage();
  const genAtStart = scheduleWriteGen;
  if (!isTauri()) {
    return withDefaults(loadSchedule());
  }
  try {
    loadDeletedIds();
    await pullDiskDeletedIds();
    const disk = await loadDiskList();
    // If user saved again while we were loading, trust the latest memory
    if (scheduleWriteGen !== genAtStart && memoryCache) {
      return withDefaults(
        dropDeleted(mergeByIdPreferNewer(disk, localSnap, memoryCache))
      );
    }
    const merged = dropDeleted(
      mergeByIdPreferNewer(disk, localSnap, memSnap)
    );
    writeLocalStorage(merged);
    memoryCache = merged;
    return withDefaults(merged);
  } catch {
    return withDefaults(
      mergeByIdPreferNewer(memSnap, localSnap, loadSchedule())
    );
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
    const timeRaw = o.time ?? o.when ?? o.startTime ?? o.start_time;
    const endTimeRaw = o.endTime ?? o.end_time ?? o.untilTime ?? o.finish;
    const noteRaw = o.note ?? o.notes ?? o.desc;
    const catRaw = String(
      o.category ?? o.type ?? o.kind ?? o.tag ?? ""
    )
      .trim()
      .toLowerCase();
    let category: ScheduleCategory;
    if (catRaw) {
      category = normalizeCategory(catRaw);
    } else if (looksLikeWork(title, noteRaw ? String(noteRaw) : "")) {
      category = "work";
    } else if (
      /school|class|lecture|homework|exam|study|上課|學校|功課|考試|tutorial/i.test(
        `${title} ${noteRaw || ""}`
      )
    ) {
      category = "school";
    } else if (
      /family|家人|家庭|父母|媽媽|爸爸|kids|kid|child/i.test(
        `${title} ${noteRaw || ""}`
      )
    ) {
      category = "family";
    } else if (
      /friend|朋友|hangout|party|dinner with/i.test(
        `${title} ${noteRaw || ""}`
      )
    ) {
      category = "friends";
    } else {
      category = "event";
    }
    const end =
      endDate && endDate >= date && endDate !== date ? endDate : undefined;
    events.push({
      date,
      endDate: end,
      title,
      time: normalizeHhmm(timeRaw),
      endTime: normalizeHhmm(endTimeRaw),
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
  if (e.category) return normalizeCategory(e.category);
  return looksLikeWork(e.title, e.note || "") ? "work" : "event";
}

/** Hours before event to remind: work=3, others=1 */
export function reminderLeadHours(e: ScheduleEvent): number {
  return CATEGORY_META[eventCategory(e)].leadHours;
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
    const meta = CATEGORY_META[cat];
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
      emoji: meta.emoji,
      message:
        cat === "work"
          ? `Work soon: “${e.title}” at ${timeLabel} (${when})!`
          : `${meta.emoji} ${meta.label}: “${e.title}” at ${timeLabel} (${when})!`,
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

/**
 * Strict match for ADD/UPDATE (not cancel).
 * Avoids “Dinner” colliding with junk “Event” rows, or partial title includes.
 */
export function matchesScheduleUpsert(
  existing: ScheduleEvent,
  incoming: Pick<ScheduleEvent, "date" | "title" | "time">
): boolean {
  if (existing.date !== incoming.date) return false;
  const a = existing.title.toLowerCase().trim();
  const b = incoming.title.toLowerCase().trim();
  if (!a || !b) return false;
  // Exact title (ignore case)
  if (a === b) {
    if (incoming.time && existing.time) {
      return normalizeTime(existing.time) === normalizeTime(incoming.time);
    }
    // Same title+date, time missing on one side → treat as same plan to update
    return true;
  }
  // Never treat generic placeholders as a match for a real title
  if (isGenericScheduleTitle(a) || isGenericScheduleTitle(b)) return false;
  return false;
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
      matchesScheduleUpsert(x, {
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
        time: e.time !== undefined ? normalizeHhmm(e.time) : prev.time,
        endTime:
          e.endTime !== undefined
            ? normalizeHhmm(e.endTime) || undefined
            : prev.endTime,
        note: e.note !== undefined ? e.note : prev.note,
        // Category always applied when provided
        category:
          e.category != null
            ? normalizeCategory(e.category)
            : prev.category
              ? normalizeCategory(prev.category)
              : undefined,
        createdAt: Date.now(),
      };
      const changed =
        eventCategory(merged) !== eventCategory(prev) ||
        (merged.time || "") !== (prev.time || "") ||
        (merged.endTime || "") !== (prev.endTime || "") ||
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
          e.category != null
            ? normalizeCategory(e.category)
            : looksLikeWork(e.title, e.note || "")
              ? "work"
              : "event",
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

  const message = stripScheduleMachineText(kept.join("\n"));

  return {
    message,
    events: dedupe(events),
    cancels: dedupe(cancels),
  };
}

/** Remove machine calendar lines so they never show in the chat bubble. */
export function stripScheduleMachineText(raw: string): string {
  let text = typeof raw === "string" ? raw : String(raw ?? "");
  // Fenced JSON
  text = text.replace(/```(?:json)?\s*[\s\S]*?```/gi, " ");
  // Label + array, even if JSON is messy / truncated
  text = text.replace(
    /\bCANCEL_SCHEDULE_JSON\s*:?\s*\[[\s\S]*?\]/gi,
    " "
  );
  text = text.replace(/\bSCHEDULE_JSON\s*:?\s*\[[\s\S]*?\]/gi, " ");
  text = text.replace(/\bCANCEL_SCHEDULE_JSON\s*:?[^\n]*/gi, " ");
  text = text.replace(/\bSCHEDULE_JSON\s*:?[^\n]*/gi, " ");
  // Bare leftover tags
  text = text.replace(/\bCANCEL_SCHEDULE_JSON\b/gi, " ");
  text = text.replace(/\bSCHEDULE_JSON\b/gi, " ");
  return text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
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
    t === "on" ||
    t === "today" ||
    t === "tonight" ||
    t === "what's on today" ||
    t === "whats on today" ||
    t === "what's on" ||
    t === "whats on" ||
    t === "me" ||
    t === "remind me" ||
    t === "remind me tonight" ||
    t === "tonight" ||
    t === "活動" ||
    t === "事件" ||
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

  const userWeekday = weekdayFromText(userText);
  const modelDateWrong =
    !!user.date &&
    !modelEvents.some((e) => e.date === user.date) &&
    (!!userWeekday ||
      /\b(today|tonight|tomorrow|tmr|tmrw)\b/i.test(userText) ||
      /(聽日|明天|今日|今天|今晚)/.test(userText));
  // "7pm dinner" must not become the 7th of the month
  const hourAsDay = modelEvents.some((e) => {
    const spoken = userText.match(/\b(\d{1,2})\s*(am|pm)\b/i);
    if (!spoken) return false;
    const spokenHour = parseInt(spoken[1], 10);
    const dayNum = parseInt(e.date.slice(8, 10), 10);
    return spokenHour === dayNum && e.date !== user.date;
  });

  if (
    modelGeneric ||
    modelMissingRange ||
    modelMissesFlyerDates ||
    modelDateWrong ||
    hourAsDay
  ) {
    if (modelDateWrong || hourAsDay) {
      const model = modelEvents[0];
      return [
        {
          ...model,
          date: user.date,
          endDate: user.endDate || model.endDate,
          time: model.time || user.time,
          title: isGenericScheduleTitle(model.title) ? user.title : model.title,
          note: model.note || user.note,
          category: model.category || user.category,
        },
      ];
    }
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

/**
 * JS `\b` only works at ASCII word edges — Chinese has no `\w` letters, so
 * patterns like `\b聽日\b` never match. Use bare CJK / no-`\b` for those.
 */
function hasPlanActivity(text: string): boolean {
  return (
    /\b(dinner|lunch|breakfast|brunch|meal|supper|coffee|tea|meeting|meet|call|class|exam|flight|train|appointment|appt|date|party|workout|gym|movie|cinema|concert|show|interview|deadline|submit|pickup|dropoff|lesson|tutorial|lecture|doctor|dentist|haircut)\b/i.test(
      text
    ) ||
    /(晚飯|晚餐|午餐|午飯|早餐|食飯|約會|會議|開會|上堂|考試|飛機|趕deadline|Deadline|返工|上班|見工|面試|睇醫生|剪頭髮)/i.test(
      text
    )
  );
}

function hasWhenHint(text: string): boolean {
  const t = text.toLowerCase();
  return (
    /\b(today|tonight|tomorrow|tmr|tmrw|tmrw\.|tmr\.|next)\b/.test(t) ||
    // no \b around CJK — \b breaks Chinese matching
    /(聽日|明天|今日|今天|今晚|後日|後天|下星期|下個星期|下週|下个星期|星期[一二三四五六日天]|週[一二三四五六日天]|礼拜[一二三四五六日天])/.test(
      text
    ) ||
    /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/.test(t) ||
    /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b/.test(
      t
    ) ||
    /\b\d{1,2}[:.]\d{2}\b/.test(t) ||
    /\b\d{1,2}\s*(am|pm)\b/.test(t) ||
    /\b\d{3,4}\s*(am|pm)\b/.test(t) || // 800pm
    /\b([01]?\d|2[0-3])[0-5]\d\b/.test(t) || // 2100 military
    /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/.test(t) ||
    /\b\d{1,2}-\d{1,2}(?:-\d{2,4})?\b/.test(t) ||
    /\d{4}-\d{1,2}-\d{1,2}/.test(t) ||
    /\d{4}\s*年/.test(text) ||
    /\d{1,2}\s*月\s*\d{1,2}\s*日/.test(text) ||
    // “3點” / “三點半” style (common Cantonese / written Chinese)
    /\d{1,2}\s*點/.test(text)
  );
}

/** Explicit “put this on the calendar” intent (EN + CJK). */
function hasScheduleMarkIntent(text: string): boolean {
  const t = text.toLowerCase();
  if (
    /\b(mark|schedule|add|put|remember|remind|save|plan|book|set)\b/.test(t)
  ) {
    return true;
  }
  // Chinese: 記低 / 幫我記 / 加入日曆 / 寫低 / 提醒我 …
  return /(記低|記住|記住|寫低|寫下|標低|標記|加入日曆|加到日曆|加落日曆|放落日曆|放上日曆|記喺日曆|提醒我|提我|安排|約咗|約了)/.test(
    text
  );
}

/**
 * Bare “remind me tonight / today” — recap existing plans, not “add an event”.
 * “Remind me tonight to call mom” still counts as adding (has a task).
 */
export function looksLikeScheduleBriefing(text: string): boolean {
  const t = text.toLowerCase().trim().replace(/[.!?…]+$/g, "").trim();
  if (!t) return false;
  if (hasPlanActivity(text)) return false;
  if (
    /^(?:please\s+|pls\s+|can you\s+|could you\s+)?(?:remind me|提醒我|提我)(?:\s+(?:of|about))?(?:\s+(?:my|the))?(?:\s+(?:plans?|schedule|calendar))?\s*(?:tonight|today|this evening|later|今晚|今日|今天)\s*$/i.test(
      t
    )
  ) {
    return true;
  }
  if (
    /\bwhat(?:'s|s|\s+is|\s+do i have|\s+have i got)?\s+(?:on\s+)?(?:tonight|this evening)\b/.test(
      t
    )
  ) {
    return true;
  }
  if (/(今晚有咩|今晚行程|今晚安排|今晚約)/.test(text) && !hasPlanActivity(text)) {
    return true;
  }
  return false;
}

/** Asking what's already on the calendar (not adding a new plan). */
export function looksLikeCalendarAsk(text: string): boolean {
  const t = text.toLowerCase().trim();
  if (!t) return false;
  if (looksLikeScheduleBriefing(text)) return true;
  if (
    /\bwhat(?:'s|s|\s+is)?\s+on\b/.test(t) ||
    /\banything\s+on\b/.test(t) ||
    /\bshow\s+(?:my\s+)?(?:calendar|schedule|plans?)\b/.test(t) ||
    /\b(?:check|see|list|view)\s+(?:my\s+)?(?:calendar|schedule|plans?)\b/.test(
      t
    )
  ) {
    return true;
  }
  if (
    /\b(calendar|schedule|agenda|plans?)\b/.test(t) &&
    /\b(today|tonight|tomorrow|now)\b/.test(t) &&
    !hasScheduleMarkIntent(text)
  ) {
    return true;
  }
  if (/(日曆有咩|今日有咩|今日行程|今日安排|有咩約|行程表)/.test(text)) {
    return true;
  }
  return false;
}

/** User is asking to mark / schedule something — or pasted event flyer text */
export function looksLikeScheduleRequest(text: string): boolean {
  const t = text.toLowerCase().trim();
  if (!t) return false;
  // “What's on today?” is a lookup, not “add an event called on”
  if (looksLikeCalendarAsk(text)) return false;
  // Explicit mark / schedule language (EN mark + time/calendar, or CJK 記低…)
  if (hasScheduleMarkIntent(text)) {
    if (
      hasWhenHint(text) ||
      hasPlanActivity(text) ||
      /\b(calendar|schedule|plan|agenda)\b/.test(t) ||
      /(日曆|行程|schedule|calendar)/i.test(text) ||
      /\d{4}-\d{1,2}-\d{1,2}/.test(t) ||
      /\d{1,2}\/\d{1,2}/.test(t)
    ) {
      return true;
    }
  }
  // Casual: “Tmr 8pm dinner at Mongkok” / “23/7 dinner 21:00” / “聽日3點開會”
  if (hasPlanActivity(text) && hasWhenHint(text)) return true;
  // Time + place-ish (at X / 喺)
  if (
    hasWhenHint(text) &&
    (/\bat\b/i.test(text) || /喺|在/.test(text)) &&
    text.trim().length >= 8
  ) {
    return true;
  }
  // Event flyer / race paste (Chinese or English)
  if (looksLikeEventFlyer(text)) return true;
  if (
    (/\b(run|race|marathon|virtual|ust|gala|concert|tournament)\b/i.test(
      text
    ) ||
      /(賽事|馬拉松|虛擬跑|長跑)/.test(text)) &&
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

/** "wed" / "next wed" / "nest wed" (typo) / 星期三 → 0–6, or null */
export function weekdayFromText(
  text: string
): { day: number; next: boolean } | null {
  const t = text.toLowerCase();
  const next = /\b(next|nest)\b/.test(t);
  const names: Array<[RegExp, number]> = [
    [/\b(sun(?:day)?)\b/, 0],
    [/\b(mon(?:day)?)\b/, 1],
    [/\b(tue(?:s(?:day)?)?)\b/, 2],
    [/\b(wed(?:nesday)?)\b/, 3],
    [/\b(thu(?:r(?:s(?:day)?)?)?)\b/, 4],
    [/\b(fri(?:day)?)\b/, 5],
    [/\b(sat(?:urday)?)\b/, 6],
  ];
  for (const [re, day] of names) {
    if (re.test(t)) return { day, next };
  }
  const cn = text.match(/(?:星期|週|周|礼拜)([一二三四五六日天])/);
  if (cn) {
    const map: Record<string, number> = {
      日: 0,
      天: 0,
      一: 1,
      二: 2,
      三: 3,
      四: 4,
      五: 5,
      六: 6,
    };
    const day = map[cn[1]];
    if (day !== undefined) return { day, next };
  }
  return null;
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
  // —— Multi-day / flyer dates (prefer range if present) ——
  const cnDates = [
    ...userText.matchAll(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/g),
  ].map(
    (m) =>
      `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`
  );
  const monthNames: Record<string, number> = {
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
    jan: 1,
    feb: 2,
    mar: 3,
    apr: 4,
    jun: 6,
    jul: 7,
    aug: 8,
    sep: 9,
    sept: 9,
    oct: 10,
    nov: 11,
    dec: 12,
  };
  // "July 23, 2026" or "July 23"
  const enDates = [
    ...userText.matchAll(
      /\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?\s+(\d{1,2})(?:,?\s*(20\d{2}))?\b/gi
    ),
  ].map((m) => {
    const mo = monthNames[m[1].toLowerCase()];
    if (!mo) return "";
    const year = m[3] || today.slice(0, 4);
    return `${year}-${String(mo).padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  }).filter(Boolean);
  // "23 July 2026" or "23 July" (common HK English)
  const enDatesDmy = [
    ...userText.matchAll(
      /\b(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?(?:\s+(20\d{2}))?\b/gi
    ),
  ].map((m) => {
    const mo = monthNames[m[2].toLowerCase()];
    if (!mo) return "";
    const year = m[3] || today.slice(0, 4);
    return `${year}-${String(mo).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }).filter(Boolean);
  const isoDates = [
    ...userText.matchAll(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/g),
  ].map(
    (m) =>
      `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`
  );

  const allDates = [...cnDates, ...enDates, ...enDatesDmy, ...isoDates].filter(
    (d, i, a) => a.indexOf(d) === i
  );
  if (allDates.length >= 2) {
    allDates.sort();
    date = allDates[0];
    endDate = allDates[allDates.length - 1];
  } else if (allDates.length === 1) {
    date = allDates[0];
  } else if (/\b(today|tonight)\b/i.test(userText) || /(今日|今天|今晚)/.test(userText)) {
    date = today;
  } else if (
    /\b(tomorrow|tmr|tmrw|tmrw\.|tmr\.)\b/i.test(userText) ||
    /(聽日|明天|翌日)/.test(userText)
  ) {
    date = addDaysYmd(today, 1);
  } else if (
    /\b(day after tomorrow)\b/i.test(userText) ||
    /(後日|後天)/.test(userText)
  ) {
    date = addDaysYmd(today, 2);
  } else {
    // D/M or M/D (HK Bunnies usually use day/month, e.g. 23/7)
    const md = userText.match(/\b(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](20\d{2}|\d{2}))?\b/);
    if (md) {
      let a = parseInt(md[1], 10);
      let b = parseInt(md[2], 10);
      let year = today.slice(0, 4);
      if (md[3]) {
        year = md[3].length === 2 ? `20${md[3]}` : md[3];
      }
      let month: number;
      let day: number;
      if (a > 12 && b >= 1 && b <= 12) {
        // 23/7 → 23 Jul
        day = a;
        month = b;
      } else if (b > 12 && a >= 1 && a <= 12) {
        // 7/23 → Jul 23
        month = a;
        day = b;
      } else {
        // Both ≤12: prefer day/month (HK / most of world outside US)
        day = a;
        month = b;
      }
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      }
    } else {
      const wd = weekdayFromText(userText);
      if (wd) date = nextWeekdayYmd(today, wd.day);
    }
  }

  // Weekday wins over a guessed numeric date when user said "next wed" etc.
  {
    const wd = weekdayFromText(userText);
    if (wd && (wd.next || !allDates.length)) {
      date = nextWeekdayYmd(today, wd.day);
      endDate = undefined;
    }
  }

  // Time: 21:00 | 9:30pm | 800pm | 8pm | 3點 | 3點半
  let time: string | undefined;
  const t24 = userText.match(/\b(\d{1,2}):(\d{2})\b/);
  const t12colon = userText.match(/\b(\d{1,2}):(\d{2})\s*(am|pm)\b/i);
  const t12 = userText.match(/\b(\d{1,2})\s*(am|pm)\b/i);
  const tCompact = userText.match(/\b(\d{3,4})\s*(am|pm)\b/i); // 800pm → 8:00 pm
  const tCn = userText.match(/(\d{1,2})\s*點\s*(半|(\d{1,2})\s*分?)?/);
  if (t12colon) {
    let h = parseInt(t12colon[1], 10) % 12;
    if (t12colon[3].toLowerCase() === "pm") h += 12;
    time = `${String(h).padStart(2, "0")}:${t12colon[2]}`;
  } else if (t24) {
    const h = parseInt(t24[1], 10);
    const m = parseInt(t24[2], 10);
    if (h < 24 && m < 60) time = `${String(h).padStart(2, "0")}:${t24[2]}`;
  } else if (tCompact) {
    const digits = tCompact[1];
    let h: number;
    let m: number;
    if (digits.length === 3) {
      h = parseInt(digits[0], 10);
      m = parseInt(digits.slice(1), 10);
    } else {
      h = parseInt(digits.slice(0, 2), 10);
      m = parseInt(digits.slice(2), 10);
    }
    h = h % 12;
    if (tCompact[2].toLowerCase() === "pm") h += 12;
    if (m < 60) time = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  } else if (t12) {
    let h = parseInt(t12[1], 10) % 12;
    if (t12[2].toLowerCase() === "pm") h += 12;
    time = `${String(h).padStart(2, "0")}:00`;
  } else if (tCn) {
    const h = Math.min(23, parseInt(tCn[1], 10));
    let m = 0;
    if (tCn[2] === "半") m = 30;
    else if (tCn[3]) m = Math.min(59, parseInt(tCn[3], 10));
    time = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  } else {
    // Military 2100 / 0930 (avoid matching years 2026)
    const mil = userText.match(/\b([01]?\d|2[0-3])([0-5]\d)\b/);
    if (mil && !/^20\d{2}$/.test(mil[0])) {
      time = `${mil[1].padStart(2, "0")}:${mil[2]}`;
    }
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
      (/\b(run|race|marathon|virtual|ust|gala|concert|tournament|show|festival)\b/i.test(
        line
      ) ||
        /(賽事|馬拉松)/.test(line)) ||
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

  const scrubTitle = (raw: string) =>
    raw
      .replace(
        /\b(please|pls|can you|could you|mark|schedule|add|put|remember|remind|save|plan|book|set|on|the|my|a|an|to|for|calendar|agenda|event\s*date)\b/gi,
        " "
      )
      .replace(
        /賽事日期|活動日期|記低|記住|寫低|寫下|標低|標記|加入日曆|加到日曆|加落日曆|放落日曆|放上日曆|提醒我|提我|幫我|请|請/g,
        " "
      )
      .replace(
        /\b(today|tonight|tomorrow|tmr|tmrw|tmrw\.|tmr\.|next|nest|this)\b/gi,
        " "
      )
      .replace(
        /\b(sun(?:day)?|mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?)\b/gi,
        " "
      )
      .replace(/(聽日|明天|今日|今天|今晚|後日|後天|翌日)/g, " ")
      .replace(/\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日/g, " ")
      .replace(
        /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}\b/gi,
        " "
      )
      .replace(/\b(20\d{2}-\d{1,2}-\d{1,2})\b/g, " ")
      .replace(/\b\d{1,2}[\/\-.]\d{1,2}(?:[\/\-.]\d{2,4})?\b/g, " ")
      .replace(/\b\d{1,2}:\d{2}\s*(am|pm)?\b/gi, " ")
      .replace(/\b\d{3,4}\s*(am|pm)\b/gi, " ")
      .replace(/\b\d{1,2}\s*(am|pm)\b/gi, " ")
      .replace(/\b([01]?\d|2[0-3])[0-5]\d\b/g, " ")
      .replace(
        /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b/gi,
        " "
      )
      .replace(/^\d{1,2}\s+/, " ") // leftover day number from "23 July dinner"
      .replace(/\s+/g, " ")
      .trim();

  if (!title) {
    title = scrubTitle(userText);
  } else {
    title = scrubTitle(title) || title;
  }
  // Title-case short casual titles
  if (title && title.length < 48) {
    title = title.replace(/\b([a-z])/g, (c) => c.toUpperCase());
  }

  if (!title || title.length < 2) title = "Event";
  if (title.length > 72) title = title.slice(0, 72).trim();

  const category = looksLikeWork(title) ? "work" : "event";
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
      const meta = CATEGORY_META[cat];
      const tag = `${meta.emoji} ${meta.label}`;
      const tr = formatTimeRange(e.time, e.endTime);
      return `${tr ? tr + " " : ""}${e.title} (${range} · ${tag})`;
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
      const meta = CATEGORY_META[cat];
      const tag = `${meta.emoji} ${meta.label} · ${meta.leadHours}h remind`;
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

/** Multi-day mark modes for “same job time on several days”. */
export type MultiDayMode = "once" | "daily" | "weekdays";

/**
 * Expand a start→end range into date keys.
 * - once: just start
 * - daily: every day inclusive
 * - weekdays: Mon–Fri only (ideal for work shifts)
 */
export function expandMultiDayDates(
  start: string,
  end: string | undefined,
  mode: MultiDayMode
): string[] {
  if (mode === "once" || !end || end <= start) return [start];
  const all = eachDateKey(start, end);
  if (mode === "daily") return all;
  // weekdays: JS getDay() 0=Sun … 6=Sat → keep 1–5
  return all.filter((key) => {
    const [y, m, d] = key.split("-").map(Number);
    const dow = new Date(y, m - 1, d).getDay();
    return dow >= 1 && dow <= 5;
  });
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

/**
 * Unique user-plan categories per date (skips default holiday marks).
 * Used to paint emoji / tint on month grid cells.
 */
export function categoriesByDate(
  events: ScheduleEvent[]
): Map<string, ScheduleCategory[]> {
  const map = new Map<string, ScheduleCategory[]>();
  for (const e of events) {
    if (e.id.startsWith("baa-default:")) continue;
    const cat = eventCategory(e);
    for (const d of eachDateKey(e.date, e.endDate)) {
      const list = map.get(d) ?? [];
      if (!list.includes(cat)) list.push(cat);
      map.set(d, list);
    }
  }
  return map;
}

/** Primary category for a day (first user event), for cell tint */
export function primaryCategoryOnDate(
  events: ScheduleEvent[],
  date: string
): ScheduleCategory | null {
  const cats = categoriesByDate(events).get(date);
  return cats?.[0] ?? null;
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
