//! `search_pack` 命令：跨控制台、网络 URL/正文、交互、组件状态及 CSS 级联规则执行全文检索。

use crate::error::CliResult;
use crate::format::budget::{apply_char_budget, apply_json_budget, slice_chars};
use crate::format::element::squash_whitespace;
use crate::pack::open::{open_pack_with_options, OpenOptions};
use crate::pack::screenshot_pack::LoadedScreenshotPack;
use crate::pack::types::{CascadeRuleSource, CascadeSheetSource};
use crate::pack::LoadedPack;
use crate::query::search::{make_snippets, search_session_pack, SearchPackOptions};
use indexmap::{IndexMap, IndexSet};
use serde::Serialize;
use serde_json::json;
use std::collections::HashMap;

/// `search_pack` 命令入参。
pub struct SearchPackToolArgs<'a> {
    pub pack: Option<&'a str>,
    pub query: &'a str,
    pub scopes: Option<Vec<String>>,
    pub limit: Option<usize>,
    pub context_chars: Option<usize>,
    pub format: &'a str,
    pub max_chars: Option<usize>,
}

#[derive(Debug, Clone, Serialize)]
struct ScreenshotSearchHit {
    category: String,
    #[serde(rename = "ref")]
    ref_id: String,
    detail: String,
}

