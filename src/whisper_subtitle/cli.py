"""Unified command-line interface for WhisperSubtitle."""

import argparse
import os
import sys
from pathlib import Path

from . import logger
from .domain.presets import (
    CLI_ALIASES,
    DEFAULT_CLI_ALIAS,
    get_preset_by_cli_alias,
)
from .paths import MODEL_DIR_ENV


def _configure_cli_encoding():
    """Prevent Windows GBK consoles from failing on Unicode log symbols."""
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            try:
                reconfigure(errors="replace")
            except (OSError, ValueError) as exc:
                logger.warning(
                    "无法配置 CLI 标准流编码（%s）: %s",
                    type(exc).__name__, exc,
                )


def _build_parser():
    parser = argparse.ArgumentParser(prog="whisper-subtitle")
    subparsers = parser.add_subparsers(dest="command")

    transcribe = subparsers.add_parser("transcribe", help="转录媒体文件或文件夹")
    transcribe.add_argument("input", help="输入媒体文件或文件夹路径")
    transcribe.add_argument("-o", "--output", default=".", help="输出目录")
    transcribe.add_argument(
        "--preset",
        choices=CLI_ALIASES,
        default=DEFAULT_CLI_ALIAS,
        help="转录预设（默认: en）",
    )
    transcribe.add_argument(
        "--desktop",
        action="store_true",
        help="额外保存到桌面 Whisper语音列表 并转 Markdown",
    )
    transcribe.add_argument(
        "--progress",
        choices=("text", "jsonl"),
        default="text",
        help="进度输出格式（默认: text）",
    )
    transcribe.add_argument(
        "--model-dir",
        help="本地模型目录或 Hugging Face 缓存根目录",
    )

    subparsers.add_parser("gui", help="启动图形界面")
    subparsers.add_parser("check", help="运行环境自检")
    return parser


def _run_transcribe(args):
    from .domain.contracts import TranscriptionRequest
    from .presentation.console import run_transcription_request

    preset = get_preset_by_cli_alias(args.preset)
    request = TranscriptionRequest(
        input_path=Path(args.input),
        preset_id=preset.id,
        output_dir=None if args.output == "." else Path(args.output),
        desktop=args.desktop,
    )
    previous_model_dir = os.environ.get(MODEL_DIR_ENV)
    if args.model_dir:
        os.environ[MODEL_DIR_ENV] = args.model_dir
    try:
        return run_transcription_request(request, progress_format=args.progress)
    finally:
        if args.model_dir:
            if previous_model_dir is None:
                os.environ.pop(MODEL_DIR_ENV, None)
            else:
                os.environ[MODEL_DIR_ENV] = previous_model_dir


def _run_check():
    from .infrastructure.environment_check import main as check_main

    try:
        return int(check_main() or 0)
    except SystemExit as exc:
        return int(exc.code or 0)


def _run_gui():
    from .presentation.gui.main_window import main as gui_main

    return gui_main()


def main(argv=None):
    _configure_cli_encoding()
    parser = _build_parser()
    args = parser.parse_args(argv)
    if args.command == "transcribe":
        return _run_transcribe(args)
    if args.command == "gui":
        return _run_gui()
    if args.command == "check":
        return _run_check()
    parser.print_help()
    return 0


if __name__ == "__main__":
    sys.exit(main())
