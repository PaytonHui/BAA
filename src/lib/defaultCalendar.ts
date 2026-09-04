/**
 * Default calendar seeds — HK public holidays, special days,
 * NewJeans member birthdays (color hearts), and NJ anniversaries.
 *
 * Stable ids: `baa-default:<key>:<YYYY-MM-DD>` so re-seed never duplicates.
 */

import type { LightColorMode } from "./lightColors";
import type { ScheduleEvent } from "./schedule";
import {
  hasUserBirthday,
  loadUserProfile,
  USER_BUNNY,
  type UserProfile,
} from "./userProfile";

const ID_PREFIX = "baa-default:";

export function isDefaultCalendarId(id: string): boolean {
  return id.startsWith(ID_PREFIX);
}

function ymd(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function nthWeekdayOfMonth(
  year: number,
  month: number,
  weekday: number,
  n: number
): string {
  // weekday: 0=Sun … 6=Sat; n: 1st, 2nd, …
  let count = 0;
  for (let d = 1; d <= 31; d++) {
    const dt = new Date(year, month - 1, d);
    if (dt.getMonth() !== month - 1) break;
    if (dt.getDay() === weekday) {
      count += 1;
      if (count === n) return ymd(year, month, d);
    }
  }
  return ymd(year, month, 1);
}

type Seed = {
  key: string;
  date: string;
  title: string;
  note?: string;
};

/** Official HK general holidays (gov.hk gazetted lists). */
const HK_HOLIDAYS: Record<number, Array<{ m: number; d: number; title: string }>> = {
  2025: [
    { m: 1, d: 1, title: "New Year’s Day 🎆" },
    { m: 1, d: 29, title: "Lunar New Year’s Day 🧧" },
    { m: 1, d: 30, title: "Lunar New Year (2nd day) 🧧" },
    { m: 1, d: 31, title: "Lunar New Year (3rd day) 🧧" },
    { m: 4, d: 4, title: "Ching Ming Festival 🌼" },
    { m: 4, d: 18, title: "Good Friday" },
    { m: 4, d: 19, title: "Day following Good Friday" },
    { m: 4, d: 21, title: "Easter Monday" },
    { m: 5, d: 1, title: "Labour Day 💪" },
    { m: 5, d: 5, title: "Birthday of the Buddha 🪷" },
    { m: 5, d: 31, title: "Tuen Ng Festival 🐉" },
    { m: 7, d: 1, title: "HKSAR Establishment Day 🇭🇰" },
    { m: 10, d: 1, title: "National Day 🇨🇳" },
    { m: 10, d: 7, title: "Day after Mid-Autumn Festival 🌕" },
    { m: 10, d: 29, title: "Chung Yeung Festival" },
    { m: 12, d: 25, title: "Christmas Day 🎄" },
    { m: 12, d: 26, title: "Boxing Day 🎁" },
  ],
  2026: [
    { m: 1, d: 1, title: "New Year’s Day 🎆" },
    { m: 2, d: 17, title: "Lunar New Year’s Day 🧧" },
    { m: 2, d: 18, title: "Lunar New Year (2nd day) 🧧" },
    { m: 2, d: 19, title: "Lunar New Year (3rd day) 🧧" },
    { m: 4, d: 3, title: "Good Friday" },
    { m: 4, d: 4, title: "Day following Good Friday" },
    { m: 4, d: 6, title: "Day following Ching Ming Festival 🌼" },
    { m: 4, d: 7, title: "Day following Easter Monday" },
    { m: 5, d: 1, title: "Labour Day 💪" },
    { m: 5, d: 25, title: "Day following Birthday of the Buddha 🪷" },
    { m: 6, d: 19, title: "Tuen Ng Festival 🐉" },
    { m: 7, d: 1, title: "HKSAR Establishment Day 🇭🇰" },
    { m: 9, d: 26, title: "Day after Mid-Autumn Festival 🌕" },
    { m: 10, d: 1, title: "National Day 🇨🇳" },
    { m: 10, d: 19, title: "Day following Chung Yeung Festival" },
    { m: 12, d: 25, title: "Christmas Day 🎄" },
    { m: 12, d: 26, title: "Boxing Day 🎁" },
  ],
  2027: [
    { m: 1, d: 1, title: "New Year’s Day 🎆" },
    { m: 2, d: 6, title: "Lunar New Year’s Day 🧧" },
    { m: 2, d: 8, title: "Lunar New Year (3rd day) 🧧" },
    { m: 2, d: 9, title: "Lunar New Year (4th day) 🧧" },
    { m: 3, d: 26, title: "Good Friday" },
    { m: 3, d: 27, title: "Day following Good Friday" },
    { m: 3, d: 29, title: "Easter Monday" },
    { m: 4, d: 5, title: "Ching Ming Festival 🌼" },
    { m: 5, d: 1, title: "Labour Day 💪" },
    { m: 5, d: 13, title: "Birthday of the Buddha 🪷" },
    { m: 6, d: 9, title: "Tuen Ng Festival 🐉" },
    { m: 7, d: 1, title: "HKSAR Establishment Day 🇭🇰" },
    { m: 9, d: 16, title: "Day after Mid-Autumn Festival 🌕" },
    { m: 10, d: 1, title: "National Day 🇨🇳" },
    { m: 10, d: 8, title: "Chung Yeung Festival" },
    { m: 12, d: 25, title: "Christmas Day 🎄" },
    { m: 12, d: 27, title: "First weekday after Christmas 🎁" },
  ],
};

/** Fixed annual special days (same date every year). */
const FIXED_SPECIALS: Array<{ m: number; d: number; key: string; title: string; note?: string }> =
  [
    {
      m: 2,
      d: 14,
      key: "valentine",
      title: "Valentine’s Day 💕",
      note: "Spread love 💌",
    },
    {
      m: 3,
      d: 8,
      key: "iwd",
      title: "International Women’s Day 💜",
    },
    {
      m: 3,
      d: 14,
      key: "white-day",
      title: "White Day 🤍",
      note: "Return the sweetness",
    },
    {
      m: 4,
      d: 1,
      key: "april-fools",
      title: "April Fools’ Day 🃏",
    },
    {
      m: 10,
      d: 31,
      key: "halloween",
      title: "Halloween 🎃",
    },
    {
      m: 12,
      d: 24,
      key: "xmas-eve",
      title: "Christmas Eve ✨",
    },
    {
      m: 12,
      d: 31,
      key: "nye",
      title: "New Year’s Eve 🥂",
    },
  ];

/**
 * NewJeans member birthdays — hearts match lightstick colors in BAA:
 * Minji blue · Hanni orange · Danielle yellow · Haerin green · Hyein purple
 */
const NJ_BIRTHDAYS: Array<{
  m: number;
  d: number;
  key: string;
  name: string;
  title: string;
  note: string;
  /** Color heart shown in the month grid instead of the day number */
  heart: string;
  /** Stick LED locked to this solid color all day */
  color: Exclude<LightColorMode, "cycle" | "off" | "white">;
}> = [
  {
    m: 5,
    d: 7,
    key: "bday-minji",
    name: "Minji",
    title: "Minji’s Birthday 💙",
    note: "NewJeans · Minji (blue lightstick)",
    heart: "💙",
    color: "blue",
  },
  {
    m: 10,
    d: 6,
    key: "bday-hanni",
    name: "Hanni",
    title: "Hanni’s Birthday 🧡",
    note: "NewJeans · Hanni (orange lightstick)",
    heart: "🧡",
    color: "orange",
  },
  {
    m: 4,
    d: 11,
    key: "bday-danielle",
    name: "Danielle",
    title: "Danielle’s Birthday 💛",
    note: "NewJeans · Danielle (yellow lightstick)",
    heart: "💛",
    color: "yellow",
  },
  {
    m: 5,
    d: 15,
    key: "bday-haerin",
    name: "Haerin",
    title: "Haerin’s Birthday 💚",
    note: "NewJeans · Haerin (green lightstick)",
    heart: "💚",
    color: "green",
  },
  {
    m: 4,
    d: 21,
    key: "bday-hyein",
    name: "Hyein",
    title: "Hyein’s Birthday 💜",
    note: "NewJeans · Hyein (purple lightstick)",
    heart: "💜",
    color: "purple",
  },
];

/** Live birthday day — locks stick color + drives celebration. */
export interface NewJeansBirthdayToday {
  key: string;
  name: string;
  heart: string;
  color: Exclude<LightColorMode, "cycle" | "off" | "white">;
  title: string;
}

export function getNewJeansBirthdayToday(
  d = new Date()
): NewJeansBirthdayToday | null {
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const hit = NJ_BIRTHDAYS.find((b) => b.m === m && b.d === day);
  if (!hit) return null;
  return {
    key: hit.key,
    name: hit.name,
    heart: hit.heart,
    color: hit.color,
    title: hit.title,
  };
}

/** Care-bubble lines for a member birthday (rotate a few). */
export function birthdayCareLines(b: NewJeansBirthdayToday): Array<{
  text: string;
  emoji: string;
}> {
  return [
    {
      emoji: b.heart,
      text: `Happy birthday, ${b.name}! ${b.heart} Stick stays ${b.name}’s color all day!`,
    },
    {
      emoji: "🎂",
      text: `It’s ${b.name}’s day! ${b.heart} Bunnies celebrate with ${b.name}!`,
    },
    {
      emoji: "🐰",
      text: `${b.name} birthday mode on ${b.heart} Color locked — no switching today!`,
    },
    {
      emoji: "✨",
      text: `Party for ${b.name}! ${b.heart} Lightstick is glowing only for them today.`,
    },
  ];
}

/**
 * Month-day → color heart for NewJeans birthdays.
 * Used by the calendar grid to replace the day number.
 */
export function newJeansBirthdayHeart(
  _year: number,
  monthIndex: number,
  day: number
): string | null {
  // monthIndex is 0-based (JS Date); birthdays repeat every year
  void _year;
  const m = monthIndex + 1;
  const hit = NJ_BIRTHDAYS.find((b) => b.m === m && b.d === day);
  return hit?.heart ?? null;
}

/** Date key YYYY-MM-DD → heart (any year) */
export function newJeansBirthdayHeartForDateKey(dateKey: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return null;
  const [, ms, ds] = dateKey.split("-");
  const m = parseInt(ms, 10);
  const d = parseInt(ds, 10);
  const hit = NJ_BIRTHDAYS.find((b) => b.m === m && b.d === d);
  return hit?.heart ?? null;
}

/** Important NewJeans / Bunnies days (annual). */
const NJ_SPECIALS: Array<{
  m: number;
  d: number;
  key: string;
  title: string;
  note: string;
}> = [
  {
    m: 7,
    d: 22,
    key: "nj-debut",
    title: "NewJeans Debut Day 🐰",
    note: "Debut 2022 · Attention · Happy anniversary, Bunnies!",
  },
  {
    m: 8,
    d: 1,
    key: "nj-1st-ep",
    title: "NewJeans 1st EP Day 💿",
    note: "NewJeans EP (2022) · Attention · Hype Boy · Cookie · Hurt",
  },
  {
    m: 1,
    d: 2,
    key: "nj-omg",
    title: "OMG Anniversary 🎵",
    note: "OMG single album (2023)",
  },
  {
    m: 7,
    d: 21,
    key: "nj-get-up",
    title: "Get Up Anniversary 🌙",
    note: "Get Up EP (2023) · Super Shy · ETA · Cool With You",
  },
  {
    m: 5,
    d: 24,
    key: "nj-how-sweet",
    title: "How Sweet Day 🫧",
    note: "How Sweet (2024)",
  },
  {
    m: 6,
    d: 21,
    key: "nj-supernatural",
    title: "Supernatural Day ✨",
    note: "Supernatural (2024)",
  },
];

function seedForYear(year: number): Seed[] {
  const out: Seed[] = [];

  const hk = HK_HOLIDAYS[year];
  if (hk) {
    for (const h of hk) {
      const date = ymd(year, h.m, h.d);
      out.push({
        key: `hk-${h.m}-${h.d}-${h.title.slice(0, 24)}`,
        date,
        title: h.title,
        note: "Hong Kong general holiday",
      });
    }
  }

  for (const s of FIXED_SPECIALS) {
    out.push({
      key: s.key,
      date: ymd(year, s.m, s.d),
      title: s.title,
      note: s.note,
    });
  }

  // Mother’s Day (2nd Sunday of May) · Father’s Day (3rd Sunday of June)
  out.push({
    key: "mothers-day",
    date: nthWeekdayOfMonth(year, 5, 0, 2),
    title: "Mother’s Day 💐",
  });
  out.push({
    key: "fathers-day",
    date: nthWeekdayOfMonth(year, 6, 0, 3),
    title: "Father’s Day 👔",
  });

  for (const b of NJ_BIRTHDAYS) {
    out.push({
      key: b.key,
      date: ymd(year, b.m, b.d),
      title: b.title,
      note: b.note,
    });
  }

  for (const n of NJ_SPECIALS) {
    out.push({
      key: n.key,
      date: ymd(year, n.m, n.d),
      title: n.title,
      note: n.note,
    });
  }

  // User birthday (from Settings) — bunny mark on calendar
  const profile = loadUserProfile();
  if (hasUserBirthday(profile) && profile.birthdayMonth && profile.birthdayDay) {
    const um = profile.birthdayMonth;
    const ud = profile.birthdayDay;
    // Skip invalid dates for short months (e.g. Feb 30)
    const dim = new Date(year, um, 0).getDate();
    if (ud <= dim) {
      out.push({
        key: "user-bday",
        date: ymd(year, um, ud),
        title: `Your Birthday ${USER_BUNNY}`,
        note: "Bunnies celebrate you today!",
      });
    }
  }

  return out;
}

/** Years to seed: current ±1, and any year we have HK tables for. */
function yearsToSeed(now = new Date()): number[] {
  const y = now.getFullYear();
  const set = new Set<number>([y - 1, y, y + 1, 2025, 2026, 2027]);
  return [...set].filter((n) => n >= 2024 && n <= 2030).sort((a, b) => a - b);
}

/**
 * Build default events for nearby years.
 * All-day style marks (no time) · category other.
 */
export function buildDefaultCalendarEvents(now = new Date()): ScheduleEvent[] {
  const createdAt = 1; // stable-ish; older than user events
  const events: ScheduleEvent[] = [];
  for (const year of yearsToSeed(now)) {
    for (const s of seedForYear(year)) {
      events.push({
        id: `${ID_PREFIX}${s.key}:${s.date}`,
        date: s.date,
        title: s.title,
        note: s.note,
        category: "event",
        createdAt,
      });
    }
  }
  return events;
}

/**
 * Merge missing defaults into an existing schedule.
 * Never overwrites user events (only adds by stable default id).
 */
export function mergeDefaultCalendarEvents(
  existing: ScheduleEvent[],
  now = new Date()
): { events: ScheduleEvent[]; added: number } {
  const defaults = buildDefaultCalendarEvents(now);
  const have = new Set(existing.map((e) => e.id));
  // Also skip if user already has same date+title (manual add)
  const haveKey = new Set(
    existing.map(
      (e) => `${e.date}|${e.title.toLowerCase().trim()}`
    )
  );
  const toAdd: ScheduleEvent[] = [];
  for (const d of defaults) {
    if (have.has(d.id)) continue;
    const k = `${d.date}|${d.title.toLowerCase().trim()}`;
    if (haveKey.has(k)) continue;
    toAdd.push(d);
    have.add(d.id);
    haveKey.add(k);
  }
  if (!toAdd.length) return { events: existing, added: 0 };
  return { events: [...existing, ...toAdd], added: toAdd.length };
}

const USER_BDAY_ID_PREFIX = `${ID_PREFIX}user-bday:`;

/**
 * After the user changes their birthday in Settings: drop old bunny marks,
 * re-seed for the new date, persist via caller.
 */
export function resyncUserBirthdayEvents(
  existing: ScheduleEvent[],
  now = new Date()
): ScheduleEvent[] {
  const without = existing.filter((e) => !e.id.startsWith(USER_BDAY_ID_PREFIX));
  return mergeDefaultCalendarEvents(without, now).events;
}

/** NewJeans debut anniversary — every 22 July */
export function isNewJeansDebutDay(monthIndex: number, day: number): boolean {
  return monthIndex + 1 === 7 && day === 22;
}

/**
 * Calendar grid mark for a day.
 * - Member birthday → single color heart emoji
 * - Debut Day (7/22) → five-color NJ gradient heart (rendered in CSS)
 * - User birthday → bunny
 */
export type CalendarDayMark =
  | { kind: "emoji"; value: string; label: string }
  | { kind: "nj-debut-heart"; label: string };

/** True for gazetted Hong Kong general holidays (red date numbers). */
export function isHongKongGeneralHoliday(
  year: number,
  monthIndex: number,
  day: number
): boolean {
  const list = HK_HOLIDAYS[year];
  if (!list) return false;
  const m = monthIndex + 1;
  return list.some((h) => h.m === m && h.d === day);
}

export function calendarDayMark(
  year: number,
  monthIndex: number,
  day: number,
  profile?: UserProfile
): CalendarDayMark | null {
  const heart = newJeansBirthdayHeart(year, monthIndex, day);
  if (heart) {
    return { kind: "emoji", value: heart, label: "NewJeans birthday" };
  }
  if (isNewJeansDebutDay(monthIndex, day)) {
    return {
      kind: "nj-debut-heart",
      label: "NewJeans Debut Day",
    };
  }
  const p = profile ?? loadUserProfile();
  if (p.birthdayMonth == null || p.birthdayDay == null) return null;
  if (monthIndex + 1 !== p.birthdayMonth || day !== p.birthdayDay) return null;
  return { kind: "emoji", value: USER_BUNNY, label: "Your birthday" };
}

/**
 * Calendar grid glyph for a day (emoji only).
 * Debut Day is handled as a CSS heart via `calendarDayMark` (not a single emoji).
 * Fallback star if a plain string is needed: ⭐
 */
export function calendarDayEmoji(
  year: number,
  monthIndex: number,
  day: number,
  profile?: UserProfile
): string | null {
  const mark = calendarDayMark(year, monthIndex, day, profile);
  if (!mark) return null;
  if (mark.kind === "emoji") return mark.value;
  // Debut Day — star fallback for callers that only accept plain text
  return "⭐";
}
