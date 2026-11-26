//! CLI 参数解析与 12 条子命令分发入口。

use crate::error::{CliError, CliResult};
use crate::pack::open::ends_with_ascii_ignore_case;
use crate::query::console::ConsoleQueryOptions;
use crate::query::network::{NetworkQueryOptions, NetworkStatusFilter};
use crate::query::timeline::TimelineQueryOptions;
use crate::tools::extract_pack::{run_extract_pack_tool, ExtractPackArgs};
use crate::tools::get_framework_state::{run_get_framework_state_tool, GetFrameworkStateArgs};
use crate::tools::get_interactions::{run_get_interactions_tool, GetInteractionsArgs};
use crate::tools::get_request::{run_get_request_tool, GetRequestArgs};
use crate::tools::get_scene::{run_get_scene_tool, GetSceneArgs};
use crate::tools::get_screenshot::{run_get_screenshot_tool, GetScreenshotArgs};
use crate::tools::open_pack::{run_open_pack_tool, OpenPackArgs};
use crate::tools::query_console::{run_query_console_tool, QueryConsoleToolArgs};
use crate::tools::query_network::{run_query_network_tool, QueryNetworkToolArgs};
use crate::tools::read_pack_file::{run_read_pack_file_tool, ReadPackFileArgs};
use crate::tools::search_pack::{run_search_pack_tool, SearchPackToolArgs};
use crate::tools::timeline::{run_timeline_tool, TimelineToolArgs};
use regex::Regex;
use serde_json::Value;
use std::collections::HashMap;
use std::io::{self, Write};
use std::path::Path;
use std::sync::OnceLock;

#[derive(Debug, Clone)]
enum FlagValue {
    Bool(bool),
    Str(String),
}

struct ParsedCliArgs {
    flags: HashMap<String, FlagValue>,
    positionals: Vec<String>,
    unknown_flags: Vec<String>,
}

fn kv_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^([a-zA-Z][a-zA-Z0-9_]*)=(.+)$").expect("valid kv regex"))
}

/// 判断给定 token 是否为显式布尔字面量（供布尔 flag 决定是否消费下一个参数）。
fn is_bool_literal(s: &str) -> bool {
    matches!(
        s.trim().to_ascii_lowercase().as_str(),
        "true" | "false" | "1" | "0" | "yes" | "no"
    )
}

/// 返回某命令支持的（值参数列表，布尔参数列表），用于精准分词与未知参数提示。
fn command_flag_schema(cmd: &str) -> (&'static [&'static str], &'static [&'static str]) {
    match cmd {
        "open_pack" => (&["pack", "p", "format", "maxChars", "max_chars", "json"], &[]),
        "get_scene" => (
            &[
                "pack",
                "p",
                "format",
                "maxChars",
                "max_chars",
                "json",
                "sceneIndex",
                "scene_index",
                "index",
                "sceneId",
                "scene_id",
                "selector",
                "s",
                "cssProperty",
                "css_property",
                "prop",
            ],
            &[
                "includeImage",
                "include_image",
                "includeScreenshot",
                "include_screenshot",
            ],
        ),
        "get_screenshot" => (
            &[
                "pack",
                "p",
                "format",
                "maxChars",
                "max_chars",
                "json",
                "kind",
                "step",
                "sceneId",
                "scene_id",
            ],
            &[],
        ),
        "timeline" => (
            &[
                "pack",
                "p",
                "format",
                "maxChars",
                "max_chars",
                "json",
                "aroundSceneId",
                "around_scene_id",
                "around",
                "fromMs",
                "from_ms",
                "toMs",
                "to_ms",
                "windowMs",
                "window_ms",
                "kinds",
                "kind",
                "limit",
            ],
            &[
                "includeAllConsole",
                "include_all_console",
                "includeAllNetwork",
                "include_all_network",
            ],
        ),
        "query_console" => (
            &[
                "pack", "p", "format", "maxChars", "max_chars", "json", "levels", "level",
                "search", "query", "q", "regex", "fromMs", "from_ms", "toMs", "to_ms", "offset",
                "limit",
            ],
            &[],
        ),
        "query_network" => (
            &[
                "pack",
                "p",
                "format",
                "maxChars",
                "max_chars",
                "json",
                "status",
                "urlContains",
                "url_contains",
                "url",
                "method",
                "type",
                "offset",
                "limit",
            ],
            &[],
        ),
        "get_request" => (
            &[
                "pack",
                "p",
                "format",
                "maxChars",
                "max_chars",
                "json",
                "id",
                "requestId",
                "request_id",
                "include",
                "jsonPath",
                "json_path",
                "bodyMaxChars",
                "body_max_chars",
            ],
            &[],
        ),
        "get_interactions" => (
            &[
                "pack",
                "p",
                "format",
                "maxChars",
                "max_chars",
                "json",
                "fromIndex",
                "from_index",
                "limit",
                "kinds",
                "kind",
            ],
            &["includeScreenshot", "include_screenshot"],
        ),
        "get_framework_state" => (
            &[
                "pack",
                "p",
                "format",
                "maxChars",
                "max_chars",
                "json",
                "index",
                "nearMs",
                "near_ms",
                "component",
                "path",
                "jsonPath",
                "json_path",
            ],
            &[],
        ),
        "search_pack" => (
            &[
                "pack",
                "p",
                "format",
                "maxChars",
                "max_chars",
                "json",
                "query",
                "q",
                "scopes",
                "scope",
                "limit",
                "contextChars",
                "context_chars",
            ],
            &[],
        ),
        "read_pack_file" => (
            &[
                "pack",
                "p",
                "format",
                "maxChars",
                "max_chars",
                "json",
                "path",
                "file",
                "jsonPath",
                "json_path",
                "offset",
            ],
            &[],
        ),
        "extract_pack" => (
            &["pack", "p", "format", "maxChars", "max_chars", "json", "dest", "d"],
            &[],
        ),
        _ => (&[], &[]),
    }
}

