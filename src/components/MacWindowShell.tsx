import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { usePanelClickThrough } from "../hooks/usePanelClickThrough";

/** Keep in sync with CSS --mac-window-in-ms / --mac-window-out-ms */
export const MAC_WINDOW_IN_MS = 0; // open is instant (no fade lag)
/** Instant close — exit fade left a ghost/afterimage on transparent macOS windows */
export const MAC_WINDOW_OUT_MS = 0;

export function sleep(ms: number) {
  return new Promise<void>((r) => window.setTimeout(r, ms));
}

type Phase = "pre" | "in" | "idle" | "out";

interface MacWindowShellProps {
  children: ReactNode;
  className?: string;
  /**
   * Fired by main after the native window is shown at its final position.
   * Enter animation starts only on this event (one shot per open).
   */
  shownEvent?: string;
  surfaceClassName?: string;
  /**
   * When true (default), the whole panel window receives mouse events.
   * Chat/login must stay interactive — click-through padding broke the chatbox.
   */
  forceInteractive?: boolean;
}

/**
 * Smooth open/close for floating panels.
 * One enter per open — never restarts mid-animation (avoids “opens twice”).
 */
export function MacWindowShell({
  children,
  className = "",
  shownEvent,
  surfaceClassName = "",
  forceInteractive = true,
}: MacWindowShellProps) {
  // Panels default to fully interactive so inputs/buttons always work
  usePanelClickThrough({ forceInteractive });

  // Re-assert hit-testing when the OS window is shown (macOS can leave
  // ignore-cursor stuck after hide/show cycles).
  useEffect(() => {
    if (!shownEvent) return;
    let unlisten: (() => void) | undefined;
    void listen(shownEvent, () => {
      void getCurrentWindow()
        .setIgnoreCursorEvents(false)
        .catch(() => undefined);
      void getCurrentWindow()
        .setFocus()
        .catch(() => undefined);
    }).then((fn) => {
      unlisten = fn;
    });
    // Also clear on mount
    void getCurrentWindow()
      .setIgnoreCursorEvents(false)
      .catch(() => undefined);
    return () => unlisten?.();
  }, [shownEvent]);

  const [phase, setPhase] = useState<Phase>("pre");
  const phaseRef = useRef<Phase>("pre");
  phaseRef.current = phase;

  const exitResolveRef = useRef<(() => void) | null>(null);
  const exitTimerRef = useRef(0);
  /** True from first enter until close finishes — blocks double enter */
  const openSessionRef = useRef(false);
  const enterRafRef = useRef(0);

  /**
   * Reveal content after OS window is already shown at final place.
   * Start from `pre` (fully blank) for one frame so macOS never flashes the
   * previous paint (afterimage), then snap to idle.
   */
  const playEnter = useCallback((force = false) => {
    if (!force) {
      if (
        openSessionRef.current &&
        (phaseRef.current === "in" || phaseRef.current === "idle")
      ) {
        return;
      }
    }

    if (exitTimerRef.current) {
      window.clearTimeout(exitTimerRef.current);
      exitTimerRef.current = 0;
    }
    exitResolveRef.current = null;
    if (enterRafRef.current) {
      cancelAnimationFrame(enterRafRef.current);
      enterRafRef.current = 0;
    }

    openSessionRef.current = true;
    // Blank first (kills stale buffer), then show next frame
    setPhase("pre");
    phaseRef.current = "pre";
    enterRafRef.current = requestAnimationFrame(() => {
      enterRafRef.current = requestAnimationFrame(() => {
        enterRafRef.current = 0;
        setPhase("idle");
        phaseRef.current = "idle";
      });
    });
  }, []);

  const playExit = useCallback(() => {
    return new Promise<void>((resolve) => {
      // Instant blank — no fade (fade left a translucent afterimage on macOS)
      if (exitTimerRef.current) {
        window.clearTimeout(exitTimerRef.current);
        exitTimerRef.current = 0;
      }
      exitResolveRef.current = null;
      openSessionRef.current = false;
      setPhase("pre");
      phaseRef.current = "pre";
      // One frame so opacity:0 / visibility paint before OS hide
      requestAnimationFrame(() => resolve());
    });
  }, []);

  // Expose exit for useMacWindowClose
  useEffect(() => {
    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent<{ resolve: () => void }>).detail;
      void playExit().then(() => detail?.resolve?.());
    };
    window.addEventListener("baa-mac-window-exit", handler);
    return () => window.removeEventListener("baa-mac-window-exit", handler);
  }, [playExit]);

  // Enter when main says the OS window is ready (or once on mount).
  useEffect(() => {
    if (!shownEvent) {
      playEnter(true);
      return;
    }

    const prepareEvent = shownEvent.replace(/-shown$/, "-prepare");
    const unsubs: Array<() => void> = [];
    let cancelled = false;

    void listen(prepareEvent, () => {
      if (cancelled) return;
      if (enterRafRef.current) {
        cancelAnimationFrame(enterRafRef.current);
        enterRafRef.current = 0;
      }
      openSessionRef.current = false;
      setPhase("pre");
      phaseRef.current = "pre";
    }).then((fn) => {
      if (cancelled) fn();
      else unsubs.push(fn);
    });

    void listen(shownEvent, () => {
      if (cancelled) return;
      playEnter(true);
    }).then((fn) => {
      if (cancelled) fn();
      else unsubs.push(fn);
    });

    // Boot safety: only if still blank (missed shown while mounting)
    const fallback = window.setTimeout(() => {
      if (phaseRef.current === "pre" && !openSessionRef.current) {
        playEnter(true);
      }
    }, 180);

    return () => {
      cancelled = true;
      unsubs.forEach((u) => u());
      window.clearTimeout(fallback);
      if (enterRafRef.current) {
        cancelAnimationFrame(enterRafRef.current);
        enterRafRef.current = 0;
      }
      if (exitTimerRef.current) window.clearTimeout(exitTimerRef.current);
      if (phaseRef.current === "pre") {
        openSessionRef.current = false;
      }
    };
  }, [shownEvent, playEnter]);

  const onAnimationEnd = (e: React.AnimationEvent) => {
    if (e.target !== e.currentTarget) return;
    if (phaseRef.current === "out") {
      const r = exitResolveRef.current;
      exitResolveRef.current = null;
      if (exitTimerRef.current) {
        window.clearTimeout(exitTimerRef.current);
        exitTimerRef.current = 0;
      }
      openSessionRef.current = false;
      setPhase("pre");
      phaseRef.current = "pre";
      r?.();
    } else if (phaseRef.current === "in") {
      setPhase("idle");
      phaseRef.current = "idle";
    }
  };

  const phaseClass =
    phase === "pre"
      ? "mac-window-pre"
      : phase === "in"
        ? "mac-window-in"
        : phase === "out"
          ? "mac-window-out"
          : "mac-window-idle";

  return (
    <div className={`mac-window-root w-full h-full box-border ${className}`}>
      <div
        className={`mac-window-surface ${phaseClass} ${surfaceClassName}`}
        onAnimationEnd={onAnimationEnd}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * Close helper: blank content (no fade), then hide OS window.
 * Blank-before-hide is what prevents open afterimage on transparent macOS webviews.
 */
export function useMacWindowClose(emitClosed?: () => Promise<void> | void) {
  const closingRef = useRef(false);

  return useCallback(async () => {
    // Allow re-entry if a previous close stalled mid-flight
    if (closingRef.current) {
      try {
        await getCurrentWindow().hide();
      } catch {
        /* ignore */
      }
      await emitClosed?.();
      return;
    }
    closingRef.current = true;
    try {
      await new Promise<void>((resolve) => {
        window.dispatchEvent(
          new CustomEvent("baa-mac-window-exit", { detail: { resolve } })
        );
        // Fallback if shell isn't listening
        window.setTimeout(resolve, 48);
      });
      try {
        await getCurrentWindow().hide();
      } catch {
        /* ignore */
      }
      await emitClosed?.();
    } finally {
      window.setTimeout(() => {
        closingRef.current = false;
      }, 40);
    }
  }, [emitClosed]);
}
