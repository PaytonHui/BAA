/**
 * Function list as a separate floating window — main pet never resizes
 * (same pattern as chat/calendar → no afterimage / jiggle).
 */
import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ContextMenu } from "./components/ContextMenu";
import {
  MacWindowShell,
  useMacWindowClose,
} from "./components/MacWindowShell";
import { isMuted, toggleMuted } from "./lib/sounds";
import {
  MENU_PANEL_H,
  MENU_PANEL_H_SUPPORT,
  MENU_PANEL_W,
  PANEL_SHADOW_PAD,
} from "./lib/windowLayout";

/** Comfortable function-list size; top is aligned with entity by positionNearPet. */
function menuWindowSize(supportOpen: boolean): LogicalSize {
  const h = supportOpen ? MENU_PANEL_H_SUPPORT : MENU_PANEL_H;
  const pad = PANEL_SHADOW_PAD * 2;
  return new LogicalSize(MENU_PANEL_W + pad, h + pad);
}

export type MenuAction =
  | "chat"
  | "calendar"
  | "color"
  | "settings"
  | "sync"
  | "airdrop"
  | "hide"
  | "quit";

export default function MenuWindowApp() {
  const [muted, setMuted] = useState(() => isMuted());
  const [open, setOpen] = useState(true);
  const [showChat, setShowChat] = useState(true);

  const refreshAuth = useCallback(async () => {
    // AI chat is coming soon — never show Chat in the function list
    setShowChat(false);
  }, []);

  useEffect(() => {
    invoke("pin_to_all_spaces_cmd").catch(() => undefined);
    getCurrentWindow()
      .setVisibleOnAllWorkspaces(true)
      .catch(() => undefined);
    getCurrentWindow()
      .setAlwaysOnTop(true)
      .catch(() => undefined);
    void refreshAuth();
  }, [refreshAuth]);

  useEffect(() => {
    const unsubs: Array<() => void> = [];
    const onShow = () => {
      setMuted(isMuted());
      setOpen(true);
      void refreshAuth();
      // Full list height so every item is visible
      void getCurrentWindow()
        .setSize(menuWindowSize(false))
        .catch(() => undefined);
    };
    void listen("menu-window-shown", onShow).then((u) => unsubs.push(u));
    void listen("menu-window-data", onShow).then((u) => unsubs.push(u));
    void listen("grok-logged-in", () => {
      void refreshAuth();
    }).then((u) => unsubs.push(u));
    void listen("grok-logged-out", () => {
      void refreshAuth();
    }).then((u) => unsubs.push(u));
    return () => unsubs.forEach((u) => u());
  }, [refreshAuth]);

  const onSupportOpenChange = useCallback((supportOpen: boolean) => {
    void getCurrentWindow()
      .setSize(menuWindowSize(supportOpen))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    let u: (() => void) | undefined;
    void listen<{ muted?: boolean }>("mute-changed", (ev) => {
      if (typeof ev.payload?.muted === "boolean") {
        setMuted(ev.payload.muted);
      }
    }).then((fn) => {
      u = fn;
    });
    return () => u?.();
  }, []);

  const close = useMacWindowClose(async () => {
    setOpen(false);
    await emit("menu-closed", {}).catch(() => undefined);
  });

  const act = useCallback(
    async (action: MenuAction) => {
      await emit("menu-action", { action }).catch(() => undefined);
      // Keep menu open only for quick local actions that need it
      if (action !== "sync" && action !== "airdrop") {
        await close();
      }
    },
    [close]
  );

  return (
    <MacWindowShell
      shownEvent="menu-window-shown"
      className="overflow-hidden"
      surfaceClassName="p-[18px] overflow-visible flex items-start justify-center content-start"
    >
      <ContextMenu
        floating
        open={open}
        muted={muted}
        showChat={showChat}
        onClose={() => void close()}
        onChat={() => void act("chat")}
        onCalendar={() => void act("calendar")}
        onLightColor={() => void act("color")}
        onToggleMute={() => {
          const next = toggleMuted();
          setMuted(next);
          void emit("mute-changed", { muted: next }).catch(() => undefined);
        }}
        onSettings={() => void act("settings")}
        onSyncCalendar={() => void act("sync")}
        onAirDropCalendar={() => void act("airdrop")}
        onHide={() => void act("hide")}
        onQuit={() => void act("quit")}
        onSupportOpenChange={onSupportOpenChange}
      />
    </MacWindowShell>
  );
}
