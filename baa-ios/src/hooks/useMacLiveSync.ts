import { useCallback, useEffect, useRef, useState } from "react";
import type { Pairing, ScheduleEvent } from "../types";
import { saveLocalSchedule } from "../lib/calendarStore";
import { syncFromMac } from "../lib/wifiSync";
import { rescheduleNotifications } from "../lib/reminders";

function mapEvents(raw: unknown): ScheduleEvent[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      const e = item as Record<string, unknown>;
      return {
        id: String(e.id ?? ""),
        date: String(e.date ?? ""),
        title: String(e.title ?? ""),
        time:
          e.time != null && String(e.time).trim()
            ? String(e.time)
            : undefined,
        note:
          e.note != null && String(e.note).trim()
            ? String(e.note)
            : undefined,
        category:
          e.category === "work" || e.category === "other"
            ? (e.category as "work" | "other")
            : "other",
        createdAt: Number(e.createdAt ?? e.created_at ?? Date.now()),
      } satisfies ScheduleEvent;
    })
    .filter((e) => e.id && e.date && e.title);
}

export type LiveStatus = "idle" | "connecting" | "linked" | "error";

/**
 * Live link to Mac:
 * 1) WebSocket — Mac pushes calendar as soon as phone links
 * 2) HTTP pull — backup / 連接並更新
 */
export function useMacLiveSync(
  pairing: Pairing | null,
  onEvents: (events: ScheduleEvent[]) => void
) {
  const [status, setStatus] = useState<LiveStatus>("idle");
  const [message, setMessage] = useState("Not connected");
  const [eventCount, setEventCount] = useState(0);
  const onEventsRef = useRef(onEvents);
  onEventsRef.current = onEvents;
  const wsRef = useRef<WebSocket | null>(null);

  const applyEvents = useCallback(async (events: ScheduleEvent[], source: string) => {
    setEventCount(events.length);
    await saveLocalSchedule(events);
    await rescheduleNotifications(events);
    onEventsRef.current(events);
    setMessage(
      events.length === 0
        ? `${source}: Mac calendar empty — add plans on Mac or push samples`
        : `${source}: ${events.length} event${events.length === 1 ? "" : "s"}`
    );
  }, []);

  const httpSync = useCallback(async () => {
    if (!pairing) return;
    setMessage("Pulling calendar…");
    const r = await syncFromMac(pairing);
    if (r.ok) {
      setStatus("linked");
      await applyEvents(r.events, "HTTP");
    } else {
      setStatus("error");
      setMessage(r.detail ? `${r.message} · ${r.detail}` : r.message);
    }
  }, [pairing, applyEvents]);

  // WebSocket live link
  useEffect(() => {
    if (!pairing) {
      setStatus("idle");
      setMessage("Not paired");
      return;
    }

    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (cancelled) return;
      setStatus("connecting");
      setMessage(`Connecting ${pairing.host}:${pairing.port}…`);

      const url = `ws://${pairing.host}:${pairing.port}/ws?token=${encodeURIComponent(pairing.token)}`;
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch (e) {
        setStatus("error");
        setMessage(e instanceof Error ? e.message : "WebSocket failed");
        retry = setTimeout(connect, 2500);
        return;
      }
      wsRef.current = ws;

      ws.onopen = () => {
        if (cancelled) return;
        setStatus("linked");
        setMessage("Linked · waiting for calendar…");
        try {
          ws.send(JSON.stringify({ kind: "hello", name: "BAA iPhone" }));
        } catch {
          /* ignore */
        }
        // Also HTTP pull in case WS message was missed
        void httpSync();
      };

      ws.onmessage = (ev) => {
        try {
          const data = JSON.parse(String(ev.data)) as {
            kind?: string;
            events?: unknown;
            text?: string;
          };
          if (data.kind === "schedule_sync") {
            const events = mapEvents(data.events);
            void applyEvents(events, "Live");
            setStatus("linked");
          } else if (data.kind === "linked") {
            setStatus("linked");
            setMessage(data.text || "Linked to Mac");
          } else if (data.kind === "reminder") {
            // handled elsewhere if needed
          }
        } catch {
          /* ignore */
        }
      };

      ws.onerror = () => {
        if (cancelled) return;
        setStatus("error");
        setMessage("Connection error — check Wi‑Fi / Local Network");
      };

      ws.onclose = () => {
        if (cancelled) return;
        setStatus("connecting");
        setMessage("Reconnecting…");
        retry = setTimeout(connect, 2000);
      };
    };

    connect();

    return () => {
      cancelled = true;
      if (retry) clearTimeout(retry);
      try {
        wsRef.current?.close();
      } catch {
        /* ignore */
      }
      wsRef.current = null;
    };
  }, [pairing, applyEvents, httpSync]);

  return { status, message, eventCount, httpSync };
}
