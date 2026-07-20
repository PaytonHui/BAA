/**
 * Physiological care bubbles for Binky.
 *
 * Intervals follow common wellness guidance:
 * - Eyes: 20-20-20 rule (AOA) — every 20 min look 20 ft away for 20 s
 * - Water: sip regularly through the day; desk reminders ~every 45 min
 *   (spread ~8 cups over waking hours ≈ 45–60 min)
 * - Move / stretch: stand or stretch every 30–40 min when sitting
 * - Posture: similar cadence to movement breaks
 * - Breath / blink: gentle resets between longer breaks
 * - Meals: time-of-day windows (not every N minutes)
 * - Sleep: evening / late-night only
 *
 * Weather + schedule remain separate high-priority overlays.
 */

import type { WeatherSnapshot } from "./weather";
import {
  weatherIsCold,
  weatherIsHot,
  weatherNeedsUmbrella,
} from "./weather";

export type CareKind =
  | "greeting"
  | "care"
  | "cheer"
  | "birthday"
  | "schedule"
  | "weather"
  | "hydrate"
  | "eyes"
  | "move"
  | "posture"
  | "meal"
  | "breath"
  | "sleep";

/** Physiological need used for interval scheduling */
export type CareNeed =
  | "hydrate"
  | "eyes"
  | "move"
  | "posture"
  | "meal"
  | "breath"
  | "sleep";

export interface CareLine {
  text: string;
  kind: CareKind;
  /** Leading emoji shown in the bubble */
  emoji: string;
  /** Interval bucket (physiological only) */
  need?: CareNeed;
}

/** Local hour 0–23 */
export function hourNow(d = new Date()): number {
  return d.getHours();
}

export type DayPart = "morning" | "afternoon" | "evening" | "night";

export function dayPart(h = hourNow()): DayPart {
  if (h >= 5 && h < 12) return "morning";
  if (h >= 12 && h < 17) return "afternoon";
  if (h >= 17 && h < 22) return "evening";
  return "night";
}

/**
 * Target gap between same-need reminders (ms).
 * Research-aligned defaults for desk work.
 */
export const CARE_NEED_INTERVAL_MS: Record<CareNeed, number> = {
  /** 20-20-20: rest eyes every 20 minutes */
  eyes: 20 * 60 * 1000,
  /** Hydration: sip regularly — ~every 45 min at a desk */
  hydrate: 45 * 60 * 1000,
  /** Stand / stretch every ~35 min (30–40 min guidance) */
  move: 35 * 60 * 1000,
  /** Posture reset roughly with movement cadence */
  posture: 40 * 60 * 1000,
  /** Soft breath / blink between bigger breaks */
  breath: 50 * 60 * 1000,
  /** Meal checks only in meal windows (see mealDue) */
  meal: 2.5 * 60 * 60 * 1000,
  /** Late-night rest nudges (night only) */
  sleep: 50 * 60 * 1000,
};

/** Priority when several needs are overdue (higher first) */
const NEED_PRIORITY: CareNeed[] = [
  "eyes",
  "hydrate",
  "move",
  "posture",
  "breath",
  "meal",
  "sleep",
];

const HYDRATE: CareLine[] = [
  {
    kind: "hydrate",
    need: "hydrate",
    emoji: "💧",
    text: "Water break! A small sip keeps you glowing.",
  },
  {
    kind: "hydrate",
    need: "hydrate",
    emoji: "🧃",
    text: "Hydration check~ Drink a little water for me?",
  },
  {
    kind: "hydrate",
    need: "hydrate",
    emoji: "🚰",
    text: "Time for water! Desk brain needs H₂O too.",
  },
  {
    kind: "hydrate",
    need: "hydrate",
    emoji: "💦",
    text: "Sip break! Even a few swallows count.",
  },
];

const EYES: CareLine[] = [
  {
    kind: "eyes",
    need: "eyes",
    emoji: "👀",
    text: "20-20-20! Look 20 ft away for 20 seconds.",
  },
  {
    kind: "eyes",
    need: "eyes",
    emoji: "👁️",
    text: "Eye rest~ Soft focus on something far away.",
  },
  {
    kind: "eyes",
    need: "eyes",
    emoji: "🪟",
    text: "Screen break! Gaze out a window for 20 seconds.",
  },
  {
    kind: "eyes",
    need: "eyes",
    emoji: "😌",
    text: "Blink slow… then look far. Protect those eyes!",
  },
];

