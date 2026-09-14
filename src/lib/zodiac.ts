/**
 * Western tropical zodiac from birthday (month + day, no year).
 * Daily horoscope lines are seeded by sign + local date so the same
 * care bubble shows all day.
 */

export type ZodiacSign =
  | "aries"
  | "taurus"
  | "gemini"
  | "cancer"
  | "leo"
  | "virgo"
  | "libra"
  | "scorpio"
  | "sagittarius"
  | "capricorn"
  | "aquarius"
  | "pisces";

export interface ZodiacMeta {
  id: ZodiacSign;
  name: string;
  glyph: string;
  /** Care-bubble leading emoji */
  emoji: string;
}

export const ZODIAC_META: Record<ZodiacSign, ZodiacMeta> = {
  aries: { id: "aries", name: "Aries", glyph: "♈", emoji: "♈" },
  taurus: { id: "taurus", name: "Taurus", glyph: "♉", emoji: "♉" },
  gemini: { id: "gemini", name: "Gemini", glyph: "♊", emoji: "♊" },
  cancer: { id: "cancer", name: "Cancer", glyph: "♋", emoji: "♋" },
  leo: { id: "leo", name: "Leo", glyph: "♌", emoji: "♌" },
  virgo: { id: "virgo", name: "Virgo", glyph: "♍", emoji: "♍" },
  libra: { id: "libra", name: "Libra", glyph: "♎", emoji: "♎" },
  scorpio: { id: "scorpio", name: "Scorpio", glyph: "♏", emoji: "♏" },
  sagittarius: { id: "sagittarius", name: "Sagittarius", glyph: "♐", emoji: "♐" },
  capricorn: { id: "capricorn", name: "Capricorn", glyph: "♑", emoji: "♑" },
  aquarius: { id: "aquarius", name: "Aquarius", glyph: "♒", emoji: "♒" },
  pisces: { id: "pisces", name: "Pisces", glyph: "♓", emoji: "♓" },
};

/** Inclusive month-day ranges (month 1–12). Capricorn wraps the year. */
const RANGES: Array<{ sign: ZodiacSign; start: [number, number]; end: [number, number] }> =
  [
    { sign: "capricorn", start: [12, 22], end: [1, 19] },
    { sign: "aquarius", start: [1, 20], end: [2, 18] },
    { sign: "pisces", start: [2, 19], end: [3, 20] },
    { sign: "aries", start: [3, 21], end: [4, 19] },
    { sign: "taurus", start: [4, 20], end: [5, 20] },
    { sign: "gemini", start: [5, 21], end: [6, 20] },
    { sign: "cancer", start: [6, 21], end: [7, 22] },
    { sign: "leo", start: [7, 23], end: [8, 22] },
    { sign: "virgo", start: [8, 23], end: [9, 22] },
    { sign: "libra", start: [9, 23], end: [10, 22] },
    { sign: "scorpio", start: [10, 23], end: [11, 21] },
    { sign: "sagittarius", start: [11, 22], end: [12, 21] },
  ];

function md(month: number, day: number): number {
  return month * 100 + day;
}

