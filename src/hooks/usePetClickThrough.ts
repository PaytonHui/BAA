import { useEffect, useRef } from "react";
import {
  cursorPosition,
  getCurrentWindow,
} from "@tauri-apps/api/window";

/**
 * Pass mouse clicks through the transparent pet window except over the stick
 * (and the care bubble strip when open). CSS pointer-events alone cannot
 * pierce the native macOS window — need setIgnoreCursorEvents.
 */
export function usePetClickThrough(opts: {
  petW: number;
  petH: number;
  petScale: number;
  careStripOpen: boolean;
  carePanelW: number;
  dragging: boolean;
  /** Keep window fully interactive (e.g. temporary UI on main) */
  forceInteractive?: boolean;
}) {
  const ignoreRef = useRef<boolean | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    const win = getCurrentWindow();

    const setIgnore = async (ignore: boolean) => {
      if (ignoreRef.current === ignore) return;
      ignoreRef.current = ignore;
      try {
        await win.setIgnoreCursorEvents(ignore);
      } catch {
        /* browser / no permission */
      }
    };

    // Default: empty glass does not block other apps
    void setIgnore(true);

    const tick = async () => {
      if (cancelled) return;
      try {
        const o = optsRef.current;
        if (o.forceInteractive || o.dragging) {
          await setIgnore(false);
        } else {
          const [cursor, pos, scale] = await Promise.all([
            cursorPosition(),
            win.outerPosition(),
            win.scaleFactor(),
          ]);
          // Local logical coords inside the window
          const lx = (cursor.x - pos.x) / scale;
          const ly = (cursor.y - pos.y) / scale;

          const s = Math.min(1.85, Math.max(0.65, o.petScale || 1));
          // Match Lightstick3D pet-hit (tight stick silhouette)
          const hitW = 42 * s;
          const hitH = 150 * s;
          const hitLeft = (o.petW - hitW) / 2;
          const hitTop = (o.petH - hitH) / 2;

          let over =
            lx >= hitLeft &&
            lx <= hitLeft + hitW &&
            ly >= hitTop &&
            ly <= hitTop + hitH;

          // Care bubble strip sits to the right of the pet column
          if (
            !over &&
            o.careStripOpen &&
            lx >= o.petW - 6 &&
            lx <= o.petW + o.carePanelW + 4 &&
            ly >= 0 &&
            ly <= o.petH
          ) {
            over = true;
          }

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
      ignoreRef.current = null;
      void win.setIgnoreCursorEvents(false).catch(() => undefined);
    };
  }, []);
}
