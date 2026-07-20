import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { PhysicalPosition } from "@tauri-apps/api/dpi";
import { GrokPet } from "./components/GrokPet";
import { pushPhoneReminder } from "./lib/phoneLink";
import { publishScheduleToCompanion } from "./lib/macSync";
import { usePetLife } from "./hooks/usePetLife";
import { useOrbitHover } from "./hooks/useOrbitHover";
import { usePetClickThrough } from "./hooks/usePetClickThrough";
import {
  loadLightColorMode,
  saveLightColorMode,
  type LightColorMode,
} from "./lib/lightColors";
import {
  birthdayCareLines,
  getNewJeansBirthdayToday,
  type NewJeansBirthdayToday,
} from "./lib/defaultCalendar";
import {
  getUserBirthdayToday,
  userBirthdayCareLines,
  type UserBirthdayToday,
} from "./lib/userProfile";
import { isMuted } from "./lib/sounds";
import {
  ANIM_DURATION_MS,
  nextCue,
  NO_CUE,
  type AnimCue,
  type AnimKind,
} from "./lib/animCues";
import {
  getDueReminders,
  hydrateReminded,
  hydrateSchedule,
  loadSchedule,
  markReminded,
  reloadScheduleFromDisk,
  todayKey,
  type ScheduleEvent,
} from "./lib/schedule";
import {
  CARE_PANEL_W,
  collapseToPet,
  expandForCare,
  collapseSideToPet,
  petSizeAt,
  resizePetScale,
  type BubbleSide,
  type PanelDock,
} from "./lib/windowLayout";
import {
  hideChatWindow,
  repositionChatWindow,
  showChatWindow,
} from "./lib/chatWindow";
import {
  hideAllPanelWindows,
  hidePanelWindow,
  nudgeOpenPanelWindows,
  repositionPanelWindow,
  resizePanelWindow,
  showPanelWindow,
  type PanelKind,
} from "./lib/panelWindow";
// login panel uses showPanelWindow("login")
import {
  loadPetScale,
  PET_SCALE_DEFAULT,
  savePetScale,
  scaleFromWheel,
} from "./lib/petScale";
import {
  CARE_BUBBLE_MS,
  WEATHER_FX_MS,
  careBusyRetryMs,
  markCareNeedShown,
  nextCareDelayMs,
  pickCareLine,
  weatherCareLines,
  type CareKind,
} from "./lib/careMessages";
import {
  fetchWeather,
  loadCachedWeather,
  weatherNeedsUmbrella,
  type WeatherSnapshot,
} from "./lib/weather";
import { playNotice, playReminder } from "./lib/sounds";
import { CareBubble } from "./components/CareBubble";
import type {
  AppConfig,
  PetExpression,
} from "./types";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";

/** Ease zoom back to default while the native window floats home (~0.5s). */
let scaleHomeRaf = 0;
function animatePetScaleHome(
  scaleRef: MutableRefObject<number>,
  setScale: Dispatch<SetStateAction<number>>,
  onDone?: () => void
) {
  if (scaleHomeRaf) {
    cancelAnimationFrame(scaleHomeRaf);
    scaleHomeRaf = 0;
  }
  const from = scaleRef.current;
  const to = PET_SCALE_DEFAULT;
  if (Math.abs(from - to) < 0.002) {
    scaleRef.current = to;
    setScale(to);
    savePetScale(to);
    onDone?.();
    return;
  }
  const durationMs = 520;
  const t0 = performance.now();
  const tick = (now: number) => {
    const u = Math.min(1, (now - t0) / durationMs);
    // ease-out cubic — match native float landing
    const e = 1 - (1 - u) ** 3;
    const next = from + (to - from) * e;
    scaleRef.current = next;
    setScale(next);
    if (u < 1) {
      scaleHomeRaf = requestAnimationFrame(tick);
    } else {
      scaleHomeRaf = 0;
      scaleRef.current = to;
      setScale(to);
      savePetScale(to);
      onDone?.();
    }
  };
  scaleHomeRaf = requestAnimationFrame(tick);
}

