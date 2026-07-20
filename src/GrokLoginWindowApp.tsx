/**
 * Standalone Grok login window — basic Grok for Binky (not 4.5).
 */
import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { GrokLoginForm } from "./components/GrokLoginForm";
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
      <GrokLoginForm
        onLoggedIn={async () => {
          await emit("grok-logged-in", {}).catch(() => undefined);
          await close();
        }}
        onCancel={() => void close()}
      />
    </MacWindowShell>
  );
}
