//! Persistent schedule storage shared by all Tauri windows.
//! File: `~/Library/Application Support/BAA/schedule.json` (macOS)
//! (or platform config dir / BAA / schedule.json)

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleEventDto {
    pub id: String,
    /// YYYY-MM-DD start (or single day)
    pub date: String,
    /// Optional inclusive end YYYY-MM-DD for multi-day events
    #[serde(default)]
    pub end_date: Option<String>,
    pub title: String,
    #[serde(default)]
    pub time: Option<String>,
    /// Optional end time "HH:mm" (same day)
    #[serde(default)]
    pub end_time: Option<String>,
    #[serde(default)]
    pub note: Option<String>,
    /// "work" | "school" | "event" | "family" | "friends" (legacy: "other" → event)
    #[serde(default)]
    pub category: Option<String>,
    /// Default 0 so older clients / partial JSON still save
    #[serde(default)]
    pub created_at: u64,
}

/// Coerce a loose JSON value into ScheduleEventDto (nulls, missing fields OK).
fn dto_from_value(v: &serde_json::Value) -> Option<ScheduleEventDto> {
    let id = v.get("id")?.as_str()?.trim().to_string();
    let date = v
        .get("date")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    let title = v
        .get("title")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    if id.is_empty() || date.is_empty() || title.is_empty() {
        return None;
    }
    let opt_str = |key: &str| -> Option<String> {
        match v.get(key) {
            Some(serde_json::Value::String(s)) => {
                let t = s.trim();
                if t.is_empty() {
                    None
                } else {
                    Some(t.to_string())
                }
            }
            Some(serde_json::Value::Null) | None => None,
            Some(other) => {
                let t = other.to_string().trim().trim_matches('"').to_string();
                if t.is_empty() || t == "null" {
                    None
                } else {
                    Some(t)
                }
            }
        }
    };
    // Accept both camelCase and snake_case
    let end_date = opt_str("endDate").or_else(|| opt_str("end_date"));
    let time = opt_str("time");
    let end_time = opt_str("endTime").or_else(|| opt_str("end_time"));
    let note = opt_str("note");
    let category = opt_str("category");
    let created_at = v
        .get("createdAt")
        .or_else(|| v.get("created_at"))
        .and_then(|x| {
            x.as_u64()
                .or_else(|| x.as_f64().map(|f| f as u64))
                .or_else(|| x.as_i64().map(|i| i.max(0) as u64))
        })
        .unwrap_or(0);
    Some(ScheduleEventDto {
        id,
        date,
        end_date,
        title,
        time,
        end_time,
        note,
        category,
        created_at,
    })
}

fn baa_dir() -> Result<PathBuf, String> {
    let base = dirs::config_dir().ok_or_else(|| "No config directory".to_string())?;
    let dir = base.join("BAA");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    // One-time migrate from legacy desktop-pet folder
    let legacy = base.join("desktop-pet");
    if legacy.is_dir() {
        for name in ["schedule.json", "schedule-reminded.json", "config.json"] {
            let from = legacy.join(name);
            let to = dir.join(name);
            if from.exists() && !to.exists() {
                let _ = fs::copy(&from, &to);
            }
        }
    }
    Ok(dir)
}

fn schedule_path() -> Result<PathBuf, String> {
    Ok(baa_dir()?.join("schedule.json"))
}

fn reminded_path() -> Result<PathBuf, String> {
    Ok(baa_dir()?.join("schedule-reminded.json"))
}

fn deleted_ids_path() -> Result<PathBuf, String> {
    Ok(baa_dir()?.join("schedule-deleted.json"))
}

fn read_deleted_ids() -> Vec<String> {
    let Ok(path) = deleted_ids_path() else {
        return Vec::new();
    };
    let Ok(raw) = fs::read_to_string(path) else {
        return Vec::new();
    };
    serde_json::from_str::<Vec<String>>(&raw)
        .unwrap_or_default()
        .into_iter()
        .filter(|s| !s.is_empty())
        .collect()
}

/// Ids the user deleted — hydrate/merge must never resurrect them.
#[tauri::command]
pub fn load_deleted_ids() -> Result<Vec<String>, String> {
    Ok(read_deleted_ids())
}

/// Remember deleted plan ids so other windows cannot write them back.
#[tauri::command]
pub fn remember_deleted_ids(ids: Vec<String>) -> Result<Vec<String>, String> {
    let mut set: std::collections::BTreeSet<String> = read_deleted_ids().into_iter().collect();
    for id in ids {
        let t = id.trim();
        if !t.is_empty() {
            set.insert(t.to_string());
        }
    }
    let list: Vec<String> = set.into_iter().collect();
    let path = deleted_ids_path()?;
    let raw = serde_json::to_string_pretty(&list).map_err(|e| e.to_string())?;
    fs::write(path, raw).map_err(|e| e.to_string())?;
    Ok(list)
}

/// Load schedule from disk. Empty list if missing / invalid.
#[tauri::command]
pub fn load_schedule() -> Result<Vec<ScheduleEventDto>, String> {
    let path = schedule_path()?;
    if !path.exists() {
        return Ok(vec![]);
    }
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    if raw.trim().is_empty() {
        return Ok(vec![]);
    }
    // Prefer lenient parse (same as save path) so older / messy JSON still loads
    let value: serde_json::Value =
        serde_json::from_str(&raw).map_err(|e| format!("schedule parse: {e}"))?;
    Ok(parse_event_list(value))
}

