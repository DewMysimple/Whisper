"""Resource diagnostics must retain in-process growth and true exit evidence."""

from types import SimpleNamespace

import pytest

from tests.benchmark import run_nvml_lifecycle_validation as validation


def test_trend_uses_actual_irregular_times_not_sample_indices():
    result = validation.linear_trend([(12, 1600), (2, 1100), (5, 1250)])

    assert result["points"] == 3
    assert result["span_seconds"] == 10
    assert result["delta"] == 500
    assert result["slope_per_second"] == pytest.approx(50)


def test_after_exit_reclamation_does_not_hide_running_process_growth():
    before = {"tags": {"NVRM": {"nonpaged_bytes": 100}}}
    after_exit = {"tags": {"NVRM": {"nonpaged_bytes": 100}}}
    snapshots = [
        {"elapsed_seconds": seconds, "pool": {"tags": {"NVRM": {"nonpaged_bytes": value}}}}
        for seconds, value in [(0, 500), (2, 600), (6, 800), (10, 1000)]
    ]

    runtime = validation.analyze_pool_snapshots(snapshots, warmup_seconds=2)

    assert validation.pool_difference(before, after_exit)["NVRM"]["nonpaged_bytes"] == 0
    assert runtime["NVRM"]["nonpaged_bytes"]["delta"] == 400
    assert runtime["NVRM"]["nonpaged_bytes"]["slope_per_second"] == pytest.approx(50)


def test_missing_pool_tags_are_not_zero_allocations():
    snapshots = [
        {"elapsed_seconds": 0, "pool": {"tags": {}}},
        {"elapsed_seconds": 5, "pool": {"tags": {"NVRM": {"nonpaged_bytes": 150}}}},
        {"elapsed_seconds": 10, "pool": {"tags": {"NVRM": {"nonpaged_bytes": 200}}}},
        {"elapsed_seconds": 20, "pool": {"error": "sample unavailable"}},
    ]

    trend = validation.analyze_pool_snapshots(snapshots)["NVRM"]["nonpaged_bytes"]

    assert trend["points"] == 2
    assert trend["first"] == 150
    assert trend["last"] == 200
    assert trend["slope_per_second"] == pytest.approx(10)
    assert validation.pool_difference(snapshots[1]["pool"], snapshots[0]["pool"]) == {}
    assert validation.pool_difference(snapshots[0]["pool"], snapshots[1]["pool"]) == {}


def test_exit_code_zero_does_not_replace_native_handle_completion(monkeypatch):
    observed = []
    process = SimpleNamespace(_handle=99, returncode=0, poll=lambda: observed.append("poll"))
    monkeypatch.setattr(
        validation, "_wait_for_windows_handle",
        lambda handle, timeout: observed.append((handle, timeout)) or False,
    )

    assert validation.wait_for_exit(process, 0.25) is False
    assert observed == [(99, 0.25)]


def test_default_diagnostic_excludes_legacy_growth_reproducer(tmp_path):
    args = validation.build_parser().parse_args(["--output-dir", str(tmp_path / "diagnostic")])

    assert "legacy_B" not in args.cases
    assert "productionMonitor_D" in args.cases


def test_legacy_reproducer_rejects_more_than_300_cycles_before_launch(monkeypatch, tmp_path):
    output = tmp_path / "not-created"
    monkeypatch.setattr(validation, "os", SimpleNamespace(name="nt"))
    monkeypatch.setattr(validation.sys, "argv", [
        "nvml-validation", "--output-dir", str(output),
        "--cases", "legacy_B", "--cycles", "301",
    ])
    monkeypatch.setattr(
        validation, "supervisor_case",
        lambda *_args: pytest.fail("Rejected legacy case must not launch a child"),
    )

    with pytest.raises(SystemExit) as exc:
        validation.main()

    assert exc.value.code == 2
    assert not output.exists()


def test_launcher_completion_does_not_hide_running_redirected_worker(monkeypatch):
    calls = []
    launcher = SimpleNamespace(pid=10, _handle=100, returncode=0, poll=lambda: calls.append("poll"))
    child = validation.TrackedChild(pid=20, handle=200, owns_handle=True)
    monkeypatch.setattr(
        validation, "_wait_for_windows_handle",
        lambda handle, timeout: calls.append((handle, timeout)) or handle == 100,
    )

    assert validation.wait_for_owned_exit(launcher, child, 0.25) is False
    assert (200, 0.25) in calls
    assert (100, 0) in calls


def test_foreign_parent_pid_is_rejected_before_open_or_cleanup(monkeypatch):
    launcher = SimpleNamespace(pid=10, _handle=100)
    marker = {"pid": 20, "ppid": 999, "create_time": 123.0}
    monkeypatch.setattr(validation, "_process_identity", lambda pid: dict(marker))
    monkeypatch.setattr(
        validation, "_open_owned_handle",
        lambda pid: pytest.fail("Foreign process must not be opened"),
    )
    monkeypatch.setattr(
        validation, "_terminate_owned_handle",
        lambda handle: pytest.fail("Foreign process must not be terminated"),
    )

    with pytest.raises(ValueError, match="not created by this launcher"):
        validation.track_actual_child(launcher, marker)


def test_verified_redirected_worker_retains_its_own_handle(monkeypatch):
    launcher = SimpleNamespace(pid=10, _handle=100)
    marker = {"pid": 20, "ppid": 10, "create_time": 123.0}
    opened = []
    monkeypatch.setattr(validation, "_process_identity", lambda pid: dict(marker))
    monkeypatch.setattr(validation, "_open_owned_handle", lambda pid: opened.append(pid) or 200)

    child = validation.track_actual_child(launcher, marker)

    assert opened == [20]
    assert child.pid == 20
    assert child.handle == 200
    assert child.owns_handle is True


def test_pid_reuse_during_handle_acquisition_closes_handle_and_refuses_tracking(monkeypatch):
    launcher = SimpleNamespace(pid=10, _handle=100)
    marker = {"pid": 20, "ppid": 10, "create_time": 123.0}
    identities = iter([marker, {**marker, "create_time": 124.0}])
    closed = []
    monkeypatch.setattr(validation, "_process_identity", lambda pid: next(identities))
    monkeypatch.setattr(validation, "_open_owned_handle", lambda pid: 200)
    monkeypatch.setattr(validation, "_close_owned_handle", closed.append)

    with pytest.raises(ValueError, match="identity changed"):
        validation.track_actual_child(launcher, marker)

    assert closed == [200]