/// 解析 CLI 参数：
/// - 已知布尔 flag 仅在下一参数为显式布尔字面量时才消费，防止吞噬紧随其后的位置参数；
/// - 未知 `--flag`（非 `=` 形式）绝不吞噬位置参数，并登记告警；
/// - `key=value` 简写仅对当前命令已声明的参数名生效，避免误杀 `search_pack "delay=0sec"` 等含等号查询词。
fn parse_cli_args(cmd: &str, raw_args: &[String]) -> CliResult<ParsedCliArgs> {
    let (value_flags, bool_flags) = command_flag_schema(cmd);
    let is_value_flag = |k: &str| value_flags.contains(&k);
    let is_bool_flag = |k: &str| bool_flags.contains(&k);
    let is_known_flag = |k: &str| is_value_flag(k) || is_bool_flag(k);

    let mut flags: HashMap<String, FlagValue> = HashMap::new();
    let mut positionals: Vec<String> = Vec::new();
    let mut unknown_flags: Vec<String> = Vec::new();

    let mut i = 0;
    while i < raw_args.len() {
        let token = &raw_args[i];
        if token == "--" {
            positionals.extend(raw_args[i + 1..].iter().cloned());
            break;
        }
        if let Some(rest) = token.strip_prefix("--") {
            if let Some(eq_idx) = rest.find('=') {
                if eq_idx > 0 {
                    let key = rest[..eq_idx].to_string();
                    let val = rest[eq_idx + 1..].to_string();
                    if !is_known_flag(&key) {
                        unknown_flags.push(key.clone());
                    }
                    flags.insert(key, FlagValue::Str(val));
                    i += 1;
                    continue;
                }
            }
            let key = rest.to_string();
            if is_value_flag(&key) {
                if let Some(next) = raw_args.get(i + 1) {
                    let next_is_known_flag = next == "--"
                        || next
                            .strip_prefix("--")
                            .map(|r| r.split('=').next().unwrap_or(r))
                            .is_some_and(&is_known_flag);
                    if !next_is_known_flag {
                        flags.insert(key, FlagValue::Str(next.clone()));
                        i += 2;
                        continue;
                    }
                }
                flags.insert(key, FlagValue::Bool(true));
                i += 1;
                continue;
            }
            if is_bool_flag(&key) {
                if let Some(next) = raw_args.get(i + 1) {
                    if !next.starts_with("--") && is_bool_literal(next) {
                        flags.insert(key, FlagValue::Str(next.clone()));
                        i += 2;
                        continue;
                    }
                }
                flags.insert(key, FlagValue::Bool(true));
                i += 1;
                continue;
            }
            // 未知 flag：记录告警且不吞噬后续位置参数
            unknown_flags.push(key.clone());
            flags.insert(key, FlagValue::Bool(true));
            i += 1;
            continue;
        }

        // 支持 `key=value` 简写（仅当 key 为当前命令已知参数且 token 不是已存在的本地文件）
        if let Some(caps) = kv_regex().captures(token) {
            let k = caps.get(1).map(|m| m.as_str()).unwrap_or("");
            if is_known_flag(k) && !Path::new(token).exists() {
                let v = caps.get(2).map(|m| m.as_str()).unwrap_or("").to_string();
                flags.insert(k.to_string(), FlagValue::Str(v));
                i += 1;
                continue;
            }
        }

        positionals.push(token.clone());
        i += 1;
    }

    // 支持内联 JSON 参数对象：`--json '{...}'`（严格校验）或首个位置参数 `{...}`（仅在含已知 flag 键时消费）
    let mut parsed_json_map: Option<serde_json::Map<String, Value>> = None;
    if let Some(FlagValue::Str(raw)) = flags.get("json") {
        let val = serde_json::from_str::<Value>(raw).map_err(|err| {
            CliError::new(format!("INVALID_JSON_ARGS: Invalid JSON passed to --json: {err}"))
        })?;
        let Value::Object(map) = val else {
            return Err(CliError::new(
                "INVALID_JSON_ARGS: --json argument must be a JSON object",
            ));
        };
        parsed_json_map = Some(map);
    } else if let Some(first_pos) = positionals.first() {
        if first_pos.trim().starts_with('{') {
            if let Ok(Value::Object(map)) = serde_json::from_str::<Value>(first_pos) {
                if !map.is_empty() && map.keys().any(|k| is_known_flag(k)) {
                    positionals.remove(0);
                    parsed_json_map = Some(map);
                }
            }
        }
    }

    if let Some(map) = parsed_json_map {
        for (k, v) in map {
            if !is_known_flag(&k) {
                unknown_flags.push(k.clone());
            }
            match v {
                Value::Bool(b) => {
                    flags.insert(k, FlagValue::Bool(b));
                }
                Value::String(s) => {
                    flags.insert(k, FlagValue::Str(s));
                }
                Value::Number(n) => {
                    flags.insert(k, FlagValue::Str(n.to_string()));
                }
                Value::Array(arr) => {
                    let joined = arr
                        .into_iter()
                        .map(|el| match el {
                            Value::String(s) => s,
                            other => other.to_string(),
                        })
                        .collect::<Vec<_>>()
                        .join(",");
                    flags.insert(k, FlagValue::Str(joined));
                }
                _ => {}
            }
        }
    }

    Ok(ParsedCliArgs {
        flags,
        positionals,
        unknown_flags,
    })
}

