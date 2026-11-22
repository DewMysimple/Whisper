"""Bounded, cancellable container probes with the Worker's stat-based cache."""

from __future__ import annotations

import json
import math
import os
import stat as stat_module
import subprocess
import sys
import threading
import time
from collections.abc import Callable, Sequence
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from dataclasses import dataclass
from pathlib import Path
from queue import Empty, SimpleQueue

from ..infrastructure.media_probe import ProbeResult
from ..infrastructure.media_files import SUPPORTED_MEDIA_EXTENSIONS
from .runtime_types import MediaDurationProbe


PROBE_WORKERS = 2
PROBE_TIMEOUT_SECONDS = 8.0
_MAX_INSPECTIONS = 8
_CANCELLED = ProbeResult(False, None, "媒体检查已取消", "media.cancelled")


class ProbeProcess:
    """One persistent PyAV process per slot, discarded on interruption."""

    def __init__(
        self,
        *,
        command: Sequence[str] | None = None,
        timeout: float = PROBE_TIMEOUT_SECONDS,
    ) -> None:
        self._environment = None
        if command is not None:
            self._command = command
        elif getattr(sys, "frozen", False):
            self._command = [sys.executable, "--media-probe"]
        else:
            executable = sys.executable
            if os.name == "nt" and sys.prefix != sys.base_prefix:
                # The Windows venv executable is a launcher with an additional
                # child. Start CPython directly so that the handle we terminate
                # belongs to the process executing PyAV.
                executable = sys._base_executable
                self._environment = {**os.environ, "__PYVENV_LAUNCHER__": sys.executable}
            self._command = [executable, "-m", "whisper_subtitle.infrastructure.media_probe"]
        self._timeout = timeout
        self._child: subprocess.Popen[bytes] | None = None
        self._reader: threading.Thread | None = None
        self._requests: SimpleQueue[bytes | None] = SimpleQueue()
        self._replies: SimpleQueue[bytes] = SimpleQueue()
        self._closing = False

    def _start(self) -> None:
        child = subprocess.Popen(
            self._command,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
            env=self._environment,
        )
        self._child = child
        self._requests = SimpleQueue()
        self._replies = SimpleQueue()
        assert child.stdin is not None and child.stdout is not None
        writer, reader = child.stdin, child.stdout
        requests, replies = self._requests, self._replies

        def exchange() -> None:
            try:
                while (request := requests.get()) is not None:
                    writer.write(request)
                    writer.flush()
                    reply = reader.readline()
                    if not reply:
                        break
                    replies.put(reply)
            except OSError:
                pass
            finally:
                replies.put(b"")

        self._reader = threading.Thread(target=exchange, name="media-probe-pipe", daemon=True)
        self._reader.start()

    def probe(self, path: Path, cancelled: Callable[[], bool]) -> ProbeResult:
        deadline = time.monotonic() + self._timeout
        try:
            if self._closing and not self.close():
                return ProbeResult(False, None, "上一媒体探测进程尚未退出", "media.probe_unavailable")
            if self._child is None:
                self._start()
            self._requests.put((json.dumps(str(path)) + "\n").encode("ascii"))
            while True:
                if cancelled():
                    self.close()
                    return _CANCELLED
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    self.close()
                    return ProbeResult(False, None, "媒体容器检查超时", "media.timeout")
                try:
                    reply = self._replies.get(timeout=min(remaining, 0.05))
                except Empty:
                    continue
                return ProbeResult(*json.loads(reply))
        except (OSError, ValueError, TypeError) as exc:
            self.close()
            return ProbeResult(False, None, str(exc), "media.probe_unavailable")

    def close(self) -> bool:
        child, reader = self._child, self._reader
        if child is None:
            return True
        self._closing = True
        self._requests.put(None)
        try:
            child.kill()
            child.wait(timeout=0.75)
        except (OSError, subprocess.TimeoutExpired):
            # Keep the existing child slot until its handle is signalled. In
            # the desktop app the Host's Job Object also owns this process.
            return False
        if reader is not None:
            reader.join(timeout=0.1)
            if reader.is_alive():
                return False
        assert child.stdin is not None and child.stdout is not None
        child.stdin.close()
        child.stdout.close()
        self._child = self._reader = None
        self._closing = False
        return True


@dataclass(frozen=True)
class Inspection:
    result: ProbeResult
    cache_hit: bool
    queue_ms: float
    elapsed_ms: float

    def payload(self, path: Path, *, diagnostics: bool) -> dict:
        item = {
            "path": str(path),
            "readable": self.result.readable,
            "duration_seconds": self.result.duration,
            "error": self.result.error,
        }
        if diagnostics:
            item.update(
                error_code=self.result.code,
                cache_hit=self.cache_hit,
                queue_ms=self.queue_ms,
                elapsed_ms=self.elapsed_ms,
            )
        return item


