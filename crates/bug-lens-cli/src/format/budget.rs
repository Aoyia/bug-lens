//! 输出字符预算截断与 UTF-8 字符安全切片工具（同时保障 `--format json` 截断后仍为合法 JSON）。

use serde_json::json;

/// 默认单次命令最大输出字符数（避免撑爆 AI 上下文窗口）。
pub const DEFAULT_MAX_CHARS: usize = 24000;

/// 统一计算生效的字符预算上限（`<= 200` 回退默认值，与文本分页提示保持完全一致）。
pub fn resolve_char_budget(max_chars: Option<usize>) -> usize {
    match max_chars {
        Some(n) if n > 200 => n,
        _ => DEFAULT_MAX_CHARS,
    }
}

/// 按字符数预算截断文本输出，尽量在换行符边界截断并附加续读提示。
pub fn apply_char_budget(
    text: &str,
    max_chars: Option<usize>,
    continuation_hint: Option<&str>,
) -> String {
    let effective_max = resolve_char_budget(max_chars);

    let char_count = text.chars().count();
    if char_count <= effective_max {
        return text.to_string();
    }

    let hint = match continuation_hint {
        Some(h) if !h.is_empty() => format!(" {h}"),
        _ => " Pass a larger maxChars or narrower filter/jsonPath to inspect further.".to_string(),
    };
    let footer = format!(
        "\n\n… [Truncated to {effective_max} chars (original {char_count} chars).{hint}]"
    );
    let footer_chars = footer.chars().count();
    let slice_len = effective_max.saturating_sub(footer_chars).max(100);

    let slice_end_byte = nth_char_byte_idx(text, slice_len);
    let slice = &text[..slice_end_byte];

    let cut_byte = match slice.rfind('\n') {
        Some(nl_byte) => {
            let nl_chars = slice[..nl_byte].chars().count();
            if (nl_chars as f64) > (slice_len as f64) * 0.75 {
                nl_byte
            } else {
                slice_end_byte
            }
        }
        None => slice_end_byte,
    };

    format!("{}{}", slice[..cut_byte].trim_end(), footer)
}

/// 分页专用字符预算截断：精确对齐实际输出的原文字符数与续读提示 `next_offset`，确保跨页拼接零漏字。
pub fn apply_char_budget_paginated<F>(
    text: &str,
    max_chars: Option<usize>,
    build_hint: F,
) -> String
where
    F: Fn(usize) -> String,
{
    let effective_max = resolve_char_budget(max_chars);
    let char_count = text.chars().count();
    if char_count <= effective_max {
        return text.to_string();
    }

    // 预留最大 footer 字符估算，先定位切分点，再基于实际输出的原文字符数构建精确 hint
    let probe_hint = build_hint(effective_max);
    let probe_footer = format!(
        "\n\n… [Truncated to {effective_max} chars (original {char_count} chars). {probe_hint}]"
    );
    let footer_budget = probe_footer.chars().count() + 16;
    let slice_len = effective_max.saturating_sub(footer_budget).max(100);
    let slice_end_byte = nth_char_byte_idx(text, slice_len);
    let slice = &text[..slice_end_byte];

    let cut_byte = match slice.rfind('\n') {
        Some(nl_byte) => {
            let nl_chars = slice[..nl_byte].chars().count();
            if (nl_chars as f64) > (slice_len as f64) * 0.75 {
                nl_byte + 1
            } else {
                slice_end_byte
            }
        }
        None => slice_end_byte,
    };

    let emitted_slice = &slice[..cut_byte];
    let emitted_chars = emitted_slice.chars().count();
    let hint = build_hint(emitted_chars);
    let footer = format!(
        "\n\n… [Truncated to {effective_max} chars (original {char_count} chars). {hint}]"
    );
    format!("{emitted_slice}{footer}")
}

/// 面向 `--format json` 的字符预算截断：超限时返回合法 JSON 截断包装对象，绝不破坏 JSON 语法。
pub fn apply_json_budget(json_text: &str, max_chars: Option<usize>) -> String {
    let effective_max = resolve_char_budget(max_chars);
    let char_count = json_text.chars().count();
    if char_count <= effective_max {
        return json_text.to_string();
    }

    let preview_limit = effective_max.saturating_sub(240).max(60);
    let preview = slice_chars(json_text, preview_limit);
    let envelope = json!({
        "truncated": true,
        "maxChars": effective_max,
        "originalChars": char_count,
        "preview": preview,
        "hint": "Pass a larger maxChars or narrower filter/jsonPath to inspect further."
    });
    serde_json::to_string_pretty(&envelope).unwrap_or_else(|_| "{\"truncated\":true}".to_string())
}

pub fn slice_chars(s: &str, max_chars: usize) -> &str {
    let end = nth_char_byte_idx(s, max_chars);
    &s[..end]
}

pub fn slice_chars_tail(s: &str, max_chars: usize) -> &str {
    let total = s.chars().count();
    if total <= max_chars {
        return s;
    }
    let start = nth_char_byte_idx(s, total - max_chars);
    &s[start..]
}

pub fn nth_char_byte_idx(s: &str, n: usize) -> usize {
    if n == 0 {
        return 0;
    }
    match s.char_indices().nth(n) {
        Some((idx, _)) => idx,
        None => s.len(),
    }
}
