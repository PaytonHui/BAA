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

/// Pull assistant text from xAI JSON (string content or multimodal array).
fn extract_assistant_text(body: &str) -> Result<String, String> {
    let v: Value = serde_json::from_str(body)
        .map_err(|e| format!("Failed to parse response: {e}\n{body}"))?;

    if let Some(err) = v.get("error") {
        let msg = if err.is_string() {
            err.as_str().unwrap_or("unknown").to_string()
        } else {
            err.get("message")
                .and_then(|m| m.as_str())
                .unwrap_or("unknown")
                .to_string()
        };
        return Err(format!("Grok API error: {msg}"));
    }

    let content = v
        .pointer("/choices/0/message/content")
        .ok_or_else(|| format!("Grok API: empty choices\n{body}"))?;

    let text = match content {
        Value::String(s) => s.trim().to_string(),
        Value::Array(parts) => {
            let mut out = String::new();
            for p in parts {
                if let Some(t) = p.get("text").and_then(|t| t.as_str()) {
                    if !out.is_empty() {
                        out.push('\n');
                    }
                    out.push_str(t);
                } else if p.get("type").and_then(|t| t.as_str()) == Some("text") {
                    if let Some(t) = p.get("text").and_then(|t| t.as_str()) {
                        if !out.is_empty() {
                            out.push('\n');
                        }
                        out.push_str(t);
                    }
                }
            }
            out.trim().to_string()
        }
        other => other
            .as_str()
            .unwrap_or("")
            .trim()
            .to_string(),
    };

    if text.is_empty() {
        Ok("…I went blank for a second. Try again?".into())
    } else {
        Ok(text)
    }
}

/// Prefer current basic chat models; skip image/video/build tools.
fn rank_chat_models(ids: &[String], preferred: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let push = |list: &mut Vec<String>, id: &str| {
        if !id.is_empty() && !list.iter().any(|x| x == id) {
            list.push(id.to_string());
        }
    };

    // Hardcoded preferred order (updated when xAI renames models)
    for id in [
        preferred,
        config::BASIC_GROK_MODEL,
        "grok-4.20-0309-non-reasoning",
        "grok-4.3",
        "grok-4.20-0309-reasoning",
        "grok-4.5",
        "grok-4.20-multi-agent-0309",
    ] {
        if ids.is_empty() || ids.iter().any(|x| x == id) {
            push(&mut out, id);
        }
    }

    // Any other grok-* chat model from the live list
    let mut rest: Vec<String> = ids
        .iter()
        .filter(|id| {
            let l = id.to_lowercase();
            l.starts_with("grok-")
                && !l.contains("imagine")
                && !l.contains("image")
                && !l.contains("video")
                && !l.contains("build")
                && !out.iter().any(|x| x == *id)
        })
        .cloned()
        .collect();
    // Prefer names with "non-reasoning" / "fast" / "mini"
    rest.sort_by(|a, b| {
        let score = |s: &str| {
            let l = s.to_lowercase();
            let mut n = 0i32;
            if l.contains("non-reasoning") {
                n += 3;
            }
            if l.contains("fast") || l.contains("mini") {
                n += 2;
            }
            if l.contains("reasoning") {
                n -= 1;
            }
            n
        };
        score(b).cmp(&score(a)).then_with(|| a.cmp(b))
    });
    for id in rest {
        push(&mut out, &id);
    }

    if out.is_empty() {
        push(&mut out, config::BASIC_GROK_MODEL);
        push(&mut out, "grok-4.3");
        push(&mut out, "grok-4.5");
    }
    out
}

