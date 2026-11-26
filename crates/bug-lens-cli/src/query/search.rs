//! 会话包跨维度全文检索与上下文摘要片段生成器（内置 SVG 噪音折叠与 UTF-8 安全切片）。

use crate::format::element::{format_interaction_line, squash_whitespace};
use crate::format::time::format_relative_time;
use crate::pack::session_pack::LoadedSessionPack;
use crate::pack::types::{js_num, StackTraceField};
use regex::Regex;
use serde::Serialize;
use std::collections::HashSet;
use std::sync::OnceLock;

fn svg_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?is)<svg\b[^>]*>.*?</svg>").expect("valid svg regex"))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub scope: String,
    #[serde(rename = "ref")]
    pub ref_id: String,
    #[serde(
        skip_serializing_if = "Option::is_none",
        serialize_with = "js_num::serialize_opt"
    )]
    pub relative_ms: Option<f64>,
    pub snippet: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchPackResult {
    pub query: String,
    pub total_hits: usize,
    pub hits: Vec<SearchHit>,
}

#[derive(Debug, Default, Clone)]
pub struct SearchPackOptions {
    pub query: String,
    pub scopes: Option<Vec<String>>,
    pub limit: Option<usize>,
    pub context_chars: Option<usize>,
}

fn contains_ascii_ignore_case(haystack: &str, needle_ascii_lower: &[u8]) -> bool {
    haystack
        .as_bytes()
        .windows(needle_ascii_lower.len())
        .any(|w| w.eq_ignore_ascii_case(needle_ascii_lower))
}

fn find_char_boundary_left(s: &str, mut idx: usize) -> usize {
    idx = idx.min(s.len());
    while idx > 0 && !s.is_char_boundary(idx) {
        idx -= 1;
    }
    idx
}

fn advance_chars_byte_pos(s: &str, start_byte: usize, max_chars: usize) -> usize {
    let mut end = start_byte;
    for (count, (off, ch)) in s[start_byte..].char_indices().enumerate() {
        if count >= max_chars {
            return start_byte + off;
        }
        end = start_byte + off + ch.len_utf8();
    }
    end
}

fn retreat_chars_byte_pos(s: &str, end_byte: usize, max_chars: usize) -> usize {
    let mut start = end_byte;
    for (count, (off, _)) in s[..end_byte].char_indices().rev().enumerate() {
        start = off;
        if count + 1 >= max_chars {
            break;
        }
    }
    start
}

