//! `extract_pack` 命令：描述当前已解压工作区，或将证据包（含录屏与派生 JSON）复制到指定目录。

use crate::error::CliResult;
use crate::format::budget::apply_json_budget;
use crate::pack::open::{
    describe_workspace, extract_pack_to_disk, get_pack_workspace_dir, open_pack_with_options,
    OpenOptions,
};

/// `extract_pack` 命令入参。
pub struct ExtractPackArgs<'a> {
    pub pack: Option<&'a str>,
    pub dest: Option<&'a str>,
    pub format: &'a str,
}

/// 执行 `extract_pack` 命令。
pub fn run_extract_pack_tool(args: ExtractPackArgs<'_>) -> CliResult<String> {
    let loaded = open_pack_with_options(
        args.pack,
        OpenOptions {
            verify_integrity: false,
        },
    )?;
    let workspace_dir = get_pack_workspace_dir(&loaded);
    let res = if args.dest.is_none() {
        if let Some(ref ws) = workspace_dir {
            describe_workspace(&loaded, ws)
        } else {
            extract_pack_to_disk(&loaded, None)?
        }
    } else {
        extract_pack_to_disk(&loaded, args.dest)?
    };

    if args.format == "json" {
        let serialized = serde_json::to_string_pretty(&res).unwrap_or_default();
        return Ok(apply_json_budget(&serialized, None));
    }

    let mut lines = Vec::new();
    lines.push("# Extracted Bug Lens Pack".to_string());
    lines.push(format!("- **Destination**: `{}`", res.dest_dir));
    lines.push(format!("- **Written Files**: {}", res.written_files.len()));
    if !res.renamed_paths.is_empty() {
        lines.push(format!(
            "- **Sanitized Filenames (Windows-safe)**: {} file(s) had reserved characters (`:` etc.) replaced with `_` and references updated in `data/session-data.js`.",
            res.renamed_paths.len()
        ));
    }
    if let Some(ref spec) = res.reproduce_spec_path {
        lines.push(format!("- **Playwright Reproduction Spec**: `{spec}`"));
        lines.push(format!(
            "  - Run command: `npx playwright test --headed \"{spec}\"`"
        ));
    }
    if let Some(ref html) = res.report_html_path {
        lines.push(format!("- **Interactive HTML Report**: `{html}`"));
    }
    if let Some(ref shot) = res.screenshot_path {
        lines.push(format!("- **Screenshot File**: `{shot}`"));
    }

    Ok(lines.join("\n"))
}
