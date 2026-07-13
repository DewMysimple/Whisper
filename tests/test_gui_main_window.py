"""Headless interaction tests for the split desktop main window."""

from __future__ import annotations

import os
import sys

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

import pytest
from PyQt5.QtCore import QObject, QProcess, QSettings, pyqtSignal
from PyQt5.QtWidgets import QApplication, QFileDialog

from whisper_subtitle.domain.presets import DISPLAY_KEYS
from whisper_subtitle.presentation.gui.main_window import WhisperMinimalGUI
from whisper_subtitle.presentation.gui.process_runner import build_transcription_arguments
from whisper_subtitle.presentation.gui.settings import SettingsRepository


class WindowRunner(QObject):
    line_received = pyqtSignal(str)
    progress_received = pyqtSignal(object)
    finished = pyqtSignal(int, int)
    force_killed = pyqtSignal()

    def __init__(self):
        super().__init__()
        self.is_running = False
        self.request = None
        self.command = ("python.exe", [])
        self.stop_count = 0
        self.kill_count = 0

    def start(self, request):
        self.request = request
        self.command = ("python.exe", build_transcription_arguments(request))
        self.is_running = True

    def request_stop(self):
        self.stop_count += 1

    def kill_if_running(self):
        if self.is_running:
            self.kill_count += 1
            self.force_killed.emit()

    def complete(self, exit_code=0, exit_status=QProcess.NormalExit):
        self.is_running = False
        self.finished.emit(exit_code, int(exit_status))


@pytest.fixture(scope="module")
def app():
    instance = QApplication.instance() or QApplication(sys.argv[:1])
    yield instance


def make_window(tmp_path):
    settings = QSettings(str(tmp_path / "window.ini"), QSettings.IniFormat)
    repository = SettingsRepository(settings)
    runner = WindowRunner()
    window = WhisperMinimalGUI(
        settings_repository=repository,
        runner=runner,
        startup_check=lambda: [],
    )
    return window, runner, repository


def test_window_starts_with_all_panels_and_parameter_rows(app, tmp_path):
    window, runner, _repository = make_window(tmp_path)
    try:
        assert window.file_edit is not None
        assert window.center_stack.count() == 2
        assert window.log_edit is not None
        assert window.param_table.rowCount() == len(DISPLAY_KEYS)
        assert runner.is_running is False
    finally:
        window.close()


def test_file_selection_and_preset_change_persist_through_repository(
    app, tmp_path, monkeypatch
):
    window, _runner, repository = make_window(tmp_path)
    media = tmp_path / "selected.wav"
    media.touch()
    monkeypatch.setattr(
        QFileDialog,
        "getOpenFileName",
        lambda *args, **kwargs: (str(media), "audio"),
    )
    try:
        window._browse_input()
        window.mode_buttons["cn2"].setChecked(True)

        assert window.file_edit.text() == str(media)
        assert window._current_preset().id == "cn2"
        assert repository.load().input_path == str(media)
        assert repository.load().preset_id == "cn2"
    finally:
        window.close()


def test_start_uses_unified_cli_request_and_updates_running_controls(
    app, tmp_path
):
    window, runner, _repository = make_window(tmp_path)
    media = tmp_path / "input.wav"
    media.touch()
    output = tmp_path / "output"
    try:
        window.file_edit.setText(str(media))
        window.out_edit.setText(str(output))
        window.mode_buttons["en_v2"].setChecked(True)
        window.desktop_cb.setChecked(True)

        window._start()

        assert runner.request.input_path == media
        assert runner.request.preset_id == "en_v2"
        assert runner.request.output_dir == output
        assert runner.request.desktop is True
        assert runner.command[1][0:3] == ["-m", "whisper_subtitle", "transcribe"]
        assert "WhisperProject" not in " ".join(runner.command[1])
        assert window.start_btn.isEnabled() is False
        assert window.stop_btn.isEnabled() is True
    finally:
        runner.complete()
        window.close()


def test_stop_force_kill_and_completion_remain_asynchronous(app, tmp_path):
    window, runner, _repository = make_window(tmp_path)
    media = tmp_path / "input.wav"
    media.touch()
    try:
        window.file_edit.setText(str(media))
        window._start()
        window._stop()
        window._kill_process_if_running()
        runner.complete(1, QProcess.CrashExit)

        assert runner.stop_count == 1
        assert runner.kill_count == 1
        assert "请求停止" in window.log_edit.toPlainText()
        assert "强制终止" in window.log_edit.toPlainText()
        assert window.status_lbl.text() == "已停止"
        assert window.start_btn.isEnabled() is True
    finally:
        window.close()


class CloseEvent:
    def __init__(self):
        self.ignored = False

    def ignore(self):
        self.ignored = True


def test_close_while_running_requests_stop_and_waits_for_completion(app, tmp_path):
    window, runner, _repository = make_window(tmp_path)
    runner.is_running = True
    event = CloseEvent()

    window.closeEvent(event)

    assert event.ignored is True
    assert window._close_pending is True
    assert runner.stop_count == 1
    runner.complete(1, QProcess.CrashExit)
