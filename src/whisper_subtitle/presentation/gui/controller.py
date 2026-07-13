"""Widget-independent orchestration of GUI transcription process state."""

from __future__ import annotations

from dataclasses import dataclass

from PyQt5.QtCore import QObject, pyqtSignal

from ...domain.contracts import ProgressEvent, TranscriptionRequest
from .process_runner import ProcessRunner


@dataclass(frozen=True, slots=True)
class Completion:
    exit_code: int
    exit_status: int
    user_stopped: bool


class TranscriptionController(QObject):
    """Translate runner events into UI-neutral running and completion signals."""

    log_received = pyqtSignal(str)
    running_changed = pyqtSignal(bool)
    completed = pyqtSignal(object)

    def __init__(self, runner: ProcessRunner, parent: QObject | None = None) -> None:
        super().__init__(parent)
        self.runner = runner
        self.user_stopped = False
        runner.line_received.connect(self.log_received.emit)
        runner.progress_received.connect(self._on_progress)
        runner.force_killed.connect(lambda: self.log_received.emit("强制终止"))
        runner.finished.connect(self._on_finished)

    @property
    def is_running(self) -> bool:
        return self.runner.is_running

    @property
    def command(self) -> tuple[str, list[str]]:
        return self.runner.command

    def start(self, request: TranscriptionRequest) -> None:
        self.user_stopped = False
        self.runner.start(request)
        self.running_changed.emit(True)

    def stop(self) -> None:
        if getattr(self.runner, "is_running", True):
            self.user_stopped = True
            self.log_received.emit("\n请求停止...")
            self.runner.request_stop()

    def _on_progress(self, event: ProgressEvent) -> None:
        self.log_received.emit(event.message)

    def _on_finished(self, exit_code: int, exit_status: int) -> None:
        completion = Completion(exit_code, exit_status, self.user_stopped)
        self.running_changed.emit(False)
        self.completed.emit(completion)
