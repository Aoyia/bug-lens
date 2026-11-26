//! 截图包 DOM 布局溢出诊断（text_overflow / flex_squeeze / grid_overflow）与 CSS 级联规则查询。

use crate::error::{CliError, CliResult};
use crate::format::budget::slice_chars;
use crate::format::element::squash_whitespace;
use crate::pack::types::{
    CascadeElementRef, CascadeIndex, CascadeRuleSource, CascadeSheetSource, ScreenshotDomAnchor,
    ScreenshotDomContext,
};
use indexmap::{IndexMap, IndexSet};
use regex::{Regex, RegexBuilder};
use serde::Serialize;
use serde_json::{Map, Value};
use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;

fn key_layout_style_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"(?i)^(?:word-break|overflow-wrap|word-wrap|white-space|white-space-collapse|text-wrap|text-wrap-mode|text-overflow|overflow|overflow-x|overflow-y|display|width|max-width|min-width|height|max-height|min-height|flex|flex-grow|flex-shrink|flex-basis|flex-wrap|flex-direction|-webkit-line-clamp|line-clamp|position|z-index)$")
            .expect("valid key layout style regex")
    })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutDeviationGroup {
    pub kind: String,
    pub selector: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub selector_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub component: Option<String>,
    pub anchor_indices: Vec<usize>,
    pub summary: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sample_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key_styles: Option<IndexMap<String, String>>,
}

fn pick_key_styles(styles: Option<&Map<String, Value>>) -> Option<IndexMap<String, String>> {
    let styles = styles?;
    let mut out = IndexMap::new();
    for (k, v) in styles {
        let Some(val) = v.as_str() else {
            continue;
        };
        if key_layout_style_regex().is_match(k)
            && !matches!(val, "" | "normal" | "auto" | "none" | "visible" | "static")
        {
            out.insert(k.clone(), val.to_string());
        }
    }
    if out.is_empty() {
        None
    } else {
        Some(out)
    }
}

fn val_to_display(v: Option<&Value>, fallback: &str) -> String {
    match v {
        None | Some(Value::Null) => fallback.to_string(),
        Some(Value::String(s)) => s.clone(),
        Some(Value::Number(n)) => n.to_string(),
        Some(Value::Bool(b)) => b.to_string(),
        Some(other) => other.to_string(),
    }
}