pub fn make_snippets(
    raw_text: &str,
    needle_lower: &str,
    radius: usize,
    max_matches: usize,
) -> Vec<String> {
    let text_cow = if !needle_lower.contains("svg") && contains_ascii_ignore_case(raw_text, b"<svg") {
        svg_regex().replace_all(raw_text, "<svg/>")
    } else {
        std::borrow::Cow::Borrowed(raw_text)
    };
    let text = text_cow.as_ref();
    let mut ranges: Vec<(usize, usize)> = Vec::new();

    if !needle_lower.is_empty() && max_matches > 0 {
        if text.is_ascii() && needle_lower.is_ascii() {
            // ASCII 快路径：字节偏移 == 字符偏移，零额外堆分配完成 O(N) 窗口切片
            let text_bytes = text.as_bytes();
            let needle_bytes = needle_lower.as_bytes();
            if text_bytes.len() >= needle_bytes.len() {
                let mut pos = 0usize;
                let max_start = text_bytes.len() - needle_bytes.len();
                while pos <= max_start && ranges.len() < max_matches {
                    if let Some(rel) = text_bytes[pos..]
                        .windows(needle_bytes.len())
                        .position(|w| w.eq_ignore_ascii_case(needle_bytes))
                    {
                        let idx = pos + rel;
                        let start = idx.saturating_sub(radius);
                        let end = (idx + needle_bytes.len() + radius).min(text_bytes.len());
                        if let Some(prev) = ranges.last_mut() {
                            if start <= prev.1 {
                                prev.1 = prev.1.max(end);
                            } else {
                                ranges.push((start, end));
                            }
                        } else {
                            ranges.push((start, end));
                        }
                        pos = idx + needle_bytes.len().max(1);
                    } else {
                        break;
                    }
                }
            }
        } else {
            // 非 ASCII 路径：使用标准 `to_lowercase()` 对齐外层 `contains()` 的 Unicode 1-to-many 折叠语义
            let text_lower = text.to_lowercase();
            let mut search_from = 0usize;
            while search_from < text_lower.len() && ranges.len() < max_matches {
                let Some(rel) = text_lower[search_from..].find(needle_lower) else {
                    break;
                };
                let lower_idx = search_from + rel;
                // 按字节比例定位近似原文位置后再扩展安全窗口做局部精确对齐
                let approx_byte = if text_lower.len() == text.len() {
                    lower_idx
                } else {
                    ((lower_idx as f64 / text_lower.len().max(1) as f64) * text.len() as f64)
                        as usize
                };
                let approx_char = find_char_boundary_left(text, approx_byte);
                let orig_byte = if text_lower.len() == text.len() {
                    approx_char
                } else {
                    // 仅在小窗口或必要时映射 char_idx；对于极少数不同长度的 Unicode 文本统计前置字符数
                    let target_lower_chars = text_lower[..lower_idx].chars().count();
                    let mut acc = 0usize;
                    let mut mapped = 0usize;
                    for (b_idx, ch) in text.char_indices() {
                        if acc >= target_lower_chars {
                            mapped = b_idx;
                            break;
                        }
                        acc += ch.to_lowercase().count();
                        mapped = b_idx + ch.len_utf8();
                    }
                    mapped
                };
                let needle_char_len = needle_lower.chars().count().max(1);
                let start = retreat_chars_byte_pos(text, orig_byte, radius);
                let after_needle = advance_chars_byte_pos(text, orig_byte, needle_char_len);
                let end = advance_chars_byte_pos(text, after_needle, radius);
                if let Some(prev) = ranges.last_mut() {
                    if start <= prev.1 {
                        prev.1 = prev.1.max(end);
                    } else {
                        ranges.push((start, end));
                    }
                } else {
                    ranges.push((start, end));
                }
                search_from = lower_idx + needle_lower.len().max(1);
            }
        }
    }

    if ranges.is_empty() {
        let end = advance_chars_byte_pos(text, 0, radius * 2);
        return vec![squash_whitespace(&text[..end])];
    }

    ranges
        .into_iter()
        .map(|(start, end)| {
            let prefix = if start > 0 { "…" } else { "" };
            let suffix = if end < text.len() { "…" } else { "" };
            format!("{prefix}{}{suffix}", squash_whitespace(&text[start..end]))
        })
        .collect()
}

