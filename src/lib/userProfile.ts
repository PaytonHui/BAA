/**
 * User profile prefs — birthday + favorite NewJeans member.
 * Stored in localStorage (survives relaunch with the rest of BAA UI prefs).
 */

import type { LightColorMode } from "./lightColors";

export type FavMemberId =
  | "minji"
  | "hanni"
  | "danielle"
  | "haerin"
  | "hyein";

export interface FavMemberMeta {
  id: FavMemberId;
  name: string;
  heart: string;
  color: Exclude<LightColorMode, "cycle" | "off" | "white">;
}

export const FAV_MEMBERS: FavMemberMeta[] = [
  { id: "minji", name: "Minji", heart: "💙", color: "blue" },
  { id: "hanni", name: "Hanni", heart: "🧡", color: "orange" },
  { id: "danielle", name: "Danielle", heart: "💛", color: "yellow" },
  { id: "haerin", name: "Haerin", heart: "💚", color: "green" },
  { id: "hyein", name: "Hyein", heart: "💜", color: "purple" },
];

export const USER_BUNNY = "🐰";

export interface UserProfile {
  /** Month 1–12, or null if not set */
  birthdayMonth: number | null;
  /** Day 1–31, or null if not set */
  birthdayDay: number | null;
  favMember: FavMemberId | null;
}

const STORAGE_KEY = "baa-user-profile-v1";

const DEFAULT_PROFILE: UserProfile = {
  birthdayMonth: null,
  birthdayDay: null,
  favMember: null,
};

function clampDay(month: number, day: number): number {
  const max = new Date(2024, month, 0).getDate(); // 2024 leap-safe for Feb 29
  return Math.min(Math.max(1, day), max);
}

export function loadUserProfile(): UserProfile {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PROFILE };
    const o = JSON.parse(raw) as Partial<UserProfile>;
    const month =
      typeof o.birthdayMonth === "number" &&
      o.birthdayMonth >= 1 &&
      o.birthdayMonth <= 12
        ? o.birthdayMonth
        : null;
    let day =
      typeof o.birthdayDay === "number" && o.birthdayDay >= 1 && o.birthdayDay <= 31
        ? o.birthdayDay
        : null;
    if (month != null && day != null) day = clampDay(month, day);
    const fav =
      o.favMember && FAV_MEMBERS.some((m) => m.id === o.favMember)
        ? o.favMember
        : null;
    return {
      birthdayMonth: month,
      birthdayDay: day,
      favMember: fav,
    };
  } catch {
    return { ...DEFAULT_PROFILE };
  }
}

export function saveUserProfile(profile: UserProfile) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  } catch {
    /* ignore */
  }
}

export function favMemberMeta(
  id: FavMemberId | null | undefined
): FavMemberMeta | null {
  if (!id) return null;
  return FAV_MEMBERS.find((m) => m.id === id) ?? null;
}

/** True if profile has a complete birthday (month + day). */
export function hasUserBirthday(p: UserProfile = loadUserProfile()): boolean {
  return p.birthdayMonth != null && p.birthdayDay != null;
}

/** Live user birthday day — bunny party, fav-member color (no color lock). */
export interface UserBirthdayToday {
  kind: "user";
  month: number;
  day: number;
  /** Always bunny for user */
  emoji: string;
  /** Fav member color for LED tint (optional — falls back to white) */
  color: Exclude<LightColorMode, "cycle" | "off" | "white"> | null;
  favName: string | null;
  title: string;
}

export function getUserBirthdayToday(
  d = new Date(),
  profile: UserProfile = loadUserProfile()
): UserBirthdayToday | null {
  if (profile.birthdayMonth == null || profile.birthdayDay == null) return null;
  const m = d.getMonth() + 1;
  const day = d.getDate();
  if (m !== profile.birthdayMonth || day !== profile.birthdayDay) return null;
  const fav = favMemberMeta(profile.favMember);
  return {
    kind: "user",
    month: profile.birthdayMonth,
    day: profile.birthdayDay,
    emoji: USER_BUNNY,
    color: fav?.color ?? null,
    favName: fav?.name ?? null,
    title: "Your Birthday 🐰",
  };
}

/** Bunny on calendar grid for the user’s birthday (any year). */
export function userBirthdayEmoji(
  _year: number,
  monthIndex: number,
  day: number,
  profile: UserProfile = loadUserProfile()
): string | null {
  if (profile.birthdayMonth == null || profile.birthdayDay == null) return null;
  if (monthIndex + 1 !== profile.birthdayMonth) return null;
  if (day !== profile.birthdayDay) return null;
  return USER_BUNNY;
}

export function userBirthdayCareLines(b: UserBirthdayToday): Array<{
  text: string;
  emoji: string;
}> {
  const favBit = b.favName
    ? ` Your fave is ${b.favName}${b.color ? "" : ""}!`
    : "";
  return [
    {
      emoji: USER_BUNNY,
      text: `Happy birthday! 🐰 Bunnies are celebrating you today!${favBit}`,
    },
    {
      emoji: "🎂",
      text: `It’s your day! 🐰 Blow out the candles — Binky is so happy for you!`,
    },
    {
      emoji: USER_BUNNY,
      text: b.favName
        ? `Birthday bunny mode 🐰 Stick glows ${b.favName}’s color for you!`
        : `Birthday bunny mode 🐰 Have the cutest day!`,
    },
  ];
}
