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
import {
  CAL_H,
  CAL_LARGE_H,
  CAL_LARGE_W,
  CAL_W,
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
    // When care strip is open, width is larger; height is still the entity height.
    // Pet column width ≈ PET_W * scale from height.
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
  | "menu";

const LABELS: Record<PanelKind, string> = {
  chat: "chat",
  calendar: "calendar",
  color: "color",
  settings: "settings",
  link: "link",
  login: "login",
  menu: "menu",
};

const TITLES: Record<PanelKind, string> = {
  chat: "BAA Chat",
  calendar: "BAA Calendar",
  color: "BAA Light color",
  settings: "BAA Settings",
  link: "BAA AirDrop calendar",
  login: "BAA · Grok login",
  menu: "BAA Menu",
};

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
      return withShadowPad(
        large ? CAL_LARGE_W : CAL_W,
        large
          ? Math.min(CAL_LARGE_H - PET_H + 40, 520)
          : Math.min(CAL_H - PET_H + 40, 400)
      );
    case "chat":
      return withShadowPad(
        large ? CHAT_LARGE_W : CHAT_W,
        large
          ? Math.min(CHAT_LARGE_H - PET_H + 48, 520)
          : Math.min(CHAT_H - PET_H + 48, 400)
      );
    case "color":
      return withShadowPad(COLOR_W, 300);
    case "settings":
      return withShadowPad(SETTINGS_W, 380);
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
  }
}

/**
 * Place panel snug to the lightstick silhouette (not the full transparent
 * pet window). Empty glass around the stick used to make panels feel far.
 */
async function positionNearPet(
  tw: number,
  th: number
): Promise<{ x: number; y: number }> {
  const main = getCurrentWindow();
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

  type Cand = { x: number; y: number; score: number };
  const cands: Cand[] = [];

  // Tops of all panels line up with the top of the entity window
  const topAlignY = winY;

  // Prefer left/right so tops can match the entity
  if (spaceRight >= tw + GAP - 2) {
    cands.push({
      x: stickRight + GAP,
      y: topAlignY,
      score: 200 + spaceRight,
    });
  }
  if (spaceLeft >= tw + GAP - 2) {
    cands.push({
      x: stickLeft - tw - GAP,
      y: topAlignY,
      score: 190 + spaceLeft,
    });
  }
  // Fallbacks (top/bottom) only when sides are blocked
  if (spaceTop >= th + GAP - 2) {
    cands.push({
      x: stickCx - tw / 2,
      y: winY - th - GAP,
      score: 50 + spaceTop,
    });
  }
  if (spaceBottom >= th + GAP - 2) {
    cands.push({
      x: stickCx - tw / 2,
      y: winY + winH + GAP,
      score: 40 + spaceBottom,
    });
  }

  let x: number;
  let y: number;
  if (cands.length) {
    cands.sort((a, b) => b.score - a.score);
    x = cands[0].x;
    y = cands[0].y;
  } else {
    // Last resort: right of stick, top-aligned with entity
    x = stickRight + GAP;
    y = topAlignY;
  }

  // Keep on-screen; allow panels almost flush with edges
  x = Math.max(mx + 2, Math.min(x, mx + mw - tw - 2));
  y = Math.max(my + 2, Math.min(y, my + mh - th - 2));
  return { x: Math.round(x), y: Math.round(y) };
}

export async function showPanelWindow(
  kind: PanelKind,
  large = false
): Promise<void> {
  const label = LABELS[kind];
  const { w, h } = await panelSize(kind, large);
  const { x, y } = await positionNearPet(w, h);
  const shown = `${kind}-window-shown`;

  const existing = await WebviewWindow.getByLabel(label);
  if (existing) {
    const wasVisible = await existing.isVisible().catch(() => false);

    if (wasVisible) {
      // Already on screen: only nudge frame + focus. Do NOT re-emit shown
      // (that would play enter animation a second time).
      try {
        await existing.setSize(new LogicalSize(w, h));
        await existing.setPosition(new LogicalPosition(x, y));
        await existing.setFocus();
      } catch {
        /* ignore */
      }
      // Data refresh only (listeners that ignore animation)
      await emit(`${kind}-window-data`, { large });
      return;
    }

    // Was hidden → place while hidden, show once, then one enter signal
    try {
      await existing.setSize(new LogicalSize(w, h));
      await existing.setPosition(new LogicalPosition(x, y));
    } catch {
      /* ignore */
    }
    await existing.show();
    try {
      await existing.setAlwaysOnTop(true);
      await existing.setVisibleOnAllWorkspaces(true);
    } catch {
      /* ignore */
    }
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    await emit(shown, { large });
    try {
      await existing.setFocus();
    } catch {
      /* ignore */
    }
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
    await win.show();
    await win.setAlwaysOnTop(true);
    await win.setVisibleOnAllWorkspaces(true);
  } catch {
    /* best-effort show */
  }

  // Give the webview a moment to mount listeners, then fire ONE enter
  await new Promise<void>((r) => window.setTimeout(r, 50));
  await emit(shown, { large });
  try {
    await win.setFocus();
  } catch {
    /* ignore */
  }
}

export async function hidePanelWindow(kind: PanelKind): Promise<void> {
  const win = await WebviewWindow.getByLabel(LABELS[kind]);
  if (!win) return;
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
  const visible = await win.isVisible().catch(() => false);
  if (!visible) return;
  const { w, h } = await panelSize(kind, large);
  const { x, y } = await positionNearPet(w, h);
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
        const visible = await win.isVisible();
        if (!visible) return;
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
  const { x, y } = await positionNearPet(w, h);
  await win.setSize(new LogicalSize(w, h));
  await win.setPosition(new LogicalPosition(x, y));
  await emit(`${kind}-window-size`, { large });
}