export function zodiacFromBirthday(month: number, day: number): ZodiacSign {
  const n = md(month, day);
  for (const r of RANGES) {
    const a = md(r.start[0], r.start[1]);
    const b = md(r.end[0], r.end[1]);
    if (a > b) {
      // wraps year (Capricorn)
      if (n >= a || n <= b) return r.sign;
    } else if (n >= a && n <= b) {
      return r.sign;
    }
  }
  return "capricorn";
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function seed(sign: ZodiacSign, d: Date): number {
  const key = `${sign}:${dayKey(d)}`;
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const LINES: Record<ZodiacSign, string[]> = {
  aries: [
    "Go first on the thing you’ve been circling. Then sip water — fire still needs fuel.",
    "A bold yes today beats a perfect maybe. Stretch your legs before you charge.",
    "Start small, start now. Your spark is loud; keep your neck unclenched.",
    "Someone will match your pace if you show it. Drink, then dash.",
  ],
  taurus: [
    "Slow is still moving. Make one cozy choice and protect it.",
    "Comfort is a strategy today — eat on time, skip the extra hassle.",
    "Steady wins. Finish the one task that makes tomorrow lighter.",
    "Treat your body like a garden: water, rest, no rushing the bloom.",
  ],
  gemini: [
    "Two ideas, one step. Pick a lane for an hour, then chat.",
    "A message you’ve been drafting wants out. Send it, then blink at the window.",
    "Curiosity is your superpower — don’t let it scatter your water bottle.",
    "Talk it out, then stand up. Your brain likes air as much as words.",
  ],
  cancer: [
    "Home-base energy. Check on someone you love, including you.",
    "Soft day, strong heart. A tiny ritual (tea, playlist) steadies you.",
    "If you feel waves, that’s weather, not failure. Breathe, then reply.",
    "Nest a little. Clear one corner, drink water, let the rest wait.",
  ],
  leo: [
    "Main-character lighting is on. Share the win, then rest the roar.",
    "Warmth you give comes back. Stand tall — posture is part of the look.",
    "A spotlight moment wants you ready, not exhausted. Pace it.",
    "Glow, don’t overheat. Water, stretch, then take the compliment.",
  ],
  virgo: [
    "One tidy fix beats a full overhaul. Start with the smallest mess.",
    "Your eye for detail is a gift — don’t spend it all on worry.",
    "Check the list, then check your shoulders. They’re not a hanger.",
    "Done is kinder than perfect today. Sip, tick one box, smile.",
  ],
  libra: [
    "Balance isn’t 50/50 — it’s a breath between yes and no.",
    "A fair ask is allowed. Say it nicely, then look 20 feet away.",
    "Beauty in the small: a walk, a snack, a kind text.",
    "Don’t referee everyone. Pick peace, drink water, keep your charm.",
  ],
  scorpio: [
    "Go deep on one thing, not twelve. Intensity likes a lid.",
    "Trust your read — then rest your eyes so they stay sharp.",
    "A secret plan is fine. Hydrate like it’s part of the plot.",
    "Feel it fully, then move your body so it doesn’t get stuck.",
  ],
  sagittarius: [
    "Horizon energy. A short outing counts as an adventure.",
    "Say the honest thing with a grin. Then actually eat lunch.",
    "Luck likes motion. Walk the long way once today.",
    "Big picture, small sip. Don’t skip the boring fuel.",
  ],
  capricorn: [
    "Climb one rung, not the whole ladder. That’s still ambition.",
    "Structure is kindness today. Set an end time and keep it.",
    "Your future self wants you hydrated and in bed on time.",
    "Quiet competence wins. Stretch the spine that carries it.",
  ],
  aquarius: [
    "Weird idea? Keep it. The room needs your angle.",
    "People, then pause. You’re not a wifi router — unplug a bit.",
    "Invent a tiny shortcut. Then look out a real window.",
    "Future-you is cheering. Water now, revolution later.",
  ],
  pisces: [
    "Dream, then one earthly step. Both count.",
    "Feelings are data. Write one down, drink, let the rest float.",
    "Soft focus is allowed. Music on, shoulders down.",
    "A kind scene is waiting if you leave a little space for it.",
  ],
};

export interface DailyHoroscope {
  sign: ZodiacSign;
  name: string;
  glyph: string;
  emoji: string;
  text: string;
}

export function dailyHoroscope(
  sign: ZodiacSign,
  d = new Date()
): DailyHoroscope {
  const meta = ZODIAC_META[sign];
  const lines = LINES[sign];
  const line = lines[seed(sign, d) % lines.length];
  return {
    sign,
    name: meta.name,
    glyph: meta.glyph,
    emoji: meta.emoji,
    text: `${meta.glyph} ${meta.name} — ${line}`,
  };
}
