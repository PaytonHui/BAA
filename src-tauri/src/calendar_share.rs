//! Apple Calendar “BAA” sync for the lightstick schedule.
//!
//! Writes events into a dedicated Calendar list named **BAA** via AppleScript.
//! ICS is still written as a fallback when automation is blocked.

use std::path::PathBuf;
use std::time::Duration;

use serde::Deserialize;

use crate::schedule_store;

/// One event from the lightstick schedule → Apple Calendar “BAA”.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BaaCalEvent {
    pub id: String,
    /// YYYY-MM-DD
    pub date: String,
    pub title: String,
    #[serde(default)]
    pub time: Option<String>,
    /// Optional end "HH:mm" (same day)
    #[serde(default)]
    pub end_time: Option<String>,
    #[serde(default)]
    pub note: Option<String>,
    #[serde(default)]
    pub category: Option<String>,
    /// Optional inclusive end YYYY-MM-DD for multi-day events
    #[serde(default)]
    pub end_date: Option<String>,
}

// ─── Public Tauri commands ───────────────────────────────────────────────────

/// Sync schedule into Apple Calendar **BAA**.
/// Returns a human-readable status string (never hangs forever).
#[tauri::command]
pub async fn sync_apple_calendar(events: Vec<BaaCalEvent>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || sync_apple_calendar_inner(events))
        .await
        .map_err(|e| format!("Calendar sync task failed: {e}"))?
}

fn sync_apple_calendar_inner(events: Vec<BaaCalEvent>) -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        let mut events = resolve_baa_events(events)?;
        // Never push decorative defaults into Apple Calendar
        events.retain(|e| !e.id.starts_with("baa-default:"));
        let n = events.len();
        if n == 0 {
            return Err("No plans to sync — add some in BAA Calendar first".into());
        }

        // Always write ICS first (fast, never hangs) as safety net
        let path = write_baa_ics_file(&events)?;

        match sync_baa_calendar_macos(&events) {
            Ok(synced) if synced >= n => {
                let _ = std::process::Command::new("open")
                    .args(["-a", "Calendar"])
                    .status();
                let msg = format!(
                    "Replaced Calendar “BAA” with {synced} latest plans. Sidebar → enable BAA."
                );
                mac_notify("BAA", &format!("Updated “BAA” · {synced} plans"));
                Ok(msg)
            }
            Ok(synced) => {
                let _ = std::process::Command::new("open")
                    .args(["-a", "Calendar"])
                    .status();
                let msg = format!(
                    "Replaced “BAA” with {synced}/{n} plans. Check Calendar sidebar → BAA."
                );
                mac_notify("BAA", &msg);
                Ok(msg)
            }
            Err(e) => {
                let _ = std::process::Command::new("open")
                    .arg(path.as_os_str())
                    .status();
                eprintln!("[baa] calendar automation failed: {e}");
                Err(format!(
                    "Calendar blocked automation. Allow BAA in System Settings → Privacy → Calendars + Automation. Opened BAA.ics ({n}) as backup."
                ))
            }
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = events;
        Err("Apple Calendar sync is only available on macOS".into())
    }
}

// ─── Event resolution / ICS ──────────────────────────────────────────────────

/// Prefer disk schedule when the frontend payload is empty/stale.
fn resolve_baa_events(events: Vec<BaaCalEvent>) -> Result<Vec<BaaCalEvent>, String> {
    if !events.is_empty() {
        return Ok(events);
    }
    let disk = schedule_store::load_schedule()?;
    if disk.is_empty() {
        return Err("No plans to sync — add some in BAA Calendar first".into());
    }
    Ok(disk
        .into_iter()
        .filter(|e| !e.id.starts_with("baa-default:"))
        .map(|e| BaaCalEvent {
            id: e.id,
            date: e.date,
            title: e.title,
            time: e.time,
            end_time: e.end_time,
            note: e.note,
            category: e.category,
            end_date: e.end_date,
        })
        .collect())
}

