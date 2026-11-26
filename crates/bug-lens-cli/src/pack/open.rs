//! 证据包加载、流式防炸弹 ZIP 解压、工作区幂等缓存与 LRU 淘汰管理。

use crate::error::{CliError, CliResult};
use crate::format::time::{format_iso8601_utc, now_epoch_ms};
use crate::pack::index_writer::build_index_markdown;
use crate::pack::js_json::parse_window_assignment_json;
use crate::pack::manifest::{
    parse_manifest_result, verify_pack_integrity_result, ManifestParseResult,
};
use crate::pack::screenshot_pack::LoadedScreenshotPack;
use crate::pack::session_pack::LoadedSessionPack;
use crate::pack::storage::{hex_lower, PackStorage};
use crate::pack::types::{
    CascadeIndex, IntegrityReport, ScreenshotDomContext, ScreenshotEnvironment, SessionDataPayload,
    SkippedMediaInfo,
};
use crate::pack::LoadedPack;
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha1::{Digest as Sha1Digest, Sha1};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs::{self, File};
use std::io::{BufReader, BufWriter, Cursor, Read, Seek, Write};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::UNIX_EPOCH;
use zip::ZipArchive;

pub const MAX_SINGLE_FILE_BYTES: u64 = 64 * 1024 * 1024; // 64 MB
pub const MAX_TOTAL_UNCOMPRESSED_BYTES: u64 = 512 * 1024 * 1024; // 512 MB
pub const MAX_MEDIA_FILE_BYTES: u64 = 1024 * 1024 * 1024; // 1 GB
pub const MAX_TOTAL_MEDIA_BYTES: u64 = 2 * 1024 * 1024 * 1024; // 2 GB
pub const MAX_ZIP_ENTRIES: usize = 20_000;
pub const MAX_WORKSPACE_PACKS: usize = 10;
const STAMP_TOUCH_THROTTLE_MS: u64 = 60_000;

pub const EXTRACT_STAMP_FILE: &str = ".bug-lens-extract.json";
pub const INDEX_FILE: &str = "INDEX.md";
pub const DERIVED_JSON_FILES: [(&str, &str); 2] = [
    ("data/session-data.js", "data/session-data.json"),
    ("data/network-details.js", "data/network-details.json"),
];
const EXTRACT_STAMP_VERSION: u32 = 1;
const STREAM_BUF_SIZE: usize = 64 * 1024;

fn media_path_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"(?i)(?:^|/)media/|\.(?:mp4|webm|mkv|mov)$").expect("valid media regex")
    })
}

fn is_workspace_artifact(rel_path: &str) -> bool {
    rel_path == EXTRACT_STAMP_FILE
        || rel_path == INDEX_FILE
        || DERIVED_JSON_FILES.iter().any(|(_, target)| *target == rel_path)
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RenamedPath {
    pub from: String,
    pub to: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExtractStamp {
    version: u32,
    source: String,
    source_mtime_ms: u64,
    source_size: u64,
    renamed_paths: Vec<RenamedPath>,
    extracted_at: String,
    last_accessed_at: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractPackResult {
    pub dest_dir: String,
    pub written_files: Vec<String>,
    pub renamed_paths: Vec<RenamedPath>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reproduce_spec_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub report_html_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub screenshot_path: Option<String>,
}

#[derive(Debug, Clone, Copy)]
pub struct OpenOptions {
    pub verify_integrity: bool,
}

impl Default for OpenOptions {
    fn default() -> Self {
        Self {
            verify_integrity: true,
        }
    }
}

pub fn clean_canonical_path(path: &Path) -> PathBuf {
    let resolved = fs::canonicalize(path).unwrap_or_else(|_| resolve_path(path));
    strip_windows_verbatim(resolved)
}

#[cfg(windows)]
fn strip_windows_verbatim(path: PathBuf) -> PathBuf {
    let s = path.to_string_lossy();
    if let Some(stripped) = s.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{stripped}"));
    }
    if let Some(stripped) = s.strip_prefix(r"\\?\") {
        return PathBuf::from(stripped);
    }
    path
}

#[cfg(not(windows))]
fn strip_windows_verbatim(path: PathBuf) -> PathBuf {
    path
}

pub fn resolve_path(path: &Path) -> PathBuf {
    if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join(path)
    }
}

pub fn get_triage_workspace_dir() -> PathBuf {
    let custom = std::env::var("BUG_LENS_WORKSPACE_DIR")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .or_else(|| {
            std::env::var("BUG_LENS_CLI_WORKSPACE")
                .ok()
                .filter(|s| !s.trim().is_empty())
        });
    match custom {
        Some(dir) => resolve_path(Path::new(&dir)),
        None => std::env::temp_dir().join("bug-lens-workspace"),
    }
}

/// 按字节安全执行 ASCII 大小写无关后缀判定，避免多字节 UTF-8 切片 panic。
pub fn ends_with_ascii_ignore_case(s: &str, suffix: &str) -> bool {
    let sb = s.as_bytes();
    let tb = suffix.as_bytes();
    sb.len() >= tb.len() && sb[sb.len() - tb.len()..].eq_ignore_ascii_case(tb)
}

/// 安全剥离 ASCII 后缀（仅当末尾字节匹配 ASCII 后缀时切片，必定位于 UTF-8 字符边界）。
pub fn strip_suffix_ascii_ignore_case<'a>(s: &'a str, suffix: &str) -> &'a str {
    if ends_with_ascii_ignore_case(s, suffix) {
        &s[..s.len() - suffix.len()]
    } else {
        s
    }
}

/// 将任意路径（即便目标文件尚未创建）解析为尽可能规范化的真实路径，防止符号链接别名导致误判。
fn canonicalize_best_effort(path: &Path) -> PathBuf {
    if path.exists() {
        return clean_canonical_path(path);
    }
    if let (Some(parent), Some(name)) = (path.parent(), path.file_name()) {
        if parent.exists() {
            return clean_canonical_path(parent).join(name);
        }
    }
    resolve_path(path)
}

/// 判断两个路径是否指向同一磁盘文件（同时校验规范路径与 Unix inode，防止符号链接/硬链接自拷贝清零）。
fn is_same_file_or_path(a: &Path, b: &Path) -> bool {
    if canonicalize_best_effort(a) == canonicalize_best_effort(b) {
        return true;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if let (Ok(ma), Ok(mb)) = (fs::metadata(a), fs::metadata(b)) {
            if ma.dev() == mb.dev() && ma.ino() == mb.ino() {
                return true;
            }
        }
    }
    false
}

