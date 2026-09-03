/**
 * Legacy login window — v0.2 uses on-device Apple Intelligence (no API key).
 * Kept so an old panel label still has a destination.
 */
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  MacWindowShell,
  useMacWindowClose,
} from "./components/MacWindowShell";
import type { AiStatus } from "./types";

export default function GrokLoginWindowApp() {
  const [ai, setAi] = useState<AiStatus | null>(null);

  useEffect(() => {
    invoke("pin_to_all_spaces_cmd").catch(() => undefined);
    getCurrentWindow()
      .setVisibleOnAllWorkspaces(true)
      .catch(() => undefined);
    getCurrentWindow()
      .setAlwaysOnTop(true)
      .catch(() => undefined);
    void invoke<AiStatus>("ai_status")
      .then(setAi)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    let u: (() => void) | undefined;
    void listen("login-window-shown", () => {
      void invoke<AiStatus>("ai_status")
        .then(setAi)
        .catch(() => undefined);
    }).then((fn) => {
      u = fn;
    });
    return () => u?.();
  }, []);

  const close = useMacWindowClose(async () => {
    await emit("login-closed", {}).catch(() => undefined);
  });

  return (
    <MacWindowShell
      shownEvent="login-window-shown"
      className="p-[18px] overflow-y-auto"
    >
      <div
        className="baa-ios-solid text-[#1C1C1E] p-4 space-y-3 w-full max-w-[300px]"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-[16px] font-semibold tracking-[-0.02em]">
            AI assistant
          </h2>
          <span
            className={`shrink-0 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${
              ai?.available
                ? "bg-[#34C759]/15 text-[#248A3D]"
                : "bg-black/[0.06] text-[#8E8E93]"
            }`}
          >
            {ai?.available ? "On-device" : "Needs setup"}
          </span>
        </div>
        <p className="text-[12px] text-[#636366] leading-snug">
          {ai?.available
            ? "Binky chats with on-device Apple Intelligence. No API key needed."
            : ai?.reason ||
              "Turn on Apple Intelligence in System Settings → Apple Intelligence & Siri."}
        </p>
        {!ai?.available && (
          <button
            type="button"
            className="baa-ios-btn baa-ios-btn-primary w-full py-2.5 text-[13px]"
            onClick={() => {
              void invoke("open_apple_intelligence_settings").catch(
                () => undefined
              );
            }}
          >
            Open Apple Intelligence settings
          </button>
        )}
        <button
          type="button"
          onClick={() => void close()}
          className="baa-ios-btn baa-ios-btn-secondary w-full py-2.5 text-[13px]"
        >
          Back
        </button>
      </div>
    </MacWindowShell>
  );
}
