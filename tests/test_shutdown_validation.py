"""Shutdown measurement must not mistake an exit code for kernel completion."""

from types import SimpleNamespace

from tests.benchmark import run_shutdown_validation as validation


def test_windows_wait_does_not_accept_cached_exit_code_before_handle_signals(monkeypatch):
    calls = []
    process = SimpleNamespace(
        _handle=123, returncode=0,
        poll=lambda: calls.append("poll"),
    )
    monkeypatch.setattr(validation, "WINDOWS", True)
    monkeypatch.setattr(
        validation, "_wait_for_windows_handle",
        lambda handle, timeout: calls.append((handle, timeout)) or False,
    )

    assert validation.wait_for_exit(process, 0.5) is False
    assert calls == [(123, 0.5)]


def test_cleanup_keeps_teardown_and_kill_failure_diagnostics(monkeypatch):
    def denied():
        raise PermissionError("process is terminating")

    process = SimpleNamespace(returncode=0, kill=denied)
    waits = []
    monkeypatch.setattr(
        validation, "wait_for_exit",
        lambda process, timeout: waits.append(timeout) or False,
    )
    errors = []

    report = validation.cleanup_worker(process, errors)

    assert waits == [0, 2]
    assert report["return_code"] == 0
    assert report["worker_exit_signaled_before_cleanup"] is False
    assert report["worker_exit_signaled_after_cleanup"] is False
    assert report["worker_remaining_after_cleanup"] is True
    assert any("PermissionError" in error for error in errors)
    assert any("kernel teardown" in error for error in errors)


def test_failed_case_stops_subsequent_model_launches(monkeypatch, tmp_path):
    cases = []

    def failed_case(args, model, method):
        cases.append((model, method))
        return {"model": model, "exit_method": method, "errors": ["stuck teardown"]}

    monkeypatch.setattr(validation, "run_case", failed_case)
    monkeypatch.setattr(validation.sys, "argv", [
        "shutdown-validation", "--output-dir", str(tmp_path),
        "--model-dir", str(tmp_path / "models"),
    ])

    assert validation.main() == 1
    assert cases == [("large-v3-turbo", "command")]
    assert (tmp_path / "shutdown-validation.json").is_file()
