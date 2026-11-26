//! `bug-lens-cli` 核心模块单元测试与集成测试。

use bug_lens_cli::pack::js_json::parse_window_assignment_json;
use bug_lens_cli::pack::open::{
    extract_pack_to_disk, get_pack_workspace_dir, normalize_archive_entry_path, open_pack,
    open_pack_from_bytes, sanitize_relative_path_for_disk,
};
use bug_lens_cli::pack::LoadedPack;
use bug_lens_cli::query::json_path::evaluate_json_path;
use bug_lens_cli::run_triage_cli;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::{Cursor, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipWriter};

/// 串行化修改进程环境变量（`BUG_LENS_CLI_WORKSPACE` / `BUG_LENS_MAX_PACKS`）的测试。
static ENV_LOCK: Mutex<()> = Mutex::new(());

fn make_temp_dir(prefix: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("{prefix}-{}-{nanos}", std::process::id()));
    fs::create_dir_all(&dir).unwrap();
    dir
}

fn build_zip(entries: &[(&str, &[u8])]) -> Vec<u8> {
    let mut cursor = Cursor::new(Vec::new());
    {
        let mut writer = ZipWriter::new(&mut cursor);
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        for (name, bytes) in entries {
            writer.start_file(*name, options).unwrap();
            writer.write_all(bytes).unwrap();
        }
        writer.finish().unwrap();
    }
    cursor.into_inner()
}

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

fn build_minimal_session_zip(
    schema_version: u64,
    tamper: bool,
    include_media: bool,
    legacy_colon: bool,
) -> Vec<u8> {
    let body_name = if legacy_colon {
        "network/body-d6135e69:20535.366.txt"
    } else {
        "network/body-d6135e69_20535.366.txt"
    };
    let body_bytes = br#"{"code":0,"data":{"definition":{"form":{"name":"portal_form","elements":[{"id":"ssd_a","type":"select_form","opt_ass":{"visible":false}}]}}}}"#;
    let session_json = json!({
        "summary": {
            "title": "Portal Test",
            "url": "https://example.com/portal",
            "durationMs": 12000
        },
        "session": {
            "id": "d6135e69-0000-0000-0000-000000000001",
            "schemaVersion": schema_version,
            "timeline": { "startedAtEpochMs": 1700000000000_u64, "durationMs": 12000 }
        },
        "interactions": [{
            "id": "int-1",
            "kind": "click",
            "createdAt": 1700000002000_u64,
            "element": { "tagName": "button", "id": "submit", "text": "Submit" }
        }],
        "consoleEntries": [{
            "id": "con-1",
            "createdAt": 1700000003000_u64,
            "level": "error",
            "text": "TypeError: standbyOptions is undefined",
            "url": "https://example.com/app.js",
            "lineNumber": 12,
            "sourceMappedLocation": {
                "resolved": true,
                "originalFile": "src/editor.vue",
                "originalLine": 341
            }
        }],
        "networkEntries": [{
            "id": "20535.366",
            "createdAt": 1700000002500_u64,
            "url": "https://api.example.com/bpm/standby/options",
            "method": "POST",
            "type": "xhr",
            "status": 500,
            "durationMs": 180,
            "response": {
                "mimeType": "application/json",
                "bodyStatus": "captured",
                "byteLength": body_bytes.len(),
                "bodyPath": body_name
            }
        }],
        "issueScenes": [{
            "id": "scene-1",
            "scene": {
                "id": "scene-1",
                "observedAtEpochMs": 1700000005000_u64,
                "narrative": {
                    "actual": "选择窗口消失",
                    "expected": { "text": "应保留 3 个窗口", "confidence": "explicit" }
                },
                "targets": [{
                    "element": { "tagName": "div", "id": "ssd_a_container" }
                }]
            }
        }],
        "frameworkStates": [{
            "id": "fw-1",
            "capturedAtEpochMs": 1700000004000_u64,
            "trigger": "click",
            "snapshot": {
                "targetComponent": {
                    "framework": "vue",
                    "version": 3,
                    "componentName": "BpmSelectFromFieldEditor",
                    "props": { "visible": false }
                }
            }
        }]
    });

    let session_js = format!("window.__BUG_LENS_DATA__ = {};\n", session_json);
    let session_js_bytes = session_js.as_bytes();
    let manifest_hash = if tamper {
        "0".repeat(64)
    } else {
        sha256_hex(session_js_bytes)
    };
    let manifest_json = json!({
        "format": "bug-lens-evidence-pack",
        "schemaVersion": schema_version,
        "sessionId": "d6135e69-0000-0000-0000-000000000001",
        "files": {
            "data/session-data.js": {
                "byteLength": session_js_bytes.len(),
                "sha256": manifest_hash
            },
            body_name: {
                "byteLength": body_bytes.len(),
                "sha256": sha256_hex(body_bytes)
            }
        }
    })
    .to_string();

    let mut entries: Vec<(&str, &[u8])> = vec![
        ("manifest.json", manifest_json.as_bytes()),
        ("data/session-data.js", session_js_bytes),
        (body_name, body_bytes),
    ];
    let media_dummy = vec![0x1A_u8; 2048];
    if include_media {
        entries.push(("media/recording.webm", &media_dummy));
    }
    build_zip(&entries)
}

#[test]
fn test_parse_window_assignment_json_rejects_untrusted_js() {
    let parsed: Value =
        parse_window_assignment_json("  window.__BUG_LENS_DATA__ = {\"ok\": true};\n", "test.js")
            .unwrap();
    assert_eq!(parsed, json!({ "ok": true }));

    let err_payload = parse_window_assignment_json::<Value>(
        "window.__BUG_LENS_DATA__ = (() => { throw new Error(\"pwned\"); })();",
        "test.js",
    )
    .unwrap_err();
    assert!(err_payload.to_string().contains("INVALID_JS_JSON_PAYLOAD"));

    let err_wrapper =
        parse_window_assignment_json::<Value>("console.log(\"evil\");", "test.js").unwrap_err();
    assert!(err_wrapper.to_string().contains("INVALID_JS_JSON_WRAPPER"));
}

