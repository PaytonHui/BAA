import { useEffect, useRef } from "react";
import {
  cursorPosition,
  getCurrentWindow,
} from "@tauri-apps/api/window";
import { PANEL_SHADOW_PAD } from "../lib/windowLayout";

/**
 * Click-through for floating panel windows.
 * Transparent padding (for drop-shadows) must not block other apps —
 * only the inset panel content captures the mouse.
 */
export function usePanelClickThrough(opts?: {
  /** Logical px inset matching panel shell padding (default PANEL_SHADOW_PAD) */
  pad?: number;
  /** Force full-window hits (rare) */
  forceInteractive?: boolean;
}) {
  const pad = opts?.pad ?? PANEL_SHADOW_PAD;
  const forceRef = useRef(!!opts?.forceInteractive);
  forceRef.current = !!opts?.forceInteractive;

  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    const win = getCurrentWindow();
    let ignoreState: boolean | null = null;

    const setIgnore = async (ignore: boolean) => {
      if (ignoreState === ignore) return;
      ignoreState = ignore;
      try {
        await win.setIgnoreCursorEvents(ignore);
      } catch {
        /* browser / no permission */
      }
    };

    // Default: pass clicks through until cursor is over the real panel
    void setIgnore(true);

    const tick = async () => {
      if (cancelled) return;
      try {
        if (forceRef.current) {
          await setIgnore(false);
        } else {
          const [cursor, pos, scale, size] = await Promise.all([
            cursorPosition(),
            win.outerPosition(),
            win.scaleFactor(),
            win.outerSize(),
          ]);
          const lx = (cursor.x - pos.x) / scale;
          const ly = (cursor.y - pos.y) / scale;
          const w = size.width / scale;
          const h = size.height / scale;

          // Content rect = window minus transparent shadow padding
          const over =
            lx >= pad &&
            lx <= w - pad &&
            ly >= pad &&
            ly <= h - pad;

          await setIgnore(!over);
        }
      } catch {
        /* ignore frame errors */
      }
      if (!cancelled) {
        timer = window.setTimeout(() => {
          void tick();
        }, 20);
      }
    };

    void tick();

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      ignoreState = null;
      void win.setIgnoreCursorEvents(false).catch(() => undefined);
    };
  }, [pad]);
}
