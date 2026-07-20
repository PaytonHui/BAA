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
    #[serde(default)]
    pub note: Option<String>,
    /// "work" | "other"
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub created_at: u64,
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
    let events: Vec<ScheduleEventDto> =
        serde_json::from_str(&raw).map_err(|e| format!("schedule parse: {e}"))?;
    Ok(events
        .into_iter()
        .filter(|e| !e.id.is_empty() && !e.date.is_empty() && !e.title.is_empty())
        .collect())
}

/// Save full schedule list to disk (atomic-ish write via temp + rename).
#[tauri::command]
pub fn save_schedule(events: Vec<ScheduleEventDto>) -> Result<(), String> {
    let path = schedule_path()?;
    let raw = serde_json::to_string_pretty(&events).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, &raw).map_err(|e| e.to_string())?;
    if fs::rename(&tmp, &path).is_err() {
        fs::write(&path, &raw).map_err(|e| e.to_string())?;
        let _ = fs::remove_file(&tmp);
    }
    Ok(())
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
