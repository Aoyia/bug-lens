//! `query_console` 命令：按级别、关键字、正则与时间窗筛选控制台日志。

use crate::error::{CliError, CliResult};
use crate::format::budget::{apply_char_budget, apply_json_budget};
use crate::pack::open::{open_pack_with_options, OpenOptions};
use crate::pack::LoadedPack;
use crate::query::console::{format_console_item, query_console, ConsoleQueryOptions};
use regex::RegexBuilder;
use serde_json::json;

/// `query_console` 命令入参。
pub struct QueryConsoleToolArgs<'a> {
    pub pack: Option<&'a str>,
    pub options: ConsoleQueryOptions,
    pub format: &'a str,
    pub max_chars: Option<usize>,
}

/// 执行 `query_console` 命令。
pub fn run_query_console_tool(args: QueryConsoleToolArgs<'_>) -> CliResult<String> {
    let loaded = open_pack_with_options(
        args.pack,
        OpenOptions {
            verify_integrity: false,
        },
    )?;

    // 截图包模式：检索 environment.json 中记录的近期控制台报错
    if let LoadedPack::Screenshot(ss) = &loaded {
        let raw_errors = ss
            .environment
            .as_ref()
            .and_then(|e| e.recent_console_errors.as_deref())
            .unwrap_or(&[]);
        let search_lower = args.options.search.as_ref().map(|s| s.to_lowercase());
        let regex_obj = match args.options.regex.as_deref() {
            Some(pat) => Some(
                RegexBuilder::new(pat)
                    .case_insensitive(true)
                    .build()
                    .map_err(|err| CliError::new(format!("INVALID_REGEX: {err}")))?,
            ),
            None => None,
        };
        let matched: Vec<_> = raw_errors
            .iter()
            .filter(|e| {
                let hay = format!(
                    "{}\n{}",
                    e.message.as_deref().unwrap_or(""),
                    e.stack.as_deref().unwrap_or("")
                );
                if let Some(ref needle) = search_lower {
                    if !hay.to_lowercase().contains(needle) {
                        return false;
                    }
                }
                if let Some(ref re) = regex_obj {
                    if !re.is_match(&hay) {
                        return false;
                    }
                }
                true
            })
            .collect();

        if args.format == "json" {
            let payload = json!({
                "totalEntries": raw_errors.len(),
                "matchedCount": matched.len(),
                "items": matched,
            });
            let serialized = serde_json::to_string_pretty(&payload).unwrap_or_default();
            return Ok(apply_json_budget(&serialized, args.max_chars));
        }

        let mut lines = vec![format!(
            "# Screenshot Pack Console Errors ({} of {})",
            matched.len(),
            raw_errors.len()
        )];
        for (idx, e) in matched.iter().enumerate() {
            let stack_part = match e.stack.as_deref().filter(|s| !s.is_empty()) {
                Some(st) => {
                    let preview = st.split('\n').take(4).collect::<Vec<_>>().join("\n    ");
                    format!("\n    {preview}")
                }
                None => String::new(),
            };
            lines.push(format!(
                "[#{idx}] [ERROR] {}{stack_part}",
                e.message.as_deref().unwrap_or("")
            ));
        }
        return Ok(apply_char_budget(&lines.join("\n"), args.max_chars, None));
    }

    let LoadedPack::Session(session) = &loaded else {
        unreachable!()
    };

    let res = query_console(session, &args.options)?;
    if args.format == "json" {
        let serialized = serde_json::to_string_pretty(&res).unwrap_or_default();
        return Ok(apply_json_budget(&serialized, args.max_chars));
    }

    let mut lines = Vec::new();
    lines.push(format!(
        "# Console Logs (matched {} of {} total, showing offset={}..{})",
        res.matched_count,
        res.total_entries,
        res.offset,
        res.offset + res.items.len()
    ));
    if res.items.is_empty() {
        lines.push("(No console entries matched the given filters)".to_string());
    } else {
        for item in &res.items {
            lines.push(format_console_item(item));
        }
    }
    let remaining = res
        .matched_count
        .saturating_sub(res.offset + res.items.len());
    if remaining > 0 {
        lines.push(format!(
            "\n… {remaining} more entries available. Use offset={} to continue.",
            res.offset + res.items.len()
        ));
    }

    Ok(apply_char_budget(&lines.join("\n"), args.max_chars, None))
}