const MOVE: CareLine[] = [
  {
    kind: "move",
    need: "move",
    emoji: "🤸",
    text: "Stand & stretch! 30–40 min sit → move a little.",
  },
  {
    kind: "move",
    need: "move",
    emoji: "🚶",
    text: "Body break~ Stand up or walk a few steps!",
  },
  {
    kind: "move",
    need: "move",
    emoji: "🦵",
    text: "Legs awake? Quick stretch for circulation.",
  },
  {
    kind: "move",
    need: "move",
    emoji: "🧍",
    text: "Up for 1–2 minutes! Your back will thank you.",
  },
];

const POSTURE: CareLine[] = [
  {
    kind: "posture",
    need: "posture",
    emoji: "✨",
    text: "Posture check! Sit tall like a lightstick.",
  },
  {
    kind: "posture",
    need: "posture",
    emoji: "🪑",
    text: "Shoulders down, screen at eye height~",
  },
  {
    kind: "posture",
    need: "posture",
    emoji: "📏",
    text: "Spine reset! Un-hunch for a few breaths.",
  },
  {
    kind: "posture",
    need: "posture",
    emoji: "🖱️",
    text: "Hands soft? Unclench that mouse grip.",
  },
];

const BREATH: CareLine[] = [
  {
    kind: "breath",
    need: "breath",
    emoji: "🌬️",
    text: "Deep breath in… and out. Soft reset.",
  },
  {
    kind: "breath",
    need: "breath",
    emoji: "🧘",
    text: "One quiet minute. Breathe with me.",
  },
  {
    kind: "breath",
    need: "breath",
    emoji: "😮‍💨",
    text: "Slow exhale~ Drop the shoulder tension.",
  },
];

const MEAL: CareLine[] = [
  {
    kind: "meal",
    need: "meal",
    emoji: "🍙",
    text: "Fuel check! Have you eaten something real?",
  },
  {
    kind: "meal",
    need: "meal",
    emoji: "🥗",
    text: "Don't skip meals, Bunny. Body needs energy.",
  },
  {
    kind: "meal",
    need: "meal",
    emoji: "🍪",
    text: "Snack or lunch? Tiny nourishment break?",
  },
];

const SLEEP: CareLine[] = [
  {
    kind: "sleep",
    need: "sleep",
    emoji: "💤",
    text: "It's late… rest soon so eyes can recover.",
  },
  {
    kind: "sleep",
    need: "sleep",
    emoji: "🌙",
    text: "Night mode: softer lights, wind down soon.",
  },
  {
    kind: "sleep",
    need: "sleep",
    emoji: "🛏️",
    text: "Sleep is recovery. Bed before the sun?",
  },
];

const LINES_BY_NEED: Record<CareNeed, CareLine[]> = {
  hydrate: HYDRATE,
  eyes: EYES,
  move: MOVE,
  posture: POSTURE,
  breath: BREATH,
  meal: MEAL,
  sleep: SLEEP,
};

function pickRandom<T extends CareLine>(arr: T[], avoid?: string): T {
  if (arr.length === 1) return arr[0];
  let choice = arr[Math.floor(Math.random() * arr.length)];
  if (avoid && arr.length > 1) {
    let guard = 0;
    while (choice.text === avoid && guard++ < 8) {
      choice = arr[Math.floor(Math.random() * arr.length)];
    }
  }
  return choice;
}

/** Meal windows by local hour */
function mealWindowActive(h = hourNow()): boolean {
  // breakfast / lunch / dinner-ish
  if (h >= 7 && h <= 9) return true;
  if (h >= 11 && h <= 14) return true;
  if (h >= 17 && h <= 20) return true;
  return false;
}

function sleepWindowActive(h = hourNow()): boolean {
  return h >= 22 || h < 5;
}

const LAST_NEED_KEY = "baa-care-need-last-v2";
const LAST_ANY_KEY = "baa-care-last-any-v2";

/** Minimum gap between any two care bubbles (prevents spam when many needs are overdue) */
export const MIN_CARE_GAP_MS = 3 * 60 * 1000;

export type CareNeedLastMap = Partial<Record<CareNeed, number>>;

