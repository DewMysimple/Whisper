"""Explicit, bounded Windows NVML lifecycle/resource diagnostic; no ASR models.

Run with the project interpreter, for example:
  python tests/benchmark/run_nvml_lifecycle_validation.py --output-dir <new-dir>
  python tests/benchmark/run_nvml_lifecycle_validation.py --cases A retained_C productionMonitor_D --cycles 300 --output-dir <new-dir>

A disables GPU telemetry. legacy_B reproduces per-sample native init/shutdown;
retained_C keeps a reference session around the standalone collector; and
productionMonitor_D calls the actual PerformanceMonitor.sample()/close(). All
cases share the production getters. The default excludes legacy_B, whose cycle
count is capped at 300 because it deliberately reproduces driver resource growth.

Pool tags are system-wide: compare the running-process slopes with A, not just
the after-exit delta, and keep other GPU users idle during a comparison. Native
GPU calls run only in explicitly launched children, never on module import or
as part of the ordinary pytest suite. A failed case stops subsequent launches.
"""

from __future__ import annotations

import argparse
import ctypes
from ctypes import wintypes
from dataclasses import dataclass
import importlib
import json
import math
import os
from pathlib import Path
import statistics
import subprocess
import sys
import time
import traceback
from typing import Any


CASES = ("A", "legacy_B", "retained_C", "productionMonitor_D")
DEFAULT_CASES = ("A", "productionMonitor_D")
POOL_METRICS = ("paged_live", "paged_bytes", "nonpaged_live", "nonpaged_bytes")
CRITICAL_NVML_CALLS = {
    "nvmlInit", "nvmlShutdown", "nvmlDeviceGetHandleByIndex",
    "nvmlDeviceGetUtilizationRates", "nvmlDeviceGetMemoryInfo", "nvmlDeviceGetName",
}
OPTIONAL_NVML_ERRORS = {"NVMLError_NotSupported", "NVMLError_FunctionNotFound"}


def write_json(path: Path, value: Any) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(path)


def linear_trend(points: list[tuple[float, float]]) -> dict:
    """OLS rate at the actual observation times; never substitute exit deltas."""
    values = sorted((float(t), float(v)) for t, v in points if math.isfinite(t) and math.isfinite(v))
    if not values:
        return {"points": 0, "span_seconds": 0, "first": None, "last": None,
                "delta": None, "slope_per_second": None}
    origin = values[0][0]
    times = [t - origin for t, _ in values]
    mean_time = statistics.mean(times)
    mean_value = statistics.mean(v for _, v in values)
    denominator = sum((t - mean_time) ** 2 for t in times)
    slope = (
        sum((t - mean_time) * (v - mean_value) for t, (_, v) in zip(times, values)) / denominator
        if denominator else None
    )
    return {"points": len(values), "span_seconds": round(times[-1], 6),
            "first": values[0][1], "last": values[-1][1],
            "delta": values[-1][1] - values[0][1],
            "slope_per_second": round(slope, 6) if slope is not None else None}


def analyze_pool_snapshots(snapshots: list[dict], warmup_seconds: float = 0) -> dict:
    series: dict[str, dict[str, list[tuple[float, float]]]] = {}
    for snapshot in snapshots:
        elapsed = snapshot["elapsed_seconds"]
        if elapsed < warmup_seconds:
            continue
        for tag, counters in snapshot.get("pool", {}).get("tags", {}).items():
            for metric in POOL_METRICS:
                value = counters.get(metric)
                if isinstance(value, (int, float)):
                    series.setdefault(tag, {}).setdefault(metric, []).append((elapsed, value))
    # Missing tags are missing observations, not evidence of zero allocation.
    return {tag: {metric: linear_trend(points) for metric, points in metrics.items()}
            for tag, metrics in series.items()}


def pool_difference(before: dict, after: dict) -> dict:
    previous = before.get("tags", {})
    current = after.get("tags", {})
    return {tag: {key: current[tag][key] - previous[tag][key]
                  for key in previous[tag].keys() & current[tag].keys()}
            for tag in previous.keys() & current.keys()}