pub fn get_workspace_dir_for_zip(zip_real_path: &str) -> PathBuf {
    let file_name = Path::new(zip_real_path)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("pack");
    let base = strip_suffix_ascii_ignore_case(file_name, ".zip");

    let mut replaced = String::with_capacity(base.len());
    let mut prev_underscore = false;
    for ch in base.chars() {
        if ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-') {
            replaced.push(ch);
            prev_underscore = false;
        } else if !prev_underscore {
            replaced.push('_');
            prev_underscore = true;
        }
    }
    let trimmed = replaced
        .trim_start_matches(['_', '.'])
        .trim_end_matches('_');
    let safe: String = trimmed.chars().take(80).collect();
    let safe = if safe.is_empty() {
        "pack".to_string()
    } else {
        safe
    };

    let mut hasher = Sha1::new();
    hasher.update(zip_real_path.as_bytes());
    let hash = &hex_lower(&hasher.finalize())[..6];
    get_triage_workspace_dir().join(format!("{safe}-{hash}"))
}

pub fn get_pack_workspace_dir(pack: &LoadedPack) -> Option<String> {
    let p = Path::new(pack.pack_path());
    if p.is_dir() {
        Some(pack.pack_path().to_string())
    } else {
        None
    }
}

fn get_current_pack_state_file() -> PathBuf {
    get_triage_workspace_dir().join(".current-pack")
}

fn unique_temp_suffix() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let seq = COUNTER.fetch_add(1, Ordering::Relaxed);
    format!(
        "tmp-{}-{}-{}",
        std::process::id(),
        now_epoch_ms(),
        seq
    )
}

/// 同目录临时文件写入 + rename 原子替换，防止并发进程读到半截或被 truncate 的状态文件。
fn atomic_write_file(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    fs::create_dir_all(parent)?;
    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("file");
    let tmp_path = parent.join(format!(".{file_name}.{}", unique_temp_suffix()));
    {
        let mut f = File::create(&tmp_path)?;
        f.write_all(bytes)?;
        f.flush()?;
    }
    match fs::rename(&tmp_path, path) {
        Ok(()) => Ok(()),
        Err(err) => {
            // Windows 上部分场景不支持 rename 覆盖已有目标，先删后移；并发冲突则清理临时文件
            #[cfg(windows)]
            {
                let _ = fs::remove_file(path);
                if fs::rename(&tmp_path, path).is_ok() {
                    return Ok(());
                }
            }
            let _ = fs::remove_file(&tmp_path);
            Err(err)
        }
    }
}

fn save_last_pack_path_to_disk(pack_path: &str) {
    let state_file = get_current_pack_state_file();
    let _ = atomic_write_file(&state_file, pack_path.as_bytes());
}

