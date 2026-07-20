use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

/// Basic Grok for the lightstick — not flagship Grok 4.5.
/// Cheap / fast chat model suitable for a desktop pet.
pub const BASIC_GROK_MODEL: &str = "grok-4-1-fast-non-reasoning";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    /// Optional override; env XAI_API_KEY takes priority if set.
    pub api_key: Option<String>,
    /// Display name from login (optional)
    #[serde(default)]
    pub display_name: Option<String>,
    /// e.g. grok-4-1-fast-non-reasoning (basic). Prefer BASIC_GROK_MODEL.
    pub model: String,
    pub system_prompt: String,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            api_key: None,
            display_name: None,
            model: std::env::var("XAI_MODEL").unwrap_or_else(|_| BASIC_GROK_MODEL.into()),
            system_prompt: "You are Grok, built by xAI. You live as a lightweight desktop companion \
shaped like a NewJeans lightstick named Binky. Be helpful, direct, concise, and a bit witty. \
Match the user's language. Keep answers short enough for a small chat bubble unless they ask for detail. \
You can remember their schedule across sessions. To ADD a plan, confirm briefly then end with:\n\
SCHEDULE_JSON:[{\"date\":\"YYYY-MM-DD\",\"title\":\"short title\",\"time\":\"HH:mm or empty\",\"note\":\"optional\",\"category\":\"work or other\"}]\n\
To CHANGE type (work↔other) or edit an existing plan, end with:\n\
SCHEDULE_JSON:[{\"date\":\"YYYY-MM-DD\",\"title\":\"matching title\",\"time\":\"optional\",\"category\":\"work or other\",\"action\":\"update\"}]\n\
To CANCEL/remove a plan already marked, confirm briefly then end with:\n\
CANCEL_SCHEDULE_JSON:[{\"date\":\"YYYY-MM-DD\",\"title\":\"matching title\",\"time\":\"optional\"}]\n\
category \"work\" = job/office (remind 3h before); \"other\" = personal/event (remind 1h before). \
Use the correct year for \"tomorrow\", \"next Monday\", etc. (today is injected separately). \
Never claim you added, updated, or cancelled without the matching machine line."
                .into(),
        }
    }
}

fn config_path() -> Result<PathBuf, String> {
    let base = dirs::config_dir().ok_or_else(|| "No config directory".to_string())?;
    let dir = base.join("BAA");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    // Migrate legacy desktop-pet config once
    let legacy = base.join("desktop-pet").join("config.json");
    let path = dir.join("config.json");
    if legacy.exists() && !path.exists() {
        let _ = fs::copy(&legacy, &path);
    }
    Ok(path)
}

pub fn load_config() -> Result<AppConfig, String> {
    let path = config_path()?;
    if !path.exists() {
        return Ok(AppConfig::default());
    }
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let mut cfg: AppConfig = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    if cfg.model.is_empty() || cfg.model.trim() == "grok-4.5" || cfg.model.trim() == "grok-4" {
        // Migrate away from flagship model — lightstick uses basic Grok
        cfg.model = BASIC_GROK_MODEL.into();
    }
    if cfg.system_prompt.is_empty() {
        cfg.system_prompt = AppConfig::default().system_prompt;
    }
    Ok(cfg)
}

/// Whether a Grok key is available (env or saved login).
pub fn is_logged_in(cfg: &AppConfig) -> bool {
    resolve_api_key(cfg).is_some()
}

pub fn save_config(cfg: &AppConfig) -> Result<(), String> {
    let path = config_path()?;
    let raw = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    fs::write(path, raw).map_err(|e| e.to_string())
}

/// Resolve API key: process env first, then saved config.
pub fn resolve_api_key(cfg: &AppConfig) -> Option<String> {
    if let Ok(k) = std::env::var("XAI_API_KEY") {
        let t = k.trim().to_string();
        if !t.is_empty() {
            return Some(t);
        }
    }
    cfg.api_key
        .as_ref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}