class PoolTag(ctypes.Structure):
    _fields_ = [("tag", ctypes.c_char * 4),
                ("paged_allocs", wintypes.ULONG), ("paged_frees", wintypes.ULONG),
                ("paged_bytes", ctypes.c_size_t),
                ("nonpaged_allocs", wintypes.ULONG), ("nonpaged_frees", wintypes.ULONG),
                ("nonpaged_bytes", ctypes.c_size_t)]


class PoolInformation(ctypes.Structure):
    _fields_ = [("count", wintypes.ULONG), ("tags", PoolTag * 1)]


def pool_tags() -> dict:
    """Read kernel counters without initializing NVML or touching CUDA."""
    query = ctypes.WinDLL("ntdll").NtQuerySystemInformation
    query.argtypes = [wintypes.ULONG, ctypes.c_void_p, wintypes.ULONG,
                      ctypes.POINTER(wintypes.ULONG)]
    query.restype = ctypes.c_long
    size = 1024 * 1024
    for _ in range(5):
        buffer = ctypes.create_string_buffer(size)
        required = wintypes.ULONG()
        status = query(22, buffer, size, ctypes.byref(required)) & 0xFFFFFFFF
        if status == 0xC0000004:
            size = max(size * 2, required.value + 65536)
            continue
        if status != 0:
            return {"error": f"NtQuerySystemInformation: 0x{status:08x}"}
        count = wintypes.ULONG.from_buffer(buffer).value
        offset = PoolInformation.tags.offset
        if offset + count * ctypes.sizeof(PoolTag) > len(buffer):
            return {"error": "Inconsistent kernel pool-tag buffer dimensions"}
        tags = {}
        for index in range(count):
            entry = PoolTag.from_buffer_copy(buffer, offset + index * ctypes.sizeof(PoolTag))
            tag = bytes(entry.tag).decode("ascii", errors="replace")
            if tag.upper().startswith(("NV", "DXG")):
                tags[tag] = {"paged_allocs": entry.paged_allocs, "paged_frees": entry.paged_frees,
                             "paged_live": (entry.paged_allocs - entry.paged_frees) & 0xFFFFFFFF,
                             "paged_bytes": entry.paged_bytes,
                             "nonpaged_allocs": entry.nonpaged_allocs,
                             "nonpaged_frees": entry.nonpaged_frees,
                             "nonpaged_live": (entry.nonpaged_allocs - entry.nonpaged_frees) & 0xFFFFFFFF,
                             "nonpaged_bytes": entry.nonpaged_bytes}
        return {"tags": tags, "total_tag_count": count}
    return {"error": "Kernel pool-tag buffer grew too quickly"}


class ReferenceNvmlProxy:
    """Reference B/C lifecycle only; D never uses this proxy."""

    def __init__(self, module: Any, retain: bool) -> None:
        self.module = module
        self.retain = retain
        self.initialized = False
        self.init_calls = self.shutdown_calls = 0
        self.collector_init_calls = self.collector_shutdown_calls = 0
        self.failure: str | None = None
        self.optional_errors: dict[str, int] = {}

    def _native(self, name: str, *args, **kwargs):
        try:
            return getattr(self.module, name)(*args, **kwargs)
        except Exception as error:
            label = type(error).__name__
            if name not in CRITICAL_NVML_CALLS and label in OPTIONAL_NVML_ERRORS:
                key = f"{name}:{label}"
                self.optional_errors[key] = self.optional_errors.get(key, 0) + 1
            else:
                self.failure = f"{name}: {label}: {error}"
            raise

    def begin(self) -> None:
        if self.retain:
            self._native("nvmlInit")
            self.init_calls += 1
            self.initialized = True

    def nvmlInit(self) -> None:
        self.collector_init_calls += 1
        if not self.retain:
            self._native("nvmlInit")
            self.init_calls += 1
            self.initialized = True

    def nvmlShutdown(self) -> None:
        self.collector_shutdown_calls += 1
        if not self.retain:
            self._native("nvmlShutdown")
            self.shutdown_calls += 1
            self.initialized = False

    def close(self) -> None:
        if self.initialized:
            self._native("nvmlShutdown")
            self.shutdown_calls += 1
            self.initialized = False

    def __getattr__(self, name: str):
        value = getattr(self.module, name)
        return (lambda *a, **kw: self._native(name, *a, **kw)) if callable(value) else value