fn inspect_layout_node(
    node: &Map<String, Value>,
    anchor_idx: Option<usize>,
    groups: &mut IndexMap<String, LayoutDeviationGroup>,
) {
    let selector = node
        .get("selector")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .or_else(|| {
            node.get("tagName")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
        })
        .unwrap_or("element")
        .to_string();
    let selector_path = node
        .get("selectorPath")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let comp_name = node
        .get("componentName")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty());
    let comp_file = node
        .get("componentFile")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty());
    let comp_line = node.get("componentLine").and_then(|v| {
        if v.is_null() {
            None
        } else {
            let s = val_to_display(Some(v), "");
            if s.is_empty() || s == "0" {
                None
            } else {
                Some(s)
            }
        }
    });
    let component = comp_name.map(|name| match comp_file {
        Some(file) => match &comp_line {
            Some(line) => format!("{name} @ {file}:{line}"),
            None => format!("{name} @ {file}"),
        },
        None => name.to_string(),
    });

    let layout_ctx = node.get("layoutContext").and_then(|v| v.as_object());
    let text_ov = layout_ctx
        .and_then(|lc| lc.get("textOverflow"))
        .or_else(|| node.get("textOverflow"))
        .and_then(|v| v.as_object());
    let squeeze = layout_ctx
        .and_then(|lc| lc.get("flexSqueezeRisk"))
        .or_else(|| node.get("flexSqueezeRisk"))
        .and_then(|v| v.as_object());
    let grid = layout_ctx
        .and_then(|lc| lc.get("gridSelf"))
        .or_else(|| node.get("gridSelf"))
        .and_then(|v| v.as_object());
    let computed_styles = node.get("computedStyles").and_then(|v| v.as_object());
    let sample_text = node
        .get("innerText")
        .and_then(|v| v.as_str())
        .map(|s| slice_chars(&squash_whitespace(s), 80).to_string());

    if let Some(tov) = text_ov {
        if tov.get("isTruncated").and_then(|v| v.as_bool()) == Some(true) {
            let scroll_dim = tov.get("scrollDimension").and_then(|v| v.as_object());
            let client_dim = tov.get("clientDimension").and_then(|v| v.as_object());
            let delta = tov.get("overflowDelta").and_then(|v| v.as_object());
            let trunc_type = val_to_display(tov.get("truncationType"), "truncated");
            let cw_key = val_to_display(client_dim.and_then(|d| d.get("width")), "0");
            let ch_key = val_to_display(client_dim.and_then(|d| d.get("height")), "0");
            let key = format!("text_overflow|{selector}|{trunc_type}|{cw_key}x{ch_key}");
            if let Some(existing) = groups.get_mut(&key) {
                if let Some(idx) = anchor_idx {
                    if !existing.anchor_indices.contains(&idx) {
                        existing.anchor_indices.push(idx);
                    }
                }
            } else {
                let sw = val_to_display(scroll_dim.and_then(|d| d.get("width")), "?");
                let sh = val_to_display(scroll_dim.and_then(|d| d.get("height")), "?");
                let cw = val_to_display(client_dim.and_then(|d| d.get("width")), "?");
                let ch = val_to_display(client_dim.and_then(|d| d.get("height")), "?");
                let dw = val_to_display(delta.and_then(|d| d.get("width")), "0");
                let dh = val_to_display(delta.and_then(|d| d.get("height")), "0");
                groups.insert(
                    key,
                    LayoutDeviationGroup {
                        kind: "text_overflow".to_string(),
                        selector: selector.clone(),
                        selector_path: selector_path.clone(),
                        component: component.clone(),
                        anchor_indices: anchor_idx.into_iter().collect(),
                        summary: format!(
                            "{trunc_type} truncation (scroll {sw}x{sh}px > client {cw}x{ch}px, delta +{dw}px W / +{dh}px H)"
                        ),
                        sample_text: sample_text.clone(),
                        key_styles: pick_key_styles(computed_styles),
                    },
                );
            }
        }
    }

    if let Some(sq) = squeeze {
        if sq.get("isSqueezed").and_then(|v| v.as_bool()) == Some(true) {
            let rw_key = val_to_display(sq.get("renderedWidth"), "0");
            let key = format!("flex_squeeze|{selector}|{rw_key}");
            if let Some(existing) = groups.get_mut(&key) {
                if let Some(idx) = anchor_idx {
                    if !existing.anchor_indices.contains(&idx) {
                        existing.anchor_indices.push(idx);
                    }
                }
            } else {
                let iw = val_to_display(sq.get("intrinsicWidth"), "?");
                let rw = val_to_display(sq.get("renderedWidth"), "?");
                let fs = val_to_display(sq.get("flexShrink"), "?");
                groups.insert(
                    key,
                    LayoutDeviationGroup {
                        kind: "flex_squeeze".to_string(),
                        selector: selector.clone(),
                        selector_path: selector_path.clone(),
                        component: component.clone(),
                        anchor_indices: anchor_idx.into_iter().collect(),
                        summary: format!(
                            "Flex squeeze (intrinsic {iw}px -> rendered {rw}px, flex-shrink={fs})"
                        ),
                        sample_text: sample_text.clone(),
                        key_styles: pick_key_styles(computed_styles),
                    },
                );
            }
        }
    }

    if let Some(gr) = grid {
        if gr.get("isGridOverflow").and_then(|v| v.as_bool()) == Some(true) {
            let key = format!("grid_overflow|{selector}");
            if let Some(existing) = groups.get_mut(&key) {
                if let Some(idx) = anchor_idx {
                    if !existing.anchor_indices.contains(&idx) {
                        existing.anchor_indices.push(idx);
                    }
                }
            } else {
                let reason = val_to_display(gr.get("reason"), "Grid item overflowed track");
                groups.insert(
                    key,
                    LayoutDeviationGroup {
                        kind: "grid_overflow".to_string(),
                        selector,
                        selector_path,
                        component,
                        anchor_indices: anchor_idx.into_iter().collect(),
                        summary: reason,
                        sample_text,
                        key_styles: pick_key_styles(computed_styles),
                    },
                );
            }
        }
    }
}

