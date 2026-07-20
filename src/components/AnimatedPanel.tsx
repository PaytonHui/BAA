import { useEffect, useState, type ReactNode } from "react";

export type PanelOrigin = "bottom" | "center" | "right" | "left";

interface AnimatedPanelProps {
  /** When true, mount and play enter. When false, play exit then unmount. */
  open: boolean;
  /** Transform origin for zoom (from pet / from side). */
  origin?: PanelOrigin;
  className?: string;
  children: ReactNode;
  /** Called after exit animation finishes (and unmount). */
  onExited?: () => void;
}

/**
 * Zoom + fade presence wrapper for chat / calendar / menu / color panels.
 */
export function AnimatedPanel({
  open,
  origin = "bottom",
  className = "",
  children,
  onExited,
}: AnimatedPanelProps) {
  const [mounted, setMounted] = useState(open);
  const [phase, setPhase] = useState<"in" | "out">(open ? "in" : "out");

  useEffect(() => {
    if (open) {
      setMounted(true);
      // Double-rAF so the browser applies the initial keyframe state
      let id2 = 0;
      const id1 = requestAnimationFrame(() => {
        id2 = requestAnimationFrame(() => setPhase("in"));
      });
      return () => {
        cancelAnimationFrame(id1);
        cancelAnimationFrame(id2);
      };
    }
    // Closing: only exit if we were showing
    if (mounted) {
      setPhase("out");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to `open`
  }, [open]);

  if (!mounted) return null;

  return (
    <div
      className={`panel-anim panel-anim-${phase} panel-origin-${origin} ${className}`}
      onAnimationEnd={(e) => {
        // Only handle our own animation (not children)
        if (e.target !== e.currentTarget) return;
        if (phase === "out" && !open) {
          setMounted(false);
          onExited?.();
        }
      }}
    >
      {children}
    </div>
  );
}

/** Duration must match CSS `--panel-anim-ms` (keep in sync). */
export const PANEL_ANIM_MS = 280;

export function sleep(ms: number) {
  return new Promise<void>((r) => window.setTimeout(r, ms));
}
