/**
 * Floating panel windows beside the pet.
 * Main WebGL window never resizes → no up/down afterimage flash.
 */
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import {
  currentMonitor,
  getAllWindows,
  getCurrentWindow,
} from "@tauri-apps/api/window";
import {
  LogicalPosition,
  LogicalSize,
  PhysicalPosition,
} from "@tauri-apps/api/dpi";
import { emit } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import {
  CAL_FORM_H,
  CAL_FORM_LARGE_H,
  CAL_FORM_MULTI_H,
  CAL_FORM_MULTI_LARGE_H,
  CAL_LARGE_W,
  CAL_VIEW_H,
  CAL_VIEW_LARGE_H,
  CAL_W,
  CARE_PANEL_H,
  CARE_PANEL_W,
  CHAT_H,
  CHAT_LARGE_H,
  CHAT_LARGE_W,
  CHAT_W,
  COLOR_W,
  LINK_H,
  LINK_W,
  LOGIN_H,
  LOGIN_W,
  MENU_PANEL_H,
  MENU_PANEL_W,
  PANEL_SHADOW_PAD,
  PET_H,
  PET_W,
  SETTINGS_W,
  pickBubbleSide,
  type BubbleSide,
} from "./windowLayout";

/** Grow panel outer size so CSS drop-shadow has room inside the transparent window */
function withShadowPad(w: number, h: number): { w: number; h: number } {
  const p = PANEL_SHADOW_PAD * 2;
  return { w: w + p, h: h + p };
}

/**
 * Logical size of the main pet (entity) window — all panels match this height.
 */
export async function getEntityLogicalSize(): Promise<{
  w: number;
  h: number;
  x: number;
  y: number;
}> {
  try {
    const wins = await getAllWindows();
    const main =
      wins.find((w) => w.label === "main") ?? getCurrentWindow();
    const factor = await main.scaleFactor();
    const pos = await main.outerPosition();
    const size = await main.outerSize();
    // Pet window is always the entity size (care is a separate floating window).
    const h = size.height / factor;
    const scale = Math.min(1.85, Math.max(0.65, h / PET_H));
    const petColW = Math.min(size.width / factor, Math.round(PET_W * scale));
    return {
      w: petColW,
      h,
      x: pos.x / factor,
      y: pos.y / factor,
    };
  } catch {
    return { w: PET_W, h: PET_H, x: 0, y: 0 };
  }
}

/** Gap between stick silhouette and floating panels (logical px) */
const GAP = 4;

export type PanelKind =
  | "chat"
  | "calendar"
  | "color"
  | "settings"
  | "link"
  | "login"
  | "menu"
  | "care";

const LABELS: Record<PanelKind, string> = {
  chat: "chat",
  calendar: "calendar",
  color: "color",
  settings: "settings",
  link: "link",
  login: "login",
  menu: "menu",
  care: "care",
};

const TITLES: Record<PanelKind, string> = {
  chat: "BAA Chat",
  calendar: "BAA Calendar",
  color: "BAA Light color",
  settings: "BAA Settings",
  link: "BAA Share calendar",
  login: "BAA · Apple Intelligence",
  menu: "BAA Menu",
  care: "BAA Care",
};

/**
 * Side of the stick opposite an open panel (so a care bubble isn’t hidden
 * behind calendar/chat).
 */
export async function pickSideOppositePanel(
  kind: PanelKind
): Promise<BubbleSide> {
  try {
    const wins = await getAllWindows();
    const main =
      wins.find((w) => w.label === "main") ?? getCurrentWindow();
    const panel = wins.find((w) => w.label === LABELS[kind]);
    if (!panel) return pickBubbleSide();
    const [mPos, pPos, mSize, pSize] = await Promise.all([
      main.outerPosition(),
      panel.outerPosition(),
      main.outerSize(),
      panel.outerSize(),
    ]);
    const petCx = mPos.x + mSize.width / 2;
    const panelCx = pPos.x + pSize.width / 2;
    return panelCx >= petCx ? "left" : "right";
  } catch {
    return "right";
  }
}