#[test]
fn test_json_path_queries() {
    let sample = json!({
        "data": {
            "definition": {
                "form": {
                    "elements": [
                        { "id": "task_type", "type": "select" },
                        { "id": "ssd_a", "type": "select_form", "opt_ass": { "visible": false } }
                    ]
                }
            }
        }
    });

    assert_eq!(
        evaluate_json_path(&sample, "$.data.definition.form.elements[0].id"),
        json!("task_type")
    );
    assert_eq!(
        evaluate_json_path(&sample, "data.definition.form.elements[*].id"),
        json!(["task_type", "ssd_a"])
    );
    assert_eq!(
        evaluate_json_path(&sample, "data.definition.form.elements[id=ssd_a].opt_ass.visible"),
        json!([false])
    );
    assert_eq!(
        evaluate_json_path(&sample, "$.data.definition.form.elements[?(@.id == 'ssd_a')].type"),
        json!(["select_form"])
    );
}

#[test]
fn test_path_normalization_and_windows_sanitization() {
    assert!(normalize_archive_entry_path("../../etc/passwd")
        .unwrap_err()
        .to_string()
        .contains("UNSAFE_ZIP_ENTRY_PATH"));
    assert!(normalize_archive_entry_path("/etc/passwd")
        .unwrap_err()
        .to_string()
        .contains("UNSAFE_ZIP_ENTRY_PATH"));
    assert!(normalize_archive_entry_path("C:\\Windows\\system32")
        .unwrap_err()
        .to_string()
        .contains("UNSAFE_ZIP_ENTRY_PATH"));

    let (sanitized, renamed) =
        sanitize_relative_path_for_disk("network/body-d6135e69:20535.366?.txt.").unwrap();
    assert!(renamed);
    assert_eq!(sanitized, "network/body-d6135e69_20535.366_.txt_");

    // Windows 保留设备名（CON/PRN/AUX/NUL/COM1-9/LPT1-9）应自动加下划线前缀避免落盘失败
    for (input, expected) in [
        ("logs/CON.txt", "logs/_CON.txt"),
        ("NUL", "_NUL"),
        ("sub/com1.log", "sub/_com1.log"),
        ("lpt9", "_lpt9"),
    ] {
        let (out, was_renamed) = sanitize_relative_path_for_disk(input).unwrap();
        assert!(was_renamed, "expected {input} to be sanitized");
        assert_eq!(out, expected);
    }
}

#[test]
fn test_open_pack_from_bytes_integrity_zip_bomb_and_media_skip() {
    // 1. 合法包 + 跳过录屏不进内存
    let zip_bytes = build_minimal_session_zip(4, false, true, false);
    let pack = open_pack_from_bytes(&zip_bytes, "<memory>.zip").unwrap();
    let LoadedPack::Session(s) = &pack else {
        panic!("expected session pack");
    };
    assert!(s.integrity.valid);
    assert!(s.integrity.schema_warning.is_none());
    assert!(!s.storage.has("media/recording.webm"));
    assert!(s.skipped_media_files.contains_key("media/recording.webm"));

    // 2. 篡改 sha256 与未来 schemaVersion 警告
    let tampered = build_minimal_session_zip(99, true, false, false);
    let pack_tampered = open_pack_from_bytes(&tampered, "<memory>.zip").unwrap();
    let LoadedPack::Session(st) = &pack_tampered else {
        panic!("expected session pack");
    };
    assert!(!st.integrity.valid);
    assert!(st
        .integrity
        .mismatches
        .iter()
        .any(|m| m.contains("data/session-data.js")));
    assert!(st
        .integrity
        .schema_warning
        .as_deref()
        .unwrap_or("")
        .contains("newer than max supported version"));

    // 3. 损坏 ZIP、未识别 ZIP 与非法 JSON
    assert!(open_pack_from_bytes(&[1, 2, 3, 4, 5], "<bad>.zip")
        .unwrap_err()
        .to_string()
        .contains("CORRUPT_ZIP_ARCHIVE"));

    let unknown_zip = build_zip(&[("random.txt", b"hello")]);
    assert!(open_pack_from_bytes(&unknown_zip, "<unknown>.zip")
        .unwrap_err()
        .to_string()
        .contains("UNRECOGNIZED_BUG_LENS_PACK"));

    let bad_json_zip = build_zip(&[("dom-context.json", b"{ broken json")]);
    assert!(open_pack_from_bytes(&bad_json_zip, "<bad-json>.zip")
        .unwrap_err()
        .to_string()
        .contains("INVALID_JSON_FILE"));

    // 4. Zip Bomb 声明大小超限校验（修改 Central Directory uncompressed size > 64 MB）
    let mut bomb_zip = build_zip(&[("data/huge.txt", &[0u8; 10])]);
    for i in 0..bomb_zip.len().saturating_sub(28) {
        if bomb_zip[i..i + 4] == [0x50, 0x4b, 0x01, 0x02] {
            let fake_size: u32 = 70 * 1024 * 1024;
            bomb_zip[i + 24..i + 28].copy_from_slice(&fake_size.to_le_bytes());
            break;
        }
    }
    assert!(open_pack_from_bytes(&bomb_zip, "<bomb>.zip")
        .unwrap_err()
        .to_string()
        .contains("ZIP_BOMB_SINGLE_FILE_EXCEEDED"));
}

