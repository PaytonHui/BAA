import { useEffect, useMemo, useRef, useState } from "react";
import { calendarDayMark } from "../lib/defaultCalendar";
import { IosTimePicker } from "./IosTimePicker";
import { resizeCalendarForComposer } from "../lib/panelWindow";
import {
  CATEGORY_META,
  SCHEDULE_CATEGORIES,
  addMinutesToHhmm,
  buildMonthGrid,
  categoriesByDate,
  eventCategory,
  eventsOnDate,
  formatTimeRange,
  hhmmToMinutes,
  monthLabel,
  toDateKey,
  todayKey,
  type ScheduleCategory,
  type ScheduleEvent,
} from "../lib/schedule";

export type ManualScheduleInput = {
  date: string;
  title: string;
  time?: string;
  endTime?: string;
  note?: string;
  category: ScheduleCategory;
};

interface CalendarPanelProps {
  open: boolean;
  events: ScheduleEvent[];
  large?: boolean;
  onToggleSize?: () => void;
  onRemove: (id: string) => void;
  onClose: () => void;
  /** Show “+ Add plan” composer for manual schedule create */
  allowManualCreate?: boolean;
  onAdd?: (input: ManualScheduleInput) => void;
  /** Update an existing plan (edit from context menu) */
  onUpdate?: (id: string, input: ManualScheduleInput) => void;
}

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function defaultHalfHourTime(): string {
  const n = new Date();
  let h = n.getHours();
  let m = n.getMinutes();
  if (m < 30) m = 30;
  else {
    m = 0;
    h = (h + 1) % 24;
  }
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Phoning-style calendar — view day plans + optional manual add / edit.
 */
export function CalendarPanel({
  open: _open,
  events,
  large = false,
  onToggleSize,
  onRemove,
  onClose,
  allowManualCreate = false,
  onAdd,
  onUpdate,
}: CalendarPanelProps) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [selected, setSelected] = useState(todayKey());
  const [title, setTitle] = useState("");
  const [time, setTime] = useState(defaultHalfHourTime);
  const [endTime, setEndTime] = useState(() =>
    addMinutesToHhmm(defaultHalfHourTime(), 60)
  );
  /** Which wheel is active in the composer */
  const [timeTab, setTimeTab] = useState<"start" | "end">("start");
  const [category, setCategory] = useState<ScheduleCategory>("event");
  const [formError, setFormError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  /** When set, form is editing this event id */
  const [editingId, setEditingId] = useState<string | null>(null);
  /** Right-click menu on a plan bubble */
  const [ctxMenu, setCtxMenu] = useState<{
    id: string;
    x: number;
    y: number;
  } | null>(null);
  /** Outer card — measure real height so OS window has no white under-strip */
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setFormError(null);
  }, [selected]);

  // Size OS window to the measured card (not a fixed oversized height)
  useEffect(() => {
    const el = panelRef.current;
    const apply = () => {
      const h = el?.getBoundingClientRect().height;
      void resizeCalendarForComposer(addOpen, large, h).catch(() => undefined);
    };
    apply();
    // After layout / time-wheel paint
    const t1 = window.setTimeout(apply, 50);
    const t2 = window.setTimeout(apply, 200);
    let ro: ResizeObserver | null = null;
    if (el && typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => apply());
      ro.observe(el);
    }
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      ro?.disconnect();
    };
  }, [addOpen, large]);

  // Tell parent whether composer is open (via custom event — no prop drill)
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("baa-cal-form-open", { detail: { open: addOpen } })
    );
  }, [addOpen]);

  // Close context menu on outside click / escape
  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("click", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [ctxMenu]);

  const catsByDate = useMemo(() => categoriesByDate(events), [events]);
  const grid = useMemo(() => buildMonthGrid(year, month), [year, month]);
  const dayEvents = useMemo(
    () => eventsOnDate(events, selected),
    [events, selected]
  );

  const resetForm = (keepTime = true) => {
    setTitle("");
    if (!keepTime) {
      const start = defaultHalfHourTime();
      setTime(start);
      setEndTime(addMinutesToHhmm(start, 60));
    }
    setTimeTab("start");
    setCategory("event");
    setFormError(null);
    setEditingId(null);
  };

  const openAdd = () => {
    const start = defaultHalfHourTime();
    setTitle("");
    setTime(start);
    setEndTime(addMinutesToHhmm(start, 60));
    setTimeTab("start");
    setCategory("event");
    setEditingId(null);
    setAddOpen(true);
    setFormError(null);
    setCtxMenu(null);
  };

  const openEdit = (ev: ScheduleEvent) => {
    setSelected(ev.date);
    setTitle(ev.title);
    const start = ev.time?.trim() || "";
    setTime(start);
    setEndTime(
      ev.endTime?.trim() ||
        (start ? addMinutesToHhmm(start, 60) : "")
    );
    setTimeTab("start");
    setCategory(eventCategory(ev));
    setEditingId(ev.id);
    setAddOpen(true);
    setFormError(null);
    setCtxMenu(null);
    // Jump month to the event if needed
    try {
      const [y, m] = ev.date.split("-").map(Number);
      setYear(y);
      setMonth(m - 1);
    } catch {
      /* ignore */
    }
  };

  const submitManual = (e?: React.FormEvent | React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    const t = title.trim();
    if (!t) {
      setFormError("Add a title");
      return;
    }
    const start = time.trim() || undefined;
    let end = endTime.trim() || undefined;
    // End without start → drop end; end before/equal start → reject
    if (end && !start) end = undefined;
    if (start && end) {
      const a = hhmmToMinutes(start);
      const b = hhmmToMinutes(end);
      if (a != null && b != null && b <= a) {
        setFormError("End time must be after start time");
        setTimeTab("end");
        return;
      }
    }
    const payload: ManualScheduleInput = {
      date: selected,
      title: t,
      time: start,
      endTime: end,
      category,
    };
    try {
      if (editingId && onUpdate) {
        onUpdate(editingId, payload);
      } else if (onAdd) {
        onAdd(payload);
      } else {
        setFormError("Add plan is unavailable — reopen Calendar");
        return;
      }
      resetForm(true);
      setAddOpen(false);
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : "Could not save plan"
      );
    }
  };

  const onStartTimeChange = (hhmm: string) => {
    setTime(hhmm);
    setFormError(null);
    if (!hhmm) {
      // All-day: clear end as well
      setEndTime("");
      return;
    }
    // Keep a sensible end (at least 30m after start)
    const startM = hhmmToMinutes(hhmm);
    const endM = hhmmToMinutes(endTime);
    if (startM != null && (endM == null || endM <= startM)) {
      setEndTime(addMinutesToHhmm(hhmm, 60));
    }
  };

  const onEndTimeChange = (hhmm: string) => {
    setEndTime(hhmm);
    setFormError(null);
  };

  const prevMonth = () => {
    if (month === 0) {
      setMonth(11);
      setYear((y) => y - 1);
    } else setMonth((m) => m - 1);
  };
  const nextMonth = () => {
    if (month === 11) {
      setMonth(0);
      setYear((y) => y + 1);
    } else setMonth((m) => m + 1);
  };

  const selectedLabel = (() => {
    try {
      const [y, m, d] = selected.split("-").map(Number);
      return new Date(y, m - 1, d).toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
      });
    } catch {
      return selected;
    }
  })();

  // Always height:auto so the card hugs content — never stretch white into empty OS chrome
  const panelW = large ? "w-[360px]" : "w-[280px]";
  // Slightly tighter grid when form is open so composer has room
  const dayH = addOpen
    ? large
      ? "h-7"
      : "h-6"
    : large
      ? "h-11"
      : "h-8";
  const dayText = large ? "text-[12px]" : "text-[10px]";

  return (
    <div
      ref={panelRef}
      className={`panel-surface relative ${panelW} max-w-full h-auto flex flex-col rounded-[26px] overflow-hidden shadow-none border-0 bg-[#F7F7F8]`}
      onContextMenu={(e) => {
        // Block WKWebView “Reload” menu on empty chrome; event cards handle their own
        if (!(e.target as HTMLElement).closest?.("[data-plan-card]")) {
          e.preventDefault();
        }
      }}
    >
      {/* —— Same top bar as chat —— */}
      <header className="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 bg-white/90 border-b border-black/[0.06] backdrop-blur-sm">
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-neutral-500 hover:bg-neutral-100 text-sm font-semibold"
          aria-label="Back / close"
        >
          ‹
        </button>

        <div className="relative shrink-0">
          <img
            src="/avatars/lightstick-icon.png?v=classic-face"
            alt=""
            className="w-9 h-9 rounded-full object-cover object-[center_70%] ring-1 ring-black/5 bg-[#B8E6FF]"
            draggable={false}
          />
          <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-emerald-400 ring-2 ring-white" />
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-bold text-neutral-900 leading-tight truncate">
            Binky
          </p>
          <p className="text-[10px] text-neutral-400 leading-none truncate">
            {large ? "calendar · large" : "add plans free"}
          </p>
        </div>

        {onToggleSize && (
          <button
            type="button"
            onClick={onToggleSize}
            className="shrink-0 text-[10px] px-2 py-1 rounded-full border border-neutral-200 bg-white hover:bg-neutral-50 text-neutral-700 font-semibold"
            title={large ? "Smaller panel" : "Larger panel"}
          >
            {large ? "Hanni" : "Hyein"}
          </button>
        )}

        <button
          type="button"
          onClick={() => {
            const n = new Date();
            setYear(n.getFullYear());
            setMonth(n.getMonth());
            setSelected(todayKey());
          }}
          className="shrink-0 text-[10px] px-2 py-1 rounded-full border border-neutral-200 bg-white hover:bg-neutral-50 text-neutral-600 font-semibold"
        >
          Today
        </button>
      </header>

      {/* Month nav */}
      <div className="shrink-0 flex items-center justify-between px-2.5 py-1 bg-[#F7F7F8] border-b border-black/[0.04]">
        <button
          type="button"
          onClick={prevMonth}
          className="w-6 h-6 rounded-full border border-neutral-200 bg-white hover:bg-neutral-50 text-neutral-600 text-sm shadow-sm"
        >
          ‹
        </button>
        <p className="text-[11px] font-bold text-neutral-800 px-2 py-0.5 rounded-full bg-white border border-neutral-200 shadow-sm">
          {monthLabel(year, month)}
        </p>
        <button
          type="button"
          onClick={nextMonth}
          className="w-6 h-6 rounded-full border border-neutral-200 bg-white hover:bg-neutral-50 text-neutral-600 text-sm shadow-sm"
        >
          ›
        </button>
      </div>

      {/* Grid */}
      <div className="shrink-0 px-2 pt-1 pb-0.5 bg-[#F7F7F8]">
        <div className="grid grid-cols-7 gap-px mb-0.5">
          {WEEKDAYS.map((d) => (
            <div
              key={d}
              className="text-center text-[8px] font-semibold text-neutral-400 py-0.5"
            >
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-px">
          {grid.map((day, i) => {
            if (day == null) {
              return <div key={`e-${i}`} className={dayH} />;
            }
            const key = toDateKey(year, month, day);
            const isToday = key === todayKey();
            const isSel = key === selected;
            const dayCats = catsByDate.get(key) ?? [];
            const primary = dayCats[0];
            const primaryMeta = primary ? CATEGORY_META[primary] : null;
            // Member heart / Debut gradient heart / user bunny replace day number
            const dayMark = calendarDayMark(year, month, day);
            return (
              <button
                key={key}
                type="button"
                onClick={() => setSelected(key)}
                title={
                  dayMark
                    ? `${day} · ${dayMark.label}`
                    : dayCats.length
                      ? `${day} · ${dayCats.map((c) => CATEGORY_META[c].emoji + " " + CATEGORY_META[c].label).join(", ")}`
                      : undefined
                }
                className={`relative ${dayH} rounded-md ${dayText} font-semibold transition border flex flex-col items-center justify-center gap-0 leading-none ${
                  isSel
                    ? "bg-[#B8EF9A] border-neutral-800/80 text-neutral-900 shadow-sm"
                    : primaryMeta
                      ? `${primaryMeta.dayBg} border-transparent ${primaryMeta.dayText} hover:brightness-[0.98]`
                      : isToday
                        ? "bg-white border-neutral-300 text-neutral-900"
                        : "bg-white/70 border-transparent hover:border-neutral-200 text-neutral-700"
                }`}
              >
                {dayMark?.kind === "nj-debut-heart" ? (
                  <span
                    className={`baa-nj-debut-heart ${large ? "baa-nj-debut-heart-lg" : ""}`}
                    aria-label={`Day ${day}, NewJeans Debut Day`}
                    role="img"
                  >
                    <svg viewBox="0 0 16 16" aria-hidden>
                      <defs>
                        <linearGradient
                          id={`nj-debut-g-${key}`}
                          x1="0%"
                          y1="0%"
                          x2="100%"
                          y2="100%"
                        >
                          <stop offset="0%" stopColor="#2060FF" />
                          <stop offset="22%" stopColor="#2060FF" />
                          <stop offset="22%" stopColor="#FF6235" />
                          <stop offset="42%" stopColor="#FF6235" />
                          <stop offset="42%" stopColor="#FFF874" />
                          <stop offset="60%" stopColor="#FFF874" />
                          <stop offset="60%" stopColor="#6BFF60" />
                          <stop offset="78%" stopColor="#6BFF60" />
                          <stop offset="78%" stopColor="#F24AFF" />
                          <stop offset="100%" stopColor="#F24AFF" />
                        </linearGradient>
                      </defs>
                      <path
                        fill={`url(#nj-debut-g-${key})`}
                        d="M8 14.2S1.6 10.1 1.6 5.9C1.6 3.6 3.3 2 5.4 2c1.2 0 2.3.6 2.6 1.5C8.3 2.6 9.4 2 10.6 2c2.1 0 3.8 1.6 3.8 3.9 0 4.2-6.4 8.3-6.4 8.3z"
                      />
                    </svg>
                  </span>
                ) : dayMark?.kind === "emoji" ? (
                  <span
                    className={`leading-none ${large ? "text-[15px]" : "text-[12px]"}`}
                    aria-label={`Day ${day}, ${dayMark.label}`}
                  >
                    {dayMark.value}
                  </span>
                ) : (
                  <span className="leading-none">{day}</span>
                )}
                {/* Type emoji(s) under the date number */}
                {dayCats.length > 0 && !dayMark && (
                  <span
                    className={`flex items-center justify-center gap-px leading-none ${
                      large ? "text-[9px] mt-0.5" : "text-[7px] -mt-px"
                    }`}
                    aria-hidden
                  >
                    {dayCats.slice(0, 3).map((c) => (
                      <span key={c}>{CATEGORY_META[c].emoji}</span>
                    ))}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {/* Tiny legend — hide while composing to save vertical space */}
        {!addOpen && (
          <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 px-0.5 pt-1 pb-0.5">
            {SCHEDULE_CATEGORIES.map((c) => (
              <span
                key={c}
                className="text-[8px] font-medium text-neutral-500 tabular-nums"
              >
                {CATEGORY_META[c].emoji} {CATEGORY_META[c].label}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Day events list — hidden while composing so form shows fully */}
      {!addOpen && (
      <div className="flex-1 min-h-0 overflow-y-auto px-2.5 py-1.5 space-y-2 chat-scroll bg-[#F7F7F8]">
        <p className="text-[10px] font-semibold text-neutral-500 px-0.5">
          {selectedLabel}
          <span className="font-normal text-neutral-400">
            {" "}
            · right-click a plan to edit
          </span>
        </p>

        {dayEvents.length === 0 ? (
          <div className="flex items-start gap-1.5 pr-2">
            <img
              src="/avatars/lightstick-icon.png?v=classic-face"
              alt=""
              className="w-8 h-8 rounded-full object-cover object-[center_70%] ring-1 ring-black/5 bg-[#B8E6FF] shrink-0"
              draggable={false}
            />
            <div>
              <p className="text-[11px] font-semibold text-neutral-700 mb-0.5 ml-0.5">
                Binky
              </p>
              <div className="max-w-[95%] rounded-[18px] rounded-tl-[6px] border border-neutral-800/80 bg-[#B8EF9A] text-neutral-900 px-3 py-2 text-[12px] leading-snug shadow-[0_1px_0_rgba(0,0,0,0.04)]">
                No plans this day. Tap + Add plan below to create one.
              </div>
            </div>
          </div>
        ) : (
          dayEvents.map((ev, idx) => {
            const cat = eventCategory(ev);
            const meta = CATEGORY_META[cat];
            return (
              <div key={ev.id} className="flex items-start gap-1.5 pr-1">
                <div className="w-8 shrink-0 pt-0.5">
                  {idx === 0 ? (
                    <img
                      src="/avatars/lightstick-icon.png?v=classic-face"
                      alt=""
                      className="w-8 h-8 rounded-full object-cover object-[center_70%] ring-1 ring-black/5 bg-[#B8E6FF]"
                      draggable={false}
                    />
                  ) : (
                    <div className="w-8 h-8" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  {idx === 0 && (
                    <p className="text-[11px] font-semibold text-neutral-700 mb-0.5 ml-0.5">
                      Binky
                    </p>
                  )}
                  <div className="flex items-end gap-1">
                    <div
                      data-plan-card
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        // Position menu inside panel (avoid going off-screen)
                        const rect = (
                          e.currentTarget as HTMLElement
                        ).getBoundingClientRect();
                        setCtxMenu({
                          id: ev.id,
                          x: Math.min(
                            e.clientX - rect.left + 8,
                            rect.width - 120
                          ),
                          y: e.clientY - rect.top + 4,
                        });
                      }}
                      onDoubleClick={() => openEdit(ev)}
                      className="relative max-w-[90%] rounded-[18px] rounded-tl-[6px] border border-neutral-800/80 bg-[#B8EF9A] text-neutral-900 px-3 py-2 text-[12px] leading-snug shadow-[0_1px_0_rgba(0,0,0,0.04)] cursor-context-menu"
                      title="Right-click to edit · double-click to edit"
                    >
                      <div className="flex items-center gap-1 flex-wrap">
                        {formatTimeRange(ev.time, ev.endTime) && (
                          <span className="font-bold text-neutral-700">
                            {formatTimeRange(ev.time, ev.endTime)}
                          </span>
                        )}
                        {ev.endDate && ev.endDate !== ev.date && (
                          <span className="text-[9px] font-semibold text-neutral-600">
                            {ev.date.slice(5)} → {ev.endDate.slice(5)}
                          </span>
                        )}
                        <span
                          className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full border ${meta.chip}`}
                        >
                          {meta.emoji} {meta.label} · {meta.leadHours}h
                        </span>
                      </div>
                      {ev.title}
                      {ev.note && (
                        <p className="text-[10px] text-neutral-600 mt-0.5 opacity-90">
                          {ev.note}
                        </p>
                      )}

                      {/* Context menu anchored to this card */}
                      {ctxMenu?.id === ev.id && (
                        <div
                          className="absolute z-50 min-w-[118px] rounded-xl border border-black/10 bg-white/95 backdrop-blur-md shadow-lg py-1 overflow-hidden"
                          style={{
                            left: Math.max(4, ctxMenu.x),
                            top: Math.max(4, ctxMenu.y),
                          }}
                          onClick={(e) => e.stopPropagation()}
                          onContextMenu={(e) => e.preventDefault()}
                        >
                          <button
                            type="button"
                            className="w-full text-left px-3 py-1.5 text-[12px] font-semibold text-neutral-800 hover:bg-black/[0.05]"
                            onClick={() => openEdit(ev)}
                          >
                            ✏️ Edit
                          </button>
                          <button
                            type="button"
                            className="w-full text-left px-3 py-1.5 text-[12px] font-semibold text-rose-600 hover:bg-rose-50"
                            onClick={() => {
                              onRemove(ev.id);
                              setCtxMenu(null);
                              if (editingId === ev.id) {
                                resetForm();
                                setAddOpen(false);
                              }
                            }}
                          >
                            🗑 Delete
                          </button>
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => onRemove(ev.id)}
                      className="shrink-0 mb-0.5 w-6 h-6 rounded-full border border-neutral-200 bg-white text-[10px] text-neutral-400 hover:text-rose-500 hover:border-rose-200"
                      title="Delete"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
      )}

      {/* Add / Edit plan — shrink-0 only (never flex-1 white stretch = bottom white bar) */}
      {allowManualCreate && (onAdd || onUpdate) && (
        <div
          className="shrink-0 border-t border-black/[0.06] bg-white z-20"
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {!addOpen ? (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                openAdd();
              }}
              onPointerDown={(e) => e.stopPropagation()}
              className="w-full h-10 flex items-center justify-center gap-1.5 text-[13px] font-semibold text-[#007AFF] hover:bg-black/[0.03] active:bg-black/[0.06] cursor-pointer"
            >
              <span className="text-[16px] leading-none" aria-hidden>
                +
              </span>
              Add plan
              <span className="text-[10px] font-normal text-neutral-400">
                · {selectedLabel}
              </span>
            </button>
          ) : (
            <form
              onSubmit={submitManual}
              className="shrink-0 px-2.5 py-2 space-y-1.5"
              onPointerDown={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] font-semibold text-neutral-600">
                  {editingId ? "Edit plan" : "New plan"} · {selectedLabel}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setAddOpen(false);
                    resetForm(true);
                  }}
                  className="text-[10px] font-semibold text-neutral-400 hover:text-neutral-600 px-1"
                >
                  Cancel
                </button>
              </div>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Title (required)"
                autoFocus
                className="w-full h-9 rounded-full border border-neutral-200 bg-[#F7F7F8] px-3 text-[13px] text-neutral-900 placeholder:text-neutral-400 outline-none focus:border-neutral-400 focus:bg-white"
              />

              {/* Start / End time tabs + one wheel (saves height) */}
              <div className="flex rounded-full bg-[#F2F2F7] p-0.5 gap-0.5">
                <button
                  type="button"
                  onClick={() => setTimeTab("start")}
                  className={`flex-1 h-7 rounded-full text-[11px] font-semibold transition ${
                    timeTab === "start"
                      ? "bg-white text-neutral-900 shadow-sm"
                      : "text-neutral-500"
                  }`}
                >
                  Start
                  {time ? (
                    <span className="ml-1 font-bold tabular-nums text-[10px]">
                      {time}
                    </span>
                  ) : (
                    <span className="ml-1 text-[10px] font-normal text-neutral-400">
                      —
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!time) {
                      // Need a start first
                      setTimeTab("start");
                      setFormError("Set start time first");
                      return;
                    }
                    setFormError(null);
                    setTimeTab("end");
                    if (!endTime) setEndTime(addMinutesToHhmm(time, 60));
                  }}
                  className={`flex-1 h-7 rounded-full text-[11px] font-semibold transition ${
                    timeTab === "end"
                      ? "bg-white text-neutral-900 shadow-sm"
                      : "text-neutral-500"
                  }`}
                >
                  End
                  {endTime ? (
                    <span className="ml-1 font-bold tabular-nums text-[10px]">
                      {endTime}
                    </span>
                  ) : (
                    <span className="ml-1 text-[10px] font-normal text-neutral-400">
                      —
                    </span>
                  )}
                </button>
              </div>
              {timeTab === "start" ? (
                <IosTimePicker
                  value={time}
                  onChange={onStartTimeChange}
                  compact
                  onLabel="Start on"
                  offLabel="No time"
                  emptyDisplay="All day"
                />
              ) : (
                <IosTimePicker
                  value={endTime}
                  onChange={onEndTimeChange}
                  compact
                  onLabel="End on"
                  offLabel="No end"
                  emptyDisplay="Open end"
                />
              )}
              {time && endTime && (
                <p className="text-center text-[11px] font-semibold text-neutral-600 tabular-nums">
                  {formatTimeRange(time, endTime)}
                </p>
              )}

              {/* Type: work / school / event / family / friends */}
              <div className="grid grid-cols-5 gap-1">
                {SCHEDULE_CATEGORIES.map((c) => {
                  const meta = CATEGORY_META[c];
                  const on = category === c;
                  return (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setCategory(c)}
                      title={`${meta.label} · remind ${meta.leadHours}h before`}
                      className={`h-9 rounded-xl text-[10px] font-semibold border cursor-pointer flex flex-col items-center justify-center leading-tight transition ${
                        on
                          ? meta.chip + " shadow-sm"
                          : "bg-[#F7F7F8] text-neutral-500 border-neutral-200"
                      }`}
                    >
                      <span className="text-[13px] leading-none">
                        {meta.emoji}
                      </span>
                      <span className="text-[8px] mt-0.5 truncate max-w-full px-0.5">
                        {meta.label}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="flex gap-1.5 items-center">
                <button
                  type="submit"
                  onClick={submitManual}
                  disabled={!title.trim()}
                  className="flex-1 h-8 rounded-full bg-neutral-900 hover:bg-neutral-800 disabled:opacity-35 text-white text-[12px] font-semibold cursor-pointer disabled:cursor-not-allowed"
                >
                  {editingId ? "Update" : "Save"}
                </button>
              </div>
              {formError && (
                <p className="text-[10px] text-rose-500 px-0.5">{formError}</p>
              )}
            </form>
          )}
        </div>
      )}
    </div>
  );
}
