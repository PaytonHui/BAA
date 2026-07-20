import type { Pairing, ScheduleEvent } from "../types";
import { saveLocalSchedule } from "./calendarStore";
import { savePairing } from "./linkStore";

export type SyncResult =
  | { ok: true; events: ScheduleEvent[]; updatedAt: number; host: string }
  | {
      ok: false;
      reason: "offline" | "auth" | "error";
      message: string;
      detail?: string;
    };

function mapEvents(rawEvents: unknown): ScheduleEvent[] {
  if (!Array.isArray(rawEvents)) return [];
  return rawEvents
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

/**
 * Opportunistic sync: only when Mac is reachable on same Wi‑Fi.
 * Not always-on — phone keeps its own calendar copy offline.
 */
export async function syncFromMac(pairing: Pairing): Promise<SyncResult> {
  const base = `http://${pairing.host}:${pairing.port}`;
  const url = `${base}/api/schedule?token=${encodeURIComponent(pairing.token)}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);

  try {
    // Quick health first (clearer errors)
    try {
      const h = await fetch(`${base}/health`, { signal: ctrl.signal });
      if (!h.ok) {
        clearTimeout(timer);
        return {
          ok: false,
          reason: "error",
          message: `Mac health ${h.status}`,
          detail: base,
        };
      }
    } catch {
      clearTimeout(timer);
      return {
        ok: false,
        reason: "offline",
        message: `Can't reach Mac at ${pairing.host}:${pairing.port}`,
        detail:
          "Same Wi‑Fi? Mac BAA open? Allow Local Network for Expo/BAA in iOS Settings.",
      };
    }

    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: "application/json" },
    });
    clearTimeout(timer);

    if (res.status === 401) {
      return {
        ok: false,
        reason: "auth",
        message: "Token expired — re-scan QR on Mac (Link iPhone)",
        detail: base,
      };
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        ok: false,
        reason: "error",
        message: `Mac returned ${res.status}`,
        detail: body.slice(0, 80) || base,
      };
    }

    const raw = (await res.json()) as {
      updatedAt?: number;
      updated_at?: number;
      events?: unknown;
    };

    const events = mapEvents(raw.events);
    await saveLocalSchedule(events);
    await savePairing({
      ...pairing,
      lastSyncAt: Date.now(),
    });

    return {
      ok: true,
      events,
      updatedAt: Number(raw.updatedAt ?? raw.updated_at ?? Date.now()),
      host: `${pairing.host}:${pairing.port}`,
    };
  } catch (e) {
    clearTimeout(timer);
    const name = e instanceof Error ? e.name : "";
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      reason: "offline",
      message:
        name === "AbortError"
          ? "Timed out reaching Mac"
          : "Can't reach Mac — check Wi‑Fi / Local Network",
      detail: msg,
    };
  }
}

export async function probeMac(pairing: Pairing): Promise<boolean> {
  try {
    const url = `http://${pairing.host}:${pairing.port}/health`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3000);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  }
}
