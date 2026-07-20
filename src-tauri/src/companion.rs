//! LAN companion link: iPhone on same Wi‑Fi scans a QR → opens a calendar
//! page → one-tap “Add to Calendar” (ICS) or Shortcuts pulls JSON schedule.

use axum::{
    body::Body,
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Query, State,
    },
    http::{header, StatusCode},
    response::{Html, IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use futures_util::{SinkExt, StreamExt};
use once_cell::sync::Lazy;
use qrcode::render::svg;
use qrcode::QrCode;
use rand::RngExt;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use tokio::sync::{broadcast, RwLock};
use tower_http::cors::{Any, CorsLayer};

pub const COMPANION_PORT: u16 = 17832;

static LINK_STATE: Lazy<Arc<LinkState>> = Lazy::new(|| Arc::new(LinkState::new()));

struct LinkState {
    token: String,
    /// Fan-out channel for phone clients
    tx: broadcast::Sender<String>,
    client_count: AtomicUsize,
    /// device labels by connection id (best-effort)
    devices: RwLock<HashMap<usize, String>>,
    next_id: AtomicUsize,
    /// Latest Mac calendar — std lock so Tauri commands always publish reliably
    schedule: std::sync::RwLock<ScheduleSnapshot>,
}

impl LinkState {
    fn new() -> Self {
        let (tx, _) = broadcast::channel(64);
        Self {
            token: load_or_create_token(),
            tx,
            client_count: AtomicUsize::new(0),
            devices: RwLock::new(HashMap::new()),
            next_id: AtomicUsize::new(1),
            schedule: std::sync::RwLock::new(ScheduleSnapshot {
                updated_at: 0,
                events: vec![],
            }),
        }
    }
}

/// Stable token across Mac restarts so the phone doesn’t need re-pair every launch.
fn load_or_create_token() -> String {
    let path = dirs::data_local_dir()
        .or_else(dirs::data_dir)
        .map(|d| d.join("com.paytonhui.baa").join("companion_token.txt"));
    if let Some(path) = path {
        if let Ok(s) = std::fs::read_to_string(&path) {
            let t = s.trim().to_string();
            if t.len() >= 6 {
                eprintln!("[companion] loaded pairing token from disk");
                return t;
            }
        }
        // Migrate legacy desktop-pet token once
        if let Some(legacy) = dirs::data_local_dir()
            .or_else(dirs::data_dir)
            .map(|d| d.join("com.paytonhui.desktop-pet").join("companion_token.txt"))
        {
            if let Ok(s) = std::fs::read_to_string(&legacy) {
                let t = s.trim().to_string();
                if t.len() >= 6 {
                    if let Some(parent) = path.parent() {
                        let _ = std::fs::create_dir_all(parent);
                    }
                    let _ = std::fs::write(&path, &t);
                    eprintln!("[companion] migrated pairing token from desktop-pet");
                    return t;
                }
            }
        }
        let t = random_token();
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let _ = std::fs::write(&path, &t);
        eprintln!("[companion] created new pairing token");
        return t;
    }
    random_token()
}

fn schedule_snapshot() -> ScheduleSnapshot {
    LINK_STATE
        .schedule
        .read()
        .map(|g| g.clone())
        .unwrap_or_default()
}

/// Push full calendar to all linked phones over WebSocket.
fn broadcast_schedule_sync() {
    let snap = schedule_snapshot();
    let msg = serde_json::json!({
        "kind": "schedule_sync",
        "updatedAt": snap.updated_at,
        "events": snap.events,
        "text": format!("{} events from Mac", snap.events.len()),
        "emoji": "📅",
        "category": "schedule",
        "title": "Calendar",
        "at": chrono_now(),
    });
    let _ = LINK_STATE.tx.send(msg.to_string());
    eprintln!(
        "[companion] broadcast schedule_sync ({} events) to phones",
        snap.events.len()
    );
}

/// Calendar event mirrored from Mac BAA for phone pull-sync.
#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleEventDto {
    pub id: String,
    pub date: String,
    pub title: String,
    #[serde(default)]
    pub time: Option<String>,
    #[serde(default)]
    pub note: Option<String>,
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub created_at: i64,
}

#[derive(Clone, Serialize, Deserialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleSnapshot {
    pub updated_at: i64,
    pub events: Vec<ScheduleEventDto>,
}

fn random_token() -> String {
    const CHARS: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let mut rng = rand::rng();
    (0..8)
        .map(|_| CHARS[rng.random_range(0..CHARS.len())] as char)
        .collect()
}