/** Extra fields forwarded on `{kind}-window-data` (care bubble copy, etc.) */
export type PanelWindowExtra = Record<string, unknown>;

/**
 * User-friendly content sizes. Tops are aligned with the entity when placed;
 * bottoms may extend past the stick — height is for usability, not matching entity.
 */
async function panelSize(
  kind: PanelKind,
  large: boolean
): Promise<{ w: number; h: number }> {
  switch (kind) {
    case "calendar":
      // Default browse height; form-open grows further via resizeCalendarForComposer
      return withShadowPad(
        large ? CAL_LARGE_W : CAL_W,
        large ? CAL_VIEW_LARGE_H : CAL_VIEW_H
      );
    case "chat":
      // Tall enough for chat bubbles + status line
      return withShadowPad(
        large ? CHAT_LARGE_W : Math.max(CHAT_W, 320),
        large
          ? Math.min(CHAT_LARGE_H - PET_H + 48, 540)
          : Math.min(CHAT_H - PET_H + 80, 460)
      );
    case "color":
      return withShadowPad(COLOR_W, 300);
    case "settings":
      return withShadowPad(SETTINGS_W, 450);
    case "link":
      return withShadowPad(
        Math.max(LINK_W, 300),
        Math.min(LINK_H - PET_H + 80, 480)
      );
    case "login":
      return withShadowPad(LOGIN_W, LOGIN_H);
    case "menu":
      // Full function list — every item visible
      return withShadowPad(MENU_PANEL_W, MENU_PANEL_H);
    case "care":
      return withShadowPad(CARE_PANEL_W, CARE_PANEL_H);
  }
}

/**
 * Place panel snug to the lightstick silhouette (not the full transparent
 * pet window). Empty glass around the stick used to make panels feel far.
 */