#[test]
fn test_workspace_streaming_extraction_lru_and_cli_roundtrip() {
    let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let temp_root = make_temp_dir("bug-lens-rust-ws");
    let ws_dir = temp_root.join("ws");

    let prev_ws = std::env::var("BUG_LENS_CLI_WORKSPACE").ok();
    let prev_max = std::env::var("BUG_LENS_MAX_PACKS").ok();
    std::env::set_var("BUG_LENS_CLI_WORKSPACE", &ws_dir);
    std::env::set_var("BUG_LENS_MAX_PACKS", "2");

    // 1. 建一个不受 CLI 管理的手动目录，验证 LRU 清理不会误删
    let unmanaged = ws_dir.join("manual-notes");
    fs::create_dir_all(&unmanaged).unwrap();
    fs::write(unmanaged.join("keep.txt"), "keep").unwrap();

    // 2. 创建含录屏与 Windows 非法冒号文件名的历史包并运行 open_pack
    let legacy_zip_path = temp_root.join("web-bug-report-d6135e69.zip");
    fs::write(
        &legacy_zip_path,
        build_minimal_session_zip(4, false, true, true),
    )
    .unwrap();

    let open_out = run_triage_cli(&[
        "open_pack".to_string(),
        legacy_zip_path.to_string_lossy().into_owned(),
    ])
    .unwrap();
    assert!(open_out.contains("# Bug Lens Evidence Pack (kind: session)"));
    assert!(open_out.contains("INDEX.md"));

    // 验证派生 JSON、录屏落盘、冒号改名与 session-data.js 引用同步
    let loaded = open_pack(Some(&legacy_zip_path.to_string_lossy())).unwrap();
    let extracted_ws = PathBuf::from(get_pack_workspace_dir(&loaded).unwrap());
    assert!(extracted_ws.join("media/recording.webm").exists());
    assert!(extracted_ws.join("data/session-data.json").exists());
    assert!(extracted_ws.join("INDEX.md").exists());
    assert!(extracted_ws
        .join("network/body-d6135e69_20535.366.txt")
        .exists());

    // 验证跨命令自动命中 .current-pack 与 JSONPath 提取
    let req_out = run_triage_cli(&[
        "get_request".to_string(),
        "20535.366".to_string(),
        "--jsonPath".to_string(),
        "data.definition.form.name".to_string(),
    ])
    .unwrap();
    assert!(req_out.contains("portal_form"));

    // 验证短 ID 寻址
    let by_short = open_pack(Some("d6135e69")).unwrap();
    assert_eq!(
        get_pack_workspace_dir(&by_short).unwrap(),
        extracted_ws.to_string_lossy()
    );

    // 验证 extract_pack_to_disk
    let custom_out = temp_root.join("custom-export");
    let ext = extract_pack_to_disk(&loaded, Some(&custom_out.to_string_lossy())).unwrap();
    assert!(custom_out.join("media/recording.webm").exists());
    assert!(!ext.written_files.is_empty());

    // 验证 LRU (K=2) 淘汰与非托管目录保护
    let zip_b = temp_root.join("pack-b.zip");
    let zip_c = temp_root.join("pack-c.zip");
    let clean_bytes = build_minimal_session_zip(4, false, false, false);
    fs::write(&zip_b, &clean_bytes).unwrap();
    fs::write(&zip_c, &clean_bytes).unwrap();
    std::thread::sleep(std::time::Duration::from_millis(15));
    let _ = open_pack(Some(&zip_b.to_string_lossy())).unwrap();
    std::thread::sleep(std::time::Duration::from_millis(15));
    let _ = open_pack(Some(&zip_c.to_string_lossy())).unwrap();

    assert!(!extracted_ws.exists(), "oldest managed workspace should be evicted");
    assert!(
        unmanaged.join("keep.txt").exists(),
        "unmanaged directory must never be deleted"
    );

    // 恢复环境并清理临时目录
    match prev_ws {
        Some(v) => std::env::set_var("BUG_LENS_CLI_WORKSPACE", v),
        None => std::env::remove_var("BUG_LENS_CLI_WORKSPACE"),
    }
    match prev_max {
        Some(v) => std::env::set_var("BUG_LENS_MAX_PACKS", v),
        None => std::env::remove_var("BUG_LENS_MAX_PACKS"),
    }
    let _ = fs::remove_dir_all(&temp_root);
}

#[test]
fn test_security_invariant_no_outbound_network_clients() {
    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    let cargo_toml = fs::read_to_string(manifest_dir.join("Cargo.toml")).unwrap();
    for forbidden_crate in [
        "reqwest", "hyper", "ureq", "tokio", "surf", "isahc", "curl", "awc",
    ] {
        assert!(
            !cargo_toml.contains(forbidden_crate),
            "Forbidden network crate '{forbidden_crate}' found in Cargo.toml"
        );
    }

    fn scan_rs_files(dir: &Path) {
        for entry in fs::read_dir(dir).unwrap() {
            let entry = entry.unwrap();
            let path = entry.path();
            if path.is_dir() {
                scan_rs_files(&path);
            } else if path.extension().and_then(|e| e.to_str()) == Some("rs") {
                let content = fs::read_to_string(&path).unwrap();
                for forbidden in ["std::net", "TcpStream", "UdpSocket", "reqwest", "hyper"] {
                    assert!(
                        !content.contains(forbidden),
                        "Forbidden network symbol '{forbidden}' found in {}",
                        path.display()
                    );
                }
            }
        }
    }
    scan_rs_files(&manifest_dir.join("src"));
}

#[test]
fn test_utf8_chinese_args_and_paths_never_panic() {
    let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let temp_root = make_temp_dir("bug-lens-rust-utf8");
    let ws_dir = temp_root.join("ws");

    let prev_ws = std::env::var("BUG_LENS_CLI_WORKSPACE").ok();
    std::env::set_var("BUG_LENS_CLI_WORKSPACE", &ws_dir);

    // 1. 含中文路径且不以 .zip 结尾或以大写 .ZIP 结尾的文件，不得触发 UTF-8 切片越界 panic
    let zip_upper = temp_root.join("中文证据包.ZIP");
    fs::write(&zip_upper, build_minimal_session_zip(4, false, false, false)).unwrap();
    let open_out = run_triage_cli(&[
        "open_pack".to_string(),
        zip_upper.to_string_lossy().into_owned(),
    ])
    .unwrap();
    assert!(open_out.contains("# Bug Lens Evidence Pack (kind: session)"));

    // 2. 非 .zip 后缀的中文路径也应走标准错误返回，而非 panic
    let non_zip_cn = temp_root.join("证据包");
    let err = open_pack(Some(&non_zip_cn.to_string_lossy())).unwrap_err();
    assert!(err.to_string().contains("PACK_NOT_FOUND"));

    // 3. 中文位置参数（3/6/9 字节，落点刚好跨 UTF-8 字符边界）查询均应安全执行
    for query in ["子模块", "窗口", "按钮测试"] {
        let res = run_triage_cli(&["search_pack".to_string(), query.to_string()]).unwrap();
        assert!(res.contains(&format!("# Search Hits for \"{query}\"")));
    }
    let con_res = run_triage_cli(&["query_console".to_string(), "中文过滤".to_string()]).unwrap();
    assert!(con_res.contains("Console"));

    match prev_ws {
        Some(v) => std::env::set_var("BUG_LENS_CLI_WORKSPACE", v),
        None => std::env::remove_var("BUG_LENS_CLI_WORKSPACE"),
    }
    let _ = fs::remove_dir_all(&temp_root);
}

