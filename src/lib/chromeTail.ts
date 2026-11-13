/** Points for the chrome-star tail. The tail uses the same shine as a drag. */

export const CHROME_TAIL_CLUSTERS = 8;
export const CHROME_BOB_SPEED = 1.4;

export function chromeTailSpan(speed: number): number {
  return 0.92 + speed * 0.28;
}

/** 0 = just behind the star, 1 = the tip. */
export function chromeTailU(index: number, count: number): number {
  return (index + 0.55) / count;
}

export function chromeTailFade(u: number): number {
  return 0.2 + 0.8 * Math.pow(1 - u, 1.05);
}

/** Point on the orbit. `t` is the clock time that belongs to this angle. */
export function chromeOrbitPoint(
  ang: number,
  r: number,
  depth: number,
  y: number,
  bobAmp: number,
  bobPhase: number,
  t: number
): { x: number; y: number; z: number } {
  return {
    x: Math.cos(ang) * r,
    y: y + Math.sin(t * CHROME_BOB_SPEED + bobPhase) * bobAmp,
    z: Math.sin(ang) * r * depth,
  };
}

export type ChromeTailSpec = {
  ang: number;
  speed: number;
  r: number;
  depth: number;
  y: number;
  bobAmp: number;
  bobPhase: number;
  t: number;
  /** Radians behind the star where the shine starts. */
  insetRad: number;
};

/**
 * One shine cluster behind the star.
 * Local +angle is the direction of travel, so the tail walks toward smaller angles.
 */
export function chromeTailSample(
  spec: ChromeTailSpec,
  u: number
): { x: number; y: number; z: number; fade: number } {
  const span = chromeTailSpan(spec.speed);
  const a = spec.ang - spec.insetRad - u * span;
  const dt = (spec.ang - a) / Math.max(spec.speed, 1e-4);
  const ts = spec.t - dt;
  const p = chromeOrbitPoint(
    a,
    spec.r,
    spec.depth,
    spec.y,
    spec.bobAmp,
    spec.bobPhase,
    ts
  );
  return { x: p.x, y: p.y, z: p.z, fade: chromeTailFade(u) };
}
