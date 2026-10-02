/** Soft UI / pet SFX via Web Audio (no audio files). Quiet by default. */

import { listen } from "@tauri-apps/api/event";

const MUTE_KEY = "baa-muted";

let muted =
  typeof localStorage !== "undefined" &&
  localStorage.getItem(MUTE_KEY) === "1";

let ctx: AudioContext | null = null;
let master: GainNode | null = null;

/** Notes already handed to the audio device. Mute must cut these, not only later ones. */
type LiveVoice = { silence: () => void };
const liveVoices: LiveVoice[] = [];

function storedMuted(): boolean {
  try {
    return (
      typeof localStorage !== "undefined" &&
      localStorage.getItem(MUTE_KEY) === "1"
    );
  } catch {
    return muted;
  }
}

function silenceLiveVoices() {
  const pending = liveVoices.splice(0, liveVoices.length);
  for (const voice of pending) voice.silence();
}

function ensureMaster(c: AudioContext): GainNode {
  if (!master || master.context !== c) {
    master = c.createGain();
    master.connect(c.destination);
  }
  return master;
}

function setMasterLevel(level: number) {
  if (!ctx || !master) return;
  try {
    const now = ctx.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(level, now);
  } catch {
    /* context already closed */
  }
}

/** Stop every node in this window. Suspend so a missed oscillator cannot keep sounding. */
function cutOutput() {
  silenceLiveVoices();
  setMasterLevel(0);
  if (ctx && ctx.state === "running") void ctx.suspend();
}

function openOutput() {
  setMasterLevel(1);
  if (ctx && ctx.state === "suspended") void ctx.resume();
}

/**
 * Menu and the pet are different webviews. They share localStorage and do not
 * share this module's memory. Read the key on every play.
 */
function syncMuteFromStorage() {
  const next = storedMuted();
  if (next === muted) return;
  muted = next;
  if (muted) cutOutput();
  else openOutput();
}

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    ensureMaster(ctx);
  }
  if (!muted && ctx.state === "suspended") void ctx.resume();
  return ctx;
}

export function isMuted() {
  syncMuteFromStorage();
  return muted;
}

export function setMuted(v: boolean) {
  muted = v;
  try {
    localStorage.setItem(MUTE_KEY, v ? "1" : "0");
  } catch {
    /* ignore */
  }
  if (muted) cutOutput();
  else openOutput();
}

/**
 * Apply a mute toggle that happened in another Tauri window.
 * Menu and Settings each have their own copy of this module, so writing
 * the flag there does not stop the pet, chat, or color windows.
 */
export function handleMuteChanged(
  payload: { muted?: boolean } | null | undefined
) {
  if (typeof payload?.muted === "boolean") setMuted(payload.muted);
}

/**
 * Subscribe this window's sound engine to the sound switch.
 * Safe to call more than once. No-ops outside the Tauri webview.
 */
export function installMuteSync() {
  if (typeof window === "undefined") return;
  const host = window as Window & {
    __baaMuteSync?: boolean;
    __TAURI_INTERNALS__?: object;
  };
  if (host.__baaMuteSync) return;
  if (!host.__TAURI_INTERNALS__) return;
  host.__baaMuteSync = true;
  void listen<{ muted?: boolean }>("mute-changed", (ev) => {
    handleMuteChanged(ev.payload);
  }).catch(() => {
    host.__baaMuteSync = false;
  });
}

export function toggleMuted() {
  setMuted(!muted);
  return muted;
}

function tone(
  freq: number,
  duration: number,
  type: OscillatorType,
  gainPeak: number,
  when = 0
) {
  syncMuteFromStorage();
  if (muted) return;
  const c = getCtx();
  if (!c) return;
  const t0 = c.currentTime + when;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gainPeak, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(g);
  g.connect(ensureMaster(c));
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
  const voice: LiveVoice = {
    silence() {
      try {
        const now = c.currentTime;
        g.gain.cancelScheduledValues(now);
        g.gain.setValueAtTime(0.0001, now);
      } catch {
        /* context already closed */
      }
      try {
        g.disconnect();
      } catch {
        /* already disconnected */
      }
    },
  };
  liveVoices.push(voice);
  osc.addEventListener("ended", () => {
    const i = liveVoices.indexOf(voice);
    if (i >= 0) liveVoices.splice(i, 1);
  });
}

function installMuteWatch() {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const host = window as Window & { __baaMuteWatch?: boolean };
  if (host.__baaMuteWatch) return;
  host.__baaMuteWatch = true;
  window.addEventListener("storage", () => syncMuteFromStorage());
  // WKWebView often skips the storage event across windows. Poll the shared key.
  window.setInterval(() => syncMuteFromStorage(), 200);
}

installMuteSync();
installMuteWatch();

/** Soft click — color pick / UI */
export function playClick() {
  tone(880, 0.06, "sine", 0.045);
  tone(1320, 0.04, "sine", 0.02, 0.02);
}

/** Pop — message send */
export function playPop() {
  tone(520, 0.07, "triangle", 0.05);
  tone(780, 0.05, "sine", 0.03, 0.03);
}

/** Short jingle — showcase 360° spin */
export function playSpinJingle() {
  const notes = [659, 784, 988, 1175]; // E5 G5 B5 D6
  notes.forEach((f, i) => {
    tone(f, 0.12, "sine", 0.035, i * 0.07);
  });
}

/** Insane NewJeans birthday fanfare — rising sparkle cascade */
export function playBirthdayFanfare() {
  if (muted) return;
  // Big rising arpeggio
  const rise = [523, 659, 784, 988, 1175, 1319, 1568]; // C5…G6
  rise.forEach((f, i) => {
    tone(f, 0.14, "sine", 0.04, i * 0.055);
    tone(f * 2, 0.08, "triangle", 0.018, i * 0.055 + 0.02);
  });
  // Stomp drops
  tone(98, 0.22, "sine", 0.05, 0.42);
  tone(130, 0.18, "triangle", 0.035, 0.55);
  // Final sparkle burst
  [1568, 1760, 2093, 2349].forEach((f, i) => {
    tone(f, 0.1, "sine", 0.03, 0.72 + i * 0.05);
  });
}

/** Gentle notice — idle care bubble */
export function playNotice() {
  tone(660, 0.1, "sine", 0.03);
  tone(880, 0.12, "sine", 0.025, 0.08);
}

/**
 * Soft reminder chime — schedule care bubble
 * (slightly brighter than playNotice so it feels like a ping)
 */
export function playReminder() {
  if (muted) return;
  // Two soft bells
  tone(784, 0.14, "sine", 0.045); // G5
  tone(988, 0.16, "sine", 0.035, 0.1); // B5
  tone(1175, 0.18, "triangle", 0.028, 0.2); // D6
}

/** Sticker send */
export function playSticker() {
  tone(740, 0.05, "sine", 0.04);
  tone(990, 0.08, "triangle", 0.03, 0.04);
}
