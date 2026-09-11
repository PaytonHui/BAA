/** Hover-zoom scale for the lightstick (persisted). */

const KEY = "baa-pet-scale-v1";
const PRESET_KEY = "baa-pet-size-preset-v1";

export type PetSizePreset = "small" | "middle" | "large";

/** Named default sizes (settings). Wheel zoom still moves between min/max. */
export const PET_SIZE_PRESETS: Record<PetSizePreset, number> = {
  small: 0.75,
  middle: 1,
  large: 1.4,
};

export const PET_SIZE_PRESET_LABELS: Record<PetSizePreset, string> = {
  small: "Small",
  middle: "Middle",
  large: "Large",
};

/** Default size = middle (220×324). Dock-home uses the chosen preset. */
export const PET_SCALE_DEFAULT = PET_SIZE_PRESETS.middle;

/**
 * Smallest allowed size — “maximum of small”
 * (cannot shrink below 65% of default).
 */
export const PET_SCALE_MIN = 0.65;

/** Largest allowed size */
export const PET_SCALE_MAX = 1.85;

export function clampPetScale(s: number): number {
  if (!Number.isFinite(s)) return PET_SCALE_DEFAULT;
  return Math.min(PET_SCALE_MAX, Math.max(PET_SCALE_MIN, s));
}

export function loadPetScale(): number {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw == null) return PET_SCALE_DEFAULT;
    return clampPetScale(parseFloat(raw));
  } catch {
    return PET_SCALE_DEFAULT;
  }
}

export function savePetScale(s: number): void {
  try {
    localStorage.setItem(KEY, String(clampPetScale(s)));
  } catch {
    /* ignore */
  }
}

export function isPetSizePreset(v: unknown): v is PetSizePreset {
  return v === "small" || v === "middle" || v === "large";
}

export function loadPetSizePreset(): PetSizePreset {
  try {
    const raw = localStorage.getItem(PRESET_KEY);
    if (isPetSizePreset(raw)) return raw;
  } catch {
    /* ignore */
  }
  return "middle";
}

export function savePetSizePreset(preset: PetSizePreset): void {
  try {
    localStorage.setItem(PRESET_KEY, preset);
  } catch {
    /* ignore */
  }
}

/** Dock / “home” size — the preset chosen in Settings. */
export function loadHomeScale(): number {
  return PET_SIZE_PRESETS[loadPetSizePreset()];
}

/** Apply a named default and persist both preset + current scale. */
export function applyPetSizePreset(preset: PetSizePreset): number {
  const scale = PET_SIZE_PRESETS[preset];
  savePetSizePreset(preset);
  savePetScale(scale);
  return scale;
}

/** Apply wheel/pinch delta → new scale */
export function scaleFromWheel(current: number, deltaY: number): number {
  // Trackpad pinch on macOS often sends ctrlKey + wheel
  // Smooth exponential zoom
  const factor = Math.exp(-deltaY * 0.0018);
  return clampPetScale(current * factor);
}