fn load_last_pack_path_from_disk() -> Option<String> {
    let state_file = get_current_pack_state_file();
    let raw = fs::read_to_string(state_file).ok()?;
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

pub fn clear_pack_cache() {
    let _ = fs::remove_file(get_current_pack_state_file());
}

/// Normalize archive entry path using POSIX semantics and reject zip-slip traversal or absolute paths.
pub fn normalize_archive_entry_path(raw_name: &str) -> CliResult<String> {
    let forward = raw_name.replace('\\', "/");
    let stripped = forward.strip_prefix("./").unwrap_or(&forward);

    if stripped.starts_with('/') || has_windows_drive_prefix(stripped) {
        return Err(CliError::new(format!(
            "UNSAFE_ZIP_ENTRY_PATH: Refusing archive entry with traversal or absolute path: {raw_name}"
        )));
    }

    let trailing_slash = stripped.ends_with('/');
    let mut parts: Vec<&str> = Vec::new();
    for seg in stripped.split('/') {
        if seg.is_empty() || seg == "." {
            continue;
        }
        if seg == ".." {
            if parts.is_empty() {
                return Err(CliError::new(format!(
                    "UNSAFE_ZIP_ENTRY_PATH: Refusing archive entry with traversal or absolute path: {raw_name}"
                )));
            }
            parts.pop();
        } else {
            parts.push(seg);
        }
    }

    let mut normalized = parts.join("/");
    if trailing_slash && !normalized.is_empty() {
        normalized.push('/');
    }
    if normalized.starts_with('/')
        || normalized == ".."
        || normalized.starts_with("../")
        || normalized.contains("/../")
        || has_windows_drive_prefix(&normalized)
    {
        return Err(CliError::new(format!(
            "UNSAFE_ZIP_ENTRY_PATH: Refusing archive entry with traversal or absolute path: {raw_name}"
        )));
    }

    Ok(normalized)
}

fn has_windows_drive_prefix(s: &str) -> bool {
    let bytes = s.as_bytes();
    bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':'
}

fn is_windows_reserved_device_name(segment: &str) -> bool {
    let stem = segment.split('.').next().unwrap_or(segment);
    matches!(
        stem.to_ascii_uppercase().as_str(),
        "CON"
            | "PRN"
            | "AUX"
            | "NUL"
            | "COM1"
            | "COM2"
            | "COM3"
            | "COM4"
            | "COM5"
            | "COM6"
            | "COM7"
            | "COM8"
            | "COM9"
            | "LPT1"
            | "LPT2"
            | "LPT3"
            | "LPT4"
            | "LPT5"
            | "LPT6"
            | "LPT7"
            | "LPT8"
            | "LPT9"
    )
}

pub fn sanitize_relative_path_for_disk(rel_path: &str) -> CliResult<(String, bool)> {
    let clean = normalize_archive_entry_path(rel_path)?;
    let sanitized = clean
        .split('/')
        .map(|segment| {
            let replaced: String = segment
                .chars()
                .map(|c| {
                    if matches!(c, ':' | '*' | '?' | '"' | '<' | '>' | '|') {
                        '_'
                    } else {
                        c
                    }
                })
                .collect();
            let trimmed = replaced.trim_end_matches(['.', ' ']);
            let mut safe = if trimmed.len() < replaced.len() {
                format!("{trimmed}_")
            } else {
                replaced
            };
            if is_windows_reserved_device_name(&safe) {
                safe.insert(0, '_');
            }
            safe
        })
        .collect::<Vec<_>>()
        .join("/");
    let renamed = sanitized != clean;
    Ok((sanitized, renamed))
}

fn file_mtime_ms(meta: &fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn read_extract_stamp(dir: &Path) -> Option<ExtractStamp> {
    let raw = fs::read_to_string(dir.join(EXTRACT_STAMP_FILE)).ok()?;
    serde_json::from_str(&raw).ok()
}

fn touch_extract_stamp(dir: &Path) {
    let Some(mut stamp) = read_extract_stamp(dir) else {
        return;
    };
    let now = now_epoch_ms();
    if let Some(prev) = stamp.last_accessed_at {
        if now.saturating_sub(prev) < STAMP_TOUCH_THROTTLE_MS {
            return;
        }
    }
    stamp.last_accessed_at = Some(now);
    if let Ok(json) = serde_json::to_string_pretty(&stamp) {
        let _ = atomic_write_file(&dir.join(EXTRACT_STAMP_FILE), json.as_bytes());
    }
}

fn get_max_workspace_packs() -> usize {
    std::env::var("BUG_LENS_MAX_PACKS")
        .ok()
        .and_then(|raw| raw.trim().parse::<usize>().ok())
        .filter(|&n| n >= 1)
        .unwrap_or(MAX_WORKSPACE_PACKS)
}

fn prune_workspace_dirs(workspace_root: &Path, active_dir: &Path) {
    if !workspace_root.exists() {
        return;
    }
    let max_packs = get_max_workspace_packs();
    let active_canon = clean_canonical_path(active_dir);
    let mut managed: Vec<(PathBuf, u64)> = Vec::new();

    let Ok(entries) = fs::read_dir(workspace_root) else {
        return;
    };
    for entry in entries.flatten() {
        let Ok(ft) = entry.file_type() else {
            continue;
        };
        if !ft.is_dir() {
            continue;
        }
        let full_dir = clean_canonical_path(&entry.path());
        let Some(stamp) = read_extract_stamp(&full_dir) else {
            continue;
        };
        if stamp.source.is_empty() {
            continue;
        }
        let last_accessed = stamp.last_accessed_at.unwrap_or_else(|| {
            fs::metadata(full_dir.join(EXTRACT_STAMP_FILE))
                .map(|m| file_mtime_ms(&m))
                .unwrap_or(0)
        });
        managed.push((full_dir, last_accessed));
    }

    if managed.len() <= max_packs {
        return;
    }

    managed.sort_by(|a, b| {
        if a.0 == active_canon {
            return std::cmp::Ordering::Less;
        }
        if b.0 == active_canon {
            return std::cmp::Ordering::Greater;
        }
        b.1.cmp(&a.1)
    });

    for (dir, _) in managed.into_iter().skip(max_packs) {
        if dir == active_canon {
            continue;
        }
        let _ = fs::remove_dir_all(dir);
    }
}

fn resolve_workspace_pack_shortcut(raw_input: &str) -> Option<PathBuf> {
    if raw_input.contains('/') || raw_input.contains('\\') {
        return None;
    }
    let stripped = strip_suffix_ascii_ignore_case(raw_input, ".zip");
    let needle = stripped.trim().to_lowercase();
    if needle.is_empty() {
        return None;
    }
    let workspace_root = get_triage_workspace_dir();
    if !workspace_root.exists() {
        return None;
    }

    let mut best_dir: Option<PathBuf> = None;
    let mut best_score = 0u8;
    let mut best_time = 0u64;

    let Ok(entries) = fs::read_dir(&workspace_root) else {
        return None;
    };
    for entry in entries.flatten() {
        let Ok(ft) = entry.file_type() else {
            continue;
        };
        if !ft.is_dir() {
            continue;
        }
        let full_dir = entry.path();
        let Some(stamp) = read_extract_stamp(&full_dir) else {
            continue;
        };
        if stamp.source.is_empty() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_lowercase();
        let score = if name == needle {
            2
        } else if name.contains(&needle) {
            1
        } else {
            0
        };
        if score == 0 {
            continue;
        }
        let time = stamp.last_accessed_at.unwrap_or(0);
        if score > best_score || (score == best_score && time >= best_time && best_dir.is_none())
            || (score == best_score && time > best_time)
        {
            best_dir = Some(full_dir);
            best_score = score;
            best_time = time;
        }
    }
    best_dir
}

fn index_directory_archive(
    root_dir: &Path,
) -> CliResult<(BTreeMap<String, u64>, BTreeMap<String, SkippedMediaInfo>)> {
    let mut entries = BTreeMap::new();
    let mut skipped_media = BTreeMap::new();
    let mut total_bytes = 0u64;

    fn walk(
        current_dir: &Path,
        rel_prefix: &str,
        entries: &mut BTreeMap<String, u64>,
        skipped_media: &mut BTreeMap<String, SkippedMediaInfo>,
        total_bytes: &mut u64,
    ) -> CliResult<()> {
        let read_dir = fs::read_dir(current_dir).map_err(|err| {
            CliError::new(format!(
                "PACK_NOT_FOUND: Failed to read directory \"{}\": {err}",
                current_dir.display()
            ))
        })?;
        for entry in read_dir {
            let entry = entry.map_err(|err| CliError::new(err.to_string()))?;
            let name = entry.file_name().to_string_lossy().into_owned();
            let rel_path = if rel_prefix.is_empty() {
                name
            } else {
                format!("{rel_prefix}/{name}")
            };
            let full_path = entry.path();
            let ft = entry
                .file_type()
                .map_err(|err| CliError::new(err.to_string()))?;
            if ft.is_dir() {
                walk(&full_path, &rel_path, entries, skipped_media, total_bytes)?;
            } else if ft.is_file() {
                if is_workspace_artifact(&rel_path) {
                    continue;
                }
                let size = fs::metadata(&full_path)
                    .map(|m| m.len())
                    .map_err(|err| CliError::new(err.to_string()))?;
                if media_path_regex().is_match(&rel_path) {
                    skipped_media.insert(
                        rel_path,
                        SkippedMediaInfo {
                            original_size: size,
                            compressed_size: size,
                        },
                    );
                    continue;
                }
                if size > MAX_SINGLE_FILE_BYTES {
                    return Err(CliError::new(format!(
                        "ZIP_BOMB_SINGLE_FILE_EXCEEDED: File \"{rel_path}\" ({size} bytes) exceeds limit"
                    )));
                }
                *total_bytes += size;
                if *total_bytes > MAX_TOTAL_UNCOMPRESSED_BYTES {
                    return Err(CliError::new(format!(
                        "ZIP_BOMB_TOTAL_SIZE_EXCEEDED: Total size ({total_bytes} bytes) exceeds limit"
                    )));
                }
                entries.insert(rel_path, size);
            }
        }
        Ok(())
    }

    walk(root_dir, "", &mut entries, &mut skipped_media, &mut total_bytes)?;
    Ok((entries, skipped_media))
}

fn load_pack_from_directory(dir: &Path, verify_integrity: bool) -> CliResult<LoadedPack> {
    let (entries, skipped_media) = index_directory_archive(dir)?;
    let mut integrity_skip = HashSet::new();
    if let Some(stamp) = read_extract_stamp(dir) {
        if !stamp.renamed_paths.is_empty() {
            integrity_skip.insert("data/session-data.js".to_string());
            for r in stamp.renamed_paths {
                integrity_skip.insert(r.from);
            }
        }
    }
    let storage = PackStorage::Disk {
        root_dir: dir.to_path_buf(),
        entries,
    };
    instantiate_pack(
        dir.to_string_lossy().into_owned(),
        storage,
        skipped_media,
        &integrity_skip,
        verify_integrity,
    )
}

struct ZipEntryMeta {
    index: usize,
    clean_name: String,
    is_media: bool,
}

fn inspect_zip_central_directory<R: Read + Seek>(
    archive: &mut ZipArchive<R>,
    include_media: bool,
) -> CliResult<(Vec<ZipEntryMeta>, BTreeMap<String, SkippedMediaInfo>)> {
    if archive.len() > MAX_ZIP_ENTRIES {
        return Err(CliError::new(format!(
            "ZIP_BOMB_ENTRY_COUNT_EXCEEDED: Archive contains {} entries, exceeding limit ({MAX_ZIP_ENTRIES})",
            archive.len()
        )));
    }
    let mut entries = Vec::new();
    let mut skipped_media = BTreeMap::new();
    let mut seen_clean_names = HashSet::new();
    let mut total_declared_bytes = 0u64;
    let mut total_declared_media_bytes = 0u64;

    for i in 0..archive.len() {
        let entry = archive.by_index_raw(i).map_err(|err| {
            CliError::new(format!(
                "CORRUPT_ZIP_ARCHIVE: Failed to decompress ZIP: {err}"
            ))
        })?;
        let raw_name = entry.name().to_string();
        let is_dir = entry.is_dir();
        let declared_size = entry.size();
        let compressed_size = entry.compressed_size();
        drop(entry);

        let clean_name = normalize_archive_entry_path(&raw_name)?;
        if is_dir || clean_name.is_empty() || clean_name.ends_with('/') {
            continue;
        }
        if !seen_clean_names.insert(clean_name.clone()) {
            return Err(CliError::new(format!(
                "UNSAFE_ZIP_DUPLICATE_ENTRY: Archive contains duplicate entry \"{clean_name}\""
            )));
        }
        let is_media = media_path_regex().is_match(&clean_name);
        if is_media {
            if !include_media {
                skipped_media.insert(
                    clean_name,
                    SkippedMediaInfo {
                        original_size: declared_size,
                        compressed_size,
                    },
                );
                continue;
            }
            if declared_size > MAX_MEDIA_FILE_BYTES {
                return Err(CliError::new(format!(
                    "ZIP_BOMB_SINGLE_FILE_EXCEEDED: Media entry \"{clean_name}\" uncompressed size ({declared_size} bytes) exceeds limit ({MAX_MEDIA_FILE_BYTES} bytes)"
                )));
            }
            total_declared_media_bytes = total_declared_media_bytes.saturating_add(declared_size);
            if total_declared_media_bytes > MAX_TOTAL_MEDIA_BYTES {
                return Err(CliError::new(format!(
                    "ZIP_BOMB_TOTAL_MEDIA_SIZE_EXCEEDED: Total media uncompressed size ({total_declared_media_bytes} bytes) exceeds limit ({MAX_TOTAL_MEDIA_BYTES} bytes)"
                )));
            }
        } else {
            if declared_size > MAX_SINGLE_FILE_BYTES {
                return Err(CliError::new(format!(
                    "ZIP_BOMB_SINGLE_FILE_EXCEEDED: Entry \"{clean_name}\" uncompressed size ({declared_size} bytes) exceeds limit ({MAX_SINGLE_FILE_BYTES} bytes)"
                )));
            }
            total_declared_bytes = total_declared_bytes.saturating_add(declared_size);
            if total_declared_bytes > MAX_TOTAL_UNCOMPRESSED_BYTES {
                return Err(CliError::new(format!(
                    "ZIP_BOMB_TOTAL_SIZE_EXCEEDED: Total uncompressed size ({total_declared_bytes} bytes) exceeds limit ({MAX_TOTAL_UNCOMPRESSED_BYTES} bytes)"
                )));
            }
        }

        entries.push(ZipEntryMeta {
            index: i,
            clean_name,
            is_media,
        });
    }

    Ok((entries, skipped_media))
}

fn read_zip_entry_bounded<R: Read + Seek>(
    archive: &mut ZipArchive<R>,
    index: usize,
    clean_name: &str,
    limit: u64,
) -> CliResult<Vec<u8>> {
    let mut zf = archive.by_index(index).map_err(|err| {
        CliError::new(format!(
            "CORRUPT_ZIP_ARCHIVE: Failed to decompress ZIP: {err}"
        ))
    })?;
    let mut out = Vec::new();
    let mut buf = [0u8; STREAM_BUF_SIZE];
    loop {
        let n = zf.read(&mut buf).map_err(|err| {
            CliError::new(format!(
                "CORRUPT_ZIP_ARCHIVE: Failed to decompress ZIP: {err}"
            ))
        })?;
        if n == 0 {
            break;
        }
        if (out.len() as u64) + (n as u64) > limit {
            return Err(CliError::new(format!(
                "ZIP_BOMB_SINGLE_FILE_EXCEEDED: Decompressed \"{clean_name}\" exceeds limit ({limit} bytes)"
            )));
        }
        out.extend_from_slice(&buf[..n]);
    }
    Ok(out)
}

fn stream_zip_entry_to_file<R: Read + Seek>(
    archive: &mut ZipArchive<R>,
    index: usize,
    clean_name: &str,
    target_path: &Path,
    single_limit: u64,
    total_tracker: Option<(&mut u64, u64, &str)>,
) -> CliResult<u64> {
    let mut zf = archive.by_index(index).map_err(|err| {
        CliError::new(format!(
            "CORRUPT_ZIP_ARCHIVE: Failed to decompress ZIP: {err}"
        ))
    })?;
    let file = File::create(target_path).map_err(|err| {
        CliError::new(format!(
            "IO_ERROR: Failed to create extracted file \"{}\": {err}",
            target_path.display()
        ))
    })?;
    let mut writer = BufWriter::with_capacity(STREAM_BUF_SIZE, file);
    let mut buf = [0u8; STREAM_BUF_SIZE];
    let mut written = 0u64;
    let mut total_tracker = total_tracker;

    loop {
        let n = zf.read(&mut buf).map_err(|err| {
            CliError::new(format!(
                "CORRUPT_ZIP_ARCHIVE: Failed to decompress ZIP: {err}"
            ))
        })?;
        if n == 0 {
            break;
        }
        written += n as u64;
        if written > single_limit {
            return Err(CliError::new(format!(
                "ZIP_BOMB_SINGLE_FILE_EXCEEDED: Decompressed \"{clean_name}\" ({written} bytes) exceeds limit ({single_limit} bytes)"
            )));
        }
        if let Some((ref mut total, total_limit, err_code)) = total_tracker {
            **total = (**total).saturating_add(n as u64);
            if **total > total_limit {
                return Err(CliError::new(format!(
                    "{err_code}: Total decompressed size ({} bytes) exceeds limit ({total_limit} bytes)",
                    **total
                )));
            }
        }
        writer.write_all(&buf[..n]).map_err(|err| {
            CliError::new(format!(
                "IO_ERROR: Failed to write extracted file \"{}\": {err}",
                target_path.display()
            ))
        })?;
    }
    writer.flush().map_err(|err| {
        CliError::new(format!(
            "IO_ERROR: Failed to flush extracted file \"{}\": {err}",
            target_path.display()
        ))
    })?;
    Ok(written)
}

fn validate_zip_pack_before_extract<R: Read + Seek>(
    archive: &mut ZipArchive<R>,
    entries: &[ZipEntryMeta],
) -> CliResult<()> {
    let by_name: HashMap<&str, usize> = entries
        .iter()
        .filter(|e| !e.is_media)
        .map(|e| (e.clean_name.as_str(), e.index))
        .collect();

    if let Some(&idx) = by_name.get("data/session-data.js") {
        let bytes = read_zip_entry_bounded(archive, idx, "data/session-data.js", MAX_SINGLE_FILE_BYTES)?;
        let raw_text = String::from_utf8_lossy(&bytes);
        let _: SessionDataPayload =
            parse_window_assignment_json(&raw_text, "data/session-data.js")?;
        return Ok(());
    }

    let has_screenshot = ["dom-context.json", "screenshot.jpg", "screenshot.png", "ai-prompt.md"]
        .iter()
        .any(|k| by_name.contains_key(k));

    if has_screenshot {
        for json_name in ["dom-context.json", "environment.json", "cascade.json"] {
            if let Some(&idx) = by_name.get(json_name) {
                let bytes = read_zip_entry_bounded(archive, idx, json_name, MAX_SINGLE_FILE_BYTES)?;
                let raw_text = String::from_utf8_lossy(&bytes);
                let _: Value = serde_json::from_str(&raw_text).map_err(|err| {
                    CliError::new(format!(
                        "INVALID_JSON_FILE: Failed to parse {json_name}: {err}"
                    ))
                })?;
            }
        }
        return Ok(());
    }

    let sample_files: Vec<&str> = entries
        .iter()
        .filter(|e| !e.is_media)
        .map(|e| e.clean_name.as_str())
        .take(10)
        .collect();
    Err(CliError::new(format!(
        "UNRECOGNIZED_BUG_LENS_PACK: Archive does not contain \"data/session-data.js\" or \"dom-context.json\". Found files: [{}]",
        sample_files.join(", ")
    )))
}

fn ensure_safe_target_path(dest_root: &Path, safe_rel: &str, orig_rel: &str) -> CliResult<PathBuf> {
    let mut target = dest_root.to_path_buf();
    for seg in safe_rel.split('/') {
        if seg == ".." || seg.is_empty() {
            return Err(CliError::new(format!(
                "UNSAFE_ZIP_ENTRY_PATH: Target path escapes destination root: {orig_rel}"
            )));
        }
        target.push(seg);
    }
    if !target.starts_with(dest_root) {
        return Err(CliError::new(format!(
            "UNSAFE_ZIP_ENTRY_PATH: Target path escapes destination root: {orig_rel}"
        )));
    }
    Ok(target)
}

fn ensure_extracted(
    zip_real_path: &str,
    mtime_ms: u64,
    size: u64,
    dest_dir: &Path,
    verify_integrity: bool,
) -> CliResult<LoadedPack> {
    if let Some(stamp) = read_extract_stamp(dest_dir) {
        if stamp.version == EXTRACT_STAMP_VERSION
            && stamp.source == zip_real_path
            && stamp.source_mtime_ms == mtime_ms
            && stamp.source_size == size
        {
            let canon_dest = clean_canonical_path(dest_dir);
            // 缓存命中时自动补齐可能被手动删除的派生 JSON，并检测磁盘工作区完整性
            write_derived_json_files(&canon_dest, true);
            if let Ok(loaded) = load_pack_from_directory(&canon_dest, verify_integrity) {
                let integrity_ok = match &loaded {
                    LoadedPack::Session(s) => s.integrity.valid,
                    LoadedPack::Screenshot(s) => s.integrity.valid,
                };
                // 若磁盘缓存文件被篡改或误删（integrity 失败），自动回退重新从源 ZIP 解压自愈；
                // 若源 ZIP 本身被篡改，重解后会如实上报 integrity mismatch。
                if !verify_integrity || integrity_ok {
                    let index_path = canon_dest.join(INDEX_FILE);
                    if !index_path.exists() {
                        let dest_str = canon_dest.to_string_lossy().into_owned();
                        let _ = fs::write(
                            &index_path,
                            build_index_markdown(&loaded, &dest_str, zip_real_path),
                        );
                    }
                    touch_extract_stamp(&canon_dest);
                    prune_workspace_dirs(&get_triage_workspace_dir(), &canon_dest);
                    return Ok(loaded);
                }
            }
        }
    }

    let file = File::open(zip_real_path).map_err(|err| {
        CliError::new(format!(
            "PACK_NOT_FOUND: Cannot access \"{zip_real_path}\": {err}"
        ))
    })?;
    let mut archive = ZipArchive::new(BufReader::with_capacity(STREAM_BUF_SIZE, file)).map_err(
        |err| {
            CliError::new(format!(
                "CORRUPT_ZIP_ARCHIVE: Failed to decompress ZIP: {err}"
            ))
        },
    )?;

    // Pass 1: validate central directory metadata & core pack structure before touching dest_dir.
    let (entries, _) = inspect_zip_central_directory(&mut archive, true)?;
    validate_zip_pack_before_extract(&mut archive, &entries)?;

    let mut renamed_paths: Vec<RenamedPath> = Vec::new();
    let mut rename_map: HashMap<String, String> = HashMap::new();
    let mut target_paths_lower: HashSet<String> = HashSet::new();
    for meta in &entries {
        let (sanitized, renamed) = sanitize_relative_path_for_disk(&meta.clean_name)?;
        if !target_paths_lower.insert(sanitized.to_ascii_lowercase()) {
            return Err(CliError::new(format!(
                "UNSAFE_ZIP_DUPLICATE_ENTRY: Archive entries collide after path sanitization: \"{}\" -> \"{}\"",
                meta.clean_name, sanitized
            )));
        }
        if renamed {
            renamed_paths.push(RenamedPath {
                from: meta.clean_name.clone(),
                to: sanitized.clone(),
            });
            rename_map.insert(meta.clean_name.clone(), sanitized);
        }
    }

    let parent_dir = dest_dir.parent().unwrap_or_else(|| Path::new("."));
    fs::create_dir_all(parent_dir).map_err(|err| {
        CliError::new(format!(
            "IO_ERROR: Failed to create workspace parent dir \"{}\": {err}",
            parent_dir.display()
        ))
    })?;
    let dest_name = dest_dir
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("pack");
    // 先在隔离临时目录完成全量解压与校验，再原子切换至目标目录，防止并发进程互相删除工作区
    let staging_dir = parent_dir.join(format!(".{dest_name}.{}", unique_temp_suffix()));
    fs::create_dir_all(&staging_dir).map_err(|err| {
        CliError::new(format!(
            "IO_ERROR: Failed to create staging dir \"{}\": {err}",
            staging_dir.display()
        ))
    })?;

    // Pass 2: stream entries to staging_dir with strict actual-byte guards.
    let mut total_actual_non_media_bytes = 0u64;
    let mut total_actual_media_bytes = 0u64;
    let extract_res: CliResult<()> = (|| {
        for meta in &entries {
            let safe_rel = rename_map
                .get(&meta.clean_name)
                .map(|s| s.as_str())
                .unwrap_or(&meta.clean_name);
            let target_path = ensure_safe_target_path(&staging_dir, safe_rel, &meta.clean_name)?;
            if let Some(parent) = target_path.parent() {
                fs::create_dir_all(parent).map_err(|err| {
                    CliError::new(format!("IO_ERROR: Failed to create parent dir: {err}"))
                })?;
            }

            if meta.clean_name == "data/session-data.js" && !rename_map.is_empty() {
                let raw_bytes = read_zip_entry_bounded(
                    &mut archive,
                    meta.index,
                    &meta.clean_name,
                    MAX_SINGLE_FILE_BYTES,
                )?;
                total_actual_non_media_bytes =
                    total_actual_non_media_bytes.saturating_add(raw_bytes.len() as u64);
                if total_actual_non_media_bytes > MAX_TOTAL_UNCOMPRESSED_BYTES {
                    return Err(CliError::new(format!(
                        "ZIP_BOMB_TOTAL_SIZE_EXCEEDED: Total decompressed size ({total_actual_non_media_bytes} bytes) exceeds limit ({MAX_TOTAL_UNCOMPRESSED_BYTES} bytes)"
                    )));
                }
                let mut text = String::from_utf8_lossy(&raw_bytes).into_owned();
                for (orig, new_p) in &rename_map {
                    text = text.replace(orig, new_p);
                }
                fs::write(&target_path, text.as_bytes()).map_err(|err| {
                    CliError::new(format!("IO_ERROR: Failed to write session-data.js: {err}"))
                })?;
            } else if meta.is_media {
                let _ = stream_zip_entry_to_file(
                    &mut archive,
                    meta.index,
                    &meta.clean_name,
                    &target_path,
                    MAX_MEDIA_FILE_BYTES,
                    Some((
                        &mut total_actual_media_bytes,
                        MAX_TOTAL_MEDIA_BYTES,
                        "ZIP_BOMB_TOTAL_MEDIA_SIZE_EXCEEDED",
                    )),
                )?;
            } else {
                let _ = stream_zip_entry_to_file(
                    &mut archive,
                    meta.index,
                    &meta.clean_name,
                    &target_path,
                    MAX_SINGLE_FILE_BYTES,
                    Some((
                        &mut total_actual_non_media_bytes,
                        MAX_TOTAL_UNCOMPRESSED_BYTES,
                        "ZIP_BOMB_TOTAL_SIZE_EXCEEDED",
                    )),
                )?;
            }
        }
        Ok(())
    })();

    if let Err(err) = extract_res {
        let _ = fs::remove_dir_all(&staging_dir);
        return Err(err);
    }

    write_derived_json_files(&staging_dir, false);

    let now = now_epoch_ms();
    let new_stamp = ExtractStamp {
        version: EXTRACT_STAMP_VERSION,
        source: zip_real_path.to_string(),
        source_mtime_ms: mtime_ms,
        source_size: size,
        renamed_paths,
        extracted_at: format_iso8601_utc(now),
        last_accessed_at: Some(now),
    };
    if let Ok(json) = serde_json::to_string_pretty(&new_stamp) {
        let _ = fs::write(staging_dir.join(EXTRACT_STAMP_FILE), json);
    }

    let canon_staging = clean_canonical_path(&staging_dir);
    let staging_loaded = match load_pack_from_directory(&canon_staging, verify_integrity) {
        Ok(loaded) => loaded,
        Err(err) => {
            let _ = fs::remove_dir_all(&staging_dir);
            return Err(err);
        }
    };

    // INDEX.md 中记录最终目标工作区路径（而非临时 staging 路径）
    let canon_parent = clean_canonical_path(parent_dir);
    let final_dest_str = canon_parent
        .join(dest_name)
        .to_string_lossy()
        .into_owned();
    let index_md = build_index_markdown(&staging_loaded, &final_dest_str, zip_real_path);
    let _ = fs::write(canon_staging.join(INDEX_FILE), index_md);
    drop(staging_loaded);

    let mut swapped_existing = false;
    if dest_dir.exists() {
        // 若并发另一进程已抢先落盘有效同源工作区，直接复用之，绝不强删仍在读的目录
        if let Some(existing_stamp) = read_extract_stamp(dest_dir) {
            if existing_stamp.version == EXTRACT_STAMP_VERSION
                && existing_stamp.source == zip_real_path
                && existing_stamp.source_mtime_ms == mtime_ms
                && existing_stamp.source_size == size
            {
                let canon_dest = clean_canonical_path(dest_dir);
                if let Ok(loaded) = load_pack_from_directory(&canon_dest, verify_integrity) {
                    let integrity_ok = match &loaded {
                        LoadedPack::Session(s) => s.integrity.valid,
                        LoadedPack::Screenshot(s) => s.integrity.valid,
                    };
                    if !verify_integrity || integrity_ok {
                        let _ = fs::remove_dir_all(&staging_dir);
                        prune_workspace_dirs(&get_triage_workspace_dir(), &canon_dest);
                        return Ok(loaded);
                    }
                }
            }
        }
        let trash_dir = parent_dir.join(format!(".{dest_name}.old-{}", unique_temp_suffix()));
        if fs::rename(dest_dir, &trash_dir).is_ok() {
            swapped_existing = true;
            if fs::rename(&staging_dir, dest_dir).is_err() {
                let _ = fs::rename(&trash_dir, dest_dir);
            } else {
                let _ = fs::remove_dir_all(&trash_dir);
            }
        }
    } else if fs::rename(&staging_dir, dest_dir).is_err() {
        // 并发创建竞争：目标刚被另一进程写入，下面直接从 dest_dir 加载
    }

    if staging_dir.exists() && !swapped_existing && !dest_dir.exists() {
        // 极端兜底失败：直接尝试再次 rename
        fs::rename(&staging_dir, dest_dir).map_err(|err| {
            let _ = fs::remove_dir_all(&staging_dir);
            CliError::new(format!("IO_ERROR: Failed to commit workspace dir: {err}"))
        })?;
    } else if staging_dir.exists() {
        let _ = fs::remove_dir_all(&staging_dir);
    }

    let canon_dest = clean_canonical_path(dest_dir);
    let loaded = load_pack_from_directory(&canon_dest, verify_integrity)?;
    prune_workspace_dirs(&get_triage_workspace_dir(), &canon_dest);
    Ok(loaded)
}

/// Pure in-memory loader (no disk extraction), for unit tests and programmatic calls.
pub fn open_pack_from_bytes(zip_bytes: &[u8], virtual_path: &str) -> CliResult<LoadedPack> {
    let cursor = Cursor::new(zip_bytes);
    let mut archive = ZipArchive::new(cursor).map_err(|err| {
        CliError::new(format!(
            "CORRUPT_ZIP_ARCHIVE: Failed to decompress ZIP: {err}"
        ))
    })?;

    let (entries, skipped_media) = inspect_zip_central_directory(&mut archive, false)?;
    let mut files = BTreeMap::new();
    let mut total_actual = 0u64;

    for meta in entries {
        if meta.is_media {
            continue;
        }
        let bytes = read_zip_entry_bounded(
            &mut archive,
            meta.index,
            &meta.clean_name,
            MAX_SINGLE_FILE_BYTES,
        )?;
        total_actual += bytes.len() as u64;
        if total_actual > MAX_TOTAL_UNCOMPRESSED_BYTES {
            return Err(CliError::new(format!(
                "ZIP_BOMB_TOTAL_SIZE_EXCEEDED: Total decompressed size ({total_actual} bytes) exceeds limit ({MAX_TOTAL_UNCOMPRESSED_BYTES} bytes)"
            )));
        }
        files.insert(meta.clean_name, bytes);
    }

    let storage = PackStorage::Memory { files };
    instantiate_pack(
        virtual_path.to_string(),
        storage,
        skipped_media,
        &HashSet::new(),
        true,
    )
}

pub fn open_pack(pack_path: Option<&str>) -> CliResult<LoadedPack> {
    open_pack_with_options(pack_path, OpenOptions::default())
}

pub fn open_pack_with_options(
    pack_path: Option<&str>,
    options: OpenOptions,
) -> CliResult<LoadedPack> {
    let effective_path = pack_path
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .or_else(load_last_pack_path_from_disk)
        .ok_or_else(|| {
            CliError::new(
                "INVALID_PACK_PATH: pack path is required when no pack has been opened yet. Pass the \"pack\" argument or call open_pack first.",
            )
        })?;

    let mut resolved = resolve_path(Path::new(&effective_path));
    if !resolved.exists() {
        if let Some(shortcut) = resolve_workspace_pack_shortcut(&effective_path) {
            resolved = shortcut;
        }
    }

    let real_path = fs::canonicalize(&resolved)
        .map(strip_windows_verbatim)
        .map_err(|err| {
            CliError::new(format!(
                "PACK_NOT_FOUND: Cannot access \"{effective_path}\": {err}"
            ))
        })?;
    let meta = fs::metadata(&real_path).map_err(|err| {
        CliError::new(format!(
            "PACK_NOT_FOUND: Cannot access \"{effective_path}\": {err}"
        ))
    })?;
    let real_path_str = real_path.to_string_lossy().into_owned();

    if meta.is_dir() {
        write_derived_json_files(&real_path, true);
        let loaded = load_pack_from_directory(&real_path, options.verify_integrity)?;
        let index_path = real_path.join(INDEX_FILE);
        if !index_path.exists() {
            let source_path = read_extract_stamp(&real_path)
                .map(|s| s.source)
                .unwrap_or_else(|| real_path_str.clone());
            let _ = fs::write(
                &index_path,
                build_index_markdown(&loaded, &real_path_str, &source_path),
            );
        }
        touch_extract_stamp(&real_path);
        save_last_pack_path_to_disk(&real_path_str);
        return Ok(loaded);
    }

    let dest_dir = get_workspace_dir_for_zip(&real_path_str);
    let mtime_ms = file_mtime_ms(&meta);
    let loaded = ensure_extracted(
        &real_path_str,
        mtime_ms,
        meta.len(),
        &dest_dir,
        options.verify_integrity,
    )?;
    save_last_pack_path_to_disk(loaded.pack_path());
    Ok(loaded)
}

fn instantiate_pack(
    pack_path: String,
    storage: PackStorage,
    skipped_media_files: BTreeMap<String, SkippedMediaInfo>,
    integrity_skip: &HashSet<String>,
    verify_integrity: bool,
) -> CliResult<LoadedPack> {
    let manifest_bytes = storage.read_bytes("manifest.json");
    let manifest_res = parse_manifest_result(manifest_bytes.as_deref());
    let manifest = match &manifest_res {
        ManifestParseResult::Valid(m) => Some(m.clone()),
        _ => None,
    };

    let integrity = if verify_integrity {
        let mut skipped_set: HashSet<String> = skipped_media_files.keys().cloned().collect();
        skipped_set.extend(integrity_skip.iter().cloned());
        verify_pack_integrity_result(&manifest_res, &storage, &skipped_set)
    } else {
        let is_corrupt = matches!(manifest_res, ManifestParseResult::Corrupt(_));
        IntegrityReport {
            has_manifest: !matches!(manifest_res, ManifestParseResult::Missing),
            valid: !is_corrupt,
            schema_version: manifest.as_ref().and_then(|m| m.schema_version),
            schema_warning: None,
            checked_count: 0,
            skipped_count: skipped_media_files.len(),
            mismatches: match manifest_res {
                ManifestParseResult::Corrupt(ref err) => {
                    vec![format!("manifest.json: corrupt or invalid ({err})")]
                }
                _ => Vec::new(),
            },
        }
    };

    if let Some(raw_text) = storage.read_text("data/session-data.js") {
        let data: SessionDataPayload =
            parse_window_assignment_json(&raw_text, "data/session-data.js")?;
        return Ok(LoadedPack::Session(Box::new(LoadedSessionPack::new(
            pack_path,
            manifest,
            integrity,
            data,
            storage,
            skipped_media_files,
        ))));
    }

    let has_screenshot = storage.has("dom-context.json")
        || storage.has("screenshot.jpg")
        || storage.has("screenshot.png")
        || storage.has("ai-prompt.md");

    if has_screenshot {
        let parse_json_opt = |name: &str| -> CliResult<Option<Value>> {
            let Some(text) = storage.read_text(name) else {
                return Ok(None);
            };
            let val: Value = serde_json::from_str(&text).map_err(|err| {
                CliError::new(format!("INVALID_JSON_FILE: Failed to parse {name}: {err}"))
            })?;
            Ok(Some(val))
        };

        let dom_context: Option<ScreenshotDomContext> = match parse_json_opt("dom-context.json")? {
            Some(v) => Some(serde_json::from_value(v).map_err(|err| {
                CliError::new(format!(
                    "INVALID_JSON_FILE: Failed to parse dom-context.json: {err}"
                ))
            })?),
            None => None,
        };
        let environment: Option<ScreenshotEnvironment> = match parse_json_opt("environment.json")? {
            Some(v) => Some(serde_json::from_value(v).map_err(|err| {
                CliError::new(format!(
                    "INVALID_JSON_FILE: Failed to parse environment.json: {err}"
                ))
            })?),
            None => None,
        };
        let cascade: Option<CascadeIndex> = match parse_json_opt("cascade.json")? {
            Some(v) => Some(serde_json::from_value(v).map_err(|err| {
                CliError::new(format!(
                    "INVALID_JSON_FILE: Failed to parse cascade.json: {err}"
                ))
            })?),
            None => None,
        };
        let ai_prompt = storage.read_text("ai-prompt.md");

        return Ok(LoadedPack::Screenshot(Box::new(LoadedScreenshotPack::new(
            pack_path,
            manifest,
            integrity,
            dom_context,
            environment,
            cascade,
            ai_prompt,
            storage,
            skipped_media_files,
        ))));
    }

    let sample_files: Vec<String> = storage
        .iter_entries()
        .into_iter()
        .map(|(k, _)| k)
        .take(10)
        .collect();
    Err(CliError::new(format!(
        "UNRECOGNIZED_BUG_LENS_PACK: Archive does not contain \"data/session-data.js\" or \"dom-context.json\". Found files: [{}]",
        sample_files.join(", ")
    )))
}

fn write_derived_json_files(dest_root: &Path, only_if_missing: bool) -> Vec<String> {
    let mut written = Vec::new();
    for (source, target) in DERIVED_JSON_FILES {
        let mut source_path = dest_root.to_path_buf();
        for seg in source.split('/') {
            source_path.push(seg);
        }
        let mut target_path = dest_root.to_path_buf();
        for seg in target.split('/') {
            target_path.push(seg);
        }
        if !source_path.exists() {
            continue;
        }
        if only_if_missing && target_path.exists() {
            written.push(target.to_string());
            continue;
        }
        if let Ok(raw) = fs::read_to_string(&source_path) {
            if let Ok(parsed) = parse_window_assignment_json::<Value>(&raw, source) {
                if let Ok(file) = File::create(&target_path) {
                    let mut writer = BufWriter::with_capacity(STREAM_BUF_SIZE, file);
                    if serde_json::to_writer_pretty(&mut writer, &parsed).is_ok()
                        && writer.flush().is_ok()
                    {
                        written.push(target.to_string());
                    }
                }
            }
        }
    }
    written
}

fn build_extract_result(
    pack: &LoadedPack,
    dest_root: &Path,
    written_files: Vec<String>,
    renamed_paths: Vec<RenamedPath>,
) -> ExtractPackResult {
    let dest_dir = dest_root.to_string_lossy().into_owned();
    let reproduce_spec_path = if pack.has_file("reproduce.spec.ts") {
        Some(dest_root.join("reproduce.spec.ts").to_string_lossy().into_owned())
    } else {
        None
    };
    let report_html_path = if pack.has_file("report.html") {
        Some(dest_root.join("report.html").to_string_lossy().into_owned())
    } else {
        None
    };
    let screenshot_path = match pack {
        LoadedPack::Screenshot(ss) => ss
            .get_screenshot_image_path()
            .map(|rel| dest_root.join(rel).to_string_lossy().into_owned()),
        LoadedPack::Session(_) => None,
    };
    ExtractPackResult {
        dest_dir,
        written_files,
        renamed_paths,
        reproduce_spec_path,
        report_html_path,
        screenshot_path,
    }
}

pub fn describe_workspace(pack: &LoadedPack, workspace_dir: &str) -> ExtractPackResult {
    let dir_path = Path::new(workspace_dir);
    let renamed_paths = read_extract_stamp(dir_path)
        .map(|s| s.renamed_paths)
        .unwrap_or_default();
    let mut written_files: Vec<String> = pack.list_files().into_iter().map(|f| f.path).collect();
    written_files.sort();
    build_extract_result(pack, dir_path, written_files, renamed_paths)
}

pub fn extract_pack_to_disk(
    pack: &LoadedPack,
    custom_dest_dir: Option<&str>,
) -> CliResult<ExtractPackResult> {
    let default_subdir = match pack {
        LoadedPack::Session(s) => {
            let sid = s.session_id();
            let prefix: String = sid.chars().take(8).collect();
            if prefix.is_empty() {
                "session".to_string()
            } else {
                prefix
            }
        }
        LoadedPack::Screenshot(_) => "screenshot".to_string(),
    };
    let raw_dest_root = match custom_dest_dir {
        Some(d) => resolve_path(Path::new(d)),
        None => get_triage_workspace_dir().join(default_subdir),
    };
    fs::create_dir_all(&raw_dest_root).map_err(|err| {
        CliError::new(format!(
            "IO_ERROR: Failed to create destination dir \"{}\": {err}",
            raw_dest_root.display()
        ))
    })?;
    // 规范化目标目录（解析 /tmp -> /private/tmp 等符号链接），杜绝同目录自拷贝清零
    let dest_root = clean_canonical_path(&raw_dest_root);

    let entries = pack.storage().iter_entries();
    let mut renamed_paths = Vec::new();
    let mut rename_map: HashMap<String, String> = HashMap::new();
    for (rel_path, _) in &entries {
        let (sanitized, renamed) = sanitize_relative_path_for_disk(rel_path)?;
        if renamed {
            renamed_paths.push(RenamedPath {
                from: rel_path.clone(),
                to: sanitized.clone(),
            });
            rename_map.insert(rel_path.clone(), sanitized);
        }
    }

    let mut written_files = Vec::new();
    for (rel_path, _) in &entries {
        let safe_rel = rename_map.get(rel_path).unwrap_or(rel_path);
        let target_path = ensure_safe_target_path(&dest_root, safe_rel, rel_path)?;
        if let Some(parent) = target_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|err| CliError::new(format!("IO_ERROR: {err}")))?;
        }
        if rel_path == "data/session-data.js" && !rename_map.is_empty() {
            if let Some(mut text) = pack.get_text_file(rel_path) {
                for (orig, new_p) in &rename_map {
                    text = text.replace(orig, new_p);
                }
                fs::write(&target_path, text.as_bytes())
                    .map_err(|err| CliError::new(format!("IO_ERROR: {err}")))?;
                written_files.push(safe_rel.clone());
            }
        } else if let Some(src_root) = pack.storage().disk_root() {
            let mut src_file = src_root.to_path_buf();
            for seg in rel_path.split('/') {
                src_file.push(seg);
            }
            if !is_same_file_or_path(&src_file, &target_path) {
                fs::copy(&src_file, &target_path)
                    .map_err(|err| CliError::new(format!("IO_ERROR: {err}")))?;
            }
            written_files.push(safe_rel.clone());
        } else if let Some(bytes) = pack.get_binary_file(rel_path) {
            fs::write(&target_path, bytes)
                .map_err(|err| CliError::new(format!("IO_ERROR: {err}")))?;
            written_files.push(safe_rel.clone());
        }
    }

    if let Some(src_dir) = get_pack_workspace_dir(pack) {
        let src_dir_path = Path::new(&src_dir);
        for media_rel in pack.skipped_media_files().keys() {
            let mut from = src_dir_path.to_path_buf();
            let mut to = dest_root.clone();
            for seg in media_rel.split('/') {
                from.push(seg);
                to.push(seg);
            }
            if from.exists() {
                if !is_same_file_or_path(&from, &to) {
                    if let Some(parent) = to.parent() {
                        let _ = fs::create_dir_all(parent);
                    }
                    if fs::copy(&from, &to).is_ok() {
                        written_files.push(media_rel.clone());
                    }
                } else {
                    written_files.push(media_rel.clone());
                }
            }
        }
    }

    write_derived_json_files(&dest_root, false);
    let dest_str = dest_root.to_string_lossy().into_owned();
    let _ = fs::write(
        dest_root.join(INDEX_FILE),
        build_index_markdown(pack, &dest_str, pack.pack_path()),
    );

    written_files.sort();
    Ok(build_extract_result(
        pack,
        &dest_root,
        written_files,
        renamed_paths,
    ))
}
