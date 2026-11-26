//! `get_screenshot` 命令：定位工作区内的步骤截图、问题现场图或截图包主图（支持 text 与 json 输出）。

use crate::error::{CliError, CliResult};
use crate::format::budget::apply_json_budget;
use crate::pack::open::{open_pack_with_options, OpenOptions};
use crate::pack::LoadedPack;
use crate::tools::image_helper::{
    build_image_text_blocks, export_pack_image_to_temp, infer_image_mime_type,
};
use serde_json::json;

/// `get_screenshot` 命令入参。
pub struct GetScreenshotArgs<'a> {
    pub pack: Option<&'a str>,
    pub kind: Option<&'a str>,
    pub step: Option<usize>,
    pub scene_id: Option<&'a str>,
    pub format: &'a str,
    pub max_chars: Option<usize>,
}

fn format_screenshot_output(
    loaded: &LoadedPack,
    kind: &str,
    rel_path: &str,
    label: &str,
    format: &str,
    max_chars: Option<usize>,
) -> Vec<String> {
    if format == "json" {
        let saved_path = export_pack_image_to_temp(loaded, rel_path);
        let byte_length = loaded.get_file_byte_length(rel_path).unwrap_or(0);
        let payload = json!({
            "kind": kind,
            "relativePath": rel_path,
            "savedPath": saved_path,
            "byteLength": byte_length,
            "mimeType": infer_image_mime_type(rel_path),
            "label": label,
        });
        let serialized = serde_json::to_string_pretty(&payload).unwrap_or_default();
        return vec![apply_json_budget(&serialized, max_chars)];
    }
    build_image_text_blocks(loaded, rel_path, Some(label))
}

/// 执行 `get_screenshot` 命令。
pub fn run_get_screenshot_tool(args: GetScreenshotArgs<'_>) -> CliResult<Vec<String>> {
    let loaded = open_pack_with_options(
        args.pack,
        OpenOptions {
            verify_integrity: false,
        },
    )?;

    if let LoadedPack::Screenshot(ss) = &loaded {
        let img_path = ss.get_screenshot_image_path().ok_or_else(|| {
            CliError::new(format!(
                "SCREENSHOT_NOT_FOUND: No screenshot image found in screenshot pack \"{}\".",
                args.pack.unwrap_or(loaded.pack_path())
            ))
        })?;
        return Ok(format_screenshot_output(
            &loaded,
            "screenshot",
            img_path,
            "Screenshot pack image",
            args.format,
            args.max_chars,
        ));
    }

    let LoadedPack::Session(session) = &loaded else {
        unreachable!()
    };

    let kind = args.kind.unwrap_or_else(|| {
        if args.step.is_some() {
            "step"
        } else {
            "issue-annotated"
        }
    });

    if kind == "step" {
        let step_num = args.step.unwrap_or(1);
        for ext in ["jpg", "png", "jpeg", "webp"] {
            let candidate = format!("screenshots/step-{step_num}.{ext}");
            if session.storage.has(&candidate) {
                let summary = session
                    .data
                    .screenshot_summaries
                    .as_deref()
                    .and_then(|list| list.iter().find(|s| s.step == Some(step_num)));
                let label = match summary {
                    Some(s) => {
                        let elapsed = s.elapsed_ms.unwrap_or(0.0);
                        let elapsed_str = if elapsed.fract() == 0.0 {
                            format!("{}", elapsed as i64)
                        } else {
                            format!("{elapsed}")
                        };
                        format!(
                            "Step {step_num} screenshot (+{elapsed_str}ms [{}] {})",
                            s.kind.as_deref().unwrap_or("?"),
                            s.element.as_deref().unwrap_or("")
                        )
                    }
                    None => format!("Step {step_num} screenshot"),
                };
                return Ok(format_screenshot_output(
                    &loaded,
                    kind,
                    &candidate,
                    &label,
                    args.format,
                    args.max_chars,
                ));
            }
        }
        let available_steps: Vec<String> = session
            .storage
            .iter_entries()
            .into_iter()
            .map(|(k, _)| k)
            .filter(|k| k.starts_with("screenshots/step-"))
            .take(15)
            .collect();
        return Err(CliError::new(format!(
            "STEP_SCREENSHOT_NOT_FOUND: Screenshot for step {step_num} not found. Available sample: [{}]",
            available_steps.join(", ")
        )));
    }

    let scenes = session.get_issue_scenes();
    if scenes.is_empty() {
        return Err(CliError::new(
            "SCENE_SCREENSHOT_NOT_FOUND: Pack has no issueScenes. Use kind=\"step\" with step=1..N to inspect interaction screenshots.",
        ));
    }

    let target = match args.scene_id {
        Some(sid) => scenes
            .iter()
            .find(|s| s.id == sid || s.index.to_string() == sid),
        None => scenes.first(),
    };
    let Some(target) = target else {
        return Err(CliError::new(format!(
            "SCENE_NOT_FOUND: Scene \"{}\" not found in pack.",
            args.scene_id.unwrap_or("")
        )));
    };

    let rel_path = if kind == "issue-original" {
        target
            .original_source
            .as_deref()
            .or(target.annotated_source.as_deref())
    } else {
        target
            .annotated_source
            .as_deref()
            .or(target.original_source.as_deref())
    };
    let Some(rel_path) = rel_path else {
        return Err(CliError::new(format!(
            "SCENE_IMAGE_MISSING: Scene \"{}\" does not have a {kind} image file.",
            target.id
        )));
    };

    let label = format!("Scene [{}] ({}) {kind}", target.index, target.id);
    Ok(format_screenshot_output(
        &loaded,
        kind,
        rel_path,
        &label,
        args.format,
        args.max_chars,
    ))
}