async function positionNearPet(
  tw: number,
  th: number,
  kind?: PanelKind,
  preferSide?: BubbleSide
): Promise<{ x: number; y: number; side: BubbleSide }> {
  // Always anchor to the pet (main) window — never the panel webview itself
  const wins = await getAllWindows();
  const main =
    wins.find((w) => w.label === "main") ?? getCurrentWindow();
  const factor = await main.scaleFactor();
  const pos = await main.outerPosition();
  const size = await main.outerSize();
  const mon = await currentMonitor().catch(() => null);

  const winX = pos.x / factor;
  const winY = pos.y / factor;
  const winW = size.width / factor;
  const winH = size.height / factor;

  // Pet column is left-aligned in main window (care strip may expand width)
  const scale = Math.min(1.85, Math.max(0.65, winH / PET_H));
  const petColW = Math.min(winW, Math.round(PET_W * scale));
  const petColH = winH;
  const petColX = winX;
  const petColY = winY;

  // Stick visual footprint (centered in pet column) — tighter than full glass
  const stickW = Math.max(44, 52 * scale);
  const stickH = Math.max(140, 168 * scale);
  const stickLeft = petColX + (petColW - stickW) / 2;
  const stickTop = petColY + (petColH - stickH) / 2;
  const stickRight = stickLeft + stickW;
  const stickBottom = stickTop + stickH;
  const stickCx = stickLeft + stickW / 2;

  let mx = 0;
  let my = 0;
  let mw = 2000;
  let mh = 1200;
  if (mon) {
    mx = mon.position.x / factor;
    my = mon.position.y / factor;
    mw = mon.size.width / factor;
    mh = mon.size.height / factor;
  }

  const spaceTop = stickTop - my;
  const spaceBottom = my + mh - stickBottom;
  const spaceLeft = stickLeft - mx;
  const spaceRight = mx + mw - stickRight;

  type Cand = { x: number; y: number; score: number; side: BubbleSide };
  const cands: Cand[] = [];

  // Tops of most panels line up with the entity. Care sits mid-stick.
  const topAlignY = winY;
  const placeY =
    kind === "care"
      ? Math.round(winY + winH * 0.28 - PANEL_SHADOW_PAD)
      : topAlignY;

  const rightX = stickRight + GAP;
  const leftX = stickLeft - tw - GAP;

  // Prefer left/right so tops can match the entity (care: away from screen edge)
  if (spaceRight >= tw + GAP - 2) {
    let score = 200 + spaceRight;
    if (preferSide === "right") score += 500;
    if (preferSide === "left") score -= 80;
    cands.push({ x: rightX, y: placeY, score, side: "right" });
  }
  if (spaceLeft >= tw + GAP - 2) {
    let score = 190 + spaceLeft;
    if (preferSide === "left") score += 500;
    if (preferSide === "right") score -= 80;
    cands.push({ x: leftX, y: placeY, score, side: "left" });
  }
  // Fallbacks (top/bottom) only when sides are blocked — not for care
  // (care must stay beside the stick; never resize/move the pet)
  if (kind !== "care") {
    if (spaceTop >= th + GAP - 2) {
      cands.push({
        x: stickCx - tw / 2,
        y: winY - th - GAP,
        score: 50 + spaceTop,
        side: "right",
      });
    }
    if (spaceBottom >= th + GAP - 2) {
      cands.push({
        x: stickCx - tw / 2,
        y: winY + winH + GAP,
        score: 40 + spaceBottom,
        side: "right",
      });
    }
  }

  let x: number;
  let y: number;
  let side: BubbleSide;
  if (cands.length) {
    cands.sort((a, b) => b.score - a.score);
    x = cands[0].x;
    y = cands[0].y;
    side = cands[0].side;
  } else {
    // Last resort: roomier side (or requested side). Clamp the PANEL only —
    // never shift the pet window.
    if (preferSide === "left" || (!preferSide && spaceLeft >= spaceRight)) {
      x = leftX;
      side = "left";
    } else {
      x = rightX;
      side = "right";
    }
    y = placeY;
  }

  // Keep on-screen; allow panels almost flush with edges
  x = Math.max(mx + 2, Math.min(x, mx + mw - tw - 2));
  y = Math.max(my + 2, Math.min(y, my + mh - th - 2));
  return { x: Math.round(x), y: Math.round(y), side };
}

async function waitFrames(n = 2) {
  for (let i = 0; i < n; i++) {
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
  }
}

/** Show a window. Care bubble must not steal keyboard from other apps. */
async function revealOverlay(
  win: WebviewWindow,
  stealFocus: boolean
): Promise<void> {
  if (!stealFocus) {
    try {
      await invoke("show_overlay_no_focus", { label: win.label });
      await win.setIgnoreCursorEvents(false);
      return;
    } catch {
      /* fall through to show() */
    }
  }
  try {
    await win.show();
    await win.setIgnoreCursorEvents(false);
    await win.setAlwaysOnTop(true);
    await win.setVisibleOnAllWorkspaces(true);
  } catch {
    /* ignore */
  }
  if (stealFocus) {
    void win.setFocus().catch(() => undefined);
  }
}

