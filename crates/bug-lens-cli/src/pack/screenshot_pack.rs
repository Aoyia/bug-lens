//! 截图批注证据包（`bug-lens-screenshot-*.zip`）视图封装。

use crate::pack::storage::PackStorage;
use crate::pack::types::{
    CascadeIndex, ExportManifest, IntegrityReport, PackFileEntryInfo, ScreenshotDomContext,
    ScreenshotEnvironment, SkippedMediaInfo,
};
use std::collections::BTreeMap;

#[derive(Debug)]
pub struct LoadedScreenshotPack {
    pub pack_path: String,
    pub manifest: Option<ExportManifest>,
    pub integrity: IntegrityReport,
    pub dom_context: Option<ScreenshotDomContext>,
    pub environment: Option<ScreenshotEnvironment>,
    pub cascade: Option<CascadeIndex>,
    pub ai_prompt: Option<String>,
    pub storage: PackStorage,
    pub skipped_media_files: BTreeMap<String, SkippedMediaInfo>,
}

impl LoadedScreenshotPack {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        pack_path: String,
        manifest: Option<ExportManifest>,
        integrity: IntegrityReport,
        dom_context: Option<ScreenshotDomContext>,
        environment: Option<ScreenshotEnvironment>,
        cascade: Option<CascadeIndex>,
        ai_prompt: Option<String>,
        storage: PackStorage,
        skipped_media_files: BTreeMap<String, SkippedMediaInfo>,
    ) -> Self {
        Self {
            pack_path,
            manifest,
            integrity,
            dom_context,
            environment,
            cascade,
            ai_prompt,
            storage,
            skipped_media_files,
        }
    }

    pub fn get_screenshot_image_path(&self) -> Option<&'static str> {
        [
            "screenshot.jpg",
            "screenshot.png",
            "screenshot.jpeg",
            "screenshot.webp",
        ]
        .into_iter()
        .find(|&candidate| self.storage.has(candidate))
    }

    pub fn get_text_file(&self, file_path: &str) -> Option<String> {
        self.storage.read_text(file_path)
    }

    pub fn get_binary_file(&self, file_path: &str) -> Option<Vec<u8>> {
        self.storage.read_bytes(file_path)
    }

    pub fn list_files(&self) -> Vec<PackFileEntryInfo> {
        let mut list: Vec<PackFileEntryInfo> = self
            .storage
            .iter_entries()
            .into_iter()
            .map(|(path, byte_length)| PackFileEntryInfo {
                path,
                byte_length,
                skipped_media: None,
            })
            .collect();
        for (path, info) in &self.skipped_media_files {
            list.push(PackFileEntryInfo {
                path: path.clone(),
                byte_length: info.original_size,
                skipped_media: Some(true),
            });
        }
        list.sort_by(|a, b| a.path.cmp(&b.path));
        list
    }
}