fn local_ip_string() -> String {
    // Prefer a real LAN IPv4 (not loopback / link-local) so the phone can reach Mac
    if let Ok(ip) = local_ip_address::local_ip() {
        match ip {
            std::net::IpAddr::V4(v4)
                if !v4.is_loopback() && !v4.is_link_local() && !v4.is_unspecified() =>
            {
                return v4.to_string();
            }
            _ => {}
        }
    }
    if let Ok(ifaces) = local_ip_address::list_afinet_netifas() {
        for (name, ip) in ifaces {
            // Prefer Wi‑Fi / Ethernet style interfaces
            let n = name.to_lowercase();
            if !(n.starts_with("en") || n.starts_with("eth") || n.contains("wlan")) {
                continue;
            }
            if let std::net::IpAddr::V4(v4) = ip {
                if !v4.is_loopback() && !v4.is_link_local() && !v4.is_unspecified() {
                    return v4.to_string();
                }
            }
        }
    }
    "127.0.0.1".into()
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkInfo {
    /// Calendar landing page (QR target) — Add to Calendar + Shortcuts tips
    pub url: String,
    /// Direct .ics download for Calendar / Shortcuts
    pub ics_url: String,
    /// JSON schedule API for Shortcuts “Get Contents of URL”
    pub schedule_api_url: String,
    /// Signed “BAA Calendar” Shortcut download (install once on iPhone)
    pub shortcut_url: String,
    /// Deep link to run installed Shortcut with this Mac’s API URL
    pub shortcut_run_url: String,
    pub token: String,
    pub port: u16,
    pub local_ip: String,
    pub linked_count: usize,
    pub qr_svg: String,
    pub devices: Vec<String>,
    /// How many calendar events Mac has published for phone sync
    pub event_count: usize,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhoneEvent {
    /// "reminder" | "care" | "ping" | "linked"
    pub kind: String,
    pub text: String,
    #[serde(default)]
    pub emoji: String,
    #[serde(default)]
    pub category: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub at: i64,
}

#[derive(Deserialize)]
struct TokenQuery {
    token: Option<String>,
}

/// Start the companion HTTP + WebSocket server (idempotent enough for setup).
pub fn start_server() {
    let state = LINK_STATE.clone();
    std::thread::spawn(move || {
        let rt = match tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
        {
            Ok(rt) => rt,
            Err(e) => {
                eprintln!("[companion] failed to build runtime: {e}");
                return;
            }
        };
        rt.block_on(async move {
            let cors = CorsLayer::new()
                .allow_origin(Any)
                .allow_methods(Any)
                .allow_headers(Any);

            let app = Router::new()
                // QR lands on calendar page (Add to Calendar / Shortcuts)
                .route("/", get(calendar_page))
                .route("/calendar", get(calendar_page))
                .route("/calendar.ics", get(calendar_ics))
                // Ready-made Shortcuts app install (signed .shortcut)
                .route("/BAA-Calendar.shortcut", get(serve_baa_shortcut))
                .route("/shortcut", get(shortcut_install_page))
                // Legacy live-reminder mini page (optional)
                .route("/live", get(phone_page))
                .route("/api/info", get(api_info))
                // JSON for Shortcuts “Get Contents of URL” → Add New Event
                .route("/api/schedule", get(api_get_schedule).post(api_post_schedule_http))
                .route("/ws", get(ws_upgrade))
                .route("/health", get(|| async { "ok" }))
                .route("/assets/lightstick.png", get(serve_lightstick_png))
                .layer(cors)
                .with_state(state);

            let addr = SocketAddr::from(([0, 0, 0, 0], COMPANION_PORT));
            match tokio::net::TcpListener::bind(addr).await {
                Ok(listener) => {
                    eprintln!(
                        "[companion] listening on http://{}:{}",
                        local_ip_string(),
                        COMPANION_PORT
                    );
                    if let Err(e) = axum::serve(listener, app).await {
                        eprintln!("[companion] server error: {e}");
                    }
                }
                Err(e) => {
                    eprintln!("[companion] bind {addr} failed: {e}");
                }
            }
        });
    });
}

fn build_url() -> String {
    let ip = local_ip_string();
    let token = &LINK_STATE.token;
    // Calendar-first landing (scan → mark schedule on iPhone Calendar)
    format!("http://{ip}:{COMPANION_PORT}/calendar?token={token}")
}

fn build_ics_url() -> String {
    let ip = local_ip_string();
    let token = &LINK_STATE.token;
    format!("http://{ip}:{COMPANION_PORT}/calendar.ics?token={token}")
}

fn build_schedule_api_url() -> String {
    let ip = local_ip_string();
    let token = &LINK_STATE.token;
    format!("http://{ip}:{COMPANION_PORT}/api/schedule?token={token}")
}

fn build_shortcut_url() -> String {
    let ip = local_ip_string();
    format!("http://{ip}:{COMPANION_PORT}/BAA-Calendar.shortcut")
}

/// Opens Shortcuts app and runs “BAA Calendar” with this Mac’s API URL as input.
fn build_shortcut_run_url() -> String {
    let api = build_schedule_api_url();
    // shortcuts://run-shortcut?name=BAA%20Calendar&input=text&text=...
    format!(
        "shortcuts://run-shortcut?name=BAA%20Calendar&input=text&text={}",
        urlencoding_lite(&api)
    )
}

/// Minimal URL-encode for query values (token-safe).
fn urlencoding_lite(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 3);
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char);
            }
            b' ' => out.push_str("%20"),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

fn qr_svg_for(url: &str) -> String {
    match QrCode::new(url.as_bytes()) {
        Ok(code) => code
            .render::<svg::Color>()
            .min_dimensions(180, 180)
            .dark_color(svg::Color("#0f172a"))
            .light_color(svg::Color("#ffffff"))
            .build(),
        Err(_) => String::new(),
    }
}

pub fn link_info() -> LinkInfo {
    let url = build_url();
    let devices = LINK_STATE
        .devices
        .try_read()
        .map(|d| d.values().cloned().collect())
        .unwrap_or_default();
    let event_count = LINK_STATE
        .schedule
        .read()
        .map(|s| s.events.len())
        .unwrap_or(0);
    LinkInfo {
        qr_svg: qr_svg_for(&url),
        url,
        ics_url: build_ics_url(),
        schedule_api_url: build_schedule_api_url(),
        shortcut_url: build_shortcut_url(),
        shortcut_run_url: build_shortcut_run_url(),
        token: LINK_STATE.token.clone(),
        port: COMPANION_PORT,
        local_ip: local_ip_string(),
        linked_count: LINK_STATE.client_count.load(Ordering::Relaxed),
        devices,
        event_count,
    }
}

/// Broadcast a reminder / care event to all linked phones.
pub fn push_event(event: &PhoneEvent) -> Result<usize, String> {
    let json = serde_json::to_string(event).map_err(|e| e.to_string())?;
    let n = LINK_STATE.client_count.load(Ordering::Relaxed);
    let _ = LINK_STATE.tx.send(json);
    Ok(n)
}

async fn api_info(State(_s): State<Arc<LinkState>>) -> Json<LinkInfo> {
    Json(link_info())
}

fn token_ok(q: &TokenQuery) -> bool {
    q.token
        .as_deref()
        .map(|t| t.eq_ignore_ascii_case(&LINK_STATE.token))
        .unwrap_or(false)
}