#[cfg(unix)]
#[test]
fn test_extract_pack_symlink_same_workspace_does_not_truncate_files() {
    use std::os::unix::fs::symlink;

    let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let temp_root = make_temp_dir("bug-lens-rust-symlink");
    let ws_dir = temp_root.join("ws");

    let prev_ws = std::env::var("BUG_LENS_CLI_WORKSPACE").ok();
    std::env::set_var("BUG_LENS_CLI_WORKSPACE", &ws_dir);

    let zip_path = temp_root.join("pack-symlink.zip");
    fs::write(&zip_path, build_minimal_session_zip(4, false, true, false)).unwrap();
    let loaded = open_pack(Some(&zip_path.to_string_lossy())).unwrap();
    let extracted_ws = PathBuf::from(get_pack_workspace_dir(&loaded).unwrap());

    let orig_manifest = fs::read(extracted_ws.join("manifest.json")).unwrap();
    let orig_session = fs::read(extracted_ws.join("data/session-data.js")).unwrap();
    let orig_media = fs::read(extracted_ws.join("media/recording.webm")).unwrap();
    assert!(!orig_manifest.is_empty());
    assert!(!orig_session.is_empty());
    assert_eq!(orig_media.len(), 2048);

    // 构造指向同一工作区的符号链接，并通过 --dest 传入，验证文件不被截断为 0 字节
    let link_path = temp_root.join("ws-alias");
    symlink(&extracted_ws, &link_path).unwrap();

    let ext = extract_pack_to_disk(&loaded, Some(&link_path.to_string_lossy())).unwrap();
    assert!(!ext.written_files.is_empty());
    assert_eq!(
        fs::read(extracted_ws.join("manifest.json")).unwrap(),
        orig_manifest
    );
    assert_eq!(
        fs::read(extracted_ws.join("data/session-data.js")).unwrap(),
        orig_session
    );
    assert_eq!(
        fs::read(extracted_ws.join("media/recording.webm")).unwrap(),
        orig_media
    );

    match prev_ws {
        Some(v) => std::env::set_var("BUG_LENS_CLI_WORKSPACE", v),
        None => std::env::remove_var("BUG_LENS_CLI_WORKSPACE"),
    }
    let _ = fs::remove_dir_all(&temp_root);
}

#[test]
fn test_workspace_cache_self_healing_and_read_pack_file_pagination() {
    let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let temp_root = make_temp_dir("bug-lens-rust-heal");
    let ws_dir = temp_root.join("ws");

    let prev_ws = std::env::var("BUG_LENS_CLI_WORKSPACE").ok();
    std::env::set_var("BUG_LENS_CLI_WORKSPACE", &ws_dir);

    // 构造一个包含 30000 字符网络响应体的合法包
    let long_body = "x".repeat(30_000);
    let session_json = json!({
        "summary": { "title": "Heal Test", "url": "https://example.com", "durationMs": 1000 },
        "session": { "id": "heal0001-0000-0000-0000-000000000001", "schemaVersion": 4, "timeline": { "startedAtEpochMs": 1700000000000_u64, "durationMs": 1000 } },
        "interactions": [],
        "consoleEntries": [],
        "networkEntries": [],
        "issueScenes": [],
        "frameworkStates": []
    });
    let session_js = format!("window.__BUG_LENS_DATA__ = {session_json};\n");
    let manifest_json = json!({
        "format": "bug-lens-evidence-pack",
        "schemaVersion": 4,
        "sessionId": "heal0001-0000-0000-0000-000000000001",
        "files": {
            "data/session-data.js": {
                "byteLength": session_js.len(),
                "sha256": sha256_hex(session_js.as_bytes())
            },
            "network/long.txt": {
                "byteLength": long_body.len(),
                "sha256": sha256_hex(long_body.as_bytes())
            }
        }
    })
    .to_string();
    let zip_bytes = build_zip(&[
        ("manifest.json", manifest_json.as_bytes()),
        ("data/session-data.js", session_js.as_bytes()),
        ("network/long.txt", long_body.as_bytes()),
    ]);
    let zip_path = temp_root.join("heal.zip");
    fs::write(&zip_path, &zip_bytes).unwrap();

    // 1. 首次解包
    let loaded1 = open_pack(Some(&zip_path.to_string_lossy())).unwrap();
    let extracted_ws = PathBuf::from(get_pack_workspace_dir(&loaded1).unwrap());
    assert!(extracted_ws.join("INDEX.md").exists());
    assert!(extracted_ws.join("data/session-data.json").exists());

    // 2. 模拟工作区缓存受损：删除 INDEX.md、删除派生 JSON、清空 session-data.js
    fs::remove_file(extracted_ws.join("INDEX.md")).unwrap();
    fs::remove_file(extracted_ws.join("data/session-data.json")).unwrap();
    fs::write(extracted_ws.join("data/session-data.js"), "corrupted").unwrap();

    // 3. 重新对原 ZIP 执行 open_pack，应触发完整性自愈重解
    let loaded2 = open_pack(Some(&zip_path.to_string_lossy())).unwrap();
    let LoadedPack::Session(s2) = &loaded2 else {
        panic!("expected session pack");
    };
    assert!(s2.integrity.valid, "self-healed workspace must pass integrity check");
    assert!(extracted_ws.join("INDEX.md").exists());
    assert!(extracted_ws.join("data/session-data.json").exists());
    assert_eq!(
        fs::read_to_string(extracted_ws.join("data/session-data.js")).unwrap(),
        session_js
    );

    // 4. 验证 read_pack_file 在 --maxChars 100（<=200 回退到 24000）时 offset 提示与实际输出精确对齐（零漏字）
    let chunk1 = run_triage_cli(&[
        "read_pack_file".to_string(),
        "network/long.txt".to_string(),
        "--maxChars".to_string(),
        "100".to_string(),
    ])
    .unwrap();
    assert!(chunk1.contains("Truncated to 24000 chars"));
    assert!(chunk1.chars().count() <= 24_000);
    let (body1, footer1) = chunk1.split_once("\n\n… [Truncated to ").unwrap();
    let marker = "Use offset=";
    let off_start = footer1.find(marker).expect("next offset marker") + marker.len();
    let off_end = footer1[off_start..].find(' ').unwrap() + off_start;
    let next_offset: usize = footer1[off_start..off_end].parse().unwrap();
    assert!(next_offset > 23_500 && next_offset < 24_000);
    assert_eq!(body1.len(), next_offset);

    let chunk2 = run_triage_cli(&[
        "read_pack_file".to_string(),
        "network/long.txt".to_string(),
        "--offset".to_string(),
        next_offset.to_string(),
    ])
    .unwrap();
    assert_eq!(body1.len() + chunk2.len(), 30_000);
    assert_eq!(format!("{body1}{chunk2}"), long_body);

    match prev_ws {
        Some(v) => std::env::set_var("BUG_LENS_CLI_WORKSPACE", v),
        None => std::env::remove_var("BUG_LENS_CLI_WORKSPACE"),
    }
    let _ = fs::remove_dir_all(&temp_root);
}

