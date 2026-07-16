"""Versioned machine contracts for future desktop process boundaries."""

from .desktop_ipc import (
    PROTOCOL_SCHEMA_VERSION,
    CommandMessage,
    CommandMethod,
    ErrorCode,
    ErrorMessage,
    EventCode,
    EventMessage,
    MessageType,
    ProtocolMessage,
    ProtocolValidationError,
    TaskStage,
    encode_protocol_message,
    parse_protocol_line,
    protocol_error_from_exception,
    validate_task_event_sequence,
)

__all__ = [
    "PROTOCOL_SCHEMA_VERSION",
    "CommandMessage",
    "CommandMethod",
    "ErrorCode",
    "ErrorMessage",
    "EventCode",
    "EventMessage",
    "MessageType",
    "ProtocolMessage",
    "ProtocolValidationError",
    "TaskStage",
    "encode_protocol_message",
    "parse_protocol_line",
    "protocol_error_from_exception",
    "validate_task_event_sequence",
]
