mod chat;
mod companion;
mod config;
mod schedule_store;
mod weather;

#[cfg(target_os = "macos")]
mod macos_spaces;

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    Emitter, LogicalSize, Manager, PhysicalPosition, Runtime,
};

/// Cancels an in-flight “float home” animation when a new one starts.
static FLOAT_HOME_GEN: AtomicU64 = AtomicU64::new(0);

/// Force the macOS Dock / app switcher icon (bundle Resources alone is not enough
/// for a hand-built .app — NSApp keeps the icon Tauri embeds at build time).
#[cfg(target_os = "macos")]
fn set_macos_dock_icon() {
    // Same asset as tauri.conf.json icons/icon.png (AppIcon.appiconset mac source)
    const ICON_PNG: &[u8] = include_bytes!("../icons/icon.png");
    unsafe {
        use objc2::msg_send;
        use objc2::runtime::{AnyClass, AnyObject};

        let Some(nsdata_cls) = AnyClass::get(c"NSData") else {
            return;
        };
        let Some(nsimage_cls) = AnyClass::get(c"NSImage") else {
            return;
        };
        let Some(nsapp_cls) = AnyClass::get(c"NSApplication") else {
            return;
        };

        let data: *mut AnyObject = msg_send![
            nsdata_cls,
            dataWithBytes: ICON_PNG.as_ptr(),
            length: ICON_PNG.len()
        ];
        if data.is_null() {
            return;
        }
        let image_alloc: *mut AnyObject = msg_send![nsimage_cls, alloc];
        let image: *mut AnyObject = msg_send![image_alloc, initWithData: data];
        if image.is_null() {
            return;
        }
        let app: *mut AnyObject = msg_send![nsapp_cls, sharedApplication];
        if !app.is_null() {
            let _: () = msg_send![app, setApplicationIconImage: image];
        }
    }
}

fn hide_all_windows(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
    if let Some(chat) = app.get_webview_window("chat") {
        let _ = chat.hide();
    }
}

#[tauri::command]
fn hide_window(app: tauri::AppHandle) -> Result<(), String> {
    hide_all_windows(&app);
    let _ = app.emit("pet-tray", "pause");
    Ok(())
}

#[tauri::command]
fn show_window(app: tauri::AppHandle) -> Result<(), String> {
    show_main(&app);
    let _ = float_pet_to_center(app.clone());
    let _ = app.emit("pet-tray", "resume");
    Ok(())
}

/// Pause pet (hide) — Dock / tray
#[tauri::command]
fn pause_pet(app: tauri::AppHandle) -> Result<(), String> {
    hide_all_windows(&app);
    let _ = app.emit("pet-tray", "pause");
    Ok(())
}

/// Resume pet (show) — Dock / tray
#[tauri::command]
fn resume_pet(app: tauri::AppHandle) -> Result<(), String> {
    show_main(&app);
    // Frontend animates scale; we float the window home
    let _ = float_pet_to_center(app.clone());
    let _ = app.emit("pet-tray", "dock-center");
    Ok(())
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

fn show_main(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
        #[cfg(target_os = "macos")]
        macos_spaces::pin_to_all_spaces(&window);
    }
}

/// Pet-only size, centered on the current monitor (Dock click / “find Binky”).
/// Animates (“floats”) instead of snapping — no flash teleport.
#[tauri::command]
fn center_pet_on_screen(app: tauri::AppHandle) -> Result<(), String> {
    float_pet_to_center(app)
}

/// Ease-out cubic: fast start, soft landing in the middle.
fn ease_out_cubic(t: f64) -> f64 {
    let u = 1.0 - t;
    1.0 - u * u * u
}

fn lerp_f64(a: f64, b: f64, t: f64) -> f64 {
    a + (b - a) * t
}

/// Float main window to default pet size at screen center (~0.55s ease-out).
fn float_pet_to_center(app: tauri::AppHandle) -> Result<(), String> {
    float_window_to_center_sized(app, 190.0, 280.0)
}

/// Smoothly resize + move main window to monitor center at a given logical size.
/// Used after birthday party so the stick eases from arena → normal home.
#[tauri::command]
fn float_to_center_sized(
    app: tauri::AppHandle,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let w = width.clamp(80.0, 2400.0);
    let h = height.clamp(80.0, 2400.0);
    float_window_to_center_sized(app, w, h)
}

/// Shared float: animate outer frame from current → centered logical size.
fn float_window_to_center_sized(
    app: tauri::AppHandle,
    end_w_logical: f64,
    end_h_logical: f64,
) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window missing".to_string())?;

    let _ = window.show();
    let _ = window.set_always_on_top(true);

    #[cfg(target_os = "macos")]
    macos_spaces::pin_to_all_spaces(&window);

    // macOS: Cocoa animator — one continuous setFrame (no step jitter)
    #[cfg(target_os = "macos")]
    {
        if let Ok(ptr) = window.ns_window() {
            if !ptr.is_null() {
                let duration = 0.95_f64;
                let gen = FLOAT_HOME_GEN.fetch_add(1, Ordering::SeqCst) + 1;
                // *mut c_void is !Send — pass as usize into main-thread closure
                let ptr_bits = ptr as usize;
                let end_w = end_w_logical;
                let end_h = end_h_logical;
                let app_main = app.clone();
                let anim_ok = app_main
                    .run_on_main_thread(move || {
                        if FLOAT_HOME_GEN.load(Ordering::SeqCst) != gen {
                            return;
                        }
                        let p = ptr_bits as *mut std::ffi::c_void;
                        let _ = unsafe {
                            ns_animate_frame_to_center(p, end_w, end_h, duration)
                        };
                    })
                    .is_ok();
                if anim_ok {
                    std::thread::spawn(move || {
                        std::thread::sleep(Duration::from_millis(
                            (duration * 1000.0).round() as u64 + 100,
                        ));
                        if FLOAT_HOME_GEN.load(Ordering::SeqCst) != gen {
                            return;
                        }
                        let app_end = app.clone();
                        let app_for_end = app.clone();
                        let _ = app_end.run_on_main_thread(move || {
                            if FLOAT_HOME_GEN.load(Ordering::SeqCst) != gen {
                                return;
                            }
                            if let Some(win) = app_for_end.get_webview_window("main") {
                                let _ = win.set_always_on_top(true);
                                macos_spaces::pin_to_all_spaces(&win);
                            }
                            let _ = app_for_end.emit("pet-tray", "dock-center-done");
                        });
                    });
                    return Ok(());
                }
            }
        }
    }

    // Fallback (non-macOS): stepped float
    float_window_to_center_stepped(app, end_w_logical, end_h_logical)
}

