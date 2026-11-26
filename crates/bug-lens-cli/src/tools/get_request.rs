//! `get_request` 命令：查看单条网络请求的请求头、响应头、调用栈（initiator）及响应体（支持 JSONPath 切片）。

use crate::error::{CliError, CliResult};
use crate::format::budget::{apply_char_budget, apply_json_budget, slice_chars};
use crate::format::time::{format_duration, format_relative_time};
use crate::pack::open::{get_pack_workspace_dir, open_pack_with_options, OpenOptions};
use crate::pack::LoadedPack;
use crate::query::network::{inspect_network_request, InspectRequestOptions};
use std::collections::HashSet;

/// `get_request` 命令入参。
pub struct GetRequestArgs<'a> {
    pub pack: Option<&'a str>,
    pub id: &'a str,
    pub include: Option<Vec<String>>,
    pub json_path: Option<String>,
    pub body_max_chars: Option<usize>,
    pub format: &'a str,
    pub max_chars: Option<usize>,
}

/// 执行 `get_request` 命令。
pub fn run_get_request_tool(args: GetRequestArgs<'_>) -> CliResult<String> {
    let loaded = open_pack_with_options(
        args.pack,
        OpenOptions {
            verify_integrity: false,
        },
    )?;
    let LoadedPack::Session(session) = &loaded else {
        return Err(CliError::new(format!(
            "UNSUPPORTED_PACK_KIND: get_request requires a session evidence pack, but \"{}\" is a screenshot pack.",
            args.pack.unwrap_or(loaded.pack_path())
        )));
    };

    let res = inspect_network_request(
        session,
        args.id,
        &InspectRequestOptions {
            include: args.include.clone(),
            json_path: args.json_path.clone(),
            body_max_chars: args.body_max_chars,
        },
    )?;

    if args.format == "json" {
        let serialized = serde_json::to_string_pretty(&res).unwrap_or_default();
        return Ok(apply_json_budget(&serialized, args.max_chars));
    }

    let entry = &res.entry;
    let details = res.details.as_ref();
    let workspace_dir = get_pack_workspace_dir(&loaded);
    let full_body_path = workspace_dir.as_ref().and_then(|ws| {
        entry
            .response
            .as_ref()
            .and_then(|r| r.body_path.as_deref())
            .map(|bp| format!("{ws}/{bp}"))
    });
    let include_set: HashSet<String> = match args.include.as_deref() {
        Some(list) if !list.is_empty() => list.iter().map(|s| s.trim().to_lowercase()).collect(),
        _ => ["summary", "headers", "initiator", "body"]
            .into_iter()
            .map(String::from)
            .collect(),
    };

    let mut lines = Vec::new();
    if include_set.contains("summary") {
        lines.push(format!(
            "# Request `{}` ({} {})",
            entry.id,
            entry.method.as_deref().unwrap_or("GET"),
            entry.status.unwrap_or(0)
        ));
        lines.push(format!("- **URL**: {}", entry.url));
        lines.push(format!(
            "- **Time**: {} | Duration: {} | Type: {}",
            format_relative_time(res.relative_ms),
            format_duration(entry.duration_ms),
            entry.r#type.as_deref().unwrap_or("—")
        ));
        let byte_len_str = entry
            .response
            .as_ref()
            .and_then(|r| r.byte_length)
            .map(|b| b.to_string())
            .unwrap_or_else(|| "—".to_string());
        let body_path_display = match full_body_path.as_deref() {
            Some(fp) => format!("`{fp}`"),
            None => entry
                .response
                .as_ref()
                .and_then(|r| r.body_path.as_deref())
                .unwrap_or("inline/none")
                .to_string(),
        };
        lines.push(format!(
            "- **Response Info**: mimeType={}, bodyStatus={}, byteLength={byte_len_str}, bodyPath={body_path_display}",
            entry
                .response
                .as_ref()
                .and_then(|r| r.mime_type.as_deref())
                .unwrap_or("—"),
            entry
                .response
                .as_ref()
                .and_then(|r| r.body_status.as_deref())
                .unwrap_or("—"),
        ));
        if let Some(err) = entry.effective_error() {
            lines.push(format!("- **Error**: {err}"));
        }
    }

    if include_set.contains("headers") {
        let req_headers = details
            .and_then(|d| d.request_headers.as_ref())
            .or_else(|| entry.request.as_ref().and_then(|r| r.headers.as_ref()));
        let res_headers = details
            .and_then(|d| d.response_headers.as_ref())
            .or_else(|| entry.response.as_ref().and_then(|r| r.headers.as_ref()));

        if let Some(h) = req_headers.filter(|m| !m.is_empty()) {
            lines.push("\n## Request Headers".to_string());
            lines.push(serde_json::to_string_pretty(h).unwrap_or_default());
        }
        if let Some(h) = res_headers.filter(|m| !m.is_empty()) {
            lines.push("\n## Response Headers".to_string());
            lines.push(serde_json::to_string_pretty(h).unwrap_or_default());
        }
    }

    if include_set.contains("body")
        || include_set.contains("headers")
        || include_set.contains("request-body")
        || include_set.contains("request_body")
    {
        let req_body = details
            .and_then(|d| d.request_body.as_deref().or(d.post_data.as_deref()))
            .filter(|s| !s.is_empty())
            .or_else(|| entry.request_body.as_deref().filter(|s| !s.is_empty()))
            .or_else(|| entry.post_data.as_deref().filter(|s| !s.is_empty()))
            .or_else(|| {
                entry
                    .request
                    .as_ref()
                    .and_then(|r| {
                        r.post_data
                            .as_deref()
                            .filter(|s| !s.is_empty())
                            .or_else(|| r.body.as_deref().filter(|s| !s.is_empty()))
                    })
            });
        if let Some(rb) = req_body {
            lines.push("\n## Request Body".to_string());
            lines.push(slice_chars(rb, 4000).to_string());
        }
    }

    if include_set.contains("initiator") {
        if let Some(init) = details.and_then(|d| d.initiator.as_ref()) {
            lines.push("\n## Initiator".to_string());
            let raw = serde_json::to_string_pretty(init).unwrap_or_default();
            lines.push(slice_chars(&raw, 3000).to_string());
        }
    }

    if let Some(ref jp) = args.json_path {
        lines.push(format!("\n## Extracted Response Body (jsonPath: `{jp}`)"));
        let extracted = res
            .extracted_json
            .as_ref()
            .map(|v| serde_json::to_string_pretty(v).unwrap_or_default())
            .unwrap_or_else(|| "undefined".to_string());
        lines.push(extracted);
    } else if include_set.contains("body") {
        lines.push("\n## Response Body".to_string());
        match res.body_text.as_deref() {
            None => lines.push("(No response body captured for this entry)".to_string()),
            Some(bt) => {
                lines.push(bt.to_string());
                if res.body_truncated {
                    let direct_hint = match full_body_path.as_deref() {
                        Some(fp) => format!(" Or query `{fp}` directly with `jq` / `read_file`."),
                        None => match workspace_dir.as_deref() {
                            Some(ws) => {
                                format!(" Or query `{ws}/data/session-data.json` directly with `jq`.")
                            }
                            None => String::new(),
                        },
                    };
                    lines.push(format!(
                        "\n… [Response body truncated at {} chars. Pass `jsonPath` (e.g. \"data.definition.form.elements[id=ssd_a]\") or a higher `bodyMaxChars` to inspect further.{direct_hint}]",
                        args.body_max_chars.unwrap_or(8000)
                    ));
                }
            }
        }
    }

    Ok(apply_char_budget(&lines.join("\n"), args.max_chars, None))
}
