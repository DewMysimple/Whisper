"""Contracts for the split GUI process, controller and settings layers."""

from __future__ import annotations

import os
import ast
from pathlib import Path

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from PyQt5.QtCore import QObject, QProcess, QSettings, pyqtSignal

from whisper_subtitle.domain.contracts import ProgressEvent, TranscriptionRequest
from whisper_subtitle.presentation.gui.controller import TranscriptionController
from whisper_subtitle.presentation.gui.process_runner import (
    ProcessRunner,
    build_transcription_arguments,
    parse_progress_line,
)
from whisper_subtitle.presentation.gui.settings import SettingsRepository


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def test_gui_command_uses_unified_cli_and_canonical_preset_alias(tmp_path):
    request = TranscriptionRequest(
        tmp_path / "input file.wav",
        "en_v2",
        tmp_path / "output folder",
        True,
    )

    args = build_transcription_arguments(request)

    assert args == [
        "-m",
        "whisper_subtitle",
        "transcribe",
        str(tmp_path / "input file.wav"),
        "--preset",
        "en2",
        "--progress",
        "jsonl",
        "--output",
        str(tmp_path / "output folder"),
        "--desktop",
    ]
    assert not any("WhisperProject" in arg for arg in args)


def test_gui_progress_parser_accepts_jsonl_and_preserves_raw_output():
    event = parse_progress_line(
        '{"type":"progress","stage":"file_started","message":"开始",'
        '"current":1,"total":2,"preset_id":"cn","input_path":"a.wav"}'
    )
    assert event == ProgressEvent(
        "file_started", "开始", 1, 2, "cn", Path("a.wav")
    )
    assert parse_progress_line("third-party diagnostic") is None


def test_settings_repository_round_trips_paths_preset_and_geometry(tmp_path):
    settings = QSettings(str(tmp_path / "settings.ini"), QSettings.IniFormat)
    repository = SettingsRepository(settings)

    repository.save(
        input_path="input.wav",
        output_path="output",
        preset_id="cn2",
        geometry=b"geometry",
    )
    restored = repository.load()

    assert restored.input_path == "input.wav"
    assert restored.output_path == "output"
    assert restored.preset_id == "cn2"
    assert bytes(restored.geometry) == b"geometry"


class FakeRunner(QObject):
    line_received = pyqtSignal(str)
    progress_received = pyqtSignal(object)
    finished = pyqtSignal(int, int)
    force_killed = pyqtSignal()

    def __init__(self):
        super().__init__()
        self.request = None
        self.stop_count = 0
        self.command = ("python.exe", [])

    def start(self, request):
        self.request = request

    def request_stop(self):
        self.stop_count += 1


def test_controller_routes_progress_stop_and_completion_without_owning_widgets():
    runner = FakeRunner()
    controller = TranscriptionController(runner)
    logs = []
    states = []
    completions = []
    controller.log_received.connect(logs.append)
    controller.running_changed.connect(states.append)
    controller.completed.connect(completions.append)
    request = TranscriptionRequest("input.wav", "cn")

    controller.start(request)
    runner.progress_received.emit(ProgressEvent("model_loading", "加载模型"))
    controller.stop()
    runner.force_killed.emit()
    runner.finished.emit(1, int(QProcess.CrashExit))

    assert runner.request is request
    assert runner.stop_count == 1
    assert states == [True, False]
    assert logs == ["加载模型", "\n请求停止...", "强制终止"]
    assert completions[0].user_stopped is True
    assert completions[0].exit_code == 1


def test_process_runner_exposes_non_blocking_stop_timeout_contract():
    assert ProcessRunner.STOP_TIMEOUT_MS == 5000


def test_gui_presentation_has_no_core_script_dispatch_and_build_is_split():
    gui_root = PROJECT_ROOT / "src" / "whisper_subtitle" / "presentation" / "gui"
    combined = "\n".join(
        path.read_text(encoding="utf-8") for path in gui_root.rglob("*.py")
    )
    assert "WhisperProject" not in combined
    assert "preset.module" not in combined
    assert "preset.script" not in combined

    main_path = gui_root / "main_window.py"
    tree = ast.parse(main_path.read_text(encoding="utf-8"))
    window = next(
        node
        for node in tree.body
        if isinstance(node, ast.ClassDef) and node.name == "WhisperMinimalGUI"
    )
    build = next(
        node
        for node in window.body
        if isinstance(node, ast.FunctionDef) and node.name == "_build_ui"
    )
    assert build.end_lineno - build.lineno + 1 <= 5
