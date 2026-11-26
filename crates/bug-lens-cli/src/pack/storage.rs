//! 证据包统一存储抽象：支持工作区磁盘按需懒读（低峰值内存）与纯内存模式（单测专用）。

use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::fs::{self, File};
use std::io::{BufReader, Read};
use std::path::{Path, PathBuf};

const HASH_BUF_SIZE: usize = 64 * 1024;

#[derive(Debug)]
pub enum PackStorage {
    Disk {
        root_dir: PathBuf,
        entries: BTreeMap<String, u64>,
    },
    Memory {
        files: BTreeMap<String, Vec<u8>>,
    },
}

fn clean_lookup_path(rel_path: &str) -> &str {
    rel_path
        .strip_prefix("./")
        .or_else(|| rel_path.strip_prefix('/'))
        .unwrap_or(rel_path)
}

impl PackStorage {
    pub fn disk_root(&self) -> Option<&Path> {
        match self {
            PackStorage::Disk { root_dir, .. } => Some(root_dir.as_path()),
            PackStorage::Memory { .. } => None,
        }
    }

    pub fn has(&self, rel_path: &str) -> bool {
        let key = clean_lookup_path(rel_path);
        match self {
            PackStorage::Disk { entries, .. } => entries.contains_key(key),
            PackStorage::Memory { files } => files.contains_key(key),
        }
    }

    pub fn byte_length(&self, rel_path: &str) -> Option<u64> {
        let key = clean_lookup_path(rel_path);
        match self {
            PackStorage::Disk { entries, .. } => entries.get(key).copied(),
            PackStorage::Memory { files } => files.get(key).map(|b| b.len() as u64),
        }
    }

    pub fn read_bytes(&self, rel_path: &str) -> Option<Vec<u8>> {
        let key = clean_lookup_path(rel_path);
        match self {
            PackStorage::Disk { root_dir, entries } => {
                if !entries.contains_key(key) {
                    return None;
                }
                let mut full = root_dir.clone();
                for part in key.split('/') {
                    full.push(part);
                }
                fs::read(full).ok()
            }
            PackStorage::Memory { files } => files.get(key).cloned(),
        }
    }

    pub fn read_text(&self, rel_path: &str) -> Option<String> {
        let bytes = self.read_bytes(rel_path)?;
        Some(String::from_utf8_lossy(&bytes).into_owned())
    }

    /// Compute SHA-256 hex digest using bounded 64 KiB streaming I/O for disk-backed files.
    pub fn sha256_hex(&self, rel_path: &str) -> Option<String> {
        let key = clean_lookup_path(rel_path);
        match self {
            PackStorage::Disk { root_dir, entries } => {
                if !entries.contains_key(key) {
                    return None;
                }
                let mut full = root_dir.clone();
                for part in key.split('/') {
                    full.push(part);
                }
                let file = File::open(full).ok()?;
                let mut reader = BufReader::with_capacity(HASH_BUF_SIZE, file);
                let mut hasher = Sha256::new();
                let mut buf = [0u8; HASH_BUF_SIZE];
                loop {
                    let n = reader.read(&mut buf).ok()?;
                    if n == 0 {
                        break;
                    }
                    hasher.update(&buf[..n]);
                }
                Some(hex_lower(&hasher.finalize()))
            }
            PackStorage::Memory { files } => {
                let bytes = files.get(key)?;
                let mut hasher = Sha256::new();
                hasher.update(bytes);
                Some(hex_lower(&hasher.finalize()))
            }
        }
    }

    pub fn iter_entries(&self) -> Vec<(String, u64)> {
        match self {
            PackStorage::Disk { entries, .. } => {
                entries.iter().map(|(k, v)| (k.clone(), *v)).collect()
            }
            PackStorage::Memory { files } => files
                .iter()
                .map(|(k, v)| (k.clone(), v.len() as u64))
                .collect(),
        }
    }
}

pub fn hex_lower(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for &b in bytes {
        out.push(HEX[(b >> 4) as usize] as char);
        out.push(HEX[(b & 0x0f) as usize] as char);
    }
    out
}
