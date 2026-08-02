/**
 * Standalone calendar window (no WebGL pet).
 * View + manual add plans; share via menu Sync to Calendar.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  CalendarPanel,
  type ManualScheduleInput,
} from "./components/CalendarPanel";
import {
  MacWindowShell,
  useMacWindowClose,
} from "./components/MacWindowShell";
import { publishScheduleToCompanion } from "./lib/macSync";
import { resizeCalendarForComposer } from "./lib/panelWindow";
import {
  applyScheduleUpserts,
  flushScheduleToDisk,
  hydrateSchedule,
  loadSchedule,
  reloadScheduleFromDisk,
  saveSchedule,
  saveScheduleAsync,
  type ScheduleEvent,
} from "./lib/schedule";

export default function CalendarWindowApp() {
  const [events, setEvents] = useState<ScheduleEvent[]>(() => loadSchedule());
  const [large, setLarge] = useState(false);
  const largeRef = useRef(large);
  largeRef.current = large;
  /** True while Add/Edit composer is open — don't snap back to browse height */
  const formOpenRef = useRef(false);
  /** Skip external refresh while we are writing a local edit (race fix) */
  const writingRef = useRef(false);

  const refresh = useCallback(() => {
    if (writingRef.current) return;
    void reloadScheduleFromDisk().then(setEvents);
  }, []);

  useEffect(() => {
    invoke("pin_to_all_spaces_cmd").catch(() => undefined);
    getCurrentWindow()
      .setVisibleOnAllWorkspaces(true)
      .catch(() => undefined);
    getCurrentWindow()
      .setAlwaysOnTop(true)
      .catch(() => undefined);
    void hydrateSchedule().then(setEvents);
    const onForm = (ev: Event) => {
      const open = !!(ev as CustomEvent<{ open?: boolean }>).detail?.open;
      formOpenRef.current = open;
    };
    window.addEventListener("baa-cal-form-open", onForm);
    return () => window.removeEventListener("baa-cal-form-open", onForm);
  }, []);

  useEffect(() => {
    const unsubs: Array<() => void> = [];
    void listen("calendar-window-shown", () => {
      refresh();
      formOpenRef.current = false;
      // Snap to browse height + force transparent redraw (no white under-card bar)
      void resizeCalendarForComposer(false, largeRef.current).catch(
        () => undefined
      );
      window.setTimeout(() => {
        if (!formOpenRef.current) {
          void resizeCalendarForComposer(false, largeRef.current).catch(
            () => undefined
          );
        }
      }, 300);
    }).then((u) => unsubs.push(u));
    void listen("calendar-window-data", () => {
      refresh();
    }).then((u) => unsubs.push(u));
    void listen<{ large?: boolean }>("calendar-window-size", (ev) => {
      const next = !!ev.payload?.large;
      setLarge(next);
      if (!formOpenRef.current) {
        void resizeCalendarForComposer(false, next).catch(() => undefined);
      }
    }).then((u) => unsubs.push(u));
    void listen("schedule-updated", () => {
      // Don't clobber a plan we just added before disk catch-up
      if (writingRef.current) return;
      refresh();
    }).then((u) => unsubs.push(u));
    // Main window asks every panel to flush memory → disk before Sync
    void listen("schedule-flush-request", () => {
      void (async () => {
        try {
          // Prefer live React state + memory (includes just-added plans)
          const live = loadSchedule();
          writingRef.current = true;
          const list = await flushScheduleToDisk();
          const merged = list.length >= live.length ? list : live;
          if (merged !== list && merged.length) {
            try {
              await saveScheduleAsync(merged);
            } catch {
              saveSchedule(merged);
            }
          }
          await emit("schedule-flush-reply", {
            events: merged.length ? merged : live,
            source: "calendar",
          }).catch(() => undefined);
        } catch (e) {
          console.error("[calendar] flush for sync failed", e);
          await emit("schedule-flush-reply", {
            events: loadSchedule(),
            source: "calendar",
            error: String(e),
          }).catch(() => undefined);
        } finally {
          writingRef.current = false;
        }
      })();
    }).then((u) => unsubs.push(u));
    return () => unsubs.forEach((u) => u());
  }, [refresh]);

  const close = useMacWindowClose(async () => {
    // Force-save before close so Sync from menu still has the plan
    writingRef.current = true;
    try {
      await flushScheduleToDisk();
    } catch {
      /* ignore */
    }
    writingRef.current = false;
    // Drop Add/Edit composer so next open starts clean
    formOpenRef.current = false;
    window.dispatchEvent(new CustomEvent("baa-cal-cancel-form"));
    await emit("calendar-closed", {}).catch(() => undefined);
  });

  // Lightstick tap: cancel Add/Edit composer if open, otherwise close calendar
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen("calendar-lightstick-tap", () => {
      if (formOpenRef.current) {
        window.dispatchEvent(new CustomEvent("baa-cal-cancel-form"));
        return;
      }
      void close();
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, [close]);

  // Re-open calendar: always clear composer (main resets formOpenRef on shown)
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen("calendar-window-shown", () => {
      window.dispatchEvent(new CustomEvent("baa-cal-cancel-form"));
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, []);

  const onRemove = useCallback((id: string) => {
    const next = loadSchedule().filter((e) => e.id !== id);
    setEvents(next);
    writingRef.current = true;
    void (async () => {
      try {
        await saveScheduleAsync(next);
      } catch {
        saveSchedule(next);
      }
      void publishScheduleToCompanion(next);
      void emit("schedule-updated", {}).catch(() => undefined);
      writingRef.current = false;
    })();
  }, []);

  const persist = useCallback((next: ScheduleEvent[]) => {
    // UI + memory first, then MUST land on disk before any cross-window reload
    setEvents(next);
    writingRef.current = true;
    saveSchedule(next);
    void (async () => {
      try {
        await saveScheduleAsync(next);
      } catch {
        try {
          await saveScheduleAsync(next);
        } catch {
          saveSchedule(next);
        }
      }
      void publishScheduleToCompanion(next);
      // Only notify others after disk write finished
      void emit("schedule-updated", {}).catch(() => undefined);
      // Hold the guard briefly so our own schedule-updated doesn't wipe UI
      window.setTimeout(() => {
        writingRef.current = false;
      }, 400);
    })();
  }, []);

  const onAdd = useCallback(
    (input: ManualScheduleInput) => {
      // One day, or several (same title/time) for work shifts
      const dateList =
        input.dates && input.dates.length > 0
          ? Array.from(new Set(input.dates))
          : [input.date];
      const drafts: Omit<ScheduleEvent, "id" | "createdAt">[] = dateList.map(
        (date) => ({
          date,
          title: input.title,
          time: input.time,
          endTime: input.endTime,
          note: input.note,
          category: input.category,
        })
      );
      const prev = loadSchedule();
      const { next, added, updated } = applyScheduleUpserts(prev, drafts);
      if (!added.length && !updated.length) {
        // Force-append any dates that somehow didn't land
        let forcedNext = [...prev];
        let grew = false;
        for (const draft of drafts) {
          const exists = forcedNext.some(
            (e) =>
              e.date === draft.date &&
              e.title.trim().toLowerCase() === draft.title.trim().toLowerCase() &&
              (e.time || "") === (draft.time || "")
          );
          if (!exists) {
            forcedNext.push({
              ...draft,
              id: `ev-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              createdAt: Date.now(),
              category: draft.category ?? "event",
            });
            grew = true;
          }
        }
        if (grew) {
          persist(forcedNext);
          return;
        }
        setEvents(prev);
        return;
      }
      persist(next);
    },
    [persist]
  );

  const onUpdate = useCallback(
    (id: string, input: ManualScheduleInput) => {
      const prev = loadSchedule();
      const next = prev.map((e) =>
        e.id === id
          ? {
              ...e,
              date: input.date,
              title: input.title,
              time: input.time,
              endTime: input.endTime,
              note: input.note,
              category: input.category,
              createdAt: Date.now(),
            }
          : e
      );
      persist(next);
    },
    [persist]
  );

  const onToggleSize = useCallback(async () => {
    const next = !large;
    setLarge(next);
    await emit("calendar-toggle-size", { large: next }).catch(() => undefined);
  }, [large]);

  const allowManualCreate = true;

  return (
    <MacWindowShell
      shownEvent="calendar-window-shown"
      className="p-[18px] overflow-y-auto overflow-x-hidden h-full bg-transparent"
      forceInteractive
    >
      {/* Top-align card; allow vertical scroll if window is still short after resize */}
      <div className="flex flex-col min-h-0 w-full items-stretch justify-start bg-transparent">
        <CalendarPanel
          open
          events={events}
          large={large}
          onToggleSize={() => void onToggleSize()}
          onRemove={onRemove}
          onClose={() => void close()}
          allowManualCreate={allowManualCreate}
          onAdd={allowManualCreate ? onAdd : undefined}
          onUpdate={allowManualCreate ? onUpdate : undefined}
        />
      </div>
    </MacWindowShell>
  );
}