/// 面向截图批注包的结构化检索（DOM 锚点 -> CSS 级联 -> 组件状态 -> 原始 JSON/MD 兜底）。
fn search_screenshot_pack_structured(
    pack: &LoadedScreenshotPack,
    query: &str,
    limit: usize,
    radius: usize,
) -> (usize, Vec<ScreenshotSearchHit>) {
    let needle = query.trim().to_lowercase();
    if needle.is_empty() {
        return (0, Vec::new());
    }

    let mut hits: Vec<ScreenshotSearchHit> = Vec::new();

    // 1. 检索 dom-context.json 锚点
    let anchors = pack
        .dom_context
        .as_ref()
        .and_then(|d| d.anchors.as_deref())
        .unwrap_or(&[]);
    for (idx, a) in anchors.iter().enumerate() {
        let raw = json!({
            "selector": a.selector,
            "selectorPath": a.selector_path,
            "componentName": a.component_name,
            "componentFile": a.component_file,
            "innerText": a.inner_text,
            "computedStyles": a.computed_styles,
            "layoutContext": a.layout_context,
            "intentFlags": a.intent_flags,
        })
        .to_string();
        if raw.to_lowercase().contains(&needle) {
            let comp = match a.component_name.as_deref().filter(|s| !s.is_empty()) {
                Some(name) => match a.component_file.as_deref().filter(|s| !s.is_empty()) {
                    Some(file) => {
                        let ln = a
                            .component_line
                            .as_ref()
                            .filter(|v| !v.is_null())
                            .map(|v| v.to_string().trim_matches('"').to_string())
                            .unwrap_or_default();
                        format!(" [{name} @ {file}:{ln}]")
                    }
                    None => format!(" [{name}]"),
                },
                None => String::new(),
            };
            let trunc = a
                .layout_context
                .as_ref()
                .and_then(|lc| lc.get("textOverflow"))
                .and_then(|to| to.get("reason"))
                .and_then(|v| v.as_str());
            let overflow_part = match trunc {
                Some(r) => format!(" | overflow: {r}"),
                None => String::new(),
            };
            let styles_str = a
                .computed_styles
                .as_ref()
                .and_then(|m| serde_json::to_string(m).ok())
                .unwrap_or_else(|| "{}".to_string());
            let clean_text = squash_whitespace(a.inner_text.as_deref().unwrap_or(""));
            let text_preview = slice_chars(&clean_text, 80);
            hits.push(ScreenshotSearchHit {
                category: "dom-anchor".to_string(),
                ref_id: format!("anchor#{idx}"),
                detail: format!(
                    "`{}`{comp} text=\"{text_preview}\"{overflow_part} | styles={styles_str}",
                    a.selector_path
                        .as_deref()
                        .or(a.selector.as_deref())
                        .unwrap_or("?")
                ),
            });
        }
    }

    // 2. 检索 cascade.json 样式表、元素与规则（合并重复规则签名）
    if let Some(ref cascade) = pack.cascade {
        let sheets = cascade.sheets.as_deref().unwrap_or(&[]);
        let rules = cascade.rules.as_deref().unwrap_or(&[]);
        let elements = cascade.elements.as_deref().unwrap_or(&[]);

        let sheets_map: HashMap<&str, &CascadeSheetSource> =
            sheets.iter().map(|s| (s.id.as_str(), s)).collect();
        let rules_map: HashMap<&str, &CascadeRuleSource> =
            rules.iter().map(|r| (r.id.as_str(), r)).collect();

        // 反向索引：ruleId -> 命中的元素标签列表
        let mut rule_to_elements: HashMap<&str, Vec<String>> = HashMap::new();
        for el in elements {
            let label = format!("{}({})", el.id, el.selector);
            for rid in el.matched_rule_ids.as_deref().unwrap_or(&[]) {
                rule_to_elements
                    .entry(rid.as_str())
                    .or_default()
                    .push(label.clone());
            }
        }

        for s in sheets {
            if s.id.to_lowercase() == needle
                || s.href
                    .as_deref()
                    .is_some_and(|h| h.to_lowercase().contains(&needle))
            {
                hits.push(ScreenshotSearchHit {
                    category: "cascade-sheet".to_string(),
                    ref_id: s.id.clone(),
                    detail: format!(
                        "href={} ({} rules, tag=<{}>)",
                        s.href.as_deref().unwrap_or("inline"),
                        s.rules_count.unwrap_or(0),
                        s.owner_node_tag.as_deref().unwrap_or("style")
                    ),
                });
            }
        }

        for (idx, el) in elements.iter().enumerate() {
            if el.id.to_lowercase() == needle || el.selector.to_lowercase().contains(&needle) {
                let matched = el.matched_rule_ids.as_deref().unwrap_or(&[]);
                let start = matched.len().saturating_sub(6);
                let sample_rules = matched[start..]
                    .iter()
                    .map(|rid| match rules_map.get(rid.as_str()) {
                        Some(r) => format!("{rid}:{}", r.selector_text),
                        None => rid.clone(),
                    })
                    .collect::<Vec<_>>()
                    .join(", ");
                hits.push(ScreenshotSearchHit {
                    category: "cascade-element".to_string(),
                    ref_id: format!("{} (index {idx})", el.id),
                    detail: format!(
                        "<{}> `{}` ({} matched rules, e.g. [{sample_rules}])",
                        el.tag_name,
                        el.selector,
                        matched.len()
                    ),
                });
            }
        }

        struct RuleGroup<'a> {
            rule: &'a CascadeRuleSource,
            rule_ids: Vec<&'a str>,
            sheet_refs: IndexSet<String>,
            matched_elements: IndexSet<String>,
        }
        let mut matched_rule_groups: IndexMap<String, RuleGroup<'_>> = IndexMap::new();

        for r in rules {
            if r.id.to_lowercase() == needle
                || r.selector_text.to_lowercase().contains(&needle)
                || r.css_text.to_lowercase().contains(&needle)
            {
                let sig = format!("{}||{}", r.selector_text, r.css_text);
                let sheet_obj = sheets_map.get(r.sheet_id.as_str()).copied();
                let sheet_label = match sheet_obj
                    .and_then(|s| s.href.as_deref())
                    .filter(|h| !h.is_empty())
                {
                    Some(href) => format!("{} ({href})", r.sheet_id),
                    None => format!("{} (inline)", r.sheet_id),
                };
                let els = rule_to_elements
                    .get(r.id.as_str())
                    .map(|v| v.as_slice())
                    .unwrap_or(&[]);
                if let Some(ex) = matched_rule_groups.get_mut(&sig) {
                    ex.rule_ids.push(r.id.as_str());
                    ex.sheet_refs.insert(sheet_label);
                    for e in els {
                        ex.matched_elements.insert(e.clone());
                    }
                } else {
                    let mut sheet_refs = IndexSet::new();
                    sheet_refs.insert(sheet_label);
                    let mut matched_elements = IndexSet::new();
                    for e in els {
                        matched_elements.insert(e.clone());
                    }
                    matched_rule_groups.insert(
                        sig,
                        RuleGroup {
                            rule: r,
                            rule_ids: vec![r.id.as_str()],
                            sheet_refs,
                            matched_elements,
                        },
                    );
                }
            }
        }

        for g in matched_rule_groups.into_values() {
            let ids_str = if g.rule_ids.len() > 3 {
                format!(
                    "{} (+{})",
                    g.rule_ids[..3].join(", "),
                    g.rule_ids.len() - 3
                )
            } else {
                g.rule_ids.join(", ")
            };
            let sheets_str = g
                .sheet_refs
                .iter()
                .take(2)
                .cloned()
                .collect::<Vec<_>>()
                .join(" | ");
            let els_arr: Vec<&String> = g.matched_elements.iter().collect();
            let els_str = if !els_arr.is_empty() {
                let sample: Vec<&str> = els_arr.iter().take(5).map(|s| s.as_str()).collect();
                let ell = if els_arr.len() > 5 { ", ..." } else { "" };
                format!(" | matchedElements: [{}{ell}]", sample.join(", "))
            } else {
                String::new()
            };
            hits.push(ScreenshotSearchHit {
                category: "cascade-rule".to_string(),
                ref_id: ids_str,
                detail: format!(
                    "[sheet: {sheets_str}] `{}` -> `{}`{els_str}",
                    g.rule.selector_text, g.rule.css_text
                ),
            });
        }
    }

    // 3. 检索 environment.json 组件状态
    let comp_states = pack
        .environment
        .as_ref()
        .and_then(|e| {
            e.framework_component_states
                .as_deref()
                .or(e.vue_component_states.as_deref())
        })
        .unwrap_or(&[]);
    for (idx, c) in comp_states.iter().enumerate() {
        let raw = serde_json::to_string(c).unwrap_or_default();
        if raw.to_lowercase().contains(&needle) {
            let loc = match c.component_file.as_deref().filter(|s| !s.is_empty()) {
                Some(file) => {
                    let ln = c
                        .component_line
                        .as_ref()
                        .filter(|v| !v.is_null())
                        .map(|v| v.to_string().trim_matches('"').to_string())
                        .unwrap_or_default();
                    format!("@ {file}:{ln} ")
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
            hits.push(ScreenshotSearchHit {
                category: "component-state".to_string(),
                ref_id: format!("{}#{idx}", c.component_name.as_deref().unwrap_or("Component")),
                detail: format!("{loc}props={props_str} data={data_str}"),
            });
        }
    }

    // 4. 结构化未命中时，兜底扫描 .json / .md 原始文本
    if hits.is_empty() {
        for file_info in pack.list_files() {
            if file_info.path.ends_with(".json") || file_info.path.ends_with(".md") {
                if let Some(text) = pack.get_text_file(&file_info.path) {
                    if text.to_lowercase().contains(&needle) {
                        let snippet = make_snippets(&text, &needle, radius, 1)
                            .into_iter()
                            .next()
                            .unwrap_or_default();
                        hits.push(ScreenshotSearchHit {
                            category: "file".to_string(),
                            ref_id: file_info.path,
                            detail: snippet,
                        });
                    }
                }
            }
        }
    }

    let total_hits = hits.len();
    hits.truncate(limit);
    (total_hits, hits)
}

/// 执行 `search_pack` 命令。
pub fn run_search_pack_tool(args: SearchPackToolArgs<'_>) -> CliResult<String> {
    let loaded = open_pack_with_options(
        args.pack,
        OpenOptions {
            verify_integrity: false,
        },
    )?;
    let radius = args.context_chars.unwrap_or(180).clamp(40, 2000);

    if let LoadedPack::Screenshot(ss) = &loaded {
        let (total_hits, hits) =
            search_screenshot_pack_structured(ss, args.query, args.limit.unwrap_or(30).max(1), radius);
        if args.format == "json" {
            let payload = json!({
                "query": args.query,
                "totalHits": total_hits,
                "hits": hits,
            });
            let serialized = serde_json::to_string_pretty(&payload).unwrap_or_default();
            return Ok(apply_json_budget(&serialized, args.max_chars));
        }

        let mut lines = vec![format!(
            "# Search Results in Screenshot Pack for \"{}\" (showing {} of {total_hits} total hits)",
            args.query,
            hits.len()
        )];
        if hits.is_empty() {
            lines.push(
                "(No matches found in dom-context.json, cascade.json, or environment.json)"
                    .to_string(),
            );
        } else {
            for h in &hits {
                lines.push(format!(
                    "- **[{}]** `{}` — {}",
                    h.category, h.ref_id, h.detail
                ));
            }
        }
        return Ok(apply_char_budget(&lines.join("\n"), args.max_chars, None));
    }

    let LoadedPack::Session(session) = &loaded else {
        unreachable!()
    };

    let res = search_session_pack(
        session,
        &SearchPackOptions {
            query: args.query.to_string(),
            scopes: args.scopes,
            limit: args.limit,
            context_chars: args.context_chars,
        },
    );

    if args.format == "json" {
        let serialized = serde_json::to_string_pretty(&res).unwrap_or_default();
        return Ok(apply_json_budget(&serialized, args.max_chars));
    }

    let mut lines = vec![format!(
        "# Search Hits for \"{}\" (showing {} of {} total hits)",
        res.query,
        res.hits.len(),
        res.total_hits
    )];
    if res.hits.is_empty() {
        lines.push("(No matches found across requested scopes)".to_string());
    } else {
        for hit in &res.hits {
            lines.push(format!(
                "- **[{}]** `{}` — {}",
                hit.scope, hit.ref_id, hit.snippet
            ));
        }
    }
    Ok(apply_char_budget(&lines.join("\n"), args.max_chars, None))
}
