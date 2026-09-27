//! Generated model catalog shared by the Rust Host.
//! Edit `src/whisper_subtitle/domain/models.py` and run the generator.

pub(super) const DEFAULT_MODEL_ID: &str = "large-v3-turbo";

pub(super) const SUPPORTED_MODEL_IDS: &[&str] = &[
    "tiny",
    "base",
    "small",
    "medium",
    "large-v3",
    "large-v3-turbo",
    "qwen3-asr-1.7b",
    "qwen3-asr-0.6b",
];

pub(super) const SECONDARY_RECOGNITION_MODEL_IDS: &[&str] = &["large-v3", "large-v3-turbo"];

pub(super) const TRANSLATION_MODEL_IDS: &[&str] = &["tiny", "base", "small", "medium", "large-v3"];

pub(super) const QWEN_MODEL_IDS: &[&str] = &["qwen3-asr-1.7b", "qwen3-asr-0.6b"];

pub(super) const QWEN_PARAMETER_NAMES: &[&str] = &[
    "chunk_length",
    "hotwords",
    "initial_prompt",
    "language",
    "max_new_tokens",
    "max_speech_duration_s",
    "min_silence_duration_ms",
    "min_speech_duration_ms",
    "speech_pad_ms",
    "vad_filter",
    "vad_neg_threshold",
    "vad_threshold",
    "word_timestamps",
];

pub(super) const QWEN_LANGUAGES: &[&str] = &[
    "zh", "en", "yue", "ar", "de", "fr", "es", "pt", "id", "it", "ko", "ru", "th", "vi", "ja",
    "tr", "hi", "ms", "nl", "sv", "da", "fi", "pl", "cs", "tl", "fa", "el", "hu", "mk", "ro",
];

pub(super) struct ModelAsset {
    pub id: &'static str,
    pub repositories: &'static [&'static str],
    pub required_files: &'static [&'static str],
    pub config_model_type: Option<&'static str>,
    pub config_architecture: Option<&'static str>,
    pub companion_id: Option<&'static str>,
}

pub(super) const MODEL_ASSETS: &[ModelAsset] = &[
    ModelAsset {
        id: "tiny",
        repositories: &["models--Systran--faster-whisper-tiny"],
        required_files: &["config.json", "model.bin"],
        config_model_type: None,
        config_architecture: None,
        companion_id: None,
    },
    ModelAsset {
        id: "base",
        repositories: &["models--Systran--faster-whisper-base"],
        required_files: &["config.json", "model.bin"],
        config_model_type: None,
        config_architecture: None,
        companion_id: None,
    },
    ModelAsset {
        id: "small",
        repositories: &["models--Systran--faster-whisper-small"],
        required_files: &["config.json", "model.bin"],
        config_model_type: None,
        config_architecture: None,
        companion_id: None,
    },
    ModelAsset {
        id: "medium",
        repositories: &["models--Systran--faster-whisper-medium"],
        required_files: &["config.json", "model.bin"],
        config_model_type: None,
        config_architecture: None,
        companion_id: None,
    },
    ModelAsset {
        id: "large-v3",
        repositories: &["models--Systran--faster-whisper-large-v3"],
        required_files: &["config.json", "model.bin"],
        config_model_type: None,
        config_architecture: None,
        companion_id: None,
    },
    ModelAsset {
        id: "large-v3-turbo",
        repositories: &[
            "models--mobiuslabsgmbh--faster-whisper-large-v3-turbo",
            "models--Systran--faster-whisper-large-v3-turbo",
        ],
        required_files: &["config.json", "model.bin"],
        config_model_type: None,
        config_architecture: None,
        companion_id: None,
    },
    ModelAsset {
        id: "qwen3-asr-1.7b",
        repositories: &["models--Qwen--Qwen3-ASR-1.7B-hf"],
        required_files: &[
            "config.json",
            "processor_config.json",
            "tokenizer_config.json",
            "tokenizer.json",
            "chat_template.jinja",
        ],
        config_model_type: Some("qwen3_asr"),
        config_architecture: Some("Qwen3ASRForConditionalGeneration"),
        companion_id: Some("qwen3-forced-aligner-0.6b"),
    },
    ModelAsset {
        id: "qwen3-asr-0.6b",
        repositories: &["models--Qwen--Qwen3-ASR-0.6B-hf"],
        required_files: &[
            "config.json",
            "processor_config.json",
            "tokenizer_config.json",
            "tokenizer.json",
            "chat_template.jinja",
        ],
        config_model_type: Some("qwen3_asr"),
        config_architecture: Some("Qwen3ASRForConditionalGeneration"),
        companion_id: Some("qwen3-forced-aligner-0.6b"),
    },
    ModelAsset {
        id: "qwen3-forced-aligner-0.6b",
        repositories: &["models--Qwen--Qwen3-ForcedAligner-0.6B-hf"],
        required_files: &[
            "config.json",
            "processor_config.json",
            "tokenizer_config.json",
            "tokenizer.json",
            "chat_template.jinja",
        ],
        config_model_type: Some("qwen3_asr"),
        config_architecture: Some("Qwen3ASRForTokenClassification"),
        companion_id: None,
    },
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
    (
        "qwen3-asr-1.7b",
        "Qwen3-ASR 1.7B",
        &["models--Qwen--Qwen3-ASR-1.7B-hf"],
    ),
    (
        "qwen3-asr-0.6b",
        "Qwen3-ASR 0.6B",
        &["models--Qwen--Qwen3-ASR-0.6B-hf"],
    ),
];
