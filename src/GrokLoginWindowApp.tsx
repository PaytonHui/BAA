/**
 * Standalone Grok login window — basic Grok for Binky (not 4.5).
 */
import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  MacWindowShell,
  useMacWindowClose,
} from "./components/MacWindowShell";

export default function GrokLoginWindowApp() {
  useEffect(() => {
    invoke("pin_to_all_spaces_cmd").catch(() => undefined);
    getCurrentWindow()
      .setVisibleOnAllWorkspaces(true)
      .catch(() => undefined);
    getCurrentWindow()
      .setAlwaysOnTop(true)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    let u: (() => void) | undefined;
    void listen("login-window-shown", () => {
      /* form is ready */
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
            Make Binky your AI assistant
          </h2>
          <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-black/[0.06] text-[#8E8E93]">
            Coming soon
          </span>
        </div>
        <p className="text-[12px] text-[#636366] leading-snug">
          AI chat is coming soon. Use calendar and share for now.
        </p>
        <button
          type="button"
          disabled
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
    </MacWindowShell>
  );
}
