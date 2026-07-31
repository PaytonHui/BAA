/**
 * Standalone chat window (no WebGL pet).
 * Lives in a separate Tauri window so opening chat never resizes the pet window.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ChatPanel } from "./components/ChatPanel";
import type { GrokAuthStatus } from "./components/GrokLoginForm";
import {
  MacWindowShell,
  useMacWindowClose,
} from "./components/MacWindowShell";
import {
  applyScheduleCancels,
  applyScheduleUpserts,
  eventCategory,
  extractScheduleFromReply,
  flushScheduleToDisk,
  formatCancelledSummary,
  formatMarkedSummary,
  formatUpdatedSummary,
  hydrateSchedule,
  loadSchedule,
  fallbackEventsFromUserRequest,
  looksLikeScheduleRequest,
  reloadScheduleFromDisk,
  resolveScheduleEventsFromChat,
  saveSchedule,
  saveScheduleAsync,
  todayKey,
  type ScheduleEvent,
} from "./lib/schedule";
// applyScheduleUpserts used for optimistic local mark before disk sync
import type {
  ChatAttachment,
  ChatMessage,
  ChatResponse,
  PetExpression,
} from "./types";

function id() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Detect weather questions so the pet can play weather FX */
function looksLikeWeatherAsk(text: string): boolean {
  const t = text.toLowerCase().trim();
  if (!t) return false;
  if (
    /\b(weather|forecast|temperature|umbrella|rainy|raining|snowy|snowing|sunny|humid|humidity|celsius|fahrenheit)\b/.test(
      t
    )
  ) {
    return true;
  }
  if (
    /\b(how('s| is|s)|what('s| is|s)|will it)\b.*\b(outside|out there|cold|hot|warm|rain|snow|storm)\b/.test(
      t
    )
  ) {
    return true;
  }
  // Common CJK weather asks
  if (/天气|天氣|気温|氣溫|下雨|下雪|多少度/.test(text)) return true;
  return false;
}

const WELCOME: ChatMessage = {
  id: "welcome",
  role: "assistant",
  content:
    "Hey Bunnies 🐰 I'm Binky. Chat with me here — if you tell me your plans (e.g. “meeting tomorrow 3pm”), I'll mark them on my calendar automatically!",
  at: Date.now(),
};

const MSG_KEY = "binky-chat-messages-v1";

function loadMessages(): ChatMessage[] {
  try {
    const raw = localStorage.getItem(MSG_KEY);
    if (!raw) return [WELCOME];
    const parsed = JSON.parse(raw) as ChatMessage[];
    return Array.isArray(parsed) && parsed.length ? parsed : [WELCOME];
  } catch {
    return [WELCOME];
  }
}

function saveMessages(msgs: ChatMessage[]) {
  try {
    // Drop huge base64 attachments when persisting
    const slim = msgs.map((m) => ({
      ...m,
      attachments: m.attachments?.map((a) =>
        a.kind === "image"
          ? { ...a, dataUrl: a.dataUrl ? "[image]" : undefined }
          : a
      ),
    }));
    localStorage.setItem(MSG_KEY, JSON.stringify(slim.slice(-80)));
  } catch {
    /* quota */
  }
}