#[test]
fn test_arg_parsing_strict_json_and_lossless_extension_fields() {
    let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let temp_root = make_temp_dir("bug-lens-rust-json");
    let ws_dir = temp_root.join("ws");

    let prev_ws = std::env::var("BUG_LENS_CLI_WORKSPACE").ok();
    std::env::set_var("BUG_LENS_CLI_WORKSPACE", &ws_dir);

    let body_bytes = br#"{"query":"delay=0sec","id":"ssd_a","nested":{"count":42}}"#;
    let dummy_png: &[u8] = &[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x01];
    let session_json = json!({
        "summary": { "title": "JSON & Parser Test", "url": "https://example.com/build?delay=0sec", "durationMs": 5000 },
        "session": {
            "id": "json0001-0000-0000-0000-000000000001",
            "schemaVersion": 4,
            "timeline": { "startedAtEpochMs": 1700000000000_u64, "durationMs": 5000 }
        },
        "interactions": [{
            "id": "int-1",
            "kind": "click",
            "createdAt": 1700000002000_u64,
            "confirmedAt": 1700000002050_u64,
            "customHint": "preserved-interaction",
            "screenshot": { "dataUrl": "screenshots/step-1.png" },
            "element": { "tagName": "button", "id": "submit", "text": "Build" }
        }],
        "consoleEntries": [{
            "id": "con-1",
            "createdAt": 1700000002500_u64,
            "level": "error",
            "text": "Console error around scene",
            "executionContextId": 7
        }],
        "networkEntries": [{
            "id": "85673.432",
            "createdAt": 1700000002200_u64,
            "url": "https://api.example.com/job/build?delay=0sec",
            "method": "POST",
            "type": "xhr",
            "status": 500,
            "durationMs": 120,
            "encodedDataLength": 9876,
            "frameId": "FRAME-ROOT-1",
            "response": {
                "mimeType": "application/json",
                "bodyStatus": "captured",
                "byteLength": body_bytes.len(),
                "bodyPath": "network/body-85673.432.txt"
            }
        }],
        "issueScenes": [{
            "id": "scene-1",
            "scene": {
                "id": "scene-1",
                "observedAtEpochMs": 1700000003000_u64,
                "narrative": { "actual": "点击构建无响应" },
                "targets": [{ "element": { "tagName": "button", "id": "submit" } }]
            },
            "annotatedSource": "screenshots/scene-1-annotated.png"
        }],
        "frameworkStates": []
    });
    let session_js = format!("window.__BUG_LENS_DATA__ = {session_json};\n");
    let manifest_json = json!({
        "format": "bug-lens-evidence-pack",
        "schemaVersion": 4,
        "sessionId": "json0001-0000-0000-0000-000000000001",
        "files": {
            "data/session-data.js": { "byteLength": session_js.len(), "sha256": sha256_hex(session_js.as_bytes()) },
            "network/body-85673.432.txt": { "byteLength": body_bytes.len(), "sha256": sha256_hex(body_bytes) }
        }
    })
    .to_string();
    let zip_bytes = build_zip(&[
        ("manifest.json", manifest_json.as_bytes()),
        ("data/session-data.js", session_js.as_bytes()),
        ("network/body-85673.432.txt", body_bytes),
        ("screenshots/scene-1-annotated.png", dummy_png),
        ("screenshots/step-1.png", dummy_png),
    ]);
    let zip_path = temp_root.join("parser-json.zip");
    fs::write(&zip_path, &zip_bytes).unwrap();

    run_triage_cli(&[
        "open_pack".to_string(),
        zip_path.to_string_lossy().into_owned(),
    ])
    .unwrap();

    // 1. 布尔参数后紧跟位置参数，不得误吞 scene:1
    let tl_out = run_triage_cli(&[
        "timeline".to_string(),
        "--includeAllConsole".to_string(),
        "scene:1".to_string(),
    ])
    .unwrap();
    assert!(
        tl_out.contains("Around scene \"scene-1\""),
        "unexpected timeline output: {tl_out}"
    );

    // 2. 包含 `=` 的搜索词（非已知 flag）应作为位置查询词而不是参数覆盖
    let eq_search = run_triage_cli(&["search_pack".to_string(), "delay=0sec".to_string()]).unwrap();
    assert!(eq_search.contains("# Search Hits for \"delay=0sec\""));
    assert!(eq_search.contains("85673.432"));

    // 3. 未知 flag 不应吞掉紧随其后的位置参数
    let unknown_flag_net = run_triage_cli(&[
        "query_network".to_string(),
        "--apiOnly".to_string(),
        "delay=0sec".to_string(),
    ])
    .unwrap();
    assert!(unknown_flag_net.contains("85673.432"));

    // 4. 所有 --format json 路径（含附带图片、空集合、超预算截断）均为合法 JSON
    let trunc_json_str = run_triage_cli(&[
        "open_pack".to_string(),
        zip_path.to_string_lossy().into_owned(),
        "--format".to_string(),
        "json".to_string(),
        "--maxChars".to_string(),
        "300".to_string(),
    ])
    .unwrap();
    let trunc_json: Value = serde_json::from_str(&trunc_json_str).expect("truncated json must parse");
    assert_eq!(trunc_json["truncated"], json!(true));

    let scene_json_str = run_triage_cli(&[
        "get_scene".to_string(),
        "--includeImage".to_string(),
        "true".to_string(),
        "--format".to_string(),
        "json".to_string(),
    ])
    .unwrap();
    let scene_json: Value = serde_json::from_str(&scene_json_str).expect("get_scene json must parse");
    assert!(scene_json["savedImagePath"].as_str().unwrap_or("").contains("scene-1-annotated.png"));

    let int_json_str = run_triage_cli(&[
        "get_interactions".to_string(),
        "--includeScreenshot".to_string(),
        "true".to_string(),
        "--format".to_string(),
        "json".to_string(),
    ])
    .unwrap();
    let int_json: Value = serde_json::from_str(&int_json_str).expect("get_interactions json must parse");
    assert_eq!(int_json["items"][0]["item"]["confirmedAt"], json!(1700000002050_u64));
    assert_eq!(int_json["items"][0]["item"]["customHint"], json!("preserved-interaction"));
    assert!(int_json["exportedScreenshots"].as_array().is_some_and(|a| !a.is_empty()));
    // 整数时间戳不应序列化为带 .0 的浮点格式
    assert!(!int_json_str.contains("1700000002000.0"));

    let shot_json_str = run_triage_cli(&[
        "get_screenshot".to_string(),
        "--step".to_string(),
        "1".to_string(),
        "--format".to_string(),
        "json".to_string(),
    ])
    .unwrap();
    let shot_json: Value = serde_json::from_str(&shot_json_str).expect("get_screenshot json must parse");
    assert_eq!(shot_json["kind"], json!("step"));
    assert_eq!(shot_json["relativePath"], json!("screenshots/step-1.png"));

    let fw_empty_json_str = run_triage_cli(&[
        "get_framework_state".to_string(),
        "--format".to_string(),
        "json".to_string(),
    ])
    .unwrap();
    let fw_empty_json: Value =
        serde_json::from_str(&fw_empty_json_str).expect("empty get_framework_state json must parse");
    assert_eq!(fw_empty_json["totalStates"], json!(0));

    let req_json_str = run_triage_cli(&[
        "get_request".to_string(),
        "85673.432".to_string(),
        "--format".to_string(),
        "json".to_string(),
    ])
    .unwrap();
    let req_json: Value = serde_json::from_str(&req_json_str).expect("get_request json must parse");
    assert_eq!(req_json["entry"]["encodedDataLength"], json!(9876));
    assert_eq!(req_json["entry"]["frameId"], json!("FRAME-ROOT-1"));
    assert!(!req_json_str.contains("500.0"));

    match prev_ws {
        Some(v) => std::env::set_var("BUG_LENS_CLI_WORKSPACE", v),
        None => std::env::remove_var("BUG_LENS_CLI_WORKSPACE"),
    }
    let _ = fs::remove_dir_all(&temp_root);
}