async fn list_model_ids(client: &reqwest::Client, api_key: &str) -> Vec<String> {
    let res = client
        .get("https://api.x.ai/v1/models")
        .bearer_auth(api_key)
        .send()
        .await;
    let Ok(res) = res else {
        return Vec::new();
    };
    if !res.status().is_success() {
        return Vec::new();
    }
    let Ok(v) = res.json::<Value>().await else {
        return Vec::new();
    };
    v.get("data")
        .and_then(|d| d.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|m| m.get("id").and_then(|i| i.as_str()).map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default()
}

fn chat_debug(msg: &str) {
    if let Some(base) = dirs::config_dir() {
        let path = base.join("BAA").join("chat-debug.log");
        let line = format!(
            "{} {}\n",
            chrono_like_now(),
            msg.replace('\n', " | ")
        );
        let _ = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
            .and_then(|mut f| {
                use std::io::Write;
                f.write_all(line.as_bytes())
            });
    }
}

fn chrono_like_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("ts={secs}")
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
/// Runs a tiny chat completion so “Signed in” means chat will actually work
/// (not only that /v1/models accepted the key).
#[tauri::command]
pub async fn login_grok(req: GrokLoginRequest) -> Result<GrokAuthStatus, String> {
    let key = req.api_key.trim().to_string();
    if key.is_empty() {
        return Err("Enter your xAI access key to sign in.".into());
    }
    if !key.starts_with("xai-") {
        return Err(
            "Key must start with xai- (from https://console.x.ai → API Keys).\n\
Don’t paste a password, OpenAI key, or the whole page text."
                .into(),
        );
    }
    if key.len() < 16 {
        return Err("That key looks too short. Copy the full key from console.x.ai".into());
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;

    // 1) Auth check
    let res = client
        .get("https://api.x.ai/v1/models")
        .bearer_auth(&key)
        .send()
        .await
        .map_err(|e| {
            format!(
                "Network error reaching xAI (check Wi‑Fi / VPN / firewall):\n{e}"
            )
        })?;

    let status = res.status();
    let text = res.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(parse_api_error(status, &text));
    }

    // 2) Prove chat works — pick any live chat model (auto-adapts when xAI renames)
    let live = list_model_ids(&client, &key).await;
    let candidates = rank_chat_models(&live, config::BASIC_GROK_MODEL);
    let mut chosen = config::BASIC_GROK_MODEL.to_string();
    let mut last_err = String::new();
    let mut ok = false;
    for model in &candidates {
        let body = json!({
            "model": model,
            "messages": [
                {"role": "user", "content": "Reply with exactly: ok"}
            ],
            "max_tokens": 8,
            "temperature": 0.0,
        });
        let res = client
            .post("https://api.x.ai/v1/chat/completions")
            .bearer_auth(&key)
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("Network error during chat test: {e}"))?;
        let st = res.status();
        let txt = res.text().await.unwrap_or_default();
        if st.is_success() {
            chosen = model.clone();
            ok = true;
            break;
        }
        last_err = parse_api_error(st, &txt);
        // Don't try other models if the key itself is invalid / no credits
        let lower = last_err.to_lowercase();
        if st.as_u16() == 401
            || st.as_u16() == 403
            || lower.contains("credits")
            || lower.contains("invalid api key")
            || lower.contains("unauthorized")
        {
            return Err(last_err);
        }
    }
    if !ok {
        return Err(format!(
            "Key accepted, but chat failed (no usable Grok model).\n\
Tried: {}\n\
Buy credits at https://console.x.ai or create a new API key.\n\n{last_err}",
            candidates.join(", ")
        ));
    }

    let mut cfg = config::load_config().unwrap_or_else(|_| AppConfig::default());
    cfg.api_key = Some(key);
    cfg.model = chosen;
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

    // Keep the request small so chat stays snappy (long flyer history was huge)
    let recent: Vec<&ChatMessage> = req
        .messages
        .iter()
        .filter(|m| m.role == "user" || m.role == "assistant")
        .rev()
        .take(12)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();

    let mut messages: Vec<Value> = vec![json!({
        "role": "system",
        "content": system,
    })];

    for m in recent {
        messages.push(json!({
            "role": m.role,
            "content": build_message_content(m),
        }));
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(25))
        .build()
        .map_err(|e| e.to_string())?;

    let preferred = {
        let m = cfg.model.trim();
        if m.is_empty()
            || config::LEGACY_GROK_MODELS
                .iter()
                .any(|legacy| *legacy == m)
        {
            config::BASIC_GROK_MODEL.to_string()
        } else {
            m.to_string()
        }
    };

    // Live model list from xAI → auto-switch when ids are renamed
    let live = list_model_ids(&client, api_key.trim()).await;
    let try_models = rank_chat_models(&live, &preferred);
    chat_debug(&format!(
        "chat start preferred={preferred} live={} try={:?}",
        live.len(),
        try_models
    ));

    let mut last_err = String::new();
    let mut used_model = try_models
        .first()
        .cloned()
        .unwrap_or_else(|| config::BASIC_GROK_MODEL.to_string());

    for model in &try_models {
        let body = XaiRequest {
            model: model.clone(),
            messages: messages.clone(),
            temperature: 0.8,
            max_tokens: 512,
        };

        let res = match client
            .post("https://api.x.ai/v1/chat/completions")
            .bearer_auth(api_key.trim())
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await
        {
            Ok(r) => r,
            Err(e) => {
                last_err = format!("Network error: {e}");
                chat_debug(&format!("model={model} network_err={e}"));
                continue;
            }
        };

        let status = res.status();
        let text = res.text().await.unwrap_or_default();

        if !status.is_success() {
            last_err = parse_api_error(status, &text);
            chat_debug(&format!(
                "model={model} http={} err={}",
                status.as_u16(),
                last_err.chars().take(160).collect::<String>()
            ));
            let lower = last_err.to_lowercase();
            // Stop immediately on auth / credits — other models won't help
            if status.as_u16() == 401
                || status.as_u16() == 403
                || lower.contains("credits")
                || lower.contains("invalid api key")
                || lower.contains("unauthorized")
            {
                return Err(last_err);
            }
            // Otherwise try next model (retired id, not found, etc.)
            continue;
        }

        match extract_assistant_text(&text) {
            Ok(content) => {
                used_model = model.clone();
                if used_model != cfg.model {
                    let mut next = cfg.clone();
                    next.model = used_model.clone();
                    let _ = config::save_config(&next);
                    chat_debug(&format!("switched model -> {used_model}"));
                }
                chat_debug(&format!(
                    "ok model={used_model} reply_len={}",
                    content.len()
                ));
                let expression = pick_expression(last_user, &content).to_string();
                return Ok(ChatResponse {
                    message: content,
                    expression,
                });
            }
            Err(e) => {
                last_err = e;
                chat_debug(&format!("model={model} parse_err={last_err}"));
                continue;
            }
        }
    }

    chat_debug(&format!("all models failed: {last_err}"));
    Err(if last_err.is_empty() {
        format!(
            "Grok chat failed — no usable model.\n\
Tried: {}\n\
Buy credits / check key at https://console.x.ai",
            try_models.join(", ")
        )
    } else {
        last_err
    })
}
