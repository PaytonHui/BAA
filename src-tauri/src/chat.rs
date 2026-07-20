use crate::config::{self, AppConfig};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

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

#[derive(Debug, Serialize)]
struct XaiRequest {
    model: String,
    messages: Vec<Value>,
    temperature: f32,
    max_tokens: u32,
}

#[derive(Debug, Deserialize)]
struct XaiChoiceMessage {
    content: Option<String>,
}

#[derive(Debug, Deserialize)]
struct XaiChoice {
    message: Option<XaiChoiceMessage>,
}

#[derive(Debug, Deserialize)]
struct XaiResponse {
    choices: Option<Vec<XaiChoice>>,
    error: Option<XaiErrorBody>,
    code: Option<String>,
}

#[derive(Debug, Deserialize)]
struct XaiErrorBody {
    message: Option<String>,
    #[serde(default)]
    code: Option<String>,
}

/// Parse xAI error JSON which may be:
/// `{ "code": "...", "error": "..." }` or `{ "error": { "message": "..." } }`
fn parse_api_error(status: reqwest::StatusCode, text: &str) -> String {
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(text) {
        let code = v
            .get("code")
            .and_then(|c| c.as_str())
            .or_else(|| v.pointer("/error/code").and_then(|c| c.as_str()))
            .unwrap_or("");
        let msg = v
            .get("error")
            .and_then(|e| {
                if e.is_string() {
                    e.as_str().map(|s| s.to_string())
                } else {
                    e.get("message")
                        .and_then(|m| m.as_str())
                        .map(|s| s.to_string())
                }
            })
            .or_else(|| {
                v.get("message")
                    .and_then(|m| m.as_str())
                    .map(|s| s.to_string())
            })
            .unwrap_or_else(|| text.to_string());

        return friendly_error(status.as_u16(), code, &msg);
    }

    friendly_error(status.as_u16(), "", text)
}

fn friendly_error(status: u16, code: &str, msg: &str) -> String {
    let lower = msg.to_lowercase();
    if status == 403
        || code == "permission-denied"
        || lower.contains("credits")
        || lower.contains("licenses")
        || lower.contains("doesn't have any credits")
    {
        return format!(
            "Grok API: your team has no credits or license yet.\n\
Buy credits at https://console.x.ai , then try again.\n\n({status} {code})\n{msg}"
        );
    }
    if status == 401 || lower.contains("invalid api key") || lower.contains("unauthorized") {
        return format!(
            "Grok login expired or invalid.\n\
Open Chat → Sign in to Grok (basic), or get a key at https://console.x.ai\n\n{msg}"
        );
    }
    if status == 404 || (lower.contains("model") && lower.contains("not found")) {
        return format!(
            "Grok API: model not available on your account.\n\
BAA uses basic Grok ({BASIC}).\n\n{msg}",
            BASIC = config::BASIC_GROK_MODEL
        );
    }
    if status == 429 || lower.contains("rate") {
        return format!("Grok API: rate limited. Please try again later.\n\n{msg}");
    }
    format!("Grok API error ({status}): {msg}")
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
        || t.contains("credits")
    {
        return "sad";
    }
    "happy"
}

