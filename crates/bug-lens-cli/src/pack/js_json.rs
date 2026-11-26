//! 安全解析 `window.__BUG_LENS_*__ = <JSON>;` 包装文件（纯字符串剥离 + JSON 解析，严禁执行任何 JS 代码）。

use crate::error::{CliError, CliResult};
use regex::Regex;
use serde::de::DeserializeOwned;
use std::sync::OnceLock;

fn prefix_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"^\s*(?:window|globalThis)\.__BUG_LENS_[A-Z0-9_]+__\s*=\s*")
            .expect("valid regex")
    })
}

/// Strip `window.__BUG_LENS_*__ = ` wrapper and trailing `;` safely (zero code execution).
pub fn strip_window_assignment_json<'a>(raw_text: &'a str, file_label: &str) -> CliResult<&'a str> {
    let mat = prefix_regex().find(raw_text).ok_or_else(|| {
        CliError::new(format!(
            "INVALID_JS_JSON_WRAPPER: {file_label} does not start with expected window.__BUG_LENS_*__ assignment"
        ))
    })?;
    let mut json_body = raw_text[mat.end()..].trim();
    if let Some(stripped) = json_body.strip_suffix(';') {
        json_body = stripped.trim_end();
    }
    Ok(json_body)
}

pub fn parse_window_assignment_json<T: DeserializeOwned>(
    raw_text: &str,
    file_label: &str,
) -> CliResult<T> {
    let json_body = strip_window_assignment_json(raw_text, file_label)?;
    serde_json::from_str(json_body).map_err(|err| {
        CliError::new(format!(
            "INVALID_JS_JSON_PAYLOAD: Failed to parse JSON in {file_label}: {err}"
        ))
    })
}
