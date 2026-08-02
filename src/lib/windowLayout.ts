import {
  currentMonitor,
  getCurrentWindow,
} from "@tauri-apps/api/window";
import { PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi";

/** Pet-only window at scale 1 (lightstick stays here visually) */
export const PET_W = 190;
export const PET_H = 280;

/** Logical size at a given zoom scale */
export function petSizeAt(scale: number): { w: number; h: number } {
  const s = Math.min(1.85, Math.max(0.65, scale || 1));
  return {
    w: Math.round(PET_W * s),
    h: Math.round(PET_H * s),
  };
}

/**
 * Chat / calendar heights = panel + pet strip (280) so panels never sit on the pet.
 */
export const CHAT_W = 300;
/** 300 panel + 280 pet + 12 gap */
export const CHAT_H = 592;
export const CHAT_LARGE_W = 400;
/** 440 panel + 280 pet + 12 gap */
export const CHAT_LARGE_H = 732;

/** Expanded window for pet + color palette (iOS glass panel sizes) */
export const COLOR_W = 230;
export const COLOR_H = 480;

/** Settings panel (taller for You · birthday + fav member) */
export const SETTINGS_W = 290;
export const SETTINGS_H = 720;

/** Link iPhone panel */
export const LINK_W = 320;
export const LINK_H = 720;

/** Grok login floating window — room for full upgrade sheet */
export const LOGIN_W = 320;
export const LOGIN_H = 480;

/** Calendar */
export const CAL_W = 300;
export const CAL_H = 612;
export const CAL_LARGE_W = 380;
export const CAL_LARGE_H = 752;
/**
 * Calendar outer content heights (before shadow pad).
 * Keep snug to the card — oversized windows show a white strip under transparent panels.
 */
export const CAL_VIEW_H = 448;
export const CAL_VIEW_LARGE_H = 520;
/** Fallback when form open (before ResizeObserver measures exact height) */
export const CAL_FORM_H = 640;
export const CAL_FORM_LARGE_H = 720;
/** Multi-day section + time wheel needs extra room when form is open */
export const CAL_FORM_MULTI_H = 720;
export const CAL_FORM_MULTI_LARGE_H = 800;

/**
 * Function list is a SEPARATE floating window (like chat) so the pet
 * never resizes — no up/down afterimage. These sizes are for that panel.
 */
export const MENU_PANEL_W = 188;
/** Function list content height — snug to items (no empty top/bottom) */
export const MENU_PANEL_H = 360;
/** With Support BAA expanded (QR + coffee button) */
export const MENU_PANEL_H_SUPPORT = 560;
/**
 * Transparent padding around floating panels so drop-shadows aren’t clipped.
 * Used by menu + all other panel windows.
 */
export const PANEL_SHADOW_PAD = 18;
/** @deprecated use PANEL_SHADOW_PAD */
export const MENU_SHADOW_PAD = PANEL_SHADOW_PAD;
/** Legacy side-strip sizes (care bubble still uses sideways expand) */
export const MENU_W = PET_W + MENU_PANEL_W;
export const MENU_H = PET_H;

/** Care speech bubble strip (wide enough for sync status + weather lines) */
export const CARE_PANEL_W = 220;
export const CARE_W = PET_W + CARE_PANEL_W;
export const CARE_H = PET_H;

export type BubbleSide = "left" | "right";

/**
 * Where the panel sits relative to the lightstick.
 * - top: panel above (pet may drop if near top of screen)
 * - bottom: panel below
 * - left / right: panel beside
 */
export type PanelDock = "top" | "bottom" | "left" | "right";

export type PanelKind = "chat" | "calendar" | "color" | "settings" | "link";

export function panelBox(
  kind: PanelKind,
  large = false
): { panelW: number; totalH: number } {
  switch (kind) {
    case "chat":
      return {
        panelW: large ? CHAT_LARGE_W : CHAT_W,
        totalH: large ? CHAT_LARGE_H : CHAT_H,
      };
    case "calendar":
      return {
        panelW: large ? CAL_LARGE_W : CAL_W,
        totalH: large ? CAL_LARGE_H : CAL_H,
      };
    case "color":
      return { panelW: COLOR_W, totalH: COLOR_H };
    case "settings":
      return { panelW: SETTINGS_W, totalH: SETTINGS_H };
    case "link":
      return { panelW: LINK_W, totalH: LINK_H };
  }
}

/** Window size for a given dock + panel box */
export function windowSizeForDock(
  dock: PanelDock,
  panelW: number,
  totalH: number
): { w: number; h: number } {
  const panelOnlyH = Math.max(120, totalH - PET_H);
  if (dock === "top" || dock === "bottom") {
    return { w: panelW, h: totalH };
  }
  // Side: pet strip + panel, height fits the taller of the two
  return {
    w: PET_W + panelW,
    h: Math.max(PET_H, panelOnlyH + 16),
  };
}

/**
 * Pick left/right so the bubble opens into free space.
 */
export async function pickBubbleSide(): Promise<BubbleSide> {
  try {
    const win = getCurrentWindow();
    const pos = await win.outerPosition();
    const osize = await win.outerSize();
    const mon = await currentMonitor();
    if (!mon) return "right";

    const leftSpace = pos.x - mon.position.x;
    const rightSpace =
      mon.position.x + mon.size.width - (pos.x + osize.width);

    return rightSpace >= leftSpace ? "right" : "left";
  } catch {
    return "right";
  }
}

/**
 * Measure free space around the pet and choose the best dock.
 * Pet NEVER moves — only open where there is already free room.
 * Prefer top; if no room above → right / left / bottom.
 */
export async function pickPanelDock(
  panelW: number,
  totalH: number
): Promise<PanelDock> {
  try {
    const win = getCurrentWindow();
    const factor = await win.scaleFactor();
    const pos = await win.outerPosition(); // physical
    const osize = await win.outerSize();
    const mon = await currentMonitor();
    if (!mon) return "top";

    const mx = mon.position.x;
    const my = mon.position.y;
    const mw = mon.size.width;
    const mh = mon.size.height;

    // Pet rect = bottom-center strip of current window
    const petW = Math.min(osize.width, Math.round(PET_W * factor));
    const petH = Math.min(osize.height, Math.round(PET_H * factor));
    const petCx = pos.x + osize.width / 2;
    const petBottom = pos.y + osize.height;
    const petTop = petBottom - petH;
    const petLeft = petCx - petW / 2;
    const petRight = petCx + petW / 2;

    const spaceTop = petTop - my;
    const spaceBottom = my + mh - petBottom;
    const spaceLeft = petLeft - mx;
    const spaceRight = mx + mw - petRight;

    // Extra height beyond pet for top/bottom docks (panel band)
    const needExtraH = Math.round((totalH - PET_H) * factor);
    const needSideW = Math.round(panelW * factor);
    const sideH = Math.round(Math.max(PET_H, totalH - PET_H + 16) * factor);
    // Side docks grow upward from pet bottom — need room above for extra height
    const sideExtraH = Math.max(0, sideH - petH);

    type Cand = { dock: PanelDock; score: number };
    const cands: Cand[] = [];

    // TOP only if enough free space ABOVE the pet (no drop)
    if (spaceTop >= needExtraH - 4) {
      cands.push({ dock: "top", score: 100 + spaceTop / 1000 });
    }

    // RIGHT — free width on right + height grows up, pet stays put
    if (spaceRight >= needSideW - 4 && spaceTop >= sideExtraH - 4) {
      cands.push({ dock: "right", score: 85 + spaceRight / 1000 });
    }
    // LEFT
    if (spaceLeft >= needSideW - 4 && spaceTop >= sideExtraH - 4) {
      cands.push({ dock: "left", score: 80 + spaceLeft / 1000 });
    }
    // BOTTOM only if enough free space BELOW the pet
    if (spaceBottom >= needExtraH - 4) {
      cands.push({ dock: "bottom", score: 70 + spaceBottom / 1000 });
    }

    // Side docks that grow only sideways (height = PET_H) if tall panel won't fit
    const sideHPet = Math.round(PET_H * factor);
    if (sideH > sideHPet + 8) {
      // Already handled above when spaceTop is enough
    } else {
      if (spaceRight >= needSideW - 4) {
        cands.push({ dock: "right", score: 75 + spaceRight / 1000 });
      }
      if (spaceLeft >= needSideW - 4) {
        cands.push({ dock: "left", score: 72 + spaceLeft / 1000 });
      }
    }

    if (!cands.length) {
      // Still never drop: pick side with most free width, else bottom, else top
      if (spaceRight >= spaceLeft && spaceRight > 20) return "right";
      if (spaceLeft > 20) return "left";
      if (spaceBottom > spaceTop) return "bottom";
      return "top";
    }

    cands.sort((a, b) => b.score - a.score);
    return cands[0].dock;
  } catch {
    return "top";
  }
}

/**
 * Where the pet strip sits inside the current window for a given dock.
 * Compact window (≈ pet size) → whole window is the pet.
 * Expanded bottom dock → pet is the TOP strip (not the bottom — that was the close-jump bug).
 */
function petScreenRect(
  pos: { x: number; y: number },
  osize: { width: number; height: number },
  dock: PanelDock,
  factor: number
): { left: number; top: number; right: number; bottom: number; cx: number } {
  const petW = Math.round(PET_W * factor);
  const petH = Math.round(PET_H * factor);
  const isCompact =
    osize.width <= petW + 8 && osize.height <= petH + 8;

  if (isCompact) {
    return {
      left: pos.x,
      top: pos.y,
      right: pos.x + osize.width,
      bottom: pos.y + osize.height,
      cx: pos.x + osize.width / 2,
    };
  }

  // Expanded: pet strip location depends on dock
  if (dock === "bottom") {
    // Pet at TOP of window
    return {
      left: pos.x + (osize.width - petW) / 2,
      top: pos.y,
      right: pos.x + (osize.width + petW) / 2,
      bottom: pos.y + petH,
      cx: pos.x + osize.width / 2,
    };
  }
  if (dock === "right") {
    // Pet on LEFT strip, bottom-aligned
    return {
      left: pos.x,
      top: pos.y + osize.height - petH,
      right: pos.x + petW,
      bottom: pos.y + osize.height,
      cx: pos.x + petW / 2,
    };
  }
  if (dock === "left") {
    // Pet on RIGHT strip, bottom-aligned
    return {
      left: pos.x + osize.width - petW,
      top: pos.y + osize.height - petH,
      right: pos.x + osize.width,
      bottom: pos.y + osize.height,
      cx: pos.x + osize.width - petW / 2,
    };
  }
  // top: pet at BOTTOM center
  return {
    left: pos.x + (osize.width - petW) / 2,
    top: pos.y + osize.height - petH,
    right: pos.x + (osize.width + petW) / 2,
    bottom: pos.y + osize.height,
    cx: pos.x + osize.width / 2,
  };
}

/**
 * Resize window for panel+pet with smart docking.
 * Pet stays on the same screen pixels open → close.
 */
export async function resizeForDock(
  dock: PanelDock,
  twLogical: number,
  thLogical: number
): Promise<void> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("resize_panel_dock", {
      dock,
      width: twLogical,
      height: thLogical,
    });
    return;
  } catch {
    /* JS fallback */
  }

  const win = getCurrentWindow();
  const factor = await win.scaleFactor();
  const pos = await win.outerPosition();
  const osize = await win.outerSize();

  const newW = Math.round(twLogical * factor);
  const newH = Math.round(thLogical * factor);
  const pet = petScreenRect(pos, osize, dock, factor);

  let x: number;
  let y: number;

  if (dock === "top") {
    // Keep pet bottom-center fixed
    x = Math.round(pet.cx - newW / 2);
    y = Math.round(pet.bottom - newH);
  } else if (dock === "bottom") {
    // Keep pet top-center fixed (critical for close)
    x = Math.round(pet.cx - newW / 2);
    y = Math.round(pet.top);
  } else if (dock === "right") {
    // Keep pet left + bottom fixed
    x = Math.round(pet.left);
    y = Math.round(pet.bottom - newH);
  } else {
    // left: keep pet right + bottom fixed
    x = Math.round(pet.right - newW);
    y = Math.round(pet.bottom - newH);
  }

  await win.setSize(new PhysicalSize(newW, newH));
  await win.setPosition(new PhysicalPosition(x, y));
  try {
    await win.setAlwaysOnTop(true);
  } catch {
    /* ignore */
  }
}