/// Phone pulls Mac calendar when on same Wi‑Fi (no permanent link required).
async fn api_get_schedule(
    Query(q): Query<TokenQuery>,
    State(state): State<Arc<LinkState>>,
) -> Response {
    if !token_ok(&q) {
        return (StatusCode::UNAUTHORIZED, "bad token").into_response();
    }
    let snap = state
        .schedule
        .read()
        .map(|g| g.clone())
        .unwrap_or_default();
    eprintln!(
        "[companion] GET /api/schedule → {} events",
        snap.events.len()
    );
    Json(snap).into_response()
}

/// Optional HTTP publish (same as Tauri command) for tooling.
async fn api_post_schedule_http(
    Query(q): Query<TokenQuery>,
    State(state): State<Arc<LinkState>>,
    Json(body): Json<ScheduleSnapshot>,
) -> Response {
    if !token_ok(&q) {
        return (StatusCode::UNAUTHORIZED, "bad token").into_response();
    }
    let mut snap = body;
    if snap.updated_at == 0 {
        snap.updated_at = chrono_now();
    }
    if let Ok(mut g) = state.schedule.write() {
        *g = snap.clone();
    }
    Json(snap).into_response()
}

/// Same lightstick image used by the Mac app (embedded asset).
async fn serve_lightstick_png() -> Response {
    const PNG: &[u8] = include_bytes!("../assets/lightstick-icon.png");
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "image/png")
        .header(header::CACHE_CONTROL, "public, max-age=86400")
        .body(Body::from(PNG))
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

/// QR landing: list schedule + one-tap Add to Calendar (ICS) + Shortcuts guide.
async fn calendar_page(Query(q): Query<TokenQuery>) -> Response {
    if !token_ok(&q) {
        return (StatusCode::UNAUTHORIZED, Html(unauthorized_html())).into_response();
    }
    let snap = schedule_snapshot();
    let ics = build_ics_url();
    let api = build_schedule_api_url();
    let shortcut = build_shortcut_url();
    let run = build_shortcut_run_url();
    Html(calendar_html(&snap, &ics, &api, &shortcut, &run)).into_response()
}

/// Install page for the ready-made Shortcut (also linked from calendar).
async fn shortcut_install_page(Query(q): Query<TokenQuery>) -> Response {
    if !token_ok(&q) {
        return (StatusCode::UNAUTHORIZED, Html(unauthorized_html())).into_response();
    }
    let shortcut = build_shortcut_url();
    let run = build_shortcut_run_url();
    let api = build_schedule_api_url();
    Html(shortcut_install_html(&shortcut, &run, &api)).into_response()
}

/// Serve signed “BAA Calendar.shortcut” for one-tap install on iPhone.
async fn serve_baa_shortcut() -> Response {
    const BYTES: &[u8] = include_bytes!("../assets/shortcuts/BAA-Calendar.shortcut");
    Response::builder()
        .status(StatusCode::OK)
        .header(
            header::CONTENT_TYPE,
            "application/x-apple-shortcut",
        )
        .header(
            header::CONTENT_DISPOSITION,
            "attachment; filename=\"BAA Calendar.shortcut\"",
        )
        .header(header::CACHE_CONTROL, "no-store")
        .body(Body::from(BYTES))
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

/// iCalendar file — Safari / Calendar / Shortcuts can import events.
async fn calendar_ics(Query(q): Query<TokenQuery>) -> Response {
    if !token_ok(&q) {
        return (StatusCode::UNAUTHORIZED, "bad token").into_response();
    }
    let snap = schedule_snapshot();
    let body = build_ics(&snap.events);
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "text/calendar; charset=utf-8")
        .header(
            header::CONTENT_DISPOSITION,
            "inline; filename=\"baa-schedule.ics\"",
        )
        .header(header::CACHE_CONTROL, "no-store")
        .body(Body::from(body))
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

fn ics_escape(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace(';', "\\;")
        .replace(',', "\\,")
        .replace('\n', "\\n")
        .replace('\r', "")
}

/// Parse "HH:mm" / "H:mm" / "14:30" → (hour, min). None = all-day.
fn parse_hhmm(time: &Option<String>) -> Option<(u32, u32)> {
    let t = time.as_deref()?.trim();
    if t.is_empty() {
        return None;
    }
    // take first HH:mm in the string
    let re = regex_lite_hhmm(t);
    re
}

fn regex_lite_hhmm(t: &str) -> Option<(u32, u32)> {
    let bytes = t.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i].is_ascii_digit() {
            let start = i;
            while i < bytes.len() && bytes[i].is_ascii_digit() {
                i += 1;
            }
            if i < bytes.len() && bytes[i] == b':' {
                let h: u32 = t[start..i].parse().ok()?;
                i += 1;
                let m_start = i;
                while i < bytes.len() && bytes[i].is_ascii_digit() {
                    i += 1;
                }
                if i > m_start {
                    let m: u32 = t[m_start..i].parse().ok()?;
                    if h < 24 && m < 60 {
                        return Some((h, m));
                    }
                }
            }
        } else {
            i += 1;
        }
    }
    None
}

