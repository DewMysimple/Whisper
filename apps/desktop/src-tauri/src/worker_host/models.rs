//! Local model discovery and packaged-worker environment helpers.

use std::ffi::OsString;
use std::path::{Path, PathBuf};

use super::LocalModelDescriptor;
use super::model_catalog::MODEL_CATALOG;

pub(super) fn packaged_worker_environment(directory: &Path) -> Vec<(OsString, OsString)> {
    vec![
        (
            OsString::from("WHISPER_SUBTITLE_HOME"),
            directory.as_os_str().to_owned(),
        ),
        (
            OsString::from("WHISPER_SUBTITLE_MODEL_DIR"),
            directory.join("models").into_os_string(),
        ),
    ]
}

fn complete_model_directory(path: &Path) -> bool {
    path.join("config.json").is_file() && path.join("model.bin").is_file()
}

fn find_local_model(root: &Path, model_id: &str, repositories: &[&str]) -> Option<PathBuf> {
    let managed = root.join(model_id);
    if complete_model_directory(&managed) {
        return Some(managed);
    }
    repositories.iter().find_map(|repository| {
        let snapshots = root.join("hub").join(repository).join("snapshots");
        let mut candidates: Vec<_> = std::fs::read_dir(snapshots)
            .ok()?
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(|path| complete_model_directory(path))
            .collect();
        candidates.sort();
        candidates.pop()
    })
}

fn directory_size(path: &Path) -> u64 {
    let Ok(entries) = std::fs::read_dir(path) else {
        return 0;
    };
    entries
        .filter_map(Result::ok)
        .map(|entry| {
            let path = entry.path();
            match entry.metadata() {
                Ok(metadata) if metadata.is_file() => metadata.len(),
                Ok(metadata) if metadata.is_dir() => directory_size(&path),
                _ => 0,
            }
        })
        .sum()
}

pub(super) fn inspect_local_models(root: &Path) -> Vec<LocalModelDescriptor> {
    MODEL_CATALOG
        .iter()
        .map(|(id, label, repositories)| {
            let path = find_local_model(root, id, repositories);
            LocalModelDescriptor {
                id: (*id).to_owned(),
                label: (*label).to_owned(),
                installed: path.is_some(),
                size_bytes: path.as_deref().map(directory_size),
                path: path
                    .as_ref()
                    .map(|value| value.to_string_lossy().into_owned()),
                detail: path
                    .is_some()
                    .then_some("本地模型完整，可离线加载".to_owned())
                    .unwrap_or_else(|| format!("请放入 models\\{id}")),
            }
        })
        .collect()
}
