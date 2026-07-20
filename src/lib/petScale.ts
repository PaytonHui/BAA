/** Hover-zoom scale for the lightstick (persisted). */

const KEY = "baa-pet-scale-v1";

/** Default size = 1 (190×280) */
export const PET_SCALE_DEFAULT = 1;

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

/** Apply wheel/pinch delta → new scale */
export function scaleFromWheel(current: number, deltaY: number): number {
  // Trackpad pinch on macOS often sends ctrlKey + wheel
  // Smooth exponential zoom
  const factor = Math.exp(-deltaY * 0.0018);
  return clampPetScale(current * factor);
}