def child_case(args) -> int:
    import psutil
    from whisper_subtitle.infrastructure.performance import PerformanceMonitor, collect_performance_sample

    output = args.output_dir.resolve()
    output.mkdir(parents=True, exist_ok=True)
    result = {"case": args.child_case, "pid": os.getpid(), "ppid": os.getppid(),
              "create_time": psutil.Process().create_time(), "cycles": args.cycles,
              "interval_seconds": args.interval, "status": "running", "samples": [],
              "kernel_snapshots": []}
    write_json(output / "child-start.json", result)
    started = time.monotonic()
    proxy = monitor = None
    try:
        # A Windows venv python.exe may be only a launcher. Do not initialize
        # NVML until the supervisor has retained this actual process handle.
        ownership_deadline = time.monotonic() + args.ownership_timeout
        ready_path = output / "supervisor-ready.json"
        while not ready_path.exists():
            if time.monotonic() >= ownership_deadline:
                raise TimeoutError("Supervisor did not retain the actual child handle")
            time.sleep(0.05)
        if json.loads(ready_path.read_text(encoding="utf-8")).get("pid") != os.getpid():
            raise RuntimeError("Supervisor ownership acknowledgement did not match this child")
        if args.child_case == "productionMonitor_D":
            # Exercise the actual Worker-owned implementation, including its
            # default native loader. No patched loader or reference proxy here.
            monitor = PerformanceMonitor()
            sample = monitor.sample
            result["sampling_api"] = "PerformanceMonitor.sample()/close()"
        else:
            if args.child_case == "A":
                def load_nvml():
                    raise RuntimeError("GPU telemetry deliberately disabled by case A")
            else:
                proxy = ReferenceNvmlProxy(importlib.import_module("pynvml"), args.child_case == "retained_C")
                proxy.begin()
                load_nvml = lambda: proxy
            sample = lambda: collect_performance_sample(nvml_loader=load_nvml)
            result["sampling_api"] = "collect_performance_sample (shared production getters)"
        process = psutil.Process()
        sampling_started = next_sample_at = time.monotonic()
        next_pool_at = sampling_started
        for index in range(args.cycles):
            remaining = next_sample_at - time.monotonic()
            if remaining > 0:
                time.sleep(remaining)
            before = time.monotonic()
            snapshot = sample()
            elapsed = time.monotonic() - before
            if proxy is not None and proxy.failure is not None:
                raise RuntimeError(proxy.failure)
            if args.child_case != "A" and any(snapshot.get(k) is None for k in ("gpu_percent", "gpu_name", "vram_used_gib")):
                raise RuntimeError("Native GPU snapshot is incomplete; do not hide collection failure")
            result["samples"].append({"index": index, "elapsed_seconds": time.monotonic() - sampling_started,
                                      "sampling_ms": round(elapsed * 1000, 4),
                                      "rss_bytes": process.memory_info().rss, "handles": process.num_handles(),
                                      "threads": process.num_threads(), "gpu_percent": snapshot["gpu_percent"]})
            now = time.monotonic()
            if now >= next_pool_at or index == args.cycles - 1:
                pool = pool_tags()
                if "error" in pool:
                    raise RuntimeError(pool["error"])
                result["kernel_snapshots"].append({"elapsed_seconds": now - sampling_started, "pool": pool})
                next_pool_at = now + args.pool_interval
                write_json(output / "child-progress.json", result)
            next_sample_at = max(next_sample_at + args.interval, time.monotonic())
        result["status"] = "ok"
    except BaseException as error:
        result.update(status="error", error=f"{type(error).__name__}: {error}", traceback=traceback.format_exc())
    finally:
        try:
            if monitor is not None:
                monitor.close()
            if proxy is not None:
                proxy.close()
        except Exception as error:
            result.update(status="error", cleanup_error=f"{type(error).__name__}: {error}")
        if proxy is not None:
            result.update(native_init_calls=proxy.init_calls, native_shutdown_calls=proxy.shutdown_calls,
                          collector_init_calls=proxy.collector_init_calls,
                          collector_shutdown_calls=proxy.collector_shutdown_calls,
                          optional_unsupported_errors=proxy.optional_errors)
        result["elapsed_seconds"] = time.monotonic() - started
        write_json(output / "child-result.json", result)
    return 0 if result["status"] == "ok" else 1


