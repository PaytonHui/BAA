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
 *
 * IMPORTANT: default to interactive. Starting with ignore=true makes chat/login
 * unclickable on macOS until the first successful cursor poll (often broken when
 * the window is newly shown / focused). Chat must always receive clicks.
 */
export function usePanelClickThrough(opts?: {
  /** Logical px inset matching panel shell padding (default PANEL_SHADOW_PAD) */
  pad?: number;
  /**
   * Keep the whole window interactive (recommended for chat / login / settings).
   * Default true — click-through pad is nice-to-have; broken input is not.
   */
  forceInteractive?: boolean;
}) {
  const pad = opts?.pad ?? PANEL_SHADOW_PAD;
  // Default ON so chatbox/inputs always work
  const forceRef = useRef(opts?.forceInteractive !== false);
  forceRef.current = opts?.forceInteractive !== false;

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

    // Always start interactive so the first click reaches the chatbox
    void setIgnore(false);

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

          // Slightly smaller pad than visual shadow so edges stay clickable
          const hitPad = Math.max(4, pad - 6);
          const over =
            lx >= hitPad &&
            lx <= w - hitPad &&
            ly >= hitPad &&
            ly <= h - hitPad;

          await setIgnore(!over);
        }
      } catch {
        // On any error, stay interactive rather than locking the panel out
        await setIgnore(false);
      }
      if (!cancelled) {
        timer = window.setTimeout(() => {
          void tick();
        }, 32);
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
