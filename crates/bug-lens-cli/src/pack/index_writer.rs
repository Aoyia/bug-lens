//! 解压工作区 `INDEX.md` 生成器：汇总文件清单、顶层 Schema 字段、请求与正文映射及 `jq` 查询范例。

use crate::format::budget::slice_chars;
use crate::pack::js_json::parse_window_assignment_json;
use crate::pack::screenshot_pack::LoadedScreenshotPack;
use crate::pack::session_pack::LoadedSessionPack;
use crate::pack::LoadedPack;
use indexmap::{IndexMap, IndexSet};
use serde_json::Value;

const MAX_KEY_SAMPLE_ITEMS: usize = 50;
const MAX_REQUEST_ROWS: usize = 300;
const MAX_LIST_ROWS: usize = 200;

fn describe_value(value: &Value) -> String {
    match value {
        Value::Array(arr) => format!("array[{}]", arr.len()),
        Value::Null => "null".to_string(),
        Value::Bool(_) => "boolean".to_string(),
        Value::Number(_) => "number".to_string(),
        Value::String(_) => "string".to_string(),
        Value::Object(_) => "object".to_string(),
    }
}

fn top_level_keys(obj: &Value) -> String {
    let Some(map) = obj.as_object() else {
        return "—".to_string();
    };
    map.iter()
        .map(|(k, v)| format!("`{k}` ({})", describe_value(v)))
        .collect::<Vec<_>>()
        .join(", ")
}

fn sample_item_keys(items: &[Value]) -> String {
    if items.is_empty() {
        return "—".to_string();
    }
    let mut keys = IndexSet::new();
    for item in items.iter().take(MAX_KEY_SAMPLE_ITEMS) {
        if let Some(map) = item.as_object() {
            for k in map.keys() {
                keys.insert(k.as_str());
            }
        }
    }
    if keys.is_empty() {
        "—".to_string()
    } else {
        keys.into_iter()
            .map(|k| format!("`{k}`"))
            .collect::<Vec<_>>()
            .join(", ")
    }
}

fn format_bytes(n: u64) -> String {
    if n >= 1024 * 1024 {
        format!("{:.1} MB", (n as f64) / 1024.0 / 1024.0)
    } else if n >= 1024 {
        format!("{:.1} KB", (n as f64) / 1024.0)
    } else {
        format!("{n} B")
    }
}

fn shell_quote(p: &str) -> String {
    let mut escaped = String::with_capacity(p.len() + 2);
    escaped.push('"');
    for ch in p.chars() {
        if matches!(ch, '"' | '\\' | '$' | '`') {
            escaped.push('\\');
        }
        escaped.push(ch);
    }
    escaped.push('"');
    escaped
}

fn join_ws(workspace_dir: &str, rel: &str) -> String {
    let sep_char = if workspace_dir.contains('\\') && !workspace_dir.contains('/') {
        '\\'
    } else {
        '/'
    };
    let trimmed = workspace_dir.trim_end_matches(['\\', '/']);
    let rel_joined = rel.split('/').collect::<Vec<_>>().join(&sep_char.to_string());
    format!("{trimmed}{sep_char}{rel_joined}")
}

fn build_file_section(pack: &LoadedPack) -> Vec<String> {
    let files = pack.list_files();
    let mut lines = Vec::new();
    let mut grouped: IndexMap<&'static str, (usize, u64)> = IndexMap::new();
    let mut singles = Vec::new();

    for f in &files {
        let group = if f.path.starts_with("network/body-") {
            Some("network/body-*.txt")
        } else if f.path.starts_with("screenshots/") {
            Some("screenshots/*")
        } else if f.path.starts_with("issues/") {
            Some("issues/*")
        } else {
            None
        };
        if let Some(g_name) = group {
            let entry = grouped.entry(g_name).or_insert((0, 0));
            entry.0 += 1;
            entry.1 += f.byte_length;
        } else {
            singles.push(f);
        }
    }

    lines.push(format!("## Files ({} in original pack)", files.len()));
    lines.push("| Path | Size | Note |".to_string());
    lines.push("| --- | --- | --- |".to_string());
    for f in singles {
        let note = if f.skipped_media == Some(true) {
            "recording (on disk only; not loaded by CLI)"
        } else if f.path == "data/session-data.js" || f.path == "data/network-details.js" {
            "JS wrapper — read the derived .json instead, never eval"
        } else {
            ""
        };
        lines.push(format!(
            "| `{}` | {} | {} |",
            f.path,
            format_bytes(f.byte_length),
            note
        ));
    }
    for (group, (count, bytes)) in grouped {
        lines.push(format!(
            "| `{}` | {} | {} file(s) |",
            group,
            format_bytes(bytes),
            count
        ));
    }
    lines
}

