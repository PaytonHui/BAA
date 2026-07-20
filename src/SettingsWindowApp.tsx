/**
 * Standalone settings window — pet WebGL never resizes.
 */
import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { SettingsModal } from "./components/SettingsModal";
import {
  MacWindowShell,
  useMacWindowClose,
} from "./components/MacWindowShell";
import { isMuted, toggleMuted } from "./lib/sounds";
import type { AppConfig } from "./types";

export default function SettingsWindowApp() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [muted, setMuted] = useState(() => isMuted());

  useEffect(() => {
    invoke("pin_to_all_spaces_cmd").catch(() => undefined);
    getCurrentWindow()
      .setVisibleOnAllWorkspaces(true)
      .catch(() => undefined);
    getCurrentWindow()
      .setAlwaysOnTop(true)
      .catch(() => undefined);
    invoke<AppConfig>("get_config")
      .then(setConfig)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const unsubs: Array<() => void> = [];
    const refresh = () => {
      invoke<AppConfig>("get_config")
        .then(setConfig)
        .catch(() => undefined);
      setMuted(isMuted());
    };
    void listen("settings-window-shown", refresh).then((u) => unsubs.push(u));
    void listen("settings-window-data", refresh).then((u) => unsubs.push(u));
    return () => unsubs.forEach((u) => u());
  }, []);

  const close = useMacWindowClose(async () => {
    await emit("settings-closed", {}).catch(() => undefined);
  });

  const onSave = useCallback(async (cfg: AppConfig) => {
    await invoke("save_config", { cfg });
    setConfig(cfg);
    await emit("settings-saved", { cfg }).catch(() => undefined);
  }, []);

  const onToggleMute = useCallback(() => {
    const next = toggleMuted();
    setMuted(next);
    void emit("mute-changed", { muted: next }).catch(() => undefined);
  }, []);

  return (
    <MacWindowShell
      shownEvent="settings-window-shown"
      className="p-[18px] overflow-y-auto"
    >
      <SettingsModal
        open
        initial={config}
        muted={muted}
        onToggleMute={onToggleMute}
        onClose={() => void close()}
        onSave={onSave}
      />
    </MacWindowShell>
  );
}