/**
 * Expand with smart (or forced) dock.
 * Callers should set shell CSS for `dock` BEFORE resizing so the pet
 * strip matches — avoids layout flash.
 */
async function expandSmart(
  kind: PanelKind,
  large = false,
  forcedDock?: PanelDock
): Promise<PanelDock> {
  const { panelW, totalH } = panelBox(kind, large);
  const dock = forcedDock ?? (await pickPanelDock(panelW, totalH));
  const { w, h } = windowSizeForDock(dock, panelW, totalH);
  await resizeForDock(dock, w, h);
  return dock;
}

/** Pick dock without resizing (so UI can apply CSS first). */
export async function pickDockFor(
  kind: PanelKind,
  large = false
): Promise<PanelDock> {
  const { panelW, totalH } = panelBox(kind, large);
  return pickPanelDock(panelW, totalH);
}

/**
 * Expand for chat — picks top/left/right/bottom from free space.
 * Pass `forcedDock` if you already called pickDockFor and set CSS.
 */
export async function expandForChat(
  _side: BubbleSide,
  large = false,
  _withCareStrip = false,
  forcedDock?: PanelDock
): Promise<PanelDock> {
  return expandSmart("chat", large, forcedDock);
}

export async function expandForCalendar(
  large = false,
  forcedDock?: PanelDock
): Promise<PanelDock> {
  return expandSmart("calendar", large, forcedDock);
}

