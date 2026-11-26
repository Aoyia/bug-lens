//! 控制台日志检索、SourceMap 位置解析与堆栈格式化引擎。

use crate::error::{CliError, CliResult};
use crate::format::time::format_relative_time;
use crate::pack::session_pack::LoadedSessionPack;
use crate::pack::types::{js_num, StackTraceField};
use regex::RegexBuilder;
use serde::Serialize;
use std::collections::HashSet;

#[derive(Debug, Default, Clone)]
pub struct ConsoleQueryOptions {
    pub levels: Option<Vec<String>>,
    pub search: Option<String>,
    pub regex: Option<String>,
    pub from_ms: Option<f64>,
    pub to_ms: Option<f64>,
    pub offset: Option<usize>,
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsoleQueryItem {
    pub index: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(
        skip_serializing_if = "Option::is_none",
        serialize_with = "js_num::serialize_opt"
    )]
    pub relative_ms: Option<f64>,
    pub level: String,
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub location: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_mapped: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stack: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsoleQueryResult {
    pub total_entries: usize,
    pub matched_count: usize,
    pub offset: usize,
    pub limit: usize,
    pub items: Vec<ConsoleQueryItem>,
}

pub fn normalize_stack_trace(
    stack_trace: Option<&StackTraceField>,
    fallback_stack: Option<&str>,
) -> Option<String> {
    match stack_trace {
        Some(StackTraceField::Text(s)) if !s.trim().is_empty() => Some(s.clone()),
        Some(StackTraceField::Frames(frames)) if !frames.is_empty() => {
            let joined = frames
                .iter()
                .map(|f| {
                    let fn_name = f
                        .function_name
                        .as_deref()
                        .filter(|s| !s.is_empty())
                        .unwrap_or("<anonymous>");
                    let loc = match f.source_mapped_location.as_ref() {
                        Some(sm)
                            if sm.resolved == Some(true)
                                && sm.original_file.as_deref().is_some_and(|s| !s.is_empty()) =>
                        {
                            format!(
                                "{}:{}",
                                sm.original_file.as_deref().unwrap_or("?"),
                                sm.original_line.unwrap_or(0)
                            )
                        }
                        _ => format!(
                            "{}:{}",
                            f.url.as_deref().unwrap_or("?"),
                            f.line_number.unwrap_or(0)
                        ),
                    };
                    format!("at {fn_name} ({loc})")
                })
                .collect::<Vec<_>>()
                .join("\n");
            Some(joined)
        }
        _ => fallback_stack.map(|s| s.to_string()),
    }
}

pub fn query_console(
    pack: &LoadedSessionPack,
    options: &ConsoleQueryOptions,
) -> CliResult<ConsoleQueryResult> {
    let entries = pack.get_console_entries();
    let level_set: Option<HashSet<String>> = options.levels.as_ref().and_then(|lvls| {
        if lvls.is_empty() {
            return None;
        }
        let mut set = HashSet::new();
        for l in lvls {
            let lower = l.to_lowercase();
            if lower == "warn" || lower == "warning" {
                set.insert("warn".to_string());
                set.insert("warning".to_string());
            } else {
                set.insert(lower);
            }
        }
        Some(set)
    });

    let search_lower = options.search.as_ref().map(|s| s.to_lowercase());
    let regex_obj = match options.regex.as_deref() {
        Some(pat) => Some(
            RegexBuilder::new(pat)
                .case_insensitive(true)
                .build()
                .map_err(|err| CliError::new(format!("INVALID_REGEX: {err}")))?,
        ),
        None => None,
    };

    let mut matched = Vec::new();

    for (index, entry) in entries.iter().enumerate() {
        let level = entry.level.as_deref().unwrap_or("log").to_lowercase();
        if let Some(ref set) = level_set {
            if !set.contains(&level) {
                continue;
            }
        }

        let rel_ms = pack.to_relative_ms(entry.created_at);
        if let (Some(from_ms), Some(r)) = (options.from_ms, rel_ms) {
            if r < from_ms {
                continue;
            }
        }
        if let (Some(to_ms), Some(r)) = (options.to_ms, rel_ms) {
            if r > to_ms {
                continue;
            }
        }

        let text = entry.text.as_deref().unwrap_or("").to_string();
        let url = entry
            .url
            .as_deref()
            .or(entry.source.as_deref())
            .unwrap_or("");
        let stack_str = normalize_stack_trace(entry.stack_trace.as_ref(), entry.stack.as_deref());
        let haystack = format!("{text}\n{url}\n{}", stack_str.as_deref().unwrap_or(""));

        if let Some(ref needle) = search_lower {
            if !haystack.to_lowercase().contains(needle) {
                continue;
            }
        }
        if let Some(ref re) = regex_obj {
            if !re.is_match(&haystack) {
                continue;
            }
        }

        let location = if !url.is_empty() {
            Some(match entry.line_number {
                Some(ln) => format!("{url}:{ln}"),
                None => url.to_string(),
            })
        } else {
            None
        };

        let source_mapped = entry.source_mapped_location.as_ref().and_then(|sm| {
            if sm.resolved == Some(true) {
                if let Some(orig_file) = sm.original_file.as_deref().filter(|s| !s.is_empty()) {
                    let line = sm.original_line.unwrap_or(0);
                    let col_part = match sm.original_column {
                        Some(c) => format!(":{c}"),
                        None => String::new(),
                    };
                    let fn_part = sm
                        .original_function_name
                        .as_deref()
                        .or(sm.original_name.as_deref())
                        .filter(|s| !s.is_empty())
                        .map(|f| format!(" ({f})"))
                        .unwrap_or_default();
                    return Some(format!("{orig_file}:{line}{col_part}{fn_part}"));
                }
            }
            None
        });

        matched.push(ConsoleQueryItem {
            index,
            id: entry.id.clone(),
            relative_ms: rel_ms,
            level,
            text,
            location,
            source_mapped,
            stack: stack_str,
        });
    }

    let offset = options.offset.unwrap_or(0);
    let limit = options.limit.unwrap_or(50).max(1);
    let matched_count = matched.len();
    let items = matched.into_iter().skip(offset).take(limit).collect();

    Ok(ConsoleQueryResult {
        total_entries: entries.len(),
        matched_count,
        offset,
        limit,
        items,
    })
}

pub fn format_console_item(item: &ConsoleQueryItem) -> String {
    let time_str = format_relative_time(item.relative_ms);
    let loc_part = if let Some(ref sm) = item.source_mapped {
        format!(
            " ({} -> {sm})",
            item.location.as_deref().unwrap_or("?")
        )
    } else if let Some(ref loc) = item.location {
        format!(" ({loc})")
    } else {
        String::new()
    };
    let mut line = format!(
        "[#{}] {time_str} [{}] {}{loc_part}",
        item.index,
        item.level.to_uppercase(),
        item.text
    );
    if let Some(ref stack) = item.stack {
        let stack_lines = stack
            .split('\n')
            .take(5)
            .map(|l| format!("    {}", l.trim()))
            .collect::<Vec<_>>()
            .join("\n");
        line.push('\n');
        line.push_str(&stack_lines);
    }
    line
}
