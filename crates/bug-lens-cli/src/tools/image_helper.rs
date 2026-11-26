//! 截图文件定位与导出辅助模块：优先复用解压工作区内已落盘图片，避免额外内存拷贝。

use crate::pack::open::{
    get_pack_workspace_dir, get_triage_workspace_dir, sanitize_relative_path_for_disk,
};
use crate::pack::LoadedPack;
use std::fs;
use std::path::PathBuf;

/// 内联图片体积阈值（1.5 MB），超过后直接提示通过文件路径查看。
pub const MAX_INLINE_IMAGE_BYTES: u64 = 1_572_864;

/// 按文件扩展名推断图片 MIME 类型。
pub fn infer_image_mime_type(file_path: &str) -> &'static str {
    let lower = file_path.to_lowercase();
    if lower.ends_with(".png") {
        "image/png"
    } else if lower.ends_with(".webp") {
        "image/webp"
    } else if lower.ends_with(".gif") {
        "image/gif"
    } else {
        "image/jpeg"
    }
}

/// 定位证据包内的图片文件真实路径；若为纯内存包则导出至工作区临时目录。
pub fn export_pack_image_to_temp(pack: &LoadedPack, rel_path: &str) -> Option<String> {
    pack.get_file_byte_length(rel_path)?;
    let (sanitized, _) = sanitize_relative_path_for_disk(rel_path).ok()?;

    // 解压工作区模式：图片已在磁盘上，直接返回真实路径，零拷贝
    if let Some(workspace_dir) = get_pack_workspace_dir(pack) {
        let mut in_workspace = PathBuf::from(&workspace_dir);
        for seg in sanitized.split('/') {
            in_workspace.push(seg);
        }
        if in_workspace.exists() {
            return Some(in_workspace.to_string_lossy().into_owned());
        }
    }

    // 内存加载模式：回退写入工作区 images 子目录
    let bytes = pack.get_binary_file(rel_path)?;
    let pack_prefix = match pack {
        LoadedPack::Session(s) => {
            let p: String = s.session_id().chars().take(8).collect();
            if p.is_empty() {
                "session".to_string()
            } else {
                p
            }
        }
        LoadedPack::Screenshot(_) => "screenshot".to_string(),
    };

    let mut dest_path = get_triage_workspace_dir().join("images").join(pack_prefix);
    for seg in sanitized.split('/') {
        dest_path.push(seg);
    }
    if let Some(parent) = dest_path.parent() {
        fs::create_dir_all(parent).ok()?;
    }
    fs::write(&dest_path, bytes).ok()?;
    Some(dest_path.to_string_lossy().into_owned())
}

/// 构造 CLI 文本输出所需的图片描述块（CLI 仅输出文本路径提示，不输出 base64 噪音）。
pub fn build_image_text_blocks(
    pack: &LoadedPack,
    rel_path: &str,
    label: Option<&str>,
) -> Vec<String> {
    let Some(byte_len) = pack.get_file_byte_length(rel_path) else {
        return vec![format!("[Image not found in pack: {rel_path}]")];
    };

    let mime_type = infer_image_mime_type(rel_path);
    let size_kb = format!("{:.1}", (byte_len as f64) / 1024.0);
    let saved_path = export_pack_image_to_temp(pack, rel_path);

    if byte_len > MAX_INLINE_IMAGE_BYTES {
        let msg = match saved_path {
            Some(p) => format!(
                "[Image \"{rel_path}\" ({size_kb} KB) saved to: {p} — call read_file on this path to view it directly]"
            ),
            None => format!(
                "[Image \"{rel_path}\" ({size_kb} KB) exceeds inline size limit (1.5 MB) and could not be located on disk.]"
            ),
        };
        return vec![msg];
    }

    let path_notice = match saved_path {
        Some(p) => format!(" -> Saved to: {p}"),
        None => String::new(),
    };
    let offload_hint =
        " (Tip: call read_file on the saved image path to view the visual image directly)";

    match label {
        Some(lbl) if !lbl.is_empty() => vec![format!(
            "{lbl} ({rel_path}, {size_kb} KB, {mime_type}){path_notice}{offload_hint}"
        )],
        _ => Vec::new(),
    }
}