export default function ChatWindowApp() {
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadMessages());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [large, setLarge] = useState(false);
  const [auth, setAuth] = useState<GrokAuthStatus | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const loadingRef = useRef(false);

  const refreshAuth = useCallback(async () => {
    try {
      const s = await invoke<GrokAuthStatus>("grok_auth_status");
      setAuth(s);
    } catch {
      setAuth({ loggedIn: false, model: "basic" });
    } finally {
      setAuthReady(true);
    }
  }, []);

  useEffect(() => {
    saveMessages(messages);
  }, [messages]);

  useEffect(() => {
    // Pin this overlay window to all Spaces like the pet
    invoke("pin_to_all_spaces_cmd").catch(() => undefined);
    getCurrentWindow()
      .setVisibleOnAllWorkspaces(true)
      .catch(() => undefined);
    getCurrentWindow()
      .setAlwaysOnTop(true)
      .catch(() => undefined);
    void refreshAuth();
    // Shared disk schedule (same as main / calendar)
    void hydrateSchedule();
  }, [refreshAuth]);

  useEffect(() => {
    let u1: (() => void) | undefined;
    let u2: (() => void) | undefined;
    let u3: (() => void) | undefined;
    void listen<{ large?: boolean }>("chat-window-shown", () => {
      void refreshAuth();
    }).then((fn) => {
      u1 = fn;
    });
    void listen("grok-logged-in", () => {
      void refreshAuth();
    }).then((fn) => {
      u3 = fn;
    });
    void listen<{ large: boolean }>("chat-window-size", (ev) => {
      setLarge(!!ev.payload?.large);
    }).then((fn) => {
      u2 = fn;
    });
    return () => {
      u1?.();
      u2?.();
      u3?.();
    };
  }, [refreshAuth]);

  // Flush memory → disk when main window Syncs to Apple Calendar
  useEffect(() => {
    let un: (() => void) | undefined;
    void listen("schedule-flush-request", () => {
      void (async () => {
        try {
          const list = await flushScheduleToDisk();
          await emit("schedule-flush-reply", {
            events: list,
            source: "chat",
          }).catch(() => undefined);
        } catch {
          await emit("schedule-flush-reply", {
            events: loadSchedule(),
            source: "chat",
          }).catch(() => undefined);
        }
      })();
    }).then((fn) => {
      un = fn;
    });
    return () => un?.();
  }, []);

  const notifyPet = useCallback(
    async (expression: PetExpression, anim?: string) => {
      await emit("chat-to-pet", { expression, anim }).catch(() => undefined);
    },
    []
  );

  const needsLogin = authReady && !auth?.loggedIn;

  const close = useMacWindowClose(async () => {
    await emit("chat-closed", {}).catch(() => undefined);
  });

  /**
   * Add new plans or update matching ones (e.g. change category work ↔ other).
   * Awaits disk save so calendar reload sees data immediately.
   */
  const upsertScheduleEvents = useCallback(
    async (
      incoming: Omit<ScheduleEvent, "id" | "createdAt">[]
    ): Promise<{ added: ScheduleEvent[]; updated: ScheduleEvent[] }> => {
      if (!incoming.length) return { added: [], updated: [] };
      // Prefer disk, but never hang the chat UI if IPC is slow
      let prev: ScheduleEvent[];
      try {
        prev = await reloadScheduleFromDisk();
      } catch {
        prev = loadSchedule();
      }
      const { next, added, updated } = applyScheduleUpserts(prev, incoming);
      if (!added.length && !updated.length) {
        return { added: [], updated: [] };
      }
      // Write memory + localStorage immediately so UI sees the mark
      try {
        await saveScheduleAsync(next);
      } catch {
        // Still keep local write from saveScheduleAsync's first lines
        saveSchedule(next);
      }
      void emit("schedule-updated", {}).catch(() => undefined);
      return { added, updated };
    },
    []
  );

  /** Apply cancels from chat; returns events actually removed */
  const cancelScheduleEvents = useCallback(
    async (
      cancels: Omit<ScheduleEvent, "id" | "createdAt">[]
    ): Promise<ScheduleEvent[]> => {
      if (!cancels.length) return [];
      let prev: ScheduleEvent[];
      try {
        prev = await reloadScheduleFromDisk();
      } catch {
        prev = loadSchedule();
      }
      const { remaining, removed } = applyScheduleCancels(prev, cancels);
      if (!removed.length) return [];
      try {
        await saveScheduleAsync(remaining);
      } catch {
        saveSchedule(remaining);
      }
      void emit("schedule-updated", {}).catch(() => undefined);
      return removed;
    },
    []
  );

  const errText = (e: unknown): string => {
    if (typeof e === "string") return e;
    if (e instanceof Error) return e.message;
    if (e && typeof e === "object") {
      const o = e as { message?: unknown; error?: unknown };
      if (typeof o.message === "string" && o.message.trim()) return o.message;
      if (typeof o.error === "string" && o.error.trim()) return o.error;
      try {
        return JSON.stringify(e);
      } catch {
        /* fall through */
      }
    }
    return "Request failed";
  };

  const pickReplyText = (res: unknown): string => {
    if (res == null) return "";
    if (typeof res === "string") return res;
    if (typeof res !== "object") return String(res);
    const o = res as Record<string, unknown>;
    if (typeof o.message === "string") return o.message;
    if (typeof o.Message === "string") return o.Message;
    if (o.data != null) return pickReplyText(o.data);
    return "";
  };

  const withTimeout = <T,>(p: Promise<T>, ms: number, label: string) =>
    new Promise<T>((resolve, reject) => {
      const t = window.setTimeout(
        () => reject(new Error(`${label} timed out after ${ms / 1000}s`)),
        ms
      );
      p.then(
        (v) => {
          window.clearTimeout(t);
          resolve(v);
        },
        (e) => {
          window.clearTimeout(t);
          reject(e);
        }
      );
    });

  const sendMessage = async (
    text: string,
    attachments: ChatAttachment[] = []
  ) => {
    if (loadingRef.current) return;
    if (!auth?.loggedIn) {
      setError("Sign in to basic Grok first to chat with Binky.");
      // Refresh in case key was saved from another panel
      void refreshAuth();
      return;
    }
    loadingRef.current = true;
    setLoading(true);
    setError(null);
    void notifyPet("thinking");

    // Pet shows weather FX whenever user asks about the weather
    if (looksLikeWeatherAsk(text)) {
      void emit("show-weather-fx", { source: "chat" }).catch(() => undefined);
    }

    const userMsg: ChatMessage = {
      id: id(),
      role: "user",
      content: text,
      at: Date.now(),
      kind: "text",
      attachments: attachments.length ? attachments : undefined,
    };
    // Short history — huge flyer threads made chat hang after Grok replied
    const history = [...messages, userMsg]
      .filter((m) => m.role === "user" || m.role === "assistant")
      .slice(-8)
      .map((m) => ({
        ...m,
        // never re-send giant base64 images from older turns
        attachments:
          m.id === userMsg.id
            ? m.attachments
            : m.attachments?.map((a) =>
                a.kind === "image" ? { ...a, dataUrl: undefined } : a
              ),
      }));
    setMessages((prev) => [...prev, userMsg]);

    const finishLoading = () => {
      loadingRef.current = false;
      setLoading(false);
    };

    try {
      const wantSchedule = looksLikeScheduleRequest(text);
      let calendarHint = "";
      if (wantSchedule) {
        const schedule = loadSchedule();
        const upcoming = schedule
          .slice()
          .sort((a, b) => a.date.localeCompare(b.date))
          .slice(0, 12)
          .map((e) => {
            const cat = eventCategory(e);
            return `- ${e.date}${e.time ? ` ${e.time}` : ""}: ${e.title} [${cat}]`;
          })
          .join("\n");

        calendarHint =
          `\n\n[For Binky calendar — REQUIRED machine lines, do not quote this block] Today=${todayKey()}. ` +
          `Categories: work (remind 3h before) | other (remind 1h before). ` +
          `CRITICAL: Any time I ask to mark / add / schedule / remember / put something on the calendar, ` +
          `OR I paste an event flyer (Event Date / 賽事日期 / race / run with dates), ` +
          `you MUST end your reply with this EXACT line (no markdown code fence):\n` +
          `SCHEDULE_JSON:[{"date":"YYYY-MM-DD","title":"...","time":"HH:mm start or omit","endTime":"HH:mm end or omit","endDate":"YYYY-MM-DD if multi-day","category":"work|school|event|family|friends"}]\n` +
          `For date RANGES set date=start and endDate=end. For time ranges set time=start and endTime=end. ` +
          `If I asked to CANCEL/REMOVE/DELETE, end with CANCEL_SCHEDULE_JSON:[{"date":"YYYY-MM-DD","title":"..."}].` +
          (upcoming
            ? ` Already saved:\n${upcoming}`
            : " Calendar empty.");
      }

      const messagesForApi = history.map((m, i) => {
        const isLastUser = i === history.length - 1 && m.role === "user";
        let content = m.content;
        // Cap each prior message so old flyer pastes cannot blow up the request
        if (!isLastUser && content.length > 800) {
          content = content.slice(0, 800) + "…";
        }
        if (isLastUser && calendarHint) content = content + calendarHint;
        const atts = isLastUser ? attachments : undefined;
        if (!atts?.length) return { role: m.role, content };
        return {
          role: m.role,
          content,
          attachments: atts.map((a) => ({
            name: a.name,
            mime: a.mime,
            kind: a.kind,
            dataUrl: a.dataUrl,
            textContent: a.textContent,
          })),
        };
      });

      const res = await withTimeout(
        invoke<ChatResponse>("chat_with_grok", {
          req: {
            messages: messagesForApi,
            today: todayKey(),
          },
        }),
        35000,
        "Grok chat"
      );

      const rawReply = pickReplyText(res).trim();
      if (!rawReply) {
        throw new Error(
          `Grok returned an empty reply (${JSON.stringify(res).slice(0, 120)}). Try again.`
        );
      }

      // Parse schedule offline (sync) — never block chat on disk IPC
      let display = rawReply;
      let newEv: Omit<ScheduleEvent, "id" | "createdAt">[] = [];
      let cancels: Omit<ScheduleEvent, "id" | "createdAt">[] = [];
      try {
        const extracted = extractScheduleFromReply(rawReply);
        display = extracted.message || rawReply;
        cancels = extracted.cancels;
        newEv = !cancels.length
          ? resolveScheduleEventsFromChat(text, extracted.events, todayKey())
          : extracted.events;
        // Last resort: Grok forgot SCHEDULE_JSON and resolver returned empty
        if (!cancels.length && !newEv.length && wantSchedule) {
          newEv = fallbackEventsFromUserRequest(text, todayKey());
        }
      } catch {
        display = rawReply;
        if (wantSchedule) {
          newEv = fallbackEventsFromUserRequest(text, todayKey());
        }
      }

      // Optimistic local mark (memory + localStorage) so calendar UI can refresh
      let quickNote = "";
      try {
        if (newEv.length) {
          const prev = loadSchedule();
          const { next, added, updated } = applyScheduleUpserts(prev, newEv);
          if (added.length || updated.length) {
            saveSchedule(next);
            void emit("schedule-updated", {}).catch(() => undefined);
            if (added.length) quickNote = formatMarkedSummary(added);
            else if (updated.length) quickNote = formatUpdatedSummary(updated);
          } else {
            quickNote =
              "ℹ️ That plan is already on the calendar with the same details.";
          }
        } else if (wantSchedule) {
          quickNote =
            "⚠️ Couldn’t parse a plan from that. Try: “聽日3點開會” or “dinner tomorrow 8pm”.";
        }
      } catch {
        /* ignore optimistic mark errors */
      }

      if (quickNote) display = `${display}\n\n${quickNote}`;

      const assistantId = id();
      setMessages((prev) => [
        ...prev,
        {
          id: assistantId,
          role: "assistant",
          content: display,
          at: Date.now(),
          kind: "text",
        },
      ]);
      // Stop “typing…” immediately — disk sync continues in background
      finishLoading();

      const expr =
        (typeof res === "object" &&
        res &&
        "expression" in res &&
        typeof (res as ChatResponse).expression === "string"
          ? ((res as ChatResponse).expression as PetExpression)
          : "happy") || "happy";
      void notifyPet(expr === "thinking" ? "happy" : expr, "color");

      // Background: ensure disk + cancels (with timeouts inside helpers)
      void (async () => {
        try {
          if (newEv.length) await upsertScheduleEvents(newEv);
          if (cancels.length) {
            const removed = await cancelScheduleEvents(cancels);
            if (removed.length) {
              const note = formatCancelledSummary(removed);
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? { ...m, content: `${m.content}\n\n${note}` }
                    : m
                )
              );
            }
          }
        } catch (calErr) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    content: `${m.content}\n\n⚠️ Calendar disk sync: ${errText(calErr)}`,
                  }
                : m
            )
          );
        }
      })();
      return;
    } catch (e) {
      const msg = errText(e).replace(/^NOT_LOGGED_IN:\s*/i, "");
      if (
        msg.includes("NOT_LOGGED_IN") ||
        msg.toLowerCase().includes("login")
      ) {
        setAuth((a) => (a ? { ...a, loggedIn: false } : a));
      }
      // Even if Grok fails, still try offline calendar mark from user text
      let offlineNote = "";
      try {
        if (looksLikeScheduleRequest(text)) {
          const offline = fallbackEventsFromUserRequest(text, todayKey());
          if (offline.length) {
            const prev = loadSchedule();
            const { next, added, updated } = applyScheduleUpserts(prev, offline);
            if (added.length || updated.length) {
              saveSchedule(next);
              void emit("schedule-updated", {}).catch(() => undefined);
              void upsertScheduleEvents(offline).catch(() => undefined);
              offlineNote = added.length
                ? `\n\n${formatMarkedSummary(added)}`
                : `\n\n${formatUpdatedSummary(updated)}`;
            }
          }
        }
      } catch {
        /* ignore */
      }
      setError(msg);
      setMessages((prev) => [
        ...prev,
        {
          id: id(),
          role: "assistant",
          content: `⚠️ ${msg}${offlineNote}`,
          at: Date.now(),
          kind: "text",
        },
      ]);
      void notifyPet("sad");
    } finally {
      finishLoading();
    }
  };

  const sendSticker = async (stickerId: string, emoji: string) => {
    if (loadingRef.current) return;
    if (!auth?.loggedIn) {
      setError("Sign in to basic Grok first to chat with Binky.");
      return;
    }
    loadingRef.current = true;
    setLoading(true);
    setError(null);
    const anim =
      stickerId === "heart" || stickerId === "love" || emoji === "💗"
        ? "hearts"
        : "happy";
    void notifyPet("happy", anim);

    const userMsg: ChatMessage = {
      id: id(),
      role: "user",
      content: emoji,
      at: Date.now(),
      kind: "sticker",
      stickerId,
    };
    const next = [...messages, userMsg];
    setMessages(next);

    try {
      const res = await withTimeout(
        invoke<ChatResponse>("chat_with_grok", {
          req: {
            messages: next
              .slice(-8)
              .map(({ role, content, kind }) => ({
                role,
                content:
                  kind === "sticker" ? `(sent a sticker: ${content})` : content,
              })),
            today: todayKey(),
          },
        }),
        35000,
        "Grok chat"
      );
      const raw = pickReplyText(res).trim() || "…";
      let clean = raw;
      try {
        clean = extractScheduleFromReply(raw).message || raw;
      } catch {
        clean = raw;
      }
      setMessages((prev) => [
        ...prev,
        {
          id: id(),
          role: "assistant",
          content: clean,
          at: Date.now(),
          kind: "text",
        },
      ]);
      void notifyPet("happy", "color");
    } catch (e) {
      const msg = errText(e);
      setError(msg);
      setMessages((prev) => [
        ...prev,
        {
          id: id(),
          role: "assistant",
          content: `⚠️ ${msg}`,
          at: Date.now(),
          kind: "text",
        },
      ]);
      void notifyPet("sad");
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  };

  const toggleSize = async () => {
    const next = !large;
    setLarge(next);
    // Main window owns reposition (knows pet location); ask it to resize us
    await emit("chat-toggle-size", { large: next }).catch(() => undefined);
  };

  if (!authReady) {
    return (
      <div className="w-full h-full bg-transparent flex items-center justify-center p-2">
        <p className="text-[11px] text-slate-400">Loading…</p>
      </div>
    );
  }

  // AI chat is coming soon — no login / no chat for now
  const AI_CHAT_COMING_SOON = true;
  if (AI_CHAT_COMING_SOON || needsLogin) {
    return (
      <MacWindowShell
        shownEvent="chat-window-shown"
        forceInteractive
        className="p-[14px] overflow-y-auto overflow-x-hidden"
      >
        <div className="w-full min-h-full flex items-start justify-center py-1">
          <div
            className="baa-ios-solid text-[#1C1C1E] p-4 space-y-3 w-full max-w-[300px]"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-[16px] font-semibold tracking-[-0.02em] leading-snug">
                Make Binky your AI assistant
              </h2>
              <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-black/[0.06] text-[#8E8E93]">
                Coming soon
              </span>
            </div>
            <p className="text-[12px] text-[#636366] leading-snug">
              Chat with Binky as your AI assistant is on the way. For now, use
              the calendar — add plans yourself and Sync to Calendar.
            </p>
            <button
              type="button"
              disabled
              aria-disabled="true"
              className="baa-ios-btn baa-ios-btn-primary w-full py-2.5 text-[13px] opacity-40 cursor-not-allowed pointer-events-none"
            >
              Make Binky my AI
            </button>
            <button
              type="button"
              onClick={() => void close()}
              className="baa-ios-btn baa-ios-btn-secondary w-full py-2.5 text-[13px]"
            >
              Back
            </button>
          </div>
        </div>
      </MacWindowShell>
    );
  }

  return (
    <MacWindowShell
      shownEvent="chat-window-shown"
      forceInteractive
      className="p-[18px] overflow-hidden"
    >
      <div className="w-full h-full flex flex-col items-stretch justify-center gap-1 min-h-0">
        {auth?.displayName && (
          <p className="text-[9px] text-slate-500 text-center shrink-0 px-1">
            Basic Grok · {auth.displayName}
            {auth.keyHint ? ` · ${auth.keyHint}` : ""}
          </p>
        )}
        <ChatPanel
          open
          messages={messages}
          loading={loading}
          error={error}
          large={large}
          onToggleSize={() => void toggleSize()}
          onSend={sendMessage}
          onSendSticker={sendSticker}
          onClose={() => void close()}
        />
      </div>
    </MacWindowShell>
  );
}
