import { useState } from "react";
import { AnimatedPanel } from "./AnimatedPanel";
import { BUY_ME_A_COFFEE_QR, openBuyMeACoffee } from "../lib/donate";

interface ContextMenuProps {
  muted: boolean;
  open?: boolean;
  /**
   * Floating panel window mode (no side strip / no pet shell).
   * Used by MenuWindowApp so the main pet never resizes.
   */
  floating?: boolean;
  /** Which side the menu strip is on (beside the pet) — only for legacy shell */
  menuSide?: "left" | "right";
  onClose: () => void;
  onChat: () => void;
  onCalendar: () => void;
  onLightColor: () => void;
  onToggleMute: () => void;
  onSettings: () => void;
  onSyncCalendar: () => void;
  onHide: () => void;
  onQuit: () => void;
  onExited?: () => void;
  /** Support section open/closed — parent can resize the floating window */
  onSupportOpenChange?: (open: boolean) => void;
  /** When false, hide Chat in the function list */
  showChat?: boolean;
}

/**
 * Function list — solid light sheet (easy to read over desktop).
 * Prefer `floating` in a separate window so the pet never resizes.
 */
export function ContextMenu({
  muted,
  open = true,
  floating = false,
  menuSide = "right",
  onClose,
  onChat,
  onCalendar,
  onLightColor,
  onToggleMute,
  onSettings,
  onSyncCalendar,
  onHide,
  onQuit,
  onExited,
  onSupportOpenChange,
  showChat = true,
}: ContextMenuProps) {
  const [supportOpen, setSupportOpen] = useState(false);
  const [supportMsg, setSupportMsg] = useState<string | null>(null);

  const sideClass =
    menuSide === "right" ? "right-1 left-auto" : "left-1 right-auto";
  const origin = floating
    ? "center"
    : menuSide === "right"
      ? "left"
      : "right";

  const list = (
    <div
      className={`baa-ios-solid baa-ios-menu-sheet text-[13px] ${
        floating
          ? "w-full py-1"
          : "py-1 max-h-[min(380px,calc(100vh-12px))] overflow-y-auto"
      }`}
      role="menu"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {showChat && <MenuItem label="Chat" onClick={onChat} />}
      <MenuItem label="Calendar" onClick={onCalendar} />
      <MenuItem label="Light color" onClick={onLightColor} />
      <MuteSlideRow muted={muted} onToggle={onToggleMute} />
      <MenuItem label="Settings" onClick={onSettings} />
      <MenuItem
        label={supportOpen ? "Support BAA ▾" : "Support BAA ▸"}
        onClick={() => {
          setSupportOpen((v) => {
            const next = !v;
            onSupportOpenChange?.(next);
            return next;
          });
          setSupportMsg(null);
        }}
      />
      {supportOpen && (
        <div
          className="mx-2.5 mb-1.5 mt-0.5 rounded-2xl border border-black/[0.06] bg-black/[0.03] px-2.5 py-2.5 space-y-2"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <p className="text-[11px] text-[#8E8E93] leading-snug px-0.5">
            A coffee helps keep BAA growing. Thank you ☕
          </p>
          <img
            src={BUY_ME_A_COFFEE_QR}
            alt="Buy Me a Coffee QR code"
            className="w-full max-w-[148px] mx-auto aspect-square rounded-xl object-contain bg-white border border-black/[0.06]"
            draggable={false}
          />
          <button
            type="button"
            onClick={() => {
              void openBuyMeACoffee()
                .then(() => setSupportMsg("Opened Buy Me a Coffee"))
                .catch(() => setSupportMsg("Couldn’t open the page"));
            }}
            className="baa-ios-btn w-full text-[12px] py-2 font-semibold text-[#1C1C1E]"
            style={{
              background:
                "linear-gradient(135deg, #FFDD00 0%, #FFCC00 50%, #FFB800 100%)",
              boxShadow: "0 1px 2px rgba(0,0,0,0.08)",
            }}
          >
            Buy me a coffee ☕
          </button>
          {supportMsg && (
            <p className="text-[11px] text-[#007AFF] font-medium text-center">
              {supportMsg}
            </p>
          )}
        </div>
      )}
      <div className="my-0.5 mx-3.5 h-px bg-black/[0.08]" />
      <MenuItem label="Sync to Calendar" onClick={onSyncCalendar} />
      <div className="my-0.5 mx-3.5 h-px bg-black/[0.08]" />
      <MenuItem label="Pause BAA" onClick={onHide} />
      <MenuItem label="Quit BAA" danger onClick={onQuit} />
    </div>
  );

  if (floating) {
    return (
      <AnimatedPanel open={open} origin="center" className="w-full" onExited={onExited}>
        {list}
      </AnimatedPanel>
    );
  }

  return (
    <>
      {open && (
        <button
          type="button"
          className={`fixed z-30 cursor-default bg-transparent top-0 bottom-0 w-[188px] ${sideClass}`}
          aria-label="Close menu"
          onClick={(e) => {
            e.preventDefault();
            onClose();
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }}
        />
      )}
      <AnimatedPanel
        open={open}
        origin={origin}
        className={`fixed z-40 bottom-2 w-[172px] ${sideClass}`}
        onExited={onExited}
      >
        {list}
      </AnimatedPanel>
    </>
  );
}

function MenuItem({
  label,
  onClick,
  danger,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`baa-ios-menu-item w-full text-left px-3.5 py-1.5 tracking-[-0.01em] ${
        danger ? "text-[#FF3B30] font-medium" : "text-[#1C1C1E]"
      }`}
    >
      {label}
    </button>
  );
}

function MuteSlideRow({
  muted,
  onToggle,
}: {
  muted: boolean;
  onToggle: () => void;
}) {
  const on = !muted;
  return (
    <div
      role="menuitemcheckbox"
      aria-checked={on}
      className="baa-ios-menu-item flex items-center justify-between gap-2 px-3.5 py-1.5"
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <span className="text-[13px] text-[#1C1C1E] select-none tracking-[-0.01em]">
        Sound
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={on ? "Sound on" : "Sound muted"}
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        className={`baa-ios-toggle ${on ? "on" : "off"}`}
      >
        <span className="baa-ios-toggle-knob" />
      </button>
    </div>
  );
}