def _wait_for_windows_handle(handle: int, timeout: float) -> bool:
    wait = ctypes.WinDLL("kernel32", use_last_error=True).WaitForSingleObject
    wait.argtypes = [wintypes.HANDLE, wintypes.DWORD]
    wait.restype = wintypes.DWORD
    value = wait(handle, max(0, min(0xFFFFFFFE, int(timeout * 1000))))
    if value == 0:
        return True
    if value == 258:
        return False
    raise ctypes.WinError(ctypes.get_last_error())


def wait_for_exit(process: subprocess.Popen, timeout: float) -> bool:
    # Retain the Popen-owned handle instead of reopening a PID that may have
    # disappeared or been reused. An exit code of zero is not a signaled handle.
    signaled = _wait_for_windows_handle(int(process._handle), timeout)
    if signaled:
        process.poll()
    return signaled


@dataclass(frozen=True)
class TrackedChild:
    pid: int
    handle: int
    owns_handle: bool


def _process_identity(pid: int) -> dict:
    import psutil
    process = psutil.Process(pid)
    return {"pid": process.pid, "ppid": process.ppid(), "create_time": process.create_time()}


def _open_owned_handle(pid: int) -> int:
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel.OpenProcess.restype = wintypes.HANDLE
    # Called only after checking PPID/creation time. Retain terminate rights on
    # this owned child so bounded cleanup never has to reopen a reused PID.
    handle = kernel.OpenProcess(0x00100000 | 0x1000 | 0x0001, False, pid)
    if not handle:
        raise ctypes.WinError(ctypes.get_last_error())
    return handle


def _close_owned_handle(handle: int) -> None:
    close = ctypes.WinDLL("kernel32", use_last_error=True).CloseHandle
    close.argtypes = [wintypes.HANDLE]
    close.restype = wintypes.BOOL
    if not close(handle):
        raise ctypes.WinError(ctypes.get_last_error())


def _terminate_owned_handle(handle: int) -> None:
    terminate = ctypes.WinDLL("kernel32", use_last_error=True).TerminateProcess
    terminate.argtypes = [wintypes.HANDLE, wintypes.UINT]
    terminate.restype = wintypes.BOOL
    if not terminate(handle, 1):
        raise ctypes.WinError(ctypes.get_last_error())


def _exit_code_for_handle(handle: int) -> int:
    query = ctypes.WinDLL("kernel32", use_last_error=True).GetExitCodeProcess
    query.argtypes = [wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD)]
    query.restype = wintypes.BOOL
    code = wintypes.DWORD()
    if not query(handle, ctypes.byref(code)):
        raise ctypes.WinError(ctypes.get_last_error())
    return code.value


def track_actual_child(launcher: subprocess.Popen, marker: dict) -> TrackedChild:
    """Bind self-reported identity to our launcher before opening any handle."""
    pid = marker.get("pid")
    if not isinstance(pid, int) or isinstance(pid, bool) or pid <= 0:
        raise ValueError("Invalid child-start PID")
    identity = _process_identity(pid)
    if identity["ppid"] != marker.get("ppid") or identity["create_time"] != marker.get("create_time"):
        raise ValueError("Child-start identity no longer matches the process")
    if pid == launcher.pid:
        return TrackedChild(pid, int(launcher._handle), False)
    if identity["ppid"] != launcher.pid:
        raise ValueError("Refusing to track a child not created by this launcher")
    handle = _open_owned_handle(pid)
    try:
        if _process_identity(pid) != identity:
            raise ValueError("Child identity changed while opening its handle")
    except BaseException:
        _close_owned_handle(handle)
        raise
    return TrackedChild(pid, handle, True)


def wait_for_owned_exit(launcher: subprocess.Popen, child: TrackedChild, timeout: float) -> bool:
    if not child.owns_handle:
        return wait_for_exit(launcher, timeout)
    actual_signaled = _wait_for_windows_handle(child.handle, timeout)
    launcher_signaled = wait_for_exit(launcher, 0)
    return actual_signaled and launcher_signaled


