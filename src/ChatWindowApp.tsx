/**
 * Standalone chat window (no WebGL pet).
 * Lives in a separate Tauri window so opening chat never resizes the pet window.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ChatPanel } from "./components/ChatPanel";
import {
  GrokLoginForm,
  type GrokAuthStatus,
} from "./components/GrokLoginForm";
import {
  MacWindowShell,
  useMacWindowClose,
} from "./components/MacWindowShell";
import {
  applyScheduleCancels,
  applyScheduleUpserts,
  eventCategory,
  extractScheduleFromReply,
  formatCancelledSummary,
  formatMarkedSummary,
  formatUpdatedSummary,
  hydrateSchedule,
  loadSchedule,
  saveSchedule,
  todayKey,
  type ScheduleEvent,
} from "./lib/schedule";
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
   */
  const upsertScheduleEvents = useCallback(
    (
      incoming: Omit<ScheduleEvent, "id" | "createdAt">[]
    ): { added: ScheduleEvent[]; updated: ScheduleEvent[] } => {
      if (!incoming.length) return { added: [], updated: [] };
      const prev = loadSchedule();
      const { next, added, updated } = applyScheduleUpserts(prev, incoming);
      if (!added.length && !updated.length) return { added: [], updated: [] };
      saveSchedule(next);
      void emit("schedule-updated", {}).catch(() => undefined);
      return { added, updated };
    },
    []
  );

  /** Apply cancels from chat; returns events actually removed */
  const cancelScheduleEvents = useCallback(
    (cancels: Omit<ScheduleEvent, "id" | "createdAt">[]): ScheduleEvent[] => {
      if (!cancels.length) return [];
      const prev = loadSchedule();
      const { remaining, removed } = applyScheduleCancels(prev, cancels);
      if (!removed.length) return [];
      saveSchedule(remaining);
      void emit("schedule-updated", {}).catch(() => undefined);
      return removed;
    },
    []
  );

  const sendMessage = async (
    text: string,
    attachments: ChatAttachment[] = []
  ) => {
    if (loadingRef.current) return;
    if (!auth?.loggedIn) {
      setError("Sign in to basic Grok first to chat with Binky.");
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
    const next = [...messages, userMsg];
    setMessages(next);

    try {
      const schedule = loadSchedule();
      const upcoming = schedule
        .slice()
        .sort((a, b) => a.date.localeCompare(b.date))
        .slice(0, 16)
        .map((e) => {
          const cat = eventCategory(e);
          return `- ${e.date}${e.time ? ` ${e.time}` : ""}: ${e.title} [${cat}]`;
        })
        .join("\n");

      const calendarHint =
        `\n\n[For Binky calendar — do not quote this block] Today=${todayKey()}. ` +
        `Categories: work (remind 3h before) | other (remind 1h before). ` +
        `If I asked to ADD a plan, end with SCHEDULE_JSON:[{"date":"YYYY-MM-DD","title":"...","time":"optional","category":"work|other"}]. ` +
        `If I asked to CHANGE TYPE/category of an existing plan (e.g. other→work, event→work, work→other), end with ` +
        `SCHEDULE_JSON:[{"date":"YYYY-MM-DD","title":"exact title from list","time":"if known","category":"work|other","action":"update"}] ` +
        `(match date+title from the saved list; always set the new category). ` +
        `If I asked to CANCEL/REMOVE/DELETE a plan, end with ` +
        `CANCEL_SCHEDULE_JSON:[{"date":"YYYY-MM-DD","title":"...","time":"optional"}]. ` +
        `Never claim you changed/cancelled something without the matching JSON.` +
        (upcoming ? ` Already saved (title [category]):\n${upcoming}` : " Calendar empty.");

      const messagesForApi = next.map((m, i) => {
        const isLastUser = i === next.length - 1 && m.role === "user";
        let content = m.content;
        if (isLastUser) content = content + calendarHint;
        const atts = isLastUser ? attachments : m.attachments;
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

      const res = await invoke<ChatResponse>("chat_with_grok", {
        req: {
          messages: messagesForApi,
          today: todayKey(),
        },
      });
      const {
        message: clean,
        events: newEv,
        cancels,
      } = extractScheduleFromReply(res.message);
      const { added, updated } = upsertScheduleEvents(newEv);
      const removed = cancelScheduleEvents(cancels);

      const replyParts = [clean];
      if (added.length) replyParts.push(formatMarkedSummary(added));
      if (updated.length) replyParts.push(formatUpdatedSummary(updated));
      if (newEv.length && !added.length && !updated.length) {
        replyParts.push(
          "ℹ️ That plan is already on the calendar with the same details."
        );
      }
      if (removed.length) replyParts.push(formatCancelledSummary(removed));
      else if (cancels.length && !removed.length) {
        replyParts.push(
          "⚠️ Couldn’t find a matching event on the calendar to remove — check the date/title."
        );
      }

      setMessages((prev) => [
        ...prev,
        {
          id: id(),
          role: "assistant",
          content: replyParts.filter(Boolean).join("\n\n"),
          at: Date.now(),
          kind: "text",
        },
      ]);
      const expr = (res.expression as PetExpression) || "happy";
      // Job done: quick color cycle flash on the stick
      void notifyPet(expr === "thinking" ? "happy" : expr, "color");
    } catch (e) {
      const msg = typeof e === "string" ? e : "Request failed";
      if (msg.includes("NOT_LOGGED_IN") || msg.toLowerCase().includes("login")) {
        setAuth((a) => (a ? { ...a, loggedIn: false } : a));
      }
      setError(msg.replace(/^NOT_LOGGED_IN:\s*/i, ""));
      void notifyPet("sad");
    } finally {
      loadingRef.current = false;
      setLoading(false);
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
      const res = await invoke<ChatResponse>("chat_with_grok", {
        req: {
          messages: next.map(({ role, content, kind }) => ({
            role,
            content:
              kind === "sticker" ? `(sent a sticker: ${content})` : content,
          })),
          today: todayKey(),
        },
      });
      const { message: clean } = extractScheduleFromReply(res.message);
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
      const msg = typeof e === "string" ? e : "Request failed";
      setError(msg);
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

  if (needsLogin) {
    return (
      <MacWindowShell
        shownEvent="chat-window-shown"
        className="p-[18px] overflow-auto"
      >
        <GrokLoginForm
          compact
          onLoggedIn={(s) => {
            setAuth(s);
            setError(null);
            void emit("grok-logged-in", {}).catch(() => undefined);
          }}
          onCancel={() => void close()}
        />
      </MacWindowShell>
    );
  }

  return (
    <MacWindowShell
      shownEvent="chat-window-shown"
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
