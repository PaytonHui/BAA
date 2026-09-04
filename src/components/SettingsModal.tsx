import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import type { AiStatus, AppConfig } from "../types";
import { resyncUserBirthdayEvents } from "../lib/defaultCalendar";
import {
  hydrateSchedule,
  loadSchedule,
  saveSchedule,
} from "../lib/schedule";
import {
  FAV_MEMBERS,
  loadUserProfile,
  saveUserProfile,
  type FavMemberId,
  type UserProfile,
  USER_BUNNY,
} from "../lib/userProfile";

interface SettingsModalProps {
  open: boolean;
  initial: AppConfig | null;
  muted?: boolean;
  onToggleMute?: () => void;
  onClose: () => void;
  onSave: (cfg: AppConfig) => Promise<void>;
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function daysInMonth(month: number | null): number {
  if (month == null) return 31;
  return new Date(2024, month, 0).getDate();
}

/**
 * Compact settings — premium iOS glass (chat/calendar unchanged).
 */
export function SettingsModal({
  open,
  initial,
  muted = false,
  onToggleMute,
  onClose,
  onSave: _onSave,
}: SettingsModalProps) {
  void _onSave;
  const [msg, setMsg] = useState<string | null>(null);
  const [profile, setProfile] = useState<UserProfile>(() => loadUserProfile());
  const [ai, setAi] = useState<AiStatus | null>(null);

  useEffect(() => {
    if (!open) return;
    setMsg(null);
    setProfile(loadUserProfile());
    void invoke<AiStatus>("ai_status")
      .then(setAi)
      .catch(() =>
        setAi({
          available: false,
          loggedIn: true,
          model: "apple-intelligence",
          reason: "Could not check Apple Intelligence.",
        })
      );
  }, [open, initial]);

  if (!open) return null;

  const persistProfile = (next: UserProfile) => {
    // Clamp day when month changes
    if (next.birthdayMonth != null && next.birthdayDay != null) {
      const max = daysInMonth(next.birthdayMonth);
      if (next.birthdayDay > max) next = { ...next, birthdayDay: max };
    }
    setProfile(next);
    saveUserProfile(next);
    // Re-seed calendar bunny marks for the new date
    void (async () => {
      await hydrateSchedule().catch(() => undefined);
      const nextEvents = resyncUserBirthdayEvents(loadSchedule());
      saveSchedule(nextEvents);
      void emit("schedule-updated", {}).catch(() => undefined);
      void emit("user-profile-changed", next).catch(() => undefined);
    })();
    setMsg("Saved");
  };

  const setMonth = (month: number | null) => {
    persistProfile({ ...profile, birthdayMonth: month });
  };
  const setDay = (day: number | null) => {
    persistProfile({ ...profile, birthdayDay: day });
  };
  const setFav = (id: FavMemberId | null) => {
    persistProfile({ ...profile, favMember: id });
  };

  const maxDay = daysInMonth(profile.birthdayMonth);

  return (
    <div
      className="panel-surface baa-ios-glass relative z-30 w-full max-w-[280px] max-h-full overflow-y-auto p-3 space-y-2.5"
      role="dialog"
      aria-label="Settings"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <img
            src="/avatars/lightstick-icon.png?v=classic-face"
            alt=""
            className="w-9 h-9 rounded-full object-cover object-[center_70%] ring-1 ring-black/5 bg-[#B8E6FF] shrink-0"
            draggable={false}
          />
          <div className="min-w-0">
            <h2 className="text-[16px] font-semibold tracking-[-0.02em] text-[#1C1C1E] leading-tight">
              Settings
            </h2>
            <p className="text-[11px] text-[#8E8E93] truncate">Binky</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="baa-ios-btn text-[15px] font-semibold text-[#007AFF] px-2.5 py-1 rounded-full hover:bg-black/[0.04]"
        >
          Done
        </button>
      </div>

      {onToggleMute && (
        <div className="baa-ios-card flex items-center justify-between gap-3 px-3.5 py-3">
          <span className="text-[14px] text-[#1C1C1E] tracking-[-0.01em]">
            Sounds
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={!muted}
            onClick={onToggleMute}
            className={`baa-ios-toggle ${!muted ? "on" : "off"}`}
          >
            <span className="baa-ios-toggle-knob" />
          </button>
        </div>
      )}

      {/* —— You (birthday + fav member) —— */}
      <div className="baa-ios-card px-3.5 py-3 space-y-2.5">
        <p className="text-[14px] font-semibold tracking-[-0.01em] text-[#1C1C1E]">
          You {USER_BUNNY}
        </p>

        <div className="space-y-1.5">
          <p className="text-[12px] font-semibold text-[#636366]">Birthday</p>
          <div className="flex gap-2">
            <label className="flex-1 min-w-0">
              <span className="sr-only">Month</span>
              <select
                className="w-full rounded-[12px] border border-black/[0.08] bg-white/90 px-2.5 py-2 text-[13px] text-[#1C1C1E]"
                value={profile.birthdayMonth ?? ""}
                onChange={(e) => {
                  const v = e.target.value;
                  setMonth(v === "" ? null : parseInt(v, 10));
                }}
              >
                <option value="">Month</option>
                {MONTHS.map((label, i) => (
                  <option key={label} value={i + 1}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="w-[88px] shrink-0">
              <span className="sr-only">Day</span>
              <select
                className="w-full rounded-[12px] border border-black/[0.08] bg-white/90 px-2.5 py-2 text-[13px] text-[#1C1C1E]"
                value={profile.birthdayDay ?? ""}
                onChange={(e) => {
                  const v = e.target.value;
                  setDay(v === "" ? null : parseInt(v, 10));
                }}
              >
                <option value="">Day</option>
                {Array.from({ length: maxDay }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {profile.birthdayMonth != null && profile.birthdayDay != null && (
            <p className="text-[11px] text-[#007AFF] font-medium">
              {USER_BUNNY} {MONTHS[profile.birthdayMonth - 1]}{" "}
              {profile.birthdayDay}
            </p>
          )}
        </div>

        <div className="space-y-1.5 pt-0.5">
          <p className="text-[12px] font-semibold text-[#636366]">
            Favorite member
          </p>
          <div className="grid grid-cols-5 gap-1.5">
            {FAV_MEMBERS.map((m) => {
              const selected = profile.favMember === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  title={m.name}
                  onClick={() => setFav(selected ? null : m.id)}
                  className={`baa-ios-btn flex flex-col items-center gap-0.5 rounded-[12px] py-1.5 px-0.5 transition ${
                    selected
                      ? "bg-[#007AFF]/12 ring-2 ring-[#007AFF]/40"
                      : "hover:bg-black/[0.04]"
                  }`}
                >
                  <span className="text-[16px] leading-none" aria-hidden>
                    {m.heart}
                  </span>
                  <span className="text-[8px] font-semibold text-[#3A3A3C] truncate max-w-full">
                    {m.name}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="baa-ios-card px-3.5 py-3 space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[14px] font-semibold tracking-[-0.01em] text-[#1C1C1E]">
            AI assistant
          </p>
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
            ? "Binky chats with on-device Apple Intelligence. Nothing leaves this Mac."
            : ai?.reason ||
              "Turn on Apple Intelligence in System Settings to chat with Binky."}
        </p>
        {!ai?.available && (
          <button
            type="button"
            className="baa-ios-btn baa-ios-btn-primary w-full text-[13px] py-2.5"
            onClick={() => {
              void invoke("open_apple_intelligence_settings").catch(() => undefined);
            }}
          >
            Open Apple Intelligence settings
          </button>
        )}
      </div>

      {msg && (
        <p className="text-[13px] text-[#007AFF] font-medium px-0.5">{msg}</p>
      )}
    </div>
  );
}
