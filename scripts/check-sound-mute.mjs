/**
 * Mute must reach the pet window's sound engine.
 * The sound switch lives in the menu/settings webview. That webview
 * has its own copy of sounds.ts. The pet keeps playing unless
 * `mute-changed` calls handleMuteChanged in every window.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];

function fail(msg) {
  failures.push(msg);
}

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
store.set("baa-muted", "0");

const gains = [];
class FakeGain {
  constructor() {
    this.gain = {
      setValueAtTime() {},
      exponentialRampToValueAtTime() {},
      cancelScheduledValues() {},
    };
    this.silenced = false;
  }
  connect(dest) {
    this.dest = dest;
    return this;
  }
  disconnect() {
    this.silenced = true;
  }
}
class FakeOsc {
  constructor() {
    this.type = "sine";
    this.frequency = { setValueAtTime() {} };
  }
  connect() {
    return this;
  }
  start() {}
  stop() {}
  addEventListener() {}
}
class FakeCtx {
  constructor() {
    this.currentTime = 0;
    this.state = "running";
    this.destination = {};
  }
  createOscillator() {
    return new FakeOsc();
  }
  createGain() {
    const g = new FakeGain();
    g.context = this;
    gains.push(g);
    return g;
  }
  resume() {
    this.state = "running";
    return Promise.resolve();
  }
  suspend() {
    this.state = "suspended";
    return Promise.resolve();
  }
}

globalThis.window = globalThis;
globalThis.AudioContext = FakeCtx;

const sounds = await import(pathToFileURL(path.join(root, "src/lib/sounds.ts")).href);
const { handleMuteChanged, isMuted, playNotice, setMuted } = sounds;

function voiceGains() {
  return gains.filter((g) => g.dest && g.dest.gain);
}

if (typeof handleMuteChanged !== "function") {
  fail("sounds.ts does not export handleMuteChanged");
} else {
  setMuted(false);
  playNotice();
  const startedVoices = voiceGains().length;
  if (startedVoices < 1) fail(`unmuted playNotice started ${startedVoices} voices`);

  // The menu window writes the shared key. The pet's in-memory flag stays stale
  // until it reads storage — that is the bug when the event is missed.
  localStorage.setItem("baa-muted", "1");
  playNotice();

  if (!isMuted()) fail("shared mute key left the pet engine unmuted");
  const stillAudible = voiceGains().filter((g) => !g.silenced).length;
  if (stillAudible > 0) fail(`mute left ${stillAudible} voice(s) connected`);
  if (voiceGains().length !== startedVoices) {
    fail("muted playNotice started a new voice");
  }

  handleMuteChanged({ muted: false });
  if (isMuted()) fail("handleMuteChanged({ muted: false }) left the engine muted");
  playNotice();
  if (voiceGains().length <= startedVoices) {
    fail("unmute did not allow playNotice again");
  }

  handleMuteChanged({ muted: true });
  if (!isMuted()) fail("handleMuteChanged({ muted: true }) left the engine unmuted");
  const after = voiceGains().length;
  playNotice();
  if (voiceGains().length !== after) fail("event mute did not block playNotice");
}

const appSrc = fs.readFileSync(path.join(root, "src/App.tsx"), "utf8");
const muteHandler = appSrc.split('"mute-changed"')[1]?.slice(0, 400) ?? "";
if (!muteHandler.includes("handleMuteChanged")) {
  fail("pet window mute-changed handler does not call handleMuteChanged");
}

const soundsSrc = fs.readFileSync(path.join(root, "src/lib/sounds.ts"), "utf8");
if (!soundsSrc.includes("mute-changed") || !soundsSrc.includes("handleMuteChanged")) {
  fail("sounds.ts does not subscribe every window to mute-changed");
}

const mainSrc = fs.readFileSync(path.join(root, "src/main.tsx"), "utf8");
if (!mainSrc.includes("installMuteSync")) {
  fail("main.tsx does not install mute sync for every panel window");
}

if (failures.length) {
  console.error("RED");
  for (const f of failures) console.error(" - " + f);
  process.exit(1);
}
console.log("GREEN");
console.log(`voices started while unmuted, silenced on mute, blocked while muted`);
