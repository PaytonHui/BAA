import { useEffect, useRef, useState } from "react";
import type { ChatAttachment, ChatMessage } from "../types";
import type { BubbleSide } from "../lib/windowLayout";
import { QUICK_REPLIES, STICKERS, stickerById } from "../lib/stickers";
import { playPop, playSticker } from "../lib/sounds";
import {
  canAddMore,
  fileToAttachment,
  formatSize,
  MAX_ATTACH,
} from "../lib/attachments";

interface ChatPanelProps {
  open: boolean;
  messages: ChatMessage[];
  loading: boolean;
  error: string | null;
  large?: boolean;
  onToggleSize?: () => void;
  onSend: (text: string, attachments?: ChatAttachment[]) => void;
  onSendSticker: (stickerId: string, emoji: string) => void;
  onClose: () => void;
  bubbleSide?: BubbleSide;
}

function formatTime(ts?: number) {
  const d = new Date(ts ?? Date.now());
  let h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${m} ${ampm}`;
}

function AttachmentsView({
  items,
  dark,
}: {
  items: ChatAttachment[];
  dark?: boolean;
}) {
  if (!items.length) return null;
  return (
    <div className="flex flex-col gap-1.5 mb-1.5">
      {items.map((a) =>
        a.kind === "image" && a.dataUrl ? (
          <img
            key={a.id}
            src={a.dataUrl}
            alt={a.name}
            className="max-w-[180px] max-h-[140px] rounded-xl object-cover border border-black/10"
          />
        ) : (
          <div
            key={a.id}
            className={`flex items-center gap-1.5 rounded-lg px-2 py-1 text-[10px] ${
              dark
                ? "bg-white/15 text-white"
                : "bg-white/70 border border-neutral-300 text-neutral-800"
            }`}
          >
            <span aria-hidden>{a.kind === "text" ? "📄" : "📎"}</span>
            <span className="truncate max-w-[140px] font-medium">{a.name}</span>
            <span className="opacity-70 shrink-0">{formatSize(a.size)}</span>
          </div>
        )
      )}
    </div>
  );
}

/**
 * Phoning-style chat with stickers + file/image attach.
 */
export function ChatPanel({
  open,
  messages,
  loading,
  error,
  large = false,
  onToggleSize,
  onSend,
  onSendSticker,
  onClose,
}: ChatPanelProps) {
  const [text, setText] = useState("");
  const [showStickers, setShowStickers] = useState(false);
  const [pending, setPending] = useState<ChatAttachment[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      const t = window.setTimeout(() => inputRef.current?.focus(), 80);
      return () => window.clearTimeout(t);
    }
  }, [open]);

  useEffect(() => {
    listRef.current?.scrollTo({
      top: listRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, loading, showStickers, pending]);

  // Parent may keep us mounted during exit animation (open=false briefly)
  // Always render when parent shows us; `open` still gates focus.

  const addFiles = async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (!list.length) return;
    setAttachError(null);
    const next = [...pending];
    for (const f of list) {
      if (!canAddMore(next.length)) {
        setAttachError(`Max ${MAX_ATTACH} files per message`);
        break;
      }
      try {
        next.push(await fileToAttachment(f));
      } catch (e) {
        setAttachError(e instanceof Error ? e.message : "Could not add file");
      }
    }
    setPending(next);
  };

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const v = text.trim();
    if ((!v && pending.length === 0) || loading) return;
    playPop();
    onSend(v || (pending.length ? "What do you think?" : ""), [...pending]);
    setText("");
    setPending([]);
    setShowStickers(false);
    setAttachError(null);
  };

  const sendQuick = (q: string) => {
    if (loading) return;
    playPop();
    onSend(q, pending.length ? [...pending] : undefined);
    setText("");
    setPending([]);
    setShowStickers(false);
  };

  const sendSticker = (id: string, emoji: string) => {
    if (loading) return;
    playSticker();
    onSendSticker(id, emoji);
    setShowStickers(false);
  };

  // Fill the shell (window already sizes the panel) so the composer is never
  // outside the hit-test region / clipped by fixed widths.
  const panelW = "w-full max-w-full";
  const panelH = "h-full max-h-full min-h-0";

  return (
    <div
      className={`panel-surface relative ${panelW} ${panelH} flex flex-col rounded-[22px] overflow-hidden shadow-none border border-black/10 bg-[#F7F7F8] ${
        dragging ? "ring-2 ring-[#5B8DEF]/50" : ""
      }`}
      onDragEnter={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (e.dataTransfer.files?.length) void addFiles(e.dataTransfer.files);
      }}
    >
      {/* —— Top bar —— */}
      <header className="shrink-0 flex items-center gap-1.5 px-2.5 py-2 bg-white/90 border-b border-black/[0.06] backdrop-blur-sm">
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

        <div className="min-w-0 flex-1 overflow-hidden">
          <p className="text-[13px] font-bold text-neutral-900 leading-tight truncate">
            Binky
          </p>
          {/* whitespace-nowrap + no truncate cut so "typing…" is fully visible */}
          <p
            className={`text-[10px] leading-snug whitespace-nowrap ${
              loading ? "text-[#5B8DEF] font-medium" : "text-neutral-400"
            }`}
          >
            {loading ? "typing…" : large ? "large chat" : "online"}
          </p>
        </div>

        {onToggleSize && !loading && (
          <button
            type="button"
            onClick={onToggleSize}
            className="shrink-0 text-[10px] px-2 py-1 rounded-full border border-neutral-200 bg-white hover:bg-neutral-50 text-neutral-700 font-semibold"
          >
            {large ? "Smaller" : "Bigger"}
          </button>
        )}
      </header>

      {/* —— Message thread —— */}
      <div
        ref={listRef}
        className="chat-scroll flex-1 min-h-0 overflow-y-auto px-2.5 py-2 space-y-2.5 bg-[#F7F7F8]"
      >
        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const showAvatar =
            m.role === "assistant" && (!prev || prev.role !== "assistant");
          const isUser = m.role === "user";
          const isSticker = m.kind === "sticker";
          const stickerEmoji =
            m.stickerId && stickerById(m.stickerId)
              ? stickerById(m.stickerId)!.emoji
              : m.content;
          const atts = m.attachments || [];

          if (isUser) {
            return (
              <div key={m.id} className="flex justify-end pl-10">
                <div className="flex items-end gap-1.5 max-w-full">
                  <span className="shrink-0 text-[9px] text-neutral-400 mb-0.5 self-end">
                    {formatTime(m.at)}
                  </span>
                  {isSticker ? (
                    <div className="rounded-[18px] rounded-br-[6px] bg-[#5B8DEF]/15 border border-[#5B8DEF]/30 px-2.5 py-1.5 text-[28px] leading-none shadow-sm">
                      {stickerEmoji}
                    </div>
                  ) : (
                    <div className="rounded-[18px] rounded-br-[6px] bg-[#5B8DEF] text-white px-3 py-2 text-[12px] leading-snug whitespace-pre-wrap break-words shadow-sm max-w-[88%]">
                      <AttachmentsView items={atts} dark />
                      {m.content}
                    </div>
                  )}
                </div>
              </div>
            );
          }

          return (
            <div key={m.id} className="flex items-start gap-1.5 pr-2">
              <div className="w-8 shrink-0 pt-4">
                {showAvatar ? (
                  <img
                    src="/avatars/lightstick-icon.png?v=classic-face"
                    alt="Binky"
                    className="w-8 h-8 rounded-full object-cover object-[center_70%] ring-1 ring-black/5 bg-[#B8E6FF]"
                    draggable={false}
                  />
                ) : (
                  <div className="w-8 h-8" />
                )}
              </div>

              <div className="min-w-0 flex-1">
                {showAvatar && (
                  <p className="text-[11px] font-semibold text-neutral-700 mb-0.5 ml-0.5">
                    Binky
                  </p>
                )}
                <div className="flex items-end gap-1.5">
                  <div className="max-w-[88%] rounded-[18px] rounded-tl-[6px] border border-neutral-800/80 bg-[#B8EF9A] text-neutral-900 px-3 py-2 text-[12px] leading-snug whitespace-pre-wrap break-words shadow-[0_1px_0_rgba(0,0,0,0.04)]">
                    {m.content}
                  </div>
                  <div className="shrink-0 flex flex-col items-start gap-0.5 mb-0.5">
                    <span className="text-[9px] text-neutral-400 whitespace-nowrap">
                      {formatTime(m.at)}
                    </span>
                    <span
                      className="text-[8px] text-neutral-300 leading-none"
                      aria-hidden
                    >
                      ✈
                    </span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}

        {loading && (
          <div className="flex items-start gap-1.5 pr-2">
            <div className="w-8 shrink-0">
              <img
                src="/avatars/lightstick-icon.png?v=classic-face"
                alt=""
                className="w-8 h-8 rounded-full object-cover object-[center_70%] ring-1 ring-black/5 bg-[#B8E6FF]"
                draggable={false}
              />
            </div>
            <div>
              <p className="text-[11px] font-semibold text-neutral-700 mb-0.5 ml-0.5">
                Binky
              </p>
              <div className="inline-flex gap-1 items-center rounded-[18px] rounded-tl-[6px] border border-neutral-800/80 bg-[#B8EF9A] px-3 py-2">
                <span className="w-1.5 h-1.5 rounded-full bg-neutral-600/50 animate-bounce" />
                <span className="w-1.5 h-1.5 rounded-full bg-neutral-600/50 animate-bounce [animation-delay:120ms]" />
                <span className="w-1.5 h-1.5 rounded-full bg-neutral-600/50 animate-bounce [animation-delay:240ms]" />
              </div>
            </div>
          </div>
        )}

        {error && (
          <p className="text-[10px] text-rose-500 text-center px-2 whitespace-pre-wrap">
            {error}
          </p>
        )}
      </div>

      {/* —— Quick replies —— */}
      {!loading && (
        <div className="shrink-0 px-2 pt-1 pb-0.5 flex gap-1 overflow-x-auto chat-scroll bg-[#F7F7F8] border-t border-black/[0.04]">
          {QUICK_REPLIES.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => sendQuick(q)}
              className="shrink-0 text-[10px] font-medium px-2 py-1 rounded-full border border-neutral-200 bg-white hover:bg-neutral-50 text-neutral-700 whitespace-nowrap shadow-sm"
            >
              {q}
            </button>
          ))}
        </div>
      )}

      {/* —— Sticker tray —— */}
      {showStickers && (
        <div className="shrink-0 px-2 py-1.5 grid grid-cols-5 gap-1 bg-white border-t border-black/[0.06]">
          {STICKERS.map((s) => (
            <button
              key={s.id}
              type="button"
              disabled={loading}
              onClick={() => sendSticker(s.id, s.emoji)}
              className="h-8 rounded-lg hover:bg-neutral-100 text-[20px] leading-none flex items-center justify-center disabled:opacity-40"
            >
              {s.emoji}
            </button>
          ))}
        </div>
      )}

      {/* —— Pending attachments preview —— */}
      {pending.length > 0 && (
        <div className="shrink-0 px-2 py-1.5 flex gap-1.5 overflow-x-auto bg-white border-t border-black/[0.04]">
          {pending.map((a) => (
            <div
              key={a.id}
              className="relative shrink-0 rounded-lg border border-neutral-200 bg-[#F7F7F8] overflow-hidden"
            >
              {a.kind === "image" && a.dataUrl ? (
                <img
                  src={a.dataUrl}
                  alt={a.name}
                  className="w-14 h-14 object-cover"
                />
              ) : (
                <div className="w-14 h-14 flex flex-col items-center justify-center px-1">
                  <span className="text-sm">
                    {a.kind === "text" ? "📄" : "📎"}
                  </span>
                  <span className="text-[8px] text-neutral-600 truncate w-full text-center">
                    {a.name}
                  </span>
                </div>
              )}
              <button
                type="button"
                onClick={() =>
                  setPending((p) => p.filter((x) => x.id !== a.id))
                }
                className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-neutral-900 text-white text-[9px] leading-none"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {attachError && (
        <p className="shrink-0 px-2 py-0.5 text-[10px] text-rose-500 bg-white">
          {attachError}
        </p>
      )}

      {/* —— Composer —— */}
      <form
        onSubmit={submit}
        className="shrink-0 z-20 border-t border-black/[0.06] px-2 py-1.5 flex gap-1.5 items-center bg-white"
      >
        <input
          ref={fileRef}
          type="file"
          multiple
          accept="image/*,.txt,.md,.csv,.json,.log,.pdf,text/*"
          className="hidden"
          onChange={(e) => {
            if (e.target.files) void addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={loading || !canAddMore(pending.length)}
          className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm bg-neutral-100 hover:bg-neutral-200 disabled:opacity-40"
          aria-label="Attach file"
        >
          📎
        </button>
        <button
          type="button"
          onClick={() => setShowStickers((v) => !v)}
          className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-base ${
            showStickers
              ? "bg-neutral-200"
              : "bg-neutral-100 hover:bg-neutral-200"
          }`}
          aria-label="Stickers"
        >
          🐰
        </button>
        <input
          ref={inputRef}
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            const items = e.clipboardData?.items;
            if (!items) return;
            const files: File[] = [];
            for (const it of Array.from(items)) {
              if (it.kind === "file") {
                const f = it.getAsFile();
                if (f) files.push(f);
              }
            }
            if (files.length) {
              e.preventDefault();
              void addFiles(files);
            }
          }}
          placeholder="Message or drop files…"
          className="flex-1 min-w-0 h-9 rounded-full border border-neutral-200 bg-[#F7F7F8] px-3.5 text-[12px] text-neutral-900 placeholder:text-neutral-400 outline-none focus:border-neutral-400 focus:bg-white"
          disabled={loading}
        />
        <button
          type="submit"
          disabled={loading || (!text.trim() && pending.length === 0)}
          className="shrink-0 w-9 h-9 rounded-full bg-neutral-900 hover:bg-neutral-800 disabled:opacity-35 text-white flex items-center justify-center text-sm shadow-sm"
          aria-label="Send"
        >
          ✈
        </button>
      </form>
    </div>
  );
}
