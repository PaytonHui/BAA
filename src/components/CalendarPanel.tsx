import { useEffect, useMemo, useState } from "react";
import { calendarDayMark } from "../lib/defaultCalendar";
import {
  buildMonthGrid,
  datesWithEvents,
  eventCategory,
  eventsOnDate,
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
  /**
   * When true (no Grok login), show a form so users can create schedules
   * without chat. When Grok is signed in, chat marks the calendar instead.
   */
  allowManualCreate?: boolean;
  onAdd?: (input: ManualScheduleInput) => void;
}

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

/**
 * Phoning-style calendar.
 * Free: view + manual add. Grok upgrade: chat marks plans (manual form hidden).
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
}: CalendarPanelProps) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [selected, setSelected] = useState(todayKey());
  const [title, setTitle] = useState("");
  const [time, setTime] = useState("");
  const [category, setCategory] = useState<ScheduleCategory>("other");
  const [formError, setFormError] = useState<string | null>(null);
  /** Free tier: collapsed “+ Add plan” until user opens the form */
  const [addOpen, setAddOpen] = useState(false);

  // Keep form date in sync with the selected day
  useEffect(() => {
    setFormError(null);
  }, [selected]);

  const marked = useMemo(() => datesWithEvents(events), [events]);
  const grid = useMemo(() => buildMonthGrid(year, month), [year, month]);
  const dayEvents = useMemo(
    () => eventsOnDate(events, selected),
    [events, selected]
  );

  const submitManual = (e?: React.FormEvent) => {
    e?.preventDefault();
    const t = title.trim();
    if (!t) {
      setFormError("Add a title");
      return;
    }
    if (!onAdd) return;
    onAdd({
      date: selected,
      title: t,
      time: time.trim() || undefined,
      category,
    });
    setTitle("");
    setTime("");
    setCategory("other");
    setFormError(null);
    setAddOpen(false);
  };

  // Parent keeps us mounted during exit anim; `open` only gates interaction if needed

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

  const panelW = large ? "w-[360px]" : "w-[280px]";
  // Slightly taller only when the add form is expanded
  const formExpanded = allowManualCreate && addOpen;
  const panelH = large
    ? formExpanded
      ? "h-[min(500px,100%)] max-h-full"
      : "h-[min(460px,100%)] max-h-full"
    : formExpanded
      ? "h-[min(380px,100%)] max-h-full"
      : "h-[min(340px,100%)] max-h-full";
  const dayH = large ? "h-9" : "h-6";
  const dayText = large ? "text-[12px]" : "text-[10px]";

  return (
    <div
      className={`panel-surface relative ${panelW} max-w-full ${panelH} flex flex-col rounded-[26px] overflow-hidden shadow-none border-0 bg-[#F7F7F8]`}
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
          <span
            className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-emerald-400 ring-2 ring-white"
          />
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-bold text-neutral-900 leading-tight truncate">
            Binky
          </p>
          <p className="text-[10px] text-neutral-400 leading-none truncate">
            {allowManualCreate
              ? large
                ? "calendar · free"
                : "add plans free"
              : large
                ? "calendar · chat marks"
                : "chat marks plans"}
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
            const has = marked.has(key);
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
                    : undefined
                }
                className={`relative ${dayH} rounded-md ${dayText} font-semibold transition border flex items-center justify-center ${
                  isSel
                    ? "bg-[#B8EF9A] border-neutral-800/80 text-neutral-900 shadow-sm"
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
                    {/* 5 NJ lightstick colors as a banded heart */}
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
                  day
                )}
                {has && !dayMark && (
                  <span
                    className={`absolute bottom-px left-1/2 -translate-x-1/2 w-1 h-1 rounded-full ${
                      isSel ? "bg-neutral-800" : "bg-[#5B8DEF]"
                    }`}
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Day events from chat marks */}
      <div className="flex-1 min-h-0 overflow-y-auto px-2.5 py-1.5 space-y-2 chat-scroll bg-[#F7F7F8]">
        <p className="text-[10px] font-semibold text-neutral-500 px-0.5">
          {selectedLabel}
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
                {allowManualCreate
                  ? "No plans this day. Add one below — free, no Grok needed."
                  : "No plans this day. Tell me in chat and I’ll mark it here!"}
              </div>
            </div>
          </div>
        ) : (
          dayEvents.map((ev, idx) => (
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
                  <div className="max-w-[90%] rounded-[18px] rounded-tl-[6px] border border-neutral-800/80 bg-[#B8EF9A] text-neutral-900 px-3 py-2 text-[12px] leading-snug shadow-[0_1px_0_rgba(0,0,0,0.04)]">
                    <div className="flex items-center gap-1 flex-wrap">
                      {ev.time && (
                        <span className="font-bold text-neutral-700">
                          {ev.time}
                        </span>
                      )}
                      {ev.endDate && ev.endDate !== ev.date && (
                        <span className="text-[9px] font-semibold text-neutral-600">
                          {ev.date.slice(5)} → {ev.endDate.slice(5)}
                        </span>
                      )}
                      <span
                        className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${
                          eventCategory(ev) === "work"
                            ? "bg-sky-600/15 text-sky-800"
                            : "bg-violet-600/12 text-violet-800"
                        }`}
                      >
                        {eventCategory(ev) === "work"
                          ? "💼 work · 3h"
                          : "📅 other · 1h"}
                      </span>
                    </div>
                    {ev.title}
                    {ev.note && (
                      <p className="text-[10px] text-neutral-600 mt-0.5 opacity-90">
                        {ev.note}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => onRemove(ev.id)}
                    className="shrink-0 mb-0.5 w-6 h-6 rounded-full border border-neutral-200 bg-white text-[10px] text-neutral-400 hover:text-rose-500 hover:border-rose-200"
                  >
                    ✕
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Free tier: one slim “+ Add plan” bar; expand only when needed */}
      {allowManualCreate && onAdd && (
        <div className="shrink-0 border-t border-black/[0.06] bg-white">
          {!addOpen ? (
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              className="w-full h-9 flex items-center justify-center gap-1.5 text-[12px] font-semibold text-[#007AFF] hover:bg-black/[0.03]"
            >
              <span className="text-[15px] leading-none" aria-hidden>
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
              className="px-2.5 py-2 space-y-1.5"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] font-semibold text-neutral-600">
                  New plan · {selectedLabel}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setAddOpen(false);
                    setFormError(null);
                  }}
                  className="text-[10px] font-semibold text-neutral-400 hover:text-neutral-600 px-1"
                >
                  Cancel
                </button>
              </div>
              <div className="flex gap-1.5 items-center">
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Title"
                  autoFocus
                  className="flex-1 min-w-0 h-8 rounded-full border border-neutral-200 bg-[#F7F7F8] px-3 text-[12px] text-neutral-900 placeholder:text-neutral-400 outline-none focus:border-neutral-400 focus:bg-white"
                />
                <input
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  className="shrink-0 h-8 w-[6.5rem] rounded-full border border-neutral-200 bg-[#F7F7F8] px-1.5 text-[11px] text-neutral-800 outline-none focus:border-neutral-400"
                  aria-label="Time (optional)"
                />
              </div>
              <div className="flex gap-1.5 items-center">
                <button
                  type="button"
                  onClick={() => setCategory("other")}
                  className={`flex-1 h-7 rounded-full text-[10px] font-semibold border ${
                    category === "other"
                      ? "bg-violet-600/12 text-violet-800 border-violet-300"
                      : "bg-[#F7F7F8] text-neutral-500 border-neutral-200"
                  }`}
                >
                  📅 other
                </button>
                <button
                  type="button"
                  onClick={() => setCategory("work")}
                  className={`flex-1 h-7 rounded-full text-[10px] font-semibold border ${
                    category === "work"
                      ? "bg-sky-600/15 text-sky-800 border-sky-300"
                      : "bg-[#F7F7F8] text-neutral-500 border-neutral-200"
                  }`}
                >
                  💼 work
                </button>
                <button
                  type="submit"
                  disabled={!title.trim()}
                  className="shrink-0 h-7 px-3.5 rounded-full bg-neutral-900 hover:bg-neutral-800 disabled:opacity-35 text-white text-[11px] font-semibold"
                >
                  Save
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
