//! 跨维度统一时间轴合并引擎（用户交互、控制台异常、API/失败请求、问题现场）。

use crate::format::budget::slice_chars;
use crate::format::element::{format_interaction_line, squash_whitespace};
use crate::format::time::{format_duration, format_relative_time};
use crate::pack::session_pack::LoadedSessionPack;
use crate::pack::types::js_num;
use serde::Serialize;
use serde_json::Value;
use std::collections::HashSet;

#[derive(Debug, Default, Clone)]
pub struct TimelineQueryOptions {
    pub around_scene_id: Option<String>,
    pub from_ms: Option<f64>,
    pub to_ms: Option<f64>,
    pub window_ms: Option<f64>,
    pub kinds: Option<Vec<String>>,
    pub include_all_console: bool,
    pub include_all_network: bool,
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelineEventItem {
    pub kind: String,
    #[serde(serialize_with = "js_num::serialize")]
    pub epoch_ms: f64,
    #[serde(serialize_with = "js_num::serialize")]
    pub relative_ms: f64,
    pub summary: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ref_id: Option<Value>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelineQueryResult {
    pub window_description: String,
    pub total_matched: usize,
    pub events: Vec<TimelineEventItem>,
}

pub fn query_timeline(
    pack: &LoadedSessionPack,
    options: &TimelineQueryOptions,
) -> TimelineQueryResult {
    let allowed_kinds: HashSet<String> = match options.kinds.as_ref() {
        Some(k) if !k.is_empty() => k.iter().map(|s| s.to_lowercase()).collect(),
        _ => ["interaction", "console", "network", "scene"]
            .into_iter()
            .map(String::from)
            .collect(),
    };

    let mut from_rel_ms = options.from_ms;
    let mut to_rel_ms = options.to_ms;
    let mut window_description = "Full session timeline".to_string();

    if options.around_scene_id.is_some()
        || (from_rel_ms.is_none() && to_rel_ms.is_none() && options.window_ms.is_some())
    {
        let scenes = pack.get_issue_scenes();
        let target_scene = match options.around_scene_id.as_deref() {
            Some(around) => scenes
                .iter()
                .find(|s| s.id == around || s.index.to_string() == around)
                .or_else(|| scenes.first()),
            None => scenes.first(),
        };

        if let Some(target_scene) = target_scene {
            let anchor_epoch = target_scene
                .scene
                .selection_started_at_epoch_ms
                .or(target_scene.scene.observed_at_epoch_ms)
                .or_else(|| {
                    target_scene
                        .scene
                        .sequence_context
                        .as_ref()
                        .and_then(|sc| sc.anchor_epoch_ms)
                });
            if let Some(anchor_rel) = pack.to_relative_ms(anchor_epoch) {
                let win = options.window_ms.unwrap_or(15000.0);
                from_rel_ms = Some(anchor_rel - win);
                to_rel_ms = Some(anchor_rel + (win / 3.0).floor().min(5000.0));
                window_description = format!(
                    "Around scene \"{}\" ({} .. {})",
                    target_scene.id,
                    format_relative_time(from_rel_ms),
                    format_relative_time(to_rel_ms)
                );
            }
        }
    } else if from_rel_ms.is_some() || to_rel_ms.is_some() {
        window_description = format!(
            "Range {} .. {}",
            format_relative_time(Some(from_rel_ms.unwrap_or(0.0))),
            format_relative_time(to_rel_ms)
        );
    }

    let mut events = Vec::new();

    if allowed_kinds.contains("interaction") {
        for (idx, item) in pack.get_interactions().iter().enumerate() {
            let rel = pack
                .to_relative_ms(item.created_at)
                .or(item.elapsed_ms)
                .unwrap_or(0.0);
            let epoch = item.created_at.unwrap_or_else(|| pack.to_epoch_ms(rel));
            events.push(TimelineEventItem {
                kind: "interaction".to_string(),
                epoch_ms: epoch,
                relative_ms: rel,
                ref_id: Some(Value::from(idx)),
                summary: format_interaction_line(item, idx, Some(rel)),
            });
        }
    }

    if allowed_kinds.contains("console") {
        for (idx, log) in pack.get_console_entries().iter().enumerate() {
            let level = log.level.as_deref().unwrap_or("log").to_lowercase();
            if !options.include_all_console
                && level != "error"
                && level != "warning"
                && level != "warn"
            {
                continue;
            }
            let rel = pack.to_relative_ms(log.created_at).unwrap_or(0.0);
            let epoch = log.created_at.unwrap_or_else(|| pack.to_epoch_ms(rel));
            let text_clean = squash_whitespace(log.text.as_deref().unwrap_or(""));
            let text = slice_chars(&text_clean, 140);
            let ref_id = match log.id.as_ref() {
                Some(id) => Value::String(id.clone()),
                None => Value::from(idx),
            };
            events.push(TimelineEventItem {
                kind: "console".to_string(),
                epoch_ms: epoch,
                relative_ms: rel,
                ref_id: Some(ref_id),
                summary: format!("{} [console.{level}] {text}", format_relative_time(Some(rel))),
            });
        }
    }

    if allowed_kinds.contains("network") {
        for entry in pack.get_network_entries() {
            let status = entry.status.unwrap_or(0);
            let is_failure = entry.is_failure();
            let rtype = entry.r#type.as_deref().unwrap_or("").to_lowercase();
            let is_api_call = matches!(rtype.as_str(), "xhr" | "fetch" | "document");
            if !options.include_all_network && !is_failure && !is_api_call {
                continue;
            }
            let rel = pack.to_relative_ms(entry.created_at).unwrap_or(0.0);
            let epoch = entry.created_at.unwrap_or_else(|| pack.to_epoch_ms(rel));
            let method = entry.method.as_deref().unwrap_or("GET");
            let dur = format_duration(entry.duration_ms);
            let status_tag = if is_failure {
                if status == 0 {
                    "!ERR".to_string()
                } else {
                    format!("!{status}")
                }
            } else {
                status.to_string()
            };
            events.push(TimelineEventItem {
                kind: "network".to_string(),
                epoch_ms: epoch,
                relative_ms: rel,
                ref_id: Some(Value::String(entry.id.clone())),
                summary: format!(
                    "{} [net {method} {status_tag} {dur}] {} (id={})",
                    format_relative_time(Some(rel)),
                    entry.url,
                    entry.id
                ),
            });
        }
    }

    if allowed_kinds.contains("scene") {
        for s in pack.get_issue_scenes() {
            let epoch_opt = s
                .scene
                .selection_started_at_epoch_ms
                .or(s.scene.observed_at_epoch_ms);
            let rel = pack.to_relative_ms(epoch_opt).unwrap_or(0.0);
            let epoch = epoch_opt.unwrap_or_else(|| pack.to_epoch_ms(rel));
            let actual = s
                .scene
                .narrative
                .as_ref()
                .and_then(|n| n.actual.as_deref())
                .unwrap_or("(no narrative)");
            events.push(TimelineEventItem {
                kind: "scene".to_string(),
                epoch_ms: epoch,
                relative_ms: rel,
                ref_id: Some(Value::String(s.id.clone())),
                summary: format!(
                    "{} [ISSUE SCENE {}] actual=\"{actual}\"",
                    format_relative_time(Some(rel)),
                    s.id
                ),
            });
        }
    }

    let mut filtered: Vec<TimelineEventItem> = events
        .into_iter()
        .filter(|ev| {
            if let Some(from) = from_rel_ms {
                if ev.relative_ms < from {
                    return false;
                }
            }
            if let Some(to) = to_rel_ms {
                if ev.relative_ms > to {
                    return false;
                }
            }
            true
        })
        .collect();

    filtered.sort_by(|a, b| {
        a.relative_ms
            .partial_cmp(&b.relative_ms)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    let limit = options.limit.unwrap_or(80);
    let total_matched = filtered.len();
    filtered.truncate(limit);

    TimelineQueryResult {
        window_description,
        total_matched,
        events: filtered,
    }
}
