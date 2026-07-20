# BAA iPhone — Dynamic Island · calendar · Wi‑Fi sync

Not a always-on Mac remote. Phone has its **own** calendar; it only  
**連接並更新** Mac when you’re on the **same Wi‑Fi**.

## Features

| Feature | Behavior |
|--------|----------|
| **Dynamic Island (in-app)** | Pixel-art lightstick capsule · tap → calendar |
| **Calendar** | Local copy of events from Mac |
| **Notifications** | Work = 3h before · other = 1h before (same as Mac) |
| **Mac sync** | Only when Mac BAA is reachable on LAN |
| **Chat** | None |

## Flow

1. **Pair once** — scan Mac QR (`Link iPhone`) → save host + token  
2. **Offline** — calendar + notifications work without Mac  
3. **Same Wi‑Fi** — open app or tap **連接並更新 Mac** → pull schedule from Mac  
4. **Important reminder** — iOS notification (+ island flash in app)

## Mac side

Mac BAA publishes schedule to LAN companion (`:17832/api/schedule`).  
Keep Mac BAA running when you want to sync.

## Run

```bash
cd baa-ios
npm start
```

Expo Go on iPhone → scan QR.

## Real system Dynamic Island

Apple’s **Live Activities** need a native widget extension (dev build / Xcode), not Expo Go.

This app ships a **Dynamic Island–style** capsule that matches that UX (pixel stick, tap → calendar).  
Next step for the real island: `npx expo prebuild` + ActivityKit widget using `assets/pixel-stick.png`.

## Pairing note

Token is set when Mac BAA starts. If Mac restarts, re-scan QR once.
