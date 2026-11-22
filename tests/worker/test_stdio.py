"""Process-loop contracts for the Worker stdin/stdout boundary."""

from __future__ import annotations

from functools import partial
from io import StringIO
from threading import Event, current_thread
from types import SimpleNamespace

from whisper_subtitle.protocol import (
    CommandMessage,
    CommandMethod,
    ErrorCode,
    ErrorMessage,
    EventCode,
    EventMessage,
    encode_protocol_message,
    parse_protocol_line,
)
from whisper_subtitle.worker.stdio import run_worker_loop
from whisper_subtitle.worker.runtime import WorkerRuntime

from .test_runtime import FakeEngine, hardware, make_media, start_command


def command_line(request_id, method, params=None):
    return encode_protocol_message(
        CommandMessage(request_id, method, params or {})
    )


def parse_output(stream):
    return [parse_protocol_line(line) for line in stream.getvalue().splitlines()]


def test_loop_emits_ready_health_ack_and_shutdown_ack_on_stdout_only():
    stdin = StringIO(
        "\n".join(
            [
                command_line("req-health", CommandMethod.SYSTEM_HEALTH),
                command_line("req-stop", CommandMethod.WORKER_SHUTDOWN),
            ]
        )
        + "\n"
    )
    stdout = StringIO()
    stderr = StringIO()

    assert run_worker_loop(stdin, stdout, stderr) == 0

    messages = parse_output(stdout)
    assert messages[0].event is EventCode.WORKER_READY
    assert EventCode.COMMAND_COMPLETED.value in messages[0].data["capabilities"]["events"]
    completions = [
        message
        for message in messages
        if isinstance(message, EventMessage)
        and message.event is EventCode.COMMAND_COMPLETED
    ]
    assert [message.request_id for message in completions] == [
        "req-health",
        "req-stop",
    ]
    assert completions[0].data["result"]["status"] == "ok"
    assert stderr.getvalue() == ""


def test_bad_messages_return_errors_and_do_not_poison_following_commands():
    event_on_stdin = EventMessage(
        EventCode.MODEL_LOADING,
        {"model_id": "large-v3-turbo"},
    )
    stdin = StringIO(
        "\n".join(
            [
                "not-json",
                encode_protocol_message(event_on_stdin),
                command_line("req-health", CommandMethod.SYSTEM_HEALTH),
                command_line("req-stop", CommandMethod.WORKER_SHUTDOWN),
            ]
        )
        + "\n"
    )
    stdout = StringIO()

    assert run_worker_loop(stdin, stdout, StringIO()) == 0

    messages = parse_output(stdout)
    errors = [message for message in messages if isinstance(message, ErrorMessage)]
    assert [message.code for message in errors] == [
        ErrorCode.PROTOCOL_INVALID_JSON,
        ErrorCode.PROTOCOL_INVALID_MESSAGE,
    ]
    assert any(
        isinstance(message, EventMessage)
        and message.event is EventCode.COMMAND_COMPLETED
        and message.request_id == "req-health"
        for message in messages
    )


def test_cancel_start_is_registered_while_main_thread_is_loading_model(tmp_path):
    entered, release, acknowledged = Event(), Event(), Event()
    command_thread = current_thread()
    media = make_media(tmp_path, "中文 # clip.wav")

    class ObservedOutput(StringIO):
        def write(self, line):
            result = super().write(line)
            if '"req-cancel"' in line:
                acknowledged.set()
            return result

    def load(*_args):
        assert current_thread() is command_thread
        entered.set()
        assert release.wait(3), "cancellation was not accepted during model loading"
        return FakeEngine()

    def commands():
        yield command_line("req-health", CommandMethod.SYSTEM_HEALTH)
        yield encode_protocol_message(start_command("req-start", media))
        assert entered.wait(3)
        yield command_line("req-cancel", CommandMethod.TRANSCRIPTION_CANCEL_START, {"start_request_id": "req-start"})
        assert acknowledged.wait(3)
        release.set()
        yield command_line("req-stop", CommandMethod.WORKER_SHUTDOWN)

    stdout = ObservedOutput()
    assert run_worker_loop(
        commands(), stdout, StringIO(),
        runtime_factory=partial(
            WorkerRuntime,
            runtime_configurer=SimpleNamespace,
            hardware_detector=hardware,
            engine_loader=load,
            media_duration_probe=lambda _path: (True, 5.0, None),
        ),
    ) == 0
    messages = parse_output(stdout)
    assert CommandMethod.TRANSCRIPTION_CANCEL_START.value not in messages[0].data["capabilities"]["methods"]
    health = next(item for item in messages if item.request_id == "req-health")
    assert health.data["result"]["start_cancellation_version"] == 1
    response = next(item for item in messages if item.request_id == "req-cancel")
    assert response.data["result"]["accepted"] is True
    cancelled = next(item for item in messages if isinstance(item, ErrorMessage))
    assert cancelled.request_id == "req-start"
    assert cancelled.data["exception"] == "StartCancelled"
    assert not any(getattr(item, "event", None) is EventCode.TASK_QUEUED for item in messages)
    assert not list(tmp_path.glob("*.txt"))