fn float_window_to_center_stepped(
    app: tauri::AppHandle,
    end_w_logical: f64,
    end_h_logical: f64,
) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window missing".to_string())?;

    let factor = window.scale_factor().map_err(|e| e.to_string())?;
    let end_w = (end_w_logical * factor).round();
    let end_h = (end_h_logical * factor).round();

    let mon = window
        .current_monitor()
        .map_err(|e| e.to_string())?
        .or(window.primary_monitor().map_err(|e| e.to_string())?)
        .ok_or_else(|| "no monitor".to_string())?;

    let mp = mon.position();
    let ms = mon.size();
    let end_x = mp.x as f64 + (ms.width as f64 - end_w) * 0.5;
    let end_y = mp.y as f64 + (ms.height as f64 - end_h) * 0.5;

    let pos = window.outer_position().map_err(|e| e.to_string())?;
    let size = window.outer_size().map_err(|e| e.to_string())?;
    let start_x = pos.x as f64;
    let start_y = pos.y as f64;
    let start_w = size.width as f64;
    let start_h = size.height as f64;

    let gen = FLOAT_HOME_GEN.fetch_add(1, Ordering::SeqCst) + 1;
    let steps = 48u32;
    let step_ms = 18u64;

    std::thread::spawn(move || {
        for i in 1..=steps {
            if FLOAT_HOME_GEN.load(Ordering::SeqCst) != gen {
                return;
            }
            let t = ease_out_cubic(i as f64 / steps as f64);
            let x = lerp_f64(start_x, end_x, t).round() as i32;
            let y = lerp_f64(start_y, end_y, t).round() as i32;
            let w = lerp_f64(start_w, end_w, t).round().max(1.0) as u32;
            let h = lerp_f64(start_h, end_h, t).round().max(1.0) as u32;
            let app_step = app.clone();
            let app_for_win = app.clone();
            let _ = app_step.run_on_main_thread(move || {
                if FLOAT_HOME_GEN.load(Ordering::SeqCst) != gen {
                    return;
                }
                if let Some(win) = app_for_win.get_webview_window("main") {
                    let _ = win.set_size(tauri::PhysicalSize::new(w, h));
                    let _ = win.set_position(PhysicalPosition::new(x, y));
                }
            });
            std::thread::sleep(Duration::from_millis(step_ms));
        }
        if FLOAT_HOME_GEN.load(Ordering::SeqCst) != gen {
            return;
        }
        let app_end = app.clone();
        let app_for_end = app.clone();
        let _ = app_end.run_on_main_thread(move || {
            if FLOAT_HOME_GEN.load(Ordering::SeqCst) != gen {
                return;
            }
            if let Some(win) = app_for_end.get_webview_window("main") {
                let _ = win.set_size(tauri::PhysicalSize::new(end_w as u32, end_h as u32));
                let _ = win.set_position(PhysicalPosition::new(
                    end_x.round() as i32,
                    end_y.round() as i32,
                ));
            }
            let _ = app_for_end.emit("pet-tray", "dock-center-done");
        });
    });

    Ok(())
}

/// Resize window for pet-only or pet+chat layout (logical pixels).
#[tauri::command]
fn set_pet_layout(app: tauri::AppHandle, chat_open: bool) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window missing".to_string())?;

    let (w, h) = if chat_open {
        // Full-size lightstick + messages + input (pet no longer scaled down)
        (360.0, 760.0)
    } else {
        // Tall enough to show entire lightstick (head + handle)
        (190.0, 280.0)
    };
    window
        .set_size(LogicalSize::new(w, h))
        .map_err(|e| e.to_string())?;

    #[cfg(target_os = "macos")]
    macos_spaces::pin_to_all_spaces(&window);

    Ok(())
}

/// One event from the lightstick schedule → Apple Calendar “BAA”.
#[derive(serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct BaaCalEvent {
    id: String,
    /// YYYY-MM-DD
    date: String,
    title: String,
    #[serde(default)]
    time: Option<String>,
    #[serde(default)]
    note: Option<String>,
    #[serde(default)]
    category: Option<String>,
}

/// Sync schedule into a dedicated Apple Calendar named **BAA** (not Family).
/// iCloud then shows those events on iPhone under calendar “BAA”.
#[tauri::command]
fn sync_apple_calendar(events: Vec<BaaCalEvent>) -> Result<usize, String> {
    #[cfg(target_os = "macos")]
    {
        let events = resolve_baa_events(events)?;
        // Ensure Calendar.app is running so AppleScript can talk to it
        let _ = std::process::Command::new("open")
            .args(["-ga", "Calendar"])
            .status();
        std::thread::sleep(std::time::Duration::from_millis(400));
        sync_baa_calendar_macos(&events)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = events;
        Err("Apple Calendar sync is only available on macOS".into())
    }
}

