/**
 * Standalone light-color picker window — pet WebGL never resizes.
 */
import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ColorPicker } from "./components/ColorPicker";
import {
  MacWindowShell,
  useMacWindowClose,
} from "./components/MacWindowShell";
import { getNewJeansBirthdayToday } from "./lib/defaultCalendar";
import {
  loadLightColorMode,
  saveLightColorMode,
  type LightColorMode,
} from "./lib/lightColors";

export default function ColorWindowApp() {
  const [value, setValue] = useState<LightColorMode>(() => {
    const bday = getNewJeansBirthdayToday();
    return bday ? bday.color : loadLightColorMode();
  });
  const [birthdayLock, setBirthdayLock] = useState(() => {
    const b = getNewJeansBirthdayToday();
    return b
      ? { name: b.name, heart: b.heart, color: b.color as LightColorMode }
      : null;
  });

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
    const unsubs: Array<() => void> = [];
    const refresh = () => {
      const b = getNewJeansBirthdayToday();
      if (b) {
        setBirthdayLock({
          name: b.name,
          heart: b.heart,
          color: b.color,
        });
        setValue(b.color);
      } else {
        setBirthdayLock(null);
        setValue(loadLightColorMode());
      }
    };
    void listen("color-window-shown", refresh).then((u) => unsubs.push(u));
    void listen("color-window-data", refresh).then((u) => unsubs.push(u));
    return () => unsubs.forEach((u) => u());
  }, []);

  const close = useMacWindowClose(async () => {
    await emit("color-closed", {}).catch(() => undefined);
  });

  const onChange = useCallback((mode: LightColorMode) => {
    // Hard lock on member birthday
    if (getNewJeansBirthdayToday()) return;
    setValue(mode);
    saveLightColorMode(mode);
    void emit("color-changed", { mode }).catch(() => undefined);
  }, []);

  return (
    <MacWindowShell
      shownEvent="color-window-shown"
      className="p-[18px] overflow-y-auto"
    >
      <ColorPicker
        open
        value={value}
        onChange={onChange}
        onClose={() => void close()}
        birthdayLock={birthdayLock}
      />
    </MacWindowShell>
  );
}