fn str_flag<'a>(flags: &'a HashMap<String, FlagValue>, keys: &[&str]) -> Option<&'a str> {
    for &k in keys {
        if let Some(FlagValue::Str(s)) = flags.get(k) {
            let trimmed = s.trim();
            if !trimmed.is_empty() {
                return Some(trimmed);
            }
        }
    }
    None
}

fn f64_flag(flags: &HashMap<String, FlagValue>, keys: &[&str]) -> Option<f64> {
    let s = str_flag(flags, keys)?;
    let n = s.parse::<f64>().ok()?;
    n.is_finite().then_some(n)
}

fn usize_flag(flags: &HashMap<String, FlagValue>, keys: &[&str]) -> Option<usize> {
    let n = f64_flag(flags, keys)?;
    if n >= 0.0 && n <= (isize::MAX as f64) {
        Some(n.floor() as usize)
    } else {
        None
    }
}

fn bool_flag(flags: &HashMap<String, FlagValue>, keys: &[&str]) -> Option<bool> {
    for &k in keys {
        match flags.get(k) {
            Some(FlagValue::Bool(b)) => return Some(*b),
            Some(FlagValue::Str(s)) => match s.trim().to_lowercase().as_str() {
                "true" | "1" | "yes" => return Some(true),
                "false" | "0" | "no" => return Some(false),
                _ => {}
            },
            None => {}
        }
    }
    None
}

fn csv_flag(flags: &HashMap<String, FlagValue>, keys: &[&str]) -> Option<Vec<String>> {
    let s = str_flag(flags, keys)?;
    let items: Vec<String> = s
        .split(',')
        .map(|x| x.trim().to_string())
        .filter(|x| !x.is_empty())
        .collect();
    if items.is_empty() {
        None
    } else {
        Some(items)
    }
}

fn is_likely_pack_path(candidate: Option<&str>) -> bool {
    let Some(c) = candidate else {
        return false;
    };
    if ends_with_ascii_ignore_case(c, ".zip") {
        return true;
    }
    Path::new(c).exists()
}

