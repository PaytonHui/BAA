import { useEffect, useMemo, useState } from "react";
import type { CareKind } from "../lib/careMessages";
import type { BubbleSide } from "../lib/windowLayout";
import type { FortuneScore, FortuneScores } from "../lib/zodiac";

interface CareBubbleProps {
  text: string;
  kind?: CareKind;
  emoji?: string;
  /** Sign name for horoscope bubbles (glyph stays in the leading emoji). */
  title?: string;
  scores?: FortuneScores;
  visible: boolean;
  onDismiss: () => void;
  /**
   * Layout mode:
   * - "overlay" (default): absolute over pet (legacy)
   * - "strip": fills the care strip (preferred — no clip)
   */
  layout?: "overlay" | "strip";
  /** Which side of the stick the strip sits on */
  side?: BubbleSide;
}

const KIND_FALLBACK: Record<CareKind, string> = {
  greeting: "💬",
  care: "✨",
  cheer: "💗",
  birthday: "🎂",
  horoscope: "✨",
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

const FORTUNE_METERS: Array<{
  key: keyof FortuneScores;
  icon: string;
  label: string;
  tint: string;
}> = [
  { key: "overall", icon: "🍀", label: "Overall", tint: "#5B9A3C" },
  { key: "love", icon: "💗", label: "Love", tint: "#D45A6A" },
  { key: "career", icon: "💼", label: "Work", tint: "#4A7FD4" },
  { key: "wealth", icon: "💰", label: "Money", tint: "#D4922A" },
];

function StarPips({ score, tint }: { score: FortuneScore; tint: string }) {
  return (
    <span className="care-wa-stars" style={{ color: tint }}>
      {Array.from({ length: 5 }, (_, i) => (
        <span
          key={i}
          className={i < score ? "care-wa-star on" : "care-wa-star off"}
        >
          ★
        </span>
      ))}
    </span>
  );
}

function FortuneMeters({ scores }: { scores: FortuneScores }) {
  return (
    <span className="care-wa-fortune" aria-hidden>
      {FORTUNE_METERS.map((m) => (
        <span key={m.key} className="care-wa-fortune-item">
          <span className="care-wa-fortune-icon">{m.icon}</span>
          <StarPips score={scores[m.key]} tint={m.tint} />
        </span>
      ))}
    </span>
  );
}

function horoscopeAria(
  text: string,
  title?: string,
  scores?: FortuneScores
): string {
  if (!scores) {
    return title ? `Binky says: ${title}. ${text}` : `Binky says: ${text}`;
  }
  const bits = FORTUNE_METERS.map(
    (m) => `${m.label} ${scores[m.key]} of 5`
  ).join(", ");
  const head = title ? `${title} horoscope. ` : "";
  return `Binky says: ${head}${bits}. ${text}`;
}

/**
 * Manga + early WhatsApp green speech bubble.
 * Use layout="strip" so the full message fits after window expand.
 */
export function CareBubble({
  text,
  kind = "care",
  emoji,
  title,
  scores,
  visible,
  onDismiss,
  layout = "overlay",
  side = "right",
}: CareBubbleProps) {
  const [phase, setPhase] = useState<"in" | "out">("in");
  const face = emoji || KIND_FALLBACK[kind];
  const isHoroscope = kind === "horoscope";

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

  const stripSide =
    side === "left" ? "care-wa-strip-left" : "care-wa-strip-right";
  const posClass =
    layout === "strip"
      ? `care-wa care-wa-strip ${stripSide} relative z-30 w-auto max-w-full text-left cursor-pointer border-0 p-0 bg-transparent`
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
      aria-label={horoscopeAria(text, title, scores)}
      data-kind={kind}
    >
      <span className={`care-wa-bubble${isHoroscope ? " care-wa-bubble-horo" : ""}`}>
        <span className="care-wa-row">
          <span className="care-wa-emoji" aria-hidden>
            {face}
          </span>
          <span className="care-wa-text">
            {isHoroscope && title ? (
              <span className="care-wa-horo-name">{title}</span>
            ) : null}
            {isHoroscope && scores ? <FortuneMeters scores={scores} /> : null}
            {text}
          </span>
        </span>
        <span className="care-wa-meta">
          <span className="care-wa-time">{timeStr}</span>
        </span>
      </span>
      {layout === "overlay" && (
        <span className="care-wa-tail-left" aria-hidden />
      )}
      {layout === "strip" && side === "right" && (
        <span className="care-wa-tail-left care-wa-tail-strip" aria-hidden />
      )}
      {layout === "strip" && side === "left" && (
        <span className="care-wa-tail-right care-wa-tail-strip" aria-hidden />
      )}
    </button>
  );
}
