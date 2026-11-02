"""Explicit ownership of one lazy, serialized NVML library session."""

from __future__ import annotations

import threading
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from typing import Any


class NvmlSession:
    """Keep NVML initialized across queries until its owner closes the session.

    Initialization is attempted at most once. An unavailable driver must not be
    initialized again on every metrics tick. Closing is terminal and waits for
    an in-flight query before releasing the native reference exactly once.
    """

    def __init__(self, loader: Callable[[], Any]) -> None:
        self._loader = loader
        self._lock = threading.Lock()
        self._attempted = False
        self._closed = False
        self._module: Any | None = None

    @contextmanager
    def use(self) -> Iterator[Any | None]:
        with self._lock:
            if not self._closed and not self._attempted:
                self._attempted = True
                try:
                    module = self._loader()
                    module.nvmlInit()
                except Exception:
                    # GPU telemetry is optional; retain the failed attempt so
                    # the next 190 ms tick cannot create another native client.
                    pass
                else:
                    self._module = module
            yield self._module

    def close(self) -> None:
        with self._lock:
            if self._closed:
                return
            self._closed = True
            module, self._module = self._module, None
            if module is not None:
                try:
                    module.nvmlShutdown()
                except Exception:
                    # Never mask model cleanup or transcription errors, and do
                    # not reopen/retry a native session while the owner exits.
                    pass
