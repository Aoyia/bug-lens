//! `open_pack` 命令：幂等解压证据包、校验完整性并输出会话/截图总览。

use crate::error::CliResult;
use crate::format::budget::{apply_char_budget, apply_json_budget, slice_chars, slice_chars_tail};
use crate::format::element::squash_whitespace;
use crate::format::time::{format_duration, format_relative_time};
use crate::pack::open::{
    get_pack_workspace_dir, open_pack_with_options, OpenOptions, DERIVED_JSON_FILES, INDEX_FILE,
};
use crate::pack::screenshot_pack::LoadedScreenshotPack;
use crate::pack::session_pack::LoadedSessionPack;
use crate::pack::LoadedPack;
use crate::query::cascade::{extract_layout_deviations, format_cascade_overview};
use crate::query::console::{format_console_item, query_console, ConsoleQueryOptions};
use crate::query::network::{
    format_network_row, query_network, NetworkQueryOptions, NetworkStatusFilter,
};
use crate::tools::image_helper::export_pack_image_to_temp;
use indexmap::IndexMap;
use serde_json::{json, Value};
use std::path::PathBuf;

/// `open_pack` 命令入参。
pub struct OpenPackArgs<'a> {
    pub pack: &'a str,
    pub format: &'a str,
    pub max_chars: Option<usize>,
}