export function loadCareNeedLast(): CareNeedLastMap {
  try {
    const raw = localStorage.getItem(LAST_NEED_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as CareNeedLastMap;
  } catch {
    return {};
  }
}

export function saveCareNeedLast(map: CareNeedLastMap) {
  try {
    localStorage.setItem(LAST_NEED_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

function loadLastAnyCare(): number {
  try {
    const n = Number(localStorage.getItem(LAST_ANY_KEY));
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

function saveLastAnyCare(at: number) {
  try {
    localStorage.setItem(LAST_ANY_KEY, String(at));
  } catch {
    /* ignore */
  }
}

export function markCareNeedShown(need: CareNeed, at = Date.now()) {
  const map = loadCareNeedLast();
  map[need] = at;
  saveCareNeedLast(map);
  saveLastAnyCare(at);
}

/**
 * Pick the most overdue physiological need (at most one).
 * Respects min gap since last bubble so they don't chain every few seconds.
 */
export function pickDueCareNeed(now = Date.now()): CareNeed | null {
  const last = loadCareNeedLast();
  ensureSessionSeed(last, now);

  // Hard cooldown between bubbles
  const lastAny = loadLastAnyCare();
  if (lastAny && now - lastAny < MIN_CARE_GAP_MS) return null;

  let best: CareNeed | null = null;
  let bestOver = -1;

  for (const need of NEED_PRIORITY) {
    const h = hourNow();
    if (need === "meal" && !mealWindowActive(h)) continue;
    if (need === "sleep" && !sleepWindowActive(h)) continue;

    const interval = CARE_NEED_INTERVAL_MS[need];
    const lastAt = last[need] ?? 0;
    if (!lastAt) continue;
    const over = now - lastAt - interval;
    if (over >= 0 && over > bestOver) {
      bestOver = over;
      best = need;
    }
  }
  return best;
}

/** Seed “last shown” so first due times are staggered after open */
function ensureSessionSeed(last: CareNeedLastMap, now: number) {
  let changed = false;
  // First due offsets from open — spread out, not a cascade
  const seeds: Record<CareNeed, number> = {
    eyes: 2 * 60_000,
    hydrate: 8 * 60_000,
    move: 15 * 60_000,
    posture: 22 * 60_000,
    breath: 30 * 60_000,
    meal: 25 * 60_000,
    sleep: 40 * 60_000,
  };
  for (const need of NEED_PRIORITY) {
    if (last[need] == null) {
      const delay = seeds[need];
      last[need] = now - CARE_NEED_INTERVAL_MS[need] + delay;
      changed = true;
    }
  }
  if (changed) saveCareNeedLast(last);
}

/** Ms until the next physiological need is due (never under min gap) */
export function nextPhysioCareDelayMs(now = Date.now()): number {
  const last = loadCareNeedLast();
  ensureSessionSeed(last, now);

  let soonest = 20 * 60_000; // default if nothing scheduled

  for (const need of NEED_PRIORITY) {
    const h = hourNow();
    if (need === "meal" && !mealWindowActive(h)) continue;
    if (need === "sleep" && !sleepWindowActive(h)) continue;
    const lastAt = last[need] ?? now;
    const dueAt = lastAt + CARE_NEED_INTERVAL_MS[need];
    const wait = Math.max(0, dueAt - now);
    if (wait < soonest) soonest = wait;
  }

  // Enforce quiet period after the last bubble
  const lastAny = loadLastAnyCare();
  const gapLeft = lastAny
    ? Math.max(0, lastAny + MIN_CARE_GAP_MS - now)
    : 0;

  // At least 1 min even if something is overdue (catch-up slowly)
  const delay = Math.max(soonest, gapLeft, 60_000);
  return delay + Math.floor(Math.random() * 5_000);
}

export function lineForNeed(need: CareNeed, avoid?: string): CareLine {
  return pickRandom(LINES_BY_NEED[need], avoid);
}

/** Build weather-aware care lines from a live snapshot.
 * Every line includes the user's local temperature (°C).
 */
export function weatherCareLines(w: WeatherSnapshot): CareLine[] {
  const t = Math.round(w.tempC);
  const placeName = w.place?.split(",")[0]?.trim() || "";
  // e.g. " in Hong Kong · 26°C" or " · 26°C"
  const where = placeName ? ` in ${placeName}` : "";
  const temp = `${t}°C`;
  const at = placeName ? `${where} · ${temp}` : ` · ${temp}`;
  const lines: CareLine[] = [];

  if (weatherNeedsUmbrella(w)) {
    if (w.kind === "storm") {
      lines.push({
        kind: "weather",
        emoji: "⛈️",
        text: `Stormy${at}! Grab an umbrella — and stay safe out there.`,
      });
      lines.push({
        kind: "weather",
        emoji: "☔",
        text: `Thunder${at}. Umbrella + maybe skip the long walk?`,
      });
    } else if (w.kind === "snow") {
      lines.push({
        kind: "weather",
        emoji: "❄️",
        text: `Snow${at}! Coat, boots, and careful steps~`,
      });
    } else if (w.kind === "drizzle") {
      lines.push({
        kind: "weather",
        emoji: "🌦️",
        text: `Light rain${at}. A small umbrella won't hurt!`,
      });
      lines.push({
        kind: "weather",
        emoji: "☂️",
        text: `Drizzle outside${at} — pocket umbrella check?`,
      });
    } else {
      lines.push({
        kind: "weather",
        emoji: "☔",
        text: `Rain${at}! Don't forget your umbrella, Bunny.`,
      });
      lines.push({
        kind: "weather",
        emoji: "🌧️",
        text: `It's wet out${at}. Umbrella before you go!`,
      });
      lines.push({
        kind: "weather",
        emoji: "🌂",
        text: `Binky weather alert: rain${at}. Bring that umbrella!`,
      });
    }
  }

  if (weatherIsHot(w)) {
    lines.push({
      kind: "weather",
      emoji: "🥵",
      text: `Hot${at}! Water + sunscreen if you head out.`,
    });
    lines.push({
      kind: "weather",
      emoji: "☀️",
      text: `Heat${at}. Stay cool and hydrated!`,
    });
  }

  if (weatherIsCold(w)) {
    lines.push({
      kind: "weather",
      emoji: "🧥",
      text: `Chilly${at}. Jacket check before you leave!`,
    });
    lines.push({
      kind: "weather",
      emoji: "🧣",
      text: `Cold snap${at}! Bundle up a little for me~`,
    });
  }

  if (w.kind === "fog") {
    lines.push({
      kind: "weather",
      emoji: "🌫️",
      text: `Foggy${at}. Go slow if you're commuting!`,
    });
  }

  if (w.kind === "clear" && t >= 18 && t < 30) {
    lines.push({
      kind: "weather",
      emoji: "🌤️",
      text: `Nice clear sky${at}. Good day for a short walk!`,
    });
  }

  if (w.kind === "cloudy" && !weatherNeedsUmbrella(w)) {
    lines.push({
      kind: "weather",
      emoji: "☁️",
      text: `Cloudy${at}. Soft light day — still bring a light layer?`,
    });
  }

  if (!lines.length) {
    lines.push({
      kind: "weather",
      emoji: "🌡️",
      text: placeName
        ? `It's ${temp}${where} right now. Dress comfy!`
        : `It's about ${temp} right now. Dress comfy!`,
    });
  }

  return lines;
}

/**
 * Pick a care line from physiological needs + optional weather / schedule.
 * Returns null when nothing is due (caller should wait, not invent a bubble).
 */
export function pickCareLine(opts?: {
  avoidText?: string;
  scheduleTitles?: string[];
  weather?: WeatherSnapshot | null;
  /** Prefer weather tips (e.g. Mac wake / rain) */
  preferWeather?: boolean;
}): CareLine | null {
  const titles = opts?.scheduleTitles?.filter(Boolean) ?? [];
  const weather = opts?.weather ?? null;
  const wLines = weather ? weatherCareLines(weather) : [];

  // High priority: weather when forced / strongly relevant
  if (weather && wLines.length) {
    const urgent =
      weatherNeedsUmbrella(weather) ||
      weatherIsHot(weather) ||
      weatherIsCold(weather);
    const p = opts?.preferWeather ? 0.95 : urgent ? 0.28 : 0.08;
    if (Math.random() < p) {
      return pickRandom(wLines, opts?.avoidText);
    }
  }

  // Calendar mention stays rare
  if (titles.length && Math.random() < 0.1) {
    const t = titles[Math.floor(Math.random() * titles.length)];
    const short = t.length > 28 ? t.slice(0, 26) + "…" : t;
    return {
      kind: "schedule",
      emoji: "📅",
      text: `Reminder: “${short}” is on your calendar!`,
    };
  }

  // Only show when a physiological need is actually due
  const due = pickDueCareNeed();
  if (due) {
    return lineForNeed(due, opts?.avoidText);
  }

  return null;
}

/**
 * Next idle delay until a physio reminder is due.
 * First check ~15s after open (first eye tip ~2 min from seed).
 */
export function nextCareDelayMs(isFirst: boolean): number {
  if (isFirst) return 15_000;
  return nextPhysioCareDelayMs();
}

/** How long the bubble stays visible */
export const CARE_BUBBLE_MS = 8_000;

/** How long weather FX (sun/rain/snow…) stays on the pet */
export const WEATHER_FX_MS = 8_000;

/** Retry soon when pet is busy (chat/menu open, etc.) */
export function careBusyRetryMs(): number {
  return 8_000 + Math.random() * 7_000;
}