pub fn extract_layout_deviations(dc: Option<&ScreenshotDomContext>) -> Vec<LayoutDeviationGroup> {
    let Some(dc) = dc else {
        return Vec::new();
    };
    let mut groups: IndexMap<String, LayoutDeviationGroup> = IndexMap::new();

    if let Some(anchors) = &dc.anchors {
        for (idx, a) in anchors.iter().enumerate() {
            if let Ok(Value::Object(map)) = serde_json::to_value(a) {
                inspect_layout_node(&map, Some(idx), &mut groups);
            }
        }
    }

    fn walk_tree(node: &Value, groups: &mut IndexMap<String, LayoutDeviationGroup>) {
        if let Value::Object(map) = node {
            inspect_layout_node(map, None, groups);
            if let Some(Value::Array(children)) = map.get("children") {
                for child in children {
                    walk_tree(child, groups);
                }
            }
        }
    }
    if let Some(tree) = &dc.tree {
        walk_tree(tree, &mut groups);
    }

    groups.into_values().collect()
}

fn format_sheet_ref(sheet_id: &str, sheets_map: &HashMap<&str, &CascadeSheetSource>) -> String {
    let Some(s) = sheets_map.get(sheet_id) else {
        return sheet_id.to_string();
    };
    if let Some(href) = s.href.as_deref().filter(|h| !h.is_empty()) {
        // Extract pathname from URL or raw string
        let without_q = href.split(['?', '#']).next().unwrap_or(href);
        let path_part = if let Some(scheme_idx) = without_q.find("://") {
            let after_scheme = &without_q[scheme_idx + 3..];
            match after_scheme.find('/') {
                Some(slash) => &after_scheme[slash..],
                None => "/",
            }
        } else {
            without_q
        };
        let base = path_part
            .split('/')
            .rfind(|seg| !seg.is_empty())
            .unwrap_or(path_part);
        return format!("{sheet_id}:{base}");
    }
    format!("{sheet_id}:inline")
}

fn extract_key_declarations(rule: &CascadeRuleSource) -> Vec<String> {
    let mut out = Vec::new();
    if let Some(style_props) = rule.style_props.as_ref().filter(|m| !m.is_empty()) {
        for (prop, val) in style_props {
            if key_layout_style_regex().is_match(prop) {
                out.push(format!("{prop}: {val}"));
            }
        }
    } else if !rule.css_text.is_empty() {
        let body = if let (Some(open), Some(close)) =
            (rule.css_text.find('{'), rule.css_text.rfind('}'))
        {
            if close > open {
                &rule.css_text[open + 1..close]
            } else {
                rule.css_text.as_str()
            }
        } else {
            rule.css_text.as_str()
        };
        for decl in body.split(';') {
            let trimmed = decl.trim();
            if trimmed.is_empty() {
                continue;
            }
            if let Some(colon) = trimmed.find(':') {
                if colon > 0 {
                    let prop = trimmed[..colon].trim();
                    if key_layout_style_regex().is_match(prop) {
                        out.push(trimmed.to_string());
                    }
                }
            }
        }
    }
    out
}

