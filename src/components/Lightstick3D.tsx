"use client";

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import type { PetExpression, PetLifeState } from "../types";
import type { LightColorMode } from "../lib/lightColors";
import {
  CYCLE_COLOR_HEXES,
  hexForMode,
  isLightOff,
  LIGHT_HEX,
} from "../lib/lightColors";
import type { AnimCue } from "../lib/animCues";
import {
  playBirthdayFanfare,
  playNotice,
  playSpinJingle,
} from "../lib/sounds";
import type { WeatherSnapshot } from "../lib/weather";
import { weatherIsHot } from "../lib/weather";
import { WeatherFx } from "./WeatherFx";

/** Exact model from Documents/Certificate (New Jeans Light Stick.gltf) */
const MODEL_URL = "/models/newjeans-lightstick/lightstick.gltf";

interface Lightstick3DProps {
  expression: PetExpression;
  lifeState: PetLifeState;
  facing?: 1 | -1;
  lightColor?: LightColorMode;
  selfSpin?: boolean;
  selfSpinFast?: boolean;
  hovering?: boolean;
  /** Chat panel open — triggers nod once via animCue chatOpen */
  chatOpen?: boolean;
  /** Grok thinking / typing */
  loading?: boolean;
  /** One-shot animation cues from App */
  animCue?: AnimCue;
  /**
   * NewJeans member birthday: color heart for FX.
   * When set, LED never rainbow-cycles (stays locked member color).
   */
  birthdayHeart?: string | null;
  /**
   * Weather (or other exclusive FX) owns the stick —
   * no party / spin / confetti / one-shot motion.
   */
  motionQuiet?: boolean;
  /** Pointer in pet local space, -1..1 (for look-at) */
  pointerNorm?: { x: number; y: number } | null;
  /** Desktop window drag velocity for lean / trail / glow */
  dragMotion?: {
    vx: number;
    vy: number;
    speed: number;
    dragging: boolean;
  };
  /** Hover-zoom (1 = default size). Container is already sized by App. */
  scale?: number;
  /**
   * Full stage size (CSS px). Party arena passes the oversized window size so
   * the canvas/halo fill the big window — not the tiny default 190×280.
   */
  stageSize?: { w: number; h: number } | null;
  /** Live weather for sun/rain/sweat overlays — only when a weather care bubble is up */
  weather?: WeatherSnapshot | null;
  /** Caption while previewing weather FX */
  weatherFxLabel?: string | null;
  /**
   * Two-finger free-look: user is orbiting the model manually.
   * When active, all idle/orbit/bob animations freeze.
   */
  freeLook?: {
    active: boolean;
    yaw: number;
    pitch: number;
  } | null;
  onContextMenu: (e: React.MouseEvent) => void;
  /** Stick-only hit target (not the full transparent window) */
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

export type DragMotion = NonNullable<Lightstick3DProps["dragMotion"]>;

interface FloatFx {
  id: number;
  emoji: string;
  left: number;
  delay: number;
  duration: number;
}

/**
 * Desktop pet = exact NewJeans lightstick GLTF + full personality animations.
 */
export function Lightstick3D({
  expression,
  lifeState,
  facing = 1,
  lightColor = "cycle",
  selfSpin = false,
  selfSpinFast = false,
  hovering = false,
  chatOpen = false,
  loading = false,
  animCue,
  birthdayHeart = null,
  motionQuiet = false,
  pointerNorm = null,
  dragMotion = { vx: 0, vy: 0, speed: 0, dragging: false },
  scale = 1,
  stageSize = null,
  weather = null,
  weatherFxLabel = null,
  freeLook = null,
  onContextMenu,
  onPointerEnter,
  onPointerLeave,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onWheel,
  onTouchStart,
  onTouchMove,
  onTouchEnd,
  onTouchCancel,
}: Lightstick3DProps) {
  // Default: PET_W×PET_H × scale. Party arena: fill the oversized window.
  const s = Math.min(1.85, Math.max(0.65, scale));
  const boxW = stageSize?.w
    ? Math.max(1, Math.round(stageSize.w))
    : Math.round(190 * s);
  const boxH = stageSize?.h
    ? Math.max(1, Math.round(stageSize.h))
    : Math.round(280 * s);
  // Tight stick silhouette only — keep small so empty glass can click-through
  // Hit target stays pet-sized even in a large party window
  const hitW = Math.round(42 * s);
  const hitH = Math.round(150 * s);
  /** Cap retina DPR at 2.5 — was hard-locked to 1 (soft / low-res look) */
  const renderDpr = useMemo(() => {
    if (typeof window === "undefined") return 2;
    return Math.min(2.5, Math.max(2, window.devicePixelRatio || 2));
  }, []);
  /** Hot weather FX: strong warm specular on the stick (no CSS sun glare) */
  const sunHeat = !!weather && weatherIsHot(weather);
  /**
   * Soft exit for weather overlays so they don't leave a GPU afterimage
   * when the 8s moment ends (hard unmount was flashing residual pixels).
   */
  const [displayWeather, setDisplayWeather] =
    useState<WeatherSnapshot | null>(weather ?? null);
  const [weatherFxLeaving, setWeatherFxLeaving] = useState(false);
  useEffect(() => {
    if (weather) {
      setDisplayWeather(weather);
      setWeatherFxLeaving(false);
      return;
    }
    if (!displayWeather) return;
    setWeatherFxLeaving(true);
    const id = window.setTimeout(() => {
      setDisplayWeather(null);
      setWeatherFxLeaving(false);
    }, 320);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to weather on/off
  }, [weather]);

  /** Face-attached weather (shades/sweat/snow-cap) tracks 3D yaw while spinning */
  const weatherFaceLayerRef = useRef<HTMLDivElement>(null);
  const onFaceYaw = useCallback((yawRad: number) => {
    const el = weatherFaceLayerRef.current;
    if (!el) return;
    // Match model +Z face → screen; hide accessories when looking away
    const facingAmt = Math.cos(yawRad); // 1 = toward camera
    el.style.transform = `perspective(520px) rotateY(${yawRad}rad)`;
    // Don't fight the leave fade — only set opacity while fully active
    if (!el.dataset.leaving) {
      el.style.opacity = String(Math.max(0, Math.min(1, facingAmt * 1.15)));
    }
  }, []);
  const [fx, setFx] = useState<FloatFx[]>([]);
  const fxId = useRef(0);

  /** Mini star-cluster particles (CSS dots) — always behind the 3D pet */
  type StarDot = { dx: number; dy: number; s: number; bright: number };
  type StarCluster = {
    id: number;
    x: number; // px from pet center
    y: number;
    duration: number;
    dots: StarDot[];
  };
  const [clusters, setClusters] = useState<StarCluster[]>([]);
  const clusterId = useRef(0);
  const lastStarT = useRef(0);

  // Star-cluster motion trail — spawned BEHIND drag, never on the body
  useEffect(() => {
    if (!dragMotion.dragging || dragMotion.speed < 80) return;

    const now = performance.now();
    const interval = Math.max(36, 80 - dragMotion.speed * 0.035);
    if (now - lastStarT.current < interval) return;
    lastStarT.current = now;

    const sp = Math.max(dragMotion.speed, 1);
    const ux = -dragMotion.vx / sp; // unit vector behind motion
    const uy = -dragMotion.vy / sp;

    // Spawn near the body so trail feels like it comes from the stick
    const nClusters = dragMotion.speed > 450 ? 2 : 1;
    const batch: StarCluster[] = [];

    for (let c = 0; c < nClusters; c++) {
      // Close to entity: rim of the head/body, slightly behind drag
      // ~14–32px from center (was 52–90+)
      const dist = 14 + Math.random() * 18 + Math.min(10, dragMotion.speed * 0.012);
      const side = (Math.random() - 0.5) * 16; // tight scatter around body
      const px = ux * dist - uy * side;
      const py = uy * dist + ux * side;

      // Compact cluster (still reads as a group, not one big star on face)
      const nDots = 3 + Math.floor(Math.random() * 3);
      const dots: StarDot[] = Array.from({ length: nDots }, () => {
        const ang = Math.random() * Math.PI * 2;
        const r = 1 + Math.random() * 7;
        return {
          dx: Math.cos(ang) * r,
          dy: Math.sin(ang) * r,
          s: 1.1 + Math.random() * 2.0,
          bright: 0.55 + Math.random() * 0.45,
        };
      });
      // Core spark
      dots.push({
        dx: (Math.random() - 0.5) * 1.5,
        dy: (Math.random() - 0.5) * 1.5,
        s: 2.2 + Math.random() * 1.2,
        bright: 1,
      });

      batch.push({
        id: ++clusterId.current,
        x: px,
        y: py,
        duration: 0.4 + Math.random() * 0.28,
        dots,
      });
    }

    setClusters((prev) => [...prev, ...batch].slice(-18));
    const clear = window.setTimeout(() => {
      setClusters((prev) =>
        prev.filter((s) => !batch.some((b) => b.id === s.id))
      );
    }, 1000);
    return () => window.clearTimeout(clear);
  }, [dragMotion.vx, dragMotion.vy, dragMotion.speed, dragMotion.dragging]);

  /** Stage CSS party mode (aura / rings / stage scale) */
  const [partyStage, setPartyStage] = useState(false);

  // Spawn floating hearts / confetti emoji when cued
  useEffect(() => {
    if (motionQuiet) return;
    if (!animCue || animCue.kind === "none") return;
    const member = birthdayHeart;
    if (animCue.kind === "birthday") {
      setPartyStage(true);
      playBirthdayFanfare();
      // Light heart burst at normal size (~2.4s)
      const emojis = member
        ? [member, member, "🎂", "✨", "🐰", member, "🎉", "⭐"]
        : ["🎂", "✨", "🐰", "💗", "🎉", "⭐"];
      const batch: FloatFx[] = Array.from({ length: 12 }, (_, i) => ({
        id: ++fxId.current,
        emoji: emojis[i % emojis.length],
        left: 12 + Math.random() * 76,
        delay: i * 0.05,
        duration: 1.3 + Math.random() * 0.5,
      }));
      setFx((prev) => [...prev, ...batch]);
      const clear = window.setTimeout(() => {
        setFx((prev) => prev.filter((p) => !batch.some((b) => b.id === p.id)));
        setPartyStage(false);
      }, 2600);
      return () => {
        window.clearTimeout(clear);
        setPartyStage(false);
      };
    }
    if (animCue.kind === "hearts") {
      const batch: FloatFx[] = Array.from({ length: 6 }, (_, i) => ({
        id: ++fxId.current,
        emoji: i % 2 === 0 ? member || "💗" : "✨",
        left: 28 + Math.random() * 44,
        delay: i * 0.07,
        duration: 1.1 + Math.random() * 0.4,
      }));
      setFx((prev) => [...prev, ...batch]);
      const clear = window.setTimeout(() => {
        setFx((prev) => prev.filter((p) => !batch.some((b) => b.id === p.id)));
      }, 1800);
      return () => window.clearTimeout(clear);
    }
    if (animCue.kind === "confetti" || animCue.kind === "happy") {
      // confetti kind always; happy has 20% handled in 3D — still sprinkle lightly
      if (animCue.kind === "confetti" || Math.random() < 0.35) {
        const emojis = member
          ? [member, "✨", "🎂", "🐰", member, "⭐"]
          : ["✨", "⭐", "💫", "🐰", "💗"];
        const batch: FloatFx[] = Array.from({ length: 8 }, (_, i) => ({
          id: ++fxId.current,
          emoji: emojis[i % emojis.length],
          left: 18 + Math.random() * 64,
          delay: i * 0.05,
          duration: 1.0 + Math.random() * 0.5,
        }));
        setFx((prev) => [...prev, ...batch]);
        const clear = window.setTimeout(() => {
          setFx((prev) => prev.filter((p) => !batch.some((b) => b.id === p.id)));
        }, 1800);
        return () => window.clearTimeout(clear);
      }
    }
  }, [animCue?.n, animCue?.kind, birthdayHeart, motionQuiet]);

  // Weather / exclusive FX: kill party overlay + float emoji immediately
  useEffect(() => {
    if (!motionQuiet) return;
    setPartyStage(false);
    setFx([]);
  }, [motionQuiet]);

  return (
    <div
      className={`baa-lightstick-stage relative select-none pointer-events-none shrink-0${
        partyStage && !motionQuiet ? " baa-party-active" : ""
      }`}
      role="img"
      aria-label="NewJeans Lightstick"
      style={{
        width: boxW,
        height: boxH,
        minWidth: boxW,
        minHeight: boxH,
        maxWidth: boxW,
        maxHeight: boxH,
        /* layout/style only — "strict" paint-contain clipped weather FX */
        contain: "layout style",
        transform: "translateZ(0)",
        overflow: "visible",
      }}
    >
      {partyStage && (
        <>
          <div className="baa-party-aura" aria-hidden />
          <div className="baa-party-ring" aria-hidden />
          <div className="baa-party-ring delay-a" aria-hidden />
          <div className="baa-party-ring delay-b" aria-hidden />
          <div className="baa-party-ring delay-c" aria-hidden />
        </>
      )}
      {/* Star clusters BEHIND the lightstick (z under canvas) — never cover entity */}
      <div
        className="absolute inset-0 z-0 pointer-events-none overflow-visible"
        aria-hidden
      >
        {clusters.map((cl) => (
          <div
            key={cl.id}
            className="star-cluster-fade absolute left-1/2 top-[40%]"
            style={{
              // Offset from head center — close to entity, still under canvas
              transform: `translate(calc(-50% + ${cl.x}px), calc(-50% + ${cl.y}px))`,
              animationDuration: `${cl.duration}s`,
            }}
          >
            {cl.dots.map((d, i) => (
              <span
                key={i}
                className={i === cl.dots.length - 1 ? "star-spark" : "star-dot"}
                style={{
                  transform: `translate(${d.dx}px, ${d.dy}px)`,
                  width: d.s,
                  height: d.s,
                  opacity: d.bright,
                }}
              />
            ))}
          </div>
        ))}
      </div>

      <Canvas
        className="!absolute inset-0 z-[2]"
        style={{
          background: "transparent",
          pointerEvents: "none",
          width: boxW,
          height: boxH,
        }}
        resize={{ scroll: false, debounce: 0 }}
        gl={{
          alpha: true,
          antialias: true,
          premultipliedAlpha: false,
          preserveDrawingBuffer: false,
          powerPreference: "high-performance",
          failIfMajorPerformanceCaveat: false,
          // Multisample when the driver allows it (sharper edges)
          stencil: false,
          depth: true,
        }}
        // High-DPI Retina: 2–2.5× pixels (was forced to 1 = blurry stick)
        dpr={renderDpr}
        frameloop="always"
        camera={{ position: [0, 1.15, 4.35], fov: 30, near: 0.05, far: 50 }}
        onCreated={({ gl }) => {
          gl.setClearColor(0x000000, 0);
          // Let R3F manage size × dpr — do NOT force pixelRatio 1
          gl.outputColorSpace = THREE.SRGBColorSpace;
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.08;
        }}
      >
        {/*
          Lights stay near mid-height / front — not high above.
          High keys make vertical grip speculars look like “light pointing up”.
        */}
        <ambientLight
          intensity={
            isLightOff(lightColor) ? 0.92 : sunHeat ? 0.9 : 0.72
          }
          color={
            isLightOff(lightColor)
              ? "#e8eef5"
              : sunHeat
                ? "#fff6e8"
                : "#ffffff"
          }
        />
        {/* Key — more in front of the stick than above it */}
        <directionalLight
          position={
            isLightOff(lightColor)
              ? [2.0, 1.8, 4.0]
              : sunHeat
                ? [3.5, 3.0, 4.0]
                : [2.8, 1.6, 4.2]
          }
          intensity={
            isLightOff(lightColor) ? 1.0 : sunHeat ? 2.2 : 1.2
          }
          color={
            isLightOff(lightColor)
              ? "#f4f7fb"
              : sunHeat
                ? "#ffe2a8"
                : "#ffffff"
          }
        />
        {/* Side fill — mid height, cool, for grip embossing */}
        <directionalLight
          position={
            isLightOff(lightColor) ? [-3.0, 1.4, 2.5] : [-2.8, 1.2, 2.8]
          }
          intensity={
            isLightOff(lightColor) ? 0.55 : sunHeat ? 0.28 : 0.42
          }
          color={isLightOff(lightColor) ? "#c5d4e4" : "#e0e7ff"}
        />
        {sunHeat && !isLightOff(lightColor) && (
          <directionalLight
            position={[4.5, 3.5, 2.5]}
            intensity={1.2}
            color="#ffd27a"
          />
        )}
        {/* Soft fill at stick mid-height (not high above) */}
        <pointLight
          position={
            isLightOff(lightColor)
              ? [0.5, 0.6, 2.6]
              : sunHeat
                ? [0.8, 1.0, 2.4]
                : [0.4, 0.5, 2.8]
          }
          intensity={
            isLightOff(lightColor) ? 0.5 : sunHeat ? 1.1 : 0.7
          }
          color={
            isLightOff(lightColor)
              ? "#eef3f8"
              : sunHeat
                ? "#ffecc0"
                : "#ffffff"
          }
          distance={10}
        />

        <group scale={[facing, 1, 1]}>
          <Suspense fallback={null}>
            <ExactLightstick
              lifeState={lifeState}
              expression={expression}
              lightColor={lightColor}
              selfSpin={selfSpin && !freeLook?.active && !motionQuiet}
              selfSpinFast={selfSpinFast && !freeLook?.active && !motionQuiet}
              hovering={hovering && !freeLook?.active && !motionQuiet}
              chatOpen={chatOpen}
              loading={loading && !freeLook?.active}
              animCue={
                freeLook?.active || motionQuiet ? undefined : animCue
              }
              birthdayHold={!!birthdayHeart}
              motionQuiet={motionQuiet}
              pointerNorm={freeLook?.active ? null : pointerNorm}
              sunHeat={sunHeat}
              onFaceYaw={onFaceYaw}
              freeLook={motionQuiet ? null : freeLook}
            />
          </Suspense>
        </group>
      </Canvas>

      {/* Weather: sky FX fixed; face FX follows spin; soft fade-out avoids afterimage */}
      {displayWeather && (
        <WeatherFx
          key={`${displayWeather.kind}-${Math.round(displayWeather.tempC)}`}
          weather={displayWeather}
          label={weatherFxLeaving ? null : weatherFxLabel}
          faceLayerRef={weatherFaceLayerRef}
          leaving={weatherFxLeaving}
        />
      )}

      {/* Floating hearts / confetti (above pet, not motion trail) */}
      <div className="absolute inset-0 z-[6] pointer-events-none overflow-visible">
        {fx.map((p) => (
          <span
            key={p.id}
            className={`absolute ${
              partyStage
                ? "text-[20px] animate-float-up-party"
                : "text-[16px] animate-float-up"
            }`}
            style={{
              left: `${p.left}%`,
              bottom: "38%",
              animationDelay: `${p.delay}s`,
              animationDuration: `${p.duration}s`,
            }}
          >
            {p.emoji}
          </span>
        ))}
      </div>

      {/*
        Stick-only hit target (narrow + tall ≈ real lightstick).
        Canvas/window around it is pointer-events: none so empty space
        does not steal clicks / start drag / open menu.
      */}
      <div
        className="pet-hit absolute z-10 left-1/2 top-[50%] -translate-x-1/2 -translate-y-1/2 cursor-grab active:cursor-grabbing touch-none"
        style={{
          pointerEvents: "auto",
          background: "transparent",
          width: hitW,
          height: hitH,
          // Bunny head on top, thin shaft below
          borderRadius: `${Math.round(hitW * 0.48)}px ${Math.round(hitW * 0.48)}px ${Math.round(hitW * 0.22)}px ${Math.round(hitW * 0.22)}px`,
        }}
        onContextMenu={onContextMenu}
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel ?? onPointerUp}
        onWheel={onWheel}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchCancel ?? onTouchEnd}
        role="button"
        aria-label="BAA lightstick"
      />
    </div>
  );
}

