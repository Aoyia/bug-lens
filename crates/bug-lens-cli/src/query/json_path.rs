//! 轻量 JSONPath 解析与求值引擎：支持属性链、正负下标、通配符 `*` 与字段等值过滤 `[id=xxx]` / `[?(@.id == 'xxx')]`。

use regex::Regex;
use serde_json::Value;
use std::sync::OnceLock;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum JsonPathToken {
    Prop(String),
    Index(isize),
    Wildcard,
    Filter { field: String, value: String },
}

fn segment_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"([^.\[\]]+)|\[([^\]]+)\]").expect("valid segment regex"))
}

fn filter_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"^(?:\?\(\s*)?(?:@\.)?([a-zA-Z0-9_$-]+)\s*={1,3}\s*(.+?)(?:\s*\))?$")
            .expect("valid filter regex")
    })
}

fn strip_outer_quotes(s: &str) -> String {
    let trimmed = s.trim();
    if trimmed.len() >= 2
        && ((trimmed.starts_with('"') && trimmed.ends_with('"'))
            || (trimmed.starts_with('\'') && trimmed.ends_with('\'')))
    {
        trimmed[1..trimmed.len() - 1].to_string()
    } else {
        trimmed
            .trim_start_matches(['\'', '"'])
            .trim_end_matches(['\'', '"'])
            .to_string()
    }
}

pub fn parse_json_path(expr: &str) -> Vec<JsonPathToken> {
    let mut trimmed = expr.trim();
    if let Some(rest) = trimmed.strip_prefix("$.") {
        trimmed = rest;
    } else if let Some(rest) = trimmed.strip_prefix('$') {
        trimmed = rest;
    }
    if trimmed.is_empty() {
        return Vec::new();
    }

    let mut tokens = Vec::new();
    for caps in segment_regex().captures_iter(trimmed) {
        if let Some(prop) = caps.get(1) {
            tokens.push(JsonPathToken::Prop(prop.as_str().to_string()));
        } else if let Some(bracket) = caps.get(2) {
            let inside = bracket.as_str().trim();
            if inside == "*" {
                tokens.push(JsonPathToken::Wildcard);
            } else if let Ok(idx) = inside.parse::<isize>() {
                tokens.push(JsonPathToken::Index(idx));
            } else if let Some(fcaps) = filter_regex().captures(inside) {
                let field = fcaps.get(1).map(|m| m.as_str().trim()).unwrap_or("");
                let raw_val = fcaps.get(2).map(|m| m.as_str().trim()).unwrap_or("");
                tokens.push(JsonPathToken::Filter {
                    field: field.to_string(),
                    value: strip_outer_quotes(raw_val),
                });
            } else {
                tokens.push(JsonPathToken::Prop(strip_outer_quotes(inside)));
            }
        }
    }
    tokens
}

fn value_to_js_string(v: Option<&Value>) -> String {
    match v {
        None => "undefined".to_string(),
        Some(Value::Null) => "null".to_string(),
        Some(Value::Bool(b)) => b.to_string(),
        Some(Value::Number(n)) => n.to_string(),
        Some(Value::String(s)) => s.clone(),
        Some(other) => other.to_string(),
    }
}

pub fn evaluate_json_path(root: &Value, expr: &str) -> Value {
    let tokens = parse_json_path(expr);
    if tokens.is_empty() {
        return root.clone();
    }

    let mut current: Vec<&Value> = vec![root];
    let mut used_multi_selector = false;

    for token in &tokens {
        let mut next: Vec<&Value> = Vec::new();
        for item in &current {
            if item.is_null() {
                continue;
            }
            match token {
                JsonPathToken::Prop(key) => {
                    if let Value::Object(map) = item {
                        if let Some(val) = map.get(key) {
                            next.push(val);
                        }
                    }
                }
                JsonPathToken::Index(idx) => {
                    if let Value::Array(arr) = item {
                        let resolved = if *idx < 0 {
                            (arr.len() as isize) + *idx
                        } else {
                            *idx
                        };
                        if resolved >= 0 && (resolved as usize) < arr.len() {
                            next.push(&arr[resolved as usize]);
                        }
                    }
                }
                JsonPathToken::Wildcard => {
                    used_multi_selector = true;
                    match item {
                        Value::Array(arr) => next.extend(arr.iter()),
                        Value::Object(map) => next.extend(map.values()),
                        _ => {}
                    }
                }
                JsonPathToken::Filter { field, value } => {
                    used_multi_selector = true;
                    if let Value::Array(arr) = item {
                        for elem in arr {
                            if let Value::Object(map) = elem {
                                if value_to_js_string(map.get(field)) == *value {
                                    next.push(elem);
                                }
                            }
                        }
                    }
                }
            }
        }
        current = next;
    }

    if used_multi_selector {
        Value::Array(current.into_iter().cloned().collect())
    } else if current.len() == 1 {
        current[0].clone()
    } else {
        Value::Array(current.into_iter().cloned().collect())
    }
}