/// Build OpenAI/xAI-compatible message content (string or multimodal array).
fn build_message_content(m: &ChatMessage) -> Value {
    let atts = m.attachments.as_deref().unwrap_or(&[]);
    if atts.is_empty() {
        return Value::String(m.content.clone());
    }

    let mut parts: Vec<Value> = Vec::new();
    let mut text_buf = m.content.clone();

    for a in atts {
        let kind = a.kind.as_deref().unwrap_or("");
        let name = a.name.as_deref().unwrap_or("file");
        let mime = a.mime.as_deref().unwrap_or("application/octet-stream");

        if kind == "image" {
            if let Some(url) = a.data_url.as_ref().filter(|u| u.starts_with("data:image")) {
                // Cap extremely long payloads (safety)
                if url.len() < 6_000_000 {
                    parts.push(json!({
                        "type": "image_url",
                        "image_url": { "url": url, "detail": "auto" }
                    }));
                    continue;
                }
            }
            text_buf.push_str(&format!("\n[Image attached: {name} — could not embed]"));
        } else if let Some(t) = a.text_content.as_ref().filter(|s| !s.is_empty()) {
            let clipped: String = t.chars().take(12_000).collect();
            text_buf.push_str(&format!(
                "\n\n--- Attached file: {name} ({mime}) ---\n{clipped}\n--- end file ---"
            ));
        } else {
            text_buf.push_str(&format!("\n[Attached file: {name} ({mime})]"));
        }
    }

    if !text_buf.trim().is_empty() {
        parts.insert(0, json!({ "type": "text", "text": text_buf }));
    } else if parts.is_empty() {
        return Value::String(m.content.clone());
    }

    // If only text parts, send as plain string (lighter)
    if parts.len() == 1 && parts[0].get("type").and_then(|t| t.as_str()) == Some("text") {
        return Value::String(
            parts[0]
                .get("text")
                .and_then(|t| t.as_str())
                .unwrap_or("")
                .to_string(),
        );
    }

    Value::Array(parts)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GrokAuthStatus {
    pub logged_in: bool,
    pub model: String,
    pub display_name: Option<String>,
    /// Masked key hint e.g. "xai-…abc"
    pub key_hint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GrokLoginRequest {
    /// xAI API key from console.x.ai (used as “login” for basic Grok)
    pub api_key: String,
    #[serde(default)]
    pub display_name: Option<String>,
}

fn mask_key(key: &str) -> String {
    let t = key.trim();
    if t.len() <= 8 {
        return "xai-…".into();
    }
    format!("{}…{}", &t[..4], &t[t.len().saturating_sub(4)..])
}

/// Status for the Grok login UI (basic model, not Grok 4.5).
#[tauri::command]
pub fn grok_auth_status() -> Result<GrokAuthStatus, String> {
    let cfg = config::load_config().unwrap_or_else(|_| AppConfig::default());
    let key = config::resolve_api_key(&cfg);
    Ok(GrokAuthStatus {
        logged_in: key.is_some(),
        model: if cfg.model.trim().is_empty() {
            config::BASIC_GROK_MODEL.into()
        } else {
            cfg.model
        },
        display_name: cfg.display_name,
        key_hint: key.as_deref().map(mask_key),
    })
}

/// Validate key against xAI and save — “Sign in to basic Grok”.
#[tauri::command]
pub async fn login_grok(req: GrokLoginRequest) -> Result<GrokAuthStatus, String> {
    let key = req.api_key.trim().to_string();
    if key.is_empty() {
        return Err("Enter your xAI access key to sign in.".into());
    }
    if !key.starts_with("xai-") && key.len() < 12 {
        return Err("That doesn’t look like an xAI key (usually starts with xai-). Get one free at https://console.x.ai".into());
    }

    // Lightweight validation — list models
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?;

    let res = client
        .get("https://api.x.ai/v1/models")
        .bearer_auth(&key)
        .send()
        .await
        .map_err(|e| format!("Network error: {e}"))?;

    let status = res.status();
    let text = res.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(parse_api_error(status, &text));
    }

    let mut cfg = config::load_config().unwrap_or_else(|_| AppConfig::default());
    cfg.api_key = Some(key);
    cfg.model = config::BASIC_GROK_MODEL.into();
    cfg.display_name = req
        .display_name
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .or_else(|| Some("Binky friend".into()));
    config::save_config(&cfg)?;

    grok_auth_status()
}

/// Clear saved Grok key (logout).
#[tauri::command]
pub fn logout_grok() -> Result<GrokAuthStatus, String> {
    let mut cfg = config::load_config().unwrap_or_else(|_| AppConfig::default());
    cfg.api_key = None;
    cfg.display_name = None;
    cfg.model = config::BASIC_GROK_MODEL.into();
    config::save_config(&cfg)?;
    grok_auth_status()
}

#[tauri::command]
pub async fn chat_with_grok(req: ChatRequest) -> Result<ChatResponse, String> {
    let cfg = config::load_config().unwrap_or_else(|_| AppConfig::default());
    let api_key = config::resolve_api_key(&cfg).ok_or_else(|| {
        "NOT_LOGGED_IN: Sign in to basic Grok first (Chat opens a login window). Get a free key at https://console.x.ai".to_string()
    })?;

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
    let system = format!(
        "{}\n\n\
## Binky calendar (CRITICAL — calendar only updates if you emit machine lines)\n\
Today is **{}** (user's local date, YYYY-MM-DD).\n\
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
SCHEDULE_JSON:[{{\"date\":\"{}\",\"title\":\"Meeting\",\"time\":\"15:00\",\"category\":\"work\"}}]\n\
Example multi-day:\n\
Got it — Virtual Run marked.\n\
SCHEDULE_JSON:[{{\"date\":\"2026-11-07\",\"endDate\":\"2027-01-10\",\"title\":\"Virtual RUN_35A UST Global Run\",\"category\":\"other\"}}]\n\
If you claim you marked something but omit SCHEDULE_JSON, the calendar stays empty — never do that.\n\
\n\
### CANCEL / remove a plan already on the calendar\n\
When the user asks to cancel, delete, remove, unmark, or drop a schedule item:\n\
1. Reply naturally that you removed it.\n\
2. End with EXACTLY:\n\
CANCEL_SCHEDULE_JSON:[/* JSON array */]\n\
Use date+title matching the saved event (time if known). Example:\n\
Done — cancelled.\n\
CANCEL_SCHEDULE_JSON:[{{\"date\":\"{}\",\"title\":\"Meeting\",\"time\":\"15:00\"}}]\n\
You MAY also use SCHEDULE_JSON with \"action\":\"cancel\" on each object.\n\
NEVER say you cancelled something without emitting CANCEL_SCHEDULE_JSON (or action cancel).\n\
\n\
If they are NOT asking to save or cancel a plan, do NOT output either machine line.\n\
If they ask what's on the calendar, use the saved list from the user message context.\n\
You can also see images and file text the user attaches — describe or help with them when relevant.",
        cfg.system_prompt, today, today, today
    );

    let mut messages: Vec<Value> = vec![json!({
        "role": "system",
        "content": system,
    })];

    for m in &req.messages {
        if m.role == "user" || m.role == "assistant" {
            messages.push(json!({
                "role": m.role,
                "content": build_message_content(m),
            }));
        }
    }

    // Lightstick always uses basic Grok (not flagship 4.5)
    let model = {
        let m = cfg.model.trim();
        if m.is_empty() || m == "grok-4.5" || m == "grok-4" {
            config::BASIC_GROK_MODEL.to_string()
        } else {
            m.to_string()
        }
    };

    let body = XaiRequest {
        model,
        messages,
        temperature: 0.8,
        max_tokens: 1024,
    };

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(90))
        .build()
        .map_err(|e| e.to_string())?;

    let res = client
        .post("https://api.x.ai/v1/chat/completions")
        .bearer_auth(api_key.trim())
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Network error: {e}"))?;

    let status = res.status();
    let text = res.text().await.map_err(|e| e.to_string())?;

    if !status.is_success() {
        return Err(parse_api_error(status, &text));
    }

    let parsed: XaiResponse =
        serde_json::from_str(&text).map_err(|e| format!("Failed to parse response: {e}\n{text}"))?;

    let content = parsed
        .choices
        .and_then(|c| c.into_iter().next())
        .and_then(|c| c.message)
        .and_then(|m| m.content)
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "…I went blank for a second. Try again?".into());

    let expression = pick_expression(last_user, &content).to_string();

    Ok(ChatResponse {
        message: content,
        expression,
    })
}