function easeInOutCubic(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function easeOutBack(t: number) {
  const c = 1.70158;
  const t1 = t - 1;
  return 1 + c * t1 * t1 * t1 + t1 * t1;
}

const HOVER_SPIN_SPEED = 1.85;
const ORBIT_SPIN_SPEED = 2.7;
/** Seconds to ease from rest → full hover/orbit spin (and back down) */
const SPIN_RAMP_SEC = 0.45;

/** 6 lit colors in cycle order: white → green → purple → blue → orange → yellow */
const CYCLE_COLORS = CYCLE_COLOR_HEXES.map((hex) => new THREE.Color(hex));
/**
 * Off look from product capture (Screenshot 2026-07-20 / off-capture.png):
 * cool soft-white plastic, frosted head + soft-touch grip, glossy black eyes,
 * no LED emission. Embossed buttons/ring read via soft side light, not paint.
 */
const OFF_PLASTIC = "#E8ECF2";
const OFF_PLASTIC_SHADOW = "#B8C4D0";
const OFF_EYE = "#0A0A0A";
/** Seconds each color stays solid in Cycle mode (longer hold) */
const COLOR_HOLD_S = 2.6;
/** Short snap only at the end of each hold — not a long blend */
const COLOR_SNAP_S = 0.12;
/** Match real plastic diffuser brightness (photos are soft, not neon laser) */
const LED_EMIT_BOOST = 1.65;
const LED_GLOW_BOOST = 1.45;

/**
 * LED head when lit — frosted matte diffuser (glow from emissive).
 */
const MATTE_DIFFUSER = {
  roughness: 0.48,
  metalness: 0,
  envMapIntensity: 0.42,
  clearcoat: 0.14,
  clearcoatRoughness: 0.62,
  reflectivity: 0.24,
  sheen: 0.18,
  sheenRoughness: 0.68,
  sheenHex: "#f2eee8",
} as const;
/** LED head when off — soft frosted white like the capture */
const MATTE_DIFFUSER_OFF = {
  roughness: 0.78,
  metalness: 0,
  envMapIntensity: 0.28,
  clearcoat: 0.06,
  clearcoatRoughness: 0.82,
  reflectivity: 0.12,
  sheen: 0.28,
  sheenRoughness: 0.75,
  sheenHex: "#e8eef5",
} as const;
/** Grip / shell when off — soft-touch matte plastic (same capture) */
const MATTE_SHELL_OFF = {
  roughness: 0.74,
  metalness: 0,
  envMapIntensity: 0.3,
  clearcoat: 0.1,
  clearcoatRoughness: 0.72,
  reflectivity: 0.16,
  sheen: 0.22,
  sheenRoughness: 0.7,
  sheenHex: "#e8eef5",
} as const;

type MattePreset = {
  roughness: number;
  metalness: number;
  envMapIntensity: number;
  clearcoat: number;
  clearcoatRoughness: number;
  reflectivity?: number;
  sheen?: number;
  sheenRoughness?: number;
  sheenHex?: string;
};

/** Soft-touch / frosted plastic look */
function applySoftPlastic(
  mat: THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial,
  preset: MattePreset
) {
  mat.roughness = preset.roughness;
  mat.metalness = preset.metalness;
  mat.envMapIntensity = preset.envMapIntensity;
  if ("clearcoat" in mat) {
    const p = mat as THREE.MeshPhysicalMaterial;
    p.clearcoat = preset.clearcoat;
    p.clearcoatRoughness = preset.clearcoatRoughness;
    if (preset.reflectivity != null) p.reflectivity = preset.reflectivity;
    p.sheen = preset.sheen ?? 0;
    p.sheenRoughness = preset.sheenRoughness ?? 0.7;
    if (preset.sheenHex) p.sheenColor?.set(preset.sheenHex);
  }
}

/** Tiny lift only — photos already define the hue. */
function enrichColor(c: THREE.Color, satBoost = 0.05, lightBoost = 0.02) {
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  hsl.s = Math.min(1, hsl.s + satBoost * (1 - hsl.s));
  hsl.l = Math.min(0.72, hsl.l + lightBoost);
  c.setHSL(hsl.h, hsl.s, hsl.l);
  return c;
}

/** Night dimmer / day brighter from local hour */
function weatherPulseMult(now = new Date()) {
  const h = now.getHours() + now.getMinutes() / 60;
  // Night 22–6: dimmer; day 10–16: brighter; smooth shoulders
  if (h >= 22 || h < 6) return 0.72;
  if (h >= 10 && h < 16) return 1.12;
  if (h >= 6 && h < 10) return 0.72 + ((h - 6) / 4) * 0.4;
  if (h >= 16 && h < 22) return 1.12 - ((h - 16) / 6) * 0.4;
  return 1;
}

function ExactLightstick({
  lifeState: _lifeState,
  expression,
  lightColor = "cycle",
  selfSpin = false,
  selfSpinFast = false,
  hovering = false,
  chatOpen = false,
  loading = false,
  animCue,
  birthdayHold = false,
  motionQuiet = false,
  pointerNorm = null,
  sunHeat = false,
  onFaceYaw,
  freeLook = null,
}: {
  lifeState: PetLifeState;
  expression: PetExpression;
  lightColor?: LightColorMode;
  selfSpin?: boolean;
  selfSpinFast?: boolean;
  hovering?: boolean;
  chatOpen?: boolean;
  loading?: boolean;
  animCue?: AnimCue;
  /** Member birthday: keep LED on locked color (no rainbow party override) */
  birthdayHold?: boolean;
  /** Weather owns stage — no party / spin / confetti / idle notice */
  motionQuiet?: boolean;
  pointerNorm?: { x: number; y: number } | null;
  /** Strong warm specular — hot weather FX without CSS sun glare */
  sunHeat?: boolean;
  /** Live face yaw (rad) so weather face FX can spin with the model */
  onFaceYaw?: (yawRad: number) => void;
  freeLook?: { active: boolean; yaw: number; pitch: number } | null;
}) {
  void _lifeState;
  const onFaceYawRef = useRef(onFaceYaw);
  onFaceYawRef.current = onFaceYaw;
  const freeLookRef = useRef(freeLook);
  freeLookRef.current = freeLook;
  const root = useRef<THREE.Group>(null);
  const modelGroup = useRef<THREE.Group>(null);
  const glowLight = useRef<THREE.PointLight>(null);
  const sparkLight = useRef<THREE.PointLight>(null);
  /** Weak rear fill only — handle back should stay quiet */
  const backFillLight = useRef<THREE.PointLight>(null);
  /** Front mid-grip bounce — tinted by current LED color */
  const gripColorLight = useRef<THREE.PointLight>(null);
  const framed = useRef(false);
  const lastSize = useRef({ w: 0, h: 0 });
  const lastCueN = useRef(0);
  /** Rest camera after framing — party motion pulls back so giant scale fits */
  const baseCam = useRef({ x: 0, y: 0, z: 4.35 });
  const { camera, size } = useThree();
  const { scene } = useGLTF(MODEL_URL);

  const spin = useRef({
    active: false,
    progress: 0,
    duration: 2.6,
    baseY: 0,
    nextAt: 4 + Math.random() * 4,
    jingled: false,
  });

  /** Continuous hover/orbit yaw speed — ramped so start/stop aren't abrupt */
  const hoverSpin = useRef({
    speed: 0,
    /** 0..1 blend toward target (selfSpin on) or toward 0 (off) */
    blend: 0,
    /** Last peak rad/s while spinning (used for smooth ramp-down) */
    peak: ORBIT_SPIN_SPEED,
  });

  const idle = useRef({
    nextBlinkAt: 2 + Math.random() * 3,
    blinkUntil: 0,
    doublePending: false,
    nextNoticeAt: 14 + Math.random() * 8,
    noticeUntil: 0,
    lastInteractT: performance.now() / 1000,
    nextConfettiAt: 40 + Math.random() * 50,
  });

  /** One-shot timed anims (seconds absolute) */
  const anim = useRef({
    tapUntil: 0,
    tapT0: 0,
    colorUntil: 0,
    colorT0: 0,
    nodUntil: 0,
    nodT0: 0,
    happyUntil: 0,
    happyT0: 0,
    wakeUntil: 0,
    wakeT0: 0,
    confettiUntil: 0,
    confettiT0: 0,
    /** Member birthday party motion (spin + leap) */
    birthdayUntil: 0,
    birthdayT0: 0,
  });

  const colorScratch = useRef({
    a: new THREE.Color(),
    b: new THREE.Color(),
    out: new THREE.Color(),
    soft: new THREE.Color(),
  });

  const look = useRef({ x: 0, z: 0 });
  const weather = useRef(weatherPulseMult());

  // Refresh weather mult occasionally
  useEffect(() => {
    const id = window.setInterval(() => {
      weather.current = weatherPulseMult();
    }, 60_000);
    return () => window.clearInterval(id);
  }, []);

  // Weather exclusive: clear any in-flight one-shot motion immediately
  useEffect(() => {
    if (!motionQuiet) return;
    const a = anim.current;
    a.tapUntil = 0;
    a.colorUntil = 0;
    a.nodUntil = 0;
    a.happyUntil = 0;
    a.wakeUntil = 0;
    a.confettiUntil = 0;
    a.birthdayUntil = 0;
    spin.current.active = false;
    spin.current.progress = 0;
    idle.current.noticeUntil = 0;
  }, [motionQuiet]);

  // Arm one-shot cues
  useEffect(() => {
    if (motionQuiet) return;
    if (!animCue || animCue.n === lastCueN.current) return;
    lastCueN.current = animCue.n;
    const t = performance.now() / 1000;
    const a = anim.current;
    // Never stack: cancel previous one-shots before arming a new one
    a.tapUntil = 0;
    a.colorUntil = 0;
    a.nodUntil = 0;
    a.happyUntil = 0;
    a.wakeUntil = 0;
    a.confettiUntil = 0;
    a.birthdayUntil = 0;
    switch (animCue.kind) {
      case "tap":
        a.tapT0 = t;
        a.tapUntil = t + 0.42;
        break;
      case "color":
        // Quick celebration cycle when a job finishes
        // Birthday: keep member color (happy bob only)
        if (birthdayHold) {
          a.happyT0 = t;
          a.happyUntil = t + 0.9;
        } else {
          a.colorT0 = t;
          a.colorUntil = t + 0.85;
        }
        break;
      case "chatOpen":
        a.nodT0 = t;
        a.nodUntil = t + 0.7;
        break;
      case "happy":
        a.happyT0 = t;
        a.happyUntil = t + 0.85;
        break;
      case "wake":
        a.wakeT0 = t;
        a.wakeUntil = t + 1.4;
        break;
      case "confetti":
        // On birthday, skip rainbow LED — use happy bob instead
        if (birthdayHold) {
          a.happyT0 = t;
          a.happyUntil = t + 1.1;
        } else {
          a.confettiT0 = t;
          a.confettiUntil = t + 0.9;
        }
        break;
      case "birthday":
        // Normal-size party (~2.4s): spin + hop + wiggle, no giant zoom
        a.birthdayT0 = t;
        a.birthdayUntil = t + 2.4;
        a.happyUntil = 0;
        a.wakeUntil = 0;
        a.confettiUntil = 0;
        a.colorUntil = 0;
        a.tapUntil = 0;
        spin.current.active = false;
        spin.current.progress = 0;
        spin.current.nextAt = t + 10;
        break;
      case "hearts":
        // 3D also gets a soft happy pulse
        a.happyT0 = t;
        a.happyUntil = t + 0.6;
        break;
      default:
        break;
    }
  }, [animCue?.n, animCue?.kind, birthdayHold, motionQuiet]);

  // Wake once on mount (skip if weather already quieting the stick)
  useEffect(() => {
    if (motionQuiet) return;
    const t = performance.now() / 1000;
    anim.current.wakeT0 = t;
    anim.current.wakeUntil = t + 1.4;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only wake
  }, []);

  const model = useMemo(() => {
    const clone = scene.clone(true);

    clone.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      // Smoother shading on the shell
      if (mesh.geometry) {
        mesh.geometry.computeVertexNormals();
      }
      mesh.frustumCulled = true;

      const applyMat = (mat: THREE.Material) => {
        mat.transparent = false;
        mat.opacity = 1;
        mat.depthWrite = true;
        mat.side = THREE.FrontSide; // fewer edge artifacts than DoubleSide

        const name = (mat.name || "").toLowerCase();
        if (
          mat instanceof THREE.MeshStandardMaterial ||
          mat instanceof THREE.MeshPhysicalMaterial
        ) {
          mat.flatShading = false;
          mat.envMapIntensity = 1.1;
          if (name.includes("light")) {
            // LED head only — soft-touch matte diffuser
            mat.color.copy(CYCLE_COLORS[0]).multiplyScalar(0.5);
            mat.emissive = new THREE.Color(CYCLE_COLORS[0]);
            mat.emissiveIntensity = 2.1;
            mat.toneMapped = false;
            applySoftPlastic(mat, MATTE_DIFFUSER);
          } else if (name.includes("eye")) {
            mat.color.set(OFF_EYE);
            mat.emissive = new THREE.Color("#000000");
            mat.emissiveIntensity = 0;
            mat.roughness = 0.12;
            mat.metalness = 0.65;
          } else {
            // Stick / handle — cool soft-white (off baseline); lit path may polish again
            mat.color.set(OFF_PLASTIC);
            mat.emissive = new THREE.Color("#000000");
            mat.emissiveIntensity = 0;
            applySoftPlastic(mat, MATTE_SHELL_OFF);
          }
          mat.needsUpdate = true;
        }
      };

      if (Array.isArray(mesh.material)) {
        mesh.material.forEach(applyMat);
      } else if (mesh.material) {
        applyMat(mesh.material);
      }
    });

    const box = new THREE.Box3().setFromObject(clone);
    const sizeVec = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(sizeVec.x, sizeVec.y, sizeVec.z) || 1;
    // Slightly larger fill in the canvas for more visible mesh detail
    clone.scale.setScalar(2.55 / maxDim);

    const box2 = new THREE.Box3().setFromObject(clone);
    const center = box2.getCenter(new THREE.Vector3());
    clone.position.x -= center.x;
    clone.position.y -= center.y;
    clone.position.z -= center.z;

    // Eyes mesh is on +Z in the GLTF; camera sits on +Z looking at origin,
    // so leave rotation at 0 — face the user (do NOT flip 180°).
    clone.rotation.y = 0;

    return clone;
  }, [scene]);

  const lightMats = useMemo(() => {
    const mats: THREE.MeshStandardMaterial[] = [];
    model.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      list.forEach((m) => {
        if (
          m &&
          (m.name || "").toLowerCase().includes("light") &&
          (m instanceof THREE.MeshStandardMaterial ||
            m instanceof THREE.MeshPhysicalMaterial)
        ) {
          mats.push(m);
        }
      });
    });
    return mats;
  }, [model]);

  /** Body shell materials — for sun specular when hot */
  const bodyMats = useMemo(() => {
    const mats: THREE.MeshStandardMaterial[] = [];
    model.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      const list = Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material];
      list.forEach((m) => {
        if (
          !m ||
          !(
            m instanceof THREE.MeshStandardMaterial ||
            m instanceof THREE.MeshPhysicalMaterial
          )
        ) {
          return;
        }
        const name = (m.name || "").toLowerCase();
        if (name.includes("light") || name.includes("eye")) return;
        if (m.userData.baseRoughness == null) {
          m.userData.baseRoughness = m.roughness;
          m.userData.baseMetalness = m.metalness;
          m.userData.baseColor = m.color.clone();
          if ("clearcoat" in m) {
            const pm = m as THREE.MeshPhysicalMaterial;
            m.userData.baseClearcoat = pm.clearcoat;
            m.userData.baseClearcoatRoughness = pm.clearcoatRoughness;
          }
        }
        mats.push(m);
      });
    });
    return mats;
  }, [model]);

  /** Eyes: store pivot data so blink scales around center (no drop) */
  const eyeMeshes = useMemo(() => {
    const eyes: THREE.Mesh[] = [];
    model.updateMatrixWorld(true);
    model.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const isEye = list.some(
        (m) => m && (m.name || "").toLowerCase().includes("eye")
      );
      if (!isEye) return;

      eyes.push(mesh);
      mesh.userData.baseScale = mesh.scale.clone();
      mesh.userData.basePos = mesh.position.clone();

      // Geometry center in mesh local space — blink pivots here
      if (mesh.geometry) {
        mesh.geometry.computeBoundingBox();
        const bb = mesh.geometry.boundingBox;
        if (bb && !bb.isEmpty()) {
          mesh.userData.geoCenter = bb.getCenter(new THREE.Vector3());
        } else {
          mesh.userData.geoCenter = new THREE.Vector3(0, 0, 0);
        }
      } else {
        mesh.userData.geoCenter = new THREE.Vector3(0, 0, 0);
      }
    });
    return eyes;
  }, [model]);

  useFrame((state, delta) => {
    void state;
    const g = root.current;
    const mg = modelGroup.current;
    if (!g) return;

    // Don't frame with a 0-sized canvas (would hide the model forever)
    if (size.width < 2 || size.height < 2) return;

    const resized =
      lastSize.current.w !== size.width || lastSize.current.h !== size.height;
    if (resized) {
      lastSize.current = { w: size.width, h: size.height };
      // Aspect-only update when already framed — full reframe caused a 1-frame
      // flash (reset rotation → afterimage) every chat open/close resize.
      if (framed.current) {
        const cam = camera as THREE.PerspectiveCamera;
        cam.aspect = size.width / Math.max(size.height, 1);
        cam.updateProjectionMatrix();
      }
    }
    if (!framed.current) {
      lastSize.current = { w: size.width, h: size.height };
      const prev = {
        x: g.rotation.x,
        y: g.rotation.y,
        z: g.rotation.z,
        py: g.position.y,
        sx: g.scale.x,
        sy: g.scale.y,
        sz: g.scale.z,
      };
      g.rotation.set(0, 0, 0);
      g.position.set(0, 0, 0);
      g.scale.set(1, 1, 1);
      g.updateWorldMatrix(true, true);

      const box = new THREE.Box3().setFromObject(g);
      if (!box.isEmpty()) {
        const center = box.getCenter(new THREE.Vector3());
        const sphere = box.getBoundingSphere(new THREE.Sphere());
        const fov = (camera as THREE.PerspectiveCamera).fov;
        const dist =
          (sphere.radius * 1.65) /
          Math.tan(THREE.MathUtils.degToRad(fov / 2));
        const z = center.z + Math.max(dist, 3.4);
        camera.position.set(center.x, center.y, z);
        camera.lookAt(center);
        camera.updateProjectionMatrix();
        baseCam.current = { x: center.x, y: center.y, z };
        framed.current = true;
      }
      g.rotation.x = prev.x;
      g.rotation.y = prev.y;
      g.rotation.z = prev.z;
      g.position.y = prev.py;
      g.scale.set(prev.sx, prev.sy, prev.sz);
    }

    const t = performance.now() / 1000;
    const sp = spin.current;
    const idl = idle.current;
    const a = anim.current;
    const fl = freeLookRef.current;
    const inspecting = !!fl?.active;

    // —— Free-look inspect: hold user yaw/pitch, freeze all motion/anime ——
    if (inspecting && fl) {
      sp.active = false;
      sp.progress = 0;
      sp.jingled = false;
      sp.nextAt = t + 10;
      idl.blinkUntil = 0;
      idl.doublePending = false;
      idl.noticeUntil = 0;
      idl.nextNoticeAt = t + 20;
      a.tapUntil = 0;
      a.colorUntil = 0;
      a.nodUntil = 0;
      a.happyUntil = 0;
      a.wakeUntil = 0;
      a.confettiUntil = 0;

      g.rotation.y = fl.yaw;
      g.rotation.x = fl.pitch;
      g.rotation.z = 0;
      g.position.y = 0;
      g.scale.set(1, 1, 1);
      look.current.x = 0;
      look.current.z = 0;
      onFaceYawRef.current?.(g.rotation.y);

      // Still update LED materials (no motion), then exit early
      const cs = colorScratch.current;
      const lightOff = isLightOff(lightColor);
      if (lightOff) {
        cs.out.set("#ffffff");
        cs.soft.set("#f4f6f8");
      } else {
        const fixedHex = hexForMode(lightColor);
        if (fixedHex) cs.out.set(fixedHex);
        else cs.out.copy(CYCLE_COLORS[0]);
        enrichColor(cs.out, 0.28, 0.03);
        cs.soft.copy(cs.out).lerp(cs.a.set("#ffffff"), 0.06);
      }
      lightMats.forEach((m) => {
        if (lightOff) {
          m.color.set(OFF_PLASTIC);
          m.emissive.set("#000000");
          m.emissiveIntensity = 0;
          m.toneMapped = true;
          applySoftPlastic(m, MATTE_DIFFUSER_OFF);
        } else {
          m.color.copy(cs.out).multiplyScalar(0.55);
          m.emissive.copy(cs.out);
          m.emissiveIntensity = 1.05 * LED_EMIT_BOOST;
          applySoftPlastic(m, MATTE_DIFFUSER);
        }
      });
      bodyMats.forEach((m) => {
        if (lightOff) {
          m.color.set(OFF_PLASTIC);
          m.emissive.set("#000000");
          m.emissiveIntensity = 0;
          applySoftPlastic(m, MATTE_SHELL_OFF);
        }
      });
      if (glowLight.current) {
        glowLight.current.intensity = 0;
        glowLight.current.visible = false;
      }
      if (sparkLight.current) {
        sparkLight.current.intensity = 0;
        sparkLight.current.visible = false;
      }
      if (backFillLight.current) {
        // Very soft rear only when off (embossing); dim when lit
        backFillLight.current.visible = true;
        backFillLight.current.intensity = lightOff ? 0.12 : 0.06;
        backFillLight.current.color.set(
          lightOff ? OFF_PLASTIC_SHADOW : "#ffffff"
        );
      }
      if (gripColorLight.current) {
        if (lightOff) {
          gripColorLight.current.intensity = 0;
          gripColorLight.current.visible = false;
        } else {
          gripColorLight.current.visible = true;
          gripColorLight.current.color.copy(cs.out);
          gripColorLight.current.intensity = 0.45;
        }
      }
      if (mg) mg.scale.set(1, 1, 1);
      return;
    }

    if (
      selfSpin ||
      hovering ||
      expression === "click" ||
      expression === "thinking" ||
      loading ||
      chatOpen
    ) {
      idl.lastInteractT = t;
      idl.nextNoticeAt = t + 12 + Math.random() * 10;
    }

    // —— Double-blink ——
    if (t >= idl.nextBlinkAt && t > idl.blinkUntil && !idl.doublePending) {
      idl.blinkUntil = t + 0.11;
      // ~40% chance of double blink
      if (Math.random() < 0.4) {
        idl.doublePending = true;
        idl.nextBlinkAt = t + 0.2;
      } else {
        idl.nextBlinkAt = t + 2.5 + Math.random() * 4.5;
      }
    } else if (idl.doublePending && t >= idl.nextBlinkAt && t > idl.blinkUntil) {
      idl.blinkUntil = t + 0.1;
      idl.doublePending = false;
      idl.nextBlinkAt = t + 2.8 + Math.random() * 4.5;
    }
    // Blink: squeeze scale.y around eye center so pupils don't drop
    const blinking = t < idl.blinkUntil;
    const blinkAmt = blinking ? 0.18 : 1; // keep a thin line, not zero
    eyeMeshes.forEach((mesh) => {
      const baseScale = mesh.userData.baseScale as THREE.Vector3;
      const basePos = mesh.userData.basePos as THREE.Vector3;
      const geoCenter = mesh.userData.geoCenter as THREE.Vector3;
      if (!baseScale || !basePos || !geoCenter) return;

      const targetSy = baseScale.y * blinkAmt;
      // Slight horizontal widen when closed (lid squish)
      const targetSx = baseScale.x * (blinking ? 1.06 : 1);
      const targetSz = baseScale.z * (blinking ? 1.06 : 1);

      mesh.scale.x = THREE.MathUtils.lerp(mesh.scale.x, targetSx, 0.55);
      mesh.scale.y = THREE.MathUtils.lerp(mesh.scale.y, targetSy, 0.55);
      mesh.scale.z = THREE.MathUtils.lerp(mesh.scale.z, targetSz, 0.55);

      // Keep geometry center fixed: P' = P + C ⊙ (S0 - S)
      const sx = mesh.scale.x;
      const sy = mesh.scale.y;
      const sz = mesh.scale.z;
      mesh.position.set(
        basePos.x + geoCenter.x * (baseScale.x - sx),
        basePos.y + geoCenter.y * (baseScale.y - sy),
        basePos.z + geoCenter.z * (baseScale.z - sz)
      );
    });

    // —— Idle notice ——
    if (
      !motionQuiet &&
      t >= idl.nextNoticeAt &&
      t > idl.noticeUntil &&
      !selfSpin &&
      !sp.active &&
      !loading &&
      expression !== "thinking" &&
      !(t < a.birthdayUntil) &&
      !(t < a.confettiUntil) &&
      !(t < a.happyUntil) &&
      !(t < a.colorUntil)
    ) {
      idl.noticeUntil = t + 1.1;
      idl.nextNoticeAt = t + 16 + Math.random() * 14;
      playNotice();
    }
    const noticing = !motionQuiet && t < idl.noticeUntil;

    // —— Rare confetti pulse (time-based) — never during weather / other motion ——
    if (
      !motionQuiet &&
      t >= idl.nextConfettiAt &&
      t > a.confettiUntil &&
      t > a.birthdayUntil &&
      t > a.happyUntil &&
      t > a.colorUntil &&
      !loading &&
      !selfSpin
    ) {
      if (birthdayHold) {
        // Birthday day: soft bounce only — LED stays member color
        a.happyT0 = t;
        a.happyUntil = t + 1.0;
      } else {
        a.confettiT0 = t;
        a.confettiUntil = t + 0.9;
      }
      idl.nextConfettiAt = t + 45 + Math.random() * 55;
    }

    // —— Birthday party motion owns yaw while active ——
    const celebrating =
      !motionQuiet && t < a.birthdayUntil && a.birthdayUntil > 0;

    // —— Hover / showcase spin ——
    // Rest pose: rotation.y = 0 so eyes (+Z on model) face the camera (+Z).
    // Continuous hover/orbit spin eases in/out so stationary → motion feels silky.
    const hs = hoverSpin.current;
    if (celebrating || motionQuiet) {
      // Party choreography drives yaw (see compose below)
      hs.speed = 0;
      hs.blend = 0;
      sp.active = false;
    } else {
      if (selfSpin) {
        hs.peak = selfSpinFast ? ORBIT_SPIN_SPEED : HOVER_SPIN_SPEED;
      }
      const blendStep = delta / SPIN_RAMP_SEC;
      if (selfSpin) {
        hs.blend = Math.min(1, hs.blend + blendStep);
      } else {
        hs.blend = Math.max(0, hs.blend - blendStep);
      }
      // Ease-in-out: slow start, hold, slow stop
      const b = hs.blend;
      const ramp = b < 0.5 ? 4 * b * b * b : 1 - Math.pow(-2 * b + 2, 3) / 2;
      hs.speed = hs.peak * ramp;

      if (selfSpin || hs.blend > 0.001) {
        if (sp.active) {
          sp.active = false;
          sp.progress = 0;
          sp.jingled = false;
          sp.nextAt = t + 8 + Math.random() * 6;
        }
        g.rotation.y += hs.speed * delta;
        if (g.rotation.y > Math.PI * 4 || g.rotation.y < -Math.PI * 4) {
          g.rotation.y = g.rotation.y % (Math.PI * 2);
        }
        // Near end of ramp-down: gently face the camera again
        if (!selfSpin && hs.blend < 0.25) {
          let yaw = g.rotation.y % (Math.PI * 2);
          if (yaw > Math.PI) yaw -= Math.PI * 2;
          if (yaw < -Math.PI) yaw += Math.PI * 2;
          const settle = 1 - hs.blend / 0.25;
          g.rotation.y = THREE.MathUtils.lerp(yaw, 0, 0.08 + settle * 0.2);
        }
      } else {
        hs.speed = 0;
        hs.blend = 0;
        const canSpin =
          !motionQuiet &&
          expression !== "thinking" &&
          expression !== "click" &&
          !loading &&
          t > a.birthdayUntil &&
          t > a.confettiUntil &&
          t > a.happyUntil;

        if (!sp.active && canSpin && t >= sp.nextAt) {
          sp.active = true;
          sp.progress = 0;
          sp.duration = 2.4 + Math.random() * 0.8;
          // Always start a full spin from facing the user
          sp.baseY = 0;
          g.rotation.y = 0;
          sp.jingled = false;
        }

        if (sp.active) {
          if (!sp.jingled) {
            sp.jingled = true;
            playSpinJingle();
          }
          sp.progress += delta / sp.duration;
          if (sp.progress >= 1) {
            g.rotation.y = 0; // face user when spin ends
            sp.active = false;
            sp.progress = 0;
            sp.jingled = false;
            sp.nextAt = t + 7 + Math.random() * 9;
          } else {
            g.rotation.y = sp.baseY + easeInOutCubic(sp.progress) * Math.PI * 2;
          }
        } else {
          // Ease back to facing the camera if we stopped mid-turn
          let yaw = g.rotation.y % (Math.PI * 2);
          if (yaw > Math.PI) yaw -= Math.PI * 2;
          if (yaw < -Math.PI) yaw += Math.PI * 2;
          g.rotation.y = THREE.MathUtils.lerp(yaw, 0, 0.12);
        }
      }
    }

    // —— Look-at cursor (subtle) ——
    const targetLookX = pointerNorm
      ? THREE.MathUtils.clamp(-pointerNorm.y * 0.12, -0.12, 0.12)
      : 0;
    const targetLookZ = pointerNorm
      ? THREE.MathUtils.clamp(pointerNorm.x * 0.14, -0.14, 0.14)
      : 0;
    look.current.x = THREE.MathUtils.lerp(look.current.x, targetLookX, 0.08);
    look.current.z = THREE.MathUtils.lerp(look.current.z, targetLookZ, 0.08);

    // —— Compose one-shot anim contributions ——
    let scaleX = 1;
    let scaleY = 1;
    let scaleZ = 1;
    let posY = 0;
    let bob = 0;
    let rotX = look.current.x;
    let rotZ = look.current.z;
    let pulseBoost = 0;
    /** When set, overrides g.rotation.y this frame (celebration spin) */
    let partyYaw: number | null = null;

    // ── Normal-size birthday party (~2.4s) ──
    // Stay ~1× size: crouch → hop + full spin → soft wiggle settle.
    // LED stays member color (locked elsewhere).
    if (celebrating) {
      const u = Math.min(
        1,
        (t - a.birthdayT0) / Math.max(0.001, a.birthdayUntil - a.birthdayT0)
      );

      if (u < 0.14) {
        // Anticipation crouch (tiny squash only)
        const s = easeInOutCubic(u / 0.14);
        scaleY = 1 - 0.1 * s;
        scaleX = 1 + 0.06 * s;
        scaleZ = 1 + 0.06 * s;
        posY = -0.03 * s;
        pulseBoost += 0.25 * s;
      } else if (u < 0.55) {
        // Hop + one clean full spin at normal size
        const s = (u - 0.14) / 0.41;
        const e = easeInOutCubic(s);
        partyYaw = e * Math.PI * 2;
        posY = 0.1 * Math.sin(s * Math.PI);
        const sc = 1 + 0.06 * Math.sin(s * Math.PI);
        scaleX = sc;
        scaleY = 1 + 0.08 * Math.sin(s * Math.PI);
        scaleZ = sc;
        rotZ += Math.sin(s * Math.PI * 2) * 0.08 * (1 - s);
        pulseBoost += 0.55 * Math.sin(s * Math.PI);
      } else if (u < 0.78) {
        // Soft land + happy side wiggle
        const s = (u - 0.55) / 0.23;
        partyYaw = 0;
        if (s < 0.35) {
          const k = s / 0.35;
          scaleY = 1 - 0.06 * k;
          scaleX = 1 + 0.04 * k;
          scaleZ = scaleX;
          posY = -0.015 * k;
        } else {
          const k = (s - 0.35) / 0.65;
          const hop = Math.sin(k * Math.PI);
          posY = 0.045 * hop;
          scaleY = 1 + 0.04 * hop;
          rotZ += Math.sin(k * Math.PI * 3) * 0.12 * (1 - k);
        }
        pulseBoost += 0.35 * (1 - s);
      } else {
        // Settle to rest
        const s = (u - 0.78) / 0.22;
        const fade = 1 - s;
        partyYaw = 0;
        scaleX = 1;
        scaleY = 1;
        scaleZ = 1;
        posY = 0.015 * Math.sin(s * Math.PI * 2) * fade;
        rotZ += Math.sin(s * Math.PI * 5) * 0.08 * fade;
        pulseBoost += 0.2 * fade;
      }
    }

    // Tap bounce: squash then spring up
    if (!motionQuiet && t < a.tapUntil) {
      const u = (t - a.tapT0) / (a.tapUntil - a.tapT0);
      if (u < 0.28) {
        const s = u / 0.28;
        scaleY = 1 - 0.14 * s;
        scaleX = 1 + 0.08 * s;
        scaleZ = 1 + 0.08 * s;
        posY = -0.02 * s;
      } else {
        const s = easeOutBack((u - 0.28) / 0.72);
        scaleY = 0.86 + 0.14 * Math.min(1, s * 1.05);
        scaleX = 1.08 - 0.08 * Math.min(1, s);
        scaleZ = scaleX;
        posY = 0.06 * Math.sin(Math.min(1, s) * Math.PI);
      }
    }

    // Job-done color cycle: bloom + scale pulse (skip during party / weather)
    const colorCycling = !motionQuiet && !celebrating && t < a.colorUntil;
    if (colorCycling) {
      const u = (t - a.colorT0) / (a.colorUntil - a.colorT0);
      const wave = Math.sin(u * Math.PI);
      pulseBoost += 0.65 * wave;
      const sc = 1 + 0.07 * wave;
      scaleX *= sc;
      scaleY *= sc;
      scaleZ *= sc;
    }

    // Chat open nod
    if (!motionQuiet && !celebrating && t < a.nodUntil) {
      const u = (t - a.nodT0) / (a.nodUntil - a.nodT0);
      rotX += -0.18 * Math.sin(u * Math.PI);
    }

    // Happy wiggle
    if (!motionQuiet && !celebrating && t < a.happyUntil) {
      const u = (t - a.happyT0) / (a.happyUntil - a.happyT0);
      rotZ += Math.sin(u * Math.PI * 5) * 0.12 * (1 - u);
      pulseBoost += 0.25 * (1 - u);
    }

    // Wake stretch: lean back then upright
    if (!motionQuiet && !celebrating && t < a.wakeUntil) {
      const u = (t - a.wakeT0) / (a.wakeUntil - a.wakeT0);
      if (u < 0.45) {
        rotX += -0.22 * easeInOutCubic(u / 0.45);
        scaleY *= 1 + 0.04 * (u / 0.45);
      } else {
        const v = (u - 0.45) / 0.55;
        rotX += -0.22 * (1 - easeInOutCubic(v));
        scaleY *= 1.04 - 0.04 * easeInOutCubic(v);
      }
    }

    // Confetti rainbow burst (skipped during birthday / weather)
    const confettiing = !motionQuiet && !celebrating && t < a.confettiUntil;
    if (confettiing) {
      const u = (t - a.confettiT0) / (a.confettiUntil - a.confettiT0);
      pulseBoost += 0.7 * Math.sin(u * Math.PI);
      const sc = 1 + 0.08 * Math.sin(u * Math.PI);
      scaleX *= sc;
      scaleY *= sc;
      scaleZ *= sc;
    }

    // Notice wiggle
    if (noticing) {
      rotZ += Math.sin((idl.noticeUntil - t) * 10) * 0.08;
      pulseBoost += 0.3;
    }

    // Idle / typing / hover bob
    const isThinking = loading || expression === "thinking";
    if (selfSpin || sp.active) {
      bob = Math.sin(t * 2.2) * 0.01;
      posY += 0.04;
    } else if (isThinking) {
      // Soft bob only — no frantic pulse (that made colors look like a strobe)
      bob = Math.sin(t * 2.2) * 0.01;
      posY += 0.02;
    } else if (hovering) {
      bob = Math.sin(t * 1.6) * 0.01;
      posY += 0.02;
    } else {
      bob = Math.sin(t * 0.9) * 0.008;
    }

    // Party stays near 1× — mild snappiness, soft settle
    const partyU = celebrating
      ? Math.min(
          1,
          (t - a.birthdayT0) / Math.max(0.001, a.birthdayUntil - a.birthdayT0)
        )
      : 0;
    const partySettle = celebrating && partyU >= 0.78;
    const scLerp = celebrating ? (partySettle ? 0.2 : 0.38) : 0.28;
    const rotLerp = celebrating ? (partySettle ? 0.14 : 0.28) : 0.12;
    const posLerp = celebrating ? (partySettle ? 0.16 : 0.32) : 0.14;
    g.scale.x = THREE.MathUtils.lerp(g.scale.x, scaleX, scLerp);
    g.scale.y = THREE.MathUtils.lerp(g.scale.y, scaleY, scLerp);
    g.scale.z = THREE.MathUtils.lerp(g.scale.z, scaleZ, scLerp);
    g.rotation.x = THREE.MathUtils.lerp(g.rotation.x, rotX, rotLerp);
    g.rotation.z = THREE.MathUtils.lerp(
      g.rotation.z,
      rotZ,
      celebrating ? (partySettle ? 0.16 : 0.32) : 0.14
    );
    g.position.y = THREE.MathUtils.lerp(g.position.y, posY + bob, posLerp);
    g.position.x = THREE.MathUtils.lerp(g.position.x, 0, celebrating ? 0.2 : 0.15);
    if (partyYaw != null) {
      if (partySettle) {
        let yaw = g.rotation.y % (Math.PI * 2);
        if (yaw > Math.PI) yaw -= Math.PI * 2;
        if (yaw < -Math.PI) yaw += Math.PI * 2;
        g.rotation.y = THREE.MathUtils.lerp(yaw, 0, 0.16);
      } else {
        g.rotation.y = partyYaw;
      }
    }

    // Keep camera at rest framing (no giant pull-back)
    {
      const bc = baseCam.current;
      camera.position.z = THREE.MathUtils.lerp(camera.position.z, bc.z, 0.12);
      camera.position.y = THREE.MathUtils.lerp(camera.position.y, bc.y, 0.12);
      camera.position.x = THREE.MathUtils.lerp(camera.position.x, bc.x, 0.12);
      camera.lookAt(bc.x, bc.y, 0);
    }

    // —— LED color ——
    const cs = colorScratch.current;
    // Job-done / confetti override “off” briefly so celebration is visible
    // Birthday lock: never rainbow — hold member color all day
    const rainbowOk = !birthdayHold;
    const lightOff =
      isLightOff(lightColor) &&
      !(rainbowOk && (confettiing || colorCycling));
    if (rainbowOk && (confettiing || colorCycling)) {
      // Quick lap through the 6 stick colors (same order as Cycle mode)
      const n = CYCLE_COLORS.length;
      const speed = confettiing ? 8 : 6; // job-done: a bit calmer than confetti
      const idx = confettiing
        ? (t * speed) % n
        : ((t - a.colorT0) / (a.colorUntil - a.colorT0)) * n;
      const i0 = Math.floor(idx) % n;
      const i1 = (i0 + 1) % n;
      const frac = idx - Math.floor(idx);
      cs.out.copy(CYCLE_COLORS[i0]).lerp(CYCLE_COLORS[i1], frac);
    } else if (isThinking && !lightOff) {
      // While Grok is thinking: hold one color (no rainbow thrash)
      const fixedHex = hexForMode(lightColor);
      if (fixedHex) {
        cs.out.set(fixedHex);
      } else {
        // Cycle mode → soft fixed white while thinking
        cs.out.set(LIGHT_HEX.white);
      }
    } else {
      const fixedHex = hexForMode(lightColor);
      if (fixedHex && !lightOff) {
        cs.out.set(fixedHex);
      } else if (!lightOff) {
        // white → green → purple → blue → orange → yellow → …
        // Hold each color solid, then a brief snap to the next (not smooth morph)
        const n = CYCLE_COLORS.length;
        const cycle = t / COLOR_HOLD_S;
        const i0 = Math.floor(cycle) % n;
        const i1 = (i0 + 1) % n;
        const phase = cycle - Math.floor(cycle); // 0..1 within this color
        const snapStart = Math.max(0, 1 - COLOR_SNAP_S / COLOR_HOLD_S);
        let blend = 0;
        if (phase >= snapStart) {
          // Linear snap — no easeInOut (avoids long gradual change)
          blend = (phase - snapStart) / (1 - snapStart);
        }
        if (blend <= 0) {
          cs.out.copy(CYCLE_COLORS[i0]);
        } else if (blend >= 1) {
          cs.out.copy(CYCLE_COLORS[i1]);
        } else {
          cs.out.copy(CYCLE_COLORS[i0]).lerp(CYCLE_COLORS[i1], blend);
        }
      }
    }
    // Unlit: original GLTF “light” is default white plastic (no emissive)
    if (lightOff) {
      cs.out.set("#ffffff");
      cs.soft.set("#f4f6f8");
    } else {
      // Keep base color close to LED hue (was 22% white → washed out)
      enrichColor(cs.out, 0.28, 0.03);
      cs.soft.copy(cs.out).lerp(cs.a.set("#ffffff"), 0.06);
    }

    const wx = weather.current;
    const pulse = lightOff
      ? 0
      : isThinking
        ? // Gentle breathe while thinking — steady color, soft pulse only
          (1.15 + Math.sin(t * 1.5) * 0.18) * wx * LED_EMIT_BOOST
        : (1.45 +
            Math.sin(t * 2.1) * 0.32 +
            (selfSpin || sp.active ? 0.35 : 0) +
            (hovering ? 0.28 : 0) +
            (selfSpinFast ? 0.45 : 0) +
            pulseBoost * 1.15) *
          wx *
          LED_EMIT_BOOST;

    lightMats.forEach((m) => {
      if (lightOff) {
        // Capture: frosted soft-white head, no LED
        m.color.set(OFF_PLASTIC);
        m.emissive.set("#000000");
        m.emissiveIntensity = 0;
        m.toneMapped = true;
        applySoftPlastic(m, MATTE_DIFFUSER_OFF);
      } else {
        // LED fill through frosted matte head
        m.color.copy(cs.out).multiplyScalar(0.55);
        m.emissive.copy(cs.out);
        m.emissiveIntensity = pulse * (sunHeat ? 1.15 : 1);
        m.toneMapped = false;
        applySoftPlastic(m, MATTE_DIFFUSER);
      }
    });

    // Body shell: soft-touch when off; when lit, handle tint follows LED color
    bodyMats.forEach((m) => {
      if (lightOff) {
        // Capture: continuous soft-touch white stick (buttons/ring via emboss + soft light)
        m.color.set(OFF_PLASTIC);
        m.emissive.set("#000000");
        m.emissiveIntensity = 0;
        applySoftPlastic(m, MATTE_SHELL_OFF);
      } else if (sunHeat) {
        m.roughness = THREE.MathUtils.lerp(m.roughness, 0.18, 0.12);
        m.metalness = THREE.MathUtils.lerp(m.metalness, 0.12, 0.12);
        // Plastic picks up LED color + warm sun
        m.color
          .set(OFF_PLASTIC)
          .lerp(cs.out, 0.14)
          .lerp(cs.a.set("#fff8ee"), 0.1);
        m.emissive.copy(cs.out).lerp(cs.a.set("#ffd8a8"), 0.35);
        m.emissiveIntensity = 0.05 + Math.sin(t * 2.0) * 0.015;
        if ("clearcoat" in m) {
          const pm = m as THREE.MeshPhysicalMaterial;
          pm.clearcoat = THREE.MathUtils.lerp(pm.clearcoat, 0.35, 0.12);
          pm.clearcoatRoughness = THREE.MathUtils.lerp(
            pm.clearcoatRoughness,
            0.35,
            0.12
          );
          pm.sheen = 0.2;
          pm.sheenRoughness = 0.55;
          pm.sheenColor.copy(cs.out);
        }
      } else {
        // Lit grip: soft plastic; color bounce follows LED (cs.out)
        m.color.set(OFF_PLASTIC).lerp(cs.out, 0.16);
        // Soft colored reflection on the handle (not full LED glow)
        m.emissive.copy(cs.out);
        m.emissiveIntensity =
          (0.07 +
            Math.sin(t * 2.1) * 0.015 +
            (hovering ? 0.02 : 0) +
            pulseBoost * 0.03) *
          wx;
        m.roughness = THREE.MathUtils.lerp(m.roughness, 0.5, 0.45);
        m.metalness = THREE.MathUtils.lerp(m.metalness, 0.02, 0.45);
        m.envMapIntensity = 0.4;
        if ("clearcoat" in m) {
          const pm = m as THREE.MeshPhysicalMaterial;
          pm.clearcoat = THREE.MathUtils.lerp(pm.clearcoat, 0.18, 0.45);
          pm.clearcoatRoughness = THREE.MathUtils.lerp(
            pm.clearcoatRoughness,
            0.5,
            0.45
          );
          pm.reflectivity = 0.18;
          // Sheen carries LED hue so reflections change with color
          pm.sheen = 0.28;
          pm.sheenRoughness = 0.6;
          pm.sheenColor.copy(cs.out);
        }
      }
    });

    // LED glow sits at the head only (short range) so shaft doesn’t get upward wash
    if (glowLight.current) {
      if (lightOff) {
        glowLight.current.intensity = 0;
        glowLight.current.visible = false;
      } else {
        glowLight.current.visible = true;
        glowLight.current.color.copy(cs.out);
        glowLight.current.intensity =
          (1.55 +
            Math.sin(t * 2.1) * 0.32 +
            (hovering ? 0.4 : 0) +
            (selfSpinFast ? 0.6 : 0) +
            pulseBoost * 0.95) *
          wx *
          LED_GLOW_BOOST;
        // Tight to bunny head — less spill down the handle
        glowLight.current.distance = 1.85;
        glowLight.current.decay = 2.2;
        glowLight.current.position.set(0, 0.62, 0.28);
      }
    }

    // Rear handle: keep quiet (too much reflection before)
    if (backFillLight.current) {
      if (lightOff) {
        backFillLight.current.visible = true;
        backFillLight.current.intensity = sunHeat ? 0.08 : 0.06;
        backFillLight.current.color.set("#ffffff");
        backFillLight.current.position.set(0, 0.0, -0.45);
        backFillLight.current.distance = 1.4;
      } else {
        // Tiny colored kiss only — not a bright back reflection
        backFillLight.current.visible = true;
        backFillLight.current.color.copy(cs.out);
        backFillLight.current.intensity =
          (0.08 + Math.sin(t * 1.7) * 0.02) * wx;
        backFillLight.current.position.set(0, -0.02, -0.48);
        backFillLight.current.distance = 1.5;
        backFillLight.current.decay = 2.4;
      }
    }

    // Front grip bounce — main colored reflection on the handle
    if (gripColorLight.current) {
      if (lightOff) {
        gripColorLight.current.intensity = 0;
        gripColorLight.current.visible = false;
      } else {
        gripColorLight.current.visible = true;
        gripColorLight.current.color.copy(cs.out);
        gripColorLight.current.intensity =
          (0.42 +
            Math.sin(t * 2.0) * 0.06 +
            (hovering ? 0.08 : 0) +
            (selfSpinFast ? 0.1 : 0) +
            pulseBoost * 0.12) *
          wx *
          LED_GLOW_BOOST;
        gripColorLight.current.position.set(0, 0.0, 0.48);
        gripColorLight.current.distance = 1.9;
      }
    }

    // Orbit sparkle light (twinkle while orbiting)
    if (sparkLight.current) {
      if (lightOff) {
        sparkLight.current.intensity = 0;
        sparkLight.current.visible = false;
      } else if (selfSpinFast) {
        sparkLight.current.visible = true;
        sparkLight.current.intensity =
          (0.95 + Math.abs(Math.sin(t * 12)) * 1.25 + Math.sin(t * 7) * 0.25) *
          LED_GLOW_BOOST;
        sparkLight.current.color.copy(cs.out);
        sparkLight.current.position.set(
          Math.sin(t * 5) * 0.35,
          0.35 + Math.cos(t * 4) * 0.1,
          0.5 + Math.sin(t * 6) * 0.15
        );
      } else if (selfSpin) {
        sparkLight.current.visible = true;
        sparkLight.current.intensity =
          (0.4 + Math.sin(t * 6) * 0.22) * LED_GLOW_BOOST;
        sparkLight.current.color.copy(cs.out);
      } else {
        sparkLight.current.visible = true;
        sparkLight.current.intensity = THREE.MathUtils.lerp(
          sparkLight.current.intensity,
          0,
          0.1
        );
      }
    }

    // Keep model group scale synced if used
    if (mg) {
      mg.scale.set(1, 1, 1);
    }

    // Drive face-attached weather (shades/sweat/snow) with spin — every frame
    onFaceYawRef.current?.(g.rotation.y);
  });

  return (
    <group ref={root}>
      <group ref={modelGroup}>
        <primitive object={model} />
      </group>
      {/* Head-local LED glow (short range — won’t streak up the grip) */}
      <pointLight
        ref={glowLight}
        position={[0, 0.62, 0.28]}
        intensity={1.0}
        distance={1.85}
        decay={2.2}
        color={CYCLE_COLORS[0]}
      />
      {/* Orbit / sparkle point light */}
      <pointLight
        ref={sparkLight}
        position={[0.25, 0.55, 0.35]}
        intensity={0}
        distance={1.8}
        decay={2}
        color="#ffffff"
      />
      {/* Rear handle — very soft only */}
      <pointLight
        ref={backFillLight}
        position={[0, -0.02, -0.48]}
        intensity={0.08}
        distance={1.5}
        decay={2.4}
        color="#ffffff"
      />
      {/* Front mid-grip — LED-colored bounce on the handle */}
      <pointLight
        ref={gripColorLight}
        position={[0, 0.0, 0.48]}
        intensity={0}
        distance={1.9}
        decay={2}
        color={CYCLE_COLORS[0]}
      />
    </group>
  );
}

useGLTF.preload(MODEL_URL);
