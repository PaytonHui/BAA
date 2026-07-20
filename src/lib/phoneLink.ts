import { invoke } from "@tauri-apps/api/core";

/** Push a care / schedule reminder to linked phones (same Wi‑Fi). */
export async function pushPhoneReminder(opts: {
  text: string;
  emoji?: string;
  category?: string;
  title?: string;
  kind?: "reminder" | "care";
}): Promise<number> {
  try {
    return await invoke<number>("push_phone_event", {
      event: {
        kind: opts.kind ?? "reminder",
        text: opts.text,
        emoji: opts.emoji ?? "📅",
        category: opts.category ?? "",
        title: opts.title ?? "",
        at: Date.now(),
      },
    });
  } catch (e) {
    console.warn("[phoneLink] push failed", e);
    return 0;
  }
}
