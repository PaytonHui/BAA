/** Light / dark panels. Each Tauri webview has its own copy of this module. */

import { listen } from "@tauri-apps/api/event";

const THEME_KEY = "baa-theme";

function storedDark(): boolean {
  try {
    return (
      typeof localStorage !== "undefined" &&
      localStorage.getItem(THEME_KEY) === "dark"
    );
  } catch {
    return false;
  }
}

/** Paint the current document. Call before React so the first frame matches. */
export function applyTheme(dark: boolean) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.baaTheme = dark ? "dark" : "light";
}

export function isDark() {
  return storedDark();
}

export function setDark(dark: boolean) {
  try {
    localStorage.setItem(THEME_KEY, dark ? "dark" : "light");
  } catch {
    /* ignore */
  }
  applyTheme(dark);
}

export function toggleDark() {
  const next = !storedDark();
  setDark(next);
  return next;
}

export function handleThemeChanged(
  payload: { dark?: boolean } | null | undefined
) {
  if (typeof payload?.dark === "boolean") setDark(payload.dark);
}

/**
 * Other windows do not share this module's memory. The event carries the
 * new value; localStorage is the fallback if a window opens later.
 */
export function installThemeSync() {
  if (typeof window === "undefined") return;
  const host = window as Window & {
    __baaThemeSync?: boolean;
    __TAURI_INTERNALS__?: object;
  };
  if (host.__baaThemeSync) return;
  if (!host.__TAURI_INTERNALS__) return;
  host.__baaThemeSync = true;
  void listen<{ dark?: boolean }>("theme-changed", (ev) => {
    handleThemeChanged(ev.payload);
  }).catch(() => {
    host.__baaThemeSync = false;
  });
}

applyTheme(storedDark());
