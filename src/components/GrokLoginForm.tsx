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

  // Always solid/opaque — glass was too transparent over the desktop
  const shell = compact
    ? "baa-ios-solid baa-ios-solid-compact"
    : "baa-ios-solid";

  return (
    <div
      className={`${shell} text-[#1C1C1E] ${
        compact
          ? "p-3 space-y-2 w-full"
          : "p-3.5 space-y-2.5 w-full max-w-[300px]"
      }`}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="space-y-1">
        <h2
          className={`font-semibold tracking-[-0.02em] text-[#1C1C1E] leading-snug ${
            compact ? "text-[15px]" : "text-[16px]"
          }`}
        >
          Make Binky your AI assistant
        </h2>
        <p className="text-[11px] text-[#636366] leading-snug">
          Powered by{" "}
          <span className="font-semibold text-[#007AFF]">Grok</span> (basic —
          not 4.5). Chat with Binky, get answers, and mark your calendar by
          talking.
        </p>
        <p className="text-[10px] text-[#8E8E93] leading-snug">
          Calendar stays free without login. Key from{" "}
          <span className="font-medium text-[#636366]">
            console.x.ai → API Keys
          </span>{" "}
          (<span className="font-mono text-[10px]">xai-</span>
          …). Needs credits.
        </p>
      </div>

      <label className="block space-y-1">
        <span className="text-[10px] font-medium text-[#636366]">
          Your name (optional)
        </span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Bunny"
          className="baa-ios-input w-full h-9 px-3 text-[13px] text-[#1C1C1E]"
        />
      </label>

      <label className="block space-y-1">
        <span className="text-[10px] font-medium text-[#636366]">
          xAI access key
        </span>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="xai-…"
          autoComplete="off"
          className="baa-ios-input w-full h-9 px-3 text-[13px] text-[#1C1C1E]"
          onKeyDown={(e) => {
            if (e.key === "Enter") void login();
          }}
        />
      </label>

      <button
        type="button"
        className="baa-ios-btn w-full text-[12px] text-[#007AFF] font-medium text-left hover:underline py-0.5"
        onClick={() => {
          void openUrl("https://console.x.ai").catch(() => {
            window.open("https://console.x.ai", "_blank");
          });
        }}
      >
        Get a key at console.x.ai →
      </button>

      {error && (
        <p className="text-[11px] text-[#FF3B30] leading-snug whitespace-pre-wrap max-h-16 overflow-y-auto">
          {error}
        </p>
      )}

      <div className="flex gap-2 pt-0.5">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="baa-ios-btn baa-ios-btn-secondary flex-1 px-2 py-2 text-[13px]"
          >
            Not now
          </button>
        )}
        <button
          type="button"
          disabled={busy || !apiKey.trim()}
          onClick={() => void login()}
          className="baa-ios-btn baa-ios-btn-primary flex-1 px-2 py-2 text-[13px] disabled:opacity-40"
        >
          {busy ? "Connecting…" : "Make Binky my AI"}
        </button>
      </div>
    </div>
  );
}
