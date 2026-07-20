import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  hydrateSchedule,
  loadSchedule,
  reloadScheduleFromDisk,
  type ScheduleEvent,
} from "../lib/schedule";

interface LinkPhonePanelProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Share calendar — Sync / AirDrop use disk schedule.
 */
export function LinkPhonePanel({ open, onClose }: LinkPhonePanelProps) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [events, setEvents] = useState<ScheduleEvent[]>(() => loadSchedule());

  useEffect(() => {
    if (!open) return;
    setMsg(null);
    void reloadScheduleFromDisk()
      .catch(() => hydrateSchedule())
      .then(setEvents);
  }, [open]);

  if (!open) return null;

  const payload = (list: ScheduleEvent[]) =>
    list.map((e) => ({
      id: e.id,
      date: e.date,
      title: e.title,
      time: e.time ?? null,
      note: e.note ?? null,
      category: e.category ?? null,
    }));

  const run = async (kind: "sync" | "airdrop") => {
    setBusy(true);
    setMsg(null);
    try {
      // Fresh disk read so calendar window adds are included
      const list = await reloadScheduleFromDisk().catch(() => loadSchedule());
      setEvents(list);
      if (list.length === 0) {
        setMsg("No events yet — add some in Calendar first");
        return;
      }
      if (kind === "sync") {
        const n = await invoke<number>("sync_apple_calendar", {
          events: payload(list),
        });
        setMsg(
          `Synced ${n} to calendar “BAA”. On iPhone enable Calendars → BAA (not Family).`
        );
      } else {
        const text = await invoke<string>("airdrop_baa_calendar", {
          events: payload(list),
        });
        setMsg(text);
      }
    } catch (e) {
      const raw =
        typeof e === "string"
          ? e
          : e instanceof Error
            ? e.message
            : String(e);
      setMsg(raw);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="panel-surface baa-ios-glass relative z-30 w-[270px] max-h-full overflow-y-auto p-3.5 space-y-3"
      role="dialog"
      aria-label="Share calendar"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[16px] font-semibold tracking-[-0.02em] text-[#1C1C1E]">
          Share calendar
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="baa-ios-btn text-[15px] font-semibold text-[#007AFF] px-2.5 py-1 rounded-full hover:bg-black/[0.04]"
        >
          Done
        </button>
      </div>
      <p className="text-[12px] text-[#8E8E93] leading-snug">
        Add plans in Calendar first, then share.
      </p>
      <p className="text-[13px] text-[#8E8E93] leading-snug">
        <span className="font-semibold text-[#1C1C1E]">AirDrop</span> sends{" "}
        <span className="font-semibold text-[#1C1C1E]">BAA.ics</span>. On
        iPhone open it and choose calendar{" "}
        <span className="font-semibold text-[#1C1C1E]">BAA</span> (not Family).{" "}
        <span className="font-semibold text-[#1C1C1E]">Sync</span> writes
        straight to Mac calendar BAA via iCloud.
      </p>
      <p className="text-[13px] text-[#3A3A3C]">
        <span className="font-semibold text-[#007AFF]">{events.length}</span>{" "}
        event{events.length === 1 ? "" : "s"} ready
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={() => void run("sync")}
        className="baa-ios-btn baa-ios-btn-primary w-full text-[14px] py-2.5 disabled:opacity-50"
      >
        {busy ? "Working…" : "Sync to Calendar “BAA”"}
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => void run("airdrop")}
        className="baa-ios-btn baa-ios-btn-secondary w-full text-[14px] py-2.5 disabled:opacity-50"
      >
        {busy ? "Working…" : "AirDrop calendar"}
      </button>
      {msg && (
        <p className="text-[12px] text-[#8E8E93] leading-snug">{msg}</p>
      )}
    </div>
  );
}