def cleanup_owned_processes(launcher: subprocess.Popen, child: TrackedChild | None) -> dict:
    """Terminate only verified owned handles; cap the combined wait at 3s."""
    children = [child] if child is not None else []
    diagnostics: dict[str, Any] = {"processes": []}
    if child is None:
        # A startup/import failure may precede child-start.json. Recover only
        # direct children of our still-owned launcher, with the same identity
        # checks as the normal handshake. Never kill by executable name.
        try:
            import psutil
            for descendant in psutil.process_iter(["pid", "ppid"]):
                if descendant.info["ppid"] == launcher.pid:
                    children.append(track_actual_child(launcher, _process_identity(descendant.pid)))
        except Exception as error:
            diagnostics["child_discovery_error"] = f"{type(error).__name__}: {error}"
    owned = {int(launcher._handle): (launcher.pid, False)}
    owned.update({item.handle: (item.pid, item.owns_handle) for item in children})
    deadline = time.monotonic() + 3
    try:
        for handle, (pid, _) in owned.items():
            entry: dict[str, Any] = {"pid": pid}
            diagnostics["processes"].append(entry)
            try:
                signaled = _wait_for_windows_handle(handle, 0)
                if not signaled:
                    try:
                        _terminate_owned_handle(handle)
                        entry["terminate_requested"] = True
                    except Exception as error:
                        entry["terminate_error"] = f"{type(error).__name__}: {error}"
                entry["signaled_before_cleanup"] = signaled
            except Exception as error:
                entry["inspection_error"] = f"{type(error).__name__}: {error}"
        for entry, handle in zip(diagnostics["processes"], owned):
            try:
                entry["signaled_after_cleanup"] = _wait_for_windows_handle(handle, max(0, deadline - time.monotonic()))
                if not entry["signaled_after_cleanup"]:
                    entry["residual_process"] = optional(lambda: process_snapshot(entry["pid"]))
            except Exception as error:
                entry["cleanup_error"] = f"{type(error).__name__}: {error}"
        diagnostics["all_handles_signaled"] = (
            not diagnostics.get("child_discovery_error")
            and all(entry.get("signaled_after_cleanup") for entry in diagnostics["processes"])
        )
    finally:
        # The ordinary child is closed by its supervisor; release only handles
        # opened by failure-time discovery here.
        for item in children:
            if item is not child and item.owns_handle:
                _close_owned_handle(item.handle)
    return diagnostics


def optional(call):
    try:
        return call()
    except Exception as error:
        return {"error": f"{type(error).__name__}: {error}"}


def process_snapshot(pid: int) -> dict:
    import psutil
    process = psutil.Process(pid)
    return {"pid": pid, "rss_bytes": optional(lambda: process.memory_info().rss),
            "handles": optional(process.num_handles), "threads": optional(process.num_threads),
            "cpu_times": optional(lambda: process.cpu_times()._asdict())}


def owned_process_residuals(launcher_pid: int, actual_pid: int) -> list[dict]:
    import psutil
    owned_pids = {launcher_pid, actual_pid}
    return [process.info for process in psutil.process_iter(["pid", "ppid", "name"])
            if process.info["pid"] in owned_pids or process.info["ppid"] in owned_pids]


