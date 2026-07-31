/**
 * iPhone Alarm–style scroll wheels for picking a time.
 * Columns: hour (1–12) · minute (00–59) · AM/PM
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type UIEvent,
} from "react";

/** Full picker (standalone); compact = 3 rows for calendar composer */
function wheelMetrics(compact: boolean) {
  const itemH = compact ? 28 : 32;
  const visible = compact ? 3 : 5; // odd — selection sits in the middle row
  const pad = Math.floor(visible / 2) * itemH;
  const wheelH = visible * itemH;
  return { itemH, visible, pad, wheelH };
}

const HOURS = Array.from({ length: 12 }, (_, i) => i + 1);
const MINUTES = Array.from({ length: 60 }, (_, i) => i);
const PERIODS = ["AM", "PM"] as const;
type Period = (typeof PERIODS)[number];

export function parseHhmm(raw: string | undefined): {
  hour12: number;
  minute: number;
  period: Period;
} | null {
  if (!raw?.trim()) return null;
  const m = raw.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (h > 23 || min > 59 || Number.isNaN(h) || Number.isNaN(min)) return null;
  const period: Period = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return { hour12: h, minute: min, period };
}

export function toHhmm(
  hour12: number,
  minute: number,
  period: Period
): string {
  let h = hour12 % 12;
  if (period === "PM") h += 12;
  // 12 AM → 0, 12 PM → 12
  if (period === "AM" && hour12 === 12) h = 0;
  if (period === "PM" && hour12 === 12) h = 12;
  return `${String(h).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function formatDisplay(hhmm: string): string {
  const p = parseHhmm(hhmm);
  if (!p) return "—";
  return `${p.hour12}:${String(p.minute).padStart(2, "0")} ${p.period}`;
}

/** One snap column (hour / minute / ampm) */
function WheelColumn<T extends string | number>({
  items,
  value,
  onChange,
  label,
  format = (v) => String(v),
  itemH,
  pad,
  wheelH,
}: {
  items: readonly T[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  format?: (v: T) => string;
  itemH: number;
  pad: number;
  wheelH: number;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const lockRef = useRef(false);
  const endTimer = useRef(0);

  const indexOf = useCallback(
    (v: T) => {
      const i = items.indexOf(v);
      return i >= 0 ? i : 0;
    },
    [items]
  );

  // Sync scroll position when value changes from outside
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const idx = indexOf(value);
    const top = idx * itemH;
    if (Math.abs(el.scrollTop - top) > 1) {
      lockRef.current = true;
      el.scrollTop = top;
      requestAnimationFrame(() => {
        lockRef.current = false;
      });
    }
  }, [value, indexOf, itemH]);

  const snapToNearest = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const idx = Math.round(el.scrollTop / itemH);
    const clamped = Math.max(0, Math.min(items.length - 1, idx));
    const top = clamped * itemH;
    el.scrollTo({ top, behavior: "smooth" });
    const next = items[clamped];
    if (next !== value) onChange(next);
  }, [items, onChange, value, itemH]);

  const onScroll = (e: UIEvent<HTMLDivElement>) => {
    if (lockRef.current) return;
    if (endTimer.current) window.clearTimeout(endTimer.current);
    endTimer.current = window.setTimeout(() => {
      snapToNearest();
    }, 80);

    // Live update while scrolling (feels like Alarm)
    const el = e.currentTarget;
    const idx = Math.round(el.scrollTop / itemH);
    const clamped = Math.max(0, Math.min(items.length - 1, idx));
    const next = items[clamped];
    if (next !== value) onChange(next);
  };

  return (
    <div
      className="relative flex-1 min-w-0 select-none"
      role="listbox"
      aria-label={label}
    >
      <div
        ref={scrollerRef}
        onScroll={onScroll}
        className="h-full overflow-y-auto overscroll-contain snap-y snap-mandatory ios-time-wheel"
        style={{
          height: wheelH,
          WebkitOverflowScrolling: "touch",
          scrollbarWidth: "none",
          msOverflowStyle: "none",
        }}
      >
        <div style={{ height: pad }} aria-hidden />
        {items.map((item) => {
          const selected = item === value;
          return (
            <div
              key={String(item)}
              role="option"
              aria-selected={selected}
              className={`snap-center flex items-center justify-center font-semibold tabular-nums transition-colors ${
                selected
                  ? "text-neutral-900 text-[16px]"
                  : "text-neutral-400 text-[14px]"
              }`}
              style={{ height: itemH }}
              onClick={() => {
                onChange(item);
                const el = scrollerRef.current;
                if (el) {
                  el.scrollTo({
                    top: indexOf(item) * itemH,
                    behavior: "smooth",
                  });
                }
              }}
            >
              {format(item)}
            </div>
          );
        })}
        <div style={{ height: pad }} aria-hidden />
      </div>
    </div>
  );
}

export interface IosTimePickerProps {
  /** 24h "HH:mm" or empty = no time */
  value: string;
  onChange: (hhmm: string) => void;
  /** Compact for the calendar bottom sheet */
  compact?: boolean;
  /** Left toggle label when time is set */
  onLabel?: string;
  /** Left toggle label when time is cleared */
  offLabel?: string;
  /** Right side when cleared (default "All day") */
  emptyDisplay?: string;
}

export function IosTimePicker({
  value,
  onChange,
  compact = false,
  onLabel = "Time on",
  offLabel = "No time",
  emptyDisplay = "All day",
}: IosTimePickerProps) {
  const { itemH, pad, wheelH } = useMemo(
    () => wheelMetrics(compact),
    [compact]
  );
  const parsed = useMemo(() => parseHhmm(value), [value]);
  const enabled = !!parsed;

  // Local wheel state — default 9:00 AM when enabling
  const [hour12, setHour12] = useState(parsed?.hour12 ?? 9);
  const [minute, setMinute] = useState(parsed?.minute ?? 0);
  const [period, setPeriod] = useState<Period>(parsed?.period ?? "AM");

  // Keep wheels in sync when parent value changes
  useEffect(() => {
    if (parsed) {
      setHour12(parsed.hour12);
      setMinute(parsed.minute);
      setPeriod(parsed.period);
    }
  }, [parsed?.hour12, parsed?.minute, parsed?.period]);

  const emit = useCallback(
    (h: number, m: number, p: Period) => {
      onChange(toHhmm(h, m, p));
    },
    [onChange]
  );

  const setEnabled = (on: boolean) => {
    if (on) {
      const h = hour12;
      const m = minute;
      const p = period;
      emit(h, m, p);
    } else {
      onChange("");
    }
  };

  const wheelProps = { itemH, pad, wheelH };

  return (
    <div className="w-full">
      <div className="flex items-center justify-between gap-2 mb-1 px-0.5">
        <button
          type="button"
          onClick={() => setEnabled(!enabled)}
          className={`h-7 px-2.5 rounded-full text-[11px] font-semibold border transition-colors cursor-pointer ${
            enabled
              ? "bg-[#007AFF]/12 text-[#007AFF] border-[#007AFF]/35"
              : "bg-[#F7F7F8] text-neutral-500 border-neutral-200"
          }`}
        >
          {enabled ? onLabel : offLabel}
        </button>
        <span className="text-[12px] font-semibold tabular-nums text-neutral-800">
          {enabled
            ? formatDisplay(toHhmm(hour12, minute, period))
            : emptyDisplay}
        </span>
      </div>

      <div
        className={`relative rounded-2xl overflow-hidden border transition-opacity ${
          enabled
            ? "border-neutral-200/90 bg-[#F2F2F7] opacity-100"
            : "border-neutral-100 bg-[#F7F7F8] opacity-45 pointer-events-none"
        }`}
        style={{ height: wheelH }}
        aria-disabled={!enabled}
      >
        {/* Selection band (iOS style) */}
        <div
          className="pointer-events-none absolute left-2 right-2 rounded-[10px] bg-white/90 border border-black/[0.04] shadow-[0_0.5px_0_rgba(0,0,0,0.04)] z-[1]"
          style={{
            top: pad,
            height: itemH,
          }}
        />
        {/* Fade masks */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-6 z-[2] bg-gradient-to-b from-[#F2F2F7] to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-6 z-[2] bg-gradient-to-t from-[#F2F2F7] to-transparent" />

        <div className="relative z-[3] flex h-full px-1">
          <WheelColumn
            label="Hour"
            items={HOURS}
            value={hour12}
            {...wheelProps}
            onChange={(h) => {
              setHour12(h);
              if (enabled) emit(h, minute, period);
            }}
          />
          <div className="flex items-center text-neutral-400 font-bold text-[16px] pb-0.5">
            :
          </div>
          <WheelColumn
            label="Minute"
            items={MINUTES}
            value={minute}
            format={(m) => String(m).padStart(2, "0")}
            {...wheelProps}
            onChange={(m) => {
              setMinute(m);
              if (enabled) emit(hour12, m, period);
            }}
          />
          <WheelColumn
            label="AM/PM"
            items={PERIODS}
            value={period}
            {...wheelProps}
            onChange={(p) => {
              setPeriod(p);
              if (enabled) emit(hour12, minute, p);
            }}
          />
        </div>
      </div>
    </div>
  );
}
