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
export const MAC_WINDOW_IN_MS = 260;
export const MAC_WINDOW_OUT_MS = 160;

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
}: MacWindowShellProps) {
  // Transparent shadow pad around panels must not steal clicks from other apps
  usePanelClickThrough();

  const [phase, setPhase] = useState<Phase>("pre");
  const phaseRef = useRef<Phase>("pre");
  phaseRef.current = phase;

  const exitResolveRef = useRef<(() => void) | null>(null);
  const exitTimerRef = useRef(0);
  /** True from first enter until close finishes — blocks double enter */
  const openSessionRef = useRef(false);
  const enterRafRef = useRef(0);

  const playEnter = useCallback(() => {
    // Already opening or fully open this session → ignore (kills double-open)
    if (openSessionRef.current) return;
    if (phaseRef.current === "in" || phaseRef.current === "idle") return;

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

  // Enter only once when main says the OS window is ready
  useEffect(() => {
    if (!shownEvent) {
      playEnter();
      return;
    }

    let unlisten: (() => void) | undefined;
    let cancelled = false;

    void listen(shownEvent, () => {
      if (cancelled) return;
      playEnter();
    }).then((fn) => {
      if (cancelled) {
        fn();
        return;
      }
      unlisten = fn;
    });

    // If shown-event was missed (webview still booting), enter once — never twice
    const fallback = window.setTimeout(() => {
      if (phaseRef.current === "pre" && !openSessionRef.current) {
        playEnter();
      }
    }, 280);

    return () => {
      cancelled = true;
      unlisten?.();
      window.clearTimeout(fallback);
      if (enterRafRef.current) cancelAnimationFrame(enterRafRef.current);
      if (exitTimerRef.current) window.clearTimeout(exitTimerRef.current);
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
    if (closingRef.current) return;
    closingRef.current = true;
    try {
      await new Promise<void>((resolve) => {
        window.dispatchEvent(
          new CustomEvent("baa-mac-window-exit", { detail: { resolve } })
        );
        window.setTimeout(resolve, MAC_WINDOW_OUT_MS + 50);
      });
      await emitClosed?.();
      try {
        await getCurrentWindow().hide();
      } catch {
        /* ignore */
      }
    } finally {
      window.setTimeout(() => {
        closingRef.current = false;
      }, 40);
    }
  }, [emitClosed]);
}
