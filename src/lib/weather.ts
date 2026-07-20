/**
 * Realtime weather for care bubbles (umbrella, coat, heat, etc.).
 * Location: system GPS when allowed → multi-source IP → timezone soft-fix.
 * Weather: free Open-Meteo (no API key).
 */

export type WeatherKind =
  | "clear"
  | "cloudy"
  | "fog"
  | "drizzle"
  | "rain"
  | "snow"
  | "storm"
  | "unknown";

export interface WeatherSnapshot {
  /** WMO weather code from Open-Meteo */
  code: number;
  kind: WeatherKind;
  /** °C */
  tempC: number;
  /** mm */
  precipitation: number;
  /** 0–100 */
  precipProb: number | null;
  /** Rough place label when available */
  place: string | null;
  /** Unix ms when fetched */
  fetchedAt: number;
  lat: number;
  lon: number;
}

/** Bump to invalidate bad cached locations after location fixes */
const CACHE_KEY = "baa-weather-v2";
const CACHE_TTL_MS = 25 * 60 * 1000; // refresh ~every 25 min

/** Hong Kong SAR rough bounds (incl. outlying islands) */
const HK = {
  lat: 22.3193,
  lon: 114.1694,
  place: "Hong Kong",
  latMin: 22.12,
  latMax: 22.58,
  lonMin: 113.78,
  lonMax: 114.5,
};

function codeToKind(code: number): WeatherKind {
  if (code === 0) return "clear";
  if (code <= 3) return "cloudy";
  if (code === 45 || code === 48) return "fog";
  if (code >= 51 && code <= 57) return "drizzle";
  if (code >= 61 && code <= 67) return "rain";
  if (code >= 80 && code <= 82) return "rain";
  if (code >= 71 && code <= 77) return "snow";
  if (code >= 85 && code <= 86) return "snow";
  if (code >= 95 && code <= 99) return "storm";
  return "unknown";
}

/** True when outdoor rain/snow/storm is likely enough to mention gear. */
export function weatherNeedsUmbrella(w: WeatherSnapshot): boolean {
  if (w.kind === "rain" || w.kind === "drizzle" || w.kind === "storm") {
    return true;
  }
  if (w.kind === "snow") return true;
  if ((w.precipProb ?? 0) >= 50 && w.precipitation > 0) return true;
  if ((w.precipProb ?? 0) >= 70) return true;
  return false;
}

export function weatherIsHot(w: WeatherSnapshot): boolean {
  return w.tempC >= 30;
}

export function weatherIsCold(w: WeatherSnapshot): boolean {
  return w.tempC <= 12;
}

export function loadCachedWeather(): WeatherSnapshot | null {
  try {
    // Drop legacy cache key so wrong IP places from v1 don't stick
    try {
      localStorage.removeItem("baa-weather-v1");
    } catch {
      /* ignore */
    }
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const w = JSON.parse(raw) as WeatherSnapshot;
    if (!w || typeof w.fetchedAt !== "number") return null;
    if (Date.now() - w.fetchedAt > CACHE_TTL_MS * 2) return null;
    return w;
  } catch {
    return null;
  }
}

function saveCachedWeather(w: WeatherSnapshot) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(w));
  } catch {
    /* ignore */
  }
}

/** Clear cached weather (e.g. after fixing location). */
export function clearWeatherCache() {
  try {
    localStorage.removeItem(CACHE_KEY);
    localStorage.removeItem("baa-weather-v1");
  } catch {
    /* ignore */
  }
}

function isInHongKong(lat: number, lon: number): boolean {
  return (
    lat >= HK.latMin &&
    lat <= HK.latMax &&
    lon >= HK.lonMin &&
    lon <= HK.lonMax
  );
}

function systemTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    return "";
  }
}

function isHkTimezone(tz: string): boolean {
  return (
    tz === "Asia/Hong_Kong" ||
    tz === "Asia/Macau" ||
    tz === "Asia/Macao"
  );
}

/** System / browser geolocation (most accurate when permission granted). */
function trySystemGeolocation(
  timeoutMs = 6_000
): Promise<{ lat: number; lon: number } | null> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolve(null);
      return;
    }
    let done = false;
    const finish = (v: { lat: number; lon: number } | null) => {
      if (done) return;
      done = true;
      resolve(v);
    };
    const timer = window.setTimeout(() => finish(null), timeoutMs);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        window.clearTimeout(timer);
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        if (Number.isFinite(lat) && Number.isFinite(lon)) {
          finish({ lat, lon });
        } else {
          finish(null);
        }
      },
      () => {
        window.clearTimeout(timer);
        finish(null);
      },
      {
        enableHighAccuracy: false,
        maximumAge: 15 * 60 * 1000,
        timeout: timeoutMs,
      }
    );
  });
}