fn parse_event_list(events: serde_json::Value) -> Vec<ScheduleEventDto> {
    match events {
        serde_json::Value::Array(arr) => arr
            .iter()
            .filter_map(|v| {
                serde_json::from_value::<ScheduleEventDto>(v.clone())
                    .ok()
                    .or_else(|| dto_from_value(v))
            })
            .filter(|e| !e.id.is_empty() && !e.date.is_empty() && !e.title.is_empty())
            .collect(),
        serde_json::Value::String(s) => {
            // JSON string payload (most reliable across Tauri IPC)
            serde_json::from_str::<serde_json::Value>(&s)
                .map(parse_event_list)
                .unwrap_or_default()
        }
        other => dto_from_value(&other).into_iter().collect(),
    }
}

fn write_schedule_list(list: &[ScheduleEventDto]) -> Result<usize, String> {
    let path = schedule_path()?;
    // Never wipe a non-empty schedule with an empty payload (partial UI / race).
    // True "delete all" is rare; user can clear from a full loaded list later.
    if list.is_empty() {
        if path.exists() {
            let existing = fs::read_to_string(&path).unwrap_or_default();
            if existing.trim().len() > 4 {
                eprintln!(
                    "[baa] refuse empty save_schedule — keeping existing {}",
                    path.display()
                );
                return Err(
                    "save_schedule: refusing to overwrite non-empty schedule with empty list"
                        .into(),
                );
            }
        }
        // File missing or already [] — ok to write []
    }
    let raw = serde_json::to_string_pretty(list).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, &raw).map_err(|e| format!("write tmp: {e}"))?;
    if fs::rename(&tmp, &path).is_err() {
        fs::write(&path, &raw).map_err(|e| format!("write path: {e}"))?;
        let _ = fs::remove_file(&tmp);
    }
    // Debug log for diagnosing stuck saves
    let log = baa_dir().map(|d| d.join("save-debug.log")).ok();
    if let Some(log) = log {
        let line = format!(
            "{} wrote {} events → {}\n",
            chrono_like_now(),
            list.len(),
            path.display()
        );
        let _ = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(log)
            .and_then(|mut f| {
                use std::io::Write;
                f.write_all(line.as_bytes())
            });
    }
    eprintln!(
        "[baa] save_schedule wrote {} event(s) → {}",
        list.len(),
        path.display()
    );
    Ok(list.len())
}

fn chrono_like_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("{ms}")
}

/// Save full schedule list to disk (atomic write via temp + rename).
/// Accepts a JSON array **or** a JSON string of an array (IPC-safe).
#[tauri::command]
pub fn save_schedule(events: serde_json::Value) -> Result<usize, String> {
    let list = parse_event_list(events);
    write_schedule_list(&list)
}

/// Same as save_schedule but takes a raw JSON string — use from frontend for reliability.
/// Always writes bytes when payload looks non-empty (even if JSON parse is fussy).
#[tauri::command]
pub fn save_schedule_json(json: String) -> Result<usize, String> {
    let trimmed = json.trim();
    eprintln!(
        "[baa] save_schedule_json recv bytes={} head={:?}",
        trimmed.len(),
        trimmed.chars().take(60).collect::<String>()
    );
    if trimmed.is_empty() || trimmed == "[]" || trimmed == "null" {
        return Err("save_schedule_json: empty payload".into());
    }
    if !trimmed.starts_with('[') {
        return Err(format!(
            "save_schedule_json: expected JSON array, got head {:?}",
            trimmed.chars().take(20).collect::<String>()
        ));
    }

    let path = schedule_path()?;
    let tmp = path.with_extension("json.tmp");

    let (out, arr_len): (String, usize) =
        match serde_json::from_str::<serde_json::Value>(trimmed) {
            Ok(value) => {
                let n = value.as_array().map(|a| a.len()).unwrap_or(0);
                if n == 0 {
                    return Err("save_schedule_json: empty array".into());
                }
                let pretty =
                    serde_json::to_string_pretty(&value).unwrap_or_else(|_| trimmed.to_string());
                (pretty, n)
            }
            Err(e) => {
                // Still persist raw bytes — better than losing plans
                eprintln!("[baa] save_schedule_json parse warn: {e} — writing raw");
                let n = trimmed.matches("\"id\"").count().max(1);
                (trimmed.to_string(), n)
            }
        };

    fs::write(&tmp, out.as_bytes()).map_err(|e| format!("write tmp: {e}"))?;
    if fs::rename(&tmp, &path).is_err() {
        fs::write(&path, out.as_bytes()).map_err(|e| format!("write path: {e}"))?;
        let _ = fs::remove_file(&tmp);
    }

    eprintln!(
        "[baa] save_schedule_json OK wrote {} events → {}",
        arr_len,
        path.display()
    );
    if let Ok(dir) = baa_dir() {
        let line = format!(
            "{} wrote {} events → {}\n",
            chrono_like_now(),
            arr_len,
            path.display()
        );
        let _ = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(dir.join("save-debug.log"))
            .and_then(|mut f| {
                use std::io::Write;
                f.write_all(line.as_bytes())
            });
    }
    Ok(arr_len)
}

/// Load reminder-sent map (eventId → timestamp) so we don't re-chime after relaunch.
#[tauri::command]
pub fn load_schedule_reminded() -> Result<std::collections::HashMap<String, u64>, String> {
    let path = reminded_path()?;
    if !path.exists() {
        return Ok(std::collections::HashMap::new());
    }
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    if raw.trim().is_empty() {
        return Ok(std::collections::HashMap::new());
    }
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_schedule_reminded(
    map: std::collections::HashMap<String, u64>,
) -> Result<(), String> {
    let path = reminded_path()?;
    let raw = serde_json::to_string_pretty(&map).map_err(|e| e.to_string())?;
    fs::write(path, raw).map_err(|e| e.to_string())
}