fn build_ics(events: &[ScheduleEventDto]) -> String {
    let mut out = String::with_capacity(512 + events.len() * 180);
    out.push_str("BEGIN:VCALENDAR\r\n");
    out.push_str("VERSION:2.0\r\n");
    out.push_str("PRODID:-//BAA//Lightstick//EN\r\n");
    out.push_str("CALSCALE:GREGORIAN\r\n");
    out.push_str("METHOD:PUBLISH\r\n");
    out.push_str("X-WR-CALNAME:BAA Schedule\r\n");

    for e in events {
        // date = YYYY-MM-DD
        let date = e.date.replace('-', "");
        if date.len() != 8 {
            continue;
        }
        let uid = ics_escape(&format!("{}@baa.local", e.id));
        let summary = ics_escape(&e.title);
        let mut desc = String::new();
        if let Some(cat) = e.category.as_deref() {
            if !cat.is_empty() {
                desc.push_str(&format!("Category: {cat}"));
            }
        }
        if let Some(note) = e.note.as_deref() {
            if !note.is_empty() {
                if !desc.is_empty() {
                    desc.push_str("\\n");
                }
                desc.push_str(note);
            }
        }
        let desc = ics_escape(&desc.replace("\\n", "\n"));

        out.push_str("BEGIN:VEVENT\r\n");
        out.push_str(&format!("UID:{uid}\r\n"));
        out.push_str(&format!("SUMMARY:{summary}\r\n"));
        if !desc.is_empty() {
            out.push_str(&format!("DESCRIPTION:{desc}\r\n"));
        }

        if let Some((h, m)) = parse_hhmm(&e.time) {
            let start = format!("{date}T{h:02}{m:02}00");
            // default duration 1 hour (local / floating time)
            let end_h = h + 1;
            let (end_date, eh) = if end_h >= 24 {
                (next_day_yyyymmdd(&date).unwrap_or_else(|| date.clone()), end_h - 24)
            } else {
                (date.clone(), end_h)
            };
            let end = format!("{end_date}T{eh:02}{m:02}00");
            out.push_str(&format!("DTSTART:{start}\r\n"));
            out.push_str(&format!("DTEND:{end}\r\n"));
        } else {
            // All-day: DTEND is exclusive next day (approx +1 day without chrono)
            out.push_str(&format!("DTSTART;VALUE=DATE:{date}\r\n"));
            if let Some(next) = next_day_yyyymmdd(&date) {
                out.push_str(&format!("DTEND;VALUE=DATE:{next}\r\n"));
            }
        }
        out.push_str("END:VEVENT\r\n");
    }

    out.push_str("END:VCALENDAR\r\n");
    out
}

/// YYYYMMDD → next calendar day (simple, no leap edge cases perfect but OK)
fn next_day_yyyymmdd(d: &str) -> Option<String> {
    if d.len() != 8 {
        return None;
    }
    let y: i32 = d[0..4].parse().ok()?;
    let m: u32 = d[4..6].parse().ok()?;
    let day: u32 = d[6..8].parse().ok()?;
    let days_in = |y: i32, m: u32| -> u32 {
        match m {
            1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
            4 | 6 | 9 | 11 => 30,
            2 => {
                if (y % 4 == 0 && y % 100 != 0) || y % 400 == 0 {
                    29
                } else {
                    28
                }
            }
            _ => 30,
        }
    };
    let mut ny = y;
    let mut nm = m;
    let mut nd = day + 1;
    let dim = days_in(y, m);
    if nd > dim {
        nd = 1;
        nm += 1;
        if nm > 12 {
            nm = 1;
            ny += 1;
        }
    }
    Some(format!("{ny:04}{nm:02}{nd:02}"))
}

