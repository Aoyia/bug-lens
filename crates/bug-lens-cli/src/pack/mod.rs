pub mod index_writer;
pub mod js_json;
pub mod manifest;
pub mod open;
pub mod screenshot_pack;
pub mod session_pack;
pub mod storage;
pub mod types;

use screenshot_pack::LoadedScreenshotPack;
use session_pack::LoadedSessionPack;
use std::collections::BTreeMap;
use types::{PackFileEntryInfo, SkippedMediaInfo};

#[derive(Debug)]
pub enum LoadedPack {
    Session(Box<LoadedSessionPack>),
    Screenshot(Box<LoadedScreenshotPack>),
}

impl LoadedPack {
    pub fn pack_path(&self) -> &str {
        match self {
            LoadedPack::Session(p) => &p.pack_path,
            LoadedPack::Screenshot(p) => &p.pack_path,
        }
    }

    pub fn is_session(&self) -> bool {
        matches!(self, LoadedPack::Session(_))
    }

    pub fn has_file(&self, rel_path: &str) -> bool {
        match self {
            LoadedPack::Session(p) => p.storage.has(rel_path),
            LoadedPack::Screenshot(p) => p.storage.has(rel_path),
        }
    }

    pub fn get_text_file(&self, rel_path: &str) -> Option<String> {
        match self {
            LoadedPack::Session(p) => p.get_text_file(rel_path),
            LoadedPack::Screenshot(p) => p.get_text_file(rel_path),
        }
    }

    pub fn get_binary_file(&self, rel_path: &str) -> Option<Vec<u8>> {
        match self {
            LoadedPack::Session(p) => p.get_binary_file(rel_path),
            LoadedPack::Screenshot(p) => p.get_binary_file(rel_path),
        }
    }

    pub fn get_file_byte_length(&self, rel_path: &str) -> Option<u64> {
        match self {
            LoadedPack::Session(p) => p.storage.byte_length(rel_path),
            LoadedPack::Screenshot(p) => p.storage.byte_length(rel_path),
        }
    }

    pub fn list_files(&self) -> Vec<PackFileEntryInfo> {
        match self {
            LoadedPack::Session(p) => p.list_files(),
            LoadedPack::Screenshot(p) => p.list_files(),
        }
    }

    pub fn skipped_media_files(&self) -> &BTreeMap<String, SkippedMediaInfo> {
        match self {
            LoadedPack::Session(p) => &p.skipped_media_files,
            LoadedPack::Screenshot(p) => &p.skipped_media_files,
        }
    }

    pub fn storage(&self) -> &storage::PackStorage {
        match self {
            LoadedPack::Session(p) => &p.storage,
            LoadedPack::Screenshot(p) => &p.storage,
        }
    }
}