pub fn format_cascade_overview(cascade: Option<&CascadeIndex>) -> Vec<String> {
    let Some(cascade) = cascade else {
        return Vec::new();
    };
    let sheets = cascade.sheets.as_deref().unwrap_or(&[]);
    let rules = cascade.rules.as_deref().unwrap_or(&[]);
    let elements = cascade.elements.as_deref().unwrap_or(&[]);

    let sheets_map: HashMap<&str, &CascadeSheetSource> =
        sheets.iter().map(|s| (s.id.as_str(), s)).collect();
    let rules_map: HashMap<&str, &CascadeRuleSource> =
        rules.iter().map(|r| (r.id.as_str(), r)).collect();

    let mut lines = Vec::new();
    lines.push(format!(
        "\n## CSS Cascade Index ({} stylesheets, {} rules, {} indexed elements)",
        sheets.len(),
        rules.len(),
        elements.len()
    ));

    let mut active_sheet_ids: HashSet<&str> = HashSet::new();
    for el in elements {
        for rid in el.matched_rule_ids.as_deref().unwrap_or(&[]) {
            if let Some(r) = rules_map.get(rid.as_str()) {
                active_sheet_ids.insert(r.sheet_id.as_str());
            }
        }
    }

    let external_sheets: Vec<&CascadeSheetSource> = sheets
        .iter()
        .filter(|s| {
            s.href.as_deref().is_some_and(|h| !h.is_empty())
                && (active_sheet_ids.is_empty() || active_sheet_ids.contains(s.id.as_str()))
        })
        .collect();
    let inline_count = sheets
        .iter()
        .filter(|s| s.href.as_deref().is_none_or(|h| h.is_empty()))
        .count();

    if !external_sheets.is_empty() || inline_count > 0 {
        lines.push("### Active Stylesheets (referenced by captured elements)".to_string());
        for s in external_sheets.iter().take(12) {
            lines.push(format!(
                "- `{}`: {} ({} rules)",
                s.id,
                s.href.as_deref().unwrap_or(""),
                s.rules_count.unwrap_or(0)
            ));
        }
        if external_sheets.len() > 12 {
            lines.push(format!(
                "- ... +{} more active stylesheets",
                external_sheets.len() - 12
            ));
        }
        if inline_count > 0 {
            lines.push(format!(
                "- `inline <style>`: {inline_count} inline style tag(s)"
            ));
        }
    }

    if !elements.is_empty() {
        lines.push("### Indexed Elements & Key Layout/Wrapping Rule Overrides".to_string());
        let mut seen_el_sig: IndexMap<String, Vec<&str>> = IndexMap::new();
        let mut unique_elements: Vec<(usize, &CascadeElementRef, String)> = Vec::new();

        for (idx, el) in elements.iter().enumerate() {
            let matched = el.matched_rule_ids.as_deref().unwrap_or(&[]);
            let sig = format!("{}|{}", el.tag_name, matched.join(","));
            if let Some(list) = seen_el_sig.get_mut(&sig) {
                list.push(el.id.as_str());
            } else {
                seen_el_sig.insert(sig.clone(), vec![el.id.as_str()]);
                unique_elements.push((idx, el, sig));
            }
        }

        for (idx, el, sig) in unique_elements.iter().take(12) {
            let matched_ids = el.matched_rule_ids.as_deref().unwrap_or(&[]);
            let fallback_ids = [el.id.as_str()];
            let all_ids = seen_el_sig
                .get(sig)
                .map(|v| v.as_slice())
                .unwrap_or(&fallback_ids);
            let dup_ids = if all_ids.len() > 1 {
                format!(" (also {})", all_ids[1..].join(", "))
            } else {
                String::new()
            };

            struct DedupRule<'a> {
                rule: &'a CascadeRuleSource,
                decls: Vec<String>,
                rule_ids: Vec<&'a str>,
                sheet_refs: IndexSet<String>,
            }
            let mut dedup_rules: IndexMap<String, DedupRule<'_>> = IndexMap::new();

            for rid in matched_ids {
                let Some(r) = rules_map.get(rid.as_str()).copied() else {
                    continue;
                };
                let decls = extract_key_declarations(r);
                if decls.is_empty() {
                    continue;
                }
                let rule_sig = format!("{}||{}", r.selector_text, decls.join(";"));
                let sheet_ref = format_sheet_ref(&r.sheet_id, &sheets_map);
                if let Some(existing) = dedup_rules.get_mut(&rule_sig) {
                    existing.rule_ids.push(rid.as_str());
                    existing.sheet_refs.insert(sheet_ref);
                } else {
                    let mut sheet_refs = IndexSet::new();
                    sheet_refs.insert(sheet_ref);
                    dedup_rules.insert(
                        rule_sig,
                        DedupRule {
                            rule: r,
                            decls,
                            rule_ids: vec![rid.as_str()],
                            sheet_refs,
                        },
                    );
                }
            }

            lines.push(format!(
                "- **[{idx}] `{}`{dup_ids} `<{}>` `{}`** ({} matched rules)",
                el.id,
                el.tag_name,
                el.selector,
                matched_ids.len()
            ));
            for item in dedup_rules.values() {
                let ids_str = if item.rule_ids.len() > 1 {
                    format!("{} (+{})", item.rule_ids[0], item.rule_ids.len() - 1)
                } else {
                    item.rule_ids[0].to_string()
                };
                let sheets_str = item
                    .sheet_refs
                    .iter()
                    .take(2)
                    .cloned()
                    .collect::<Vec<_>>()
                    .join(", ");
                lines.push(format!(
                    "  - [{ids_str} @ {sheets_str}] `{}` -> `{}`",
                    item.rule.selector_text,
                    item.decls.join("; ")
                ));
            }
        }
        if unique_elements.len() > 12 {
            lines.push(format!(
                "- ... +{} more elements (call `get_scene(selector=\"...\")` or `search_pack` to inspect)",
                unique_elements.len() - 12
            ));
        }
    }

    lines
}

