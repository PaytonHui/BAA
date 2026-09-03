use crate::config::{self, AppConfig};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::ffi::{CStr, CString};
use std::os::raw::c_char;

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
unsafe extern "C" {
    fn baa_ai_status_json() -> *mut c_char;
    fn baa_ai_respond(system: *const c_char, messages_json: *const c_char) -> *mut c_char;
    fn baa_ai_prewarm();
    fn baa_ai_free(ptr: *mut c_char);
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatAttachmentIn {
    pub name: Option<String>,
    pub mime: Option<String>,
    pub kind: Option<String>,
    pub data_url: Option<String>,
    pub text_content: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
    #[serde(default)]
    pub attachments: Option<Vec<ChatAttachmentIn>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatRequest {
    pub messages: Vec<ChatMessage>,
    /// Client local calendar date YYYY-MM-DD (for schedule / "tomorrow")
    #[serde(default)]
    pub today: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatResponse {
    pub message: String,
    pub expression: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiStatus {
    pub available: bool,
    pub model: String,
    pub reason: Option<String>,
    pub code: Option<String>,
    /// Always true in v0.2 — chat is unlocked (no API key).
    pub logged_in: bool,
    pub display_name: Option<String>,
}

fn take_cstr(ptr: *mut c_char) -> String {
    if ptr.is_null() {
        return String::new();
    }
    let s = unsafe { CStr::from_ptr(ptr) }
        .to_string_lossy()
        .into_owned();
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    unsafe {
        baa_ai_free(ptr);
    }
    s
}

fn parse_json_object(raw: &str) -> Value {
    serde_json::from_str(raw).unwrap_or(Value::Null)
}

#[allow(dead_code)]
fn native_unavailable_status() -> AiStatus {
    AiStatus {
        available: false,
        model: config::APPLE_INTELLIGENCE_MODEL.into(),
        reason: Some(
            "On-device Apple Intelligence needs macOS 26+ on Apple Silicon.".into(),
        ),
        code: Some("unsupportedPlatform".into()),
        logged_in: true,
        display_name: None,
    }
}

fn status_from_json(raw: &str, display_name: Option<String>) -> AiStatus {
    let v = parse_json_object(raw);
    let available = v
        .get("available")
        .and_then(|x| x.as_bool())
        .unwrap_or(false);
    let reason = v
        .get("reason")
        .and_then(|x| x.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());
    let code = v
        .get("code")
        .and_then(|x| x.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());
    AiStatus {
        available,
        model: v
            .get("model")
            .and_then(|x| x.as_str())
            .unwrap_or(config::APPLE_INTELLIGENCE_MODEL)
            .to_string(),
        reason,
        code,
        logged_in: true,
        display_name,
    }
}

/// Warm the on-device model so the first chat is snappier.
pub fn prewarm_apple_intelligence() {
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    unsafe {
        baa_ai_prewarm();
    }
}

fn pick_expression(user: &str, reply: &str) -> &'static str {
    let t = format!("{} {}", user, reply).to_lowercase();
    if t.contains("哈哈") || t.contains("lol") || t.contains("搞笑") || t.contains("silly") {
        return "happy";
    }
    if t.contains("sorry")
        || t.contains("唔好意思")
        || t.contains("error")
        || t.contains("失敗")
        || t.contains("turn on apple intelligence")
    {
        return "sad";
    }
    "happy"
}

fn calendar_system_suffix(today: &str) -> String {
    format!(
        "\n\n\
## Binky calendar (CRITICAL — calendar only updates if you emit machine lines)\n\
Today is **{today}** (user's local date, YYYY-MM-DD).\n\
You power a desktop pet with a real calendar UI. Without SCHEDULE_JSON the app will NOT mark anything.\n\
\n\
### ADD a plan (REQUIRED machine line)\n\
When the user mentions ANY plan, appointment, meeting, class, exam, deadline, reminder, trip, \
OR asks to remember / mark / schedule / put on the calendar:\n\
1. Reply naturally in their language (short chat bubble).\n\
2. You MUST end with EXACTLY this format on its own line (NO markdown fence, NO ```json):\n\
SCHEDULE_JSON:[/* JSON array */]\n\
Each object: \"date\" (YYYY-MM-DD start), \"title\" (short), optional \"time\" (HH:mm), \"endDate\" (YYYY-MM-DD inclusive end for multi-day), \"note\", \"category\" (\"work\"|\"other\").\n\
Resolve relative words using today: tomorrow, next Monday, 下星期, 聽日, 明天, etc.\n\
For RANGES (e.g. November 7, 2026 – January 10, 2027 or 2026年11月7日–2027年1月10日) set date=start AND endDate=end.\n\
If the user pastes an event flyer (Event Date / 賽事日期 / race name), extract title + dates and still emit SCHEDULE_JSON.\n\
Example single day:\n\
Got it — I'll mark your meeting.\n\
SCHEDULE_JSON:[{{\"date\":\"{today}\",\"title\":\"Meeting\",\"time\":\"15:00\",\"category\":\"work\"}}]\n\
If you claim you marked something but omit SCHEDULE_JSON, the calendar stays empty — never do that.\n\
\n\
### CANCEL / remove a plan already on the calendar\n\
When the user asks to cancel, delete, remove, unmark, or drop a schedule item:\n\
1. Reply naturally that you removed it.\n\
2. End with EXACTLY:\n\
CANCEL_SCHEDULE_JSON:[/* JSON array */]\n\
Use date+title matching the saved event (time if known). Example:\n\
Done — cancelled.\n\
CANCEL_SCHEDULE_JSON:[{{\"date\":\"{today}\",\"title\":\"Meeting\",\"time\":\"15:00\"}}]\n\
You MAY also use SCHEDULE_JSON with \"action\":\"cancel\" on each object.\n\
NEVER say you cancelled something without emitting CANCEL_SCHEDULE_JSON (or action cancel).\n\
\n\
If they are NOT asking to save or cancel a plan, do NOT output either machine line.\n\
If they ask what's on the calendar, use the saved list from the user message context.\n\
You can also see images (via on-device text recognition) and file text the user attaches."
    )
}

fn messages_payload(messages: &[ChatMessage]) -> Result<String, String> {
    let recent: Vec<&ChatMessage> = messages
        .iter()
        .filter(|m| m.role == "user" || m.role == "assistant")
        .rev()
        .take(12)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();

    let arr: Vec<Value> = recent
        .into_iter()
        .map(|m| {
            let mut obj = json!({
                "role": m.role,
                "content": m.content,
            });
            if let Some(atts) = m.attachments.as_ref() {
                if !atts.is_empty() {
                    let mapped: Vec<Value> = atts
                        .iter()
                        .map(|a| {
                            json!({
                                "name": a.name,
                                "mime": a.mime,
                                "kind": a.kind,
                                "dataUrl": a.data_url,
                                "textContent": a.text_content,
                            })
                        })
                        .collect();
                    obj["attachments"] = Value::Array(mapped);
                }
            }
            obj
        })
        .collect();
    serde_json::to_string(&arr).map_err(|e| e.to_string())
}

fn call_apple_intelligence(system: &str, messages_json: &str) -> Result<Value, String> {
    #[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
    {
        let _ = (system, messages_json);
        return Err(
            "On-device Apple Intelligence needs macOS 26+ on Apple Silicon.".into(),
        );
    }

    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        let sys = CString::new(system).map_err(|_| "Invalid system prompt".to_string())?;
        let msgs =
            CString::new(messages_json).map_err(|_| "Invalid chat payload".to_string())?;
        let ptr = unsafe { baa_ai_respond(sys.as_ptr(), msgs.as_ptr()) };
        let raw = take_cstr(ptr);
        if raw.is_empty() {
            return Err("Apple Intelligence returned no data.".into());
        }
        serde_json::from_str(&raw).map_err(|e| format!("Bad Apple Intelligence JSON: {e}"))
    }
}

#[tauri::command]
pub fn ai_status() -> Result<AiStatus, String> {
    let cfg = config::load_config().unwrap_or_else(|_| AppConfig::default());
    #[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
    {
        let mut s = native_unavailable_status();
        s.display_name = cfg.display_name;
        return Ok(s);
    }
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        let ptr = unsafe { baa_ai_status_json() };
        let raw = take_cstr(ptr);
        Ok(status_from_json(&raw, cfg.display_name))
    }
}

/// Back-compat for older UI that still asks grok_auth_status.
/// Chat is unlocked; `loggedIn` is always true.
#[tauri::command]
pub fn grok_auth_status() -> Result<AiStatus, String> {
    ai_status()
}

#[tauri::command]
pub async fn open_apple_intelligence_settings() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let status = std::process::Command::new("open")
            .arg("x-apple.systempreferences:com.apple.Siri-Settings.extension")
            .status()
            .map_err(|e| e.to_string())?;
        if !status.success() {
            let _ = std::process::Command::new("open")
                .arg("/System/Library/PreferencePanes/Speech.prefPane")
                .status();
        }
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("Apple Intelligence settings are only on macOS.".into())
    }
}

