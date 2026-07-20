/** Phoning-style stickers / quick emoji reactions */

export interface Sticker {
  id: string;
  emoji: string;
  label: string;
}

export const STICKERS: Sticker[] = [
  { id: "bunny", emoji: "🐰", label: "Bunny" },
  { id: "heart", emoji: "💗", label: "Heart" },
  { id: "sparkle", emoji: "✨", label: "Sparkle" },
  { id: "star", emoji: "⭐", label: "Star" },
  { id: "music", emoji: "🎵", label: "Music" },
  { id: "fire", emoji: "🔥", label: "Fire" },
  { id: "wave", emoji: "👋", label: "Hi" },
  { id: "sleep", emoji: "😴", label: "Sleep" },
  { id: "love", emoji: "🥰", label: "Love" },
  { id: "clap", emoji: "👏", label: "Clap" },
];

export const QUICK_REPLIES = [
  "Hi 🐰",
  "Love NewJeans 💗",
  "What's on my calendar?",
  "Any update of NewJeans 💙💗💛💚💜?",
  "What's the weather now?",
];

export function stickerById(id: string): Sticker | undefined {
  return STICKERS.find((s) => s.id === id);
}