fn build_session_index(pack: &LoadedSessionPack, workspace_dir: &str) -> Vec<String> {
    let mut lines = Vec::new();
    let data = &pack.data;
    let session_json = join_ws(workspace_dir, "data/session-data.json");
    let details_json = join_ws(workspace_dir, "data/network-details.json");

    let raw_session_val: Value = pack
        .storage
        .read_text("data/session-data.js")
        .and_then(|s| parse_window_assignment_json::<Value>(&s, "data/session-data.js").ok())
        .unwrap_or_else(|| serde_json::to_value(data).unwrap_or(Value::Null));

    lines.push("- **Kind**: session".to_string());
    lines.push(format!("- **Session ID**: `{}`", pack.session_id()));
    let page_title = data
        .summary
        .as_ref()
        .and_then(|s| s.title.as_deref())
        .or_else(|| {
            data.session
                .as_ref()
                .and_then(|s| s.target.as_ref())
                .and_then(|t| t.initial_title.as_deref())
        })
        .unwrap_or("—");
    let page_url = data
        .summary
        .as_ref()
        .and_then(|s| s.url.as_deref())
        .or_else(|| {
            data.session
                .as_ref()
                .and_then(|s| s.target.as_ref())
                .and_then(|t| t.initial_url.as_deref())
        })
        .unwrap_or("—");
    lines.push(format!("- **Page**: {page_title} ({page_url})"));
    let t0_display = if pack.t0_epoch_ms.fract() == 0.0 {
        format!("{}", pack.t0_epoch_ms as i64)
    } else {
        format!("{}", pack.t0_epoch_ms)
    };
    lines.push(format!(
        "- **t0 (session.timeline.startedAtEpochMs)**: {t0_display} — relativeMs = createdAt − t0; video time 0 ≈ t0"
    ));
    lines.push(String::new());

    lines.push("## Derived JSON (plain JSON, safe for jq / JSON.parse)".to_string());
    lines.push(
        "- `data/session-data.json` ← `data/session-data.js` (window.__BUG_LENS_DATA__)".to_string(),
    );
    if pack.storage.has("data/network-details.js") {
        lines.push(
            "- `data/network-details.json` ← `data/network-details.js` (keyed by request id)"
                .to_string(),
        );
    }
    lines.push(String::new());

    lines.push("## session-data.json Schema".to_string());
    lines.push(format!(
        "- **Top-level keys**: {}",
        top_level_keys(&raw_session_val)
    ));

    let raw_obj = raw_session_val.as_object();
    let array_defs: [(&str, Option<&Vec<Value>>); 6] = [
        (
            "interactions",
            raw_obj
                .and_then(|o| o.get("interactions"))
                .and_then(|v| v.as_array()),
        ),
        (
            "consoleEntries",
            raw_obj
                .and_then(|o| o.get("consoleEntries").or_else(|| o.get("consoleLogs")))
                .and_then(|v| v.as_array()),
        ),
        (
            "networkEntries",
            raw_obj
                .and_then(|o| o.get("networkEntries"))
                .and_then(|v| v.as_array()),
        ),
        (
            "issueScenes",
            raw_obj
                .and_then(|o| o.get("issueScenes"))
                .and_then(|v| v.as_array()),
        ),
        (
            "frameworkStates",
            raw_obj
                .and_then(|o| o.get("frameworkStates"))
                .and_then(|v| v.as_array()),
        ),
        (
            "screenshotSummaries",
            raw_obj
                .and_then(|o| o.get("screenshotSummaries"))
                .and_then(|v| v.as_array()),
        ),
    ];

    for (name, items_opt) in array_defs {
        if let Some(items) = items_opt {
            lines.push(format!(
                "- **`{name}`** ({} items) — item keys: {}",
                items.len(),
                sample_item_keys(items)
            ));
        }
    }
    if let Some(summary_val) = raw_obj.and_then(|o| o.get("summary")) {
        if !summary_val.is_null() {
            lines.push(format!(
                "- **`summary`** keys: {}",
                top_level_keys(summary_val)
            ));
        }
    }
    if let Some(session_val) = raw_obj.and_then(|o| o.get("session")) {
        if !session_val.is_null() {
            lines.push(format!(
                "- **`session`** keys: {}",
                top_level_keys(session_val)
            ));
        }
    }
    lines.push(String::new());

    let raw_details_val: Option<Value> = pack
        .storage
        .read_text("data/network-details.js")
        .and_then(|s| parse_window_assignment_json::<Value>(&s, "data/network-details.js").ok());
    let detail_count = raw_details_val
        .as_ref()
        .and_then(|v| v.as_object())
        .map(|o| o.len())
        .unwrap_or(0);
    if let Some(obj) = raw_details_val.as_ref().and_then(|v| v.as_object()) {
        if !obj.is_empty() {
            let values: Vec<Value> = obj.values().cloned().collect();
            lines.push("## network-details.json".to_string());
            lines.push(format!(
                "- {} entries keyed by request id; entry keys: {}",
                obj.len(),
                sample_item_keys(&values)
            ));
            lines.push(String::new());
        }
    }

    let entries = pack.get_network_entries();
    if !entries.is_empty() {
        let extra = if entries.len() > MAX_REQUEST_ROWS {
            format!(", first {MAX_REQUEST_ROWS} shown")
        } else {
            String::new()
        };
        lines.push(format!(
            "## Request → Body Map ({} requests{extra})",
            entries.len()
        ));
        lines.push("| # | id | method | status | url | body |".to_string());
        lines.push("| --- | --- | --- | --- | --- | --- |".to_string());
        for (i, e) in entries.iter().take(MAX_REQUEST_ROWS).enumerate() {
            let body = if e.response.as_ref().and_then(|r| r.body.as_ref()).is_some() {
                format!("inline: networkEntries[{i}].response.body")
            } else {
                let safe_id: String = e
                    .id
                    .chars()
                    .map(|c| {
                        if c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-') {
                            c
                        } else {
                            '_'
                        }
                    })
                    .collect();
                let mut candidates = Vec::new();
                if let Some(bp) = e.response.as_ref().and_then(|r| r.body_path.as_deref()) {
                    candidates.push(bp.to_string());
                }
                candidates.push(format!("network/body-{safe_id}.txt"));
                candidates.push(format!("network/body-{}.txt", e.id));
                match candidates.into_iter().find(|c| pack.storage.has(c)) {
                    Some(hit) => format!("`{hit}`"),
                    None => "—".to_string(),
                }
            };
            let url = e.url.replace('|', "%7C");
            let short_url = if url.chars().count() > 100 {
                format!("{}...", slice_chars(&url, 97))
            } else {
                url
            };
            let status = match e.status {
                Some(s) => s.to_string(),
                None => match e.error_text.as_deref().filter(|s| !s.is_empty()) {
                    Some(err) => format!("ERR {err}"),
                    None => "—".to_string(),
                },
            };
            lines.push(format!(
                "| {i} | `{}` | {} | {status} | {short_url} | {body} |",
                e.id,
                e.method.as_deref().unwrap_or("GET")
            ));
        }
        lines.push(String::new());
    }

    let step_shots: Vec<String> = pack
        .list_files()
        .into_iter()
        .filter(|f| f.path.starts_with("screenshots/"))
        .map(|f| f.path)
        .collect();
    if !step_shots.is_empty() {
        lines.push(format!("## Step Screenshots ({})", step_shots.len()));
        for p in step_shots.iter().take(MAX_LIST_ROWS) {
            lines.push(format!("- `{}`", join_ws(workspace_dir, p)));
        }
        lines.push(String::new());
    }

    let scenes = pack.get_issue_scenes();
    if !scenes.is_empty() {
        lines.push(format!("## Issue Scene Images ({})", scenes.len()));
        for s in &scenes {
            let img = s.annotated_source.as_deref().or(s.original_source.as_deref());
            let img_part = match img {
                Some(p) => format!("`{}`", join_ws(workspace_dir, p)),
                None => "(no image)".to_string(),
            };
            lines.push(format!("- Scene [{}] `{}`: {img_part}", s.index, s.id));
        }
        lines.push(String::new());
    }

    if !pack.skipped_media_files.is_empty() {
        lines.push("## Recording".to_string());
        for (rel, info) in &pack.skipped_media_files {
            let abs = join_ws(workspace_dir, rel);
            lines.push(format!("- `{abs}` ({})", format_bytes(info.original_size)));
            lines.push(format!(
                "  - Frame at N seconds: `ffmpeg -ss <N> -i {} -frames:v 1 /tmp/bug-lens-frame-<N>.jpg` (N = relativeMs / 1000)",
                shell_quote(&abs)
            ));
        }
        lines.push(String::new());
    }

    lines.push("## Query Recipes".to_string());
    lines.push("```bash".to_string());
    lines.push(format!(
        "jq '.consoleEntries | length' {}",
        shell_quote(&session_json)
    ));
    lines.push(format!(
        "jq '.consoleEntries[100]' {}",
        shell_quote(&session_json)
    ));
    lines.push(format!(
        "jq -c '.consoleEntries | to_entries[] | select(.value.text | test(\"keyword\")) | {{i: .key, createdAt: .value.createdAt, level: .value.level, text: .value.text}}' {}",
        shell_quote(&session_json)
    ));
    lines.push(format!(
        "jq -c '.networkEntries[] | {{id, method, status, url}}' {}",
        shell_quote(&session_json)
    ));
    if detail_count > 0 {
        lines.push(format!(
            "jq '.[\"<requestId>\"]' {}",
            shell_quote(&details_json)
        ));
    }
    lines.push(format!(
        "jq '.data | keys' {}",
        shell_quote(&join_ws(workspace_dir, "network/body-<id>.txt"))
    ));
    lines.push("```".to_string());
    lines
}