#[test]
fn test_get_request_top_level_body_error_and_decoupled_include() {
    let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let temp_root = make_temp_dir("bug-lens-rust-reqbody");
    let ws_dir = temp_root.join("ws");
    let prev_ws = std::env::var("BUG_LENS_CLI_WORKSPACE").ok();
    std::env::set_var("BUG_LENS_CLI_WORKSPACE", &ws_dir);

    let session_json = json!({
        "summary": { "title": "Req Body Test", "url": "https://example.com", "durationMs": 3000 },
        "session": {
            "id": "reqbody01-0000-0000-0000-000000000001",
            "schemaVersion": 4,
            "timeline": { "startedAtEpochMs": 1700000000000_u64, "durationMs": 3000 }
        },
        "interactions": [],
        "consoleEntries": [],
        "networkEntries": [{
            "id": "req-1",
            "createdAt": 1700000001000_u64,
            "url": "https://api.example.com/submit",
            "method": "POST",
            "type": "xhr",
            "status": 200,
            "error": "net::ERR_CONNECTION_RESET",
            "requestBody": "{\"action\":\"create\",\"count\":2}",
            "response": { "mimeType": "application/json", "bodyStatus": "empty" }
        }],
        "issueScenes": [],
        "frameworkStates": []
    });
    let session_js = format!("window.__BUG_LENS_DATA__ = {session_json};\n");
    let zip_bytes = build_zip(&[("data/session-data.js", session_js.as_bytes())]);
    let zip_path = temp_root.join("reqbody.zip");
    fs::write(&zip_path, &zip_bytes).unwrap();

    run_triage_cli(&["open_pack".into(), zip_path.to_string_lossy().into_owned()]).unwrap();

    // 1. --include body（不含 headers）仍可输出顶层 requestBody，大小写不敏感
    let body_only = run_triage_cli(&[
        "get_request".into(),
        "req-1".into(),
        "--include".into(),
        "BODY".into(),
    ])
    .unwrap();
    assert!(body_only.contains("## Request Body"));
    assert!(body_only.contains("{\"action\":\"create\",\"count\":2}"));
    assert!(!body_only.contains("## Request Headers"));

    // 2. summary 展示顶层 entry.error，query_network --status failed 与 timeline 均判为失败
    let summary_out = run_triage_cli(&[
        "get_request".into(),
        "req-1".into(),
        "--include".into(),
        "summary".into(),
    ])
    .unwrap();
    assert!(summary_out.contains("net::ERR_CONNECTION_RESET"));

    let failed_net = run_triage_cli(&[
        "query_network".into(),
        "--status".into(),
        "failed".into(),
    ])
    .unwrap();
    assert!(failed_net.contains("req-1"));

    let tl_out = run_triage_cli(&["timeline".into()]).unwrap();
    assert!(tl_out.contains("!200"));

    match prev_ws {
        Some(v) => std::env::set_var("BUG_LENS_CLI_WORKSPACE", v),
        None => std::env::remove_var("BUG_LENS_CLI_WORKSPACE"),
    }
    let _ = fs::remove_dir_all(&temp_root);
}