class MediaInspector:
    def __init__(self, probe: MediaDurationProbe | None, *, workers: int = PROBE_WORKERS) -> None:
        self._override = probe
        self._workers = workers
        self._probes = ThreadPoolExecutor(max_workers=workers, thread_name_prefix="media-probe")
        self._batches = ThreadPoolExecutor(max_workers=2, thread_name_prefix="media-inspection")
        self._local = threading.local()
        self._children: list[ProbeProcess] = []
        self._condition = threading.Condition()
        self._cache: dict[str, tuple[int, int, ProbeResult]] = {}
        self._pending: set[str] = set()
        self._jobs: dict[str, threading.Event] = {}
        self._stopped = threading.Event()

    def submit(
        self, request_id: str, run: Callable[[threading.Event], None]
    ) -> bool:
        with self._condition:
            if (
                self._stopped.is_set()
                or request_id in self._jobs
                or len(self._jobs) >= _MAX_INSPECTIONS
            ):
                return False
            cancel = self._jobs[request_id] = threading.Event()

        def run_batch() -> None:
            try:
                run(cancel)
            finally:
                with self._condition:
                    del self._jobs[request_id]

        self._batches.submit(run_batch)
        return True

    def cancel(self, request_id: str) -> bool:
        with self._condition:
            cancel = self._jobs.get(request_id)
            if cancel is None:
                return False
            cancel.set()
            self._condition.notify_all()
            return True

    def inspect(
        self,
        paths: Sequence[Path],
        cancel: threading.Event | None = None,
        progress: Callable[[int, Inspection], None] | None = None,
        flush_progress: Callable[[], None] | None = None,
    ) -> list[Inspection]:
        began = time.monotonic()
        checks = iter(enumerate(paths))
        results = [Inspection(_CANCELLED, False, 0, 0)] * len(paths)

        def cancelled() -> bool:
            return self._stopped.is_set() or (cancel is not None and cancel.is_set())

        def start_next() -> None:
            if cancelled():
                return
            item = next(checks, None)
            if item is not None:
                index, path = item
                running[self._probes.submit(self._inspect_one, path, began, cancelled)] = index

        running = {}
        for _ in range(self._workers):
            start_next()
        while running:
            completed, _pending = wait(
                running,
                timeout=0.04 if flush_progress is not None else None,
                return_when=FIRST_COMPLETED,
            )
            if not completed and flush_progress is not None and not cancelled():
                flush_progress()
            for future in completed:
                index = running.pop(future)
                results[index] = future.result()
                if progress is not None and not cancelled():
                    progress(index, results[index])
                start_next()
        return results

    def _inspect_one(
        self, path: Path, queued: float, cancelled: Callable[[], bool]
    ) -> Inspection:
        began = time.monotonic()

        def record(result: ProbeResult, *, hit: bool = False) -> Inspection:
            return Inspection(result, hit, (began - queued) * 1000, (time.monotonic() - began) * 1000)

        if cancelled():
            return record(_CANCELLED)
        try:
            resolved = path.resolve(strict=True)
            stat = resolved.stat()
        except FileNotFoundError as exc:
            return record(ProbeResult(False, None, str(exc), "media.not_found"))
        except PermissionError as exc:
            return record(ProbeResult(False, None, str(exc), "media.access_denied"))
        except (OSError, RuntimeError) as exc:
            return record(ProbeResult(False, None, str(exc), "media.path_unavailable"))
        if not stat_module.S_ISREG(stat.st_mode) or resolved.suffix.lower() not in SUPPORTED_MEDIA_EXTENSIONS:
            return record(ProbeResult(False, None, "不支持此媒体类型", "media.unsupported"))
        key = str(resolved).casefold()
        with self._condition:
            while key in self._pending and not cancelled():
                self._condition.wait(timeout=0.05)
            if cancelled():
                return record(_CANCELLED)
            cached = self._cache.get(key)
            if cached is not None and cached[:2] == (stat.st_size, stat.st_mtime_ns):
                return record(cached[2], hit=True)
            self._pending.add(key)
        try:
            if self._override is not None:
                readable, duration, error = self._override(resolved)
                result = ProbeResult(readable, duration, error, None if readable else "media.unreadable")
            else:
                child = getattr(self._local, "child", None)
                if child is None:
                    child = self._local.child = ProbeProcess()
                    with self._condition:
                        self._children.append(child)
                result = child.probe(resolved, cancelled)
            if cancelled():
                return record(_CANCELLED)
            if result.duration is not None:
                duration = float(result.duration)
                result = result._replace(duration=duration if math.isfinite(duration) and duration >= 0 else None)
            if result.readable:
                with self._condition:
                    self._cache[key] = (stat.st_size, stat.st_mtime_ns, result)
            return record(result)
        finally:
            with self._condition:
                self._pending.remove(key)
                self._condition.notify_all()

    def stop(self) -> None:
        with self._condition:
            self._stopped.set()
            for cancel in self._jobs.values():
                cancel.set()
            self._condition.notify_all()

    def close(self) -> None:
        self.stop()
        self._batches.shutdown(wait=True)
        self._probes.shutdown(wait=True)
        for child in self._children:
            child.close()
