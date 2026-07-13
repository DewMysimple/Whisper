"""Unified command-line interface for WhisperSubtitle."""

import argparse
import importlib
import sys

from . import logger


PRESET_MODULES = {
    "cn": "whisper_subtitle.core.WhisperProjectCN",
    "cn2": "whisper_subtitle.core.WhisperProjectCN2",
    "en": "whisper_subtitle.core.WhisperProject",
    "en2": "whisper_subtitle.core.WhisperProject2",
}


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
        choices=tuple(PRESET_MODULES),
        default="en",
        help="转录预设（默认: en）",
    )

    subparsers.add_parser("gui", help="启动图形界面")
    subparsers.add_parser("check", help="运行环境自检")
    return parser


def _run_transcribe(args):
    module = importlib.import_module(PRESET_MODULES[args.preset])
    forwarded = [args.input]
    if args.output != ".":
        forwarded.extend(["-o", args.output])

    previous_argv = sys.argv
    sys.argv = [f"whisper-subtitle transcribe --preset {args.preset}", *forwarded]
    try:
        return int(module.main() or 0)
    finally:
        sys.argv = previous_argv


def _run_check():
    from .utils.test_env import main as check_main

    try:
        check_main()
    except SystemExit as exc:
        return int(exc.code or 0)
    return 0


def _run_gui():
    from .gui.WhisperPyQtGUI import main as gui_main

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