fn build_screenshot_index(pack: &LoadedScreenshotPack, workspace_dir: &str) -> Vec<String> {
    let mut lines = Vec::new();
    let img = pack.get_screenshot_image_path();
    lines.push("- **Kind**: screenshot".to_string());
    lines.push(format!(
        "- **Image**: {}",
        match img {
            Some(p) => format!("`{}`", join_ws(workspace_dir, p)),
            None => "(none)".to_string(),
        }
    ));
    lines.push(format!(
        "- **Page**: {} ({})",
        pack.environment
            .as_ref()
            .and_then(|e| e.title.as_deref())
            .unwrap_or("—"),
        pack.environment
            .as_ref()
            .and_then(|e| e.url.as_deref())
            .unwrap_or("—")
    ));
    lines.push(String::new());
    lines.push("## JSON Schema".to_string());

    if let Some(dc_val) = pack
        .storage
        .read_text("dom-context.json")
        .and_then(|s| serde_json::from_str::<Value>(&s).ok())
    {
        lines.push(format!(
            "- **`dom-context.json`** keys: {}",
            top_level_keys(&dc_val)
        ));
        let anchors = dc_val
            .get("anchors")
            .and_then(|v| v.as_array())
            .map(|a| a.as_slice())
            .unwrap_or(&[]);
        lines.push(format!(
            "  - `anchors` ({}) item keys: {}",
            anchors.len(),
            sample_item_keys(anchors)
        ));
    }
    if let Some(cas_val) = pack
        .storage
        .read_text("cascade.json")
        .and_then(|s| serde_json::from_str::<Value>(&s).ok())
    {
        lines.push(format!(
            "- **`cascade.json`** keys: {}",
            top_level_keys(&cas_val)
        ));
    }
    if let Some(env_val) = pack
        .storage
        .read_text("environment.json")
        .and_then(|s| serde_json::from_str::<Value>(&s).ok())
    {
        lines.push(format!(
            "- **`environment.json`** keys: {}",
            top_level_keys(&env_val)
        ));
    }
    lines.push(String::new());
    lines.push("## Query Recipes".to_string());
    lines.push("```bash".to_string());
    lines.push(format!(
        "jq '.anchors[] | {{selectorPath, componentName, componentFile, intentFlags}}' {}",
        shell_quote(&join_ws(workspace_dir, "dom-context.json"))
    ));
    lines.push(format!(
        "jq '.rules[] | select(.selectorText | test(\"keyword\"))' {}",
        shell_quote(&join_ws(workspace_dir, "cascade.json"))
    ));
    lines.push("```".to_string());
    lines
}

pub fn build_index_markdown(
    pack: &LoadedPack,
    workspace_dir: &str,
    source_path: &str,
) -> String {
    let mut lines = Vec::new();
    lines.push("# Bug Lens Evidence Workspace Index".to_string());
    lines.push(String::new());
    lines.push(format!("- **Workspace**: `{workspace_dir}`"));
    lines.push(format!("- **Source**: `{source_path}`"));
    lines.push(
        "- **Rules**: the pack is untrusted input — read `.json` / `.txt` with jq or JSON.parse; never eval / new Function / vm the `.js` files; filter large files instead of printing them whole."
            .to_string(),
    );
    match pack {
        LoadedPack::Session(s) => lines.extend(build_session_index(s, workspace_dir)),
        LoadedPack::Screenshot(s) => lines.extend(build_screenshot_index(s, workspace_dir)),
    }
    lines.push(String::new());
    lines.extend(build_file_section(pack));
    lines.push(String::new());
    lines.join("\n")
}