#[cfg(target_os = "macos")]
fn sync_baa_calendar_macos(events: &[BaaCalEvent]) -> Result<usize, String> {
    fn esc(s: &str) -> String {
        s.replace('\\', "\\\\").replace('"', "\\\"")
    }

    fn parse_hhmm(time: &Option<String>) -> Option<(u32, u32)> {
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

    // Create/use calendar "BAA" (prefer non-Family account), clear it, re-add events.
    // Also strip prior BAA-tagged leftovers from the Family calendar.
    let mut script = String::from(
        r#"tell application "Calendar"
  set calName to "BAA"

  -- Remove old lightstick imports that landed on Family via .ics AirDrop
  try
    repeat with famCal in (every calendar whose name is "Family")
      try
        set famEvents to every event of famCal
        repeat with ev in famEvents
          try
            set d to description of ev as string
            if d contains "[BAA id:" then
              delete ev
            end if
          end try
        end repeat
      end try
    end repeat
  end try

  -- Prefer an existing BAA calendar that is not under a Family-named account
  set cal to missing value
  try
    repeat with c in (every calendar whose name is calName)
      try
        set accName to ""
        try
          set accName to (name of account of c) as string
        end try
        if accName does not contain "Family" then
          set cal to c
          exit repeat
        end if
      end try
    end repeat
  end try

  if cal is missing value then
    set cals to every calendar whose name is calName
    if (count of cals) > 0 then
      set cal to item 1 of cals
    else
      -- Create BAA on a non-Family account when Calendar exposes accounts
      set created to false
      try
        repeat with acc in every account
          try
            set accName to (name of acc) as string
            if accName does not contain "Family" and accName does not contain "Subscribed" and accName does not contain "Other" then
              set cal to make new calendar at end of calendars of acc with properties {name:calName}
              set created to true
              exit repeat
            end if
          end try
        end repeat
      end try
      if created is false then
        set cal to make new calendar with properties {name:calName}
      end if
    end if
  end if

  try
    delete (every event of cal)
  end try
"#,
    );

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

        let title = esc(&e.title);
        let mut desc = String::new();
        if let Some(c) = e.category.as_deref().filter(|s| !s.is_empty()) {
            desc.push_str(&format!("BAA · {c}"));
        }
        if let Some(note) = e.note.as_deref().filter(|s| !s.is_empty()) {
            if !desc.is_empty() {
                desc.push_str("\n");
            }
            desc.push_str(note);
        }
        // Stable tag so we never mix with Family / other calendars
        if !desc.is_empty() {
            desc.push_str("\n");
        }
        desc.push_str(&format!("[BAA id:{}]", e.id));
        let desc = esc(&desc);

        let (h, m, all_day) = match parse_hhmm(&e.time) {
            Some((h, m)) => (h, m, false),
            None => (0, 0, true),
        };
        let (eh, em) = if all_day {
            (0, 0)
        } else {
            let end_h = h + 1;
            if end_h >= 24 {
                (end_h - 24, m)
            } else {
                (end_h, m)
            }
        };

        // AppleScript months are named constants (January…), not bare integers
        let month_name = match mo {
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
            _ => continue,
        };

        if all_day {
            script.push_str(&format!(
                r#"
  set startDate to current date
  set year of startDate to {y}
  set month of startDate to {month_name}
  set day of startDate to {d}
  set hours of startDate to 0
  set minutes of startDate to 0
  set seconds of startDate to 0
  set endDate to startDate + (1 * days)
  tell cal
    make new event with properties {{summary:"{title}", start date:startDate, end date:endDate, allday event:true, description:"{desc}"}}
  end tell
"#,
            ));
        } else {
            script.push_str(&format!(
                r#"
  set startDate to current date
  set year of startDate to {y}
  set month of startDate to {month_name}
  set day of startDate to {d}
  set hours of startDate to {h}
  set minutes of startDate to {m}
  set seconds of startDate to 0
  set endDate to startDate + (1 * hours)
  tell cal
    make new event with properties {{summary:"{title}", start date:startDate, end date:endDate, allday event:false, description:"{desc}"}}
  end tell
"#,
            ));
        }
        n += 1;
    }

    script.push_str("\nend tell\n");

    let status = std::process::Command::new("osascript")
        .arg("-e")
        .arg(&script)
        .output()
        .map_err(|e| format!("osascript failed: {e}"))?;

    if !status.status.success() {
        let err = String::from_utf8_lossy(&status.stderr);
        let out = String::from_utf8_lossy(&status.stdout);
        return Err(format!(
            "Calendar sync failed (allow BAA in System Settings → Privacy → Automation / Calendars). {err} {out}"
        ));
    }

    Ok(n)
}

/// Build iCalendar text from lightstick events (AirDrop payload).
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
        // Tip shown in event notes on iPhone after import
        desc.push_str("\nImport tip: choose calendar BAA (not Family).");
        out.push_str(&format!("DESCRIPTION:{}\r\n", esc(&desc)));
        if let Some((h, m)) = parse_hhmm(&e.time) {
            let start = format!("{date}T{h:02}{m:02}00");
            let end_h = h + 1;
            let (ed, eh) = if end_h >= 24 {
                (next_day(&date), end_h - 24)
            } else {
                (date.clone(), end_h)
            };
            let end = format!("{ed}T{eh:02}{m:02}00");
            out.push_str(&format!("DTSTART:{start}\r\nDTEND:{end}\r\n"));
        } else {
            out.push_str(&format!("DTSTART;VALUE=DATE:{date}\r\n"));
            out.push_str(&format!(
                "DTEND;VALUE=DATE:{}\r\n",
                next_day(&date)
            ));
        }
        out.push_str("END:VEVENT\r\n");
    }
    out.push_str("END:VCALENDAR\r\n");
    out
}

/// Prefer disk schedule (shared across windows) when the frontend payload is empty/stale.
fn resolve_baa_events(events: Vec<BaaCalEvent>) -> Result<Vec<BaaCalEvent>, String> {
    if !events.is_empty() {
        return Ok(events);
    }
    let disk = schedule_store::load_schedule()?;
    if disk.is_empty() {
        return Err("No events to share — add plans in Calendar first".into());
    }
    Ok(disk
        .into_iter()
        .map(|e| BaaCalEvent {
            id: e.id,
            date: e.date,
            title: e.title,
            time: e.time,
            note: e.note,
            category: e.category,
        })
        .collect())
}

/// AirDrop the lightstick schedule as `BAA.ics`.
/// Best-effort also mirrors events into Apple Calendar “BAA” (does not block share).
#[tauri::command]
fn airdrop_baa_calendar(
    app: tauri::AppHandle,
    events: Vec<BaaCalEvent>,
) -> Result<String, String> {
    let events = resolve_baa_events(events)?;
    let n = events.len();

    // Best-effort iCloud calendar mirror (ignore automation errors — Calendar may be closed)
    let synced = sync_apple_calendar(events.clone()).unwrap_or(0);

    let ics = build_ics_from_events(&events);
    let dir = std::env::temp_dir().join("baa-airdrop");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("BAA.ics");
    std::fs::write(&path, ics.as_bytes()).map_err(|e| e.to_string())?;

    #[cfg(target_os = "macos")]
    {
        share_file_airdrop(&app, &path)?;
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        return Err("AirDrop is only available on macOS".into());
    }

    Ok(format!(
        "AirDrop sheet opened ({n} events). Pick your iPhone → open BAA.ics → calendar “BAA” (not Family).{}",
        if synced > 0 {
            format!(" Also synced {synced} to Mac calendar BAA.")
        } else {
            String::new()
        }
    ))
}