fn calendar_html(
    snap: &ScheduleSnapshot,
    ics_url: &str,
    api_url: &str,
    shortcut_url: &str,
    run_url: &str,
) -> String {
    let n = snap.events.len();
    let mut items = String::new();
    let mut evs = snap.events.clone();
    evs.sort_by(|a, b| {
        a.date
            .cmp(&b.date)
            .then(a.time.as_deref().unwrap_or("").cmp(b.time.as_deref().unwrap_or("")))
    });
    for e in evs.iter().take(40) {
        let time = e.time.as_deref().unwrap_or("All day");
        let title = html_escape(&e.title);
        let date = html_escape(&e.date);
        let time = html_escape(time);
        items.push_str(&format!(
            r#"<li><span class="d">{date}</span><span class="t">{time}</span><span class="n">{title}</span></li>"#
        ));
    }
    if items.is_empty() {
        items = r#"<li class="empty">No events on Mac yet.<br/>Add plans in BAA calendar or chat first.</li>"#.into();
    }

    let ics_js = serde_json::to_string(ics_url).unwrap_or_else(|_| "\"\"".into());
    let api_js = serde_json::to_string(api_url).unwrap_or_else(|_| "\"\"".into());

    format!(
        r##"<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,viewport-fit=cover"/>
<meta name="apple-mobile-web-app-capable" content="yes"/>
<meta name="theme-color" content="#0b1020"/>
<title>BAA → Calendar</title>
<style>
  * {{ box-sizing: border-box; -webkit-tap-highlight-color: transparent; }}
  body {{
    margin: 0; min-height: 100dvh;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    background: radial-gradient(ellipse at 50% 0%, #1e1b4b 0%, #0b1020 55%);
    color: #e2e8f0;
    padding: calc(16px + env(safe-area-inset-top)) 18px calc(28px + env(safe-area-inset-bottom));
  }}
  .card {{
    max-width: 420px; margin: 0 auto;
    background: #111827ee; border: 1px solid #ffffff18;
    border-radius: 22px; padding: 20px 18px 18px;
    box-shadow: 0 20px 50px #00000055;
  }}
  .badge {{
    display: inline-flex; align-items: center; gap: 6px;
    font-size: 11px; letter-spacing: .04em; text-transform: uppercase;
    color: #a5b4fc; background: #312e8155; border: 1px solid #6366f144;
    padding: 4px 10px; border-radius: 999px; margin-bottom: 12px;
  }}
  h1 {{ font-size: 22px; margin: 0 0 6px; letter-spacing: -0.02em; }}
  .sub {{ font-size: 14px; color: #94a3b8; line-height: 1.45; margin: 0 0 16px; }}
  .cta {{
    display: block; width: 100%; text-align: center; text-decoration: none;
    background: linear-gradient(135deg, #a78bfa, #6366f1);
    color: #fff; font-weight: 700; font-size: 16px;
    padding: 14px 16px; border-radius: 14px; border: none;
    box-shadow: 0 8px 24px #6366f155; margin-bottom: 8px;
  }}
  .cta.secondary {{
    background: linear-gradient(135deg, #34d399, #059669);
    box-shadow: 0 8px 24px #05966944;
  }}
  .cta.ghost {{
    background: #ffffff10; box-shadow: none; border: 1px solid #ffffff22;
    font-size: 14px; padding: 12px;
  }}
  .cta:active {{ transform: scale(0.98); }}
  .hint {{ font-size: 12px; color: #64748b; text-align: center; margin: 4px 0 16px; line-height: 1.4; }}
  h2 {{ font-size: 13px; color: #cbd5e1; margin: 0 0 8px; font-weight: 600; }}
  ul {{ list-style: none; margin: 0; padding: 0; max-height: 36vh; overflow: auto; }}
  li {{
    display: grid; grid-template-columns: 88px 64px 1fr; gap: 6px;
    align-items: baseline; padding: 10px 0; border-bottom: 1px solid #ffffff0e;
    font-size: 13px;
  }}
  li.empty {{ display: block; color: #94a3b8; line-height: 1.45; padding: 12px 0; }}
  .d {{ color: #94a3b8; font-variant-numeric: tabular-nums; }}
  .t {{ color: #c4b5fd; font-variant-numeric: tabular-nums; }}
  .n {{ color: #f1f5f9; font-weight: 600; }}
  .steps {{
    margin-top: 16px; padding-top: 14px; border-top: 1px solid #ffffff12;
  }}
  .steps ol {{ margin: 0 0 10px; padding-left: 18px; color: #94a3b8; font-size: 12px; line-height: 1.55; }}
  .steps code {{
    display: block; margin-top: 8px; padding: 10px; border-radius: 10px;
    background: #0f172a; border: 1px solid #ffffff12; color: #a5b4fc;
    font-size: 10px; word-break: break-all; line-height: 1.4;
  }}
  .row {{ display: flex; gap: 8px; margin-top: 10px; }}
  .ghostbtn {{
    flex: 1; font-size: 12px; font-weight: 600; padding: 10px;
    border-radius: 12px; border: 1px solid #ffffff18; background: #ffffff08;
    color: #e2e8f0; cursor: pointer;
  }}
  .toast {{
    position: fixed; left: 50%; bottom: calc(20px + env(safe-area-inset-bottom));
    transform: translateX(-50%) translateY(20px); opacity: 0;
    background: #22c55e; color: #052e16; font-weight: 700; font-size: 13px;
    padding: 10px 16px; border-radius: 999px; transition: .25s; pointer-events: none;
  }}
  .toast.show {{ opacity: 1; transform: translateX(-50%) translateY(0); }}
</style>
</head>
<body>
  <div class="card">
    <div class="badge">💡 BAA · same Wi‑Fi</div>
    <h1>Mark on your Calendar</h1>
    <p class="sub">
      Your Mac lightstick shared <b>{n}</b> event{plural}.
      Use Shortcuts (recommended) or one-tap .ics import.
    </p>

    <a class="cta secondary" href="{shortcut_href}">1 · Get BAA Calendar Shortcut</a>
    <a class="cta" href="{run_href}">2 · Run Shortcut · Sync now</a>
    <p class="hint">
      Install once (step 1). Then step 2 pulls events from this Mac into Calendar.
      If iPhone asks to allow untrusted shortcuts, enable it in Settings → Shortcuts.
    </p>

    <a class="cta ghost" href="{ics_href}">Or: Add to Calendar (.ics)</a>
    <p class="hint">Safari opens a calendar file — choose <b>Add All</b>.</p>

    <h2>From Mac</h2>
    <ul>{items}</ul>

    <div class="steps">
      <h2>API (advanced)</h2>
      <code id="apiUrl">{api_text}</code>
      <div class="row">
        <button type="button" class="ghostbtn" id="copyApi">Copy API link</button>
        <button type="button" class="ghostbtn" id="copyIcs">Copy .ics link</button>
      </div>
    </div>
  </div>
  <div class="toast" id="toast">Copied</div>
<script>
(function(){{
  const ics = {ics_js};
  const api = {api_js};
  const toast = document.getElementById("toast");
  function flash(msg) {{
    toast.textContent = msg || "Copied";
    toast.classList.add("show");
    setTimeout(function(){{ toast.classList.remove("show"); }}, 1400);
  }}
  async function copy(text) {{
    try {{
      await navigator.clipboard.writeText(text);
      flash("Copied");
    }} catch (e) {{
      prompt("Copy this link:", text);
    }}
  }}
  document.getElementById("copyApi").onclick = function(){{ copy(api); }};
  document.getElementById("copyIcs").onclick = function(){{ copy(ics); }};
}})();
</script>
</body>
</html>"##,
        n = n,
        plural = if n == 1 { "" } else { "s" },
        items = items,
        ics_href = html_escape(ics_url),
        shortcut_href = html_escape(shortcut_url),
        run_href = html_escape(run_url),
        api_text = html_escape(api_url),
        ics_js = ics_js,
        api_js = api_js,
    )
}

fn shortcut_install_html(shortcut_url: &str, run_url: &str, api_url: &str) -> String {
    format!(
        r##"<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"/>
<title>Install BAA Calendar</title>
<style>
body{{margin:0;min-height:100dvh;font-family:-apple-system,system-ui,sans-serif;
background:#0b1020;color:#e2e8f0;padding:calc(20px + env(safe-area-inset-top)) 20px 32px}}
.card{{max-width:400px;margin:0 auto;background:#111827;border:1px solid #ffffff18;
border-radius:20px;padding:22px}}
h1{{font-size:20px;margin:0 0 8px}}
p{{font-size:14px;color:#94a3b8;line-height:1.45}}
a.btn{{display:block;text-align:center;text-decoration:none;margin:10px 0;padding:14px;
border-radius:14px;font-weight:700;color:#fff;
background:linear-gradient(135deg,#a78bfa,#6366f1)}}
a.btn2{{background:linear-gradient(135deg,#34d399,#059669)}}
ol{{color:#94a3b8;font-size:13px;line-height:1.55;padding-left:18px}}
code{{display:block;margin-top:10px;padding:10px;border-radius:10px;background:#0f172a;
border:1px solid #ffffff12;color:#a5b4fc;font-size:10px;word-break:break-all}}
</style></head><body>
<div class="card">
<h1>Install BAA Calendar Shortcut</h1>
<p>One-time install. Then any scan of the lightstick QR can sync Mac events into Calendar.</p>
<a class="btn" href="{shortcut}">Download · BAA Calendar.shortcut</a>
<a class="btn btn2" href="{run}">Already installed? Sync now</a>
<ol>
<li>Tap Download — open in <b>Shortcuts</b></li>
<li>Tap <b>Add Shortcut</b></li>
<li>Allow calendar access if asked</li>
<li>Tap <b>Sync now</b> (or re-scan the QR)</li>
</ol>
<p>Shortcut name must stay <b>BAA Calendar</b> for one-tap sync.</p>
<code>{api}</code>
</div>
</body></html>"##,
        shortcut = html_escape(shortcut_url),
        run = html_escape(run_url),
        api = html_escape(api_url),
    )
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

async fn phone_page(Query(q): Query<TokenQuery>) -> Response {
    let expected = &LINK_STATE.token;
    let ok = q
        .token
        .as_deref()
        .map(|t| t.eq_ignore_ascii_case(expected))
        .unwrap_or(false);
    if !ok {
        return (
            StatusCode::UNAUTHORIZED,
            Html(unauthorized_html()),
        )
            .into_response();
    }
    Html(phone_html(expected)).into_response()
}

async fn ws_upgrade(
    ws: WebSocketUpgrade,
    Query(q): Query<TokenQuery>,
    State(state): State<Arc<LinkState>>,
) -> Response {
    let expected = &state.token;
    let ok = q
        .token
        .as_deref()
        .map(|t| t.eq_ignore_ascii_case(expected))
        .unwrap_or(false);
    if !ok {
        return (StatusCode::UNAUTHORIZED, "bad token").into_response();
    }
    ws.on_upgrade(move |socket| handle_socket(socket, state))
}

async fn handle_socket(socket: WebSocket, state: Arc<LinkState>) {
    let id = state.next_id.fetch_add(1, Ordering::Relaxed);
    state.client_count.fetch_add(1, Ordering::Relaxed);
    {
        let mut d = state.devices.write().await;
        d.insert(id, format!("iPhone #{id}"));
    }

    let (mut sender, mut receiver) = socket.split();
    let mut rx = state.tx.subscribe();

    // Welcome
    let hello = serde_json::json!({
        "kind": "linked",
        "text": "Linked to BAA on your Mac ✨",
        "emoji": "🐰",
        "category": "",
        "title": "BAA",
        "at": chrono_now(),
    });
    let _ = sender
        .send(Message::Text(hello.to_string().into()))
        .await;

    // Immediately push calendar so linked phone isn’t empty
    let snap = schedule_snapshot();
    let cal = serde_json::json!({
        "kind": "schedule_sync",
        "updatedAt": snap.updated_at,
        "events": snap.events,
        "text": format!("{} events from Mac", snap.events.len()),
        "emoji": "📅",
        "category": "schedule",
        "title": "Calendar",
        "at": chrono_now(),
    });
    let _ = sender
        .send(Message::Text(cal.to_string().into()))
        .await;
    eprintln!(
        "[companion] phone #{} linked — sent {} events",
        id,
        snap.events.len()
    );

    let send_task = tokio::spawn(async move {
        while let Ok(msg) = rx.recv().await {
            if sender
                .send(Message::Text(msg.into()))
                .await
                .is_err()
            {
                break;
            }
        }
    });

    // Read side: optional rename / ping
    while let Some(Ok(msg)) = receiver.next().await {
        if let Message::Text(t) = msg {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&t) {
                if v.get("kind").and_then(|k| k.as_str()) == Some("hello") {
                    if let Some(name) = v.get("name").and_then(|n| n.as_str()) {
                        let mut d = state.devices.write().await;
                        d.insert(id, name.chars().take(32).collect());
                    }
                }
            }
        } else if matches!(msg, Message::Close(_)) {
            break;
        }
    }

    send_task.abort();
    state.client_count.fetch_sub(1, Ordering::Relaxed);
    state.devices.write().await.remove(&id);
}

fn chrono_now() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn unauthorized_html() -> String {
    r#"<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"/>
<title>BAA Link</title>
<style>
body{margin:0;min-height:100dvh;display:grid;place-items:center;font-family:system-ui,sans-serif;
background:#0b1020;color:#e2e8f0;padding:24px;text-align:center}
.card{max-width:320px;padding:24px;border-radius:20px;background:#111827;border:1px solid #ffffff22}
h1{font-size:18px;margin:0 0 8px}p{font-size:14px;opacity:.8;line-height:1.45}
</style></head><body>
<div class="card">
<h1>Invalid or expired link</h1>
<p>Open <b>Link iPhone</b> on your Mac BAA app and scan the new QR code while on the same Wi‑Fi.</p>
</div></body></html>"#
        .into()
}

fn phone_html(token: &str) -> String {
    // Desktop-pet style: pet is HIDDEN until a reminder pops it up.
    // Uses the same lightstick PNG as the Mac app.
    format!(
        r##"<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,viewport-fit=cover"/>
<meta name="apple-mobile-web-app-capable" content="yes"/>
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"/>
<meta name="theme-color" content="#000000"/>
<title>BAA</title>
<style>
  * {{ box-sizing: border-box; -webkit-tap-highlight-color: transparent; }}
  html, body {{
    margin: 0; height: 100%;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    /* Nearly empty “desktop” — pet only appears for reminders */
    background: #05070f;
    color: #e2e8f0;
    overflow: hidden;
    user-select: none;
  }}
  body.popup {{
    background: radial-gradient(ellipse at 70% 90%, #1a1430 0%, #05070f 55%);
  }}

  /* Idle: tiny listening pill only */
  .chip {{
    position: fixed;
    top: calc(10px + env(safe-area-inset-top));
    left: 50%;
    transform: translateX(-50%);
    z-index: 20;
    font-size: 11px;
    letter-spacing: .03em;
    padding: 6px 12px;
    border-radius: 999px;
    background: #0f172acc;
    border: 1px solid #ffffff18;
    color: #94a3b8;
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    transition: opacity .3s, color .2s;
  }}
  .chip.ok {{ color: #86efac; border-color: #34d39944; }}
  .chip.bad {{ color: #fca5a5; border-color: #f8717144; }}
  .chip.dim {{ opacity: 0.35; }}

  .idle-hint {{
    position: fixed;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    pointer-events: none;
    opacity: 1;
    transition: opacity .35s;
  }}
  body.popup .idle-hint {{ opacity: 0; }}
  .idle-hint .dot {{
    width: 8px; height: 8px; border-radius: 50%;
    background: #a78bfa;
    box-shadow: 0 0 12px #a78bfa;
    animation: pulse 2.2s ease infinite;
  }}
  .idle-hint p {{
    margin: 0; font-size: 12px; color: #475569; text-align: center;
    max-width: 240px; line-height: 1.45;
  }}
  @keyframes pulse {{
    0%,100% {{ opacity: .45; transform: scale(1); }}
    50% {{ opacity: 1; transform: scale(1.25); }}
  }}

  /* Pet pop-out — bottom center, like Mac desktop pet */
  .pet-layer {{
    position: fixed;
    left: 0; right: 0;
    bottom: 0;
    height: min(52dvh, 420px);
    display: flex;
    align-items: flex-end;
    justify-content: center;
    padding: 0 12px calc(12px + env(safe-area-inset-bottom));
    pointer-events: none;
    z-index: 10;
    /* hidden until reminder */
    opacity: 0;
    transform: translateY(110%);
    transition: transform .45s cubic-bezier(.2,.9,.2,1), opacity .3s ease;
  }}
  .pet-layer.show {{
    opacity: 1;
    transform: translateY(0);
    pointer-events: auto;
  }}

  .pet-stage {{
    position: relative;
    width: 200px;
    height: 280px;
    display: flex;
    align-items: flex-end;
    justify-content: center;
  }}

  /* Real Mac lightstick still (same asset as app) */
  .stick {{
    width: 168px;
    height: 240px;
    object-fit: contain;
    object-position: bottom center;
    filter: drop-shadow(0 0 18px #c9a8ff88) drop-shadow(0 12px 28px #00000088);
    transform-origin: 50% 90%;
    animation: floaty 2.4s ease-in-out infinite;
  }}
  .stick.alert {{
    animation: bounce 0.65s ease infinite;
    filter: drop-shadow(0 0 28px #e9d5ff) drop-shadow(0 0 48px #a78bfa99)
            drop-shadow(0 12px 28px #00000088);
  }}
  @keyframes floaty {{
    0%,100% {{ transform: translateY(0) rotate(-1.5deg); }}
    50% {{ transform: translateY(-6px) rotate(1.5deg); }}
  }}
  @keyframes bounce {{
    0%,100% {{ transform: translateY(0) rotate(-2deg) scale(1); }}
    50% {{ transform: translateY(-12px) rotate(2deg) scale(1.04); }}
  }}

  /* WhatsApp-green care bubble — right of stick (same as Mac) */
  .bubble {{
    position: absolute;
    left: calc(50% + 42px);
    bottom: 150px;
    max-width: 148px;
    min-width: 96px;
    padding: 10px 12px;
    background: #dcf8c6;
    color: #111;
    border-radius: 16px 16px 16px 4px;
    font-size: 13px;
    line-height: 1.35;
    font-weight: 500;
    box-shadow: 0 8px 24px #00000055;
    opacity: 0;
    transform: scale(0.8) translateY(10px);
    transition: opacity .22s, transform .22s cubic-bezier(.2,.9,.2,1);
    pointer-events: none;
    z-index: 3;
  }}
  .bubble.show {{
    opacity: 1;
    transform: scale(1) translateY(0);
  }}
  .bubble .em {{ font-size: 15px; margin-right: 3px; }}
  .bubble .tail {{
    position: absolute; left: -5px; bottom: 10px;
    width: 10px; height: 10px; background: #dcf8c6;
    transform: rotate(45deg);
    border-radius: 1px;
  }}

  .dismiss {{
    position: absolute;
    top: -4px; right: -28px;
    width: 28px; height: 28px;
    border-radius: 50%;
    border: 1px solid #ffffff22;
    background: #0f172acc;
    color: #94a3b8;
    font-size: 14px;
    line-height: 1;
    display: none;
    align-items: center;
    justify-content: center;
    pointer-events: auto;
  }}
  .pet-layer.show .dismiss {{ display: flex; }}
</style>
</head>
<body>
  <div class="chip" id="status">Connecting…</div>

  <div class="idle-hint" id="idleHint">
    <div class="dot"></div>
    <p>BAA is linked.<br/>Lightstick pops up only for work &amp; schedule reminders.</p>
  </div>

  <div class="pet-layer" id="petLayer">
    <div class="pet-stage">
      <div class="bubble" id="bubble">
        <span class="tail" aria-hidden="true"></span>
        <span class="em" id="emoji">📅</span><span id="text">…</span>
      </div>
      <img
        class="stick"
        id="stick"
        src="/assets/lightstick.png"
        alt="BAA lightstick"
        draggable="false"
      />
      <button type="button" class="dismiss" id="dismiss" aria-label="Dismiss">×</button>
    </div>
  </div>

<script>
(function () {{
  const TOKEN = {token_js};
  const statusEl = document.getElementById("status");
  const petLayer = document.getElementById("petLayer");
  const bubble = document.getElementById("bubble");
  const textEl = document.getElementById("text");
  const emojiEl = document.getElementById("emoji");
  const stick = document.getElementById("stick");
  const dismissBtn = document.getElementById("dismiss");
  let hideTimer = null;
  let chipTimer = null;
  let audioCtx = null;

  function setStatus(msg, cls) {{
    statusEl.textContent = msg;
    statusEl.className = "chip " + (cls || "");
  }}

  function dimChipSoon() {{
    clearTimeout(chipTimer);
    chipTimer = setTimeout(function () {{
      statusEl.classList.add("dim");
    }}, 4000);
  }}

  function ensureAudio() {{
    if (!audioCtx) {{
      try {{ audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }} catch (e) {{}}
    }}
    if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
  }}

  function playChime(kind) {{
    ensureAudio();
    if (!audioCtx) return;
    const t0 = audioCtx.currentTime;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(kind === "reminder" ? 660 : 520, t0);
    o.frequency.exponentialRampToValueAtTime(kind === "reminder" ? 880 : 640, t0 + 0.12);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.14, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.5);
    o.connect(g); g.connect(audioCtx.destination);
    o.start(t0); o.stop(t0 + 0.55);
    if (kind === "reminder") {{
      const o2 = audioCtx.createOscillator();
      const g2 = audioCtx.createGain();
      o2.type = "sine";
      o2.frequency.value = 990;
      g2.gain.setValueAtTime(0.0001, t0 + 0.16);
      g2.gain.exponentialRampToValueAtTime(0.09, t0 + 0.2);
      g2.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.6);
      o2.connect(g2); g2.connect(audioCtx.destination);
      o2.start(t0 + 0.16); o2.stop(t0 + 0.65);
    }}
  }}

  function hidePet() {{
    bubble.classList.remove("show");
    stick.classList.remove("alert");
    petLayer.classList.remove("show");
    document.body.classList.remove("popup");
  }}

  /** Pop the desktop pet only for reminders (and optional care). */
  function popPet(payload) {{
    const kind = payload.kind || "reminder";
    // "linked" is status-only — no pet pop
    if (kind === "linked" || kind === "ping") return;

    emojiEl.textContent = payload.emoji || (kind === "reminder" ? "📅" : "✨");
    textEl.textContent = payload.text || "";
    document.body.classList.add("popup");
    petLayer.classList.add("show");
    // next frame so transition runs
    requestAnimationFrame(function () {{
      bubble.classList.add("show");
      stick.classList.add("alert");
    }});
    playChime(kind === "reminder" ? "reminder" : "care");
    try {{
      if (navigator.vibrate) navigator.vibrate(kind === "reminder" ? [40, 50, 80] : 30);
    }} catch (e) {{}}

    clearTimeout(hideTimer);
    const ms = kind === "reminder" ? 14000 : 8000;
    hideTimer = setTimeout(hidePet, ms);
  }}

  dismissBtn.addEventListener("click", function () {{
    clearTimeout(hideTimer);
    hidePet();
  }});
  // Tap pet to dismiss after reading
  stick.addEventListener("click", function () {{
    clearTimeout(hideTimer);
    hidePet();
  }});

  document.body.addEventListener("touchstart", function once() {{
    ensureAudio();
    document.body.removeEventListener("touchstart", once);
  }}, {{ passive: true }});

  function connect() {{
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(proto + "//" + location.host + "/ws?token=" + encodeURIComponent(TOKEN));
    ws.onopen = function () {{
      setStatus("BAA · listening", "ok");
      dimChipSoon();
      try {{ ws.send(JSON.stringify({{ kind: "hello", name: "iPhone" }})); }} catch (e) {{}}
    }};
    ws.onclose = function () {{
      setStatus("Reconnecting…", "bad");
      statusEl.classList.remove("dim");
      setTimeout(connect, 1500);
    }};
    ws.onerror = function () {{ setStatus("Connection issue", "bad"); }};
    ws.onmessage = function (ev) {{
      try {{
        const data = JSON.parse(ev.data);
        if (data.kind === "linked") {{
          setStatus("BAA · listening", "ok");
          dimChipSoon();
          return;
        }}
        if (data.kind === "reminder" || data.kind === "care") {{
          statusEl.classList.remove("dim");
          setStatus(data.kind === "reminder" ? "Reminder" : "BAA", "ok");
          popPet(data);
          dimChipSoon();
        }}
      }} catch (e) {{}}
    }};
  }}
  connect();
}})();
</script>
</body>
</html>"##,
        token_js = serde_json::to_string(token).unwrap_or_else(|_| "\"\"".into()),
    )
}

// —— Tauri commands ——

#[tauri::command]
pub fn get_link_info() -> Result<LinkInfo, String> {
    Ok(link_info())
}

#[tauri::command]
pub fn push_phone_event(event: PhoneEvent) -> Result<usize, String> {
    push_event(&event)
}

#[tauri::command]
pub fn refresh_link_token() -> Result<LinkInfo, String> {
    Ok(link_info())
}

/// Mac UI publishes calendar so the phone can pull when on same Wi‑Fi.
#[tauri::command]
pub fn publish_schedule(events: Vec<ScheduleEventDto>) -> Result<ScheduleSnapshot, String> {
    let snap = ScheduleSnapshot {
        updated_at: chrono_now(),
        events,
    };
    {
        let mut guard = LINK_STATE
            .schedule
            .write()
            .map_err(|_| "schedule lock poisoned".to_string())?;
        *guard = snap.clone();
    }
    eprintln!(
        "[companion] published {} event(s) for phone sync",
        snap.events.len()
    );
    // Live push to every linked phone (WebSocket)
    broadcast_schedule_sync();
    Ok(snap)
}



#[tauri::command]
pub fn get_published_schedule() -> Result<ScheduleSnapshot, String> {
    LINK_STATE
        .schedule
        .read()
        .map(|g| g.clone())
        .map_err(|_| "schedule lock poisoned".into())
}