export async function expandForColorPicker(
  forcedDock?: PanelDock
): Promise<PanelDock> {
  return expandSmart("color", false, forcedDock);
}

export async function expandForSettings(
  forcedDock?: PanelDock
): Promise<PanelDock> {
  return expandSmart("settings", false, forcedDock);
}

export async function expandForLink(
  forcedDock?: PanelDock
): Promise<PanelDock> {
  return expandSmart("link", false, forcedDock);
}

/**
 * Shrink to pet-only while keeping the lightstick fixed on screen.
 * Pass the dock used when the panel opened (top/bottom/left/right).
 * `scale` = hover-zoom size (default 1).
 */
export async function collapseToPet(
  dockOrSide: PanelDock | BubbleSide | "center" = "top",
  scale = 1
): Promise<void> {
  const dock: PanelDock =
    dockOrSide === "top" ||
    dockOrSide === "bottom" ||
    dockOrSide === "left" ||
    dockOrSide === "right"
      ? dockOrSide
      : "top";

  const { w, h } = petSizeAt(scale);
  await resizeForDock(dock, w, h);
}

/** Resize compact pet window to zoom scale (bottom-center fixed). */
export async function resizePetScale(scale: number): Promise<void> {
  const { w, h } = petSizeAt(scale);
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("resize_bottom_center", { width: w, height: h });
  } catch {
    await resizeForDock("top", w, h);
  }
}

