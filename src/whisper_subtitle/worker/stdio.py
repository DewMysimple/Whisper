"""UTF-8 JSON-lines transport for the persistent Python Worker."""

from __future__ import annotations

import json
import logging
import os
import re
import stat
import sys
import threading
import time
from collections.abc import Callable
from queue import SimpleQueue
from typing import TextIO

from ..protocol import (
    CommandMessage,
    CommandMethod,
    ErrorCode,
    ErrorMessage,
    ProtocolValidationError,
    encode_protocol_message,
    parse_protocol_line,
    protocol_error_from_exception,
)
from .runtime import (
    DEFAULT_MODEL_IDLE_TIMEOUT_SECONDS,
    WorkerCommandError,
    WorkerRuntime,
    worker_ready_event,
)


_IDENTIFIER_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
RuntimeFactory = Callable[..., WorkerRuntime]


class ProtocolWriter:
    """Serialize complete protocol lines from command and task threads."""

    def __init__(self, stream: TextIO) -> None:
        self._stream = stream
        self._lock = threading.Lock()

    def emit(self, message) -> None:
        line = encode_protocol_message(message)
        with self._lock:
            self._stream.write(line + "\n")
            self._stream.flush()


def _best_effort_request_id(line: str) -> str | None:
    try:
        value = json.loads(line)
    except (TypeError, json.JSONDecodeError):
        return None
    if not isinstance(value, dict):
        return None
    request_id = value.get("request_id")
    if isinstance(request_id, str) and _IDENTIFIER_PATTERN.fullmatch(request_id):
        return request_id
    return None


def _configure_stream_encoding(stream: TextIO, *, input_stream: bool = False) -> None:
    reconfigure = getattr(stream, "reconfigure", None)
    if reconfigure is None:
        return
    kwargs = {"encoding": "utf-8", "errors": "strict"}
    if not input_stream:
        kwargs["newline"] = "\n"
    try:
        reconfigure(**kwargs)
    except (OSError, TypeError, ValueError):
        # Packaged or test streams may not permit reconfiguration. The host still
        # launches the production process with UTF-8 pipes.
        pass


def _worker_logger(stream: TextIO) -> logging.Logger:
    logger = logging.getLogger("whisper_subtitle.worker")
    logger.handlers.clear()
    handler = logging.StreamHandler(stream)
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)
    logger.propagate = False
    return logger


def _command_lines(stdin: TextIO):
    if sys.platform != "win32":
        yield from stdin
        return
    try:
        descriptor = stdin.fileno()
        is_pipe = stat.S_ISFIFO(os.fstat(descriptor).st_mode)
    except (AttributeError, OSError, ValueError):
        is_pipe = False
    if not is_pipe:
        yield from stdin
        return

    # A blocking text-stream read on Windows can hold a native initialization
    # lock needed by NumPy/CTranslate2, even when the reader is a different
    # thread. Only read bytes already available in the Host's anonymous pipe.
    from ctypes import POINTER, WinDLL, byref, get_last_error
    from ctypes import wintypes
    from msvcrt import get_osfhandle

    peek = WinDLL("kernel32", use_last_error=True).PeekNamedPipe
    peek.argtypes = [wintypes.HANDLE, wintypes.LPVOID, wintypes.DWORD,
                     POINTER(wintypes.DWORD), POINTER(wintypes.DWORD), POINTER(wintypes.DWORD)]
    peek.restype = wintypes.BOOL
    handle = get_osfhandle(descriptor)
    available = wintypes.DWORD()
    pending = bytearray()
    while True:
        if not peek(handle, None, 0, None, byref(available), None):
            error = get_last_error()
            if error in {109, 232, 233}:  # Broken, closing, or disconnected pipe.
                break
            raise OSError(error, "Cannot read Worker command pipe")
        if available.value == 0:
            time.sleep(0.01)
            continue
        block = os.read(descriptor, min(65536, available.value))
        if not block:
            break
        pieces = block.split(b"\n")
        pending.extend(pieces[0])
        if len(pieces) > 1:
            yield pending.decode("utf-8", errors="strict")
            for line in pieces[1:-1]:
                yield line.decode("utf-8", errors="strict")
            pending = bytearray(pieces[-1])
    if pending:
        yield pending.decode("utf-8", errors="strict")


