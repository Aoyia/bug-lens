//! 证据包 `manifest.json` Schema 版本校验与流式 SHA-256 完整性校验。

use crate::pack::storage::PackStorage;
use crate::pack::types::{ExportManifest, IntegrityReport};
use std::collections::HashSet;

pub const SUPPORTED_SCHEMA_VERSIONS: [u64; 4] = [1, 2, 3, 4];
pub const MAX_SUPPORTED_SCHEMA_VERSION: u64 = 4;

#[derive(Debug, Clone)]
pub enum ManifestParseResult {
    Missing,
    Valid(ExportManifest),
    Corrupt(String),
}

pub fn parse_manifest_result(raw_bytes: Option<&[u8]>) -> ManifestParseResult {
    let Some(bytes) = raw_bytes else {
        return ManifestParseResult::Missing;
    };
    let trimmed = std::str::from_utf8(bytes)
        .map(|s| s.trim_start_matches('\u{FEFF}').as_bytes())
        .unwrap_or(bytes);
    match serde_json::from_slice::<ExportManifest>(trimmed) {
        Ok(m) => ManifestParseResult::Valid(m),
        Err(err) => ManifestParseResult::Corrupt(err.to_string()),
    }
}

pub fn parse_manifest(raw_bytes: Option<&[u8]>) -> Option<ExportManifest> {
    match parse_manifest_result(raw_bytes) {
        ManifestParseResult::Valid(m) => Some(m),
        _ => None,
    }
}

pub fn verify_pack_integrity_result(
    manifest_res: &ManifestParseResult,
    storage: &PackStorage,
    skipped_files: &HashSet<String>,
) -> IntegrityReport {
    match manifest_res {
        ManifestParseResult::Missing => verify_pack_integrity(None, storage, skipped_files),
        ManifestParseResult::Corrupt(err) => IntegrityReport {
            has_manifest: true,
            valid: false,
            schema_version: None,
            schema_warning: None,
            checked_count: 0,
            skipped_count: skipped_files.len(),
            mismatches: vec![format!("manifest.json: corrupt or invalid ({err})")],
        },
        ManifestParseResult::Valid(manifest) => {
            verify_pack_integrity(Some(manifest), storage, skipped_files)
        }
    }
}

pub fn verify_pack_integrity(
    manifest: Option<&ExportManifest>,
    storage: &PackStorage,
    skipped_files: &HashSet<String>,
) -> IntegrityReport {
    let Some(manifest) = manifest else {
        return IntegrityReport {
            has_manifest: false,
            valid: true,
            schema_version: None,
            schema_warning: None,
            checked_count: 0,
            skipped_count: skipped_files.len(),
            mismatches: Vec::new(),
        };
    };

    let schema_version = manifest.schema_version;
    let schema_warning = schema_version.and_then(|sv| {
        if SUPPORTED_SCHEMA_VERSIONS.contains(&sv) {
            None
        } else if sv > MAX_SUPPORTED_SCHEMA_VERSION {
            Some(format!(
                "Package schemaVersion ({sv}) is newer than max supported version ({MAX_SUPPORTED_SCHEMA_VERSION}). Reading in best-effort mode; please run 'npx skills update bug-lens-triage' if fields are missing."
            ))
        } else {
            Some(format!(
                "Package schemaVersion ({sv}) is not in standard supported list (1, 2, 3, 4). Reading in best-effort mode."
            ))
        }
    });

    let mut checked_count = 0usize;
    let mut skipped_count = 0usize;
    let mut mismatches = Vec::new();

    if let Some(manifest_files) = &manifest.files {
        for (file_path, expected) in manifest_files {
            if skipped_files.contains(file_path) {
                skipped_count += 1;
                continue;
            }
            let Some(actual_len) = storage.byte_length(file_path) else {
                mismatches.push(format!("{file_path}: missing in archive"));
                continue;
            };
            checked_count += 1;
            if let Some(exp_len) = expected.byte_length {
                if actual_len != exp_len {
                    mismatches.push(format!(
                        "{file_path}: byteLength mismatch (expected {exp_len}, got {actual_len})"
                    ));
                    continue;
                }
            }
            if let Some(exp_hash) = expected.sha256.as_deref().filter(|s| !s.is_empty()) {
                match storage.sha256_hex(file_path) {
                    Some(actual_hash) => {
                        if !actual_hash.eq_ignore_ascii_case(exp_hash) {
                            mismatches.push(format!("{file_path}: sha256 mismatch"));
                        }
                    }
                    None => {
                        mismatches.push(format!("{file_path}: missing in archive"));
                    }
                }
            }
        }
    }

    IntegrityReport {
        has_manifest: true,
        valid: mismatches.is_empty(),
        schema_version,
        schema_warning,
        checked_count,
        skipped_count,
        mismatches,
    }
}
