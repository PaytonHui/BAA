/**
 * Standalone calendar window (no WebGL pet).
 * Free for everyone — no Grok login required.
 * Manual add when not logged in; chat marks when Grok is on.
 */
import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  CalendarPanel,
  type ManualScheduleInput,
} from "./components/CalendarPanel";
import type { GrokAuthStatus } from "./components/GrokLoginForm";
import {
  MacWindowShell,
  useMacWindowClose,
} from "./components/MacWindowShell";
import { publishScheduleToCompanion } from "./lib/macSync";
import {
  applyScheduleUpserts,
  hydrateSchedule,
  loadSchedule,
  reloadScheduleFromDisk,
  saveSchedule,
  type ScheduleEvent,
} from "./lib/schedule";

export default function CalendarWindowApp() {
  const [events, setEvents] = useState<ScheduleEvent[]>(() => loadSchedule());
  const [large, setLarge] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);

  const refreshAuth = useCallback(async () => {
    try {
      const s = await invoke<GrokAuthStatus>("grok_auth_status");
      setLoggedIn(!!s.loggedIn);
    } catch {
      setLoggedIn(false);
    }
  }, []);

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
    void refreshAuth();
  }, [refreshAuth]);

  useEffect(() => {
    const unsubs: Array<() => void> = [];
    void listen("calendar-window-shown", () => {
      refresh();
      void refreshAuth();
    }).then((u) => unsubs.push(u));
    void listen("calendar-window-data", () => {
      refresh();
    }).then((u) => unsubs.push(u));
    void listen<{ large?: boolean }>("calendar-window-size", (ev) => {
      setLarge(!!ev.payload?.large);
    }).then((u) => unsubs.push(u));
    void listen("schedule-updated", () => {
      refresh();
    }).then((u) => unsubs.push(u));
    void listen("grok-logged-in", () => {
      void refreshAuth();
    }).then((u) => unsubs.push(u));
    void listen("grok-logged-out", () => {
      void refreshAuth();
    }).then((u) => unsubs.push(u));
    return () => unsubs.forEach((u) => u());
  }, [refresh, refreshAuth]);

  const close = useMacWindowClose(async () => {
    await emit("calendar-closed", {}).catch(() => undefined);
  });

  const onRemove = useCallback((id: string) => {
    const next = loadSchedule().filter((e) => e.id !== id);
    saveSchedule(next);
    setEvents(next);
    void publishScheduleToCompanion(next);
    void emit("schedule-updated", {}).catch(() => undefined);
  }, []);

  const onAdd = useCallback((input: ManualScheduleInput) => {
    const draft: Omit<ScheduleEvent, "id" | "createdAt"> = {
      date: input.date,
      title: input.title,
      time: input.time,
      note: input.note,
      category: input.category,
    };
    const prev = loadSchedule();
    const { next } = applyScheduleUpserts(prev, [draft]);
    saveSchedule(next);
    setEvents(next);
    void publishScheduleToCompanion(next);
    void emit("schedule-updated", {}).catch(() => undefined);
  }, []);

  const onToggleSize = useCallback(async () => {
    const next = !large;
    setLarge(next);
    await emit("calendar-toggle-size", { large: next }).catch(() => undefined);
  }, [large]);

  // Free tier: manual create. Grok signed in: chat-only marking.
  const allowManualCreate = !loggedIn;

  return (
    <MacWindowShell
      shownEvent="calendar-window-shown"
      className="p-[18px] overflow-visible"
    >
      <CalendarPanel
        open
        events={events}
        large={large}
        onToggleSize={() => void onToggleSize()}
        onRemove={onRemove}
        onClose={() => void close()}
        allowManualCreate={allowManualCreate}
        onAdd={allowManualCreate ? onAdd : undefined}
      />
    </MacWindowShell>
  );
}