def supervisor_case(args, case: str, output: Path) -> dict:
    output.mkdir(parents=True, exist_ok=False)
    result = {"case": case, "status": "running", "snapshots": [], "pool_before": pool_tags()}
    write_json(output / "supervisor-result.json", result)
    if "error" in result["pool_before"]:
        result.update(status="error", error=result["pool_before"]["error"])
        write_json(output / "supervisor-result.json", result)
        return result
    command = [sys.executable, str(Path(__file__).resolve()), "--child-case", case,
               "--cycles", str(args.cycles), "--interval", str(args.interval),
               "--pool-interval", str(args.pool_interval),
               "--ownership-timeout", str(args.ownership_timeout), "--output-dir", str(output)]
    started = time.monotonic()
    process = None
    actual_child = None
    with (output / "child.log").open("w", encoding="utf-8") as log:
        try:
            process = subprocess.Popen(command, stdout=log, stderr=subprocess.STDOUT,
                                       creationflags=subprocess.CREATE_NO_WINDOW)
            result["launcher_pid"] = process.pid
            result["real_handle_signaled"] = False
            done_seen_at = None
            next_snapshot = started
            deadline = started + (args.execution_timeout or args.cycles * args.interval + 45)
            while True:
                if actual_child is None:
                    start_path = output / "child-start.json"
                    if start_path.exists():
                        marker = json.loads(start_path.read_text(encoding="utf-8"))
                        result["reported_child_identity"] = {key: marker.get(key) for key in ("pid", "ppid", "create_time")}
                        actual_child = track_actual_child(process, marker)
                        result.update(pid=actual_child.pid, actual_pid=actual_child.pid,
                                      actual_child_identity_verified=True)
                        write_json(output / "supervisor-ready.json", {"pid": actual_child.pid})
                    elif wait_for_exit(process, 0.2):
                        raise RuntimeError("Launcher exited before reporting the actual child identity")
                if actual_child is not None and wait_for_owned_exit(process, actual_child, 0.2):
                    result.update(real_handle_signaled=True, actual_handle_signaled=True,
                                  launcher_handle_signaled=True, exit_code=process.returncode,
                                  actual_exit_code=_exit_code_for_handle(actual_child.handle))
                    child_path = output / "child-result.json"
                    child = json.loads(child_path.read_text(encoding="utf-8")) if child_path.exists() else {}
                    result["child_status"] = child.get("status", "no child result")
                    residuals = owned_process_residuals(process.pid, actual_child.pid)
                    result["remaining_owned_processes"] = residuals
                    valid_child = child.get("pid") == actual_child.pid and child.get("case") == case
                    result["status"] = (
                        "ok" if process.returncode == result["actual_exit_code"] == 0
                        and child.get("status") == "ok" and valid_child and not residuals else "error"
                    )
                    break
                now = time.monotonic()
                if now >= next_snapshot:
                    pool = pool_tags()
                    inspected_pid = actual_child.pid if actual_child is not None else process.pid
                    result["snapshots"].append({"elapsed_seconds": now - started,
                                                "process_kind": "actual_child" if actual_child is not None else "launcher",
                                                "process": optional(lambda: process_snapshot(inspected_pid)), "pool": pool})
                    next_snapshot = now + args.pool_interval
                    write_json(output / "supervisor-progress.json", result)
                    if "error" in pool:
                        raise RuntimeError(pool["error"])
                if done_seen_at is None and (output / "child-result.json").exists():
                    done_seen_at = now
                if (now >= deadline or (actual_child is None and now - started >= args.ownership_timeout)
                        or (done_seen_at is not None and now - done_seen_at >= args.exit_timeout)):
                    # poll() is advisory here; Windows can report exit code 0
                    # while a driver's terminating process thread still runs.
                    result.update(status="timeout", real_handle_signaled=False,
                                  advisory_exit_code=process.poll(),
                                  launcher_handle_signaled=wait_for_exit(process, 0),
                                  actual_handle_signaled=(
                                      _wait_for_windows_handle(actual_child.handle, 0)
                                      if actual_child is not None else None),
                                  actual_advisory_exit_code=(
                                      optional(lambda: _exit_code_for_handle(actual_child.handle))
                                      if actual_child is not None else None),
                                  residual_process=optional(lambda: process_snapshot(
                                      actual_child.pid if actual_child is not None else process.pid)))
                    break
        except Exception as error:
            result.update(status="error", error=f"{type(error).__name__}: {error}", traceback=traceback.format_exc())
        finally:
            if process is not None and result["status"] != "ok":
                try:
                    cleanup = cleanup_owned_processes(process, actual_child)
                    result["cleanup"] = cleanup
                    result["real_handle_signaled_after_cleanup"] = cleanup["all_handles_signaled"]
                except Exception as error:
                    result["cleanup_error"] = f"{type(error).__name__}: {error}"
            if actual_child is not None and actual_child.owns_handle:
                try:
                    _close_owned_handle(actual_child.handle)
                except Exception as error:
                    result.update(status="error", handle_close_error=f"{type(error).__name__}: {error}")
    result["elapsed_seconds"] = time.monotonic() - started
    result["pool_after"] = pool_tags()
    result["pool_delta_after_exit"] = pool_difference(result["pool_before"], result["pool_after"])
    if "error" in result["pool_after"]:
        result.update(status="error", pool_after_error=result["pool_after"]["error"])
    child_path = output / "child-result.json"
    if not child_path.exists():
        # A blocked native close or bounded termination may prevent a final
        # child report. Preserve the last atomically written running samples.
        child_path = output / "child-progress.json"
    result["child_measurements_source"] = child_path.name if child_path.exists() else None
    child = json.loads(child_path.read_text(encoding="utf-8")) if child_path.exists() else {}
    runtime = child.get("kernel_snapshots", [])
    result["pool_runtime"] = analyze_pool_snapshots(runtime)
    result["pool_steady_state"] = analyze_pool_snapshots(runtime, args.warmup_seconds)
    result["warmup_seconds"] = args.warmup_seconds
    result["sample_count"] = len(child.get("samples", []))
    latencies = [sample["sampling_ms"] for sample in child.get("samples", [])]
    result["sampling_ms_median"] = statistics.median(latencies) if latencies else None
    write_json(output / "supervisor-result.json", result)
    return result


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--cases", choices=CASES, nargs="+", default=list(DEFAULT_CASES))
    parser.add_argument("--cycles", type=int, default=120)
    parser.add_argument("--interval", type=float, default=0.190)
    parser.add_argument("--pool-interval", type=float, default=1)
    parser.add_argument("--warmup-seconds", type=float, default=2)
    parser.add_argument("--exit-timeout", type=float, default=10)
    parser.add_argument("--execution-timeout", type=float)
    parser.add_argument("--ownership-timeout", type=float, default=15)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--child-case", choices=CASES, help=argparse.SUPPRESS)
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    if os.name != "nt":
        parser.error("This diagnostic requires Windows process handles and kernel pool tags")
    if not 1 <= args.cycles <= 3000 or not 0.05 <= args.interval <= 5 or args.cycles * args.interval > 600:
        parser.error("Use 1..3000 cycles, 0.05..5s interval, and at most 600s of sampling")
    cases = [args.child_case] if args.child_case else args.cases
    if "legacy_B" in cases and args.cycles > 300:
        parser.error("legacy_B deliberately reproduces driver allocation growth; maximum 300 cycles")
    if not 0.2 <= args.pool_interval <= 5 or not 0 <= args.warmup_seconds <= 60:
        parser.error("Use 0.2..5s pool interval and 0..60s warmup")
    if not 0 < args.exit_timeout <= 30 or (args.execution_timeout is not None and not 0 < args.execution_timeout <= 900):
        parser.error("Exit timeout must be 0..30s and execution timeout 0..900s (exclusive of zero)")
    if not 0 < args.ownership_timeout <= 30:
        parser.error("Ownership handshake timeout must be 0..30s (exclusive of zero)")
    if args.child_case:
        return child_case(args)
    args.output_dir = args.output_dir.resolve()
    if args.output_dir.exists():
        parser.error(f"Refusing to overwrite existing diagnostics: {args.output_dir}")
    args.output_dir.mkdir(parents=True)
    outcomes = []
    for case in args.cases:
        output = args.output_dir / f"case-{case}"
        print(json.dumps({"event": "case-start", "case": case, "directory": str(output)}), flush=True)
        outcome = supervisor_case(args, case, output)
        outcomes.append(outcome)
        write_json(args.output_dir / "summary.json", outcomes)
        print(json.dumps({"event": "case-end", "case": case, "status": outcome["status"],
                          "pid": outcome.get("pid"), "seconds": outcome.get("elapsed_seconds"),
                          "real_handle_signaled": outcome.get("real_handle_signaled"),
                          "NVRM_runtime": outcome.get("pool_steady_state", {}).get("NVRM")}), flush=True)
        if outcome["status"] != "ok":
            print("Stopped subsequent cases after failure; retain diagnostics.", flush=True)
            return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
