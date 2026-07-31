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
        // Newest first so a timeout still lands the plan the user just added
        events.sort_by(|a, b| b.date.cmp(&a.date).then_with(|| a.title.cmp(&b.title)));
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
                    "Synced {synced} plans → Calendar “BAA”. In Calendar sidebar, tick BAA."
                );
                mac_notify("BAA", &format!("Synced {synced} plans to “BAA”"));
                Ok(msg)
            }
            Ok(synced) => {
                // Partial success — still useful; ICS has the full set
                let _ = std::process::Command::new("open")
                    .args(["-a", "Calendar"])
                    .status();
                let msg = format!(
                    "Synced {synced}/{n} plans to “BAA” (some may need a re-sync). Sidebar → tick BAA. Full list also in Downloads/BAA.ics"
                );
                mac_notify("BAA", &format!("Synced {synced}/{n} plans to “BAA”"));
                let _ = path; // ICS already written
                Ok(msg)
            }
            Err(e) => {
                let _ = std::process::Command::new("open")
                    .arg(path.as_os_str())
                    .status();
                eprintln!("[baa] calendar automation failed: {e}");
                Err(format!(
                    "Could not write Calendar “BAA”: {e}. Opened BAA.ics backup — choose Add All. Also allow BAA under System Settings → Privacy → Calendars + Automation."
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

/// Union frontend payload with on-disk schedule so a just-added plan
/// (saved by the calendar window) is never dropped when main’s list is stale.
fn resolve_baa_events(frontend: Vec<BaaCalEvent>) -> Result<Vec<BaaCalEvent>, String> {
    use std::collections::HashMap;

    let mut map: HashMap<String, BaaCalEvent> = HashMap::new();

    if let Ok(disk) = schedule_store::load_schedule() {
        for e in disk {
            if e.id.is_empty() || e.id.starts_with("baa-default:") {
                continue;
            }
            if e.date.is_empty() || e.title.is_empty() {
                continue;
            }
            map.insert(
                e.id.clone(),
                BaaCalEvent {
                    id: e.id,
                    date: e.date,
                    title: e.title,
                    time: e.time,
                    end_time: e.end_time,
                    note: e.note,
                    category: e.category,
                    end_date: e.end_date,
                },
            );
        }
    }

    for e in frontend {
        if e.id.is_empty() || e.id.starts_with("baa-default:") {
            continue;
        }
        if e.date.is_empty() || e.title.is_empty() {
            continue;
        }
        // Frontend can refresh title/time for same id
        map.insert(e.id.clone(), e);
    }

    let mut out: Vec<BaaCalEvent> = map.into_values().collect();
    if out.is_empty() {
        return Err("No plans to sync — add some in BAA Calendar first".into());
    }
    out.sort_by(|a, b| {
        (&a.date, a.time.as_deref().unwrap_or(""), &a.title).cmp(&(
            &b.date,
            b.time.as_deref().unwrap_or(""),
            &b.title,
        ))
    });
    Ok(out)
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

/// Show a macOS notification attributed to **this app** (BAA icon).
///
/// Do **not** use `osascript display notification` — that runs as osascript /
/// Script Editor and shows the wrong icon in Notification Center.
///
/// Delivering `NSUserNotification` from the BAA process uses
/// `CFBundleIdentifier` / `icon.icns` of BAA.app.
#[cfg(target_os = "macos")]
fn mac_notify(title: &str, body: &str) {
    unsafe {
        use objc2::msg_send;
        use objc2::runtime::{AnyClass, AnyObject};
        use std::ffi::CString;

        let Some(str_cls) = AnyClass::get(c"NSString") else {
            return;
        };
        let to_ns = |s: &str| -> *mut AnyObject {
            let c = CString::new(s).unwrap_or_else(|_| CString::new("").unwrap());
            let p: *mut AnyObject = msg_send![str_cls, stringWithUTF8String: c.as_ptr()];
            p
        };

        let Some(notif_cls) = AnyClass::get(c"NSUserNotification") else {
            return;
        };
        let notif: *mut AnyObject = msg_send![notif_cls, alloc];
        let notif: *mut AnyObject = msg_send![notif, init];
        if notif.is_null() {
            return;
        }

        let _: () = msg_send![notif, setTitle: to_ns(title)];
        let _: () = msg_send![notif, setInformativeText: to_ns(body)];
        // So repeat syncs replace the previous banner entry
        let _: () = msg_send![notif, setIdentifier: to_ns("com.paytonhui.baa.calendar-sync")];
        // Built-in macOS alert sound by name
        let _: () = msg_send![notif, setSoundName: to_ns("Glass")];

        let Some(center_cls) = AnyClass::get(c"NSUserNotificationCenter") else {
            return;
        };
        let center: *mut AnyObject = msg_send![center_cls, defaultUserNotificationCenter];
        if center.is_null() {
            return;
        }
        let _: () = msg_send![center, deliverNotification: notif];
    }
}

#[cfg(not(target_os = "macos"))]
fn mac_notify(_title: &str, _body: &str) {}

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

/// Build AppleScript that sets a date var safely.
///
/// Classic AppleScript bug: if today is day 31 and you set `month` before
/// `day`, months with fewer days (e.g. Nov) roll over (Nov 31 → Dec 1), so
/// Nov 7 becomes Dec 7 and Sync looks broken. Always set day=1 first.
#[cfg(target_os = "macos")]
fn applescript_set_date(
    var: &str,
    y: i32,
    month: &str,
    d: u32,
    h: u32,
    min: u32,
) -> String {
    format!(
        r#"
  set {var} to current date
  set day of {var} to 1
  set year of {var} to {y}
  set month of {var} to {month}
  set day of {var} to {d}
  set hours of {var} to {h}
  set minutes of {var} to {min}
  set seconds of {var} to 0
"#
    )
}

/// Create/find calendar **BAA** (never wipes — wipe-then-insert was losing plans
/// when a later batch timed out).
#[cfg(target_os = "macos")]
fn ensure_baa_calendar_exists() -> Result<(), String> {
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
end tell
"#;
    run_osascript_timed(script, 30)
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

        // Conflict rule (user request): only replace when SAME TITLE + SAME DAY.
        // Never wipe the whole calendar; leave other events untouched.
        script.push_str(&format!(
            r#"
  -- Delete only total conflicts: same summary + same calendar day
  try
    set allEv to every event of cal
    repeat with oe in allEv
      try
        if (summary of oe as text) is "{title}" then
          set sd to start date of oe
          if (year of sd) is {y} and (month of sd) is {start_month} and (day of sd) is {d} then
            delete oe
          end if
        end if
      end try
    end repeat
  end try
"#
        ));

        if all_day {
            script.push_str(&applescript_set_date(
                "startDate",
                y,
                start_month,
                d,
                0,
                0,
            ));
            script.push_str(&applescript_set_date(
                "endDate",
                end_y,
                end_month,
                end_d,
                0,
                0,
            ));
            script.push_str(&format!(
                r#"
  set endDate to endDate + (1 * days)
  tell cal
    make new event with properties {{summary:"{title}", start date:startDate, end date:endDate, allday event:true, description:"{desc}"}}
  end tell
"#
            ));
        } else {
            script.push_str(&applescript_set_date(
                "startDate",
                y,
                start_month,
                d,
                h,
                m,
            ));
            script.push_str(&applescript_set_date(
                "endDate",
                end_y,
                end_month,
                end_d,
                eh,
                em,
            ));
            script.push_str(&format!(
                r#"
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

/// Add/update plans on Calendar “BAA”.
/// - Never replaces the whole calendar
/// - Only replaces an existing event when title + day fully conflict
#[cfg(target_os = "macos")]
fn sync_baa_calendar_macos(events: &[BaaCalEvent]) -> Result<usize, String> {
    if events.is_empty() {
        return Err("No events to sync — add plans in Calendar first".into());
    }

    if let Err(e) = ensure_baa_calendar_exists() {
        return Err(format!("Could not open Calendar “BAA”: {e}"));
    }

    // One event per AppleScript call for reliability
    let mut total = 0usize;
    let mut last_err: Option<String> = None;
    for ev in events {
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
        let n = append_event_scripts(&mut script, std::slice::from_ref(ev));
        script.push_str("\nend tell\n");
        if n == 0 {
            continue;
        }
        match run_osascript_timed(&script, 45) {
            Ok(()) => total += n,
            Err(e) => {
                eprintln!("[baa] sync one failed ({}): {e}", ev.title);
                last_err = Some(e);
                continue;
            }
        }
        std::thread::sleep(Duration::from_millis(60));
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