export default function App() {
  const [expression, setExpression] = useState<PetExpression>("idle");
  const [chatOpen, setChatOpen] = useState(false);
  /** Grok signed in → left-click opens chat; free tier → calendar */
  const grokLoggedInRef = useRef(false);
  /**
   * Window/layout shell (main WebGL window only):
   * - compact: pet only
   * - menu: side panel beside lightstick
   * Chat / calendar / color / settings / link use separate windows
   * so this shell never resizes for them (no open/close flash).
   */
  const [shell, setShell] = useState<"compact" | "menu">("compact");
  /** Dock used only for care-bubble side strip collapse */
  const [panelDock, setPanelDock] = useState<PanelDock>("top");
  const panelDockRef = useRef<PanelDock>("top");
  panelDockRef.current = panelDock;
  const [loading, setLoading] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuOpenRef = useRef(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [colorPickerOpen, setColorPickerOpen] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const calendarOpenRef = useRef(false);
  const [calendarLarge, setCalendarLarge] = useState(false);
  const calendarLargeRef = useRef(false);
  const [chatLarge, setChatLarge] = useState(false);
  const chatLargeRef = useRef(false);
  const colorPickerOpenRef = useRef(false);
  const settingsOpenRef = useRef(false);
  const linkOpenRef = useRef(false);
  const loginOpenRef = useRef(false);
  /** Hover-zoom size of the lightstick (wheel / pinch while cursor on pet) */
  const [petScale, setPetScale] = useState(() =>
    typeof window !== "undefined" ? loadPetScale() : 1
  );
  const petScaleRef = useRef(petScale);
  petScaleRef.current = petScale;
  const [schedule, setSchedule] = useState<ScheduleEvent[]>(() =>
    typeof window !== "undefined" ? loadSchedule() : []
  );

  // Load schedule from disk so plans survive quit/relaunch
  useEffect(() => {
    void (async () => {
      const events = await hydrateSchedule();
      setSchedule(events);
      await hydrateReminded();
      void publishScheduleToCompanion(events);
    })();
  }, []);
  const [lightColor, setLightColor] = useState<LightColorMode>(() =>
    typeof window !== "undefined" ? loadLightColorMode() : "cycle"
  );
  /** NewJeans member birthday — locks LED color all day */
  const [birthdayToday, setBirthdayToday] =
    useState<NewJeansBirthdayToday | null>(() =>
      typeof window !== "undefined" ? getNewJeansBirthdayToday() : null
    );
  const birthdayTodayRef = useRef(birthdayToday);
  birthdayTodayRef.current = birthdayToday;
  /** User birthday — bunny party, fav color tint, color pick stays free */
  const [userBirthdayToday, setUserBirthdayToday] =
    useState<UserBirthdayToday | null>(() =>
      typeof window !== "undefined" ? getUserBirthdayToday() : null
    );
  const userBirthdayTodayRef = useRef(userBirthdayToday);
  userBirthdayTodayRef.current = userBirthdayToday;
  /**
   * Stick color: member birthday locks to member color.
   * User birthday may soft-tint to fave color (not locked — user can still change).
   */
  const effectiveLightColor: LightColorMode = birthdayToday
    ? birthdayToday.color
    : lightColor;
  /** Hearts / bunnies for celebration FX */
  const celebrationEmoji =
    birthdayToday?.heart ?? userBirthdayToday?.emoji ?? null;
  /** Live weather for care tips + sun/rain FX on the stick */
  const [weather, setWeather] = useState<WeatherSnapshot | null>(() =>
    typeof window !== "undefined" ? loadCachedWeather() : null
  );
  const weatherRef = useRef(weather);
  weatherRef.current = weather;
  const [, setMutedState] = useState(() =>
    typeof window !== "undefined" ? isMuted() : false
  );
  const [, setConfig] = useState<AppConfig | null>(null);
  const [animCue, setAnimCue] = useState<AnimCue>(NO_CUE);
  /** Until this timestamp, other one-shot motions are blocked */
  const motionBusyUntilRef = useRef(0);
  /** Weather FX / weather care bubble currently owning the stick */
  const weatherMotionActiveRef = useRef(false);
  /** Idle daily-care speech bubble (old-school WA) beside the pet */
  const [careBubble, setCareBubble] = useState<{
    text: string;
    kind: CareKind;
    emoji: string;
    side: BubbleSide;
    visible: boolean;
  } | null>(null);
  const careLastTextRef = useRef("");
  const careFirstRef = useRef(true);
  /** Care bubble always on the right of the pet; window grows right while open */
  const careOpenRef = useRef(false);
  const careRescheduleRef = useRef<() => void>(() => undefined);
  /** Force a weather care bubble (Mac wake / chat weather ask) */
  const forceWeatherCareRef = useRef<
    (w: WeatherSnapshot) => void | Promise<void>
  >(() => undefined);
  /**
   * Weather FX without a care bubble (e.g. chat open while asking weather).
   * Timed show on Mac wake + chat weather questions.
   */
  const [weatherFxForced, setWeatherFxForced] = useState(false);
  const weatherFxForceTimerRef = useRef(0);
  const weatherFxForcedRef = useRef(false);
  const [pointerNorm, setPointerNorm] = useState<{
    x: number;
    y: number;
  } | null>(null);
  /** Smoothed drag velocity (screen px/s) for move effects */
  const [dragMotion, setDragMotion] = useState({
    vx: 0,
    vy: 0,
    speed: 0,
    dragging: false,
  });
  /**
   * Two-finger free-look: rotate 3D model; freezes all pet motion while active.
   * Trackpad pixel scroll / two-finger touch → rotate; pinch (ctrl+wheel) → zoom.
   */
  const freeLookRef = useRef({
    active: false,
    yaw: 0,
    pitch: 0,
    idleUntil: 0,
  });
  const [freeLook, setFreeLook] = useState({
    active: false,
    yaw: 0,
    pitch: 0,
  });
  const freeLookTouchRef = useRef<{
    idA: number;
    idB: number;
    lastX: number;
    lastY: number;
  } | null>(null);
  const dragVelRef = useRef({
    vx: 0,
    vy: 0,
    lastT: 0,
    lastX: 0,
    lastY: 0,
  });

  /** Birthday motion end time — weather waits for this when it's a member day */
  const birthdayPlayingUntilRef = useRef(0);

  /** Stop forced weather FX so birthday can take the stage */
  const clearWeatherFxForce = useCallback(() => {
    window.clearTimeout(weatherFxForceTimerRef.current);
    setWeatherFxForced(false);
    weatherFxForcedRef.current = false;
    if (careBubbleRef.current?.kind !== "weather") {
      weatherMotionActiveRef.current = false;
    }
  }, []);

  /**
   * Fire a one-shot stick motion.
   * Birthday is always #1 priority — can interrupt weather / other cues.
   * Other kinds refuse if weather is up or another motion is still playing.
   */
  const fireAnim = useCallback(
    (kind: AnimKind) => {
      if (kind === "none") return false;
      const now = Date.now();
      const ms = ANIM_DURATION_MS[kind] ?? 800;

      if (kind === "birthday") {
        // Highest priority: clear weather lock/FX and own the stick
        clearWeatherFxForce();
        if (careBubbleRef.current?.kind === "weather") {
          setCareBubble(null);
        }
        weatherMotionActiveRef.current = false;
        motionBusyUntilRef.current = now + ms;
        birthdayPlayingUntilRef.current = now + ms;
        setAnimCue((prev) => nextCue(prev, kind));
        return true;
      }

      if (weatherMotionActiveRef.current) return false;
      if (now < motionBusyUntilRef.current) return false;
      if (now < birthdayPlayingUntilRef.current) return false;
      motionBusyUntilRef.current = now + ms;
      setAnimCue((prev) => nextCue(prev, kind));
      return true;
    },
    [clearWeatherFxForce]
  );

  /** True if member or user birthday should celebrate today */
  const isAnyBirthdayToday = useCallback(() => {
    return !!(getNewJeansBirthdayToday() || getUserBirthdayToday());
  }, []);

  /**
   * Play (or finish) birthday celebration, then resolve.
   * Member days first; else user birthday. Weather waits after this.
   */
  const ensureBirthdayThen = useCallback(async () => {
    const member = getNewJeansBirthdayToday();
    const user = getUserBirthdayToday();
    if (!member && !user) {
      const wait = Math.max(0, motionBusyUntilRef.current - Date.now());
      if (wait > 0) {
        await new Promise<void>((r) => window.setTimeout(r, wait + 40));
      }
      return;
    }

    const now = Date.now();
    if (now >= birthdayPlayingUntilRef.current) {
      // Soft-tint to fave color on user birthday (not locked, not persisted)
      if (!member && user?.color) {
        setLightColor(user.color);
      }
      fireAnim("birthday");
      setExpression("happy");
      window.setTimeout(() => setExpression("idle"), 2800);
    }
    const wait = Math.max(0, birthdayPlayingUntilRef.current - Date.now());
    if (wait > 0) {
      await new Promise<void>((r) => window.setTimeout(r, wait + 80));
    }
  }, [fireAnim]);

  // Birthday day: member lock / user bunny party (weather will wait)
  useEffect(() => {
    const refresh = () => {
      setBirthdayToday(getNewJeansBirthdayToday());
      setUserBirthdayToday(getUserBirthdayToday());
    };
    refresh();
    const anyBday = isAnyBirthdayToday();
    let celebrateT: number | undefined;
    let pulseT: number | undefined;
    if (anyBday) {
      celebrateT = window.setTimeout(() => {
        void ensureBirthdayThen();
      }, 900);
      pulseT = window.setInterval(() => {
        if (!isAnyBirthdayToday()) return;
        void ensureBirthdayThen();
      }, 50 * 60_000);
    }
    const dayPoll = window.setInterval(() => {
      refresh();
    }, 60_000);
    // Settings saved fav/birthday — refresh celebration state
    let unProfile: (() => void) | undefined;
    void listen("user-profile-changed", () => {
      refresh();
    }).then((u) => {
      unProfile = u;
    });
    return () => {
      if (celebrateT) window.clearTimeout(celebrateT);
      if (pulseT) window.clearInterval(pulseT);
      window.clearInterval(dayPoll);
      unProfile?.();
    };
  }, [ensureBirthdayThen, isAnyBirthdayToday]);

  // Keep companion schedule fresh for phone Wi‑Fi sync (publish often)
  useEffect(() => {
    void publishScheduleToCompanion(schedule);
    // First paint sometimes races companion boot — republish shortly after
    const t0 = window.setTimeout(
      () => void publishScheduleToCompanion(loadSchedule()),
      800
    );
    const t1 = window.setTimeout(
      () => void publishScheduleToCompanion(loadSchedule()),
      2500
    );
    const t = window.setInterval(() => {
      void publishScheduleToCompanion(loadSchedule());
    }, 15_000);
    return () => {
      window.clearTimeout(t0);
      window.clearTimeout(t1);
      window.clearInterval(t);
    };
  }, [schedule]);

  const { lifeState, facing, setPaused, setHomeHere, poke } = usePetLife();

  const orbit = useOrbitHover({
    onOrbitStart: () => {
      setPaused(true);
      setExpression("happy");
    },
    onOrbitEnd: () => {
      setExpression("idle");
      setHomeHere();
      if (!chatOpenRef.current) setPaused(false);
    },
  });

  const dragRef = useRef<{
    lastX: number;
    lastY: number;
    moved: boolean;
    dragging: boolean;
  } | null>(null);
  const chatOpenRef = useRef(false);
  const shellRef = useRef(shell);
  shellRef.current = shell;
  const busyForCareRef = useRef(false);
  /** Bumps on each open/close to ignore stale async layout ops */
  const layoutGenRef = useRef(0);
  const layoutBusyRef = useRef(false);
  chatOpenRef.current = chatOpen;
  chatLargeRef.current = chatLarge;
  calendarOpenRef.current = calendarOpen;
  calendarLargeRef.current = calendarLarge;
  colorPickerOpenRef.current = colorPickerOpen;
  settingsOpenRef.current = settingsOpen;
  linkOpenRef.current = linkOpen;
  loginOpenRef.current = loginOpen;
  menuOpenRef.current = menuOpen;
  const careBubbleRef = useRef(careBubble);
  careBubbleRef.current = careBubble;

  /** Labels of currently open overlay panels (for drag-follow). */
  const openPanelKinds = useCallback((): PanelKind[] => {
    const kinds: PanelKind[] = [];
    if (chatOpenRef.current) kinds.push("chat");
    if (calendarOpenRef.current) kinds.push("calendar");
    if (colorPickerOpenRef.current) kinds.push("color");
    if (settingsOpenRef.current) kinds.push("settings");
    if (linkOpenRef.current) kinds.push("link");
    if (loginOpenRef.current) kinds.push("login");
    if (menuOpenRef.current) kinds.push("menu");
    return kinds;
  }, []);

  /** App paused from Dock / tray — hide pet & stop care bubbles */
  const [appPaused, setAppPaused] = useState(false);
  const appPausedRef = useRef(false);
  appPausedRef.current = appPaused;

  // Don't spawn NEW care bubbles while busy / paused
  busyForCareRef.current =
    appPaused ||
    chatOpen ||
    colorPickerOpen ||
    calendarOpen ||
    menuOpen ||
    settingsOpen ||
    linkOpen ||
    loginOpen ||
    loading ||
    layoutBusyRef.current ||
    !!careBubble; // one at a time

  useEffect(() => {
    // Orbit pause is handled in onOrbitStart/End
    if (orbit.isOrbiting()) return;
    setPaused(
      chatOpen ||
        settingsOpen ||
        linkOpen ||
        loginOpen ||
        colorPickerOpen ||
        calendarOpen ||
        menuOpen ||
        loading
    );
  }, [
    chatOpen,
    settingsOpen,
    linkOpen,
    loginOpen,
    colorPickerOpen,
    calendarOpen,
    menuOpen,
    loading,
    setPaused,
    orbit,
  ]);

  // Keep open* stable for tray / menu-window listeners via refs
  const openChatRef = useRef<() => void>(() => undefined);
  const openColorRef = useRef<() => void>(() => undefined);
  const openCalendarRef = useRef<() => void>(() => undefined);
  const openSettingsRef = useRef<() => void>(() => undefined);
  const openLoginRef = useRef<() => void>(() => undefined);
  const syncCalendarRef = useRef<() => void>(() => undefined);
  const airDropRef = useRef<() => void>(() => undefined);
  const hideRef = useRef<() => void>(() => undefined);
  const quitRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<string>("pet-tray", (ev) => {
      const action = ev.payload;
      if (action === "pause") {
        setAppPaused(true);
        setCareBubble(null);
        setChatOpen(false);
        chatOpenRef.current = false;
        setMenuOpen(false);
        menuOpenRef.current = false;
        setCalendarOpen(false);
        setColorPickerOpen(false);
        setSettingsOpen(false);
        setLinkOpen(false);
        setLoginOpen(false);
        setShell("compact");
        void hideAllPanelWindows();
        return;
      }
      // Dock click / tray Start — float home + ease zoom back to default
      if (
        action === "resume" ||
        action === "show" ||
        action === "dock-center"
      ) {
        setAppPaused(false);
        setCareBubble(null);
        setChatOpen(false);
        chatOpenRef.current = false;
        setMenuOpen(false);
        menuOpenRef.current = false;
        setCalendarOpen(false);
        setColorPickerOpen(false);
        setSettingsOpen(false);
        setLinkOpen(false);
        setLoginOpen(false);
        setShell("compact");
        setPanelDock("top");
        void hideAllPanelWindows();
        fireAnim("wake");
        // Rust floats the OS window; ease 3D zoom in lockstep so the stick
        // stays fully visible while it drifts home (no teleport flash).
        animatePetScaleHome(petScaleRef, setPetScale, () => setHomeHere());
        return;
      }
      if (action === "dock-center-done") {
        // Native float finished — lock scale + home to default
        petScaleRef.current = PET_SCALE_DEFAULT;
        setPetScale(PET_SCALE_DEFAULT);
        savePetScale(PET_SCALE_DEFAULT);
        setHomeHere();
        return;
      }
      // Any feature from tray also resumes
      setAppPaused(false);
      if (action === "chat") openChatRef.current();
      if (action === "color") openColorRef.current();
      if (action === "calendar") openCalendarRef.current();
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, [fireAnim]);

  // Grok login status — free tier left-click opens calendar, not chat
  useEffect(() => {
    const refresh = () => {
      void invoke<{ loggedIn?: boolean }>("grok_auth_status")
        .then((s) => {
          grokLoggedInRef.current = !!s.loggedIn;
        })
        .catch(() => {
          grokLoggedInRef.current = false;
        });
    };
    refresh();
    const unsubs: Array<() => void> = [];
    void listen("grok-logged-in", refresh).then((u) => unsubs.push(u));
    void listen("grok-logged-out", refresh).then((u) => unsubs.push(u));
    return () => unsubs.forEach((u) => u());
  }, []);

  // Separate chat window → pet expressions + schedule refresh
  useEffect(() => {
    const unsubs: Array<() => void> = [];
    void listen<{ expression?: PetExpression; anim?: string }>(
      "chat-to-pet",
      (ev) => {
        const expr = ev.payload?.expression;
        if (expr) {
          setExpression(expr);
          window.setTimeout(() => setExpression("idle"), 1600);
        }
        if (ev.payload?.anim) fireAnim(ev.payload.anim as AnimCue["kind"]);
      }
    ).then((u) => unsubs.push(u));
    void listen("chat-closed", () => {
      setChatOpen(false);
      chatOpenRef.current = false;
      setChatLarge(false);
    }).then((u) => unsubs.push(u));
    void listen("calendar-closed", () => {
      setCalendarOpen(false);
      setCalendarLarge(false);
    }).then((u) => unsubs.push(u));
    void listen("color-closed", () => {
      setColorPickerOpen(false);
    }).then((u) => unsubs.push(u));
    void listen("settings-closed", () => {
      setSettingsOpen(false);
    }).then((u) => unsubs.push(u));
    void listen("link-closed", () => {
      setLinkOpen(false);
    }).then((u) => unsubs.push(u));
    void listen("login-closed", () => {
      setLoginOpen(false);
    }).then((u) => unsubs.push(u));
    void listen("menu-closed", () => {
      setMenuOpen(false);
      menuOpenRef.current = false;
    }).then((u) => unsubs.push(u));
    void listen<{ action?: string }>("menu-action", (ev) => {
      const action = ev.payload?.action;
      if (!action) return;
      setMenuOpen(false);
      menuOpenRef.current = false;
      switch (action) {
        case "chat":
          void openChatRef.current();
          break;
        case "calendar":
          void openCalendarRef.current?.();
          break;
        case "color":
          void openColorRef.current();
          break;
        case "settings":
          void openSettingsRef.current?.();
          break;
        case "login":
          void openLoginRef.current?.();
          break;
        case "sync":
          void syncCalendarRef.current?.();
          break;
        case "airdrop":
          void airDropRef.current?.();
          break;
        case "hide":
          void hideRef.current?.();
          break;
        case "quit":
          void quitRef.current?.();
          break;
        default:
          break;
      }
    }).then((u) => unsubs.push(u));
    void listen("grok-logged-in", () => {
      setLoginOpen(false);
      void hidePanelWindow("login");
    }).then((u) => unsubs.push(u));
    void listen<{ mode?: LightColorMode }>("color-changed", (ev) => {
      // Member birthday only: stick color locked — user birthday stays free
      if (birthdayTodayRef.current || getNewJeansBirthdayToday()) return;
      const mode = ev.payload?.mode;
      if (!mode) return;
      setLightColor(mode);
      saveLightColorMode(mode);
      fireAnim("color");
    }).then((u) => unsubs.push(u));
    void listen<{ cfg?: AppConfig }>("settings-saved", (ev) => {
      if (ev.payload?.cfg) setConfig(ev.payload.cfg);
    }).then((u) => unsubs.push(u));
    void listen<{ muted?: boolean }>("mute-changed", (ev) => {
      if (typeof ev.payload?.muted === "boolean") {
        setMutedState(ev.payload.muted);
      }
    }).then((u) => unsubs.push(u));
    void listen<{ large?: boolean }>("calendar-toggle-size", (ev) => {
      const next = !!ev.payload?.large;
      setCalendarLarge(next);
      void resizePanelWindow("calendar", next);
    }).then((u) => unsubs.push(u));
    void listen("schedule-updated", () => {
      void reloadScheduleFromDisk().then((events) => {
        setSchedule(events);
        void publishScheduleToCompanion(events);
      });
    }).then((u) => unsubs.push(u));
    return () => unsubs.forEach((u) => u());
  }, [fireAnim]);

  const collapseCareLayout = useCallback(async () => {
    if (!careOpenRef.current) return;
    careOpenRef.current = false;
    try {
      await collapseSideToPet("right", petScaleRef.current);
    } catch {
      await collapseToPet(panelDockRef.current, petScaleRef.current);
    }
  }, []);

  /**
   * Drop care bubble + side strip immediately (opening another panel / menu).
   * Avoids a clipped bubble while the window resizes.
   */
  const clearCareBubbleNow = useCallback(async () => {
    setCareBubble(null);
    if (!careOpenRef.current) return;
    careOpenRef.current = false;
    try {
      await collapseSideToPet("right", petScaleRef.current);
    } catch {
      const { w, h } = petSizeAt(petScaleRef.current);
      await invoke("resize_bottom_center", { width: w, height: h }).catch(
        () => undefined
      );
    }
  }, []);

  /**
   * Size the main pet window. If a care bubble is still showing, keep the
   * right strip so the bubble is never clipped by a pet-only resize.
   */
  const sizeMainForPet = useCallback(async () => {
    const scale = petScaleRef.current;
    if (careOpenRef.current || careBubbleRef.current?.visible) {
      await expandForCare("right", scale);
      return;
    }
    const { w, h } = petSizeAt(scale);
    // resize_bottom_center no-ops when already correct (native skip) — safe always
    await invoke("resize_bottom_center", { width: w, height: h }).catch(
      () => undefined
    );
  }, []);

  /**
   * Dismiss care bubble (timer / tap).
   * Collapses the right-hand strip so only the pet remains.
   */
  const dismissCareBubble = useCallback(() => {
    setCareBubble((prev) => (prev ? { ...prev, visible: false } : null));
    window.setTimeout(() => {
      setCareBubble(null);
      void collapseCareLayout().then(() => careRescheduleRef.current());
    }, 220);
  }, [collapseCareLayout]);

  /**
   * Show weather FX (+ care tip when free) for Mac wake / chat weather ask.
   * Wake path always tries to show anime even if network is slow (uses cache).
   *
   * Important: do NOT resume_pet / float-home on wake — that animates
   * size+position while the care strip expands and causes jitter/afterimage.
   * Native already showed the window; we only unpause + one expand + FX.
   */
  const playWeatherMoment = useCallback(
    async (source: "wake" | "chat") => {
      console.log("[weather-fx] moment", source);
      try {
        if (source === "wake") {
          setAppPaused(false);
        }

        // Member birthday always first — weather waits until celebration ends
        await ensureBirthdayThen();

        // Prefer fresh weather (native Rust fetch → real local °C; never fake 22°)
        let w: WeatherSnapshot | null = null;
        try {
          w = await fetchWeather(true);
        } catch {
          w = null;
        }
        if (!w) w = loadCachedWeather();
        // Retry once on wake (network can be slow after lid open)
        if (!w) {
          try {
            w = await fetchWeather(true);
          } catch {
            w = null;
          }
        }
        if (w) {
          setWeather(w);
        } else {
          console.warn(
            "[weather-fx] no live weather — skip fake temp; FX may still run"
          );
        }

        // One expand first (stable frame), then start FX — avoids canvas resize mid-anime
        if (
          source === "wake" &&
          shellRef.current === "compact" &&
          !chatOpenRef.current &&
          !colorPickerOpenRef.current &&
          !calendarOpenRef.current &&
          !settingsOpenRef.current &&
          !linkOpenRef.current &&
          !loginOpenRef.current
        ) {
          try {
            await expandForCare("right", petScaleRef.current);
            careOpenRef.current = true;
            // Let the compositor settle one frame before mounting weather overlays
            await new Promise<void>((r) =>
              requestAnimationFrame(() => requestAnimationFrame(() => r()))
            );
          } catch {
            /* still try FX */
          }
        }

        // If birthday started again somehow, wait once more before weather
        const bdayLeft = Math.max(
          0,
          birthdayPlayingUntilRef.current - Date.now()
        );
        if (bdayLeft > 0) {
          await new Promise<void>((r) => window.setTimeout(r, bdayLeft + 40));
        }

        // Weather anime for exactly WEATHER_FX_MS (8s) — alone on stage
        setWeatherFxForced(true);
        weatherFxForcedRef.current = true;
        weatherMotionActiveRef.current = true;
        motionBusyUntilRef.current = Date.now() + WEATHER_FX_MS;
        // Clear leftover one-shots so weather is alone (birthday already finished)
        setAnimCue(NO_CUE);
        window.clearTimeout(weatherFxForceTimerRef.current);
        weatherFxForceTimerRef.current = window.setTimeout(() => {
          setWeatherFxForced(false);
          weatherFxForcedRef.current = false;
          if (careBubbleRef.current?.kind !== "weather") {
            weatherMotionActiveRef.current = false;
          }
        }, WEATHER_FX_MS);

        if (w) {
          void forceWeatherCareRef.current(w);
        }
      } catch (e) {
        console.error("[weather-fx] moment failed", e);
      }
    },
    [ensureBirthdayThen]
  );

  // MacBook lid open / sleep wake / display wake → weather anime every time
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let lastWake = 0;
    void listen("system-wake", () => {
      const now = Date.now();
      // Extra front-end debounce (native also debounces)
      if (now - lastWake < 2000) return;
      lastWake = now;
      void playWeatherMoment("wake");
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, [playWeatherMoment]);

  // Chat asked about weather → weather moment on the pet
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen("show-weather-fx", () => {
      void playWeatherMoment("chat");
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, [playWeatherMoment]);

  /**
   * Care bubbles (right of Binky) + schedule reminders + realtime weather tips.
   * Work events → 3h before; other events → 1h before. Soft chime on remind.
   */
  useEffect(() => {
    let cancelled = false;
    let showTimer: number | undefined;
    let hideTimer: number | undefined;
    let waitTimer: number | undefined;
    let remindPoll: number | undefined;
    let weatherPreferOnce =
      !!weatherRef.current && weatherNeedsUmbrella(weatherRef.current);

    const showBubble = async (
      line: { text: string; kind: CareKind; emoji: string },
      sound: "notice" | "reminder",
      opts?: { forceWeather?: boolean }
    ) => {
      // Forced weather moments can replace an idle care bubble, but not while
      // chat/menu/settings panels own the pet strip.
      if (cancelled || appPausedRef.current) return false;
      if (opts?.forceWeather) {
        if (
          chatOpenRef.current ||
          colorPickerOpenRef.current ||
          calendarOpenRef.current ||
          settingsOpenRef.current ||
          linkOpenRef.current ||
          loginOpenRef.current ||
          shellRef.current !== "compact"
        ) {
          return false;
        }
        // Clear existing bubble timers so we can replace — keep careOpenRef
        // if strip already expanded (wake pre-expand) to avoid a re-resize flash
        window.clearTimeout(waitTimer);
        window.clearTimeout(showTimer);
        window.clearTimeout(hideTimer);
        if (careBubbleRef.current) {
          setCareBubble(null);
        }
      } else if (busyForCareRef.current) {
        return false;
      }

      try {
        // Single expand only — double expand on wake caused visible jitter
        if (!careOpenRef.current) {
          await expandForCare("right", petScaleRef.current);
          careOpenRef.current = true;
          await new Promise<void>((r) =>
            requestAnimationFrame(() => requestAnimationFrame(() => r()))
          );
        }
      } catch (e) {
        console.error(e);
        careOpenRef.current = false;
        return false;
      }
      // busyForCareRef lags setState; force weather already filtered panels above
      if (
        cancelled ||
        appPausedRef.current ||
        (!opts?.forceWeather && busyForCareRef.current)
      ) {
        await collapseCareLayout();
        return false;
      }

      careLastTextRef.current = line.text;
      // Tiny paint delay only when we just expanded; wake already settled
      if (!opts?.forceWeather) {
        await new Promise<void>((r) => window.setTimeout(r, 16));
      }
      if (cancelled) return false;
      setCareBubble({
        text: line.text,
        kind: line.kind,
        emoji: line.emoji,
        side: "right",
        visible: true,
      });
      // Track physio interval so water / eyes / move fire on schedule
      const need =
        line.kind === "hydrate" ||
        line.kind === "eyes" ||
        line.kind === "move" ||
        line.kind === "posture" ||
        line.kind === "meal" ||
        line.kind === "breath" ||
        line.kind === "sleep"
          ? line.kind
          : undefined;
      if (need) markCareNeedShown(need);

      if (sound === "reminder") playReminder();
      else playNotice();
      // iPhone: schedule + weather gear reminders (umbrella, etc.)
      if (
        sound === "reminder" ||
        line.kind === "weather" ||
        line.kind === "schedule"
      ) {
        void pushPhoneReminder({
          text: line.text,
          emoji: line.emoji,
          kind: "reminder",
          category:
            line.kind === "schedule"
              ? "schedule"
              : line.kind === "weather"
                ? "weather"
                : "",
          title: line.kind,
        });
      }
      // Birthday care bubble: soft 3D cue only (full arena party runs on its own timer)
      // Weather care: no stick motion cue (weather FX owns the stage)
      if (line.kind !== "weather") {
        const played = fireAnim(
          line.kind === "birthday"
            ? "birthday"
            : sound === "reminder"
              ? "color"
              : "happy"
        );
        if (played) {
          setExpression("happy");
          window.setTimeout(
            () => setExpression("idle"),
            line.kind === "birthday" ? 2800 : 1800
          );
        }
      }

      // Weather care: match FX duration (8s); else CARE_BUBBLE_MS
      const visibleMs =
        line.kind === "weather"
          ? WEATHER_FX_MS
          : line.kind === "birthday"
            ? Math.max(CARE_BUBBLE_MS, 4500)
            : CARE_BUBBLE_MS;
      hideTimer = window.setTimeout(() => {
        if (cancelled) return;
        setCareBubble((prev) => (prev ? { ...prev, visible: false } : null));
        showTimer = window.setTimeout(() => {
          if (cancelled) return;
          setCareBubble(null);
          void collapseCareLayout().then(() => {
            if (!cancelled) scheduleNext();
          });
        }, 220);
      }, visibleMs);
      return true;
    };

    const scheduleNext = (asFirst = false) => {
      if (cancelled) return;
      const delay = nextCareDelayMs(asFirst || careFirstRef.current);
      careFirstRef.current = false;
      waitTimer = window.setTimeout(() => void tryShow(), delay);
    };

    /** Priority: due schedule reminders, else idle care line */
    const tryShow = async () => {
      if (cancelled) return;
      if (busyForCareRef.current || document.hidden) {
        waitTimer = window.setTimeout(() => void tryShow(), careBusyRetryMs());
        return;
      }

      // 1) Schedule reminders first (work 3h / other 1h)
      const due = getDueReminders(loadSchedule());
      if (due.length) {
        const r = due[0];
        markReminded(r.event.id);
        const ok = await showBubble(
          {
            text: r.message,
            kind: "schedule",
            emoji: r.emoji,
          },
          "reminder"
        );
        if (!ok) scheduleNext();
        return;
      }

      // 1b) Birthday celebration bubble (member first, else user bunny)
      const memberBday =
        birthdayTodayRef.current ?? getNewJeansBirthdayToday();
      const userBday =
        userBirthdayTodayRef.current ?? getUserBirthdayToday();
      const bdayKey = memberBday
        ? memberBday.key
        : userBday
          ? `user-${userBday.month}-${userBday.day}`
          : null;
      if (bdayKey && (memberBday || userBday)) {
        const stampKey = `baa-bday-bubble:${bdayKey}:${todayKey()}`;
        let last = 0;
        try {
          last = Number(sessionStorage.getItem(stampKey) || "0");
        } catch {
          /* ignore */
        }
        const now = Date.now();
        const dueBubble = !last || now - last > 55 * 60_000;
        if (dueBubble) {
          try {
            sessionStorage.setItem(stampKey, String(now));
          } catch {
            /* ignore */
          }
          const lines = memberBday
            ? birthdayCareLines(memberBday)
            : userBirthdayCareLines(userBday!);
          const pick = lines[Math.floor(Math.random() * lines.length)];
          const ok = await showBubble(
            {
              text: pick.text,
              kind: "birthday",
              emoji: pick.emoji,
            },
            "notice"
          );
          if (!ok) scheduleNext();
          return;
        }
      }

      // 2) Normal care / cheer line
      const titles = loadSchedule()
        .filter((e) => e.date === todayKey())
        .map((e) => e.title);

      // Use shared weather state (ref keeps latest without re-running effect)
      let w = weatherRef.current;
      if (!w) {
        w = await fetchWeather();
        if (w && !cancelled) setWeather(w);
      }

      // Birthday celebration owns the stick — don't start weather care mid-party
      const birthdayBusy = Date.now() < birthdayPlayingUntilRef.current;
      const preferWeather =
        !birthdayBusy &&
        weatherPreferOnce &&
        w &&
        (weatherNeedsUmbrella(w) ||
          w.kind === "storm" ||
          w.kind === "snow");
      if (preferWeather) weatherPreferOnce = false;

      const line = pickCareLine({
        avoidText: careLastTextRef.current,
        scheduleTitles: titles,
        weather: w,
        preferWeather: !!preferWeather,
      });

      // Nothing due yet — wait for the next physio interval (no spam)
      if (!line) {
        scheduleNext();
        return;
      }

      const ok = await showBubble(
        line,
        line.kind === "weather" && w && weatherNeedsUmbrella(w)
          ? "reminder"
          : "notice"
      );
      if (!ok) scheduleNext();
    };

    /** Poll often so we don't miss the 1h / 3h window */
    const pollReminders = async () => {
      if (cancelled) return;
      const due = getDueReminders(loadSchedule());
      if (!due.length) return;

      // Mac busy: still push to phone so you don't miss work/schedule
      if (busyForCareRef.current || document.hidden || careBubbleRef.current) {
        for (const r of due) {
          markReminded(r.event.id);
          void pushPhoneReminder({
            text: r.message,
            emoji: r.emoji,
            kind: "reminder",
            category: r.event.category ?? "other",
            title: r.event.title,
          });
        }
        return;
      }
      // Interrupt idle timer and show on Mac (showBubble also pushes phone)
      window.clearTimeout(waitTimer);
      window.clearTimeout(showTimer);
      window.clearTimeout(hideTimer);
      await tryShow();
    };

    careRescheduleRef.current = () => scheduleNext(false);

    forceWeatherCareRef.current = async (w: WeatherSnapshot) => {
      if (cancelled || appPausedRef.current) return;
      const lines = weatherCareLines(w);
      if (!lines.length) return;
      const line = lines[Math.floor(Math.random() * lines.length)];
      const ok = await showBubble(
        line,
        weatherNeedsUmbrella(w) ? "reminder" : "notice",
        { forceWeather: true }
      );
      if (!ok) {
        // FX still forced by playWeatherMoment even without bubble
        console.log("[weather-fx] care bubble skipped (busy UI)");
      }
    };

    careFirstRef.current = true;
    scheduleNext(true);
    remindPoll = window.setInterval(() => void pollReminders(), 30_000);

    return () => {
      cancelled = true;
      careRescheduleRef.current = () => undefined;
      forceWeatherCareRef.current = () => undefined;
      window.clearTimeout(waitTimer);
      window.clearTimeout(showTimer);
      window.clearTimeout(hideTimer);
      if (remindPoll) window.clearInterval(remindPoll);
      if (careOpenRef.current) {
        careOpenRef.current = false;
        void collapseSideToPet("right", petScaleRef.current).catch(() => undefined);
      }
    };
  }, [fireAnim, collapseCareLayout]);

  // Shared weather fetch for care tips (FX runs only when weather care bubble shows)
  useEffect(() => {
    let cancelled = false;
    void fetchWeather().then((w) => {
      if (!cancelled && w) {
        setWeather(w);
        console.log("[weather]", w.kind, w.tempC, w.place);
      }
    });
    const id = window.setInterval(() => {
      void fetchWeather(true).then((w) => {
        if (!cancelled && w) setWeather(w);
      });
    }, 30 * 60 * 1000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  // Care bubble can stay during chat (separate window). Clear immediately for
  // other panels / menu so the pet strip isn’t left half-width and clipped.
  useEffect(() => {
    if (!careBubble?.visible) return;
    if (
      colorPickerOpen ||
      calendarOpen ||
      menuOpen ||
      settingsOpen ||
      linkOpen ||
      loginOpen
    ) {
      void clearCareBubbleNow().then(() => careRescheduleRef.current());
    }
  }, [
    colorPickerOpen,
    calendarOpen,
    menuOpen,
    settingsOpen,
    linkOpen,
    loginOpen,
    careBubble?.visible,
    clearCareBubbleNow,
  ]);

  useEffect(() => {
    const pin = () => {
      invoke("pin_to_all_spaces_cmd").catch(console.error);
      getCurrentWindow()
        .setVisibleOnAllWorkspaces(true)
        .catch(() => undefined);
      getCurrentWindow()
        .setAlwaysOnTop(true)
        .catch(() => undefined);
    };

    // Recover size + apply saved zoom scale
    void resizePetScale(petScaleRef.current)
      .then(() => pin())
      .catch(() => pin());

    pin();
    const t1 = window.setTimeout(pin, 300);
    const t2 = window.setTimeout(pin, 1200);
    const t3 = window.setTimeout(() => {
      void collapseToPet(panelDockRef.current, petScaleRef.current).catch(() => undefined);
    }, 600);
    const onFocus = () => pin();
    const onVis = () => {
      if (document.visibilityState === "visible") pin();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);

    invoke<AppConfig>("get_config").then(setConfig).catch(console.error);

    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  /**
   * All feature panels open as SEPARATE windows.
   * Main window keeps care-bubble strip when the bubble is still showing.
   */
  const openChat = useCallback(async () => {
    if (layoutBusyRef.current || chatOpenRef.current) return;
    orbit.stop();
    layoutBusyRef.current = true;
    const gen = ++layoutGenRef.current;

    setMenuOpen(false);
    menuOpenRef.current = false;
    setColorPickerOpen(false);
    setCalendarOpen(false);
    setSettingsOpen(false);
    setLinkOpen(false);
    setLoginOpen(false);

    try {
      await hidePanelWindow("menu");
      await hidePanelWindow("calendar");
      await hidePanelWindow("color");
      await hidePanelWindow("settings");
      await hidePanelWindow("link");
      await hidePanelWindow("login");

      // Pet stays put — only ensure compact size (no-op if already correct)
      await sizeMainForPet();

      await showChatWindow(chatLarge);
      if (gen !== layoutGenRef.current) return;

      setShell("compact");
      setChatOpen(true);
      chatOpenRef.current = true;
      fireAnim("chatOpen");

      // Re-assert care layout after chat window appears
      if (careOpenRef.current || careBubbleRef.current?.visible) {
        await expandForCare("right", petScaleRef.current);
      }
    } catch (e) {
      console.error(e);
      setChatOpen(false);
      chatOpenRef.current = false;
    } finally {
      if (gen === layoutGenRef.current) layoutBusyRef.current = false;
    }
  }, [orbit, fireAnim, chatLarge, sizeMainForPet]);
  openChatRef.current = () => {
    void openChat();
  };

  const closeChat = useCallback(async () => {
    if (!chatOpenRef.current) return;
    orbit.stop();
    layoutBusyRef.current = true;

    setChatOpen(false);
    chatOpenRef.current = false;
    setChatLarge(false);
    setExpression("idle");
    setLoading(false);

    try {
      await hideChatWindow();
      setShell("compact");
      // Restore care strip if bubble still showing
      await sizeMainForPet();
    } catch (e) {
      console.error(e);
    } finally {
      layoutBusyRef.current = false;
    }
  }, [orbit, sizeMainForPet]);

  const openColorPicker = useCallback(async () => {
    if (layoutBusyRef.current || colorPickerOpen) return;
    orbit.stop();
    layoutBusyRef.current = true;
    const gen = ++layoutGenRef.current;
    setMenuOpen(false);
    menuOpenRef.current = false;

    try {
      await clearCareBubbleNow();

      chatOpenRef.current = false;
      setChatOpen(false);
      setCalendarOpen(false);
      setSettingsOpen(false);
      setLinkOpen(false);
      setLoginOpen(false);
      await hideChatWindow();
      await hidePanelWindow("menu");
      await hidePanelWindow("calendar");
      await hidePanelWindow("settings");
      await hidePanelWindow("link");
      await hidePanelWindow("login");

      // Do NOT resize pet for floating panels (chat/calendar pattern)
      await showPanelWindow("color");
      if (gen !== layoutGenRef.current) return;

      setShell("compact");
      setColorPickerOpen(true);
    } catch (e) {
      console.error(e);
      setColorPickerOpen(false);
    } finally {
      if (gen === layoutGenRef.current) layoutBusyRef.current = false;
    }
  }, [orbit, colorPickerOpen, clearCareBubbleNow]);
  openColorRef.current = () => {
    void openColorPicker();
  };

  const closeColorPicker = useCallback(async () => {
    if (!colorPickerOpen) return;
    orbit.stop();
    layoutBusyRef.current = true;

    setColorPickerOpen(false);

    try {
      await hidePanelWindow("color");
      setShell("compact");
    } catch (e) {
      console.error(e);
    } finally {
      layoutBusyRef.current = false;
    }
  }, [colorPickerOpen, orbit]);

  const openCalendar = useCallback(async () => {
    if (layoutBusyRef.current || calendarOpen) return;
    orbit.stop();
    layoutBusyRef.current = true;
    const gen = ++layoutGenRef.current;
    setMenuOpen(false);
    menuOpenRef.current = false;

    try {
      await clearCareBubbleNow();

      chatOpenRef.current = false;
      setChatOpen(false);
      setColorPickerOpen(false);
      setSettingsOpen(false);
      setLinkOpen(false);
      setLoginOpen(false);
      await hideChatWindow();
      await hidePanelWindow("menu");
      await hidePanelWindow("color");
      await hidePanelWindow("settings");
      await hidePanelWindow("link");
      await hidePanelWindow("login");

      await showPanelWindow("calendar", calendarLarge);
      if (gen !== layoutGenRef.current) return;

      setShell("compact");
      setCalendarOpen(true);
    } catch (e) {
      console.error(e);
      setCalendarOpen(false);
    } finally {
      if (gen === layoutGenRef.current) layoutBusyRef.current = false;
    }
  }, [orbit, calendarOpen, calendarLarge, clearCareBubbleNow]);
  openCalendarRef.current = () => {
    void openCalendar();
  };

  const closeCalendar = useCallback(async () => {
    if (!calendarOpen) return;
    orbit.stop();
    layoutBusyRef.current = true;

    setCalendarOpen(false);
    setCalendarLarge(false);

    try {
      await hidePanelWindow("calendar");
      setShell("compact");
    } catch (e) {
      console.error(e);
    } finally {
      layoutBusyRef.current = false;
    }
  }, [calendarOpen, orbit]);

  const openSettings = useCallback(async () => {
    if (layoutBusyRef.current || settingsOpen) return;
    orbit.stop();
    layoutBusyRef.current = true;
    const gen = ++layoutGenRef.current;
    setMenuOpen(false);
    menuOpenRef.current = false;

    try {
      await clearCareBubbleNow();

      chatOpenRef.current = false;
      setChatOpen(false);
      setColorPickerOpen(false);
      setCalendarOpen(false);
      setLinkOpen(false);
      setLoginOpen(false);
      await hideChatWindow();
      await hidePanelWindow("menu");
      await hidePanelWindow("calendar");
      await hidePanelWindow("color");
      await hidePanelWindow("link");
      await hidePanelWindow("login");

      await showPanelWindow("settings");
      if (gen !== layoutGenRef.current) return;

      setShell("compact");
      setSettingsOpen(true);
    } catch (e) {
      console.error(e);
      setSettingsOpen(false);
    } finally {
      if (gen === layoutGenRef.current) layoutBusyRef.current = false;
    }
  }, [orbit, settingsOpen, clearCareBubbleNow]);
  openSettingsRef.current = () => {
    void openSettings();
  };

  const closeSettings = useCallback(async () => {
    if (!settingsOpen) return;
    orbit.stop();
    layoutBusyRef.current = true;

    setSettingsOpen(false);

    try {
      await hidePanelWindow("settings");
      setShell("compact");
    } catch (e) {
      console.error(e);
    } finally {
      layoutBusyRef.current = false;
    }
  }, [settingsOpen, orbit]);

  const openGrokLogin = useCallback(async () => {
    if (layoutBusyRef.current || loginOpen) return;
    orbit.stop();
    layoutBusyRef.current = true;
    const gen = ++layoutGenRef.current;
    setMenuOpen(false);
    menuOpenRef.current = false;

    try {
      await clearCareBubbleNow();

      chatOpenRef.current = false;
      setChatOpen(false);
      setColorPickerOpen(false);
      setCalendarOpen(false);
      setSettingsOpen(false);
      setLinkOpen(false);
      await hideChatWindow();
      await hidePanelWindow("menu");
      await hidePanelWindow("calendar");
      await hidePanelWindow("color");
      await hidePanelWindow("settings");
      await hidePanelWindow("link");

      await showPanelWindow("login");
      if (gen !== layoutGenRef.current) return;

      setShell("compact");
      setLoginOpen(true);
    } catch (e) {
      console.error(e);
      setLoginOpen(false);
    } finally {
      if (gen === layoutGenRef.current) layoutBusyRef.current = false;
    }
  }, [orbit, loginOpen, clearCareBubbleNow]);
  openLoginRef.current = () => {
    void openGrokLogin();
  };

  const closeGrokLogin = useCallback(async () => {
    if (!loginOpen) return;
    orbit.stop();
    layoutBusyRef.current = true;
    setLoginOpen(false);
    try {
      await hidePanelWindow("login");
      setShell("compact");
    } catch (e) {
      console.error(e);
    } finally {
      layoutBusyRef.current = false;
    }
  }, [loginOpen, orbit]);

  /** Hide floating function menu if open. */
  const collapseMenuIfOpen = useCallback(async () => {
    setMenuOpen(false);
    menuOpenRef.current = false;
    setLinkOpen(false);
    void hidePanelWindow("menu");
    void hidePanelWindow("link");
    setShell("compact");
  }, []);

  /**
   * Sync lightstick schedule into Apple Calendar named “BAA”.
   * Same Apple ID → iPhone sees events under BAA (not Family).
   */
  const mapEventsForCal = (events: ScheduleEvent[]) =>
    events.map((e) => ({
      id: e.id,
      date: e.date,
      title: e.title,
      time: e.time ?? null,
      note: e.note ?? null,
      category: e.category ?? null,
    }));

  const syncToAppleCalendar = useCallback(async () => {
    await collapseMenuIfOpen();

    // Always re-read disk — other windows (calendar) write there
    const events = await reloadScheduleFromDisk().catch(() => loadSchedule());
    if (events.length === 0) {
      fireAnim("wake");
      setExpression("thinking");
      window.setTimeout(() => setExpression("idle"), 1600);
      console.warn("[calendar] no events to sync");
      return;
    }

    try {
      const n = await invoke<number>("sync_apple_calendar", {
        events: mapEventsForCal(events),
      });
      console.log("[calendar] synced", n, "events → Apple Calendar “BAA”");
      fireAnim("color");
      setExpression("happy");
      window.setTimeout(() => setExpression("idle"), 1400);
    } catch (e) {
      console.error("[calendar] sync failed", e);
      setExpression("sad");
      window.setTimeout(() => setExpression("idle"), 1600);
    }
  }, [collapseMenuIfOpen, fireAnim]);

  /**
   * AirDrop calendar as BAA.ics (plus best-effort Mac Calendar “BAA” sync).
   */
  const airDropCalendar = useCallback(async () => {
    await collapseMenuIfOpen();

    const events = await reloadScheduleFromDisk().catch(() => loadSchedule());
    if (events.length === 0) {
      fireAnim("wake");
      setExpression("thinking");
      window.setTimeout(() => setExpression("idle"), 1600);
      console.warn("[airdrop] no calendar events to send");
      return;
    }

    try {
      const msg = await invoke<string>("airdrop_baa_calendar", {
        events: mapEventsForCal(events),
      });
      console.log("[airdrop]", msg);
      fireAnim("color");
      setExpression("happy");
      window.setTimeout(() => setExpression("idle"), 1400);
    } catch (e) {
      console.error("[airdrop]", e);
      setExpression("sad");
      window.setTimeout(() => setExpression("idle"), 1600);
    }
  }, [collapseMenuIfOpen, fireAnim]);

  syncCalendarRef.current = () => {
    void syncToAppleCalendar();
  };
  airDropRef.current = () => {
    void airDropCalendar();
  };

  const closeLinkPhone = useCallback(async () => {
    // Legacy link panel (if any) — just hide
    setLinkOpen(false);
    try {
      await hidePanelWindow("link");
    } catch {
      /* ignore */
    }
  }, []);

  /**
   * Function list = floating panel (like chat). Pet never resizes → no flash/jiggle.
   */
  const openContextMenu = useCallback(async () => {
    if (layoutBusyRef.current || menuOpenRef.current) return;
    orbit.stop();

    layoutBusyRef.current = true;
    const gen = ++layoutGenRef.current;
    try {
      if (careOpenRef.current || careBubbleRef.current?.visible) {
        await clearCareBubbleNow();
        if (gen !== layoutGenRef.current) return;
      }
      // Pet stays put — only show the menu window nearby
      await showPanelWindow("menu");
      if (gen !== layoutGenRef.current) return;
      setShell("compact");
      setMenuOpen(true);
      menuOpenRef.current = true;
    } catch (e) {
      console.error(e);
      setMenuOpen(false);
      menuOpenRef.current = false;
    } finally {
      if (gen === layoutGenRef.current) layoutBusyRef.current = false;
    }
  }, [orbit, clearCareBubbleNow]);

  const closeContextMenu = useCallback(async () => {
    setMenuOpen(false);
    menuOpenRef.current = false;
    try {
      await hidePanelWindow("menu");
    } catch {
      /* ignore */
    }
    setShell("compact");
  }, []);

  const onPointerEnter = (e: React.PointerEvent) => {
    // Rest cursor on stick ≥ 3.5s (no click) → orbit (pet-only mode)
    orbit.onPointerEnter(
      e,
      shellRef.current === "compact" && !chatOpenRef.current
    );
  };

  const onPointerLeave = () => {
    // Only cancels the 3.5s arming; active orbit continues (stick leaves cursor on purpose)
    orbit.onPointerLeave();
    setPointerNorm(null);
  };

  /** Apply two-finger / trackpad free-look deltas (radians-ish via pixel deltas). */
  const applyFreeLookDelta = useCallback((dx: number, dy: number) => {
    const fl = freeLookRef.current;
    fl.active = true;
    fl.yaw += dx * 0.0048;
    fl.pitch = Math.max(-1.05, Math.min(1.05, fl.pitch + dy * 0.0038));
    fl.idleUntil = performance.now() + 2_800;
    setFreeLook({ active: true, yaw: fl.yaw, pitch: fl.pitch });
    // Don't fight free-look with hover-orbit
    if (orbit.isOrbiting()) {
      orbit.stop();
      setHomeHere();
    }
  }, [orbit, setHomeHere]);

  // End free-look after idle → ease animations resume (model eases face-front)
  useEffect(() => {
    if (!freeLook.active) return;
    const id = window.setInterval(() => {
      const fl = freeLookRef.current;
      if (!fl.active) return;
      if (performance.now() < fl.idleUntil) return;
      fl.active = false;
      // Keep last yaw/pitch so 3D can ease back smoothly toward 0
      setFreeLook({ active: false, yaw: fl.yaw, pitch: fl.pitch });
      // Reset stored angles so next inspect starts from face-front after ease
      window.setTimeout(() => {
        if (!freeLookRef.current.active) {
          freeLookRef.current.yaw = 0;
          freeLookRef.current.pitch = 0;
          setFreeLook({ active: false, yaw: 0, pitch: 0 });
        }
      }, 900);
    }, 120);
    return () => window.clearInterval(id);
  }, [freeLook.active]);

  /**
   * Wheel on pet:
   * - Trackpad two-finger swipe (pixel deltas) → free-look rotate (no motion/anime)
   * - Pinch (ctrl+wheel) or mouse wheel (line mode) → zoom
   */
  const onPetWheel = useCallback(
    (e: React.WheelEvent) => {
      if (
        shellRef.current !== "compact" &&
        shellRef.current !== "menu"
      ) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();

      // Pinch-to-zoom on Mac: ctrlKey + wheel. Mouse wheel: often deltaMode LINES.
      const isPinchZoom = e.ctrlKey;
      const isMouseWheel =
        e.deltaMode === WheelEvent.DOM_DELTA_LINE ||
        e.deltaMode === WheelEvent.DOM_DELTA_PAGE;
      const isTrackpadTwoFinger =
        !isPinchZoom &&
        !isMouseWheel &&
        (e.deltaMode === WheelEvent.DOM_DELTA_PIXEL ||
          Math.abs(e.deltaX) > 0.5);

      if (isTrackpadTwoFinger) {
        applyFreeLookDelta(e.deltaX, e.deltaY);
        return;
      }

      // Zoom path
      const next = scaleFromWheel(petScaleRef.current, e.deltaY);
      if (Math.abs(next - petScaleRef.current) < 0.001) return;

      petScaleRef.current = next;
      setPetScale(next);
      savePetScale(next);

      const afterResize = () => {
        if (chatOpenRef.current) {
          void repositionChatWindow(chatLarge);
        }
        if (loginOpen) {
          void repositionPanelWindow("login");
        }
      };

      if (careOpenRef.current || careBubbleRef.current?.visible) {
        void expandForCare("right", next).then(afterResize);
        return;
      }

      void resizePetScale(next).then(afterResize);
      // Reposition floating function menu if open
      if (menuOpenRef.current) {
        void repositionPanelWindow("menu");
      }
    },
    [applyFreeLookDelta, chatLarge, loginOpen]
  );

  /** Two-finger touch free-look (trackpad multi-touch / touchscreens) */
  const onPetTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length !== 2) {
      freeLookTouchRef.current = null;
      return;
    }
    const a = e.touches[0];
    const b = e.touches[1];
    freeLookTouchRef.current = {
      idA: a.identifier,
      idB: b.identifier,
      lastX: (a.clientX + b.clientX) / 2,
      lastY: (a.clientY + b.clientY) / 2,
    };
    e.preventDefault();
  }, []);

  const onPetTouchMove = useCallback(
    (e: React.TouchEvent) => {
      const st = freeLookTouchRef.current;
      if (!st || e.touches.length < 2) return;
      const a = Array.from(e.touches).find((t) => t.identifier === st.idA);
      const b = Array.from(e.touches).find((t) => t.identifier === st.idB);
      if (!a || !b) return;
      e.preventDefault();
      const mx = (a.clientX + b.clientX) / 2;
      const my = (a.clientY + b.clientY) / 2;
      const dx = mx - st.lastX;
      const dy = my - st.lastY;
      st.lastX = mx;
      st.lastY = my;
      applyFreeLookDelta(dx * 1.6, dy * 1.6);
    },
    [applyFreeLookDelta]
  );

  const onPetTouchEnd = useCallback((e: React.TouchEvent) => {
    if (e.touches.length < 2) freeLookTouchRef.current = null;
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    // End free-look inspect on click
    if (freeLookRef.current.active) {
      freeLookRef.current.active = false;
      freeLookRef.current.idleUntil = 0;
      setFreeLook({
        active: false,
        yaw: freeLookRef.current.yaw,
        pitch: freeLookRef.current.pitch,
      });
    }
    // Click/drag stops hover-orbit (document listener also stops orbit)
    if (orbit.isOrbiting()) {
      orbit.stop();
      setHomeHere();
    } else {
      orbit.stop();
    }
    setPaused(true);
    fireAnim("tap");
    setExpression("click");
    window.setTimeout(() => setExpression("idle"), 380);
    dragRef.current = {
      lastX: e.screenX,
      lastY: e.screenY,
      moved: false,
      dragging: true,
    };
    dragVelRef.current = {
      vx: 0,
      vy: 0,
      lastT: performance.now(),
      lastX: e.screenX,
      lastY: e.screenY,
    };
    setDragMotion({ vx: 0, vy: 0, speed: 0, dragging: true });
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = async (e: React.PointerEvent) => {
    orbit.onPointerMove(e);

    // Look-at: map pointer into pet local -1..1
    const el = e.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ny = ((e.clientY - rect.top) / rect.height) * 2 - 1;
      setPointerNorm({
        x: Math.max(-1, Math.min(1, nx)),
        y: Math.max(-1, Math.min(1, ny)),
      });
    }

    // While orbiting from hover, don't free-drag with button unless pressed
    if (orbit.isOrbiting() && !dragRef.current?.dragging) return;

    const d = dragRef.current;
    if (!d?.dragging) return;

    const dx = e.screenX - d.lastX;
    const dy = e.screenY - d.lastY;
    if (!d.moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return;

    d.moved = true;
    d.lastX = e.screenX;
    d.lastY = e.screenY;

    // Velocity for move FX (smoothed px/s)
    const now = performance.now();
    const dv = dragVelRef.current;
    const dt = Math.max(0.008, (now - dv.lastT) / 1000);
    const instVx = (e.screenX - dv.lastX) / dt;
    const instVy = (e.screenY - dv.lastY) / dt;
    dv.vx = dv.vx * 0.55 + instVx * 0.45;
    dv.vy = dv.vy * 0.55 + instVy * 0.45;
    dv.lastT = now;
    dv.lastX = e.screenX;
    dv.lastY = e.screenY;
    const speed = Math.hypot(dv.vx, dv.vy);
    setDragMotion({
      vx: dv.vx,
      vy: dv.vy,
      speed,
      dragging: true,
    });

    try {
      const win = getCurrentWindow();
      const factor = await win.scaleFactor();
      const pos = await win.outerPosition();
      const dxPhys = Math.round(dx * factor);
      const dyPhys = Math.round(dy * factor);
      await win.setPosition(
        new PhysicalPosition(Math.round(pos.x + dxPhys), Math.round(pos.y + dyPhys))
      );
      // Drag overlays with the pet (chat / calendar / etc.)
      const kinds = openPanelKinds();
      if (kinds.length) {
        void nudgeOpenPanelWindows(kinds, dxPhys, dyPhys);
      }
    } catch (err) {
      console.error("drag move failed", err);
    }
  };

  const onPointerUp = async (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const wasDrag = d.moved;
    dragRef.current = null;
    dragVelRef.current.vx = 0;
    dragVelRef.current.vy = 0;
    setDragMotion({ vx: 0, vy: 0, speed: 0, dragging: false });
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }

    if (wasDrag) {
      if (!chatOpenRef.current) setPaused(false);
      setHomeHere();
      poke();
      // Already nudged during drag — final snap next to pet (smart dock)
      if (chatOpenRef.current) {
        void repositionChatWindow(chatLargeRef.current);
      }
      if (calendarOpenRef.current) {
        void repositionPanelWindow("calendar", calendarLargeRef.current);
      }
      if (colorPickerOpenRef.current) {
        void repositionPanelWindow("color");
      }
      if (settingsOpenRef.current) {
        void repositionPanelWindow("settings");
      }
      if (linkOpenRef.current) {
        void repositionPanelWindow("link");
      }
      if (loginOpenRef.current) {
        void repositionPanelWindow("login");
      }
      if (menuOpenRef.current) {
        void repositionPanelWindow("menu");
      }
      return;
    }
    // Tap body: dismiss open panel / menu, else toggle primary panel.
    // Free (no Grok): calendar. Upgraded: chat.
    // Do NOT open a panel while closing another.
    if (e.button === 0) {
      if (loginOpen) {
        await closeGrokLogin();
        return;
      }
      if (calendarOpen) {
        await closeCalendar();
        return;
      }
      if (colorPickerOpen) {
        await closeColorPicker();
        return;
      }
      if (settingsOpen) {
        await closeSettings();
        return;
      }
      if (linkOpen) {
        await closeLinkPhone();
        return;
      }
      if (menuOpen || menuOpenRef.current) {
        await closeContextMenu();
        return;
      }
      if (chatOpenRef.current) {
        await closeChat();
        return;
      }
      if (grokLoggedInRef.current) {
        await openChat();
      } else {
        // Free tier — left-click opens calendar (no Chat in function list either)
        await openCalendarRef.current?.();
      }
    }
  };

  const hide = async () => {
    try {
      setAppPaused(true);
      await hidePanelWindow("menu");
      await invoke("pause_pet");
    } catch (e) {
      try {
        await invoke("hide_window");
      } catch (e2) {
        console.error(e2);
      }
    }
  };
  hideRef.current = () => {
    void hide();
  };

  const quit = async () => {
    try {
      await invoke("quit_app");
    } catch (e) {
      console.error(e);
      window.close();
    }
  };
  quitRef.current = () => {
    void quit();
  };

  const { w: petW, h: petH } = petSizeAt(petScale);
  /** Weather FX: weather care bubble, or forced moment (Mac wake / chat ask) */
  const weatherFx =
    careBubble?.kind === "weather" || weatherFxForced ? weather : null;
  // Keep motion lock in sync with any weather FX source
  weatherMotionActiveRef.current =
    weatherFxForced || careBubble?.kind === "weather";
  weatherFxForcedRef.current = weatherFxForced;

  /**
   * Pet strip — always left-pinned so expanding the care strip never
   * re-centers the stick (center→left was a big source of wake jitter).
   */
  // Keep strip while bubble exists (including exit fade) so text never clips
  const careStripOpen = !!careBubble && shell === "compact";

  // Transparent glass around the stick must not block other apps/windows
  usePetClickThrough({
    petW,
    petH,
    petScale,
    careStripOpen,
    carePanelW: CARE_PANEL_W,
    dragging: dragMotion.dragging || freeLook.active,
  });
  const petBarClass =
    "absolute z-20 bottom-0 left-0 flex items-end justify-start";

  const petBarStyle: CSSProperties = careStripOpen
    ? { width: petW + CARE_PANEL_W, height: petH }
    : { width: petW, height: petH };

  return (
    <div className="w-full h-full bg-transparent overflow-hidden relative">
      {/* —— PET + optional care strip (zoomable; no % translate) —— */}
      <div className={petBarClass} style={petBarStyle}>
        <div
          className="relative shrink-0 flex flex-row items-end justify-start"
          style={{
            width: careStripOpen ? petW + CARE_PANEL_W : petW,
            height: petH,
            transform: "translateZ(0)",
          }}
        >
          {/* Pet column — contain only the 3D stick, not the care bubble */}
          <div
            className="relative shrink-0 flex flex-col items-center justify-end"
            style={{
              width: petW,
              height: petH,
              contain: "layout style",
            }}
          >
          {/* pointer-events none on frame — only stick hit target receives input */}
          <div
            className="relative pointer-events-none"
            style={{ width: petW, height: petH }}
          >
            <GrokPet
              expression={expression}
              lifeState={lifeState}
              facing={facing}
              lightColor={effectiveLightColor}
              birthdayHeart={celebrationEmoji}
              selfSpin={
                !weatherFx && orbit.isOrbitingState && !freeLook.active
              }
              selfSpinFast={
                !weatherFx && orbit.isOrbitingState && !freeLook.active
              }
              hovering={
                !weatherFx &&
                (orbit.isHovering || orbit.isOrbitingState) &&
                !freeLook.active
              }
              chatOpen={chatOpen}
              loading={loading}
              animCue={
                freeLook.active || weatherFx ? undefined : animCue
              }
              motionQuiet={!!weatherFx}
              pointerNorm={freeLook.active ? null : pointerNorm}
              dragMotion={
                freeLook.active || weatherFx
                  ? { vx: 0, vy: 0, speed: 0, dragging: false }
                  : dragMotion
              }
              scale={petScale}
              weather={weatherFx}
              freeLook={weatherFx ? null : freeLook}
              onContextMenu={(e) => {
                e.preventDefault();
                void openContextMenu();
              }}
              onPointerEnter={onPointerEnter}
              onPointerLeave={onPointerLeave}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onWheel={onPetWheel}
              onTouchStart={onPetTouchStart}
              onTouchMove={onPetTouchMove}
              onTouchEnd={onPetTouchEnd}
              onTouchCancel={onPetTouchEnd}
            />
          </div>
          </div>

          {/* Care strip — tucked into pet edge so weather/care bubbles sit close */}
          {careStripOpen && careBubble && (
            <div
              className="relative shrink-0 flex items-center justify-start"
              style={{
                width: CARE_PANEL_W,
                height: petH,
                // Overlap pet column so bubble sits tight to the stick
                marginLeft: -52,
                paddingLeft: 2,
                paddingBottom: Math.round(petH * 0.22),
              }}
            >
              <CareBubble
                layout="strip"
                text={careBubble.text}
                kind={careBubble.kind}
                emoji={careBubble.emoji}
                visible={careBubble.visible}
                onDismiss={dismissCareBubble}
              />
            </div>
          )}
        </div>
      </div>

      {/* Function list is a separate floating window (MenuWindowApp) — not in this tree */}
    </div>
  );
}
