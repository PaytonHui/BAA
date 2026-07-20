# BAA

**BAA** is a macOS desktop companion shaped like a NewJeans lightstick (**Binky**).  
It floats on your desktop with chat, calendar, care reminders, and lightstick LED colors.

---

## Download (friends — no coding)

1. Open **[Releases](https://github.com/PaytonHui/BAA/releases)**
2. Download **`BAA_0.1.0_aarch64.dmg`** (Apple Silicon Macs: M1 / M2 / M3 / M4)
3. Open the DMG → drag **BAA** to Applications (or open it from the disk image)
4. First open: if macOS blocks it → **right‑click BAA → Open** → **Open** again  
   (or **System Settings → Privacy & Security → Open Anyway**)

### After install
- Right‑click the lightstick for the menu (Chat, Calendar, Colors, Settings…)
- **Settings → Sign in to Grok** with your own [xAI API key](https://console.x.ai)  
  (the app never ships with someone else’s key)

**Note:** This build is for **Apple Silicon (arm64)**. Intel Macs need a separate build.

---

## What BAA does

- 3D NewJeans lightstick pet (always on top, click‑through desktop)
- Chat with basic Grok (xAI)
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

**Needs:** Node.js, Rust, Xcode Command Line Tools (macOS).

Release build:

```bash
npm run tauri:build
# → src-tauri/target/release/bundle/macos/BAA.app
# → src-tauri/target/release/bundle/dmg/BAA_0.1.0_aarch64.dmg
```

---

## Project info

| | |
|---|---|
| **App** | BAA |
| **Bundle ID** | `com.paytonhui.baa` |
| **Stack** | Tauri 2 · React · Three.js · Rust |
| **Local data** | `~/Library/Application Support/BAA/` |

Secrets stay local (`.env` / API keys are gitignored). Only `.env.example` is in the repo.

---

## License / support

See the repo for license. Support the project via **Support BAA** in the app menu (Buy Me a Coffee).
