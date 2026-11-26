//! 会话录制证据包（`web-bug-report-*.zip`）内存视图与懒加载访问封装。

use crate::pack::js_json::parse_window_assignment_json;
use crate::pack::storage::PackStorage;
use crate::pack::types::{
    ConsoleEntry, ExportManifest, FrameworkStateEntry, IntegrityReport, InteractionEntry,
    IssueSceneObject, NetworkDetailEntry, NetworkEntry, PackFileEntryInfo, SessionDataPayload,
    SkippedMediaInfo,
};
use indexmap::IndexMap;
use std::collections::BTreeMap;
use std::sync::OnceLock;

#[derive(Debug, Clone)]
pub struct NormalizedIssueScene {
    pub id: String,
    pub index: usize,
    pub scene: IssueSceneObject,
    pub original_source: Option<String>,
    pub annotated_source: Option<String>,
}

#[derive(Debug)]
pub struct LoadedSessionPack {
    pub pack_path: String,
    pub manifest: Option<ExportManifest>,
    pub integrity: IntegrityReport,
    pub data: SessionDataPayload,
    pub t0_epoch_ms: f64,
    pub storage: PackStorage,
    pub skipped_media_files: BTreeMap<String, SkippedMediaInfo>,
    network_details_cache: OnceLock<IndexMap<String, NetworkDetailEntry>>,
}

impl LoadedSessionPack {
    pub fn new(
        pack_path: String,
        manifest: Option<ExportManifest>,
        integrity: IntegrityReport,
        data: SessionDataPayload,
        storage: PackStorage,
        skipped_media_files: BTreeMap<String, SkippedMediaInfo>,
    ) -> Self {
        let timeline = data.session.as_ref().and_then(|s| s.timeline.as_ref());
        let first_interaction_time = data
            .interactions
            .as_ref()
            .and_then(|list| list.first())
            .and_then(|i| i.created_at);
        let t0_epoch_ms = timeline
            .and_then(|t| t.started_at_epoch_ms)
            .or_else(|| timeline.and_then(|t| t.created_at_epoch_ms))
            .or(first_interaction_time)
            .unwrap_or(0.0);

        Self {
            pack_path,
            manifest,
            integrity,
            data,
            t0_epoch_ms,
            storage,
            skipped_media_files,
            network_details_cache: OnceLock::new(),
        }
    }

    pub fn session_id(&self) -> &str {
        if let Some(id) = self.data.session.as_ref().and_then(|s| s.id.as_deref()) {
            return id;
        }
        if let Some(id) = self.manifest.as_ref().and_then(|m| m.session_id.as_deref()) {
            return id;
        }
        if let Some(id) = self
            .data
            .interactions
            .as_ref()
            .and_then(|v| v.first())
            .and_then(|i| i.session_id.as_deref())
        {
            return id;
        }
        "unknown"
    }

    pub fn to_relative_ms(&self, epoch_ms: Option<f64>) -> Option<f64> {
        let v = epoch_ms?;
        if !v.is_finite() {
            return None;
        }
        if self.t0_epoch_ms <= 0.0 {
            Some(v)
        } else {
            Some(v - self.t0_epoch_ms)
        }
    }

    pub fn to_epoch_ms(&self, relative_ms: f64) -> f64 {
        self.t0_epoch_ms + relative_ms
    }

    pub fn get_console_entries(&self) -> &[ConsoleEntry] {
        self.data
            .console_entries
            .as_deref()
            .or(self.data.console_logs.as_deref())
            .unwrap_or(&[])
    }

    pub fn get_interactions(&self) -> &[InteractionEntry] {
        self.data.interactions.as_deref().unwrap_or(&[])
    }

    pub fn get_network_entries(&self) -> &[NetworkEntry] {
        self.data.network_entries.as_deref().unwrap_or(&[])
    }

    pub fn get_framework_states(&self) -> &[FrameworkStateEntry] {
        self.data.framework_states.as_deref().unwrap_or(&[])
    }

    pub fn get_issue_scenes(&self) -> Vec<NormalizedIssueScene> {
        let raw_list = self.data.issue_scenes.as_deref().unwrap_or(&[]);
        raw_list
            .iter()
            .enumerate()
            .map(|(index, item)| {
                let scene = item.scene.clone().unwrap_or_else(|| IssueSceneObject {
                    id: item.id.clone(),
                    narrative: item.narrative.clone(),
                    sequence_context: item.sequence_context.clone(),
                    target: item.target.clone(),
                    targets: item.targets.clone(),
                    ..Default::default()
                });
                let id = scene
                    .id
                    .clone()
                    .or_else(|| item.id.clone())
                    .unwrap_or_else(|| format!("scene-{}", index + 1));
                let original_source = item
                    .original_source
                    .clone()
                    .or_else(|| self.find_scene_image_path(&id, "original"));
                let annotated_source = item
                    .annotated_source
                    .clone()
                    .or_else(|| self.find_scene_image_path(&id, "annotated"));
                NormalizedIssueScene {
                    id,
                    index,
                    scene,
                    original_source,
                    annotated_source,
                }
            })
            .collect()
    }

    fn find_scene_image_path(&self, scene_id: &str, variant: &str) -> Option<String> {
        for ext in ["jpg", "png", "jpeg", "webp"] {
            let candidate = format!("issues/{scene_id}/screenshot-{variant}.{ext}");
            if self.storage.has(&candidate) {
                return Some(candidate);
            }
        }
        None
    }

    pub fn get_network_details(&self) -> &IndexMap<String, NetworkDetailEntry> {
        self.network_details_cache.get_or_init(|| {
            let Some(raw) = self.storage.read_text("data/network-details.js") else {
                return IndexMap::new();
            };
            let Ok(raw_map) = parse_window_assignment_json::<IndexMap<String, serde_json::Value>>(
                &raw,
                "data/network-details.js",
            ) else {
                return IndexMap::new();
            };
            let mut out = IndexMap::with_capacity(raw_map.len());
            for (k, v) in raw_map {
                if let Ok(entry) = serde_json::from_value::<NetworkDetailEntry>(v) {
                    out.insert(k, entry);
                }
            }
            out
        })
    }

    pub fn get_network_body(&self, entry: &NetworkEntry) -> Option<String> {
        if let Some(body) = entry.response.as_ref().and_then(|r| r.body.as_ref()) {
            return Some(body.clone());
        }
        if let Some(body_path) = entry.response.as_ref().and_then(|r| r.body_path.as_deref()) {
            if let Some(text) = self.get_text_file(body_path) {
                return Some(text);
            }
        }
        let safe_file_id: String = entry
            .id
            .chars()
            .map(|c| {
                if c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-') {
                    c
                } else {
                    '_'
                }
            })
            .collect();
        self.get_text_file(&format!("network/body-{safe_file_id}.txt"))
            .or_else(|| self.get_text_file(&format!("network/body-{}.txt", entry.id)))
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