def _read_commands(
    stdin: TextIO,
    commands: SimpleQueue[CommandMessage | ErrorMessage | None],
    runtime: WorkerRuntime,
    logger: logging.Logger,
) -> None:
    try:
        for raw_line in _command_lines(stdin):
            line = raw_line.rstrip("\r\n")
            try:
                command = parse_protocol_line(line)
                if not isinstance(command, CommandMessage):
                    raise ProtocolValidationError(
                        ErrorCode.PROTOCOL_INVALID_MESSAGE,
                        "worker stdin accepts command messages only",
                    )
            except ProtocolValidationError as exc:
                commands.put(protocol_error_from_exception(exc, request_id=_best_effort_request_id(line)))
                continue
            if command.method is CommandMethod.TRANSCRIPTION_CANCEL_START:
                runtime.cancel_start(command)
                continue
            if command.method is CommandMethod.MEDIA_CANCEL_INSPECTION or (
                command.method is CommandMethod.MEDIA_INSPECT and command.params.get("progressive") is True
            ):
                try:
                    runtime.handle_command(command)
                except WorkerCommandError as exc:
                    commands.put(runtime.command_error(command, exc))
                continue
            if command.method is CommandMethod.TRANSCRIPTION_START:
                runtime.register_start(command.request_id)
            commands.put(command)
            if command.method is CommandMethod.WORKER_SHUTDOWN:
                break
    except Exception:
        logger.exception("Worker command reader failed")
    finally:
        commands.put(None)


def run_worker_loop(
    stdin: TextIO,
    stdout: TextIO,
    stderr: TextIO,
    *,
    idle_timeout_seconds: float = DEFAULT_MODEL_IDLE_TIMEOUT_SECONDS,
    runtime_factory: RuntimeFactory = WorkerRuntime,
) -> int:
    """Run until EOF or worker.shutdown; stdout is exclusively protocol JSON."""
    writer = ProtocolWriter(stdout)
    logger = _worker_logger(stderr)
    runtime = runtime_factory(
        writer.emit,
        idle_timeout_seconds=idle_timeout_seconds,
        logger=logger,
    )
    writer.emit(worker_ready_event())
    commands: SimpleQueue[CommandMessage | ErrorMessage | None] = SimpleQueue()
    # Read preparation cancellation while the main command thread may be in
    # native model initialization. Normal dispatch and model loading stay here.
    reader = threading.Thread(
        target=_read_commands, args=(stdin, commands, runtime, logger),
        name="whisper-worker-stdin",
    )
    reader.start()
    try:
        while (command := commands.get()) is not None:
            if isinstance(command, ErrorMessage):
                writer.emit(command)
                continue
            try:
                if runtime.handle_command(command):
                    break
            except WorkerCommandError as exc:
                writer.emit(runtime.command_error(command, exc))
            except Exception as exc:
                logger.exception("unhandled command failure")
                writer.emit(
                    ErrorMessage(
                        ErrorCode.WORKER_INTERNAL,
                        {"exception": type(exc).__name__},
                        request_id=command.request_id,
                        message=str(exc) or type(exc).__name__,
                    )
                )
    finally:
        runtime.close(timeout=None)
        reader.join()
    return 0


def main(
    *,
    idle_timeout_seconds: float = DEFAULT_MODEL_IDLE_TIMEOUT_SECONDS,
) -> int:
    _configure_stream_encoding(sys.stdin, input_stream=True)
    _configure_stream_encoding(sys.stdout)
    _configure_stream_encoding(sys.stderr)
    return run_worker_loop(
        sys.stdin,
        sys.stdout,
        sys.stderr,
        idle_timeout_seconds=idle_timeout_seconds,
    )


if __name__ == "__main__":
    raise SystemExit(main())
