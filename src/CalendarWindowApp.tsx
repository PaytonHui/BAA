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

  const refresh = useCallback(() => {
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
      refresh();
    }).then((u) => unsubs.push(u));
    return () => unsubs.forEach((u) => u());
  }, [refresh]);

  const close = useMacWindowClose(async () => {
    await emit("calendar-closed", {}).catch(() => undefined);
  });

  const onRemove = useCallback((id: string) => {
    const next = loadSchedule().filter((e) => e.id !== id);
    // Optimistic UI first
    setEvents(next);
    void (async () => {
      try {
        await saveScheduleAsync(next);
      } catch {
        saveSchedule(next);
      }
      void publishScheduleToCompanion(next);
      // Emit only after disk write so other windows don't reload stale data
      void emit("schedule-updated", {}).catch(() => undefined);
    })();
  }, []);

  const persist = useCallback((next: ScheduleEvent[]) => {
    setEvents(next);
    void (async () => {
      try {
        await saveScheduleAsync(next);
      } catch {
        saveSchedule(next);
      }
      void publishScheduleToCompanion(next);
      void emit("schedule-updated", {}).catch(() => undefined);
    })();
  }, []);

  const onAdd = useCallback(
    (input: ManualScheduleInput) => {
      const draft: Omit<ScheduleEvent, "id" | "createdAt"> = {
        date: input.date,
        title: input.title,
        time: input.time,
        endTime: input.endTime,
        note: input.note,
        category: input.category,
      };
      const prev = loadSchedule();
      const { next, added, updated } = applyScheduleUpserts(prev, [draft]);
      if (!added.length && !updated.length) {
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
      className="p-[18px] overflow-hidden h-full bg-transparent"
      forceInteractive
    >
      {/* Top-align card; transparent shell — no full-height white stretch */}
      <div className="flex flex-col h-full min-h-0 w-full items-stretch justify-start bg-transparent overflow-hidden">
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