pub fn query_screenshot_dom_and_cascade(
    dc: Option<&ScreenshotDomContext>,
    cascade: Option<&CascadeIndex>,
    selector: Option<&str>,
    css_property: Option<&str>,
) -> CliResult<Vec<String>> {
    let mut lines = Vec::new();
    let sel_needle = selector
        .map(|s| s.trim().to_lowercase())
        .filter(|s| !s.is_empty());
    let prop_regex = match css_property.map(|s| s.trim()).filter(|s| !s.is_empty()) {
        Some(pat) => Some(
            RegexBuilder::new(pat)
                .case_insensitive(true)
                .build()
                .map_err(|err| CliError::new(format!("INVALID_REGEX: {err}")))?,
        ),
        None => None,
    };

    let anchors: &[ScreenshotDomAnchor] = dc.and_then(|d| d.anchors.as_deref()).unwrap_or(&[]);
    let mut matched_anchors: Vec<(usize, &ScreenshotDomAnchor)> = Vec::new();

    for (idx, a) in anchors.iter().enumerate() {
        if let Some(ref needle) = sel_needle {
            let hay = format!(
                "{idx} {} {} {} {} {} {}",
                a.selector.as_deref().unwrap_or(""),
                a.selector_path.as_deref().unwrap_or(""),
                a.tag_name.as_deref().unwrap_or(""),
                a.component_name.as_deref().unwrap_or(""),
                a.component_file.as_deref().unwrap_or(""),
                a.inner_text.as_deref().unwrap_or("")
            )
            .to_lowercase();
            if hay.contains(needle) {
                matched_anchors.push((idx, a));
            }
        } else {
            matched_anchors.push((idx, a));
        }
    }

    lines.push(format!(
        "## Matched DOM Anchors ({} of {})",
        matched_anchors.len(),
        anchors.len()
    ));

    let mut seen_signatures: IndexMap<String, Vec<usize>> = IndexMap::new();
    let mut representative_anchors: Vec<(usize, &ScreenshotDomAnchor, String)> = Vec::new();

    for &(idx, a) in &matched_anchors {
        let trunc_type = a
            .layout_context
            .as_ref()
            .and_then(|lc| lc.get("textOverflow"))
            .and_then(|to| to.get("truncationType"))
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let flags_json = a
            .intent_flags
            .as_ref()
            .and_then(|f| serde_json::to_string(f).ok())
            .unwrap_or_else(|| "{}".to_string());
        let sig = format!(
            "{}|{}|{trunc_type}|{flags_json}",
            a.selector_path
                .as_deref()
                .or(a.selector.as_deref())
                .unwrap_or(""),
            a.component_name.as_deref().unwrap_or("")
        );
        if let Some(list) = seen_signatures.get_mut(&sig) {
            list.push(idx);
            if sel_needle.is_some() && matched_anchors.len() <= 10 {
                representative_anchors.push((idx, a, format!("{sig}#{idx}")));
            }
        } else {
            seen_signatures.insert(sig.clone(), vec![idx]);
            representative_anchors.push((idx, a, sig));
        }
    }

    for (idx, a, sig) in representative_anchors.into_iter().take(30) {
        let group_indices = seen_signatures
            .get(&sig)
            .cloned()
            .unwrap_or_else(|| vec![idx]);
        let dup_suffix = if group_indices.len() > 1 {
            let sample: Vec<String> = group_indices[1..]
                .iter()
                .take(7)
                .map(|i| i.to_string())
                .collect();
            let ellipsis = if group_indices.len() > 8 { ", ..." } else { "" };
            format!(
                " (and {} identical sibling anchor(s): [{}{ellipsis}])",
                group_indices.len() - 1,
                sample.join(", ")
            )
        } else {
            String::new()
        };
        let comp = match a.component_name.as_deref().filter(|s| !s.is_empty()) {
            Some(name) => match a.component_file.as_deref().filter(|s| !s.is_empty()) {
                Some(file) => {
                    let ln = val_to_display(a.component_line.as_ref(), "");
                    format!(" [{name} @ {file}:{ln}]")
                }
                None => format!(" [{name}]"),
            },
            None => String::new(),
        };
        let path_label = a
            .selector_path
            .as_deref()
            .or(a.selector.as_deref())
            .unwrap_or("?");
        lines.push(format!("- **[{idx}] `{path_label}`**{comp}{dup_suffix}"));

        if let Some(ref flags) = a.intent_flags {
            if let Ok(Value::Object(map)) = serde_json::to_value(flags) {
                if !map.is_empty() {
                    lines.push(format!(
                        "  - flags: {}",
                        serde_json::to_string(&map).unwrap_or_default()
                    ));
                }
            }
        }
        if let Some(ref text) = a.inner_text {
            if !text.is_empty() {
                let clean = squash_whitespace(text);
                lines.push(format!("  - text: \"{}\"", slice_chars(&clean, 140)));
            }
        }
        if let Some(ref rect) = a.relative_rect {
            lines.push(format!(
                "  - rect: {}",
                serde_json::to_string(rect).unwrap_or_default()
            ));
        }
        if let Some(ref bm) = a.box_model {
            lines.push(format!(
                "  - boxModel: {}",
                serde_json::to_string(bm).unwrap_or_default()
            ));
        }
        if let Some(ref cs) = a.computed_styles {
            if !cs.is_empty() {
                let styles_json = if let Some(ref re) = prop_regex {
                    let filtered: IndexMap<&String, &String> = cs
                        .iter()
                        .filter(|(k, v)| re.is_match(k) || re.is_match(v))
                        .collect();
                    serde_json::to_string(&filtered).unwrap_or_default()
                } else {
                    serde_json::to_string(cs).unwrap_or_default()
                };
                lines.push(format!("  - computedStyles: {styles_json}"));
            }
        }
        if let Some(Value::Object(ref lc)) = a.layout_context {
            if !lc.is_empty() {
                lines.push(format!(
                    "  - layoutContext: {}",
                    serde_json::to_string(lc).unwrap_or_default()
                ));
            }
        }
    }

    if let Some(cascade) = cascade {
        let sheets = cascade.sheets.as_deref().unwrap_or(&[]);
        let rules = cascade.rules.as_deref().unwrap_or(&[]);
        let elements = cascade.elements.as_deref().unwrap_or(&[]);
        let sheets_map: HashMap<&str, &CascadeSheetSource> =
            sheets.iter().map(|s| (s.id.as_str(), s)).collect();
        let rules_map: HashMap<&str, &CascadeRuleSource> =
            rules.iter().map(|r| (r.id.as_str(), r)).collect();

        let mut matched_cascade_els: Vec<(usize, &CascadeElementRef)> = Vec::new();
        for (idx, el) in elements.iter().enumerate() {
            if let Some(ref needle) = sel_needle {
                let hay = format!("{idx} {} {} {}", el.id, el.tag_name, el.selector).to_lowercase();
                if hay.contains(needle) {
                    matched_cascade_els.push((idx, el));
                }
            } else {
                matched_cascade_els.push((idx, el));
            }
        }

        lines.push(format!(
            "\n## Matched CSS Cascade Elements ({} of {})",
            matched_cascade_els.len(),
            elements.len()
        ));

        for (idx, el) in matched_cascade_els.into_iter().take(20) {
            lines.push(format!(
                "- **[{idx}] `{}` `<{}>` `{}`**",
                el.id, el.tag_name, el.selector
            ));

            struct DedupMatch<'a> {
                rule: &'a CascadeRuleSource,
                rule_ids: Vec<&'a str>,
                sheet_hrefs: IndexSet<String>,
            }
            let mut dedup: IndexMap<String, DedupMatch<'_>> = IndexMap::new();

            for rid in el.matched_rule_ids.as_deref().unwrap_or(&[]) {
                let Some(r) = rules_map.get(rid.as_str()).copied() else {
                    continue;
                };
                if let Some(ref re) = prop_regex {
                    if !re.is_match(&r.css_text) && !re.is_match(&r.selector_text) {
                        continue;
                    }
                }
                let sig = format!("{}||{}", r.selector_text, r.css_text);
                let sheet_obj = sheets_map.get(r.sheet_id.as_str()).copied();
                let sheet_label = match sheet_obj
                    .and_then(|s| s.href.as_deref())
                    .filter(|h| !h.is_empty())
                {
                    Some(href) => format!("{} ({href})", r.sheet_id),
                    None => format!(
                        "{} (inline <{}>)",
                        r.sheet_id,
                        sheet_obj
                            .and_then(|s| s.owner_node_tag.as_deref())
                            .unwrap_or("style")
                    ),
                };
                if let Some(ex) = dedup.get_mut(&sig) {
                    ex.rule_ids.push(rid.as_str());
                    ex.sheet_hrefs.insert(sheet_label);
                } else {
                    let mut sheet_hrefs = IndexSet::new();
                    sheet_hrefs.insert(sheet_label);
                    dedup.insert(
                        sig,
                        DedupMatch {
                            rule: r,
                            rule_ids: vec![rid.as_str()],
                            sheet_hrefs,
                        },
                    );
                }
            }

            if dedup.is_empty() {
                lines.push("  - (no matched rules for filter)".to_string());
            } else {
                for item in dedup.values() {
                    let ids_label = item.rule_ids.join(", ");
                    let sheets_label = item
                        .sheet_hrefs
                        .iter()
                        .cloned()
                        .collect::<Vec<_>>()
                        .join(" | ");
                    lines.push(format!(
                        "  - **[{ids_label}]** [sheet: {sheets_label}] `{}` -> `{}`",
                        item.rule.selector_text, item.rule.css_text
                    ));
                }
            }

            if let Some(ref inh_rules) = el.inherited_rules {
                for inh in inh_rules {
                    let inh_str = inh
                        .inherited_props
                        .as_ref()
                        .and_then(|m| serde_json::to_string(m).ok())
                        .unwrap_or_else(|| "{}".to_string());
                    if let Some(ref re) = prop_regex {
                        if !re.is_match(&inh_str) && !re.is_match(&inh.ancestor_selector) {
                            continue;
                        }
                    }
                    let r = rules_map.get(inh.rule_id.as_str()).copied();
                    let sheet_obj = r.and_then(|rr| sheets_map.get(rr.sheet_id.as_str()).copied());
                    let sheet_ref = sheet_obj
                        .and_then(|s| s.href.as_deref())
                        .or_else(|| r.map(|rr| rr.sheet_id.as_str()))
                        .unwrap_or("?");
                    lines.push(format!(
                        "  - *[inherited from `<{}> {}` via {} @ {sheet_ref}]*: {inh_str}",
                        inh.ancestor_tag_name, inh.ancestor_selector, inh.rule_id
                    ));
                }
            }
        }
    }

    Ok(lines)
}
