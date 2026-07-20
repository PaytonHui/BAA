//! Weather fetch from the native side (bypasses webview CSP / CORS issues).
//! Location: system timezone soft-fix for Hong Kong + IP geo + Open-Meteo.

use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

const HK_LAT: f64 = 22.3193;
const HK_LON: f64 = 114.1694;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WeatherSnapshotDto {
    pub code: i32,
    pub kind: String,
    pub temp_c: f64,
    pub precipitation: f64,
    pub precip_prob: Option<f64>,
    pub place: Option<String>,
    pub fetched_at: u64,
    pub lat: f64,
    pub lon: f64,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn code_to_kind(code: i32) -> &'static str {
    match code {
        0 => "clear",
        1..=3 => "cloudy",
        45 | 48 => "fog",
        51..=57 => "drizzle",
        61..=67 | 80..=82 => "rain",
        71..=77 | 85..=86 => "snow",
        95..=99 => "storm",
        _ => "unknown",
    }
}

fn is_in_hong_kong(lat: f64, lon: f64) -> bool {
    (22.12..=22.58).contains(&lat) && (113.78..=114.5).contains(&lon)
}

/// Prefer Asia/Hong_Kong when the Mac clock is set to HK (common VPN mis-locate).
fn system_is_hong_kong_tz() -> bool {
    // macOS: read TZ via `date +%Z` is flaky; use chrono-less heuristic via env + defaults
    if let Ok(tz) = std::env::var("TZ") {
        if tz.contains("Hong_Kong") || tz.contains("Macau") || tz.contains("Macao") {
            return true;
        }
    }
    // Read system timezone via `readlink` on /etc/localtime (macOS)
    #[cfg(target_os = "macos")]
    {
        if let Ok(link) = std::fs::read_link("/etc/localtime") {
            let s = link.to_string_lossy();
            if s.contains("Hong_Kong") || s.contains("Macau") || s.contains("Macao") {
                return true;
            }
        }
    }
    false
}

async fn ip_lat_lon() -> Option<(f64, f64, Option<String>)> {
    // 1) ip-api.com (HTTP is fine from native; no CSP)
    if let Ok(r) = reqwest::Client::new()
        .get("http://ip-api.com/json/?fields=status,lat,lon,city,regionName,country,countryCode")
        .timeout(std::time::Duration::from_secs(6))
        .send()
        .await
    {
        if r.status().is_success() {
            if let Ok(j) = r.json::<serde_json::Value>().await {
                if j.get("status").and_then(|v| v.as_str()) == Some("success") {
                    if let (Some(lat), Some(lon)) = (j["lat"].as_f64(), j["lon"].as_f64()) {
                        let cc = j["countryCode"].as_str().unwrap_or("").to_uppercase();
                        let place = if cc == "HK" {
                            Some("Hong Kong".into())
                        } else {
                            let city = j["city"].as_str().unwrap_or("");
                            let region = j["regionName"]
                                .as_str()
                                .or_else(|| j["country"].as_str())
                                .unwrap_or("");
                            let p = [city, region]
                                .into_iter()
                                .filter(|s| !s.is_empty())
                                .collect::<Vec<_>>()
                                .join(", ");
                            if p.is_empty() {
                                None
                            } else {
                                Some(p)
                            }
                        };
                        return Some((lat, lon, place));
                    }
                }
            }
        }
    }

    // 2) geojs
    if let Ok(r) = reqwest::Client::new()
        .get("https://get.geojs.io/v1/ip/geo.json")
        .timeout(std::time::Duration::from_secs(6))
        .send()
        .await
    {
        if r.status().is_success() {
            if let Ok(j) = r.json::<serde_json::Value>().await {
                let lat = j["latitude"]
                    .as_str()
                    .and_then(|s| s.parse().ok())
                    .or_else(|| j["latitude"].as_f64());
                let lon = j["longitude"]
                    .as_str()
                    .and_then(|s| s.parse().ok())
                    .or_else(|| j["longitude"].as_f64());
                if let (Some(lat), Some(lon)) = (lat, lon) {
                    let cc = j["country_code"].as_str().unwrap_or("").to_uppercase();
                    let place = if cc == "HK" {
                        Some("Hong Kong".into())
                    } else {
                        let city = j["city"].as_str().unwrap_or("");
                        let country = j["country"].as_str().unwrap_or("");
                        let p = [city, country]
                            .into_iter()
                            .filter(|s| !s.is_empty())
                            .collect::<Vec<_>>()
                            .join(", ");
                        if p.is_empty() {
                            None
                        } else {
                            Some(p)
                        }
                    };
                    return Some((lat, lon, place));
                }
            }
        }
    }

    None
}

async fn open_meteo(lat: f64, lon: f64) -> Result<(f64, i32, f64, Option<f64>), String> {
    let url = format!(
        "https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&current=temperature_2m,weather_code,precipitation,precipitation_probability&timezone=auto"
    );
    let r = reqwest::Client::new()
        .get(&url)
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !r.status().is_success() {
        return Err(format!("open-meteo status {}", r.status()));
    }
    let j: serde_json::Value = r.json().await.map_err(|e| e.to_string())?;
    let cur = j
        .get("current")
        .ok_or_else(|| "no current".to_string())?;
    let temp = cur
        .get("temperature_2m")
        .and_then(|v| v.as_f64())
        .ok_or_else(|| "no temperature".to_string())?;
    let code = cur
        .get("weather_code")
        .and_then(|v| v.as_i64())
        .unwrap_or(0) as i32;
    let precip = cur
        .get("precipitation")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0);
    let precip_prob = cur.get("precipitation_probability").and_then(|v| v.as_f64());
    Ok((temp, code, precip, precip_prob))
}

/// Native weather fetch — used by the frontend so care bubbles get real °C.
#[tauri::command]
pub async fn fetch_weather_native() -> Result<WeatherSnapshotDto, String> {
    let hk_tz = system_is_hong_kong_tz();
    let mut lat = HK_LAT;
    let mut lon = HK_LON;
    let mut place = Some("Hong Kong".to_string());

    if let Some((ilat, ilon, iplace)) = ip_lat_lon().await {
        if hk_tz && !is_in_hong_kong(ilat, ilon) {
            // VPN / wrong IP while Mac is on Asia/Hong_Kong
            eprintln!(
                "[weather] IP {},{} ignored — system TZ is Hong Kong",
                ilat, ilon
            );
            lat = HK_LAT;
            lon = HK_LON;
            place = Some("Hong Kong".into());
        } else {
            lat = ilat;
            lon = ilon;
            place = if is_in_hong_kong(lat, lon) {
                Some("Hong Kong".into())
            } else {
                iplace
            };
        }
    } else if !hk_tz {
        // No IP and not HK TZ — still use HK as last resort (product default)
        eprintln!("[weather] IP geo failed; using Hong Kong default");
    }

    let (temp, code, precip, precip_prob) = open_meteo(lat, lon).await?;
    let temp_c = (temp * 10.0).round() / 10.0;
    let kind = code_to_kind(code).to_string();

    eprintln!(
        "[weather] native ok {}°C {} {:?} @ {},{}",
        temp_c, kind, place, lat, lon
    );

    Ok(WeatherSnapshotDto {
        code,
        kind,
        temp_c,
        precipitation: precip,
        precip_prob,
        place,
        fetched_at: now_ms(),
        lat,
        lon,
    })
}
