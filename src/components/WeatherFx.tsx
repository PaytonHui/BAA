import type { RefObject } from "react";
import type { WeatherKind, WeatherSnapshot } from "../lib/weather";
import { weatherIsHot } from "../lib/weather";

interface WeatherFxProps {
  weather: WeatherSnapshot | null;
  /** Optional caption (e.g. one-shot demo cycle) */
  label?: string | null;
  /**
   * Layer that follows the lightstick’s face yaw so shades / sweat / snow-cap
   * stay on the head while it spins (sky FX stay world-space).
   */
  faceLayerRef?: RefObject<HTMLDivElement | null>;
  /** Fade out before unmount — prevents residual afterimage */
  leaving?: boolean;
}

function mockSnap(kind: WeatherKind, tempC: number): WeatherSnapshot {
  return {
    code: 0,
    kind,
    tempC,
    precipitation: kind === "clear" ? 0 : 2,
    precipProb: 80,
    place: "Preview",
    fetchedAt: Date.now(),
    lat: 0,
    lon: 0,
  };
}

/** One-shot demo order for all weather motions */
export const WEATHER_FX_PREVIEW_STEPS: {
  weather: WeatherSnapshot;
  label: string;
}[] = [
  { weather: mockSnap("clear", 33), label: "Hot · sun + sweat" },
  { weather: mockSnap("cloudy", 18), label: "Cloudy" },
  { weather: mockSnap("fog", 12), label: "Fog" },
  { weather: mockSnap("drizzle", 15), label: "Drizzle" },
  { weather: mockSnap("rain", 14), label: "Rain" },
  { weather: mockSnap("storm", 16), label: "Storm" },
  { weather: mockSnap("snow", -2), label: "Snow" },
];

/**
 * Weather FX (with weather care bubbles).
 * Sky FX (sun/cloud/rain/snow) stay fixed; face FX track 3D spin via faceLayerRef.
 */
export function WeatherFx({
  weather,
  label,
  faceLayerRef,
  leaving = false,
}: WeatherFxProps) {
  if (!weather) return null;

  const kind = weather.kind;
  const hot = weatherIsHot(weather);
  const rainy =
    kind === "rain" || kind === "drizzle" || kind === "storm";
  const snowy = kind === "snow";
  const cloudy = kind === "cloudy" || kind === "fog";
  const stormy = kind === "storm";
  const drizzle = kind === "drizzle";
  const foggy = kind === "fog";

  if (!hot && !rainy && !snowy && !cloudy) return null;

  const dropCount = stormy ? 16 : drizzle ? 7 : 11;
  const hasFaceFx = hot || snowy;

  return (
    <div
      className={`weather-fx absolute inset-0 z-[30] pointer-events-none overflow-visible ${
        leaving ? "weather-fx-out" : "weather-fx-in"
      }`}
      aria-hidden
    >
      {label && <span className="weather-fx-label">{label}</span>}

      {/* —— Sky / world-space (does not spin with the stick) —— */}
      {hot && (
        <div className="weather-sun" title={`${Math.round(weather.tempC)}°C`}>
          <span className="weather-sun-rays" />
          <span className="weather-sun-core">
            <span className="weather-sun-eye left" />
            <span className="weather-sun-eye right" />
            <span className="weather-sun-cheek left" />
            <span className="weather-sun-cheek right" />
            <span className="weather-sun-smile" />
          </span>
        </div>
      )}

      {(rainy || (cloudy && !hot)) && (
        <div
          className={`weather-cloud-wrap ${stormy ? "storm" : ""} ${
            drizzle ? "drizzle" : ""
          } ${foggy ? "fog" : ""}`}
        >
          <div className="weather-cloud">
            <span className="weather-cloud-haze" />
            <span className="weather-cloud-puff back b1" />
            <span className="weather-cloud-puff back b2" />
            <span className="weather-cloud-puff mid m1" />
            <span className="weather-cloud-puff mid m2" />
            <span className="weather-cloud-puff mid m3" />
            <span className="weather-cloud-puff mid m4" />
            <span className="weather-cloud-puff front f1" />
            <span className="weather-cloud-puff front f2" />
            <span className="weather-cloud-puff front f3" />
            <span className="weather-cloud-belly" />
            <span className="weather-cloud-rim" />
            <span className="weather-cloud-cast" />
          </div>
          {rainy && (
            <div
              className={`weather-rain ${stormy ? "heavy" : ""} ${
                drizzle ? "light" : ""
              }`}
            >
              {Array.from({ length: dropCount }).map((_, i) => (
                <span
                  key={i}
                  className="weather-raindrop"
                  style={{
                    left: `${4 + i * (stormy ? 5.8 : drizzle ? 12 : 8.2)}%`,
                    animationDelay: `${(i % 7) * 0.11}s`,
                    animationDuration: `${0.48 + (i % 5) * 0.08}s`,
                    height: `${9 + (i % 4) * 2}px`,
                  }}
                />
              ))}
            </div>
          )}
          {stormy && (
            <>
              <span className="weather-storm-flash" />
              <span className="weather-bolt" />
            </>
          )}
        </div>
      )}

      {snowy && (
        <div className="weather-snow">
          {Array.from({ length: 20 }).map((_, i) => {
            const depth = (i % 3) + 1;
            const size =
              depth === 1
                ? 1.8 + (i % 3) * 0.9
                : depth === 2
                  ? 2.4 + (i % 3) * 1.1
                  : 3.2 + (i % 3) * 1.3;
            return (
              <span
                key={i}
                className={`weather-flake depth-${depth}`}
                style={{
                  left: `${3 + ((i * 5.3) % 90)}%`,
                  animationDelay: `${(i * 0.15) % 2.8}s`,
                  animationDuration: `${2.6 + (i % 6) * 0.5}s`,
                  width: `${size}px`,
                  height: `${size}px`,
                }}
              />
            );
          })}
        </div>
      )}

      {/* —— Face-attached: follows stick spin so rotation + weather work together —— */}
      {hasFaceFx && (
        <div
          ref={faceLayerRef}
          className="weather-face-layer"
          data-leaving={leaving ? "1" : undefined}
        >
          {hot && (
            <>
              <div className="weather-shades" title="Sunny day shades">
                <span className="weather-shades-emoji">🕶️</span>
              </div>
              <div className="weather-sweat">
                <span className="weather-sweat-drop d1" />
                <span className="weather-sweat-drop d2" />
              </div>
            </>
          )}
          {snowy && (
            <div className="weather-snow-cap">
              <span className="weather-snow-cap-base" />
              <span className="weather-snow-cap-layer l1" />
              <span className="weather-snow-cap-layer l2" />
              <span className="weather-snow-cap-layer l3" />
              <span className="weather-snow-cap-layer l4" />
              <span className="weather-snow-cap-layer l5" />
              <span className="weather-snow-cap-layer l6" />
              <span className="weather-snow-cap-edge e1" />
              <span className="weather-snow-cap-edge e2" />
              <span className="weather-snow-cap-edge e3" />
              <span className="weather-snow-cap-dust" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Map snapshot → display mode for tests / debug */
export function weatherFxMode(
  w: WeatherSnapshot | null
): WeatherKind | "hot" | null {
  if (!w) return null;
  if (weatherIsHot(w)) return "hot";
  return w.kind === "unknown" || w.kind === "clear" ? null : w.kind;
}
