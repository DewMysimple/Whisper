//! Local model discovery and packaged-worker environment helpers.

use std::ffi::OsString;
use std::path::{Path, PathBuf};

use super::LocalModelDescriptor;
use super::model_catalog::{MODEL_ASSETS, MODEL_CATALOG, ModelAsset};

pub(super) fn packaged_worker_environment(
    application_root: &Path,
    runtime_root: &Path,
) -> Vec<(OsString, OsString)> {
    vec![
        (
            OsString::from("WHISPER_SUBTITLE_HOME"),
            application_root.as_os_str().to_owned(),
        ),
        (
            OsString::from("WHISPER_SUBTITLE_MODEL_DIR"),
            runtime_root.join("models").into_os_string(),
        ),
    ]
}

fn complete_model_directory(path: &Path, asset: &ModelAsset) -> bool {
    if !asset
        .required_files
        .iter()
        .all(|name| path.join(name).is_file())
    {
        return false;
    }
    let Some(model_type) = asset.config_model_type else {
        return true;
    };
    let read_json = |name| {
        std::fs::read(path.join(name))
            .ok()
            .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok())
    };
    let Some(config) = read_json("config.json") else {
        return false;
    };
    if config["model_type"].as_str() != Some(model_type) {
        return false;
    }
    if !config["architectures"].as_array().is_some_and(|values| {
        values
            .iter()
            .any(|v| v.as_str() == asset.config_architecture)
    }) {
        return false;
    }
    let has_weights = |name: &str| {
        !name.contains(['/', '\\', ':'])
            && !matches!(name, "." | "..")
            && std::fs::metadata(path.join(name)).is_ok_and(|m| m.is_file() && m.len() > 0)
    };
    if has_weights("model.safetensors") {
        return true;
    }
    let Some(index) = read_json("model.safetensors.index.json") else {
        return false;
    };
    index["weight_map"].as_object().is_some_and(|shards| {
        !shards.is_empty() && shards.values().all(|v| v.as_str().is_some_and(has_weights))
    })
}

fn find_local_model(root: &Path, asset: &ModelAsset) -> Option<PathBuf> {
    let managed = root.join(asset.id);
    if complete_model_directory(&managed, asset) {
        return Some(managed);
    }
    asset.repositories.iter().find_map(|repository| {
        let snapshots = root.join("hub").join(repository).join("snapshots");
        let mut candidates: Vec<_> = std::fs::read_dir(snapshots)
            .ok()?
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(|path| complete_model_directory(path, asset))
            .collect();
        candidates.sort();
        candidates.pop()
    })
}

pub(super) fn model_directory_target(root: &Path, model_id: &str) -> Option<PathBuf> {
    MODEL_CATALOG.iter().find(|(id, _, _)| *id == model_id)?;
    let asset = MODEL_ASSETS.iter().find(|asset| asset.id == model_id)?;
    Some(find_local_model(root, asset).unwrap_or_else(|| root.to_path_buf()))
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
        .map(|(id, label, _repositories)| {
            let asset = MODEL_ASSETS
                .iter()
                .find(|asset| asset.id == *id)
                .expect("generated model asset");
            let path = find_local_model(root, asset);
            let companion = asset
                .companion_id
                .and_then(|id| MODEL_ASSETS.iter().find(|a| a.id == id));
            let companion_path = companion.and_then(|a| find_local_model(root, a));
            let installed = path.is_some() && (companion.is_none() || companion_path.is_some());
            LocalModelDescriptor {
                id: (*id).to_owned(),
                label: (*label).to_owned(),
                installed,
                size_bytes: path.as_deref().map(directory_size),
                path: path
                    .as_ref()
                    .map(|value| value.to_string_lossy().into_owned()),
                detail: if installed {
                    "本地模型完整，可离线加载".to_owned()
                } else if path.is_some() {
                    format!(
                        "还需共享对齐模型：{}",
                        asset.companion_id.unwrap_or_default()
                    )
                } else {
                    format!(
                        "请放入 models\\{id}{}",
                        asset
                            .companion_id
                            .map(|name| format!("，并安装 {name}"))
                            .unwrap_or_default()
                    )
                },
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn qwen_requires_native_asr_weights_and_a_complete_companion() {
        let root = std::env::temp_dir().join(format!(
            "qwen-model-catalog-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let asr = MODEL_ASSETS
            .iter()
            .find(|a| a.id == "qwen3-asr-1.7b")
            .unwrap();
        let aligner = MODEL_ASSETS
            .iter()
            .find(|a| Some(a.id) == asr.companion_id)
            .unwrap();
        let write_asset = |asset: &ModelAsset| {
            let path = root.join(asset.id);
            std::fs::create_dir_all(&path).unwrap();
            for name in asset.required_files {
                std::fs::write(path.join(name), b"{}").unwrap();
            }
            std::fs::write(path.join("config.json"), serde_json::to_vec(&serde_json::json!({
                "model_type": asset.config_model_type, "architectures": [asset.config_architecture]
            })).unwrap()).unwrap();
            std::fs::write(
                path.join("model.safetensors.index.json"),
                br#"{"weight_map":{"a":"part1.safetensors","b":"part2.safetensors"}}"#,
            )
            .unwrap();
            std::fs::write(path.join("part1.safetensors"), b"weights").unwrap();
            path
        };
        let path = write_asset(asr);
        assert!(!complete_model_directory(&path, asr));
        std::fs::write(path.join("part2.safetensors"), b"weights").unwrap();
        assert!(complete_model_directory(&path, asr));
        assert!(!complete_model_directory(&path, aligner));
        assert!(
            !inspect_local_models(&root)
                .iter()
                .find(|m| m.id == asr.id)
                .unwrap()
                .installed
        );
        let alignment = write_asset(aligner);
        std::fs::write(alignment.join("part2.safetensors"), b"weights").unwrap();
        assert!(
            inspect_local_models(&root)
                .iter()
                .find(|m| m.id == asr.id)
                .unwrap()
                .installed
        );
        assert!(model_directory_target(&root, aligner.id).is_none());
        std::fs::remove_dir_all(root).unwrap();
    }
}
