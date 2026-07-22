"""Runtime capability checks independent of the repository source layout."""

from __future__ import annotations

import importlib.util
import sys
from collections.abc import Callable

from ..paths import AppPaths, get_app_paths


REQUIRED_MODULES = ("psutil", "faster_whisper", "ctranslate2")
WORKER_REQUIRED_MODULES = REQUIRED_MODULES


def check_environment(
    app_paths: AppPaths | None = None,
    *,
    find_spec: Callable[[str], object | None] = importlib.util.find_spec,
) -> list[str]:
    """Return actionable runtime errors without relying on repository files."""
    paths = app_paths or get_app_paths()
    errors = []
    for module_name in REQUIRED_MODULES:
        try:
            available = find_spec(module_name) is not None
        except (ImportError, AttributeError, ValueError) as exc:
            errors.append(f"依赖检查失败 {module_name}: {exc}")
            continue
        if not available:
            errors.append(
                f"缺少运行依赖 {module_name}；请在当前 Python 环境中安装项目依赖"
            )
    if not paths.python_executable.is_file():
        errors.append(f"当前 Python 解释器不存在: {paths.python_executable}")
    if not paths.model_location.available_models():
        errors.append(
            "未找到受支持的本地 Whisper 模型；请安装 tiny、base、small、medium、"
            "large-v3 或 large-v3-turbo，并检查 WHISPER_SUBTITLE_MODEL_DIR。"
        )
    return errors


def check_worker_environment(
    app_paths: AppPaths | None = None,
    *,
    find_spec: Callable[[str], object | None] = importlib.util.find_spec,
) -> list[str]:
    """Return the requirements for the packaged headless Worker."""
    paths = app_paths or get_app_paths()
    errors = []
    for module_name in WORKER_REQUIRED_MODULES:
        try:
            available = find_spec(module_name) is not None
        except (ImportError, AttributeError, ValueError) as exc:
            errors.append(f"依赖检查失败 {module_name}: {exc}")
            continue
        if not available:
            errors.append(f"缺少 Worker 运行依赖 {module_name}")
    if not paths.python_executable.is_file():
        errors.append(f"当前 Python 解释器不存在: {paths.python_executable}")
    if not paths.model_location.available_models():
        errors.append(
            "未找到受支持的本地 Whisper 模型；请安装 tiny、base、small、medium、"
            "large-v3 或 large-v3-turbo，并检查 WHISPER_SUBTITLE_MODEL_DIR。"
        )
    return errors


def main() -> int:
    failed = check_environment()
    if failed:
        print("环境自检失败:", file=sys.stderr)
        for message in failed:
            print(f"  {message}", file=sys.stderr)
        return 1
    print("环境自检通过")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
