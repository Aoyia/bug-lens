//! `get_framework_state` 命令：检查 Vue/React 组件树状态、props/data 与 webStorage 快照。

use crate::error::{CliError, CliResult};
use crate::format::budget::{apply_char_budget, apply_json_budget};
use crate::format::time::format_relative_time;
use crate::pack::open::{open_pack_with_options, OpenOptions};
use crate::pack::types::{FrameworkComponentNode, FrameworkStateEntry};
use crate::pack::LoadedPack;
use crate::query::json_path::evaluate_json_path;
use serde_json::{json, Value};

/// `get_framework_state` 命令入参。
pub struct GetFrameworkStateArgs<'a> {
    pub pack: Option<&'a str>,
    pub index: Option<usize>,
    pub near_ms: Option<f64>,
    pub component: Option<&'a str>,
    pub path: Option<&'a str>,
    pub format: &'a str,
    pub max_chars: Option<usize>,
}

const MAX_COMPONENT_DEPTH: usize = 32;
const MAX_COMPONENT_NODES: usize = 2000;

fn push_component_subtree<'a>(
    node: &'a FrameworkComponentNode,
    depth: usize,
    out: &mut Vec<&'a FrameworkComponentNode>,
) {
    if depth > MAX_COMPONENT_DEPTH || out.len() >= MAX_COMPONENT_NODES {
        return;
    }
    out.push(node);
    if let Some(ref children) = node.children {
        for child in children {
            if out.len() >= MAX_COMPONENT_NODES {
                break;
            }
            push_component_subtree(child, depth + 1, out);
        }
    }
}

/// 收集单个框架状态快照中的全部组件节点（含递归 `children` 子树，带深度与数量上限）。
fn collect_component_nodes(st: &FrameworkStateEntry) -> Vec<&FrameworkComponentNode> {
    let mut nodes = Vec::new();
    if let Some(ref snap) = st.snapshot {
        if let Some(ref target) = snap.target_component {
            push_component_subtree(target, 0, &mut nodes);
        }
        if let Some(ref root) = snap.root_component {
            push_component_subtree(root, 0, &mut nodes);
        }
        if let Some(ref chain) = snap.parent_chain {
            for node in chain {
                push_component_subtree(node, 0, &mut nodes);
            }
        }
    }
    if let Some(ref comps) = st.components {
        for node in comps {
            push_component_subtree(node, 0, &mut nodes);
        }
    }
    nodes
}

fn matches_component_filter(node: &FrameworkComponentNode, filter_lower: Option<&str>) -> bool {
    match filter_lower {
        Some(needle) => node
            .component_name
            .as_deref()
            .unwrap_or("")
            .to_lowercase()
            .contains(needle),
        None => true,
    }
}

