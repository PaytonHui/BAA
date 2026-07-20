import { useEffect, useMemo, useState } from "react";
import type { CareKind } from "../lib/careMessages";

interface CareBubbleProps {
  text: string;
  kind?: CareKind;
  emoji?: string;
  visible: boolean;
  onDismiss: () => void;
  /**
   * Layout mode:
   * - "overlay" (default): absolute over pet (legacy)
   * - "strip": fills the right care strip (preferred — no clip)
   */
  layout?: "overlay" | "strip";
}

const KIND_FALLBACK: Record<CareKind, string> = {
  greeting: "💬",
  care: "✨",
  cheer: "💗",
  birthday: "🎂",
  schedule: "📅",
  weather: "☔",
  hydrate: "💧",
  eyes: "👀",
  move: "🤸",
  posture: "✨",
  meal: "🍙",
  breath: "🌬️",
  sleep: "💤",
};

/**
 * Manga + early WhatsApp green speech bubble.
 * Use layout="strip" so the full message fits after window expand.
 */
export function CareBubble({
  text,
  kind = "care",
  emoji,
  visible,
  onDismiss,
  layout = "overlay",
}: CareBubbleProps) {
  const [phase, setPhase] = useState<"in" | "out">("in");
  const face = emoji || KIND_FALLBACK[kind];

  useEffect(() => {
    setPhase(visible ? "in" : "out");
  }, [visible]);

  const timeStr = useMemo(() => {
    const d = new Date();
    let h = d.getHours();
    const m = d.getMinutes().toString().padStart(2, "0");
    const ampm = h >= 12 ? "PM" : "AM";
    h = h % 12 || 12;
    return `${h}:${m} ${ampm}`;
  }, [text]);

  const posClass =
    layout === "strip"
      ? "care-wa care-wa-strip relative z-30 w-auto max-w-full text-left cursor-pointer border-0 p-0 bg-transparent"
      : `care-wa care-wa-${phase} care-wa-right absolute z-30 left-[calc(50%+38px)] top-[30%] w-[156px] text-left cursor-pointer border-0 p-0 bg-transparent`;

  return (
    <button
      type="button"
      className={`${posClass} care-wa-${phase}`}
      onClick={(e) => {
        e.stopPropagation();
        onDismiss();
      }}
      onPointerDown={(e) => e.stopPropagation()}
      aria-label={`Binky says: ${text}`}
      data-kind={kind}
    >
      <span className="care-wa-bubble">
        <span className="care-wa-row">
          <span className="care-wa-emoji" aria-hidden>
            {face}
          </span>
          <span className="care-wa-text">{text}</span>
        </span>
        <span className="care-wa-meta">
          <span className="care-wa-time">{timeStr}</span>
        </span>
      </span>
      {layout === "overlay" && (
        <span className="care-wa-tail-left" aria-hidden />
      )}
      {layout === "strip" && (
        <span className="care-wa-tail-left care-wa-tail-strip" aria-hidden />
      )}
    </button>
  );
}
