"""Filesystem and runtime adapters used by WhisperSubtitle."""

from .media_files import (
    SUPPORTED_MEDIA_EXTENSIONS,
    MediaDiscoveryError,
    discover_media_files,
    is_supported_media_file,
)
from .hardware import HardwareDetector, HardwareInfo
from .environment_check import REQUIRED_MODULES, check_environment
from .output_store import (
    OutputPlan,
    atomic_write_text,
    build_output_plan,
    copy_utf8_text,
    prepare_forced_output_directory,
    prepare_output_plan,
    write_desktop_outputs,
    write_primary_outputs,
)
from .whisper_engine import (
    DEFAULT_MODEL_NAME,
    FasterWhisperEngine,
    ModelLocation,
    resolve_model_location,
)

__all__ = [
    "SUPPORTED_MEDIA_EXTENSIONS",
    "MediaDiscoveryError",
    "HardwareDetector",
    "HardwareInfo",
    "REQUIRED_MODULES",
    "OutputPlan",
    "DEFAULT_MODEL_NAME",
    "FasterWhisperEngine",
    "ModelLocation",
    "atomic_write_text",
    "build_output_plan",
    "check_environment",
    "copy_utf8_text",
    "discover_media_files",
    "is_supported_media_file",
    "prepare_forced_output_directory",
    "prepare_output_plan",
    "resolve_model_location",
    "write_desktop_outputs",
    "write_primary_outputs",
]
