"""Process-loop contracts for the Worker stdin/stdout boundary."""

from __future__ import annotations

from io import StringIO

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