/// AirDrop raw .ics text (legacy).
#[tauri::command]
fn airdrop_ics(app: tauri::AppHandle, contents: String) -> Result<String, String> {
    if contents.trim().is_empty() {
        return Err("Calendar file is empty".into());
    }
    let dir = std::env::temp_dir().join("baa-airdrop");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("BAA.ics");
    std::fs::write(&path, contents.as_bytes()).map_err(|e| e.to_string())?;

    #[cfg(target_os = "macos")]
    {
        share_file_airdrop(&app, &path)?;
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        return Err("AirDrop is only available on macOS".into());
    }

    Ok(path.display().to_string())
}

/// Share a file via AirDrop (main-thread AppKit). Falls back to Finder + open.
#[cfg(target_os = "macos")]
fn share_file_airdrop(app: &tauri::AppHandle, path: &std::path::Path) -> Result<(), String> {
    let path_buf = path.to_path_buf();
    let path_display = path.display().to_string();

    // Prefer main-thread AppKit (required for NSSharingService).
    let (tx, rx) = std::sync::mpsc::channel::<Result<(), String>>();
    let sent = app
        .run_on_main_thread(move || {
            let r = unsafe { airdrop_perform(&path_buf) };
            let _ = tx.send(r);
        })
        .is_ok();

    let result = if sent {
        // Share sheet can take a moment to appear — don't fall back too early
        // from a non-main thread (that path usually fails).
        rx.recv_timeout(std::time::Duration::from_secs(12))
            .unwrap_or_else(|_| Err("AirDrop timed out waiting for share UI".into()))
    } else {
        Err("Could not schedule AirDrop on main thread".into())
    };

    match result {
        Ok(()) => Ok(()),
        Err(e) => {
            // Fallbacks so the user always gets a usable .ics
            let _ = std::process::Command::new("open")
                .args(["-R", &path_display])
                .status();
            // Also try opening the file (Calendar import on Mac)
            let _ = std::process::Command::new("open").arg(&path_display).status();
            Err(format!(
                "{e}\n\nBAA.ics is open in Finder — select it → Share → AirDrop.\n\
Or open BAA.ics on this Mac to import into Calendar."
            ))
        }
    }
}

/// Direct AirDrop via NSSharingService (must run on main thread).
#[cfg(target_os = "macos")]
unsafe fn airdrop_perform(path: &std::path::Path) -> Result<(), String> {
    use objc2::msg_send;
    use objc2::runtime::{AnyClass, AnyObject};
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;

    // Absolute path (required for reliable fileURLWithPath)
    let abs = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let path_bytes = abs.as_os_str().as_bytes();
    let path_c = CString::new(path_bytes).map_err(|_| "invalid path".to_string())?;
    let airdrop_name = CString::new("com.apple.share.AirDrop.send").unwrap();

    let ns_string = AnyClass::get(c"NSString").ok_or("NSString missing")?;
    let ns_url = AnyClass::get(c"NSURL").ok_or("NSURL missing")?;
    let ns_array = AnyClass::get(c"NSArray").ok_or("NSArray missing")?;
    let share_cls = AnyClass::get(c"NSSharingService").ok_or("NSSharingService missing")?;
    let ns_app = AnyClass::get(c"NSApplication").ok_or("NSApplication missing")?;

    // Bring BAA to front so the share sheet is not hidden behind always-on-top chrome
    let app: *mut AnyObject = msg_send![ns_app, sharedApplication];
    if !app.is_null() {
        let _: () = msg_send![app, activateIgnoringOtherApps: true];
    }

    let path_ns: *mut AnyObject = msg_send![ns_string, stringWithUTF8String: path_c.as_ptr()];
    if path_ns.is_null() {
        return Err("NSString path failed".into());
    }
    let file_url: *mut AnyObject = msg_send![ns_url, fileURLWithPath: path_ns];
    if file_url.is_null() {
        return Err("file URL failed".into());
    }
    let items: *mut AnyObject = msg_send![ns_array, arrayWithObject: file_url];
    if items.is_null() {
        return Err("NSArray items failed".into());
    }
    let name_ns: *mut AnyObject =
        msg_send![ns_string, stringWithUTF8String: airdrop_name.as_ptr()];
    let service: *mut AnyObject = msg_send![share_cls, sharingServiceNamed: name_ns];
    if service.is_null() {
        return Err("AirDrop service unavailable on this Mac".into());
    }

    // Prefer canPerform when available (skips silent no-ops)
    let can: bool = msg_send![service, canPerformWithItems: items];
    if !can {
        // Still try perform — canPerform is flaky for some file types / policies
    }

    let _: () = msg_send![service, performWithItems: items];
    Ok(())
}

/// Manually re-bind window(s) to all Spaces (callable from frontend).
/// Pins main + chat (if open).
#[tauri::command]
fn pin_to_all_spaces_cmd(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        macos_spaces::pin_main(&app);
        if let Some(chat) = app.get_webview_window("chat") {
            macos_spaces::pin_to_all_spaces(&chat);
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        for label in ["main", "chat"] {
            if let Some(w) = app.get_webview_window(label) {
                let _ = w.set_visible_on_all_workspaces(true);
                let _ = w.set_always_on_top(true);
            }
        }
    }

    Ok(())
}

#[tauri::command]
fn get_config() -> Result<config::AppConfig, String> {
    config::load_config()
}

#[tauri::command]
fn save_config(cfg: config::AppConfig) -> Result<(), String> {
    config::save_config(&cfg)
}