pub fn search_session_pack(
    pack: &LoadedSessionPack,
    options: &SearchPackOptions,
) -> SearchPackResult {
    let needle = options.query.trim();
    if needle.is_empty() {
        return SearchPackResult {
            query: String::new(),
            total_hits: 0,
            hits: Vec::new(),
        };
    }
    let needle_lower = needle.to_lowercase();
    let scopes: HashSet<String> = match options.scopes.as_ref() {
        Some(s) if !s.is_empty() => s.iter().map(|x| x.to_lowercase()).collect(),
        _ => [
            "console",
            "network-url",
            "network-body",
            "interactions",
            "framework",
        ]
        .into_iter()
        .map(String::from)
        .collect(),
    };
    let limit = options.limit.unwrap_or(30).max(1);
    let radius = options.context_chars.unwrap_or(180).clamp(40, 2000);
    let mut hits = Vec::new();
    let mut total_hits = 0usize;

    let push_hit = |hits: &mut Vec<SearchHit>, total: &mut usize, hit: SearchHit| {
        *total += 1;
        if hits.len() < limit {
            hits.push(hit);
        }
    };

    if scopes.contains("console") {
        for (idx, entry) in pack.get_console_entries().iter().enumerate() {
            let stack_part = match &entry.stack_trace {
                Some(StackTraceField::Text(s)) => s.clone(),
                Some(StackTraceField::Frames(frames)) => {
                    serde_json::to_string(frames).unwrap_or_default()
                }
                None => entry.stack.clone().unwrap_or_default(),
            };
            let hay = format!(
                "{} {} {stack_part}",
                entry.text.as_deref().unwrap_or(""),
                entry.url.as_deref().unwrap_or("")
            );
            if hay.to_lowercase().contains(&needle_lower) {
                if hits.len() >= limit {
                    total_hits += 1;
                    continue;
                }
                let rel = pack.to_relative_ms(entry.created_at);
                let snippet = make_snippets(&hay, &needle_lower, radius, 1)
                    .into_iter()
                    .next()
                    .unwrap_or_default();
                push_hit(
                    &mut hits,
                    &mut total_hits,
                    SearchHit {
                        scope: "console".to_string(),
                        ref_id: format!("console#{idx}"),
                        relative_ms: rel,
                        snippet: format!(
                            "{} [{}] {snippet}",
                            format_relative_time(rel),
                            entry.level.as_deref().unwrap_or("log")
                        ),
                    },
                );
            }
        }
    }

    if scopes.contains("network-url") {
        for entry in pack.get_network_entries() {
            if entry.url.to_lowercase().contains(&needle_lower) {
                if hits.len() >= limit {
                    total_hits += 1;
                    continue;
                }
                let rel = pack.to_relative_ms(entry.created_at);
                push_hit(
                    &mut hits,
                    &mut total_hits,
                    SearchHit {
                        scope: "network-url".to_string(),
                        ref_id: entry.id.clone(),
                        relative_ms: rel,
                        snippet: format!(
                            "{} {} {} {}",
                            format_relative_time(rel),
                            entry.method.as_deref().unwrap_or("GET"),
                            entry.status.unwrap_or(0),
                            entry.url
                        ),
                    },
                );
            }
        }
    }

    if scopes.contains("network-body") {
        for entry in pack.get_network_entries() {
            if let Some(body) = pack.get_network_body(entry) {
                if body.to_lowercase().contains(&needle_lower) {
                    if hits.len() >= limit {
                        total_hits += 1;
                        continue;
                    }
                    let rel = pack.to_relative_ms(entry.created_at);
                    let snippets = make_snippets(&body, &needle_lower, radius, 3);
                    for snippet in snippets {
                        push_hit(
                            &mut hits,
                            &mut total_hits,
                            SearchHit {
                                scope: "network-body".to_string(),
                                ref_id: entry.id.clone(),
                                relative_ms: rel,
                                snippet: format!(
                                    "{} ({}) {snippet}",
                                    format_relative_time(rel),
                                    entry.url
                                ),
                            },
                        );
                    }
                }
            }
        }
    }

    if scopes.contains("interactions") {
        for (idx, item) in pack.get_interactions().iter().enumerate() {
            let rel = pack.to_relative_ms(item.created_at);
            let line = format_interaction_line(item, idx, rel);
            let raw_json = item
                .element
                .as_ref()
                .or(item.target.as_ref())
                .and_then(|e| serde_json::to_string(e).ok())
                .unwrap_or_else(|| "{}".to_string());
            if line.to_lowercase().contains(&needle_lower)
                || raw_json.to_lowercase().contains(&needle_lower)
            {
                push_hit(
                    &mut hits,
                    &mut total_hits,
                    SearchHit {
                        scope: "interactions".to_string(),
                        ref_id: format!("interaction#{idx}"),
                        relative_ms: rel,
                        snippet: line,
                    },
                );
            }
        }
    }

    if scopes.contains("framework") {
        for (idx, st) in pack.get_framework_states().iter().enumerate() {
            let raw = serde_json::to_string(st).unwrap_or_default();
            if raw.to_lowercase().contains(&needle_lower) {
                if hits.len() >= limit {
                    total_hits += 1;
                    continue;
                }
                let rel = pack.to_relative_ms(st.captured_at_epoch_ms);
                let snippets = make_snippets(&raw, &needle_lower, radius, 2);
                for snippet in snippets {
                    push_hit(
                        &mut hits,
                        &mut total_hits,
                        SearchHit {
                            scope: "framework".to_string(),
                            ref_id: format!("frameworkState#{idx}"),
                            relative_ms: rel,
                            snippet: format!(
                                "{} [trigger={}] {snippet}",
                                format_relative_time(rel),
                                st.trigger.as_deref().unwrap_or("?")
                            ),
                        },
                    );
                }
            }
        }
    }

    SearchPackResult {
        query: needle.to_string(),
        total_hits,
        hits,
    }
}
