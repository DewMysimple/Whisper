//! Static model and media catalog shared by the Rust Host.

pub(super) const DEFAULT_MODEL_ID: &str = "large-v3-turbo";
pub(super) const SUPPORTED_MODEL_IDS: &[&str] = &[
    "tiny",
    "base",
    "small",
    "medium",
    "large-v3",
    "large-v3-turbo",
];
pub(super) const MODEL_CATALOG: &[(&str, &str, &[&str])] = &[
    ("tiny", "Tiny", &["models--Systran--faster-whisper-tiny"]),
    ("base", "Base", &["models--Systran--faster-whisper-base"]),
    ("small", "Small", &["models--Systran--faster-whisper-small"]),
    (
        "medium",
        "Medium",
        &["models--Systran--faster-whisper-medium"],
    ),
    (
        "large-v3",
        "Large V3",
        &["models--Systran--faster-whisper-large-v3"],
    ),
    (
        "large-v3-turbo",
        "Large V3 Turbo",
        &[
            "models--mobiuslabsgmbh--faster-whisper-large-v3-turbo",
            "models--Systran--faster-whisper-large-v3-turbo",
        ],
    ),
];
pub(super) const SUPPORTED_MEDIA_EXTENSIONS: &[&str] = &[
    "aac", "avi", "flv", "m4a", "m4v", "mkv", "mov", "mp3", "mp4", "mpeg", "mpg", "ogg", "wav",
    "webm", "wmv",
];
