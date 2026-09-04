# BAA

**BAA** is a macOS desktop companion shaped like a NewJeans lightstick (**Binky**).  
It floats on your desktop with chat, calendar, care reminders, and lightstick LED colors.

---

## Download (friends — no coding)

1. Open **[Releases](https://github.com/PaytonHui/BAA/releases)**
2. Download **`BAA_0.2.1_aarch64.dmg`** (Apple Silicon Macs: M1 / M2 / M3 / M4)
3. Open the DMG → drag **BAA** to Applications (or open it from the disk image)
4. First open: if macOS blocks it → **right‑click BAA → Open** → **Open** again  
   (or **System Settings → Privacy & Security → Open Anyway**)

### After install
- Right‑click the lightstick for the menu (Chat, Calendar, Colors, Settings…)
- **Left‑click** opens chat — Binky uses **on-device Apple Intelligence** (no API key)
- Turn on **System Settings → Apple Intelligence & Siri** if chat says it needs setup

**Needs:** macOS 26+, Apple Silicon, Apple Intelligence enabled.

---

## What BAA does

- 3D NewJeans lightstick pet (always on top, click‑through desktop)
- Chat with on-device Apple Intelligence (private, no cloud key)
- Calendar (holidays, member birthdays, your birthday 🐰)
- Care bubbles (water, eyes, weather tips, etc.)
- Light colors (cycle + member colors)
- Birthday celebrations (members + your day)

---

## Build from source (developers)

```bash
git clone https://github.com/PaytonHui/BAA.git
cd BAA
npm install
npm run tauri:dev
```

**Needs:** Node.js, Rust, Xcode Command Line Tools (macOS 26+).

Release build:

```bash
npm run tauri:build
# → src-tauri/target/release/bundle/macos/BAA.app
# → src-tauri/target/release/bundle/dmg/BAA_0.2.1_aarch64.dmg
```

---

## Project info

| | |
|---|---|
| **App** | BAA |
| **Bundle ID** | `com.paytonhui.baa` |
| **Stack** | Tauri 2 · React · Three.js · Rust · Apple Foundation Models |
| **Local data** | `~/Library/Application Support/BAA/` |

Chat runs fully on-device. No API keys. Only `.env.example` is in the repo.

---

## License / support

See the repo for license. Support the project via **Support BAA** in the app menu (Buy Me a Coffee).
