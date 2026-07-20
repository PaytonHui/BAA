"use client";

import { useCallback, useState } from "react";
import type { PetLifeState } from "../types";

export interface PetLifeApi {
  lifeState: PetLifeState;
  facing: 1 | -1;
  setPaused: (paused: boolean) => void;
  setHomeHere: () => void;
  poke: () => void;
}

/**
 * Pet stays still — no walk / sit / lie roaming.
 * API stubs kept so chat/orbit/drag can still call pause/home/poke.
 */
export function usePetLife(): PetLifeApi {
  const [lifeState] = useState<PetLifeState>("sit");
  const [facing] = useState<1 | -1>(1);

  const setPaused = useCallback((_paused: boolean) => {
    /* no-op: no autonomous movement to pause */
  }, []);

  const setHomeHere = useCallback(() => {
    /* no-op: no roam yard */
  }, []);

  const poke = useCallback(() => {
    /* no-op */
  }, []);

  return {
    lifeState,
    facing,
    setPaused,
    setHomeHere,
    poke,
  };
}