/** Reverse-geocode lat/lon → short place label via Open-Meteo (no key). */
async function reverseGeocode(
  lat: number,
  lon: number
): Promise<string | null> {
  try {
    const url =
      `https://geocoding-api.open-meteo.com/v1/reverse` +
      `?latitude=${lat}&longitude=${lon}&language=en&format=json`;
    const r = await fetch(url, { signal: AbortSignal.timeout(6_000) });
    if (!r.ok) return null;
    const j = (await r.json()) as {
      results?: Array<{
        name?: string;
        admin1?: string;
        country?: string;
        country_code?: string;
      }>;
    };
    const hit = j.results?.[0];
    if (!hit) return null;
    // Prefer city; for HK use country when city is a small district
    const cc = (hit.country_code || "").toUpperCase();
    if (cc === "HK") return "Hong Kong";
    const name = hit.name || hit.admin1 || hit.country;
    if (!name) return null;
    if (hit.admin1 && hit.admin1 !== name) return `${name}, ${hit.admin1}`;
    if (hit.country && hit.country !== name) return `${name}, ${hit.country}`;
    return name;
  } catch {
    return null;
  }
}

type IpHit = { lat: number; lon: number; place: string | null; source: string };

async function fetchIpapiCo(): Promise<IpHit | null> {
  try {
    const r = await fetch("https://ipapi.co/json/", {
      signal: AbortSignal.timeout(6_000),
    });
    if (!r.ok) return null;
    const j = (await r.json()) as {
      latitude?: number;
      longitude?: number;
      city?: string;
      region?: string;
      country_name?: string;
      country_code?: string;
      error?: boolean;
    };
    if (j.error) return null;
    if (typeof j.latitude !== "number" || typeof j.longitude !== "number") {
      return null;
    }
    const cc = (j.country_code || "").toUpperCase();
    const place =
      cc === "HK"
        ? "Hong Kong"
        : [j.city, j.region || j.country_name].filter(Boolean).join(", ") ||
          null;
    return { lat: j.latitude, lon: j.longitude, place, source: "ipapi.co" };
  } catch {
    return null;
  }
}

async function fetchIpApiCom(): Promise<IpHit | null> {
  try {
    const r = await fetch(
      "https://ip-api.com/json/?fields=status,lat,lon,city,regionName,country,countryCode",
      { signal: AbortSignal.timeout(6_000) }
    );
    if (!r.ok) return null;
    const j = (await r.json()) as {
      status?: string;
      lat?: number;
      lon?: number;
      city?: string;
      regionName?: string;
      country?: string;
      countryCode?: string;
    };
    if (j.status !== "success" || typeof j.lat !== "number") return null;
    const cc = (j.countryCode || "").toUpperCase();
    const place =
      cc === "HK"
        ? "Hong Kong"
        : [j.city, j.regionName || j.country].filter(Boolean).join(", ") ||
          null;
    return { lat: j.lat, lon: j.lon!, place, source: "ip-api.com" };
  } catch {
    return null;
  }
}

async function fetchGeoJs(): Promise<IpHit | null> {
  try {
    const r = await fetch("https://get.geojs.io/v1/ip/geo.json", {
      signal: AbortSignal.timeout(6_000),
    });
    if (!r.ok) return null;
    const j = (await r.json()) as {
      latitude?: string;
      longitude?: string;
      city?: string;
      region?: string;
      country?: string;
      country_code?: string;
    };
    const lat = parseFloat(j.latitude || "");
    const lon = parseFloat(j.longitude || "");
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    const cc = (j.country_code || "").toUpperCase();
    const place =
      cc === "HK"
        ? "Hong Kong"
        : [j.city, j.region || j.country].filter(Boolean).join(", ") || null;
    return { lat, lon, place, source: "geojs" };
  } catch {
    return null;
  }
}

async function tryIpGeolocation(): Promise<IpHit | null> {
  // Race a few free IP APIs — first good answer wins (others ignored)
  const results = await Promise.all([
    fetchIpapiCo(),
    fetchIpApiCom(),
    fetchGeoJs(),
  ]);
  const hits = results.filter((h): h is IpHit => !!h);
  if (!hits.length) return null;

  // Prefer a hit that matches system timezone (e.g. HK timezone → HK coords)
  const tz = systemTimeZone();
  if (isHkTimezone(tz)) {
    const hkHit = hits.find((h) => isInHongKong(h.lat, h.lon));
    if (hkHit) return { ...hkHit, place: hkHit.place || "Hong Kong" };
  }

  // Otherwise prefer the first successful provider order
  return hits[0];
}

/**
 * Resolve user lat/lon + place label.
 * Priority: system location → IP geo → timezone soft-fix (HK) → HK default.
 */