export async function showPanelWindow(
  kind: PanelKind,
  large = false,
  extra?: PanelWindowExtra
): Promise<void> {
  const label = LABELS[kind];
  const preferSide =
    extra?.side === "left" || extra?.side === "right"
      ? extra.side
      : undefined;
  // Size + place in parallel with looking up the window
  const [sizePos, existing] = await Promise.all([
    (async () => {
      const { w, h } = await panelSize(kind, large);
      const { x, y, side } = await positionNearPet(w, h, kind, preferSide);
      return { w, h, x, y, side };
    })(),
    WebviewWindow.getByLabel(label),
  ]);
  const { w, h, x, y, side } = sizePos;
  const payload = { large, ...(extra ?? {}), side };
  const shown = `${kind}-window-shown`;
  const prepare = `${kind}-window-prepare`;
  const stealFocus = kind !== "care";

  if (existing) {
    // Care is shown with orderFrontRegardless (no Tauri show()), so isVisible()
    // is often false while the bubble is on screen. Never hide/show it — that
    // desyncs visibility and leaves the bubble behind when the stick is dragged.
    if (kind === "care") {
      try {
        await existing.setSize(new LogicalSize(w, h));
        await existing.setPosition(new LogicalPosition(x, y));
      } catch {
        /* ignore */
      }
      await revealOverlay(existing, false);
      void emit(shown, payload);
      void emit(`${kind}-window-data`, payload);
      return;
    }

    // Blank the webview *while still visible*, then hide — otherwise macOS
    // keeps the last opaque frame and flashes it on the next show.
    void emit(prepare, {});
    await waitFrames(2);
    try {
      await existing.hide();
    } catch {
      /* ignore */
    }

    try {
      await existing.setSize(new LogicalSize(w, h));
      await existing.setPosition(new LogicalPosition(x, y));
    } catch {
      /* ignore */
    }

    await waitFrames(2);

    await revealOverlay(existing, stealFocus);
    await waitFrames(1);
    void emit(shown, payload);
    void emit(`${kind}-window-data`, payload);
    return;
  }

  const page = new URL(window.location.href);
  page.searchParams.set("panel", kind);
  page.hash = "";

  const win = new WebviewWindow(label, {
    url: page.toString(),
    title: TITLES[kind],
    width: w,
    height: h,
    x,
    y,
    decorations: false,
    transparent: true,
    alwaysOnTop: true,
    visibleOnAllWorkspaces: true,
    skipTaskbar: true,
    shadow: false,
    resizable: false,
    focus: false,
    visible: false,
    acceptFirstMouse: true,
  });

  await new Promise<void>((resolve, reject) => {
    const t = window.setTimeout(() => resolve(), 2500);
    win.once("tauri://created", () => {
      window.clearTimeout(t);
      resolve();
    });
    win.once("tauri://error", (e) => {
      window.clearTimeout(t);
      reject(e);
    });
  });

  try {
    await win.setSize(new LogicalSize(w, h));
    await win.setPosition(new LogicalPosition(x, y));
  } catch {
    /* best-effort place */
  }
  await revealOverlay(win, stealFocus);

  // First create: webview needs a tick to mount the shown listener
  await new Promise<void>((r) => window.setTimeout(r, 32));
  void emit(shown, payload);
  void emit(`${kind}-window-data`, payload);
}

export async function hidePanelWindow(kind: PanelKind): Promise<void> {
  const win = await WebviewWindow.getByLabel(LABELS[kind]);
  if (!win) return;
  // Blank first so the compositor doesn't keep a ghost frame for next open
  void emit(`${kind}-window-prepare`, {});
  await waitFrames(2);
  try {
    await win.hide();
  } catch {
    /* ignore */
  }
}

/** Hide every overlay panel (chat / calendar / color / settings / link). */
export async function hideAllPanelWindows(): Promise<void> {
  await Promise.all(
    (Object.keys(LABELS) as PanelKind[]).map((k) => hidePanelWindow(k))
  );
}

export async function repositionPanelWindow(
  kind: PanelKind,
  large = false
): Promise<void> {
  const win = await WebviewWindow.getByLabel(LABELS[kind]);
  if (!win) return;
  // Care overlay is ordered front without Tauri show() — isVisible() lies.
  if (kind !== "care") {
    const visible = await win.isVisible().catch(() => false);
    if (!visible) return;
  }
  const { w, h } = await panelSize(kind, large);
  const { x, y } = await positionNearPet(w, h, kind);
  await win.setSize(new LogicalSize(w, h));
  await win.setPosition(new LogicalPosition(x, y));
}

/**
 * Move open overlay windows by the same physical delta as the pet
 * while dragging — keeps chat/calendar/etc glued to the stick.
 */
