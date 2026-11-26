//! 网络请求筛选（异常优先排序）与单条请求详情/响应体 JSONPath 提取引擎。

use crate::error::{CliError, CliResult};
use crate::format::budget::slice_chars;
use crate::format::time::{format_duration, format_relative_time};
use crate::pack::session_pack::LoadedSessionPack;
use crate::pack::types::{js_num, NetworkDetailEntry, NetworkEntry};
use crate::query::json_path::evaluate_json_path;
use serde::Serialize;
use serde_json::Value;
use std::collections::HashSet;

#[derive(Debug, Clone)]
pub enum NetworkStatusFilter {
    All,
    Failed,
    Range4xx,
    Range5xx,
    Range2xx,
    Range3xx,
    Codes(Vec<u16>),
}

impl NetworkStatusFilter {
    pub fn parse(raw: &str) -> Self {
        let trimmed = raw.trim();
        if trimmed
            .split(',')
            .all(|part| !part.is_empty() && part.chars().all(|c| c.is_ascii_digit()))
        {
            let codes: Vec<u16> = trimmed
                .split(',')
                .filter_map(|p| p.parse::<u16>().ok())
                .collect();
            if !codes.is_empty() {
                return Self::Codes(codes);
            }
        }
        match trimmed.to_lowercase().as_str() {
            "failed" => Self::Failed,
            "4xx" => Self::Range4xx,
            "5xx" => Self::Range5xx,
            "2xx" => Self::Range2xx,
            "3xx" => Self::Range3xx,
            _ => Self::All,
        }
    }
}

#[derive(Debug, Default, Clone)]
pub struct NetworkQueryOptions {
    pub status: Option<NetworkStatusFilter>,
    pub url_contains: Option<String>,
    pub method: Option<String>,
    pub r#type: Option<String>,
    pub offset: Option<usize>,
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkSummaryRow {
    pub id: String,
    #[serde(
        skip_serializing_if = "Option::is_none",
        serialize_with = "js_num::serialize_opt"
    )]
    pub relative_ms: Option<f64>,
    pub method: String,
    pub status: u16,
    #[serde(
        skip_serializing_if = "Option::is_none",
        serialize_with = "js_num::serialize_opt"
    )]
    pub duration_ms: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub r#type: Option<String>,
    pub url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mime_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body_status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub byte_length: Option<u64>,
    pub has_body: bool,
    pub is_failure: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkQueryResult {
    pub total_entries: usize,
    pub matched_count: usize,
    pub offset: usize,
    pub limit: usize,
    pub items: Vec<NetworkSummaryRow>,
}

fn matches_status_filter(entry: &NetworkEntry, filter: Option<&NetworkStatusFilter>) -> bool {
    let Some(filter) = filter else {
        return true;
    };
    let st = entry.status.unwrap_or(0);
    let is_err = entry.is_failure();
    match filter {
        NetworkStatusFilter::All => true,
        NetworkStatusFilter::Failed => is_err,
        NetworkStatusFilter::Range4xx => (400..500).contains(&st),
        NetworkStatusFilter::Range5xx => (500..600).contains(&st),
        NetworkStatusFilter::Range2xx => (200..300).contains(&st),
        NetworkStatusFilter::Range3xx => (300..400).contains(&st),
        NetworkStatusFilter::Codes(codes) => codes.contains(&st),
    }
}

pub fn query_network(
    pack: &LoadedSessionPack,
    options: &NetworkQueryOptions,
) -> NetworkQueryResult {
    let entries = pack.get_network_entries();
    let url_needle = options.url_contains.as_ref().map(|s| s.to_lowercase());
    let method_upper = options.method.as_ref().map(|s| s.to_uppercase());
    let type_lower = options.r#type.as_ref().map(|s| s.to_lowercase());

    let mut matched = Vec::new();
    for entry in entries {
        if !matches_status_filter(entry, options.status.as_ref()) {
            continue;
        }
        if let Some(ref needle) = url_needle {
            if !entry.url.to_lowercase().contains(needle) {
                continue;
            }
        }
        if let Some(ref m) = method_upper {
            if entry.method.as_deref().unwrap_or("GET").to_uppercase() != *m {
                continue;
            }
        }
        if let Some(ref t) = type_lower {
            if entry.r#type.as_deref().unwrap_or("").to_lowercase() != *t {
                continue;
            }
        }

        let st = entry.status.unwrap_or(0);
        let is_failure = entry.is_failure();
        let has_body = entry
            .response
            .as_ref()
            .is_some_and(|r| {
                r.body_path.as_deref().is_some_and(|s| !s.is_empty())
                    || r.body.is_some()
                    || r.body_status.as_deref() == Some("captured")
            });

        matched.push(NetworkSummaryRow {
            id: entry.id.clone(),
            relative_ms: pack.to_relative_ms(entry.created_at),
            method: entry.method.clone().unwrap_or_else(|| "GET".to_string()),
            status: st,
            duration_ms: entry.duration_ms,
            r#type: entry.r#type.clone(),
            url: entry.url.clone(),
            mime_type: entry.response.as_ref().and_then(|r| r.mime_type.clone()),
            body_status: entry.response.as_ref().and_then(|r| r.body_status.clone()),
            byte_length: entry.response.as_ref().and_then(|r| r.byte_length),
            has_body,
            is_failure,
        });
    }

    if options.status.is_none() {
        matched.sort_by(|a, b| {
            if a.is_failure != b.is_failure {
                return if a.is_failure {
                    std::cmp::Ordering::Less
                } else {
                    std::cmp::Ordering::Greater
                };
            }
            let ra = a.relative_ms.unwrap_or(0.0);
            let rb = b.relative_ms.unwrap_or(0.0);
            ra.partial_cmp(&rb).unwrap_or(std::cmp::Ordering::Equal)
        });
    }

    let offset = options.offset.unwrap_or(0);
    let limit = options.limit.unwrap_or(50).max(1);
    let matched_count = matched.len();
    let items = matched.into_iter().skip(offset).take(limit).collect();

    NetworkQueryResult {
        total_entries: entries.len(),
        matched_count,
        offset,
        limit,
        items,
    }
}

