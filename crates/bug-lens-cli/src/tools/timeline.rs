//! `timeline` 命令：按时间顺序合并用户交互、控制台报错、网络请求与问题现场。

use crate::error::{CliError, CliResult};
use crate::format::budget::{apply_char_budget, apply_json_budget};
use crate::pack::open::{open_pack_with_options, OpenOptions};
use crate::pack::LoadedPack;
use crate::query::timeline::{query_timeline, TimelineQueryOptions};

/// `timeline` 命令入参。
pub struct TimelineToolArgs<'a> {
    pub pack: Option<&'a str>,
    pub options: TimelineQueryOptions,
    pub format: &'a str,
    pub max_chars: Option<usize>,
}

/// 执行 `timeline` 命令。
pub fn run_timeline_tool(args: TimelineToolArgs<'_>) -> CliResult<String> {
    let loaded = open_pack_with_options(
        args.pack,
        OpenOptions {
            verify_integrity: false,
        },
    )?;
    let LoadedPack::Session(session) = &loaded else {
        return Err(CliError::new(format!(
            "UNSUPPORTED_PACK_KIND: timeline requires a session evidence pack, but \"{}\" is a screenshot pack.",
            args.pack.unwrap_or(loaded.pack_path())
        )));
    };

    let result = query_timeline(session, &args.options);
    if args.format == "json" {
        let serialized = serde_json::to_string_pretty(&result).unwrap_or_default();
        return Ok(apply_json_budget(&serialized, args.max_chars));
    }

    let mut lines = Vec::new();
    lines.push(format!(
        "# Unified Timeline ({}) — showing {} of {} events",
        result.window_description,
        result.events.len(),
        result.total_matched
    ));
    if result.events.is_empty() {
        lines.push("(No events matched the specified time window and filters)".to_string());
    } else {
        for ev in &result.events {
            lines.push(format!("- {}", ev.summary));
        }
    }
    if result.total_matched > result.events.len() {
        lines.push(format!(
            "\n… {} more events omitted. Pass a higher `limit` or narrow `fromMs`/`toMs`.",
            result.total_matched - result.events.len()
        ));
    }

    Ok(apply_char_budget(&lines.join("\n"), args.max_chars, None))
}
