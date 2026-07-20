import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";

export interface GrokAuthStatus {
  loggedIn: boolean;
  model: string;
  displayName?: string | null;
  keyHint?: string | null;
}

interface GrokLoginFormProps {
  /** Compact for settings overlay vs full panel */
  compact?: boolean;
  onLoggedIn?: (status: GrokAuthStatus) => void;
  onCancel?: () => void;
}

/**
 * Sign in to basic Grok — iOS form style (not chat/calendar chrome).
 */
export function GrokLoginForm({
  compact = false,
  onLoggedIn,
  onCancel,
}: GrokLoginFormProps) {
  const [name, setName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const login = async () => {
    setBusy(true);
    setError(null);
    try {
      const status = await invoke<GrokAuthStatus>("login_grok", {
        req: {
          apiKey: apiKey.trim(),
          displayName: name.trim() || null,
        },
      });
      onLoggedIn?.(status);
    } catch (e) {
      setError(typeof e === "string" ? e : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  };

  // Standalone login window needs a solid sheet; compact (in Settings) can stay lighter
  const shell = compact ? "baa-ios-card" : "baa-ios-solid";

  return (
    <div
      className={`${shell} text-[#1C1C1E] ${
        compact
          ? "p-3 space-y-2.5 w-full"
          : "p-4 space-y-3.5 w-full max-w-[300px]"
      }`}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="space-y-1">
        <h2 className="text-[17px] font-semibold tracking-[-0.02em] text-[#1C1C1E]">
          Sign in to Grok
        </h2>
        <p className="text-[12px] text-[#636366] leading-snug">
          Binky uses{" "}
          <span className="font-semibold text-[#007AFF]">basic Grok</span> (fast
          chat) — not Grok 4.5. Free credits often available at the xAI console.
        </p>
      </div>

      <label className="block space-y-1.5">
        <span className="text-[11px] font-medium text-[#636366]">
          Your name (optional)
        </span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Bunny"
          className="baa-ios-input w-full h-11 px-3.5 text-[14px] text-[#1C1C1E]"
        />
      </label>

      <label className="block space-y-1.5">
        <span className="text-[11px] font-medium text-[#636366]">
          xAI access key
        </span>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="xai-…"
          autoComplete="off"
          className="baa-ios-input w-full h-11 px-3.5 text-[14px] text-[#1C1C1E]"
          onKeyDown={(e) => {
            if (e.key === "Enter") void login();
          }}
        />
      </label>

      <button
        type="button"
        className="baa-ios-btn w-full text-[13px] text-[#007AFF] font-medium text-left hover:underline"
        onClick={() => {
          void openUrl("https://console.x.ai").catch(() => {
            window.open("https://console.x.ai", "_blank");
          });
        }}
      >
        Get a free key at console.x.ai →
      </button>

      {error && (
        <p className="text-[12px] text-[#FF3B30] leading-snug whitespace-pre-wrap">
          {error}
        </p>
      )}

      <div className="flex gap-2 pt-0.5">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="baa-ios-btn baa-ios-btn-secondary flex-1 px-2 py-2.5 text-[14px]"
          >
            Cancel
          </button>
        )}
        <button
          type="button"
          disabled={busy || !apiKey.trim()}
          onClick={() => void login()}
          className="baa-ios-btn baa-ios-btn-primary flex-1 px-2 py-2.5 text-[14px] disabled:opacity-40"
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </div>
    </div>
  );
}
