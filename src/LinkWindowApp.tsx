/**
 * Standalone Link iPhone window — pet WebGL never resizes.
 */
import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LinkPhonePanel } from "./components/LinkPhonePanel";
import {
  MacWindowShell,
  useMacWindowClose,
} from "./components/MacWindowShell";

export default function LinkWindowApp() {
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
    void listen("link-window-shown", () => {
      /* panel self-refreshes via interval */
    }).then((fn) => {
      u = fn;
    });
    return () => u?.();
  }, []);

  const close = useMacWindowClose(async () => {
    await emit("link-closed", {}).catch(() => undefined);
  });

  return (
    <MacWindowShell
      shownEvent="link-window-shown"
      className="p-[18px] overflow-auto"
    >
      <LinkPhonePanel open onClose={() => void close()} />
    </MacWindowShell>
  );
}