#[tauri::command]
pub async fn chat_with_apple_intelligence(req: ChatRequest) -> Result<ChatResponse, String> {
    let cfg = config::load_config().unwrap_or_else(|_| AppConfig::default());
    let last_user = req
        .messages
        .iter()
        .rev()
        .find(|m| m.role == "user")
        .map(|m| m.content.as_str())
        .unwrap_or("");

    let today = req
        .today
        .as_deref()
        .filter(|s| s.len() == 10)
        .unwrap_or("unknown");
    let system = format!("{}{}", cfg.system_prompt, calendar_system_suffix(today));
    let payload = messages_payload(&req.messages)?;

    let v = tokio::task::spawn_blocking(move || call_apple_intelligence(&system, &payload))
        .await
        .map_err(|e| format!("Apple Intelligence worker failed: {e}"))??;

    if v.get("ok").and_then(|x| x.as_bool()) == Some(false) {
        let err = v
            .get("error")
            .and_then(|x| x.as_str())
            .or_else(|| v.get("reason").and_then(|x| x.as_str()))
            .unwrap_or("Apple Intelligence is not available.");
        return Err(err.to_string());
    }

    let content = v
        .get("message")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    if content.is_empty() {
        return Err("Apple Intelligence returned an empty reply. Try again.".into());
    }

    let expression = pick_expression(last_user, &content).to_string();
    Ok(ChatResponse {
        message: content,
        expression,
    })
}

/// Back-compat command name used by the existing chat window.
#[tauri::command]
pub async fn chat_with_grok(req: ChatRequest) -> Result<ChatResponse, String> {
    chat_with_apple_intelligence(req).await
}

#[cfg(test)]
mod tests {
    #[test]
    fn apple_intelligence_status_parses() {
        let s = super::ai_status().expect("ai_status");
        assert_eq!(s.model, "apple-intelligence");
        assert!(s.logged_in);
        eprintln!(
            "available={} code={:?} reason={:?}",
            s.available, s.code, s.reason
        );
    }
}
