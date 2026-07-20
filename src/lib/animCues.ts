/** One-shot animation cues fired from App into the lightstick */

export type AnimKind =
  | "none"
  | "tap"
  | "color"
  | "chatOpen"
  | "happy"
  | "hearts"
  | "wake"
  | "confetti"
  /** NewJeans member birthday — hearts + confetti (LED stays locked color) */
  | "birthday";

export interface AnimCue {
  /** Monotonic id — change this to re-fire the same kind */
  n: number;
  kind: AnimKind;
}

export const NO_CUE: AnimCue = { n: 0, kind: "none" };

/** How long each cue “owns” the stick (ms) — blocks overlapping fireAnim */
export const ANIM_DURATION_MS: Record<AnimKind, number> = {
  none: 0,
  tap: 450,
  color: 900,
  chatOpen: 750,
  happy: 900,
  hearts: 800,
  wake: 1500,
  confetti: 1000,
  birthday: 2500,
};

export function nextCue(prev: AnimCue, kind: AnimKind): AnimCue {
  return { n: prev.n + 1, kind };
}
