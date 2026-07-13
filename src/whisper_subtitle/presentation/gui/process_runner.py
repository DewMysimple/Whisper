"""QProcess transport for the GUI's unified CLI invocation."""

from __future__ import annotations

import json
from pathlib import Path

from PyQt5.QtCore import QObject, QProcess, QProcessEnvironment, QTimer, pyqtSignal

from ...domain.contracts import ProgressEvent, TranscriptionRequest
from ...domain.presets import get_preset_by_id
from ...paths import AppPaths, get_app_paths


def build_transcription_arguments(request: TranscriptionRequest) -> list[str]:
    """Build the GUI child-process arguments without consulting Core scripts."""
    preset = get_preset_by_id(request.preset_id)
    args = [
        "-m",
        "whisper_subtitle",
        "transcribe",
        str(request.input_path),
        "--preset",
        preset.cli_alias,
        "--progress",
        "jsonl",
    ]
    if request.output_dir is not None:
        args.extend(["--output", str(request.output_dir)])
    if request.desktop:
        args.append("--desktop")
    return args


def parse_progress_line(line: str) -> ProgressEvent | None:
    """Decode our JSONL protocol, returning None for unrelated diagnostics."""
    try:
        payload = json.loads(line)
    except (TypeError, json.JSONDecodeError):
        return None
    if not isinstance(payload, dict) or payload.get("type") != "progress":
        return None
    try:
        return ProgressEvent(
            stage=payload["stage"],
            message=payload["message"],
            current=payload.get("current"),
            total=payload.get("total"),
            preset_id=payload.get("preset_id"),
            input_path=payload.get("input_path"),
        )
    except (KeyError, TypeError, ValueError):
        return None


class ProcessRunner(QObject):
    """Own QProcess lifecycle, buffered JSONL decoding and stop escalation."""

    STOP_TIMEOUT_MS = 5000

    line_received = pyqtSignal(str)
    progress_received = pyqtSignal(object)
    finished = pyqtSignal(int, int)
    force_killed = pyqtSignal()

    def __init__(
        self,
        python_executable: Path | None = None,
        working_directory: Path | None = None,
        *,
        app_paths: AppPaths | None = None,
        parent: QObject | None = None,
    ) -> None:
        super().__init__(parent)
        paths = app_paths or get_app_paths()
        self._python_executable = Path(
            python_executable or paths.python_executable
        )
        self._buffer = ""
        self.command: tuple[str, list[str]] = (str(self._python_executable), [])

        self.process = QProcess(self)
        self.process.setProcessChannelMode(QProcess.MergedChannels)
        self.process.setWorkingDirectory(str(working_directory or paths.working_directory))
        environment = QProcessEnvironment.systemEnvironment()
        environment.insert("PYTHONIOENCODING", "utf-8")
        environment.insert("PYTHONUNBUFFERED", "1")
        environment.insert("HF_HOME", str(paths.model_location.hf_home))
        self.process.setProcessEnvironment(environment)
        self.process.readyReadStandardOutput.connect(self._read_output)
        self.process.finished.connect(self._on_finished)

        self._stop_timer = QTimer(self)
        self._stop_timer.setSingleShot(True)
        self._stop_timer.setInterval(self.STOP_TIMEOUT_MS)
        self._stop_timer.timeout.connect(self.kill_if_running)

    @property
    def is_running(self) -> bool:
        return self.process.state() != QProcess.NotRunning

    def start(self, request: TranscriptionRequest) -> None:
        arguments = build_transcription_arguments(request)
        self.command = (str(self._python_executable), arguments)
        self._buffer = ""
        self.process.start(self.command[0], self.command[1])

    def request_stop(self) -> None:
        if self.is_running:
            self.process.terminate()
            self._stop_timer.start()

    def kill_if_running(self) -> None:
        if self.is_running:
            self.process.kill()
            self.force_killed.emit()

    def _read_output(self) -> None:
        data = bytes(self.process.readAllStandardOutput()).decode(
            "utf-8", errors="replace"
        )
        self._buffer += data
        lines = self._buffer.split("\n")
        self._buffer = lines.pop()
        for line in lines:
            self._emit_line(line.rstrip("\r"))

    def _emit_line(self, line: str) -> None:
        if not line.strip():
            return
        event = parse_progress_line(line.strip())
        if event is None:
            self.line_received.emit(line.strip())
        else:
            self.progress_received.emit(event)

    def _on_finished(self, exit_code: int, exit_status: int) -> None:
        self._stop_timer.stop()
        if self._buffer:
            self._emit_line(self._buffer.rstrip("\r"))
            self._buffer = ""
        self.finished.emit(exit_code, int(exit_status))
