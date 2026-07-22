"""Central path and resource discovery for portable and installed modes."""

from __future__ import annotations

import os
import sys
from dataclasses import dataclass
from functools import lru_cache
from importlib import resources
from pathlib import Path
from typing import Mapping


MODEL_DIR_ENV = "WHISPER_SUBTITLE_MODEL_DIR"
APP_HOME_ENV = "WHISPER_SUBTITLE_HOME"
MODEL_REQUIRED_FILES = ("config.json", "model.bin")
SUPPORTED_MODEL_IDS = (
    "tiny",
    "base",
    "small",
    "medium",
    "large-v3",
    "large-v3-turbo",
)
MODEL_REPOSITORIES = {
    "tiny": ("Systran/faster-whisper-tiny",),
    "base": ("Systran/faster-whisper-base",),
    "small": ("Systran/faster-whisper-small",),
    "medium": ("Systran/faster-whisper-medium",),
    "large-v3": ("Systran/faster-whisper-large-v3",),
    "large-v3-turbo": (
        "mobiuslabsgmbh/faster-whisper-large-v3-turbo",
        "Systran/faster-whisper-large-v3-turbo",
    ),
}


class ModelNotFoundError(FileNotFoundError):
    """Raised when no complete local faster-whisper model can be resolved."""


def _is_model_directory(path: Path) -> bool:
    return path.is_dir() and all((path / name).is_file() for name in MODEL_REQUIRED_FILES)


@dataclass(frozen=True, slots=True)
class ModelLocation:
    """Resolved Hugging Face cache and optional direct model directory."""

    hf_home: Path
    hub: Path
    source: str = "unknown"
    direct_model: Path | None = None

    def __post_init__(self) -> None:
        object.__setattr__(self, "hf_home", Path(self.hf_home))
        object.__setattr__(self, "hub", Path(self.hub))
        if self.direct_model is not None:
            object.__setattr__(self, "direct_model", Path(self.direct_model))

    def find_model(self, model_name: str) -> Path | None:
        """Find a complete direct directory or cached Hugging Face snapshot."""
        normalized = model_name.lower().replace("_", "-")
        if self.direct_model is not None and _is_model_directory(self.direct_model):
            direct_name = self.direct_model.name.lower().replace("_", "-")
            if direct_name == normalized or normalized == "large-v3-turbo":
                return self.direct_model
        managed = self.hf_home / normalized
        if _is_model_directory(managed):
            return managed
        if not self.hub.is_dir():
            return None
        repository_ids = MODEL_REPOSITORIES.get(normalized)
        if repository_ids is None:
            return None
        repositories = [
            self.hub / ("models--" + repository_id.replace("/", "--"))
            for repository_id in repository_ids
        ]
        for repository in repositories:
            snapshots = repository / "snapshots"
            if not snapshots.is_dir():
                continue
            for snapshot in sorted(snapshots.iterdir(), reverse=True):
                if _is_model_directory(snapshot):
                    return snapshot
        return None

    def available_models(self) -> tuple[str, ...]:
        """Return supported local models without triggering network access."""
        return tuple(
            model_id
            for model_id in SUPPORTED_MODEL_IDS
            if self.find_model(model_id) is not None
        )

    def require_model(self, model_name: str) -> Path:
        """Return a local model or raise a diagnostic with concrete remedies."""
        model_path = self.find_model(model_name)
        if model_path is not None:
            return model_path
        raise ModelNotFoundError(
            "未找到本地 Whisper 模型 "
            f"{model_name}。已检查: {self.hub}。"
            "请使用 --model-dir <目录>，或设置环境变量 "
            f"{MODEL_DIR_ENV} / HF_HOME；便携模式可将模型放入 "
            "models/huggingface/hub。"
        )


def _detect_portable_root(package_dir: Path, environ: Mapping[str, str]) -> Path | None:
    configured = environ.get(APP_HOME_ENV)
    if configured:
        return Path(configured).expanduser()
    for candidate in (package_dir, *package_dir.parents):
        if (candidate / "launch.vbs").is_file() and (candidate / "pyproject.toml").is_file():
            return candidate
    return None


def _user_model_home(environ: Mapping[str, str]) -> Path:
    if environ.get("LOCALAPPDATA"):
        return (
            Path(environ["LOCALAPPDATA"])
            / "WhisperSubtitle"
            / "models"
            / "huggingface"
        )
    cache_root = Path(environ.get("XDG_CACHE_HOME", Path.home() / ".cache"))
    return cache_root / "whisper-subtitle" / "models" / "huggingface"


def _model_location(model_home: Path, source: str) -> ModelLocation:
    model_home = Path(model_home).expanduser()
    direct = model_home if _is_model_directory(model_home) else None
    return ModelLocation(
        hf_home=model_home,
        hub=model_home / "hub",
        source=source,
        direct_model=direct,
    )


@dataclass(frozen=True, slots=True)
class AppPaths:
    """All runtime paths needed by CLI, Worker and desktop entry points."""

    package_dir: Path
    python_executable: Path
    working_directory: Path
    portable_root: Path | None
    user_data_dir: Path
    model_location: ModelLocation

    def __post_init__(self) -> None:
        for name in (
            "package_dir",
            "python_executable",
            "working_directory",
            "user_data_dir",
        ):
            object.__setattr__(self, name, Path(getattr(self, name)))
        if self.portable_root is not None:
            object.__setattr__(self, "portable_root", Path(self.portable_root))

    @classmethod
    def discover(
        cls,
        *,
        explicit_model_dir: Path | str | None = None,
        package_dir: Path | str | None = None,
        python_executable: Path | str | None = None,
        portable_root: Path | str | bool | None = None,
        cwd: Path | str | None = None,
        environ: Mapping[str, str] | None = None,
    ) -> "AppPaths":
        environment = os.environ if environ is None else environ
        package = Path(package_dir) if package_dir is not None else Path(__file__).parent
        if portable_root is False:
            portable = None
        elif portable_root is None:
            portable = _detect_portable_root(package, environment)
        else:
            portable = Path(portable_root)

        user_data = _user_model_home(environment).parents[1]
        working = portable or Path(cwd or Path.cwd())
        if explicit_model_dir is not None:
            location = _model_location(Path(explicit_model_dir), "explicit")
        elif environment.get(MODEL_DIR_ENV):
            location = _model_location(
                Path(environment[MODEL_DIR_ENV]), MODEL_DIR_ENV
            )
        elif environment.get("HF_HOME"):
            location = _model_location(Path(environment["HF_HOME"]), "HF_HOME")
        elif portable is not None:
            location = _model_location(
                portable / "models" / "huggingface", "portable"
            )
        else:
            location = _model_location(_user_model_home(environment), "user-cache")

        return cls(
            package_dir=package,
            python_executable=Path(python_executable or sys.executable),
            working_directory=working,
            portable_root=portable,
            user_data_dir=user_data,
            model_location=location,
        )

    def read_resource(self, name: str) -> bytes:
        """Read package data, with a portable assets fallback for old layouts."""
        try:
            return resources.files("whisper_subtitle.resources").joinpath(name).read_bytes()
        except (FileNotFoundError, ModuleNotFoundError):
            if self.portable_root is not None:
                fallback = self.portable_root / "assets" / name
                if fallback.is_file():
                    return fallback.read_bytes()
            raise FileNotFoundError(f"应用资源不存在: {name}") from None


@lru_cache(maxsize=1)
def get_app_paths() -> AppPaths:
    """Return the process-default path configuration."""
    return AppPaths.discover()
