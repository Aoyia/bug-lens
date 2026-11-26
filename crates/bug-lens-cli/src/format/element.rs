//! DOM 元素与用户交互事件的紧凑单行格式化工具。

use crate::format::budget::slice_chars;
use crate::format::time::format_relative_time;
use crate::pack::types::{ElementDescriptor, InteractionEntry};
use serde_json::Value;

pub fn squash_whitespace(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub fn clean_inline_text(value: Option<&str>, max_len: usize) -> String {
    let Some(s) = value else {
        return String::new();
    };
    let squashed = squash_whitespace(s);
    if squashed.chars().count() <= max_len {
        squashed
    } else {
        format!("{}…", slice_chars(&squashed, max_len))
    }
}

fn extract_component_label(fw: Option<&Value>) -> String {
    let Some(Value::Object(obj)) = fw else {
        return String::new();
    };
    if obj.contains_key("targetComponent") || obj.contains_key("rootComponent") {
        let comp = obj
            .get("targetComponent")
            .and_then(|v| v.as_object())
            .or_else(|| {
                obj.get("parentChain")
                    .and_then(|v| v.as_array())
                    .and_then(|arr| arr.first())
                    .and_then(|v| v.as_object())
            })
            .or_else(|| obj.get("rootComponent").and_then(|v| v.as_object()));
        if let Some(name) = comp
            .and_then(|c| c.get("componentName"))
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
        {
            return format!(" [{name}]");
        }
        return String::new();
    }
    if let Some(name) = obj
        .get("componentName")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
    {
        return format!(" [{name}]");
    }
    String::new()
}

pub fn format_element_compact(el: Option<&ElementDescriptor>, max_text_len: usize) -> String {
    let Some(el) = el else {
        return "<unknown>".to_string();
    };
    let tag = el
        .tag_name
        .as_deref()
        .filter(|s| !s.is_empty())
        .unwrap_or("element")
        .to_lowercase();
    let id_part = match el.id.as_deref().filter(|s| !s.is_empty()) {
        Some(id) => format!("#{id}"),
        None => String::new(),
    };
    let classes: Vec<&str> = el
        .class_names
        .as_deref()
        .unwrap_or(&[])
        .iter()
        .map(|s| s.as_str())
        .filter(|s| !s.is_empty())
        .take(3)
        .collect();
    let cls_part = if classes.is_empty() {
        String::new()
    } else {
        format!(".{}", classes.join("."))
    };
    let text_src = el.text.as_deref().or(el.accessible_name.as_deref());
    let text = clean_inline_text(text_src, max_text_len);
    let text_part = if text.is_empty() {
        String::new()
    } else {
        format!(" \"{text}\"")
    };
    let comp_part = extract_component_label(el.framework.as_ref());
    format!("<{tag}{id_part}{cls_part}{text_part}>{comp_part}")
}

pub fn format_interaction_line(
    item: &InteractionEntry,
    index: usize,
    rel_ms: Option<f64>,
) -> String {
    let el = item.element.as_ref().or(item.target.as_ref());
    let time_str = format_relative_time(rel_ms.or(item.elapsed_ms));
    let kind = item.kind.as_deref().unwrap_or("event");
    let el_str = format_element_compact(el, 40);

    let val_candidate = item
        .input
        .as_ref()
        .and_then(|i| i.data.as_deref().or(i.value.as_deref()))
        .or_else(|| el.and_then(|e| e.value.as_deref()))
        .or_else(|| {
            el.and_then(|e| e.attributes.as_ref())
                .and_then(|a| a.get("value"))
                .map(|s| s.as_str())
        });

    let key_candidate = item
        .input
        .as_ref()
        .and_then(|i| i.key.as_deref())
        .or_else(|| {
            item.metadata
                .as_ref()
                .and_then(|m| m.get("shortcut"))
                .and_then(|v| v.as_str())
        })
        .or_else(|| {
            item.metadata
                .as_ref()
                .and_then(|m| m.get("key"))
                .and_then(|v| v.as_str())
        });

    let nav_url = item
        .metadata
        .as_ref()
        .and_then(|m| m.get("toUrl"))
        .and_then(|v| v.as_str());

    let mut extras = Vec::new();
    if let Some(val) = val_candidate.filter(|s| !s.is_empty()) {
        extras.push(format!("val=\"{}\"", clean_inline_text(Some(val), 50)));
    }
    if let Some(key) = key_candidate.filter(|s| !s.is_empty()) {
        extras.push(format!("key={key}"));
    }
    if let Some(url) = nav_url.filter(|s| !s.is_empty()) {
        extras.push(format!("to={}", clean_inline_text(Some(url), 80)));
    }
    if let Some(data_url) = item
        .screenshot
        .as_ref()
        .and_then(|s| s.data_url.as_deref())
        .filter(|s| !s.is_empty())
    {
        extras.push(format!("img={data_url}"));
    }

    let extra_str = if extras.is_empty() {
        String::new()
    } else {
        format!(" {}", extras.join(" "))
    };
    format!("[{index}] {time_str} [{kind}] {el_str}{extra_str}")
}