/// 生成会话录制包总览（支持 text 与 json 格式）。
fn format_session_pack_overview(
    pack: &LoadedSessionPack,
    loaded: &LoadedPack,
    format: &str,
    max_chars: Option<usize>,
) -> CliResult<String> {
    let summary = pack.data.summary.as_ref();
    let scenes = pack.get_issue_scenes();
    let top_errors = query_console(
        pack,
        &ConsoleQueryOptions {
            levels: Some(vec!["error".to_string()]),
            limit: Some(5),
            ..Default::default()
        },
    )?;
    let top_failed_net = query_network(
        pack,
        &NetworkQueryOptions {
            status: Some(NetworkStatusFilter::Failed),
            limit: Some(5),
            ..Default::default()
        },
    );
    let files = pack.list_files();
    let workspace_dir = get_pack_workspace_dir(loaded);

    let index_path = workspace_dir.as_ref().and_then(|ws| {
        let p = PathBuf::from(ws).join(INDEX_FILE);
        p.exists().then(|| p.to_string_lossy().into_owned())
    });

    let derived_json_files: Vec<String> = workspace_dir
        .as_ref()
        .map(|ws| {
            DERIVED_JSON_FILES
                .iter()
                .filter_map(|(_, target)| {
                    let mut p = PathBuf::from(ws);
                    for seg in target.split('/') {
                        p.push(seg);
                    }
                    p.exists().then(|| p.to_string_lossy().into_owned())
                })
                .collect()
        })
        .unwrap_or_default();

    let recording_paths: Vec<String> = workspace_dir
        .as_ref()
        .map(|ws| {
            pack.skipped_media_files
                .keys()
                .map(|rel| {
                    let mut p = PathBuf::from(ws);
                    for seg in rel.split('/') {
                        p.push(seg);
                    }
                    p.to_string_lossy().into_owned()
                })
                .collect()
        })
        .unwrap_or_default();

    if format == "json" {
        let scenes_json: Vec<Value> = scenes
            .iter()
            .map(|s| {
                let (expected_text, confidence) = match s.scene.narrative.as_ref() {
                    Some(n) => n.resolve_expected(),
                    None => (None, "missing".to_string()),
                };
                let mut obj = serde_json::Map::new();
                obj.insert("id".to_string(), json!(s.id));
                obj.insert("index".to_string(), json!(s.index));
                obj.insert(
                    "actual".to_string(),
                    s.scene
                        .narrative
                        .as_ref()
                        .and_then(|n| n.actual.as_ref())
                        .map(|a| Value::String(a.clone()))
                        .unwrap_or(Value::Null),
                );
                obj.insert(
                    "expected".to_string(),
                    expected_text.map(Value::String).unwrap_or(Value::Null),
                );
                obj.insert("expectedConfidence".to_string(), json!(confidence));
                if let Some(ref orig) = s.original_source {
                    obj.insert("originalSource".to_string(), json!(orig));
                }
                if let Some(ref ann) = s.annotated_source {
                    obj.insert("annotatedSource".to_string(), json!(ann));
                }
                Value::Object(obj)
            })
            .collect();

        let mut root = serde_json::Map::new();
        root.insert("kind".to_string(), json!("session"));
        root.insert("packPath".to_string(), json!(pack.pack_path));
        if let Some(ref ws) = workspace_dir {
            root.insert("workspaceDir".to_string(), json!(ws));
        }
        if let Some(ref ip) = index_path {
            root.insert("indexPath".to_string(), json!(ip));
        }
        root.insert("derivedJsonFiles".to_string(), json!(derived_json_files));
        root.insert("recordingPaths".to_string(), json!(recording_paths));
        root.insert("sessionId".to_string(), json!(pack.session_id()));
        root.insert("integrity".to_string(), json!(pack.integrity));
        if let Some(sum) = summary {
            root.insert("summary".to_string(), json!(sum));
        }
        root.insert("issueScenes".to_string(), Value::Array(scenes_json));
        root.insert("topConsoleErrors".to_string(), json!(top_errors.items));
        root.insert(
            "topNetworkFailures".to_string(),
            json!(top_failed_net.items),
        );
        root.insert("filesCount".to_string(), json!(files.len()));
        root.insert("files".to_string(), json!(files));

        let serialized = serde_json::to_string_pretty(&Value::Object(root)).unwrap_or_default();
        return Ok(apply_json_budget(&serialized, max_chars));
    }

    let mut lines: Vec<String> = Vec::new();
    if let Some(ref warning) = pack.integrity.schema_warning {
        lines.push(format!("⚠️ {warning}\n"));
    }
    if !pack.integrity.valid {
        lines.push(format!(
            "⚠️ Integrity check reported mismatches: {}\n",
            pack.integrity.mismatches.join("; ")
        ));
    }

    lines.push("# Bug Lens Evidence Pack (kind: session)".to_string());
    if let Some(ref ws) = workspace_dir {
        lines.push(format!("- **Workspace**: `{ws}`"));
    }
    if let Some(ref ip) = index_path {
        lines.push(format!(
            "- **Index**: `{ip}` (read this file for full schema, request->body map, and jq recipes)"
        ));
    }
    if !derived_json_files.is_empty() {
        let joined = derived_json_files
            .iter()
            .map(|p| format!("`{p}`"))
            .collect::<Vec<_>>()
            .join(", ");
        lines.push(format!("- **Derived JSON**: {joined}"));
    }
    if !recording_paths.is_empty() {
        let joined = recording_paths
            .iter()
            .map(|p| format!("`{p}`"))
            .collect::<Vec<_>>()
            .join(", ");
        lines.push(format!("- **Recording**: {joined}"));
    }
    lines.push(format!("- **Session ID**: `{}`", pack.session_id()));

    let schema_str = pack
        .integrity
        .schema_version
        .or_else(|| pack.data.session.as_ref().and_then(|s| s.schema_version))
        .map(|v| v.to_string())
        .unwrap_or_else(|| "?".to_string());
    lines.push(format!(
        "- **Schema**: v{schema_str} (integrity: {}, checked {} files)",
        if pack.integrity.valid { "OK" } else { "MISMATCH" },
        pack.integrity.checked_count
    ));

    let page_title = summary
        .and_then(|s| s.title.as_deref())
        .or_else(|| {
            pack.data
                .session
                .as_ref()
                .and_then(|s| s.target.as_ref())
                .and_then(|t| t.initial_title.as_deref())
        })
        .unwrap_or("—");
    let page_url = summary
        .and_then(|s| s.url.as_deref())
        .or_else(|| {
            pack.data
                .session
                .as_ref()
                .and_then(|s| s.target.as_ref())
                .and_then(|t| t.initial_url.as_deref())
        })
        .unwrap_or("—");
    lines.push(format!("- **Page**: {page_title} ({page_url})"));

    let duration_ms = summary
        .and_then(|s| s.duration_ms)
        .or_else(|| {
            pack.data
                .session
                .as_ref()
                .and_then(|s| s.timeline.as_ref())
                .and_then(|t| t.duration_ms)
        });
    lines.push(format!(
        "- **Duration**: {} | Quality: {} | Privacy: {}",
        format_duration(duration_ms),
        summary.and_then(|s| s.quality.as_deref()).unwrap_or("—"),
        summary
            .and_then(|s| s.privacy_mode.as_deref())
            .unwrap_or("—")
    ));

    if let Some(env) = summary.and_then(|s| s.environment.as_ref()) {
        lines.push(format!(
            "- **Environment**: {} · {} · {} · screen {} · viewport {}",
            env.os.as_deref().unwrap_or("?"),
            env.browser.as_deref().unwrap_or("?"),
            env.language.as_deref().unwrap_or("?"),
            env.screen.as_deref().unwrap_or("?"),
            env.viewport.as_deref().unwrap_or("?")
        ));
    }

    lines.push(format!(
        "- **Counts**: {} interactions | {} console entries ({} errors) | {} network requests ({} failed) | {} issue scenes | {} framework snapshots",
        pack.get_interactions().len(),
        pack.get_console_entries().len(),
        top_errors.matched_count,
        pack.get_network_entries().len(),
        top_failed_net.matched_count,
        scenes.len(),
        pack.get_framework_states().len()
    ));

    lines.push(format!("\n## Issue Scenes ({})", scenes.len()));
    if scenes.is_empty() {
        lines.push("(No issue scenes marked in this session)".to_string());
    } else {
        for s in &scenes {
            let rel = pack.to_relative_ms(
                s.scene
                    .selection_started_at_epoch_ms
                    .or(s.scene.observed_at_epoch_ms),
            );
            let (expected_text, confidence) = match s.scene.narrative.as_ref() {
                Some(n) => n.resolve_expected(),
                None => (None, "missing".to_string()),
            };
            lines.push(format!(
                "- **Scene [{}] `{}`** (at {}):",
                s.index,
                s.id,
                format_relative_time(rel)
            ));
            let actual = s
                .scene
                .narrative
                .as_ref()
                .and_then(|n| n.actual.as_deref())
                .filter(|a| !a.is_empty())
                .unwrap_or("(empty)");
            lines.push(format!("  - **actual**: {actual}"));
            let exp_display = expected_text
                .as_deref()
                .filter(|e| !e.is_empty())
                .unwrap_or("(not captured — treat any expectation as inferred hypothesis)");
            lines.push(format!(
                "  - **expected** [confidence={confidence}]: {exp_display}"
            ));
            lines.push(format!(
                "  - **screenshots**: annotated=`{}`, original=`{}`",
                s.annotated_source.as_deref().unwrap_or("none"),
                s.original_source.as_deref().unwrap_or("none")
            ));
            if let Some(primary_img) = s.annotated_source.as_deref().or(s.original_source.as_deref())
            {
                if let Some(saved_img) = export_pack_image_to_temp(loaded, primary_img) {
                    lines.push(format!(
                        "  - **savedImagePath**: `{saved_img}` (call `read_file` on this path to view the scene screenshot)"
                    ));
                }
            }
        }
    }

    lines.push(format!(
        "\n## Top Console Errors ({} total)",
        top_errors.matched_count
    ));
    if top_errors.items.is_empty() {
        lines.push("(No console errors recorded)".to_string());
    } else {
        for item in &top_errors.items {
            lines.push(format!("- {}", format_console_item(item)));
        }
    }

    lines.push(format!(
        "\n## Top Failed Network Requests ({} total)",
        top_failed_net.matched_count
    ));
    if top_failed_net.items.is_empty() {
        lines.push("(No failed network requests recorded)".to_string());
    } else {
        for row in &top_failed_net.items {
            lines.push(format!("- {}", format_network_row(row)));
        }
    }

    lines.push(format!("\n## Package Files ({})", files.len()));
    let key_files: Vec<_> = files
        .iter()
        .filter(|f| !f.path.starts_with("screenshots/") && !f.path.starts_with("network/body-"))
        .collect();
    let body_files_count = files
        .iter()
        .filter(|f| f.path.starts_with("network/body-"))
        .count();
    let step_shots_count = files
        .iter()
        .filter(|f| f.path.starts_with("screenshots/"))
        .count();

    for f in key_files {
        let media_note = if f.skipped_media == Some(true) {
            ", extracted on disk"
        } else {
            ""
        };
        lines.push(format!("- `{}` ({} B{media_note})", f.path, f.byte_length));
    }
    if body_files_count > 0 {
        lines.push(format!(
            "- `network/body-*.txt` ({body_files_count} split body files)"
        ));
    }
    if step_shots_count > 0 {
        lines.push(format!(
            "- `screenshots/step-*.*` ({step_shots_count} step screenshots)"
        ));
    }

    lines.push("\n**Next steps** (active pack is extracted & cached; omit `--pack` in subsequent commands): Run `get_scene` to inspect DOM targets & annotated screenshot, `timeline --windowMs 15000` for chronological events around the issue, `query_network --status failed` / `get_request <id> --jsonPath \"...\"` for API bodies, `get_framework_state` for Vue/React state, or read `INDEX.md` and query `data/session-data.json` / `network/body-*.txt` directly with `jq`.".to_string());

    Ok(apply_char_budget(&lines.join("\n"), max_chars, None))
}

