"""UTF-8 JSON-lines transport for the persistent Python Worker."""

from __future__ import annotations

import json
import logging
import re
import sys
import threading
from collections.abc import Callable
from typing import TextIO

from ..protocol import (
    CommandMessage,
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
    try:
        for raw_line in stdin:
            line = raw_line.rstrip("\r\n")
            request_id = _best_effort_request_id(line)
            command: CommandMessage | None = None
            try:
                message = parse_protocol_line(line)
                if not isinstance(message, CommandMessage):
                    raise ProtocolValidationError(
                        ErrorCode.PROTOCOL_INVALID_MESSAGE,
                        "worker stdin accepts command messages only",
                    )
                command = message
                if runtime.handle_command(command):
                    break
            except ProtocolValidationError as exc:
                writer.emit(
                    protocol_error_from_exception(exc, request_id=request_id)
                )
            except WorkerCommandError as exc:
                if command is None:
                    writer.emit(
                        ErrorMessage(
                            exc.code,
                            exc.data,
                            request_id=request_id,
                            task_id=exc.task_id,
                            message=str(exc),
                        )
                    )
                else:
                    writer.emit(runtime.command_error(command, exc))
            except Exception as exc:
                logger.exception("unhandled command failure")
                writer.emit(
                    ErrorMessage(
                        ErrorCode.WORKER_INTERNAL,
                        {"exception": type(exc).__name__},
                        request_id=command.request_id if command else request_id,
                        message=str(exc) or type(exc).__name__,
                    )
                )
    finally:
        runtime.close(timeout=None)
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
