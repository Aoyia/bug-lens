//! `query_network` 命令：按状态码、URL、Method 与资源类型筛选网络请求（默认异常请求置顶）。

use crate::error::CliResult;
use crate::format::budget::{apply_char_budget, apply_json_budget};
use crate::pack::open::{open_pack_with_options, OpenOptions};
use crate::pack::LoadedPack;
use crate::query::network::{format_network_row, query_network, NetworkQueryOptions};
use serde_json::json;

/// `query_network` 命令入参。
pub struct QueryNetworkToolArgs<'a> {
    pub pack: Option<&'a str>,
    pub options: NetworkQueryOptions,
    pub format: &'a str,
    pub max_chars: Option<usize>,
}

/// 执行 `query_network` 命令。
pub fn run_query_network_tool(args: QueryNetworkToolArgs<'_>) -> CliResult<String> {
    let loaded = open_pack_with_options(
        args.pack,
        OpenOptions {
            verify_integrity: false,
        },
    )?;

    // 截图包模式：检索 environment.json 中记录的近期失败请求
    if let LoadedPack::Screenshot(ss) = &loaded {
        let raw_reqs = ss
            .environment
            .as_ref()
            .and_then(|e| e.recent_failed_requests.as_deref())
            .unwrap_or(&[]);
        let url_needle = args.options.url_contains.as_ref().map(|s| s.to_lowercase());
        let method_upper = args.options.method.as_ref().map(|s| s.to_uppercase());
        let matched: Vec<_> = raw_reqs
            .iter()
            .filter(|r| {
                if let Some(ref needle) = url_needle {
                    if !r.url.as_deref().unwrap_or("").to_lowercase().contains(needle) {
                        return false;
                    }
                }
                if let Some(ref m) = method_upper {
                    if r.method.as_deref().unwrap_or("GET").to_uppercase() != *m {
                        return false;
                    }
                }
                true
            })
            .collect();

        if args.format == "json" {
            let payload = json!({
                "totalEntries": raw_reqs.len(),
                "matchedCount": matched.len(),
                "items": matched,
            });
            let serialized = serde_json::to_string_pretty(&payload).unwrap_or_default();
            return Ok(apply_json_budget(&serialized, args.max_chars));
        }

        let mut lines = vec![format!(
            "# Screenshot Pack Failed Network Requests ({} of {})",
            matched.len(),
            raw_reqs.len()
        )];
        for (idx, r) in matched.iter().enumerate() {
            lines.push(format!(
                "- [#{idx}] {} !{} {} | {}",
                r.method.as_deref().unwrap_or("GET"),
                r.status.unwrap_or(0),
                r.status_text.as_deref().unwrap_or(""),
                r.url.as_deref().unwrap_or("")
            ));
        }
        return Ok(apply_char_budget(&lines.join("\n"), args.max_chars, None));
    }

    let LoadedPack::Session(session) = &loaded else {
        unreachable!()
    };

    let res = query_network(session, &args.options);
    if args.format == "json" {
        let serialized = serde_json::to_string_pretty(&res).unwrap_or_default();
        return Ok(apply_json_budget(&serialized, args.max_chars));
    }

    let mut lines = Vec::new();
    lines.push(format!(
        "# Network Requests (matched {} of {} total, showing offset={}..{})",
        res.matched_count,
        res.total_entries,
        res.offset,
        res.offset + res.items.len()
    ));
    if res.items.is_empty() {
        lines.push("(No network requests matched the given filters)".to_string());
    } else {
        for row in &res.items {
            lines.push(format!("- {}", format_network_row(row)));
        }
    }
    let remaining = res
        .matched_count
        .saturating_sub(res.offset + res.items.len());
    if remaining > 0 {
        lines.push(format!(
            "\n… {remaining} more requests available. Use offset={} to continue, or call get_request(id) to inspect a specific request.",
            res.offset + res.items.len()
        ));
    }

    Ok(apply_char_budget(&lines.join("\n"), args.max_chars, None))
}