fn write_baa_ics_file(events: &[BaaCalEvent]) -> Result<PathBuf, String> {
    let ics = build_ics_from_events(events);
    let path = if let Some(home) = dirs::home_dir() {
        let downloads = home.join("Downloads");
        if downloads.is_dir() {
            downloads.join("BAA.ics")
        } else {
            let dir = std::env::temp_dir().join("baa-cal");
            std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
            dir.join("BAA.ics")
        }
    } else {
        let dir = std::env::temp_dir().join("baa-cal");
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        dir.join("BAA.ics")
    };
    std::fs::write(&path, ics.as_bytes()).map_err(|e| e.to_string())?;
    Ok(path)
}

fn build_ics_from_events(events: &[BaaCalEvent]) -> String {
    fn esc(s: &str) -> String {
        s.replace('\\', "\\\\")
            .replace(';', "\\;")
            .replace(',', "\\,")
            .replace('\n', "\\n")
            .replace('\r', "")
    }
    fn parse_hhmm(time: &Option<String>) -> Option<(u32, u32)> {
        let t = time.as_deref()?.trim();
        let mut i = 0;
        let b = t.as_bytes();
        while i < b.len() {
            if b[i].is_ascii_digit() {
                let s = i;
                while i < b.len() && b[i].is_ascii_digit() {
                    i += 1;
                }
                if i < b.len() && b[i] == b':' {
                    let h: u32 = t[s..i].parse().ok()?;
                    i += 1;
                    let m0 = i;
                    while i < b.len() && b[i].is_ascii_digit() {
                        i += 1;
                    }
                    if i > m0 {
                        let m: u32 = t[m0..i].parse().ok()?;
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
    fn next_day(yyyymmdd: &str) -> String {
        if yyyymmdd.len() != 8 {
            return yyyymmdd.to_string();
        }
        let y: i32 = yyyymmdd[0..4].parse().unwrap_or(2026);
        let m: u32 = yyyymmdd[4..6].parse().unwrap_or(1);
        let d: u32 = yyyymmdd[6..8].parse().unwrap_or(1);
        let dim = |y: i32, m: u32| -> u32 {
            match m {
                1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
                4 | 6 | 9 | 11 => 30,
                2 if (y % 4 == 0 && y % 100 != 0) || y % 400 == 0 => 29,
                2 => 28,
                _ => 30,
            }
        };
        let mut ny = y;
        let mut nm = m;
        let mut nd = d + 1;
        if nd > dim(y, m) {
            nd = 1;
            nm += 1;
            if nm > 12 {
                nm = 1;
                ny += 1;
            }
        }
        format!("{ny:04}{nm:02}{nd:02}")
    }

    let mut out = String::from(
        "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//BAA//Lightstick//EN\r\n\
         CALSCALE:GREGORIAN\r\nMETHOD:PUBLISH\r\n\
         X-WR-CALNAME:BAA\r\nNAME:BAA\r\nX-APPLE-CALENDAR-COLOR:#8B5CF6\r\n",
    );
    for e in events {
        let date = e.date.replace('-', "");
        if date.len() != 8 {
            continue;
        }
        out.push_str("BEGIN:VEVENT\r\n");
        out.push_str(&format!("UID:{}@baa.local\r\n", esc(&e.id)));
        out.push_str(&format!("SUMMARY:{}\r\n", esc(&e.title)));
        let mut desc = String::new();
        if let Some(c) = e.category.as_deref().filter(|s| !s.is_empty()) {
            desc.push_str(&format!("BAA · {c}"));
        }
        if let Some(n) = e.note.as_deref().filter(|s| !s.is_empty()) {
            if !desc.is_empty() {
                desc.push('\n');
            }
            desc.push_str(n);
        }
        if !desc.is_empty() {
            desc.push('\n');
        }
        desc.push_str(&format!("[BAA id:{}]", e.id));
        out.push_str(&format!("DESCRIPTION:{}\r\n", esc(&desc)));

        let end_ymd = e
            .end_date
            .as_ref()
            .map(|d| d.replace('-', ""))
            .filter(|d| d.len() == 8);

        if let Some((h, m)) = parse_hhmm(&e.time) {
            let start = format!("{date}T{h:02}{m:02}00");
            let (eh, em) = parse_hhmm(&e.end_time).unwrap_or_else(|| {
                let end_h = h + 1;
                if end_h >= 24 {
                    (end_h - 24, m)
                } else {
                    (end_h, m)
                }
            });
            if let Some(ref ed) = end_ymd {
                let end = format!("{ed}T{eh:02}{em:02}00");
                out.push_str(&format!("DTSTART:{start}\r\nDTEND:{end}\r\n"));
            } else {
                let end_date = if eh < h || (eh == h && em <= m) {
                    next_day(&date)
                } else {
                    date.clone()
                };
                let end = format!("{end_date}T{eh:02}{em:02}00");
                out.push_str(&format!("DTSTART:{start}\r\nDTEND:{end}\r\n"));
            }
        } else {
            let end_excl = if let Some(ref ed) = end_ymd {
                next_day(ed)
            } else {
                next_day(&date)
            };
            out.push_str(&format!("DTSTART;VALUE=DATE:{date}\r\n"));
            out.push_str(&format!("DTEND;VALUE=DATE:{end_excl}\r\n"));
        }
        out.push_str("END:VEVENT\r\n");
    }
    out.push_str("END:VCALENDAR\r\n");
    out
}

// ─── macOS Calendar automation ───────────────────────────────────────────────

#[cfg(target_os = "macos")]
fn mac_notify(title: &str, body: &str) {
    let t = title.replace('\\', "\\\\").replace('"', "\\\"");
    let b = body.replace('\\', "\\\\").replace('"', "\\\"");
    let _ = std::process::Command::new("osascript")
        .arg("-e")
        .arg(format!(r#"display notification "{b}" with title "{t}""#))
        .status();
}

#[cfg(target_os = "macos")]
fn run_osascript_timed(script: &str, timeout_secs: u64) -> Result<(), String> {
    let dir = std::env::temp_dir().join("baa-cal");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(format!(
        "sync-{}.applescript",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0)
    ));
    std::fs::write(&path, script).map_err(|e| e.to_string())?;

    let path_clone = path.clone();
    let handle = std::thread::spawn(move || {
        std::process::Command::new("osascript")
            .arg(&path_clone)
            .output()
    });

    let join = wait_thread_timeout(handle, Duration::from_secs(timeout_secs));
    let _ = std::fs::remove_file(&path);

    match join {
        Ok(Ok(output)) => {
            if output.status.success() {
                Ok(())
            } else {
                let err = String::from_utf8_lossy(&output.stderr);
                let out = String::from_utf8_lossy(&output.stdout);
                Err(format!(
                    "Calendar automation failed (System Settings → Privacy & Security → Automation / Calendars → allow BAA). {err} {out}"
                )
                .trim()
                .to_string())
            }
        }
        Ok(Err(e)) => Err(format!("osascript failed: {e}")),
        Err(_) => {
            let _ = std::process::Command::new("pkill")
                .args(["-f", "baa-cal/sync-"])
                .status();
            Err(format!(
                "Calendar sync timed out after {timeout_secs}s — Calendar was busy. Try again."
            ))
        }
    }
}

#[cfg(target_os = "macos")]
fn wait_thread_timeout<T: Send + 'static>(
    handle: std::thread::JoinHandle<T>,
    timeout: Duration,
) -> Result<T, ()> {
    let start = std::time::Instant::now();
    loop {
        if handle.is_finished() {
            return handle.join().map_err(|_| ());
        }
        if start.elapsed() >= timeout {
            return Err(());
        }
        std::thread::sleep(Duration::from_millis(50));
    }
}

#[cfg(target_os = "macos")]
fn applescript_esc(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"")
}

#[cfg(target_os = "macos")]
fn parse_event_hhmm(time: &Option<String>) -> Option<(u32, u32)> {
    let t = time.as_deref()?.trim();
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
                let m0 = i;
                while i < bytes.len() && bytes[i].is_ascii_digit() {
                    i += 1;
                }
                if i > m0 {
                    let m: u32 = t[m0..i].parse().ok()?;
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

#[cfg(target_os = "macos")]
fn month_name(mo: u32) -> Option<&'static str> {
    Some(match mo {
        1 => "January",
        2 => "February",
        3 => "March",
        4 => "April",
        5 => "May",
        6 => "June",
        7 => "July",
        8 => "August",
        9 => "September",
        10 => "October",
        11 => "November",
        12 => "December",
        _ => return None,
    })
}

/// Create/find calendar **BAA**, then wipe **all** its events.
///
/// “BAA” is dedicated to this app — Sync always replaces the previous snapshot
/// so syncing twice never stacks duplicate events on the same day.
#[cfg(target_os = "macos")]
fn ensure_baa_calendar_cleared() -> Result<(), String> {
    // Two-pass delete: Calendar sometimes keeps stale event refs after one delete.
    let script = r#"tell application "Calendar"
  set calName to "BAA"
  set cal to missing value
  try
    set cals to every calendar whose name is calName
    if (count of cals) > 0 then
      set cal to item 1 of cals
    end if
  end try
  if cal is missing value then
    set cal to make new calendar with properties {name:calName}
  end if
  -- Full wipe (calendar is BAA-only)
  try
    delete (every event of cal)
  end try
  delay 0.3
  try
    set leftover to every event of cal
    repeat with e in leftover
      try
        delete e
      end try
    end repeat
  end try
end tell
"#;
    run_osascript_timed(script, 45)
}

#[cfg(target_os = "macos")]
fn append_event_scripts(script: &mut String, events: &[BaaCalEvent]) -> usize {
    let mut n = 0usize;
    for e in events {
        let parts: Vec<&str> = e.date.split('-').collect();
        if parts.len() != 3 {
            continue;
        }
        let y: i32 = parts[0].parse().unwrap_or(0);
        let mo: u32 = parts[1].parse().unwrap_or(0);
        let d: u32 = parts[2].parse().unwrap_or(0);
        if y < 2000 || !(1..=12).contains(&mo) || !(1..=31).contains(&d) {
            continue;
        }
        let Some(start_month) = month_name(mo) else {
            continue;
        };

        let (end_y, end_d, end_month) = if let Some(ref ed) = e.end_date {
            let p: Vec<&str> = ed.split('-').collect();
            if p.len() == 3 {
                let ey: i32 = p[0].parse().unwrap_or(y);
                let emo: u32 = p[1].parse().unwrap_or(mo);
                let eday: u32 = p[2].parse().unwrap_or(d);
                if ey >= 2000 && (1..=12).contains(&emo) && (1..=31).contains(&eday) {
                    if let Some(emn) = month_name(emo) {
                        (ey, eday, emn)
                    } else {
                        (y, d, start_month)
                    }
                } else {
                    (y, d, start_month)
                }
            } else {
                (y, d, start_month)
            }
        } else {
            (y, d, start_month)
        };

        let title = applescript_esc(&e.title);
        let mut desc = String::new();
        if let Some(c) = e.category.as_deref().filter(|s| !s.is_empty()) {
            desc.push_str(&format!("BAA · {c}"));
        }
        if let Some(note) = e.note.as_deref().filter(|s| !s.is_empty()) {
            if !desc.is_empty() {
                desc.push('\n');
            }
            desc.push_str(note);
        }
        if !desc.is_empty() {
            desc.push('\n');
        }
        desc.push_str(&format!("[BAA id:{}]", e.id));
        let desc = applescript_esc(&desc);

        let (h, m, all_day) = match parse_event_hhmm(&e.time) {
            Some((h, m)) => (h, m, false),
            None => (0, 0, true),
        };
        let (eh, em) = match parse_event_hhmm(&e.end_time) {
            Some(t) => t,
            None if !all_day => {
                let end_h = h + 1;
                if end_h >= 24 {
                    (end_h - 24, m)
                } else {
                    (end_h, m)
                }
            }
            None => (0, 0),
        };

        if all_day {
            script.push_str(&format!(
                r#"
  set startDate to current date
  set year of startDate to {y}
  set month of startDate to {start_month}
  set day of startDate to {d}
  set hours of startDate to 0
  set minutes of startDate to 0
  set seconds of startDate to 0
  set endDate to current date
  set year of endDate to {end_y}
  set month of endDate to {end_month}
  set day of endDate to {end_d}
  set hours of endDate to 0
  set minutes of endDate to 0
  set seconds of endDate to 0
  set endDate to endDate + (1 * days)
  tell cal
    make new event with properties {{summary:"{title}", start date:startDate, end date:endDate, allday event:true, description:"{desc}"}}
  end tell
"#
            ));
        } else {
            script.push_str(&format!(
                r#"
  set startDate to current date
  set year of startDate to {y}
  set month of startDate to {start_month}
  set day of startDate to {d}
  set hours of startDate to {h}
  set minutes of startDate to {m}
  set seconds of startDate to 0
  set endDate to current date
  set year of endDate to {end_y}
  set month of endDate to {end_month}
  set day of endDate to {end_d}
  set hours of endDate to {eh}
  set minutes of endDate to {em}
  set seconds of endDate to 0
  if endDate ≤ startDate then
    set endDate to startDate + (1 * hours)
  end if
  tell cal
    make new event with properties {{summary:"{title}", start date:startDate, end date:endDate, allday event:false, description:"{desc}"}}
  end tell
"#
            ));
        }
        n += 1;
    }
    n
}

/// Full replace: wipe BAA calendar, then write the latest plan list in batches.
#[cfg(target_os = "macos")]
fn sync_baa_calendar_macos(events: &[BaaCalEvent]) -> Result<usize, String> {
    if events.is_empty() {
        return Err("No events to sync — add plans in Calendar first".into());
    }

    // Always clear first so a second Sync never doubles events
    if let Err(e) = ensure_baa_calendar_cleared() {
        return Err(format!("Could not clear old BAA events: {e}"));
    }
    // Brief pause so Calendar commits deletes before inserts
    std::thread::sleep(Duration::from_millis(400));

    const BATCH: usize = 5;
    let mut total = 0usize;
    let mut last_err: Option<String> = None;
    for chunk in events.chunks(BATCH) {
        let mut script = String::from(
            r#"tell application "Calendar"
  set calName to "BAA"
  set cal to missing value
  try
    set cals to every calendar whose name is calName
    if (count of cals) > 0 then
      set cal to item 1 of cals
    end if
  end try
  if cal is missing value then
    set cal to make new calendar with properties {name:calName}
  end if
"#,
        );
        let n = append_event_scripts(&mut script, chunk);
        script.push_str("\nend tell\n");
        if n == 0 {
            continue;
        }
        match run_osascript_timed(&script, 35) {
            Ok(()) => total += n,
            Err(e) => {
                last_err = Some(e);
                break;
            }
        }
    }

    if total == 0 {
        return Err(last_err.unwrap_or_else(|| "No valid dated events to sync".into()));
    }
    Ok(total)
}

#[cfg(not(target_os = "macos"))]
fn sync_baa_calendar_macos(_events: &[BaaCalEvent]) -> Result<usize, String> {
    Err("macOS only".into())
}
