import { useCallback, useEffect, useRef, useState } from "react";

/** Cursor rests on the pet this long (no click) before the in-place spin */
const HOVER_MS = 3500;

/**
 * Hover (not press) on the pet ≥ 3.5s → self-spin in place.
 * The window stays where it is. The spin does not follow the cursor.
 * Once it starts, it keeps going after the cursor leaves.
 * The next click on the pet stops it.
 */
export function useOrbitHover(opts: {
  onOrbitStart?: () => void;
  onOrbitEnd?: () => void;
}) {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const hoveringRef = useRef(false);
  const orbitingRef = useRef(false);
  /** React state so the 3D model can self-spin while the cursor rests on the pet */
  const [isHovering, setIsHovering] = useState(false);
  const [isOrbiting, setIsOrbiting] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const docBoundRef = useRef(false);

  const clearTimer = () => {
    if (timerRef.current != null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const stopRef = useRef<() => void>(() => undefined);

  const handleDocDown = useCallback((_e: PointerEvent) => {
    stopRef.current();
  }, []);

  const stop = useCallback(() => {
    const was = orbitingRef.current;
    clearTimer();
    if (docBoundRef.current) {
      docBoundRef.current = false;
      window.removeEventListener("pointerdown", handleDocDown, true);
    }
    hoveringRef.current = false;
    orbitingRef.current = false;
    setIsHovering(false);
    setIsOrbiting(false);
    if (was) optsRef.current.onOrbitEnd?.();
  }, [handleDocDown]);

  stopRef.current = stop;

  const bindDoc = useCallback(() => {
    if (docBoundRef.current) return;
    docBoundRef.current = true;
    window.addEventListener("pointerdown", handleDocDown, true);
  }, [handleDocDown]);

  useEffect(() => () => stop(), [stop]);

  const onPointerEnter = useCallback(
    (_e: React.PointerEvent, enabled: boolean) => {
      if (!enabled) return;
      if (orbitingRef.current) return;

      hoveringRef.current = true;
      setIsHovering(true);
      clearTimer();

      timerRef.current = setTimeout(() => {
        if (!hoveringRef.current) return;
        orbitingRef.current = true;
        setIsOrbiting(true);
        bindDoc();
        optsRef.current.onOrbitStart?.();
      }, HOVER_MS);
    },
    [bindDoc]
  );

  const onPointerLeave = useCallback(() => {
    // Leaving before the spin starts cancels the wait.
    // A spin that has already started keeps going until the next click.
    hoveringRef.current = false;
    setIsHovering(false);
    clearTimer();
  }, []);

  const onPointerMove = useCallback((_e: React.PointerEvent) => {
    // The pet stays put. Cursor movement must not drag the spin around.
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
