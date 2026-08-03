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
export const MAC_WINDOW_IN_MS = 160;
export const MAC_WINDOW_OUT_MS = 120;

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
   * Start enter animation. Pass `force` when main re-shows the OS window so a
   * stuck openSession+pre (opacity 0) never blocks the next open.
   */
  const playEnter = useCallback((force = false) => {
    if (force) {
      openSessionRef.current = false;
      if (exitTimerRef.current) {
        window.clearTimeout(exitTimerRef.current);
        exitTimerRef.current = 0;
      }
      exitResolveRef.current = null;
      if (enterRafRef.current) {
        cancelAnimationFrame(enterRafRef.current);
        enterRafRef.current = 0;
      }
    } else {
      // Fully open already → ignore (kills double-open flash)
      if (phaseRef.current === "in" || phaseRef.current === "idle") {
        if (openSessionRef.current) return;
      }
      // Mid-enter (pre→in rAF) → ignore
      if (openSessionRef.current && phaseRef.current === "pre") return;
      // Mid-exit / stuck pre after hide: allow a fresh enter
      if (phaseRef.current === "out" || !openSessionRef.current) {
        if (exitTimerRef.current) {
          window.clearTimeout(exitTimerRef.current);
          exitTimerRef.current = 0;
        }
        exitResolveRef.current = null;
      }
    }

    openSessionRef.current = true;

    if (enterRafRef.current) {
      cancelAnimationFrame(enterRafRef.current);
      enterRafRef.current = 0;
    }

    // Stay on pre for one frame so the browser commits opacity:0, then animate in
    setPhase("pre");
    phaseRef.current = "pre";
    enterRafRef.current = requestAnimationFrame(() => {
      enterRafRef.current = requestAnimationFrame(() => {
        enterRafRef.current = 0;
        setPhase("in");
        phaseRef.current = "in";
      });
    });
  }, []);

  const playExit = useCallback(() => {
    return new Promise<void>((resolve) => {
      if (phaseRef.current === "pre" || phaseRef.current === "out") {
        openSessionRef.current = false;
        resolve();
        return;
      }

      exitResolveRef.current = () => {
        openSessionRef.current = false;
        resolve();
      };
      setPhase("out");
      phaseRef.current = "out";

      if (exitTimerRef.current) window.clearTimeout(exitTimerRef.current);
      exitTimerRef.current = window.setTimeout(() => {
        const r = exitResolveRef.current;
        exitResolveRef.current = null;
        openSessionRef.current = false;
        exitTimerRef.current = 0;
        r?.();
      }, MAC_WINDOW_OUT_MS + 40);
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

  // Enter when main says the OS window is ready.
  // Always force on shown — hide without exit (or cancelled rAF) can leave
  // openSession+pre, which would keep the panel at opacity 0 forever.
  useEffect(() => {
    if (!shownEvent) {
      playEnter(true);
      return;
    }

    let unlisten: (() => void) | undefined;
    let cancelled = false;

    void listen(shownEvent, () => {
      if (cancelled) return;
      playEnter(true);
    }).then((fn) => {
      if (cancelled) {
        fn();
        return;
      }
      unlisten = fn;
    });

    // If shown-event was missed (webview still booting), enter once
    const fallback = window.setTimeout(() => {
      if (phaseRef.current === "pre" && !openSessionRef.current) {
        playEnter(true);
      }
    }, 280);

    return () => {
      cancelled = true;
      unlisten?.();
      window.clearTimeout(fallback);
      // Cancel pending frames but clear openSession so a later shown can enter.
      // Leaving openSession=true after cancelling rAF was a common stuck path.
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
 * Close helper: play exit animation once, then hide.
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
        window.setTimeout(resolve, MAC_WINDOW_OUT_MS + 50);
      });
      // Hide BEFORE telling main "closed" so a rapid re-open never sees
      // wasVisible=true with opacity-0 (stuck mac-window-pre) and skip enter.
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