fn resolve_pack_and_positionals<'a>(
    flags: &'a HashMap<String, FlagValue>,
    positionals: &'a [String],
    first_positional_is_always_pack: bool,
) -> (Option<&'a str>, &'a [String]) {
    if let Some(explicit) = str_flag(flags, &["pack", "p"]) {
        return (Some(explicit), positionals);
    }
    if let Some(first) = positionals.first() {
        if first_positional_is_always_pack || is_likely_pack_path(Some(first.as_str())) {
            return (Some(first.as_str()), &positionals[1..]);
        }
    }
    (None, positionals)
}

/// 生成帮助文本。
pub fn format_help() -> &'static str {
    concat!(
        "Bug Lens Evidence Triage CLI\n",
        "Usage: bug-lens-cli <command> [options]\n\n",
        "Commands:\n",
        "  open_pack <zipOrDir>                        Extract pack to workspace (idempotent), generate derived JSON & INDEX.md, cache session path, and print overview\n",
        "  get_scene [--selector S] [--cssProperty P]  Inspect issue scene (session) or DOM anchor & CSS cascade rules (screenshot)\n",
        "  get_screenshot [--kind K] [--step N]        Locate screenshot image in workspace and print path\n",
        "  timeline [--aroundSceneId ID] [--windowMs]  Unified chronological timeline of interactions, console errors, and network requests\n",
        "  query_console [--levels error,warning]      Filter console logs and source-mapped stack traces\n",
        "  query_network [--status failed|4xx|5xx]     Filter network requests (prioritizes failures)\n",
        "  get_request <id> [--jsonPath EXPR]          Inspect request headers, initiator stack, and response body (with JSONPath)\n",
        "  get_interactions [--fromIndex N] [--limit]  List recorded user interactions\n",
        "  get_framework_state [--component NAME]      Inspect Vue/React component props, state, and webStorage snapshots\n",
        "  search_pack <query>                         Cross-search console, network URLs/bodies, interactions, cascade rules, and state\n",
        "  read_pack_file <path> [--jsonPath EXPR]     Read raw JSON/JS/text file or workspace artifact (INDEX.md, data/*.json)\n",
        "  extract_pack [--dest DIR]                   Describe active workspace or copy extracted pack to custom directory"
    )
}

