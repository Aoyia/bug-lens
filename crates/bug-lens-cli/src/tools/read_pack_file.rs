//! `read_pack_file` 命令：读取证据包内任意文本/JSON/JS 包装文件，或工作区派生产物（INDEX.md、data/*.json）。

use crate::error::{CliError, CliResult};
use crate::format::budget::{
    apply_char_budget_paginated, apply_json_budget, nth_char_byte_idx, resolve_char_budget,
};
use crate::pack::js_json::parse_window_assignment_json;
use crate::pack::open::{
    clean_canonical_path, get_pack_workspace_dir, open_pack_with_options, OpenOptions,
};
use crate::query::json_path::evaluate_json_path;
use serde_json::Value;
use std::fs;
use std::path::Path;

/// `read_pack_file` 命令入参。
pub struct ReadPackFileArgs<'a> {
    pub pack: Option<&'a str>,
    pub path: &'a str,
    pub json_path: Option<&'a str>,
    pub offset: Option<usize>,
    pub max_chars: Option<usize>,
}

/// 安全读取解压工作区内的派生文件（严格校验路径不得越出工作区根目录）。
fn read_workspace_file(workspace_dir: Option<&str>, rel_path: &str) -> Option<String> {
    let ws = workspace_dir?;
    let root = clean_canonical_path(Path::new(ws));
    let mut target = root.clone();
    for seg in rel_path.split('/') {
        if seg.is_empty() || seg == "." {
            continue;
        }
        if seg == ".." {
            return None;
        }
        target.push(seg);
    }
    if !target.exists() {
        return None;
    }
    let canon_target = clean_canonical_path(&target);
    if !canon_target.starts_with(&root) {
        return None;
    }
    fs::read_to_string(canon_target).ok()
}

/// 执行 `read_pack_file` 命令。
pub fn run_read_pack_file_tool(args: ReadPackFileArgs<'_>) -> CliResult<String> {
    let loaded = open_pack_with_options(
        args.pack,
        OpenOptions {
            verify_integrity: false,
        },
    )?;
    let clean_path = args
        .path
        .strip_prefix("./")
        .or_else(|| args.path.strip_prefix('/'))
        .unwrap_or(args.path);
    let workspace_dir = get_pack_workspace_dir(&loaded);
    let raw_text = loaded
        .get_text_file(clean_path)
        .or_else(|| read_workspace_file(workspace_dir.as_deref(), clean_path));

    let Some(raw_text) = raw_text else {
        let available: Vec<String> = loaded
            .list_files()
            .into_iter()
            .map(|f| f.path)
            .take(30)
            .collect();
        return Err(CliError::new(format!(
            "FILE_NOT_FOUND_IN_PACK: \"{clean_path}\" does not exist in pack. Available files sample: [{}]",
            available.join(", ")
        )));
    };

    if let Some(jp) = args.json_path {
        let parsed: Value = if clean_path.ends_with(".js") {
            parse_window_assignment_json(&raw_text, clean_path)?
        } else {
            serde_json::from_str(&raw_text).map_err(|err| {
                CliError::new(format!(
                    "INVALID_JSON_FILE: Cannot apply jsonPath \"{jp}\" to \"{clean_path}\": {err}"
                ))
            })?
        };
        let extracted = evaluate_json_path(&parsed, jp);
        let serialized = serde_json::to_string_pretty(&extracted).unwrap_or_default();
        return Ok(apply_json_budget(&serialized, args.max_chars));
    }

    let start_offset = args.offset.unwrap_or(0);
    // 统一采用 resolve_char_budget，并以实际输出的原文字符数精确推算 next_offset，确保跨页零漏字
    let effective_max = resolve_char_budget(args.max_chars);
    let total_chars = raw_text.chars().count();
    let start_byte = nth_char_byte_idx(&raw_text, start_offset);
    let sliced = &raw_text[start_byte..];

    Ok(apply_char_budget_paginated(
        sliced,
        Some(effective_max),
        |emitted_chars| {
            let next_offset = start_offset.saturating_add(emitted_chars);
            if total_chars > next_offset {
                format!("Use offset={next_offset} to read the next chunk (total {total_chars} chars).")
            } else {
                "Pass a larger maxChars or narrower filter/jsonPath to inspect further.".to_string()
            }
        },
    ))
}