export async function pickMenuSide(): Promise<"left" | "right"> {
  try {
    const win = getCurrentWindow();
    const pos = await win.outerPosition();
    const osize = await win.outerSize();
    const mon = await currentMonitor();
    if (!mon) return "right";
    const factor = await win.scaleFactor();
    const rightSpace =
      mon.position.x + mon.size.width - (pos.x + osize.width);
    const needPhys = MENU_PANEL_W * factor;
    return rightSpace >= needPhys - 2 ? "right" : "left";
  } catch {
    return "right";
  }
}

/** @deprecated Menu is a floating panel now — keep same-height expand for care only */
export async function expandForMenu(
  side?: "left" | "right",
  scale = 1
): Promise<"left" | "right"> {
  const { w: petW, h: petH } = petSizeAt(scale);
  // Sideways only — never change height (height change = pet jiggle/flash)
  return expandSidePanel(side, petW + MENU_PANEL_W, petH);
}

export async function expandForCare(
  _side: "left" | "right" = "right",
  scale = 1
): Promise<"left" | "right"> {
  const { w: petW, h: petH } = petSizeAt(scale);
  await expandSidePanel("right", petW + CARE_PANEL_W, petH);
  return "right";
}

async function expandSidePanel(
  side: "left" | "right" | undefined,
  totalW: number,
  totalH = PET_H
): Promise<"left" | "right"> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const out = await invoke<"left" | "right">("resize_menu_side", {
      side: side ?? null,
      width: totalW,
      height: totalH,
    });
    return out === "left" ? "left" : "right";
  } catch {
    const win = getCurrentWindow();
    const factor = await win.scaleFactor();
    const pos = await win.outerPosition();
    const osize = await win.outerSize();
    const newW = Math.round(totalW * factor);
    const newH = Math.round(totalH * factor);
    const growRight = side !== "left";
    const x = growRight ? pos.x : pos.x + osize.width - newW;
    await win.setSize(new PhysicalSize(newW, newH));
    await win.setPosition(
      new PhysicalPosition(x, pos.y + osize.height - newH)
    );
    return growRight ? "right" : "left";
  }
}

export async function collapseSideToPet(
  side: "left" | "right" = "right",
  scale = 1
): Promise<void> {
  const { w, h } = petSizeAt(scale);
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("collapse_menu_side", {
      menuSide: side,
      width: w,
      height: h,
    });
  } catch {
    await collapseToPet("center", scale);
  }
}

export async function collapseMenuToPet(
  menuSide: "left" | "right",
  scale = 1
): Promise<void> {
  const { w, h } = petSizeAt(scale);
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("collapse_menu_side", {
      menuSide,
      width: w,
      height: h,
    });
    return;
  } catch {
    await collapseToPet("center", scale);
  }
}