#[test]
fn test_read_pack_file_multiline_pagination_is_lossless() {
    let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let temp_root = make_temp_dir("bug-lens-rust-page");
    let ws_dir = temp_root.join("ws");
    let prev_ws = std::env::var("BUG_LENS_CLI_WORKSPACE").ok();
    std::env::set_var("BUG_LENS_CLI_WORKSPACE", &ws_dir);

    let mut full_log = String::new();
    for i in 0..700 {
        full_log.push_str(&format!("line-{i:04}: payload-alpha-beta-gamma-中文日志\n"));
    }
    let session_json = json!({
        "summary": { "title": "Page", "url": "https://example.com", "durationMs": 1000 },
        "session": { "id": "page0001-0000-0000-0000-000000000001", "schemaVersion": 4, "timeline": { "startedAtEpochMs": 1700000000000_u64 } },
        "interactions": [],
        "consoleEntries": [],
        "networkEntries": [],
        "issueScenes": []
    });
    let session_js = format!("window.__BUG_LENS_DATA__ = {session_json};\n");
    let zip_bytes = build_zip(&[
        ("data/session-data.js", session_js.as_bytes()),
        ("network/multiline.txt", full_log.as_bytes()),
    ]);
    let zip_path = temp_root.join("page.zip");
    fs::write(&zip_path, &zip_bytes).unwrap();
    run_triage_cli(&["open_pack".into(), zip_path.to_string_lossy().into_owned()]).unwrap();

    let mut reassembled = String::new();
    let mut offset = 0usize;
    for _ in 0..10 {
        let out = run_triage_cli(&[
            "read_pack_file".into(),
            "network/multiline.txt".into(),
            "--offset".into(),
            offset.to_string(),
        ])
        .unwrap();
        if let Some((body, footer)) = out.split_once("\n\n… [Truncated to ") {
            reassembled.push_str(body);
            let marker = "Use offset=";
            let start = footer.find(marker).expect("next offset marker") + marker.len();
            let end = footer[start..].find(' ').unwrap() + start;
            offset = footer[start..end].parse::<usize>().unwrap();
        } else {
            reassembled.push_str(&out);
            break;
        }
    }
    assert_eq!(reassembled, full_log);

    match prev_ws {
        Some(v) => std::env::set_var("BUG_LENS_CLI_WORKSPACE", v),
        None => std::env::remove_var("BUG_LENS_CLI_WORKSPACE"),
    }
    let _ = fs::remove_dir_all(&temp_root);
}

#[test]
fn test_zip_bomb_entry_count_duplicate_collision_and_corrupt_manifest() {
    let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let temp_root = make_temp_dir("bug-lens-rust-sec");
    let ws_dir = temp_root.join("ws");
    let prev_ws = std::env::var("BUG_LENS_CLI_WORKSPACE").ok();
    std::env::set_var("BUG_LENS_CLI_WORKSPACE", &ws_dir);

    // 1. 超过 20,000 条目的 ZIP 必须被拦截
    let mut cursor = Cursor::new(Vec::new());
    {
        let mut writer = ZipWriter::new(&mut cursor);
        let opts = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
        for i in 0..20_005 {
            writer.start_file(format!("e/{i}"), opts).unwrap();
        }
        writer.finish().unwrap();
    }
    let err_count = open_pack_from_bytes(&cursor.into_inner(), "/tmp/many.zip")
        .expect_err("should reject >20000 entries");
    assert!(err_count.to_string().contains("ZIP_BOMB_ENTRY_COUNT_EXCEEDED"));

    // 2. 路径清洗碰撞（a:b.txt 与 a_b.txt）必须被拒绝
    let session_js = b"window.__BUG_LENS_DATA__ = {};\n";
    let collision_zip = build_zip(&[
        ("data/session-data.js", session_js),
        ("network/a:b.txt", b"first"),
        ("network/a_b.txt", b"second"),
    ]);
    let collision_path = temp_root.join("collision.zip");
    fs::write(&collision_path, &collision_zip).unwrap();
    let err_collision = open_pack(Some(&collision_path.to_string_lossy()))
        .expect_err("should reject sanitized collision");
    assert!(err_collision.to_string().contains("UNSAFE_ZIP_DUPLICATE_ENTRY"));

    // 3. 损坏 manifest.json 必须返回 valid=false，不得静默跳过完整性校验
    let corrupt_manifest_zip = build_zip(&[
        ("manifest.json", b"{not valid json"),
        ("data/session-data.js", session_js),
    ]);
    let loaded = open_pack_from_bytes(&corrupt_manifest_zip, "/tmp/corrupt-manifest.zip").unwrap();
    let LoadedPack::Session(s) = loaded else {
        panic!("expected session");
    };
    assert!(s.integrity.has_manifest);
    assert!(!s.integrity.valid);
    assert!(!s.integrity.mismatches.is_empty());

    match prev_ws {
        Some(v) => std::env::set_var("BUG_LENS_CLI_WORKSPACE", v),
        None => std::env::remove_var("BUG_LENS_CLI_WORKSPACE"),
    }
    let _ = fs::remove_dir_all(&temp_root);
}

