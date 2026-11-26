//! 相对时间、耗时与 ISO-8601 UTC 时间戳格式化工具。

use std::time::{SystemTime, UNIX_EPOCH};

/// 将相对毫秒数格式化为 `+12.3s` / `-0.5s` 形式。
pub fn format_relative_time(ms: Option<f64>) -> String {
    match ms {
        Some(v) if v.is_finite() => {
            let sign = if v >= 0.0 { "+" } else { "-" };
            let abs_sec = v.abs() / 1000.0;
            format!("{sign}{abs_sec:.1}s")
        }
        _ => "—".to_string(),
    }
}

pub fn format_duration(ms: Option<f64>) -> String {
    match ms {
        Some(v) if v.is_finite() => {
            if v < 1000.0 {
                // JS Math.round rounds half towards +infinity
                let rounded = (v + 0.5).floor() as i64;
                format!("{rounded}ms")
            } else {
                format!("{:.2}s", v / 1000.0)
            }
        }
        _ => "—".to_string(),
    }
}

pub fn now_epoch_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Format epoch milliseconds as ISO-8601 UTC string (`YYYY-MM-DDTHH:MM:SS.sssZ`).
pub fn format_iso8601_utc(epoch_ms: u64) -> String {
    let total_secs = (epoch_ms / 1000) as i64;
    let millis = epoch_ms % 1000;
    let days = total_secs.div_euclid(86_400);
    let secs_of_day = total_secs.rem_euclid(86_400);
    let hour = secs_of_day / 3600;
    let minute = (secs_of_day % 3600) / 60;
    let second = secs_of_day % 60;

    // Howard Hinnant civil_from_days algorithm
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = (yoe as i64) + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if m <= 2 { y + 1 } else { y };

    format!("{year:04}-{m:02}-{d:02}T{hour:02}:{minute:02}:{second:02}.{millis:03}Z")
}