/// 生成截图批注包总览（含自动布局偏差诊断与 CSS 级联索引摘要）。
fn format_screenshot_pack_overview(
    pack: &LoadedScreenshotPack,
    loaded: &LoadedPack,
    format: &str,
    max_chars: Option<usize>,
) -> String {
    let dc = pack.dom_context.as_ref();
    let anchors = dc.and_then(|d| d.anchors.as_deref()).unwrap_or(&[]);
    let files = pack.list_files();
    let workspace_dir = get_pack_workspace_dir(loaded);
    let index_path = workspace_dir.as_ref().and_then(|ws| {
        let p = PathBuf::from(ws).join(INDEX_FILE);
        p.exists().then(|| p.to_string_lossy().into_owned())
    });

    if format == "json" {
        let anchors_json: Vec<Value> = anchors
            .iter()
            .map(|a| {
                let mut m = serde_json::Map::new();
                if let Some(ref v) = a.selector {
                    m.insert("selector".to_string(), json!(v));
                }
                if let Some(ref v) = a.selector_path {
                    m.insert("selectorPath".to_string(), json!(v));
                }
                if let Some(ref v) = a.tag_name {
                    m.insert("tagName".to_string(), json!(v));
                }
                if let Some(ref v) = a.component_name {
                    m.insert("componentName".to_string(), json!(v));
                }
                if let Some(ref v) = a.component_file {
                    m.insert("componentFile".to_string(), json!(v));
                }
                if let Some(ref v) = a.intent_flags {
                    m.insert("intentFlags".to_string(), json!(v));
                }
                if let Some(ref v) = a.inner_text {
                    m.insert("innerText".to_string(), json!(slice_chars(v, 120)));
                }
                Value::Object(m)
            })
            .collect();

        let mut root = serde_json::Map::new();
        root.insert("kind".to_string(), json!("screenshot"));
        root.insert("packPath".to_string(), json!(pack.pack_path));
        if let Some(ref ws) = workspace_dir {
            root.insert("workspaceDir".to_string(), json!(ws));
        }
        if let Some(ref ip) = index_path {
            root.insert("indexPath".to_string(), json!(ip));
        }
        if let Some(sp) = pack.get_screenshot_image_path() {
            root.insert("screenshotPath".to_string(), json!(sp));
        }
        if let Some(ref env) = pack.environment {
            root.insert("environment".to_string(), json!(env));
        }
        if let Some(sca) = dc.and_then(|d| d.smallest_common_ancestor_selector.as_ref()) {
            root.insert("smallestCommonAncestorSelector".to_string(), json!(sca));
        }
        if let Some(meta) = dc.and_then(|d| d.meta.as_ref()) {
            root.insert("meta".to_string(), json!(meta));
        }
        root.insert("anchors".to_string(), Value::Array(anchors_json));
        root.insert("hasCascade".to_string(), json!(pack.cascade.is_some()));
        root.insert("files".to_string(), json!(files));

        let serialized = serde_json::to_string_pretty(&Value::Object(root)).unwrap_or_default();
        return apply_json_budget(&serialized, max_chars);
    }

    let mut lines: Vec<String> = Vec::new();
    let env = pack.environment.as_ref();
    let recent_errors = env
        .and_then(|e| e.recent_console_errors.as_deref())
        .unwrap_or(&[]);
    let recent_failed = env
        .and_then(|e| e.recent_failed_requests.as_deref())
        .unwrap_or(&[]);
    let fw_states = env
        .and_then(|e| {
            e.framework_component_states
                .as_deref()
                .or(e.vue_component_states.as_deref())
        })
        .unwrap_or(&[]);

    let img_rel = pack.get_screenshot_image_path();
    let saved_main_img = img_rel.and_then(|rel| export_pack_image_to_temp(loaded, rel));

    lines.push("# Bug Lens Screenshot Pack (kind: screenshot)".to_string());
    if let Some(ref ws) = workspace_dir {
        lines.push(format!("- **Workspace**: `{ws}`"));
    }
    if let Some(ref ip) = index_path {
        lines.push(format!("- **Index**: `{ip}`"));
    }
    let saved_suffix = match saved_main_img {
        Some(p) => format!(" -> Saved to `{p}` (call `read_file` on this path to inspect visually)"),
        None => String::new(),
    };
    lines.push(format!(
        "- **Image**: `{}`{saved_suffix}",
        img_rel.unwrap_or("none")
    ));

    if let Some(env) = env {
        lines.push(format!(
            "- **Page**: {} ({})",
            env.title.as_deref().unwrap_or("—"),
            env.url.as_deref().unwrap_or("—")
        ));
        let vw = env
            .viewport
            .as_ref()
            .and_then(|v| v.width.as_ref())
            .map(|v| v.to_string().trim_matches('"').to_string())
            .unwrap_or_else(|| "?".to_string());
        let vh = env
            .viewport
            .as_ref()
            .and_then(|v| v.height.as_ref())
            .map(|v| v.to_string().trim_matches('"').to_string())
            .unwrap_or_else(|| "?".to_string());
        lines.push(format!(
            "- **Viewport**: {vw}x{vh} ({}) | UA: {}",
            env.media_breakpoint.as_deref().unwrap_or("?"),
            env.user_agent.as_deref().unwrap_or("—")
        ));
        lines.push(format!(
            "- **Anomalies & State**: {} recent console error(s) | {} failed request(s) | {} component state snapshot(s)",
            recent_errors.len(),
            recent_failed.len(),
            fw_states.len()
        ));
    }

    if let Some(dc) = dc {
        let anchor_count = dc
            .meta
            .as_ref()
            .and_then(|m| m.anchor_count)
            .unwrap_or(anchors.len());
        let leaf_count = dc
            .meta
            .as_ref()
            .and_then(|m| m.leaf_count)
            .unwrap_or_else(|| dc.leaves.as_ref().map(|v| v.len()).unwrap_or(0));
        let ancestor_count = dc
            .meta
            .as_ref()
            .and_then(|m| m.ancestor_count)
            .unwrap_or_else(|| dc.ancestors.as_ref().map(|v| v.len()).unwrap_or(0));
        lines.push(format!(
            "- **DOM Context**: SCA=`{}` | anchors={anchor_count}, leaves={leaf_count}, ancestors={ancestor_count}",
            dc.smallest_common_ancestor_selector
                .as_deref()
                .unwrap_or("?")
        ));

        let deviations = extract_layout_deviations(Some(dc));
        if !deviations.is_empty() {
            lines.push(format!(
                "\n## Layout & Overflow Diagnostics ({} distinct issue group(s))",
                deviations.len()
            ));
            for dev in &deviations {
                let idx_info = if !dev.anchor_indices.is_empty() {
                    let sample: Vec<String> = dev
                        .anchor_indices
                        .iter()
                        .take(6)
                        .map(|i| i.to_string())
                        .collect();
                    let extra = if dev.anchor_indices.len() > 6 {
                        format!(", ... ({} total)", dev.anchor_indices.len())
                    } else {
                        String::new()
                    };
                    format!(" (anchors: [{}{extra}])", sample.join(", "))
                } else {
                    String::new()
                };
                let comp_info = match dev.component.as_deref() {
                    Some(c) => format!(" [{c}]"),
                    None => String::new(),
                };
                let sel_label = dev.selector_path.as_deref().unwrap_or(&dev.selector);
                lines.push(format!(
                    "- ⚠️ **[{}] `{sel_label}`**{comp_info}{idx_info}: {}",
                    dev.kind, dev.summary
                ));
                if let Some(ref st) = dev.sample_text {
                    lines.push(format!("  - sampleText: \"{st}\""));
                }
                if let Some(ref ks) = dev.key_styles {
                    lines.push(format!(
                        "  - keyComputedStyles: {}",
                        serde_json::to_string(ks).unwrap_or_default()
                    ));
                }
            }
        }

        // 对重复的同级锚点按签名折叠，控制输出长度
        lines.push(format!("\n## Annotated DOM Anchors ({})", anchors.len()));
        let mut sig_to_indices: IndexMap<String, Vec<usize>> = IndexMap::new();
        let mut unique_anchors = Vec::new();
        for (idx, a) in anchors.iter().enumerate() {
            let flags_json = a
                .intent_flags
                .as_ref()
                .and_then(|f| serde_json::to_string(f).ok())
                .unwrap_or_else(|| "{}".to_string());
            let sig = format!(
                "{}|{}|{flags_json}",
                a.selector_path
                    .as_deref()
                    .or(a.selector.as_deref())
                    .unwrap_or("?"),
                a.component_name.as_deref().unwrap_or("")
            );
            if let Some(list) = sig_to_indices.get_mut(&sig) {
                list.push(idx);
            } else {
                sig_to_indices.insert(sig.clone(), vec![idx]);
                unique_anchors.push((idx, a, sig));
            }
        }

        for (idx, a, sig) in unique_anchors.iter().take(15) {
            let fallback_idx = [*idx];
            let all_idx = sig_to_indices
                .get(sig)
                .map(|v| v.as_slice())
                .unwrap_or(&fallback_idx);
            let dup_note = if all_idx.len() > 1 {
                let sample: Vec<String> = all_idx[1..]
                    .iter()
                    .take(4)
                    .map(|i| i.to_string())
                    .collect();
                let ell = if all_idx.len() > 5 { ",..." } else { "" };
                format!(
                    " (+{} siblings: [{}{ell}])",
                    all_idx.len() - 1,
                    sample.join(",")
                )
            } else {
                String::new()
            };

            let mut flag_parts = Vec::new();
            if let Some(ref flags) = a.intent_flags {
                if flags.is_arrow_target == Some(true) {
                    flag_parts.push("arrow".to_string());
                }
                if flags.is_highlighted_focus == Some(true) {
                    flag_parts.push("focus".to_string());
                }
                if let Some(ref comment) = flags.text_comment {
                    if !comment.is_empty() {
                        flag_parts.push(format!("comment=\"{comment}\""));
                    }
                }
            }
            let flag_str = if flag_parts.is_empty() {
                String::new()
            } else {
                format!(" [{}]", flag_parts.join(","))
            };

            let comp = match a.component_name.as_deref().filter(|s| !s.is_empty()) {
                Some(name) => match a.component_file.as_deref().filter(|s| !s.is_empty()) {
                    Some(file) => {
                        let line_part = a
                            .component_line
                            .as_ref()
                            .filter(|v| !v.is_null() && v.as_u64() != Some(0))
                            .map(|v| format!(":{}", v.to_string().trim_matches('"')))
                            .unwrap_or_default();
                        format!(" [{name} @ {file}{line_part}]")
                    }
                    None => format!(" [{name}]"),
                },
                None => String::new(),
            };

            let raw_path = a
                .selector_path
                .as_deref()
                .or(a.selector.as_deref())
                .unwrap_or("?");
            let short_path = if raw_path.chars().count() > 75 {
                format!("…{}", slice_chars_tail(raw_path, 72))
            } else {
                raw_path.to_string()
            };
            let text_preview = a
                .inner_text
                .as_deref()
                .map(|t| slice_chars(&squash_whitespace(t), 50).to_string())
                .filter(|t| !t.is_empty());
            let text_part = match text_preview {
                Some(tp) => format!(" text=\"{tp}\""),
                None => String::new(),
            };

            lines.push(format!(
                "- [{idx}] `{short_path}`{comp}{flag_str}{dup_note}{text_part}"
            ));
        }

        if unique_anchors.len() > 15 {
            lines.push(format!(
                "- ... +{} more unique anchors (use `get_scene(selector=\"...\")` to filter)",
                unique_anchors.len() - 15
            ));
        }
    }

    if pack.cascade.is_some() {
        lines.extend(format_cascade_overview(pack.cascade.as_ref()));
    }

    if !recent_errors.is_empty() {
        lines.push(format!("\n## Recent Console Errors ({})", recent_errors.len()));
        for (i, err) in recent_errors.iter().take(5).enumerate() {
            lines.push(format!(
                "- [#{i}] {}",
                err.message.as_deref().unwrap_or("")
            ));
        }
    }
    if !recent_failed.is_empty() {
        lines.push(format!(
            "\n## Recent Failed Network Requests ({})",
            recent_failed.len()
        ));
        for req in recent_failed.iter().take(5) {
            lines.push(format!(
                "- {} {} {}",
                req.method.as_deref().unwrap_or("GET"),
                req.status.unwrap_or(0),
                req.url.as_deref().unwrap_or("")
            ));
        }
    }

    lines.push(format!("\n## Files ({})", files.len()));
    for f in &files {
        lines.push(format!("- `{}` ({} B)", f.path, f.byte_length));
    }
    lines.push("\n**Next steps** (active pack is cached; omit `--pack` in subsequent commands): Call `read_file` on the saved image path above to inspect `screenshot.jpg`; run `get_scene --selector \"...\" --cssProperty \"...\"` to inspect anchor `computedStyles`/`layoutContext` and matched CSS cascade rules; run `search_pack \"<keyword>\"` to search across `cascade.json` & `dom-context.json`; run `get_framework_state` for component props/data; or check `INDEX.md` and query `dom-context.json` / `cascade.json` / `environment.json` in the workspace directly with `jq`.".to_string());

    apply_char_budget(&lines.join("\n"), max_chars, None)
}

/// 执行 `open_pack` 命令。
pub fn run_open_pack_tool(args: OpenPackArgs<'_>) -> CliResult<String> {
    let loaded = open_pack_with_options(
        Some(args.pack),
        OpenOptions {
            verify_integrity: true,
        },
    )?;
    match &loaded {
        LoadedPack::Session(s) => format_session_pack_overview(s, &loaded, args.format, args.max_chars),
        LoadedPack::Screenshot(s) => Ok(format_screenshot_pack_overview(
            s,
            &loaded,
            args.format,
            args.max_chars,
        )),
    }
}