/// 执行 `get_framework_state` 命令。
pub fn run_get_framework_state_tool(args: GetFrameworkStateArgs<'_>) -> CliResult<String> {
    let loaded = open_pack_with_options(
        args.pack,
        OpenOptions {
            verify_integrity: false,
        },
    )?;

    // 截图包模式：从 environment.json 读取组件快照列表
    if let LoadedPack::Screenshot(ss) = &loaded {
        let comp_list = ss
            .environment
            .as_ref()
            .and_then(|e| {
                e.framework_component_states
                    .as_deref()
                    .or(e.vue_component_states.as_deref())
            })
            .unwrap_or(&[]);
        let comp_filter = args.component.map(|c| c.to_lowercase());
        let filtered: Vec<&FrameworkComponentNode> = match comp_filter.as_deref() {
            Some(needle) => comp_list
                .iter()
                .filter(|c| {
                    c.component_name
                        .as_deref()
                        .unwrap_or("")
                        .to_lowercase()
                        .contains(needle)
                })
                .collect(),
            None => comp_list.iter().collect(),
        };

        if let Some(path_expr) = args.path {
            let root = serde_json::to_value(&filtered).unwrap_or(Value::Null);
            let extracted = evaluate_json_path(&root, path_expr);
            let serialized = serde_json::to_string_pretty(&extracted).unwrap_or_default();
            return Ok(apply_json_budget(&serialized, args.max_chars));
        }

        if args.format == "json" {
            let payload = json!({
                "totalComponents": comp_list.len(),
                "components": filtered,
            });
            let serialized = serde_json::to_string_pretty(&payload).unwrap_or_default();
            return Ok(apply_json_budget(&serialized, args.max_chars));
        }

        if filtered.is_empty() {
            return Ok("No framework component states recorded in this screenshot pack.".to_string());
        }

        let mut lines = vec![format!(
            "# Screenshot Pack Component States ({} of {})",
            filtered.len(),
            comp_list.len()
        )];
        for c in filtered {
            let loc = match c.component_file.as_deref().filter(|s| !s.is_empty()) {
                Some(file) => {
                    let ln = c
                        .component_line
                        .as_ref()
                        .filter(|v| !v.is_null())
                        .map(|v| v.to_string().trim_matches('"').to_string())
                        .unwrap_or_default();
                    format!(" @ {file}:{ln}")
                }
                None => String::new(),
            };
            let props_str = c
                .props
                .as_ref()
                .and_then(|p| serde_json::to_string(p).ok())
                .unwrap_or_else(|| "{}".to_string());
            let data_str = c
                .data
                .as_ref()
                .or(c.state.as_ref())
                .and_then(|d| serde_json::to_string(d).ok())
                .unwrap_or_else(|| "{}".to_string());
            lines.push(format!(
                "- **{}** ({}){loc}\n  - props: {props_str}\n  - data: {data_str}",
                c.component_name.as_deref().unwrap_or("Anonymous"),
                c.framework.as_deref().unwrap_or("vue/react")
            ));
        }
        return Ok(apply_char_budget(&lines.join("\n"), args.max_chars, None));
    }

    let LoadedPack::Session(session) = &loaded else {
        unreachable!()
    };

    let states = session.get_framework_states();
    if states.is_empty() {
        if args.format == "json" {
            let payload = json!({
                "totalStates": 0,
                "overview": [],
                "selectedIndex": null,
                "selectedState": null,
                "message": "No frameworkStates were captured in this session pack."
            });
            return Ok(apply_json_budget(
                &serde_json::to_string_pretty(&payload).unwrap_or_default(),
                args.max_chars,
            ));
        }
        return Ok("No frameworkStates were captured in this session pack.".to_string());
    }

    // 未指定 index 但指定 nearMs 时，寻找相对时间最接近的快照
    let mut selected_index = args.index;
    if selected_index.is_none() {
        if let Some(near_ms) = args.near_ms {
            let mut best_idx = 0usize;
            let mut best_dist = f64::INFINITY;
            for (idx, st) in states.iter().enumerate() {
                let rel = session.to_relative_ms(st.captured_at_epoch_ms).unwrap_or(0.0);
                let dist = (rel - near_ms).abs();
                if dist < best_dist {
                    best_dist = dist;
                    best_idx = idx;
                }
            }
            selected_index = Some(best_idx);
        }
    }

    let target_idx = selected_index.unwrap_or(states.len() - 1);
    let Some(target_state) = states.get(target_idx) else {
        return Err(CliError::new(format!(
            "FRAMEWORK_STATE_NOT_FOUND: Index {target_idx} out of range (0..{})",
            states.len() - 1
        )));
    };

    if let Some(path_expr) = args.path {
        let root = serde_json::to_value(target_state).unwrap_or(Value::Null);
        let extracted = evaluate_json_path(&root, path_expr);
        let mut obj = serde_json::Map::new();
        obj.insert("stateIndex".to_string(), json!(target_idx));
        if let Some(rel) = session.to_relative_ms(target_state.captured_at_epoch_ms) {
            if rel.is_finite() && rel.fract() == 0.0 && rel.abs() <= 9_007_199_254_740_991.0 {
                obj.insert("relativeMs".to_string(), json!(rel as i64));
            } else {
                obj.insert("relativeMs".to_string(), json!(rel));
            }
        }
        obj.insert("path".to_string(), json!(path_expr));
        obj.insert("value".to_string(), extracted);
        let serialized = serde_json::to_string_pretty(&Value::Object(obj)).unwrap_or_default();
        return Ok(apply_json_budget(&serialized, args.max_chars));
    }

    let comp_filter = args.component.map(|c| c.to_lowercase());

    if args.format == "json" {
        let comp_needle = comp_filter.as_deref();
        let overview: Vec<Value> = states
            .iter()
            .enumerate()
            .filter_map(|(idx, s)| {
                let all_nodes = collect_component_nodes(s);
                let matched_names: Vec<&str> = all_nodes
                    .iter()
                    .filter(|c| matches_component_filter(c, comp_needle))
                    .filter_map(|c| c.component_name.as_deref())
                    .filter(|n| !n.is_empty())
                    .collect();
                if comp_needle.is_some() && matched_names.is_empty() {
                    return None;
                }
                let ls_keys: Vec<&str> = s
                    .web_storage
                    .as_ref()
                    .and_then(|w| w.local_storage.as_ref())
                    .map(|m| m.keys().map(|k| k.as_str()).collect())
                    .unwrap_or_default();
                let ss_keys: Vec<&str> = s
                    .web_storage
                    .as_ref()
                    .and_then(|w| w.session_storage.as_ref())
                    .map(|m| m.keys().map(|k| k.as_str()).collect())
                    .unwrap_or_default();
                let mut m = serde_json::Map::new();
                m.insert("index".to_string(), json!(idx));
                if let Some(rel) = session.to_relative_ms(s.captured_at_epoch_ms) {
                    if rel.is_finite() && rel.fract() == 0.0 && rel.abs() <= 9_007_199_254_740_991.0
                    {
                        m.insert("relativeMs".to_string(), json!(rel as i64));
                    } else {
                        m.insert("relativeMs".to_string(), json!(rel));
                    }
                }
                if let Some(ref trig) = s.trigger {
                    m.insert("trigger".to_string(), json!(trig));
                }
                m.insert("components".to_string(), json!(matched_names));
                m.insert("localStorageKeys".to_string(), json!(ls_keys));
                m.insert("sessionStorageKeys".to_string(), json!(ss_keys));
                Some(Value::Object(m))
            })
            .collect();

        let matched_components: Vec<&FrameworkComponentNode> = collect_component_nodes(target_state)
            .into_iter()
            .filter(|c| matches_component_filter(c, comp_needle))
            .collect();

        let payload = if comp_needle.is_some() {
            json!({
                "totalStates": states.len(),
                "componentFilter": args.component,
                "overview": overview,
                "selectedIndex": target_idx,
                "matchedComponents": matched_components,
                "selectedState": target_state,
            })
        } else {
            json!({
                "totalStates": states.len(),
                "overview": overview,
                "selectedIndex": target_idx,
                "selectedState": target_state,
            })
        };
        let serialized = serde_json::to_string_pretty(&payload).unwrap_or_default();
        return Ok(apply_json_budget(&serialized, args.max_chars));
    }

    let mut lines = Vec::new();
    lines.push(format!(
        "# Framework States ({} snapshots in pack)",
        states.len()
    ));
    lines.push("\n## Snapshot Index Overview".to_string());
    for (idx, st) in states.iter().enumerate() {
        let rel = session.to_relative_ms(st.captured_at_epoch_ms);
        let comps: Vec<&str> = collect_component_nodes(st)
            .into_iter()
            .filter_map(|c| c.component_name.as_deref())
            .filter(|n| !n.is_empty())
            .take(5)
            .collect();
        let comp_label = if comps.is_empty() {
            "none".to_string()
        } else {
            comps.join(", ")
        };
        let ls_count = st
            .web_storage
            .as_ref()
            .and_then(|w| w.local_storage.as_ref())
            .map(|m| m.len())
            .unwrap_or(0);
        let ss_count = st
            .web_storage
            .as_ref()
            .and_then(|w| w.session_storage.as_ref())
            .map(|m| m.len())
            .unwrap_or(0);
        let marker = if idx == target_idx {
            " <-- [SELECTED]"
        } else {
            ""
        };
        lines.push(format!(
            "- **[{idx}]** {} trigger=`{}` | components=[{comp_label}] | localStorageKeys={ls_count} | sessionStorageKeys={ss_count}{marker}",
            format_relative_time(rel),
            st.trigger.as_deref().unwrap_or("?")
        ));
    }

    let rel = session.to_relative_ms(target_state.captured_at_epoch_ms);
    lines.push(format!(
        "\n## Selected Snapshot [{target_idx}] (at {}, trigger=`{}`)",
        format_relative_time(rel),
        target_state.trigger.as_deref().unwrap_or("?")
    ));

    let comp_nodes: Vec<&FrameworkComponentNode> = collect_component_nodes(target_state)
        .into_iter()
        .filter(|c| matches_component_filter(c, comp_filter.as_deref()))
        .collect();

    if !comp_nodes.is_empty() {
        lines.push(format!("\n### Component Tree / Chain ({})", comp_nodes.len()));
        for c in comp_nodes {
            let ver = c
                .version
                .as_ref()
                .filter(|v| !v.is_null())
                .map(|v| v.to_string().trim_matches('"').to_string())
                .unwrap_or_else(|| "?".to_string());
            lines.push(format!(
                "- **{}** ({} v{ver})",
                c.component_name.as_deref().unwrap_or("Anonymous"),
                c.framework.as_deref().unwrap_or("framework")
            ));
            if let Some(ref props) = c.props {
                if !props.is_empty() {
                    lines.push(format!(
                        "  - props: {}",
                        serde_json::to_string(props).unwrap_or_default()
                    ));
                }
            }
            if let Some(st_data) = c.state.as_ref().or(c.data.as_ref()) {
                if !st_data.is_empty() {
                    lines.push(format!(
                        "  - state: {}",
                        serde_json::to_string(st_data).unwrap_or_default()
                    ));
                }
            }
        }
    } else {
        lines.push(format!(
            "\n### Component Tree\n(No component tree recorded on snapshot [{target_idx}])"
        ));
    }

    if let Some(ref gs) = target_state.global_state {
        if !gs.is_empty() {
            lines.push("\n### Global State".to_string());
            lines.push(serde_json::to_string_pretty(gs).unwrap_or_default());
        }
    }

    if let Some(ref ws) = target_state.web_storage {
        lines.push(format!(
            "\n### Web Storage (redactedValues: {})",
            ws.redacted_values.unwrap_or(false)
        ));
        if let Some(ref ls) = ws.local_storage {
            if !ls.is_empty() {
                lines.push("#### localStorage".to_string());
                lines.push(serde_json::to_string_pretty(ls).unwrap_or_default());
            }
        }
        if let Some(ref ss_map) = ws.session_storage {
            if !ss_map.is_empty() {
                lines.push("#### sessionStorage".to_string());
                lines.push(serde_json::to_string_pretty(ss_map).unwrap_or_default());
            }
        }
    }

    Ok(apply_char_budget(&lines.join("\n"), args.max_chars, None))
}
