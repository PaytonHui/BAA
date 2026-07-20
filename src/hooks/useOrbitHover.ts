import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { PhysicalPosition } from "@tauri-apps/api/dpi";
import { PET_H, PET_W } from "../lib/windowLayout";

/** Cursor rests on pet this long (no click) before orbit */
const HOVER_MS = 3500;
const ORBIT_RADIUS = 72; // CSS px
const ORBIT_SPEED = 2.4; // rad/s peak
/** Ease radius + angular speed from rest → full orbit */
const ORBIT_RAMP_SEC = 0.85;

function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
}

/**
 * Hover (not press) on lightstick ≥ 3.5s → self-spin + orbit around cursor.
 * Instant hover does NOT spin; only after HOVER_MS.
 * Click anywhere to stop orbit.
 */
export function useOrbitHover(opts: {
  onOrbitStart?: () => void;
  onOrbitEnd?: () => void;
}) {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const hoveringRef = useRef(false);
  const orbitingRef = useRef(false);
  /** React state so 3D model can self-spin while cursor rests on pet */
  const [isHovering, setIsHovering] = useState(false);
  const [isOrbiting, setIsOrbiting] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafRef = useRef(0);
  const angleRef = useRef(0);
  /** CSS-px radius at orbit start (from current window pos); eases → ORBIT_RADIUS */
  const startRadiusRef = useRef(0);
  /** 0 → 1 over ORBIT_RAMP_SEC after orbit starts */
  const rampTRef = useRef(0);
  const mouseRef = useRef({ x: 0, y: 0 });
  const scaleRef = useRef(
    typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1
  );
  const posBusyRef = useRef(false);
  const docBoundRef = useRef(false);

  const clearTimer = () => {
    if (timerRef.current != null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const stopRaf = () => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
  };

  const handleDocMove = useCallback((e: PointerEvent) => {
    mouseRef.current = { x: e.screenX, y: e.screenY };
  }, []);

  // stop declared after doc handlers — use ref for down to avoid cycle
  const stopRef = useRef<() => void>(() => undefined);

  const handleDocDown = useCallback((_e: PointerEvent) => {
    stopRef.current();
  }, []);

  const stop = useCallback(() => {
    const was = orbitingRef.current;
    clearTimer();
    stopRaf();
    if (docBoundRef.current) {
      docBoundRef.current = false;
      window.removeEventListener("pointermove", handleDocMove);
      window.removeEventListener("pointerdown", handleDocDown, true);
    }
    hoveringRef.current = false;
    orbitingRef.current = false;
    rampTRef.current = 0;
    startRadiusRef.current = 0;
    setIsHovering(false);
    setIsOrbiting(false);
    if (was) optsRef.current.onOrbitEnd?.();
  }, [handleDocMove, handleDocDown]);

  stopRef.current = stop;

  const bindDoc = useCallback(() => {
    if (docBoundRef.current) return;
    docBoundRef.current = true;
    window.addEventListener("pointermove", handleDocMove);
    window.addEventListener("pointerdown", handleDocDown, true);
  }, [handleDocMove, handleDocDown]);

  useEffect(() => () => stop(), [stop]);

  const startOrbitLoop = useCallback(() => {
    let last = performance.now();
    rampTRef.current = 0;

    const tick = (now: number) => {
      if (!orbitingRef.current) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      // Soft launch: angular velocity eases 0 → full; radius eases start → target
      rampTRef.current = Math.min(1, rampTRef.current + dt / ORBIT_RAMP_SEC);
      const ease = easeOutCubic(rampTRef.current);
      const speed = ORBIT_SPEED * ease;
      const radiusCss =
        startRadiusRef.current +
        (ORBIT_RADIUS - startRadiusRef.current) * ease;

      angleRef.current += speed * dt;

      if (!posBusyRef.current) {
        posBusyRef.current = true;
        const scale = scaleRef.current;
        const r = radiusCss * scale;
        const mx = mouseRef.current.x * scale;
        const my = mouseRef.current.y * scale;
        const x = Math.round(
          mx + Math.cos(angleRef.current) * r - (PET_W * scale) / 2
        );
        const y = Math.round(
          my + Math.sin(angleRef.current) * r - (PET_H * scale) / 2
        );
        getCurrentWindow()
          .setPosition(new PhysicalPosition(x, y))
          .catch(() => undefined)
          .finally(() => {
            posBusyRef.current = false;
          });
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const onPointerEnter = useCallback(
    (e: React.PointerEvent, enabled: boolean) => {
      if (!enabled) return;
      if (orbitingRef.current) {
        mouseRef.current = { x: e.screenX, y: e.screenY };
        return;
      }

      hoveringRef.current = true;
      setIsHovering(true);
      mouseRef.current = { x: e.screenX, y: e.screenY };
      clearTimer();

      getCurrentWindow()
        .scaleFactor()
        .then((s) => {
          scaleRef.current = s;
        })
        .catch(() => undefined);

      timerRef.current = setTimeout(() => {
        if (!hoveringRef.current) return;
        orbitingRef.current = true;
        setIsOrbiting(true);
        rampTRef.current = 0;
        bindDoc();
        optsRef.current.onOrbitStart?.();

        // Seed angle/radius from the pet's current screen position so the
        // first orbit frame doesn't teleport onto a random point on the circle.
        const win = getCurrentWindow();
        Promise.all([win.outerPosition(), win.scaleFactor()])
          .then(([pos, scale]) => {
            if (!orbitingRef.current) return;
            scaleRef.current = scale;
            const cx = pos.x + (PET_W * scale) / 2;
            const cy = pos.y + (PET_H * scale) / 2;
            const mx = mouseRef.current.x * scale;
            const my = mouseRef.current.y * scale;
            const dx = cx - mx;
            const dy = cy - my;
            const distCss = Math.hypot(dx, dy) / scale;
            angleRef.current = Math.atan2(dy, dx);
            // Stay near where we are; grow out if almost under the cursor
            startRadiusRef.current = Math.min(
              ORBIT_RADIUS,
              Math.max(8, distCss)
            );
            startOrbitLoop();
          })
          .catch(() => {
            if (!orbitingRef.current) return;
            angleRef.current = 0;
            startRadiusRef.current = 8;
            startOrbitLoop();
          });
      }, HOVER_MS);
    },
    [bindDoc, startOrbitLoop]
  );

  const onPointerLeave = useCallback(() => {
    // Only cancel the 3.5s countdown — once orbiting, stick leaves cursor on purpose
    if (orbitingRef.current) return;
    hoveringRef.current = false;
    setIsHovering(false);
    clearTimer();
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!hoveringRef.current && !orbitingRef.current) return;
    mouseRef.current = { x: e.screenX, y: e.screenY };
  }, []);

  return {
    isHovering,
    isOrbitingState: isOrbiting,
    isOrbiting: () => orbitingRef.current,
    onPointerEnter,
    onPointerLeave,
    onPointerMove,
    stop,
  };
}
