//! `get_scene` 命令：检查会话问题现场（IssueScene）或截图批注包的 DOM 锚点与 CSS 级联规则。

use crate::error::{CliError, CliResult};
use crate::format::budget::{apply_char_budget, apply_json_budget, slice_chars};
use crate::format::element::format_element_compact;
use crate::format::time::format_relative_time;
use crate::pack::open::{open_pack_with_options, OpenOptions};
use crate::pack::LoadedPack;
use crate::query::cascade::{extract_layout_deviations, query_screenshot_dom_and_cascade};
use crate::tools::image_helper::{build_image_text_blocks, export_pack_image_to_temp};
use serde_json::{json, Value};

/// `get_scene` 命令入参。
pub struct GetSceneArgs<'a> {
    pub pack: Option<&'a str>,
    pub scene_id: Option<&'a str>,
    pub scene_index: Option<usize>,
    pub selector: Option<&'a str>,
    pub css_property: Option<&'a str>,
    pub include_image: Option<bool>,
    pub format: &'a str,
    pub max_chars: Option<usize>,
}

/// 执行 `get_scene` 命令，返回文本块列表（供 CLI 以空行拼接）。
pub fn run_get_scene_tool(args: GetSceneArgs<'_>) -> CliResult<Vec<String>> {
    let loaded = open_pack_with_options(
        args.pack,
        OpenOptions {
            verify_integrity: false,
        },
    )?;
    let idx_str = args.scene_index.map(|i| i.to_string());
    let effective_scene_id = args.scene_id.or(idx_str.as_deref());

    if let LoadedPack::Screenshot(ss) = &loaded {
        let anchors = ss
            .dom_context
            .as_ref()
            .and_then(|d| d.anchors.as_deref())
            .unwrap_or(&[]);
        let text_comments: Vec<&str> = anchors
            .iter()
            .filter_map(|a| a.intent_flags.as_ref()?.text_comment.as_deref())
            .filter(|s| !s.is_empty())
            .collect();
        let deviations = extract_layout_deviations(ss.dom_context.as_ref());
        let filter_selector = args.selector.or(effective_scene_id);

        let text_out = if args.format == "json" {
            let filtered_anchors: Vec<_> = match filter_selector {
                Some(sel) => {
                    let needle = sel.to_lowercase();
                    anchors
                        .iter()
                        .enumerate()
                        .filter(|(idx, a)| {
                            let hay = format!(
                                "{idx} {} {} {} {}",
                                a.selector.as_deref().unwrap_or(""),
                                a.selector_path.as_deref().unwrap_or(""),
                                a.component_name.as_deref().unwrap_or(""),
                                a.inner_text.as_deref().unwrap_or("")
                            )
                            .to_lowercase();
                            hay.contains(&needle)
                        })
                        .map(|(_, a)| a)
                        .collect()
                }
                None => anchors.iter().collect(),
            };
            let mut root = serde_json::Map::new();
            root.insert("kind".to_string(), json!("screenshot"));
            if let Some(sca) = ss
                .dom_context
                .as_ref()
                .and_then(|d| d.smallest_common_ancestor_selector.as_ref())
            {
                root.insert("smallestCommonAncestorSelector".to_string(), json!(sca));
            }
            root.insert("textComments".to_string(), json!(text_comments));
            root.insert("deviations".to_string(), json!(deviations));
            root.insert("anchors".to_string(), json!(filtered_anchors));
            if let Some(sp) = ss.get_screenshot_image_path() {
                root.insert("screenshotPath".to_string(), json!(sp));
                if args.include_image.unwrap_or(true) {
                    if let Some(saved) = export_pack_image_to_temp(&loaded, sp) {
                        root.insert("savedImagePath".to_string(), json!(saved));
                    }
                }
            }
            let serialized = serde_json::to_string_pretty(&Value::Object(root)).unwrap_or_default();
            apply_json_budget(&serialized, args.max_chars)
        } else {
            let mut lines = Vec::new();
            lines.push("# Screenshot Scene, DOM Anchors & CSS Cascade".to_string());
            let comment_str = if text_comments.is_empty() {
                "(none — expectation must be treated as inferred hypothesis)".to_string()
            } else {
                text_comments.join(" | ")
            };
            lines.push(format!("- **Text Annotations**: {comment_str}"));
            lines.push(format!(
                "- **Smallest Common Ancestor**: `{}`",
                ss.dom_context
                    .as_ref()
                    .and_then(|d| d.smallest_common_ancestor_selector.as_deref())
                    .unwrap_or("—")
            ));
            if !deviations.is_empty() {
                lines.push(format!(
                    "\n## Auto-Detected Layout/Overflow Deviations ({})",
                    deviations.len()
                ));
                for d in &deviations {
                    let indices: Vec<String> = d
                        .anchor_indices
                        .iter()
                        .take(6)
                        .map(|i| i.to_string())
                        .collect();
                    let style_part = match d.key_styles.as_ref() {
                        Some(ks) => format!(
                            " | styles={}",
                            serde_json::to_string(ks).unwrap_or_default()
                        ),
                        None => String::new(),
                    };
                    lines.push(format!(
                        "- ⚠️ **[{}] `{}`** (anchors: [{}]) — {}{style_part}",
                        d.kind,
                        d.selector_path.as_deref().unwrap_or(&d.selector),
                        indices.join(","),
                        d.summary
                    ));
                }
            }
            lines.push(String::new());
            lines.extend(query_screenshot_dom_and_cascade(
                ss.dom_context.as_ref(),
                ss.cascade.as_ref(),
                filter_selector,
                args.css_property,
            )?);
            apply_char_budget(&lines.join("\n"), args.max_chars, None)
        };

        let mut blocks = vec![text_out];
        // JSON 模式下图片路径已嵌入 savedImagePath 字段，避免拼接纯文本破坏 JSON 语法
        if args.format != "json" && args.include_image.unwrap_or(true) {
            if let Some(img_path) = ss.get_screenshot_image_path() {
                blocks.extend(build_image_text_blocks(
                    &loaded,
                    img_path,
                    Some("Screenshot pack image"),
                ));
            }
        }
        return Ok(blocks);
    }

    let LoadedPack::Session(session) = &loaded else {
        unreachable!()
    };
    let scenes = session.get_issue_scenes();
    if scenes.is_empty() {
        if args.format == "json" {
            let payload = json!({
                "kind": "session",
                "totalScenes": 0,
                "scenes": [],
                "message": "No issueScenes were recorded in this evidence pack."
            });
            return Ok(vec![apply_json_budget(
                &serde_json::to_string_pretty(&payload).unwrap_or_default(),
                args.max_chars,
            )]);
        }
        return Ok(vec![
            "No issueScenes were recorded in this evidence pack.".to_string(),
        ]);
    }

    let target = match effective_scene_id {
        Some(id) => scenes
            .iter()
            .find(|s| s.id == id || s.index.to_string() == id),
        None => scenes.first(),
    };
    let Some(target) = target else {
        let available: Vec<String> = scenes
            .iter()
            .map(|s| format!("{}:{}", s.index, s.id))
            .collect();
        return Err(CliError::new(format!(
            "SCENE_NOT_FOUND: Scene \"{}\" not found. Available scenes: [{}]",
            effective_scene_id.or(args.scene_id).unwrap_or(""),
            available.join(", ")
        )));
    };

    let scene = &target.scene;
    let (expected_text, confidence) = match scene.narrative.as_ref() {
        Some(n) => n.resolve_expected(),
        None => (None, "missing".to_string()),
    };

    let targets_list: Vec<_> = match scene.targets.as_ref() {
        Some(list) if !list.is_empty() => list.iter().collect(),
        _ => scene.target.iter().collect(),
    };

    let text_out = if args.format == "json" {
        let rel = session.to_relative_ms(
            scene
                .selection_started_at_epoch_ms
                .or(scene.observed_at_epoch_ms),
        );
        let mut narrative_obj = serde_json::Map::new();
        narrative_obj.insert(
            "actual".to_string(),
            scene
                .narrative
                .as_ref()
                .and_then(|n| n.actual.as_ref())
                .map(|a| Value::String(a.clone()))
                .unwrap_or(Value::Null),
        );
        narrative_obj.insert(
            "expected".to_string(),
            expected_text
                .as_ref()
                .map(|e| Value::String(e.clone()))
                .unwrap_or(Value::Null),
        );
        narrative_obj.insert("confidence".to_string(), json!(confidence));
        if confidence == "missing" {
            narrative_obj.insert(
                "confidenceNotice".to_string(),
                json!("UNCAPTURED_EXPECTATION: User expectation was not captured. Any expectation you formulate MUST be explicitly declared as an inferred hypothesis."),
            );
        }

        let mut root = serde_json::Map::new();
        root.insert("id".to_string(), json!(target.id));
        root.insert("index".to_string(), json!(target.index));
        if let Some(r) = rel {
            if r.is_finite() && r.fract() == 0.0 && r.abs() <= 9_007_199_254_740_991.0 {
                root.insert("relativeMs".to_string(), json!(r as i64));
            } else {
                root.insert("relativeMs".to_string(), json!(r));
            }
        }
        root.insert("narrative".to_string(), Value::Object(narrative_obj));
        root.insert(
            "sequenceContextNotice".to_string(),
            json!("RAW_SAME_TIME_CONTEXT_ONLY: sequenceContext lists events near the mark moment and MUST NOT be treated as a proven causal chain."),
        );
        if let Some(ref sc) = scene.sequence_context {
            root.insert("sequenceContext".to_string(), json!(sc));
        }
        root.insert("targets".to_string(), json!(targets_list));
        if let Some(ref ann) = scene.annotation {
            root.insert("annotation".to_string(), ann.clone());
        }
        if let Some(ref orig) = target.original_source {
            root.insert("originalSource".to_string(), json!(orig));
        }
        if let Some(ref ann) = target.annotated_source {
            root.insert("annotatedSource".to_string(), json!(ann));
        }
        if args.include_image.unwrap_or(true) {
            if let Some(img_path) = target
                .annotated_source
                .as_deref()
                .or(target.original_source.as_deref())
            {
                if let Some(saved) = export_pack_image_to_temp(&loaded, img_path) {
                    root.insert("savedImagePath".to_string(), json!(saved));
                }
            }
        }

        let serialized = serde_json::to_string_pretty(&Value::Object(root)).unwrap_or_default();
        apply_json_budget(&serialized, args.max_chars)
    } else {
        let mut lines = Vec::new();
        let rel = session.to_relative_ms(
            scene
                .selection_started_at_epoch_ms
                .or(scene.observed_at_epoch_ms),
        );
        lines.push(format!(
            "# Issue Scene [{}] `{}` (at {})",
            target.index,
            target.id,
            format_relative_time(rel)
        ));
        lines.push("\n## 1. Narrative & Expectation Anchor".to_string());
        let actual_display = scene
            .narrative
            .as_ref()
            .and_then(|n| n.actual.as_deref())
            .filter(|s| !s.is_empty())
            .unwrap_or("(empty)");
        lines.push(format!("- **actual**: {actual_display}"));
        let exp_display = expected_text
            .as_deref()
            .filter(|s| !s.is_empty())
            .unwrap_or("(missing)");
        lines.push(format!(
            "- **expected** [confidence: `{confidence}`]: {exp_display}"
        ));
        if confidence == "missing" || expected_text.as_deref().is_none_or(|s| s.is_empty()) {
            lines.push("  > ⚠️ **UNCAPTURED EXPECTATION**: You MUST explicitly state that the expected behavior was not captured and mark any inferred expectation as a hypothesis.".to_string());
        }

        lines.push(format!("\n## 2. Selected DOM Targets ({})", targets_list.len()));
        for (idx, t) in targets_list.iter().enumerate() {
            let el_desc = format_element_compact(t.element.as_ref(), 80);
            lines.push(format!("- **Target #{idx}**: {el_desc}"));
            let ancestor_chain = t
                .ancestors
                .as_deref()
                .unwrap_or(&[])
                .iter()
                .take(6)
                .map(|a| {
                    let id = a
                        .id
                        .as_deref()
                        .filter(|s| !s.is_empty())
                        .map(|s| format!("#{s}"))
                        .unwrap_or_default();
                    let cls = match a.class_names.as_deref() {
                        Some(list) if !list.is_empty() => {
                            let sample: Vec<&str> = list.iter().take(2).map(|s| s.as_str()).collect();
                            format!(".{}", sample.join("."))
                        }
                        _ => String::new(),
                    };
                    format!("{}{id}{cls}", a.tag_name.as_deref().unwrap_or("div"))
                })
                .collect::<Vec<_>>()
                .join(" <- ");
            if !ancestor_chain.is_empty() {
                lines.push(format!("  - **Ancestors**: {ancestor_chain}"));
            }
            if let Some(ref html) = t.sanitized_html {
                if !html.is_empty() {
                    lines.push(format!("  - **sanitizedHtml**: `{}`", slice_chars(html, 600)));
                }
            }
            if let Some(ref cs) = t.computed_style {
                if !cs.is_empty() {
                    lines.push(format!(
                        "  - **computedStyle**: {}",
                        serde_json::to_string(cs).unwrap_or_default()
                    ));
                }
            }
            if let Some(ref st) = t.state {
                if !st.is_empty() {
                    lines.push(format!(
                        "  - **state**: {}",
                        serde_json::to_string(st).unwrap_or_default()
                    ));
                }
            }
        }

        lines.push(
            "\n## 3. Sequence Context (Raw Same-Time Context — NOT Proven Causality)".to_string(),
        );
        match scene.sequence_context.as_ref() {
            None => lines.push("(No sequenceContext recorded)".to_string()),
            Some(seq) => {
                let seq_int = seq.interactions.as_deref().unwrap_or(&[]);
                let seq_err = seq.console_errors.as_deref().unwrap_or(&[]);
                let seq_net = seq.network_failures.as_deref().unwrap_or(&[]);
                let win_ms = seq.window_ms.unwrap_or(60000.0);
                let win_str = if win_ms.fract() == 0.0 {
                    format!("{}", win_ms as i64)
                } else {
                    format!("{win_ms}")
                };
                lines.push(format!(
                    "Window: {win_str}ms before anchor | {} interactions, {} console errors, {} network failures",
                    seq_int.len(),
                    seq_err.len(),
                    seq_net.len()
                ));
                let start = seq_int.len().saturating_sub(15);
                for item in &seq_int[start..] {
                    let off = format_ms_num(item.offset_ms.unwrap_or(0.0));
                    let val_part = match item.value.as_deref() {
                        Some(v) => format!("val=\"{v}\""),
                        None => String::new(),
                    };
                    lines.push(format!(
                        "  - [{off}ms] [{}] <{}> text=\"{}\" {val_part}",
                        item.kind.as_deref().unwrap_or(""),
                        item.tag_name.as_deref().unwrap_or("?"),
                        item.text.as_deref().unwrap_or("")
                    ));
                }
                for err in seq_err {
                    let off = format_ms_num(err.offset_ms.unwrap_or(0.0));
                    lines.push(format!(
                        "  - [{off}ms] [CONSOLE {}] {}",
                        err.level.as_deref().unwrap_or("ERROR"),
                        err.text.as_deref().unwrap_or("")
                    ));
                }
                for net in seq_net {
                    let off = format_ms_num(net.offset_ms.unwrap_or(0.0));
                    let st = match net.status {
                        Some(s) => s.to_string(),
                        None => "ERR".to_string(),
                    };
                    lines.push(format!(
                        "  - [{off}ms] [NET {} {st}] {}",
                        net.method.as_deref().unwrap_or("GET"),
                        net.url.as_deref().unwrap_or("")
                    ));
                }
            }
        }
        apply_char_budget(&lines.join("\n"), args.max_chars, None)
    };

    let mut blocks = vec![text_out];
    // JSON 模式下图片路径已写入 savedImagePath 字段，不追加纯文本块
    if args.format != "json" && args.include_image.unwrap_or(true) {
        if let Some(img_path) = target
            .annotated_source
            .as_deref()
            .or(target.original_source.as_deref())
        {
            let label = format!("Scene [{}] screenshot", target.index);
            blocks.extend(build_image_text_blocks(&loaded, img_path, Some(&label)));
        }
    }
    Ok(blocks)
}

fn format_ms_num(v: f64) -> String {
    if v.fract() == 0.0 {
        format!("{}", v as i64)
    } else {
        format!("{v}")
    }
}
