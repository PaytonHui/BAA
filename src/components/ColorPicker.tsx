import {
  LIGHT_COLOR_OPTIONS,
  type LightColorMode,
} from "../lib/lightColors";
import { playClick } from "../lib/sounds";

interface ColorPickerProps {
  open: boolean;
  value: LightColorMode;
  onChange: (mode: LightColorMode) => void;
  onClose: () => void;
  /**
   * NewJeans member birthday lock — show celebration notice,
   * disable all color buttons.
   */
  birthdayLock?: {
    name: string;
    heart: string;
    color: LightColorMode;
  } | null;
}

/**
 * Light color palette — premium iOS glass above the stick.
 */
export function ColorPicker({
  open,
  value,
  onChange,
  onClose,
  birthdayLock = null,
}: ColorPickerProps) {
  if (!open) return null;

  const locked = !!birthdayLock;

  return (
    <div
      className="panel-surface baa-ios-glass relative z-30 w-full max-w-[220px] p-3"
      role="dialog"
      aria-label="Light color"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between mb-3">
        <p className="text-[16px] font-semibold tracking-[-0.02em] text-[#1C1C1E]">
          Light color
        </p>
        <button
          type="button"
          onClick={onClose}
          className="baa-ios-btn text-[15px] font-semibold text-[#007AFF] px-2 py-1 rounded-full hover:bg-black/[0.04]"
        >
          Done
        </button>
      </div>

      {locked && birthdayLock && (
        <div className="mb-3 rounded-[14px] border border-black/[0.06] bg-black/[0.03] px-3 py-2.5">
          <p className="text-[13px] font-semibold text-[#1C1C1E] tracking-[-0.01em]">
            {birthdayLock.heart} {birthdayLock.name}
          </p>
        </div>
      )}

      {/*
        Order matches stick cycle: Cycle, then white → green → purple → blue → orange → yellow.
        4-col grid reads left→right, top→bottom (same sequence).
      */}
      <div
        className={`grid grid-cols-4 gap-2 ${locked ? "opacity-45 pointer-events-none" : ""}`}
        aria-disabled={locked || undefined}
      >
        {LIGHT_COLOR_OPTIONS.filter((o) => o.id !== "off").map((opt) => {
          const selected = value === opt.id;
          const isCycle = opt.id === "cycle";
          return (
            <button
              key={opt.id}
              type="button"
              disabled={locked}
              onClick={() => {
                if (locked) return;
                playClick();
                onChange(opt.id);
              }}
              className={`baa-ios-btn flex flex-col items-center gap-1 rounded-[14px] p-1.5 transition ${
                selected
                  ? "bg-[#007AFF]/12 ring-2 ring-[#007AFF]/45"
                  : "hover:bg-black/[0.04]"
              } ${locked ? "cursor-not-allowed" : ""}`}
            >
              <span
                className={`block w-7 h-7 rounded-full border-2 ${
                  selected ? "border-white" : "border-white/50"
                }`}
                style={{
                  background: opt.swatch,
                  boxShadow: selected
                    ? `0 0 12px ${isCycle ? "#007aff88" : opt.swatch}`
                    : "0 1px 3px rgba(0,0,0,0.12)",
                }}
                aria-hidden
              />
              <span className="text-[9px] font-semibold leading-none text-[#3A3A3C]">
                {opt.label}
              </span>
            </button>
          );
        })}
      </div>

      <button
        type="button"
        disabled={locked}
        onClick={() => {
          if (locked) return;
          playClick();
          onChange("off");
        }}
        className={`baa-ios-btn mt-3 w-full flex items-center justify-center gap-2 rounded-[14px] py-2.5 text-[13px] font-semibold transition ${
          value === "off"
            ? "bg-[#007AFF]/12 text-[#007AFF] ring-2 ring-[#007AFF]/35"
            : "bg-black/[0.05] text-[#1C1C1E] hover:bg-black/[0.08]"
        } ${locked ? "opacity-45 cursor-not-allowed pointer-events-none" : ""}`}
      >
        <span
          className="inline-block w-3.5 h-3.5 rounded-full border border-black/15 bg-[#E8ECF2]"
          aria-hidden
        />
        {value === "off" ? "Light off" : "Turn off light"}
      </button>
    </div>
  );
}