pub fn format_network_row(row: &NetworkSummaryRow) -> String {
    let time_str = format_relative_time(row.relative_ms);
    let dur_str = format_duration(row.duration_ms);
    let flag = if row.is_failure { "!" } else { "" };
    let body_tag = if row.has_body {
        match row.byte_length {
            Some(b) => format!("[body:{b}B]"),
            None => "[body:?B]".to_string(),
        }
    } else {
        format!("[{}]", row.body_status.as_deref().unwrap_or("no-body"))
    };
    format!(
        "{} | {time_str} | {} {flag}{} ({dur_str}) | {} | {body_tag} | {}",
        row.id,
        row.method,
        row.status,
        row.r#type.as_deref().unwrap_or("?"),
        row.url
    )
}

#[derive(Debug, Default, Clone)]
pub struct InspectRequestOptions {
    pub include: Option<Vec<String>>,
    pub json_path: Option<String>,
    pub body_max_chars: Option<usize>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InspectedRequestResult {
    pub entry: NetworkEntry,
    #[serde(
        skip_serializing_if = "Option::is_none",
        serialize_with = "js_num::serialize_opt"
    )]
    pub relative_ms: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<NetworkDetailEntry>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extracted_json: Option<Value>,
    pub body_truncated: bool,
}

pub fn inspect_network_request(
    pack: &LoadedSessionPack,
    request_id: &str,
    options: &InspectRequestOptions,
) -> CliResult<InspectedRequestResult> {
    let entries = pack.get_network_entries();
    let entry = entries
        .iter()
        .find(|e| e.id == request_id)
        .or_else(|| {
            entries
                .iter()
                .find(|e| e.id.ends_with(request_id) || e.url.contains(request_id))
        })
        .ok_or_else(|| {
            CliError::new(format!(
                "REQUEST_NOT_FOUND: No network entry found matching \"{request_id}\". Call query_network first to list available entry IDs."
            ))
        })?;

    let include_set: HashSet<String> = match options.include.as_deref() {
        Some(list) if !list.is_empty() => list.iter().map(|s| s.trim().to_lowercase()).collect(),
        _ => ["summary", "headers", "initiator", "body"]
            .into_iter()
            .map(String::from)
            .collect(),
    };

    let details = if include_set.contains("headers")
        || include_set.contains("initiator")
        || include_set.contains("body")
        || include_set.contains("request-body")
        || include_set.contains("request_body")
    {
        pack.get_network_details().get(&entry.id).cloned()
    } else {
        None
    };

    let mut body_text = None;
    let mut extracted_json = None;
    let mut body_truncated = false;

    if include_set.contains("body") || options.json_path.is_some() {
        if let Some(raw_body) = pack.get_network_body(entry) {
            if let Some(ref jp) = options.json_path {
                let parsed: Value = serde_json::from_str(&raw_body).map_err(|err| {
                    CliError::new(format!(
                        "INVALID_RESPONSE_JSON: Cannot evaluate jsonPath \"{jp}\" because response body is not valid JSON ({err})"
                    ))
                })?;
                extracted_json = Some(evaluate_json_path(&parsed, jp));
            } else {
                let max_chars = options.body_max_chars.unwrap_or(8000);
                if raw_body.chars().count() > max_chars {
                    body_text = Some(slice_chars(&raw_body, max_chars).to_string());
                    body_truncated = true;
                } else {
                    body_text = Some(raw_body);
                }
            }
        }
    }

    Ok(InspectedRequestResult {
        entry: entry.clone(),
        relative_ms: pack.to_relative_ms(entry.created_at),
        details,
        body_text,
        extracted_json,
        body_truncated,
    })
}