/// Resize keeping the bottom-center of the window fixed.
/// `width` / `height` are logical CSS pixels (same as PET_W / CHAT_H etc.).
/// On macOS uses a single NSWindow `setFrame:display:` so there is no
/// intermediate size/position frame (that was the chat / menu vanish flash).
#[tauri::command]
fn resize_bottom_center(app: tauri::AppHandle, width: f64, height: f64) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window missing".to_string())?;

    #[cfg(target_os = "macos")]
    {
        if let Ok(ptr) = window.ns_window() {
            if !ptr.is_null() {
                unsafe {
                    ns_set_frame_bottom_center(ptr, width, height)?;
                }
                return Ok(());
            }
        }
    }

    // Fallback: two-step Tauri API (non-macOS or ns_window unavailable)
    let factor = window.scale_factor().map_err(|e| e.to_string())?;
    let new_w = (width * factor).round() as u32;
    let new_h = (height * factor).round() as u32;
    let pos = window.outer_position().map_err(|e| e.to_string())?;
    let size = window.outer_size().map_err(|e| e.to_string())?;
    let bottom = pos.y as i64 + size.height as i64;
    let center_x = pos.x as i64 + size.width as i64 / 2;
    let x = (center_x - new_w as i64 / 2) as i32;
    let y = (bottom - new_h as i64) as i32;
    window
        .set_size(tauri::PhysicalSize::new(new_w, new_h))
        .map_err(|e| e.to_string())?;
    window
        .set_position(PhysicalPosition::new(x, y))
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Smart panel dock: "top" | "bottom" | "left" | "right".
/// Pet anchor stays fixed — never clamps/shifts the entity.
#[tauri::command]
fn resize_panel_dock(
    app: tauri::AppHandle,
    dock: String,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window missing".to_string())?;

    let dock = match dock.as_str() {
        "bottom" => "bottom",
        "left" => "left",
        "right" => "right",
        _ => "top",
    };

    #[cfg(target_os = "macos")]
    {
        if let Ok(ptr) = window.ns_window() {
            if !ptr.is_null() {
                unsafe {
                    ns_set_frame_panel_dock(ptr, dock, width, height)?;
                }
                return Ok(());
            }
        }
    }

    // Generic fallback — pet strip location depends on dock
    let factor = window.scale_factor().map_err(|e| e.to_string())?;
    let new_w = (width * factor).round() as i32;
    let new_h = (height * factor).round() as i32;
    let pos = window.outer_position().map_err(|e| e.to_string())?;
    let size = window.outer_size().map_err(|e| e.to_string())?;
    let pet_w = (190.0 * factor).round() as i32;
    let pet_h = (280.0 * factor).round() as i32;
    let sw = size.width as i32;
    let sh = size.height as i32;
    let compact = sw <= pet_w + 8 && sh <= pet_h + 8;

    // Pet screen rect (top-left coords)
    let (pet_left, pet_top, pet_right, pet_bottom, pet_cx) = if compact {
        (
            pos.x,
            pos.y,
            pos.x + sw,
            pos.y + sh,
            pos.x + sw / 2,
        )
    } else {
        match dock {
            // Pet at TOP of window when panel is below
            "bottom" => (
                pos.x + (sw - pet_w) / 2,
                pos.y,
                pos.x + (sw + pet_w) / 2,
                pos.y + pet_h,
                pos.x + sw / 2,
            ),
            "right" => (pos.x, pos.y + sh - pet_h, pos.x + pet_w, pos.y + sh, pos.x + pet_w / 2),
            "left" => (
                pos.x + sw - pet_w,
                pos.y + sh - pet_h,
                pos.x + sw,
                pos.y + sh,
                pos.x + sw - pet_w / 2,
            ),
            // top: pet at bottom
            _ => (
                pos.x + (sw - pet_w) / 2,
                pos.y + sh - pet_h,
                pos.x + (sw + pet_w) / 2,
                pos.y + sh,
                pos.x + sw / 2,
            ),
        }
    };

    let (x, y) = match dock {
        "bottom" => (pet_cx - new_w / 2, pet_top),
        "right" => (pet_left, pet_bottom - new_h),
        "left" => (pet_right - new_w, pet_bottom - new_h),
        _ => (pet_cx - new_w / 2, pet_bottom - new_h),
    };

    window
        .set_size(tauri::PhysicalSize::new(new_w as u32, new_h as u32))
        .map_err(|e| e.to_string())?;
    window
        .set_position(PhysicalPosition::new(x, y))
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Sideways expand (same height). Returns "left" | "right".
/// Optional `side` locks grow direction; optional `width` is total logical width
/// (default 358 = pet + menu panel).
#[tauri::command]
fn resize_menu_side(
    app: tauri::AppHandle,
    side: Option<String>,
    width: Option<f64>,
    height: Option<f64>,
) -> Result<String, String> {
    // Stop any float-home animation so it can't fight this expand (wake jitter)
    FLOAT_HOME_GEN.fetch_add(1, Ordering::SeqCst);

    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window missing".to_string())?;

    let want_side = side.as_deref().filter(|s| *s == "left" || *s == "right");
    // PET_W 190 + MENU_PANEL 168 = 358 by default; height follows pet zoom
    let total_w = width.filter(|w| *w >= 120.0 && *w <= 900.0).unwrap_or(358.0);
    let total_h = height.filter(|h| *h >= 180.0 && *h <= 600.0).unwrap_or(280.0);

    #[cfg(target_os = "macos")]
    {
        if let Ok(ptr) = window.ns_window() {
            if !ptr.is_null() {
                let chosen =
                    unsafe { ns_set_frame_menu_side(ptr, total_w, total_h, want_side)? };
                return Ok(chosen);
            }
        }
    }

    let factor = window.scale_factor().map_err(|e| e.to_string())?;
    let new_w = (total_w * factor).round() as u32;
    let new_h = (total_h * factor).round() as u32;
    let pos = window.outer_position().map_err(|e| e.to_string())?;
    let size = window.outer_size().map_err(|e| e.to_string())?;
    let mon = window.current_monitor().map_err(|e| e.to_string())?;
    let right_space = if let Some(m) = mon {
        let mp = m.position();
        let ms = m.size();
        (mp.x as i64 + ms.width as i64) - (pos.x as i64 + size.width as i64)
    } else {
        i64::MAX
    };
    let need = new_w as i64 - size.width as i64;
    let grow_right = match want_side {
        Some("left") => false,
        Some("right") => true,
        _ => right_space >= need - 2,
    };
    let bottom = pos.y as i64 + size.height as i64;
    let (x, y, out) = if grow_right {
        (pos.x, (bottom - new_h as i64) as i32, "right")
    } else {
        (
            (pos.x as i64 + size.width as i64 - new_w as i64) as i32,
            (bottom - new_h as i64) as i32,
            "left",
        )
    };
    window
        .set_size(tauri::PhysicalSize::new(new_w, new_h))
        .map_err(|e| e.to_string())?;
    window
        .set_position(PhysicalPosition::new(x, y))
        .map_err(|e| e.to_string())?;
    Ok(out.to_string())
}

/// Collapse menu window back to pet size, keeping pet strip fixed.
#[tauri::command]
fn collapse_menu_side(
    app: tauri::AppHandle,
    menu_side: String,
    width: Option<f64>,
    height: Option<f64>,
) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window missing".to_string())?;

    let pet_w = width.filter(|w| *w >= 100.0 && *w <= 500.0).unwrap_or(190.0);
    let pet_h = height.filter(|h| *h >= 140.0 && *h <= 600.0).unwrap_or(280.0);

    #[cfg(target_os = "macos")]
    {
        if let Ok(ptr) = window.ns_window() {
            if !ptr.is_null() {
                unsafe {
                    ns_collapse_menu_side(ptr, pet_w, pet_h, &menu_side)?;
                }
                return Ok(());
            }
        }
    }

    let factor = window.scale_factor().map_err(|e| e.to_string())?;
    let new_w = (pet_w * factor).round() as u32;
    let new_h = (pet_h * factor).round() as u32;
    let pos = window.outer_position().map_err(|e| e.to_string())?;
    let size = window.outer_size().map_err(|e| e.to_string())?;
    let bottom = pos.y as i64 + size.height as i64;
    let x = if menu_side == "left" {
        (pos.x as i64 + size.width as i64 - new_w as i64) as i32
    } else {
        pos.x
    };
    let y = (bottom - new_h as i64) as i32;
    window
        .set_size(tauri::PhysicalSize::new(new_w, new_h))
        .map_err(|e| e.to_string())?;
    window
        .set_position(PhysicalPosition::new(x, y))
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ─── macOS atomic frame (single setFrame — no flash) ─────────────────────────

#[cfg(target_os = "macos")]
#[repr(C)]
#[derive(Clone, Copy)]
struct NsPoint {
    x: f64,
    y: f64,
}

#[cfg(target_os = "macos")]
#[repr(C)]
#[derive(Clone, Copy)]
struct NsSize {
    width: f64,
    height: f64,
}

#[cfg(target_os = "macos")]
#[repr(C)]
#[derive(Clone, Copy)]
struct NsRect {
    origin: NsPoint,
    size: NsSize,
}

#[cfg(target_os = "macos")]
unsafe impl objc2::encode::Encode for NsPoint {
    const ENCODING: objc2::encode::Encoding = objc2::encode::Encoding::Struct(
        "CGPoint",
        &[f64::ENCODING, f64::ENCODING],
    );
}

#[cfg(target_os = "macos")]
unsafe impl objc2::encode::Encode for NsSize {
    const ENCODING: objc2::encode::Encoding = objc2::encode::Encoding::Struct(
        "CGSize",
        &[f64::ENCODING, f64::ENCODING],
    );
}

#[cfg(target_os = "macos")]
unsafe impl objc2::encode::Encode for NsRect {
    const ENCODING: objc2::encode::Encoding = objc2::encode::Encoding::Struct(
        "CGRect",
        &[NsPoint::ENCODING, NsSize::ENCODING],
    );
}

/// Atomic frame set. Cocoa origin is bottom-left; keeping origin.y fixed anchors the bottom.
#[cfg(target_os = "macos")]
unsafe fn ns_set_frame(ns_window: *mut std::ffi::c_void, frame: NsRect) -> Result<(), String> {
    use objc2::msg_send;
    use objc2::runtime::{AnyClass, AnyObject};

    let obj = ns_window as *mut AnyObject;
    if obj.is_null() {
        return Err("null ns_window".into());
    }

    // Zero-duration animation context + non-animated setFrame so AppKit does not
    // paint intermediate frames (the classic transparent-window flash).
    if let Some(ctx_cls) = AnyClass::get(c"NSAnimationContext") {
        let _: () = msg_send![ctx_cls, beginGrouping];
        let ctx: *mut AnyObject = msg_send![ctx_cls, currentContext];
        if !ctx.is_null() {
            let _: () = msg_send![ctx, setDuration: 0.0f64];
            let _: () = msg_send![ctx, setAllowsImplicitAnimation: false];
        }
        let _: () = msg_send![obj, setFrame: frame, display: true, animate: false];
        let _: () = msg_send![ctx_cls, endGrouping];
    } else {
        let _: () = msg_send![obj, setFrame: frame, display: true, animate: false];
    }
    Ok(())
}

#[cfg(target_os = "macos")]
unsafe fn ns_get_frame(ns_window: *mut std::ffi::c_void) -> Result<NsRect, String> {
    use objc2::msg_send;
    use objc2::runtime::AnyObject;

    let obj = ns_window as *mut AnyObject;
    if obj.is_null() {
        return Err("null ns_window".into());
    }
    let frame: NsRect = msg_send![obj, frame];
    Ok(frame)
}

/// Cocoa: animate NSWindow frame to centered size (points = logical CSS px).
/// Single continuous animator setFrame — no per-step resize jitter.
#[cfg(target_os = "macos")]
unsafe fn ns_animate_frame_to_center(
    ns_window: *mut std::ffi::c_void,
    width_pts: f64,
    height_pts: f64,
    duration: f64,
) -> Result<(), String> {
    use objc2::msg_send;
    use objc2::runtime::{AnyClass, AnyObject};

    let obj = ns_window as *mut AnyObject;
    if obj.is_null() {
        return Err("null ns_window".into());
    }

    // Prefer the window's current screen visibleFrame (Dock-safe)
    let screen: *mut AnyObject = msg_send![obj, screen];
    let visible: NsRect = if !screen.is_null() {
        msg_send![screen, visibleFrame]
    } else {
        msg_send![obj, frame]
    };

    let end = NsRect {
        origin: NsPoint {
            x: visible.origin.x + (visible.size.width - width_pts) * 0.5,
            y: visible.origin.y + (visible.size.height - height_pts) * 0.5,
        },
        size: NsSize {
            width: width_pts,
            height: height_pts,
        },
    };

    // Implicit animation via [window animator]
    if let Some(ctx_cls) = AnyClass::get(c"NSAnimationContext") {
        let _: () = msg_send![ctx_cls, beginGrouping];
        let ctx: *mut AnyObject = msg_send![ctx_cls, currentContext];
        if !ctx.is_null() {
            let _: () = msg_send![ctx, setDuration: duration];
            let _: () = msg_send![ctx, setAllowsImplicitAnimation: true];
        }
        let animator: *mut AnyObject = msg_send![obj, animator];
        if !animator.is_null() {
            let _: () = msg_send![animator, setFrame: end, display: true];
        } else {
            let _: () = msg_send![obj, setFrame: end, display: true];
        }
        let _: () = msg_send![ctx_cls, endGrouping];
    } else {
        let _: () = msg_send![obj, setFrame: end, display: true, animate: true];
    }
    Ok(())
}

/// Grow/shrink keeping bottom-center fixed (Cocoa y = bottom edge stays put).
#[cfg(target_os = "macos")]
unsafe fn ns_set_frame_bottom_center(
    ns_window: *mut std::ffi::c_void,
    width_pts: f64,
    height_pts: f64,
) -> Result<(), String> {
    let cur = ns_get_frame(ns_window)?;
    // Already correct size/anchor → skip setFrame (avoids transparent afterimage)
    if (cur.size.width - width_pts).abs() < 0.75
        && (cur.size.height - height_pts).abs() < 0.75
    {
        return Ok(());
    }
    let center_x = cur.origin.x + cur.size.width * 0.5;
    let bottom_y = cur.origin.y;
    let frame = NsRect {
        origin: NsPoint {
            x: center_x - width_pts * 0.5,
            y: bottom_y,
        },
        size: NsSize {
            width: width_pts,
            height: height_pts,
        },
    };
    ns_set_frame(ns_window, frame)
}

/// Smart dock resize — pet strip fixed on screen for open AND close.
/// Cocoa coords: origin at bottom-left; higher y = higher on screen.
#[cfg(target_os = "macos")]
unsafe fn ns_set_frame_panel_dock(
    ns_window: *mut std::ffi::c_void,
    dock: &str,
    width_pts: f64,
    height_pts: f64,
) -> Result<(), String> {
    let cur = ns_get_frame(ns_window)?;
    let pet_w = 190.0_f64;
    let pet_h = 280.0_f64;
    let cw = cur.size.width;
    let ch = cur.size.height;
    let compact = cw <= pet_w + 8.0 && ch <= pet_h + 8.0;

    // Pet rect in cocoa (origin = bottom-left of pet)
    let (pet_left, pet_bottom, pet_right, pet_top, pet_cx) = if compact {
        (
            cur.origin.x,
            cur.origin.y,
            cur.origin.x + cw,
            cur.origin.y + ch,
            cur.origin.x + cw * 0.5,
        )
    } else {
        match dock {
            // Panel below → pet is TOP strip of window
            "bottom" => {
                let top = cur.origin.y + ch;
                let bottom = top - pet_h;
                (
                    cur.origin.x + (cw - pet_w) * 0.5,
                    bottom,
                    cur.origin.x + (cw + pet_w) * 0.5,
                    top,
                    cur.origin.x + cw * 0.5,
                )
            }
            // Panel on right → pet LEFT strip, bottom-aligned
            "right" => (
                cur.origin.x,
                cur.origin.y,
                cur.origin.x + pet_w,
                cur.origin.y + pet_h.min(ch),
                cur.origin.x + pet_w * 0.5,
            ),
            // Panel on left → pet RIGHT strip
            "left" => (
                cur.origin.x + cw - pet_w,
                cur.origin.y,
                cur.origin.x + cw,
                cur.origin.y + pet_h.min(ch),
                cur.origin.x + cw - pet_w * 0.5,
            ),
            // top: pet BOTTOM strip
            _ => (
                cur.origin.x + (cw - pet_w) * 0.5,
                cur.origin.y,
                cur.origin.x + (cw + pet_w) * 0.5,
                cur.origin.y + pet_h.min(ch),
                cur.origin.x + cw * 0.5,
            ),
        }
    };

    let (x, y) = match dock {
        "bottom" => {
            // Keep pet top fixed: window top = pet_top → origin.y = pet_top - height
            (pet_cx - width_pts * 0.5, pet_top - height_pts)
        }
        "right" => {
            // Keep pet left + bottom
            (pet_left, pet_bottom)
        }
        "left" => {
            // Keep pet right + bottom
            (pet_right - width_pts, pet_bottom)
        }
        _ => {
            // top: keep pet bottom-center
            (pet_cx - width_pts * 0.5, pet_bottom)
        }
    };

    let frame = NsRect {
        origin: NsPoint { x, y },
        size: NsSize {
            width: width_pts,
            height: height_pts,
        },
    };
    ns_set_frame(ns_window, frame)
}

/// Sideways expand. `want_side`: Some("left"|"right") or None for auto.
/// Returns the side the menu panel ends up on.
#[cfg(target_os = "macos")]
unsafe fn ns_set_frame_menu_side(
    ns_window: *mut std::ffi::c_void,
    width_pts: f64,
    height_pts: f64,
    want_side: Option<&str>,
) -> Result<String, String> {
    use objc2::msg_send;
    use objc2::runtime::AnyObject;

    let cur = ns_get_frame(ns_window)?;
    let obj = ns_window as *mut AnyObject;

    // Visible frame of the screen that contains this window (points).
    let screen: *mut AnyObject = msg_send![obj, screen];
    let grow_right = match want_side {
        Some("left") => false,
        Some("right") => true,
        _ => {
            if !screen.is_null() {
                let vf: NsRect = msg_send![screen, visibleFrame];
                let right_edge = cur.origin.x + cur.size.width;
                let right_space = (vf.origin.x + vf.size.width) - right_edge;
                let need = width_pts - cur.size.width;
                right_space >= need - 2.0
            } else {
                true
            }
        }
    };

    // Already correct size → skip setFrame (avoids transparent afterimage on wake)
    if (cur.size.width - width_pts).abs() < 0.75
        && (cur.size.height - height_pts).abs() < 0.75
    {
        return Ok(if grow_right { "right" } else { "left" }.to_string());
    }

    let frame = if grow_right {
        // Keep left + bottom fixed; grow right
        NsRect {
            origin: NsPoint {
                x: cur.origin.x,
                y: cur.origin.y,
            },
            size: NsSize {
                width: width_pts,
                height: height_pts,
            },
        }
    } else {
        // Keep right + bottom fixed; grow left
        NsRect {
            origin: NsPoint {
                x: cur.origin.x + cur.size.width - width_pts,
                y: cur.origin.y,
            },
            size: NsSize {
                width: width_pts,
                height: height_pts,
            },
        }
    };
    ns_set_frame(ns_window, frame)?;
    Ok(if grow_right { "right" } else { "left" }.to_string())
}

#[cfg(target_os = "macos")]
unsafe fn ns_collapse_menu_side(
    ns_window: *mut std::ffi::c_void,
    width_pts: f64,
    height_pts: f64,
    menu_side: &str,
) -> Result<(), String> {
    let cur = ns_get_frame(ns_window)?;
    // menu_side = which side the panel was on (pet on the opposite strip)
    let x = if menu_side == "left" {
        // pet was on the right — keep right edge
        cur.origin.x + cur.size.width - width_pts
    } else {
        // pet was on the left — keep left edge
        cur.origin.x
    };
    let frame = NsRect {
        origin: NsPoint {
            x,
            y: cur.origin.y,
        },
        size: NsSize {
            width: width_pts,
            height: height_pts,
        },
    };
    ns_set_frame(ns_window, frame)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            hide_window,
            show_window,
            pause_pet,
            resume_pet,
            center_pet_on_screen,
            float_to_center_sized,
            quit_app,
            set_pet_layout,
            pin_to_all_spaces_cmd,
            airdrop_ics,
            airdrop_baa_calendar,
            sync_apple_calendar,
            resize_bottom_center,
            resize_panel_dock,
            resize_menu_side,
            collapse_menu_side,
            get_config,
            save_config,
            schedule_store::load_schedule,
            schedule_store::save_schedule,
            schedule_store::load_schedule_reminded,
            schedule_store::save_schedule_reminded,
            weather::fetch_weather_native,
            chat::chat_with_grok,
            chat::grok_auth_status,
            chat::login_grok,
            chat::logout_grok,
            companion::get_link_info,
            companion::push_phone_event,
            companion::refresh_link_token,
            companion::publish_schedule,
            companion::get_published_schedule,
        ])
        .setup(|app| {
            let _ = dotenvy::from_filename(".env");
            let _ = dotenvy::dotenv();

            // LAN companion for iPhone QR link (same Wi‑Fi)
            companion::start_server();

            // Regular app → appears in the macOS Dock (start / pause from there)
            #[cfg(target_os = "macos")]
            {
                let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);
                // Explicit Dock icon (rainbow flower from AppIcon.appiconset)
                set_macos_dock_icon();
            }

            // Menu bar tray + dock-friendly controls
            let resume_i =
                MenuItem::with_id(app, "resume", "Start / Resume BAA", true, None::<&str>)?;
            let pause_i = MenuItem::with_id(app, "pause", "Pause BAA", true, None::<&str>)?;
            let chat_i = MenuItem::with_id(app, "chat", "Chat", true, None::<&str>)?;
            let cal_i = MenuItem::with_id(app, "calendar", "Calendar", true, None::<&str>)?;
            let color_i = MenuItem::with_id(app, "color", "Light color", true, None::<&str>)?;
            let sep = PredefinedMenuItem::separator(app)?;
            let quit_i = MenuItem::with_id(app, "quit", "Quit BAA", true, None::<&str>)?;
            let menu = Menu::with_items(
                app,
                &[
                    &resume_i, &pause_i, &sep, &chat_i, &cal_i, &color_i, &sep, &quit_i,
                ],
            )?;

            let icon = app
                .default_window_icon()
                .cloned()
                .expect("missing default window icon");

            let _tray = TrayIconBuilder::new()
                .icon(icon.clone())
                .menu(&menu)
                .tooltip("BAA — Start / Pause from menu")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "resume" | "show" => {
                        show_main(app);
                        let _ = float_pet_to_center(app.clone());
                        let _ = app.emit("pet-tray", "dock-center");
                    }
                    "pause" | "hide" => {
                        hide_all_windows(app);
                        let _ = app.emit("pet-tray", "pause");
                    }
                    "chat" => {
                        show_main(app);
                        let _ = app.emit("pet-tray", "resume");
                        let _ = app.emit("pet-tray", "chat");
                    }
                    "calendar" => {
                        show_main(app);
                        let _ = app.emit("pet-tray", "resume");
                        let _ = app.emit("pet-tray", "calendar");
                    }
                    "color" => {
                        show_main(app);
                        let _ = app.emit("pet-tray", "resume");
                        let _ = app.emit("pet-tray", "color");
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .build(app)?;

            if let Some(window) = app.get_webview_window("main") {
                // Always show + pin so the stick is never “lost” after updates
                let _ = window.show();
                let _ = window.set_always_on_top(true);
                let _ = window.set_visible_on_all_workspaces(true);

                // Place bottom-right of the *current* monitor (include origin for multi-display)
                if let Ok(Some(monitor)) = window.current_monitor() {
                    let size = monitor.size();
                    let origin = monitor.position();
                    let scale = monitor.scale_factor();
                    let win_w = (190.0 * scale) as i32;
                    let win_h = (280.0 * scale) as i32;
                    let margin_x = (24.0 * scale) as i32;
                    let margin_y = (56.0 * scale) as i32; // leave room above Dock
                    let x = origin.x + size.width as i32 - win_w - margin_x;
                    let y = origin.y + size.height as i32 - win_h - margin_y;
                    let _ = window.set_position(PhysicalPosition::new(x, y));
                }
                // Float home once so the stick is always on-screen after updates
                // (also recovers multi-monitor / off-screen positions)
                let _ = float_pet_to_center(app.handle().clone());

                #[cfg(target_os = "macos")]
                {
                    macos_spaces::pin_to_all_spaces(&window);
                    macos_spaces::start_space_watcher(app.handle().clone());
                }
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| match event {
            tauri::RunEvent::Resumed => {
                #[cfg(target_os = "macos")]
                {
                    macos_spaces::pin_main(app_handle);
                    // Laptop / process resume — show weather moment on pet
                    let _ = app_handle.emit("system-wake", ());
                }
            }
            // Dock icon click while app already running → float lightstick home
            tauri::RunEvent::Reopen { .. } => {
                show_main(app_handle);
                let _ = float_pet_to_center(app_handle.clone());
                let _ = app_handle.emit("pet-tray", "dock-center");
            }
            _ => {}
        });
}

