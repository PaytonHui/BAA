/** User-selectable lightstick LED modes */
export type LightColorMode =
  | "cycle"
  | "blue"
  | "orange"
  | "yellow"
  | "green"
  | "purple"
  | "white"
  | "off";

export interface LightColorOption {
  id: LightColorMode;
  label: string;
  /** Member name or description */
  hint: string;
  /** Swatch hex for UI */
  swatch: string;
  /** LED hex (null = cycle all NJ colors; off uses dark hex) */
  hex: string | null;
}

/**
 * Real lightstick LED hues sampled from AirDropped photos
 * (IMG_7285–7290 · green, purple, blue, orange, yellow, white).
 */
export const LIGHT_HEX = {
  white: "#EAF7FF",
  green: "#6BFF60",
  purple: "#F24AFF",
  blue: "#2060FF",
  orange: "#FF6235",
  yellow: "#FFF874",
} as const;

/** Fixed-color metadata (lookup only — order comes from CYCLE_COLOR_MODES) */
const SOLID_COLOR_META: Record<
  Exclude<LightColorMode, "cycle" | "off">,
  { label: string; hint: string }
> = {
  white: { label: "White", hint: "Default" },
  green: { label: "Green", hint: "Haerin" },
  purple: { label: "Purple", hint: "Hyein" },
  blue: { label: "Blue", hint: "Minji" },
  orange: { label: "Orange", hint: "Hanni" },
  yellow: { label: "Yellow", hint: "Danielle" },
};

/**
 * Mode ids for the 6 lit colors — single source of order for:
 * cycle animation, LED hex list, and the color-choose window.
 * white → green → purple → blue → orange → yellow
 */
export const CYCLE_COLOR_MODES = [
  "white",
  "green",
  "purple",
  "blue",
  "orange",
  "yellow",
] as const satisfies readonly Exclude<LightColorMode, "cycle" | "off">[];

/** Cycle hexes derived from CYCLE_COLOR_MODES (stick LED animation) */
export const CYCLE_COLOR_HEXES: readonly string[] = CYCLE_COLOR_MODES.map(
  (id) => LIGHT_HEX[id]
);

/**
 * Picker UI order = cycle order (after Cycle):
 * white → green → purple → blue → orange → yellow · then Off.
 * Built from CYCLE_COLOR_MODES so the choose window cannot drift from the stick cycle.
 */
export const LIGHT_COLOR_OPTIONS: LightColorOption[] = [
  {
    id: "cycle",
    label: "Cycle",
    hint: "Hold each color · quick snap to next",
    swatch: `conic-gradient(${CYCLE_COLOR_HEXES.join(", ")}, ${CYCLE_COLOR_HEXES[0]})`,
    hex: null,
  },
  ...CYCLE_COLOR_MODES.map((id) => ({
    id,
    label: SOLID_COLOR_META[id].label,
    hint: SOLID_COLOR_META[id].hint,
    swatch: LIGHT_HEX[id],
    hex: LIGHT_HEX[id],
  })),
  {
    id: "off",
    label: "Off",
    hint: "Unlit soft-white plastic · no glow",
    // Cool soft-white from off product capture
    swatch: "#E8ECF2",
    hex: "#E8ECF2",
  },
];

export function isLightOff(mode: LightColorMode): boolean {
  return mode === "off";
}

const STORAGE_KEY = "baa-light-color";

export function loadLightColorMode(): LightColorMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    // Migrate old "pink" id → orange (photo was orange, not pink)
    if (v === "pink") return "orange";
    if (v && LIGHT_COLOR_OPTIONS.some((o) => o.id === v)) {
      return v as LightColorMode;
    }
  } catch {
    /* ignore */
  }
  return "cycle";
}

export function saveLightColorMode(mode: LightColorMode) {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* ignore */
  }
}

export function hexForMode(mode: LightColorMode): string | null {
  // "off" is handled specially (no emissive) — not a lit color
  if (mode === "off") return null;
  return LIGHT_COLOR_OPTIONS.find((o) => o.id === mode)?.hex ?? null;
}