/// 执行 CLI 主路由，返回标准输出文本（不含末尾换行）。
pub fn run_triage_cli(argv: &[String]) -> CliResult<String> {
    let raw_cmd = argv.first().map(|s| s.trim()).unwrap_or("");
    if raw_cmd.is_empty()
        || raw_cmd == "-h"
        || raw_cmd == "--help"
        || raw_cmd == "help"
        || argv
            .iter()
            .skip(1)
            .take_while(|arg| arg.as_str() != "--")
            .any(|arg| arg == "-h" || arg == "--help")
    {
        return Ok(format_help().to_string());
    }

    if raw_cmd == "-V" || raw_cmd == "--version" {
        return Ok(format!("bug-lens-cli {}", env!("CARGO_PKG_VERSION")));
    }

    let cmd = raw_cmd.replace('-', "_").to_lowercase();
    let parsed = parse_cli_args(&cmd, &argv[1..])?;

    // 仅对合法命令输出未知参数的非阻断 stderr 告警，避免拼写错误或未支持 flag 被静默忽略
    if !parsed.unknown_flags.is_empty() && !command_flag_schema(&cmd).0.is_empty() {
        let mut stderr = io::stderr().lock();
        for flag in &parsed.unknown_flags {
            let _ = writeln!(
                stderr,
                "Warning: unrecognized option \"--{flag}\" for command \"{cmd}\" (ignored)"
            );
        }
    }

    let flags = &parsed.flags;
    let positionals = &parsed.positionals;
    let format = if str_flag(flags, &["format"]) == Some("json") {
        "json"
    } else {
        "text"
    };
    let max_chars = usize_flag(flags, &["maxChars", "max_chars"]);

    match cmd.as_str() {
        "open_pack" => {
            let (pack, _) = resolve_pack_and_positionals(flags, positionals, true);
            let Some(pack) = pack else {
                return Err(CliError::new(
                    "Usage: bug-lens-cli open_pack <zipPath> [--format text|json]",
                ));
            };
            run_open_pack_tool(OpenPackArgs {
                pack,
                format,
                max_chars,
            })
        }

        "get_scene" => {
            let (pack, rest) = resolve_pack_and_positionals(flags, positionals, false);
            let scene_index = usize_flag(flags, &["sceneIndex", "scene_index", "index"]);
            let explicit_scene_id = str_flag(flags, &["sceneId", "scene_id"]);
            let rest0 = rest.first().map(|s| s.as_str());
            let selector = str_flag(flags, &["selector", "s"]).or(rest0);
            let css_property = str_flag(flags, &["cssProperty", "css_property", "prop"]);
            let include_image = bool_flag(
                flags,
                &[
                    "includeImage",
                    "include_image",
                    "includeScreenshot",
                    "include_screenshot",
                ],
            );
            let derived_scene_id = explicit_scene_id.or_else(|| {
                if scene_index.is_none() {
                    rest0.filter(|s| !s.is_empty() && s.chars().all(|c| c.is_ascii_digit()))
                } else {
                    None
                }
            });
            let blocks = run_get_scene_tool(GetSceneArgs {
                pack,
                scene_id: derived_scene_id,
                scene_index,
                selector,
                css_property,
                include_image,
                format,
                max_chars,
            })?;
            Ok(blocks.join("\n\n"))
        }

        "get_screenshot" => {
            let (pack, rest) = resolve_pack_and_positionals(flags, positionals, false);
            let kind = str_flag(flags, &["kind"]).or_else(|| rest.first().map(|s| s.as_str()));
            let step = usize_flag(flags, &["step"]);
            let scene_id = str_flag(flags, &["sceneId", "scene_id"]);
            let blocks = run_get_screenshot_tool(GetScreenshotArgs {
                pack,
                kind,
                step,
                scene_id,
                format,
                max_chars,
            })?;
            Ok(blocks.join("\n\n"))
        }

        "timeline" => {
            let (pack, rest) = resolve_pack_and_positionals(flags, positionals, false);
            let raw_around = str_flag(flags, &["aroundSceneId", "around_scene_id", "around"])
                .or_else(|| rest.first().map(|s| s.as_str()));
            // 支持 `scene:1`（1-based）到 `0`（0-based）的兼容转换
            let around_scene_id = raw_around.map(|raw| {
                if let Some(num_str) = raw.strip_prefix("scene:") {
                    if let Ok(n) = num_str.parse::<isize>() {
                        return n.saturating_sub(1).max(0).to_string();
                    }
                }
                raw.to_string()
            });
            run_timeline_tool(TimelineToolArgs {
                pack,
                options: TimelineQueryOptions {
                    around_scene_id,
                    from_ms: f64_flag(flags, &["fromMs", "from_ms"]),
                    to_ms: f64_flag(flags, &["toMs", "to_ms"]),
                    window_ms: f64_flag(flags, &["windowMs", "window_ms"]),
                    kinds: csv_flag(flags, &["kinds", "kind"]),
                    include_all_console: bool_flag(
                        flags,
                        &["includeAllConsole", "include_all_console"],
                    )
                    .unwrap_or(false),
                    include_all_network: bool_flag(
                        flags,
                        &["includeAllNetwork", "include_all_network"],
                    )
                    .unwrap_or(false),
                    limit: usize_flag(flags, &["limit"]),
                },
                format,
                max_chars,
            })
        }

        "query_console" => {
            let (pack, rest) = resolve_pack_and_positionals(flags, positionals, false);
            let search = str_flag(flags, &["search", "query", "q"])
                .or_else(|| rest.first().map(|s| s.as_str()))
                .map(|s| s.to_string());
            run_query_console_tool(QueryConsoleToolArgs {
                pack,
                options: ConsoleQueryOptions {
                    levels: csv_flag(flags, &["levels", "level"]),
                    search,
                    regex: str_flag(flags, &["regex"]).map(|s| s.to_string()),
                    from_ms: f64_flag(flags, &["fromMs", "from_ms"]),
                    to_ms: f64_flag(flags, &["toMs", "to_ms"]),
                    offset: usize_flag(flags, &["offset"]),
                    limit: usize_flag(flags, &["limit"]),
                },
                format,
                max_chars,
            })
        }

        "query_network" => {
            let (pack, rest) = resolve_pack_and_positionals(flags, positionals, false);
            let status = str_flag(flags, &["status"]).map(NetworkStatusFilter::parse);
            let url_contains = str_flag(flags, &["urlContains", "url_contains", "url"])
                .or_else(|| rest.first().map(|s| s.as_str()))
                .map(|s| s.to_string());
            run_query_network_tool(QueryNetworkToolArgs {
                pack,
                options: NetworkQueryOptions {
                    status,
                    url_contains,
                    method: str_flag(flags, &["method"]).map(|s| s.to_string()),
                    r#type: str_flag(flags, &["type"]).map(|s| s.to_string()),
                    offset: usize_flag(flags, &["offset"]),
                    limit: usize_flag(flags, &["limit"]),
                },
                format,
                max_chars,
            })
        }

        "get_request" => {
            let (pack, rest) = resolve_pack_and_positionals(flags, positionals, false);
            let id = str_flag(flags, &["id", "requestId", "request_id"])
                .or_else(|| rest.first().map(|s| s.as_str()));
            let Some(id) = id else {
                return Err(CliError::new(
                    "Usage: bug-lens-cli get_request <id> [--jsonPath EXPR]",
                ));
            };
            let json_path = str_flag(flags, &["jsonPath", "json_path"])
                .or_else(|| rest.get(1).map(|s| s.as_str()))
                .map(|s| s.to_string());
            run_get_request_tool(GetRequestArgs {
                pack,
                id,
                include: csv_flag(flags, &["include"]),
                json_path,
                body_max_chars: usize_flag(flags, &["bodyMaxChars", "body_max_chars"]),
                format,
                max_chars,
            })
        }

        "get_interactions" => {
            let (pack, _) = resolve_pack_and_positionals(flags, positionals, false);
            let blocks = run_get_interactions_tool(GetInteractionsArgs {
                pack,
                from_index: usize_flag(flags, &["fromIndex", "from_index"]),
                limit: usize_flag(flags, &["limit"]),
                kinds: csv_flag(flags, &["kinds", "kind"]),
                include_screenshot: bool_flag(
                    flags,
                    &["includeScreenshot", "include_screenshot"],
                )
                .unwrap_or(false),
                format,
                max_chars,
            })?;
            Ok(blocks.join("\n\n"))
        }

        "get_framework_state" => {
            let (pack, rest) = resolve_pack_and_positionals(flags, positionals, false);
            let component = str_flag(flags, &["component"])
                .or_else(|| rest.first().map(|s| s.as_str()));
            run_get_framework_state_tool(GetFrameworkStateArgs {
                pack,
                index: usize_flag(flags, &["index"]),
                near_ms: f64_flag(flags, &["nearMs", "near_ms"]),
                component,
                path: str_flag(flags, &["path", "jsonPath", "json_path"]),
                format,
                max_chars,
            })
        }

        "search_pack" => {
            let (pack, rest) = resolve_pack_and_positionals(flags, positionals, false);
            let query = str_flag(flags, &["query", "q"])
                .or_else(|| rest.first().map(|s| s.as_str()));
            let Some(query) = query else {
                return Err(CliError::new("Usage: bug-lens-cli search_pack <query>"));
            };
            run_search_pack_tool(SearchPackToolArgs {
                pack,
                query,
                scopes: csv_flag(flags, &["scopes", "scope"]),
                limit: usize_flag(flags, &["limit"]),
                context_chars: usize_flag(flags, &["contextChars", "context_chars"]),
                format,
                max_chars,
            })
        }

        "read_pack_file" => {
            let (pack, rest) = resolve_pack_and_positionals(flags, positionals, false);
            let path = str_flag(flags, &["path", "file"])
                .or_else(|| rest.first().map(|s| s.as_str()));
            let Some(path) = path else {
                return Err(CliError::new(
                    "Usage: bug-lens-cli read_pack_file <path> [--jsonPath EXPR]",
                ));
            };
            let json_path = str_flag(flags, &["jsonPath", "json_path"])
                .or_else(|| rest.get(1).map(|s| s.as_str()));
            run_read_pack_file_tool(ReadPackFileArgs {
                pack,
                path,
                json_path,
                offset: usize_flag(flags, &["offset"]),
                max_chars,
            })
        }

        "extract_pack" => {
            let (pack, rest) = resolve_pack_and_positionals(flags, positionals, false);
            let dest = str_flag(flags, &["dest", "d"])
                .or_else(|| rest.first().map(|s| s.as_str()));
            run_extract_pack_tool(ExtractPackArgs { pack, dest, format })
        }

        _ => Err(CliError::new(format!(
            "UNKNOWN_COMMAND: Unknown command \"{raw_cmd}\". Run with --help to see available commands."
        ))),
    }
}
