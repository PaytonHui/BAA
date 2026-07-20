import type { PetExpression, PetLifeState } from "../types";
import type { LightColorMode } from "../lib/lightColors";
import type { AnimCue } from "../lib/animCues";
import type { WeatherSnapshot } from "../lib/weather";
import { Lightstick3D } from "./Lightstick3D";

interface GrokPetProps {
  expression: PetExpression;
  lifeState: PetLifeState;
  facing?: 1 | -1;
  lightColor?: LightColorMode;
  selfSpin?: boolean;
  selfSpinFast?: boolean;
  hovering?: boolean;
  chatOpen?: boolean;
  loading?: boolean;
  animCue?: AnimCue;
  birthdayHeart?: string | null;
  /** When true, freeze showcase / party / confetti (weather owns the stage) */
  motionQuiet?: boolean;
  pointerNorm?: { x: number; y: number } | null;
  /** Desktop drag velocity for move FX */
  dragMotion?: {
    vx: number;
    vy: number;
    speed: number;
    dragging: boolean;
  };
  /** Hover-zoom scale (1 = default). Visual + window scale together. */
  scale?: number;
  /**
   * Explicit stage size in CSS px (party arena). When set, canvas fills this
   * instead of PET_W×PET_H×scale so celebration zoom/halo aren’t clipped.
   */
  stageSize?: { w: number; h: number } | null;
  weather?: WeatherSnapshot | null;
  weatherFxLabel?: string | null;
  freeLook?: {
    active: boolean;
    yaw: number;
    pitch: number;
  } | null;
  onContextMenu: (e: React.MouseEvent) => void;
  onPointerEnter?: (e: React.PointerEvent) => void;
  onPointerLeave?: (e: React.PointerEvent) => void;
  onPointerDown?: (e: React.PointerEvent) => void;
  onPointerMove?: (e: React.PointerEvent) => void;
  onPointerUp?: (e: React.PointerEvent) => void;
  onPointerCancel?: (e: React.PointerEvent) => void;
  onWheel?: (e: React.WheelEvent) => void;
  onTouchStart?: (e: React.TouchEvent) => void;
  onTouchMove?: (e: React.TouchEvent) => void;
  onTouchEnd?: (e: React.TouchEvent) => void;
  onTouchCancel?: (e: React.TouchEvent) => void;
}

/** Desktop pet face — NewJeans lightstick 3D (replaces XO-02). */
export function GrokPet(props: GrokPetProps) {
  return <Lightstick3D {...props} />;
}