#[test]
fn test_cli_edge_cases_overflow_css_var_json_query_and_framework_children() {
    let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let temp_root = make_temp_dir("bug-lens-rust-edges");
    let ws_dir = temp_root.join("ws");
    let prev_ws = std::env::var("BUG_LENS_CLI_WORKSPACE").ok();
    std::env::set_var("BUG_LENS_CLI_WORKSPACE", &ws_dir);

    let session_json = json!({
        "summary": { "title": "Edge Pack", "url": "https://example.com", "durationMs": 5000 },
        "session": { "id": "edge0001-0000-0000-0000-000000000001", "schemaVersion": 4, "timeline": { "startedAtEpochMs": 1700000000000_u64 } },
        "interactions": [],
        "consoleEntries": [{
            "id": "c1",
            "createdAt": 1700000001000_u64,
            "level": "error",
            "text": "Error payload {\"code\":500} and {error and --help and --bg-color"
        }],
        "networkEntries": [],
        "issueScenes": [{
            "id": "scene-1",
            "scene": { "id": "scene-1", "observedAtEpochMs": 1700000002000_u64, "narrative": { "actual": "ok" } }
        }],
        "frameworkStates": [{
            "capturedAtEpochMs": 1700000002000_u64,
            "trigger": "interaction",
            "snapshot": {
                "rootComponent": {
                    "framework": "vue",
                    "componentName": "RootShell",
                    "children": [{
                        "framework": "vue",
                        "componentName": "DeepChildDialog",
                        "state": { "open": true }
                    }]
                },
                "parentChain": []
            }
        }]
    });
    let session_js = format!("window.__BUG_LENS_DATA__ = {session_json};\n");
    let zip_bytes = build_zip(&[
        ("data/session-data.js", session_js.as_bytes()),
        ("network/small.txt", b"hello"),
    ]);
    let zip_path = temp_root.join("edges.zip");
    fs::write(&zip_path, &zip_bytes).unwrap();
    run_triage_cli(&["open_pack".into(), zip_path.to_string_lossy().into_owned()]).unwrap();

    // 1. 极端 --offset 1e30 与 scene:-9223372036854775808 不得 panic
    let _ = run_triage_cli(&[
        "read_pack_file".into(),
        "network/small.txt".into(),
        "--offset".into(),
        "1e30".into(),
    ])
    .unwrap();
    let _ = run_triage_cli(&[
        "timeline".into(),
        "--aroundSceneId".into(),
        "scene:-9223372036854775808".into(),
    ])
    .unwrap();

    // 2. 以 `{` 开头的 search_pack 查询词与 `-- --help` 不得被误吞或误判帮助
    let json_query_hit = run_triage_cli(&["search_pack".into(), "{\"code\":500}".into()]).unwrap();
    assert!(json_query_hit.contains("console#0"));
    let broken_brace_hit = run_triage_cli(&["search_pack".into(), "{error".into()]).unwrap();
    assert!(broken_brace_hit.contains("console#0"));
    let help_literal_hit = run_triage_cli(&["search_pack".into(), "--".into(), "--help".into()]).unwrap();
    assert!(help_literal_hit.contains("console#0"));

    // 3. CSS 自定义属性 `--bg-color` 可作为 value flag 值传入
    let css_var_out = run_triage_cli(&[
        "search_pack".into(),
        "--query".into(),
        "--bg-color".into(),
    ])
    .unwrap();
    assert!(css_var_out.contains("console#0"));

    // 4. get_framework_state 递归遍历 children 且 --format json 支持 --component 过滤
    let fw_json_str = run_triage_cli(&[
        "get_framework_state".into(),
        "--component".into(),
        "DeepChildDialog".into(),
        "--format".into(),
        "json".into(),
    ])
    .unwrap();
    let fw_json: Value = serde_json::from_str(&fw_json_str).unwrap();
    assert_eq!(fw_json["matchedComponents"][0]["componentName"], json!("DeepChildDialog"));
    assert_eq!(fw_json["overview"][0]["components"], json!(["DeepChildDialog"]));

    match prev_ws {
        Some(v) => std::env::set_var("BUG_LENS_CLI_WORKSPACE", v),
        None => std::env::remove_var("BUG_LENS_CLI_WORKSPACE"),
    }
    let _ = fs::remove_dir_all(&temp_root);
}

#[test]
fn test_concurrent_open_pack_does_not_clobber_workspace() {
    let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let temp_root = make_temp_dir("bug-lens-rust-concurrent");
    let ws_dir = temp_root.join("ws");
    let prev_ws = std::env::var("BUG_LENS_CLI_WORKSPACE").ok();
    std::env::set_var("BUG_LENS_CLI_WORKSPACE", &ws_dir);

    let zip_bytes = build_minimal_session_zip(4, false, false, false);
    let zip_path = temp_root.join("concurrent.zip");
    fs::write(&zip_path, &zip_bytes).unwrap();
    let zip_str = zip_path.to_string_lossy().into_owned();

    let handles: Vec<_> = (0..6)
        .map(|_| {
            let zp = zip_str.clone();
            std::thread::spawn(move || open_pack(Some(&zp)).map(|p| p.pack_path().to_string()))
        })
        .collect();

    for h in handles {
        let p = h.join().expect("thread should not panic").expect("open_pack should succeed");
        assert!(Path::new(&p).join("INDEX.md").exists());
        assert!(Path::new(&p).join("data/session-data.json").exists());
    }

    match prev_ws {
        Some(v) => std::env::set_var("BUG_LENS_CLI_WORKSPACE", v),
        None => std::env::remove_var("BUG_LENS_CLI_WORKSPACE"),
    }
    let _ = fs::remove_dir_all(&temp_root);
}