async function resolveLatLon(): Promise<{
  lat: number;
  lon: number;
  place: string | null;
}> {
  const tz = systemTimeZone();

  // 1) OS / browser location (best)
  const sys = await trySystemGeolocation();
  if (sys) {
    // Soft-fix: Mac set to HK but GPS briefly reports far away (tunnel/VPN noise)
    if (isHkTimezone(tz) && !isInHongKong(sys.lat, sys.lon)) {
      console.log(
        "[weather] system coords outside HK but timezone is HK — using Hong Kong"
      );
      return { lat: HK.lat, lon: HK.lon, place: HK.place };
    }
    let place = await reverseGeocode(sys.lat, sys.lon);
    if (isInHongKong(sys.lat, sys.lon)) place = "Hong Kong";
    console.log("[weather] location via system geolocation", sys.lat, sys.lon, place);
    return { lat: sys.lat, lon: sys.lon, place };
  }

  // 2) IP geolocation (multiple sources)
  const ip = await tryIpGeolocation();
  if (ip) {
    // Soft-fix common VPN mis-locate: clock is HK but IP says elsewhere
    if (isHkTimezone(tz) && !isInHongKong(ip.lat, ip.lon)) {
      console.log(
        "[weather] IP said",
        ip.place,
        ip.source,
        "but timezone is HK — using Hong Kong"
      );
      return { lat: HK.lat, lon: HK.lon, place: HK.place };
    }
    let place = ip.place;
    if (!place || place.length < 2) {
      place = await reverseGeocode(ip.lat, ip.lon);
    }
    if (isInHongKong(ip.lat, ip.lon)) place = "Hong Kong";
    console.log("[weather] location via IP", ip.source, ip.lat, ip.lon, place);
    return { lat: ip.lat, lon: ip.lon, place };
  }

  // 3) Timezone-only fallback
  if (isHkTimezone(tz)) {
    console.log("[weather] location via timezone Asia/Hong_Kong");
    return { lat: HK.lat, lon: HK.lon, place: HK.place };
  }

  // 4) Last resort
  console.log("[weather] location fallback Hong Kong");
  return { lat: HK.lat, lon: HK.lon, place: HK.place };
}

/** Prefer native Rust fetch (no webview CSP); fall back to browser APIs. */
async function fetchWeatherNative(): Promise<WeatherSnapshot | null> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const dto = await invoke<{
      code: number;
      kind: string;
      tempC: number;
      precipitation: number;
      precipProb: number | null;
      place: string | null;
      fetchedAt: number;
      lat: number;
      lon: number;
    }>("fetch_weather_native");
    if (!dto || typeof dto.tempC !== "number") return null;
    const kind = (dto.kind as WeatherKind) || codeToKind(dto.code);
    const snap: WeatherSnapshot = {
      code: dto.code,
      kind,
      tempC: Math.round(dto.tempC * 10) / 10,
      precipitation: dto.precipitation ?? 0,
      precipProb: dto.precipProb ?? null,
      place: dto.place,
      fetchedAt: dto.fetchedAt || Date.now(),
      lat: dto.lat,
      lon: dto.lon,
    };
    saveCachedWeather(snap);
    console.log(
      "[weather] native ok",
      snap.kind,
      snap.tempC,
      snap.place,
      snap.lat,
      snap.lon
    );
    return snap;
  } catch (e) {
    console.warn("[weather] native fetch failed", e);
    return null;
  }
}

/**
 * Fetch current weather. Uses cache when fresh.
 * Prefer native (Rust) path so care bubbles always get real local °C.
 */
export async function fetchWeather(force = false): Promise<WeatherSnapshot | null> {
  if (!force) {
    const cached = loadCachedWeather();
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      return cached;
    }
  } else {
    clearWeatherCache();
  }

  // 1) Native — reliable in Tauri (was blocked by CSP before)
  const native = await fetchWeatherNative();
  if (native) return native;

  // 2) Browser fallback (needs connect-src allowlist)
  try {
    const { lat, lon, place } = await resolveLatLon();
    const url =
      `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,weather_code,precipitation,precipitation_probability` +
      `&timezone=auto`;

    const r = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!r.ok) return loadCachedWeather();

    const j = (await r.json()) as {
      current?: {
        temperature_2m?: number;
        weather_code?: number;
        precipitation?: number;
        precipitation_probability?: number | null;
      };
    };
    const c = j.current;
    if (!c || typeof c.temperature_2m !== "number") {
      return loadCachedWeather();
    }

    const code = typeof c.weather_code === "number" ? c.weather_code : 0;
    const snap: WeatherSnapshot = {
      code,
      kind: codeToKind(code),
      tempC: Math.round(c.temperature_2m * 10) / 10,
      precipitation: c.precipitation ?? 0,
      precipProb:
        typeof c.precipitation_probability === "number"
          ? c.precipitation_probability
          : null,
      place,
      fetchedAt: Date.now(),
      lat,
      lon,
    };
    saveCachedWeather(snap);
    console.log("[weather] browser ok", snap.kind, snap.tempC, snap.place);
    return snap;
  } catch (e) {
    console.warn("[weather] fetch failed", e);
    return loadCachedWeather();
  }
}

/** Short label for UI / logs */
export function weatherSummary(w: WeatherSnapshot): string {
  const t = `${Math.round(w.tempC)}°C`;
  const place = w.place ? ` · ${w.place}` : "";
  switch (w.kind) {
    case "clear":
      return `Clear ${t}${place}`;
    case "cloudy":
      return `Cloudy ${t}${place}`;
    case "fog":
      return `Foggy ${t}${place}`;
    case "drizzle":
      return `Drizzle ${t}${place}`;
    case "rain":
      return `Rain ${t}${place}`;
    case "snow":
      return `Snow ${t}${place}`;
    case "storm":
      return `Storm ${t}${place}`;
    default:
      return `${t}${place}`;
  }
}
