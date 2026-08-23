//! Input media discovery and duration-inspection merge helpers.

use std::path::Path;

use super::model_catalog::SUPPORTED_MEDIA_EXTENSIONS;
use super::{HostError, InspectedInput, MediaInspectionItem};

fn is_supported_media(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .is_some_and(|value| {
            SUPPORTED_MEDIA_EXTENSIONS.contains(&value.to_ascii_lowercase().as_str())
        })
}

fn collect_supported_media(path: &Path) -> Result<Vec<std::path::PathBuf>, std::io::Error> {
    if path.is_file() {
        return Ok(if is_supported_media(path) {
            vec![path.to_path_buf()]
        } else {
            Vec::new()
        });
    }
    let mut media = Vec::new();
    for entry in std::fs::read_dir(path)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        if file_type.is_dir() {
            media.extend(collect_supported_media(&entry.path())?);
        } else if file_type.is_file() && is_supported_media(&entry.path()) {
            media.push(entry.path());
        }
    }
    media.sort_by(|left, right| {
        left.to_string_lossy()
            .to_lowercase()
            .cmp(&right.to_string_lossy().to_lowercase())
    });
    Ok(media)
}

pub fn inspect_input_paths(paths: Vec<String>, origin: String) -> Vec<InspectedInput> {
    let normalized_origin = if matches!(origin.as_str(), "dialog" | "drop" | "paste" | "manual") {
        origin
    } else {
        "manual".to_owned()
    };
    paths
        .into_iter()
        .map(|raw| {
            let path = strip_one_pair_of_quotes(raw.trim());
            match std::fs::metadata(path) {
                Ok(metadata) if metadata.is_dir() || metadata.is_file() => {
                    let kind = if metadata.is_dir() {
                        "directory"
                    } else {
                        "file"
                    };
                    match collect_supported_media(Path::new(path)) {
                        Ok(media_paths) if !media_paths.is_empty() => InspectedInput {
                            path: path.to_owned(),
                            kind: kind.to_owned(),
                            origin: normalized_origin.clone(),
                            valid: true,
                            media_count: Some(media_paths.len()),
                            duration_seconds: None,
                            unknown_duration_count: Some(media_paths.len()),
                            detail: (kind == "directory")
                                .then(|| format!("递归发现 {} 个媒体文件", media_paths.len())),
                            media_paths,
                        },
                        Ok(_) => InspectedInput {
                            path: path.to_owned(),
                            kind: kind.to_owned(),
                            origin: normalized_origin.clone(),
                            valid: false,
                            media_count: Some(0),
                            duration_seconds: None,
                            unknown_duration_count: Some(0),
                            detail: Some("未发现支持的媒体文件".to_owned()),
                            media_paths: Vec::new(),
                        },
                        Err(error) => InspectedInput {
                            path: path.to_owned(),
                            kind: kind.to_owned(),
                            origin: normalized_origin.clone(),
                            valid: false,
                            media_count: None,
                            duration_seconds: None,
                            unknown_duration_count: None,
                            detail: Some(format!("无法读取媒体目录: {error}")),
                            media_paths: Vec::new(),
                        },
                    }
                }
                Ok(_) => InspectedInput {
                    path: path.to_owned(),
                    kind: "file".to_owned(),
                    origin: normalized_origin.clone(),
                    valid: false,
                    media_count: None,
                    duration_seconds: None,
                    unknown_duration_count: None,
                    detail: Some("输入不是文件或目录".to_owned()),
                    media_paths: Vec::new(),
                },
                Err(error) => InspectedInput {
                    path: path.to_owned(),
                    kind: "file".to_owned(),
                    origin: normalized_origin.clone(),
                    valid: false,
                    media_count: None,
                    duration_seconds: None,
                    unknown_duration_count: None,
                    detail: Some(error.to_string()),
                    media_paths: Vec::new(),
                },
            }
        })
        .collect()
}

pub fn apply_media_inspections(
    inputs: &mut [InspectedInput],
    inspections: &[MediaInspectionItem],
) -> Result<(), HostError> {
    let expected = inputs
        .iter()
        .map(|input| input.media_paths.len())
        .sum::<usize>();
    if expected != inspections.len() {
        return Err(HostError::new(
            "host.protocol_mismatch",
            "media inspections do not align with inspected inputs",
        ));
    }
    let mut cursor = 0;
    for input in inputs {
        let count = input.media_paths.len();
        if count == 0 {
            continue;
        }
        let values = &inspections[cursor..cursor + count];
        cursor += count;
        let known = values
            .iter()
            .filter_map(|item| item.duration_seconds)
            .collect::<Vec<_>>();
        input.duration_seconds = (!known.is_empty()).then(|| known.iter().sum());
        input.unknown_duration_count = Some(count.saturating_sub(known.len()));
        if let Some(item) = values.iter().find(|item| !item.readable) {
            input.valid = false;
            input.detail = Some(format!(
                "无法读取媒体容器：{}{}",
                item.path,
                item.error
                    .as_deref()
                    .map(|error| format!("（{error}）"))
                    .unwrap_or_default()
            ));
        }
    }
    Ok(())
}

pub fn strip_one_pair_of_quotes(value: &str) -> &str {
    value
        .strip_prefix('"')
        .and_then(|inner| inner.strip_suffix('"'))
        .unwrap_or(value)
}
