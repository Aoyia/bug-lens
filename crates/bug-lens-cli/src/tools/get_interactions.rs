//! `get_interactions` 命令：分页列出录制期间的用户交互序列，并按需附带前 3 张步骤截图路径。

use crate::error::{CliError, CliResult};
use crate::format::budget::{apply_char_budget, apply_json_budget};
use crate::format::element::format_interaction_line;
use crate::pack::open::{open_pack_with_options, OpenOptions};
use crate::pack::types::{js_num, InteractionEntry};
use crate::pack::LoadedPack;
use crate::tools::image_helper::{build_image_text_blocks, export_pack_image_to_temp};
use serde::Serialize;
use std::collections::HashSet;

/// `get_interactions` 命令入参。
pub struct GetInteractionsArgs<'a> {
    pub pack: Option<&'a str>,
    pub from_index: Option<usize>,
    pub limit: Option<usize>,
    pub kinds: Option<Vec<String>>,
    pub include_screenshot: bool,
    pub format: &'a str,
    pub max_chars: Option<usize>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct IndexedInteraction<'a> {
    index: usize,
    #[serde(
        skip_serializing_if = "Option::is_none",
        serialize_with = "js_num::serialize_opt"
    )]
    relative_ms: Option<f64>,
    item: &'a InteractionEntry,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportedInteractionShot {
    index: usize,
    relative_path: String,
    saved_path: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct InteractionsJsonOutput<'a> {
    total_interactions: usize,
    matched_count: usize,
    items: Vec<IndexedInteraction<'a>>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    exported_screenshots: Vec<ExportedInteractionShot>,
}

/// 执行 `get_interactions` 命令。
pub fn run_get_interactions_tool(args: GetInteractionsArgs<'_>) -> CliResult<Vec<String>> {
    let loaded = open_pack_with_options(
        args.pack,
        OpenOptions {
            verify_integrity: false,
        },
    )?;
    let LoadedPack::Session(session) = &loaded else {
        return Err(CliError::new(format!(
            "UNSUPPORTED_PACK_KIND: get_interactions requires a session evidence pack, but \"{}\" is a screenshot pack.",
            args.pack.unwrap_or(loaded.pack_path())
        )));
    };

    let all = session.get_interactions();
    let kind_set: Option<HashSet<String>> = args.kinds.as_ref().and_then(|ks| {
        if ks.is_empty() {
            None
        } else {
            Some(ks.iter().map(|k| k.to_lowercase()).collect())
        }
    });

    let indexed: Vec<IndexedInteraction<'_>> = all
        .iter()
        .enumerate()
        .filter(|(index, item)| {
            if let Some(from) = args.from_index {
                if *index < from {
                    return false;
                }
            }
            if let Some(ref set) = kind_set {
                let k = item.kind.as_deref().unwrap_or("").to_lowercase();
                if !set.contains(&k) {
                    return false;
                }
            }
            true
        })
        .map(|(index, item)| IndexedInteraction {
            index,
            relative_ms: session.to_relative_ms(item.created_at).or(item.elapsed_ms),
            item,
        })
        .collect();

    let matched_count = indexed.len();
    let limit = args.limit.unwrap_or(60).max(1);
    let sliced: Vec<IndexedInteraction<'_>> = indexed.into_iter().take(limit).collect();

    let text_out = if args.format == "json" {
        let mut exported_screenshots = Vec::new();
        if args.include_screenshot {
            for row in sliced.iter().take(3) {
                if let Some(img_path) = row
                    .item
                    .screenshot
                    .as_ref()
                    .and_then(|s| s.data_url.as_deref())
                    .filter(|url| !url.starts_with("data:") && !url.is_empty())
                {
                    exported_screenshots.push(ExportedInteractionShot {
                        index: row.index,
                        relative_path: img_path.to_string(),
                        saved_path: export_pack_image_to_temp(&loaded, img_path),
                    });
                }
            }
        }
        let payload = InteractionsJsonOutput {
            total_interactions: all.len(),
            matched_count,
            items: sliced
                .iter()
                .map(|x| IndexedInteraction {
                    index: x.index,
                    relative_ms: x.relative_ms,
                    item: x.item,
                })
                .collect(),
            exported_screenshots,
        };
        let serialized = serde_json::to_string_pretty(&payload).unwrap_or_default();
        apply_json_budget(&serialized, args.max_chars)
    } else {
        let mut lines = Vec::new();
        lines.push(format!(
            "# Recorded Interactions (showing {} of {matched_count} matched, total={})",
            sliced.len(),
            all.len()
        ));
        if sliced.is_empty() {
            lines.push("(No interactions matched)".to_string());
        } else {
            for row in &sliced {
                lines.push(format!(
                    "- {}",
                    format_interaction_line(row.item, row.index, row.relative_ms)
                ));
            }
        }
        if matched_count > sliced.len() {
            let next_idx = sliced.last().map(|x| x.index + 1).unwrap_or(0);
            lines.push(format!(
                "\n… {} more interactions available. Pass fromIndex={next_idx} to continue.",
                matched_count - sliced.len()
            ));
        }
        apply_char_budget(&lines.join("\n"), args.max_chars, None)
    };

    let mut blocks = vec![text_out];
    // JSON 模式下截图路径已内嵌 exportedScreenshots，避免破坏 JSON 语法
    if args.format != "json" && args.include_screenshot {
        for row in sliced.iter().take(3) {
            if let Some(img_path) = row
                .item
                .screenshot
                .as_ref()
                .and_then(|s| s.data_url.as_deref())
                .filter(|url| !url.starts_with("data:") && !url.is_empty())
            {
                let label = format!("Interaction [{}] screenshot", row.index);
                blocks.extend(build_image_text_blocks(&loaded, img_path, Some(&label)));
            }
        }
    }
    Ok(blocks)
}