export async function nudgeOpenPanelWindows(
  kinds: PanelKind[],
  dxPhys: number,
  dyPhys: number
): Promise<void> {
  if ((!dxPhys && !dyPhys) || kinds.length === 0) return;
  await Promise.all(
    kinds.map(async (kind) => {
      const win = await WebviewWindow.getByLabel(LABELS[kind]);
      if (!win) return;
      try {
        // Care is visible on screen without Tauri show(); don't skip it.
        if (kind !== "care") {
          const visible = await win.isVisible();
          if (!visible) return;
        }
        const pos = await win.outerPosition();
        await win.setPosition(
          new PhysicalPosition(
            Math.round(pos.x + dxPhys),
            Math.round(pos.y + dyPhys)
          )
        );
      } catch {
        /* window may have closed mid-drag */
      }
    })
  );
}

export async function resizePanelWindow(
  kind: PanelKind,
  large: boolean
): Promise<void> {
  const win = await WebviewWindow.getByLabel(LABELS[kind]);
  if (!win) return;
  const { w, h } = await panelSize(kind, large);
  const { x, y } = await positionNearPet(w, h, kind);
  await win.setSize(new LogicalSize(w, h));
  await win.setPosition(new LogicalPosition(x, y));
  await emit(`${kind}-window-size`, { large });
}

/**
 * Grow / shrink the calendar window so the Add plan composer fits fully.
 * Pass `contentHeight` from a measured card (ResizeObserver) to avoid white gap.
 * `multiOpen` = multi-day range controls visible (extra height).
 */
export async function resizeCalendarForComposer(
  formOpen: boolean,
  large: boolean,
  contentHeight?: number,
  multiOpen = false
): Promise<void> {
  const fallback = formOpen
    ? multiOpen
      ? large
        ? CAL_FORM_MULTI_LARGE_H
        : CAL_FORM_MULTI_H
      : large
        ? CAL_FORM_LARGE_H
        : CAL_FORM_H
    : large
      ? CAL_VIEW_LARGE_H
      : CAL_VIEW_H;
  // Measured panel height + small breathing room (not a huge pad)
  let contentH =
    typeof contentHeight === "number" && contentHeight > 120
      ? Math.ceil(contentHeight) + 8
      : fallback;
  // When multi-day strip is open, never fall below multi fallback (clipped measure)
  if (formOpen && multiOpen) {
    contentH = Math.max(contentH, fallback);
  }
  // Clamp so we don't create a huge empty transparent window
  // Multi-day + time wheel is tall — allow up to ~screen-ish panel height
  const maxH = formOpen
    ? large
      ? multiOpen
        ? 920
        : 800
      : multiOpen
        ? 860
        : 740
    : large
      ? 560
      : 500;
  const minH = formOpen ? (multiOpen ? 520 : 420) : 360;
  contentH = Math.max(minH, Math.min(maxH, contentH));

  const { w, h } = withShadowPad(large ? CAL_LARGE_W : CAL_W, contentH);
  const apply = async (win: {
    setSize: (s: LogicalSize) => Promise<void>;
    setPosition: (p: LogicalPosition) => Promise<void>;
    setIgnoreCursorEvents?: (v: boolean) => Promise<void>;
  }) => {
    const { x, y } = await positionNearPet(w, h, "calendar");
    await win.setSize(new LogicalSize(w, h));
    await win.setPosition(new LogicalPosition(x, y));
    // Force macOS transparent redraw (avoids white bar under the card)
    try {
      await win.setIgnoreCursorEvents?.(false);
    } catch {
      /* ignore */
    }
  };
  try {
    const self = getCurrentWindow();
    if (self.label === LABELS.calendar) {
      await apply(self);
      return;
    }
  } catch {
    /* fall through */
  }
  const win = await WebviewWindow.getByLabel(LABELS.calendar);
  if (!win) return;
  await apply(win);
}
