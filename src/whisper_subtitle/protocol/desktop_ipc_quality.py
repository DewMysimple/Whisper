"""Quality diagnostic validation for Desktop IPC v1 events."""

from __future__ import annotations

import math
from collections.abc import Sequence
from typing import Any

from .desktop_ipc import (
    ErrorCode,
    ProtocolValidationError,
    _RECOGNITION_STRATEGIES,
)
from .desktop_ipc_validation import (
    _require_fields,
    _require_nonempty_string,
    _require_nonnegative_int,
    _require_object,
)

def _validate_quality_diagnostics(value: Any, field_name: str) -> None:
    diagnostics = _require_object(value, field_name)
    _require_fields(
        diagnostics,
        required={
            "detected_language",
            "language_probability",
            "segment_count",
            "fallback_segment_count",
            "max_temperature",
            "low_confidence_count",
            "segments",
        },
        optional={
            "recognition_strategy",
            "language_regions",
            "detail_candidates",
            "secondary_pass_count",
            "replaced_region_count",
            "review_region_count",
            "rejected_region_count",
            "hotword_audit",
        },
        field_name=field_name,
    )
    language = diagnostics["detected_language"]
    if language is not None:
        _require_nonempty_string(
            language,
            f"{field_name}.detected_language",
            code=ErrorCode.PROTOCOL_INVALID_MESSAGE,
        )
    probability = diagnostics["language_probability"]
    if probability is not None and (
        not isinstance(probability, (int, float))
        or isinstance(probability, bool)
        or not math.isfinite(probability)
        or not 0 <= probability <= 1
    ):
        raise ProtocolValidationError(
            ErrorCode.PROTOCOL_INVALID_MESSAGE,
            f"{field_name}.language_probability must be null or between 0 and 1",
        )
    for name in ("segment_count", "fallback_segment_count", "low_confidence_count"):
        _require_nonnegative_int(diagnostics[name], f"{field_name}.{name}")
    max_temperature = diagnostics["max_temperature"]
    if (
        not isinstance(max_temperature, (int, float))
        or isinstance(max_temperature, bool)
        or not math.isfinite(max_temperature)
        or not 0 <= max_temperature <= 1
    ):
        raise ProtocolValidationError(
            ErrorCode.PROTOCOL_INVALID_MESSAGE,
            f"{field_name}.max_temperature must be between 0 and 1",
        )
    segments = diagnostics["segments"]
    if not isinstance(segments, Sequence) or isinstance(
        segments, (str, bytes, bytearray)
    ):
        raise ProtocolValidationError(
            ErrorCode.PROTOCOL_INVALID_MESSAGE,
            f"{field_name}.segments must be an array",
        )
    allowed_reasons = {
        "fallback_temperature",
        "low_log_probability",
        "high_compression_ratio",
        "silence_conflict",
    }
    for index, item in enumerate(segments):
        segment_name = f"{field_name}.segments[{index}]"
        segment = _require_object(item, segment_name)
        _require_fields(
            segment,
            required={
                "index",
                "start",
                "end",
                "text",
                "temperature",
                "avg_logprob",
                "compression_ratio",
                "no_speech_prob",
                "reasons",
            },
            field_name=segment_name,
        )
        _require_nonnegative_int(segment["index"], f"{segment_name}.index")
        if not isinstance(segment["text"], str) or len(segment["text"]) > 160:
            raise ProtocolValidationError(
                ErrorCode.PROTOCOL_INVALID_MESSAGE,
                f"{segment_name}.text must contain at most 160 characters",
            )
        for name in (
            "start",
            "end",
            "temperature",
            "avg_logprob",
            "compression_ratio",
            "no_speech_prob",
        ):
            number = segment[name]
            if number is not None and (
                not isinstance(number, (int, float))
                or isinstance(number, bool)
                or not math.isfinite(number)
            ):
                raise ProtocolValidationError(
                    ErrorCode.PROTOCOL_INVALID_MESSAGE,
                    f"{segment_name}.{name} must be null or finite",
                )
        for name in ("start", "end", "temperature", "compression_ratio", "no_speech_prob"):
            number = segment[name]
            if number is not None and number < 0:
                raise ProtocolValidationError(
                    ErrorCode.PROTOCOL_INVALID_MESSAGE,
                    f"{segment_name}.{name} must be non-negative",
                )
        for name in ("temperature", "no_speech_prob"):
            number = segment[name]
            if number is not None and number > 1:
                raise ProtocolValidationError(
                    ErrorCode.PROTOCOL_INVALID_MESSAGE,
                    f"{segment_name}.{name} must not exceed 1",
                )
        if (
            segment["start"] is not None
            and segment["end"] is not None
            and segment["end"] < segment["start"]
        ):
            raise ProtocolValidationError(
                ErrorCode.PROTOCOL_INVALID_MESSAGE,
                f"{segment_name}.end cannot precede start",
            )
        reasons = segment["reasons"]
        if (
            not isinstance(reasons, Sequence)
            or isinstance(reasons, (str, bytes, bytearray))
            or not reasons
            or not all(reason in allowed_reasons for reason in reasons)
        ):
            raise ProtocolValidationError(
                ErrorCode.PROTOCOL_INVALID_MESSAGE,
                f"{segment_name}.reasons contains unsupported values",
            )
    if diagnostics["low_confidence_count"] != len(segments):
        raise ProtocolValidationError(
            ErrorCode.PROTOCOL_INVALID_MESSAGE,
            f"{field_name}.low_confidence_count must match segments",
        )
    if "recognition_strategy" in diagnostics and diagnostics[
        "recognition_strategy"
    ] not in _RECOGNITION_STRATEGIES:
        raise ProtocolValidationError(
            ErrorCode.PROTOCOL_INVALID_MESSAGE,
            f"{field_name}.recognition_strategy is unsupported",
        )
    if "language_regions" in diagnostics:
        _validate_language_regions(
            diagnostics["language_regions"], f"{field_name}.language_regions"
        )
    if "detail_candidates" in diagnostics:
        _validate_detail_candidates(
            diagnostics["detail_candidates"], f"{field_name}.detail_candidates"
        )
    for name in (
        "secondary_pass_count",
        "replaced_region_count",
        "review_region_count",
        "rejected_region_count",
    ):
        if name in diagnostics:
            _require_nonnegative_int(diagnostics[name], f"{field_name}.{name}")
    if "hotword_audit" in diagnostics:
        _validate_hotword_audit(
            diagnostics["hotword_audit"], f"{field_name}.hotword_audit"
        )


def _validate_language_regions(value: Any, field_name: str) -> None:
    if not isinstance(value, Sequence) or isinstance(value, (str, bytes, bytearray)):
        raise ProtocolValidationError(
            ErrorCode.PROTOCOL_INVALID_MESSAGE,
            f"{field_name} must be an array",
        )
    for index, item in enumerate(value):
        name = f"{field_name}[{index}]"
        region = _require_object(item, name)
        _require_fields(
            region,
            required={
                "start",
                "end",
                "top_language",
                "top_probability",
                "english_probability",
                "chinese_probability",
                "primary_text",
                "candidate_text",
                "decision",
                "reason",
            },
            field_name=name,
        )
        for number_name in (
            "start",
            "end",
            "top_probability",
            "english_probability",
            "chinese_probability",
        ):
            number = region[number_name]
            if (
                not isinstance(number, (int, float))
                or isinstance(number, bool)
                or not math.isfinite(number)
                or number < 0
            ):
                raise ProtocolValidationError(
                    ErrorCode.PROTOCOL_INVALID_MESSAGE,
                    f"{name}.{number_name} must be a non-negative finite number",
                )
        if region["end"] <= region["start"]:
            raise ProtocolValidationError(
                ErrorCode.PROTOCOL_INVALID_MESSAGE,
                f"{name}.end must be after start",
            )
        for probability_name in (
            "top_probability",
            "english_probability",
            "chinese_probability",
        ):
            if region[probability_name] > 1:
                raise ProtocolValidationError(
                    ErrorCode.PROTOCOL_INVALID_MESSAGE,
                    f"{name}.{probability_name} must not exceed 1",
                )
        _require_nonempty_string(
            region["top_language"],
            f"{name}.top_language",
            code=ErrorCode.PROTOCOL_INVALID_MESSAGE,
        )
        for text_name in ("primary_text", "candidate_text"):
            if not isinstance(region[text_name], str) or len(region[text_name]) > 160:
                raise ProtocolValidationError(
                    ErrorCode.PROTOCOL_INVALID_MESSAGE,
                    f"{name}.{text_name} must contain at most 160 characters",
                )
        if region["decision"] not in {"primary", "replaced", "review", "rejected"}:
            raise ProtocolValidationError(
                ErrorCode.PROTOCOL_INVALID_MESSAGE,
                f"{name}.decision is unsupported",
            )
        if region["reason"] is not None and (
            not isinstance(region["reason"], str) or not region["reason"]
        ):
            raise ProtocolValidationError(
                ErrorCode.PROTOCOL_INVALID_MESSAGE,
                f"{name}.reason must be null or non-empty",
            )


def _validate_detail_candidates(value: Any, field_name: str) -> None:
    if not isinstance(value, Sequence) or isinstance(value, (str, bytes, bytearray)):
        raise ProtocolValidationError(
            ErrorCode.PROTOCOL_INVALID_MESSAGE,
            f"{field_name} must be an array",
        )
    for index, item in enumerate(value):
        name = f"{field_name}[{index}]"
        candidate = _require_object(item, name)
        _require_fields(
            candidate,
            required={
                "start",
                "end",
                "chinese_probability",
                "primary_text",
                "candidate_text",
                "decision",
                "reason",
                "primary_word_probability",
                "candidate_word_probability",
                "primary_log_probability",
                "candidate_log_probability",
                "recovered_hotwords",
            },
            field_name=name,
        )
        for number_name in ("start", "end", "chinese_probability"):
            number = candidate[number_name]
            if (
                not isinstance(number, (int, float))
                or isinstance(number, bool)
                or not math.isfinite(number)
                or number < 0
            ):
                raise ProtocolValidationError(
                    ErrorCode.PROTOCOL_INVALID_MESSAGE,
                    f"{name}.{number_name} must be a non-negative finite number",
                )
        if candidate["end"] <= candidate["start"]:
            raise ProtocolValidationError(
                ErrorCode.PROTOCOL_INVALID_MESSAGE,
                f"{name}.end must be after start",
            )
        if candidate["chinese_probability"] > 1:
            raise ProtocolValidationError(
                ErrorCode.PROTOCOL_INVALID_MESSAGE,
                f"{name}.chinese_probability must not exceed 1",
            )
        for text_name in ("primary_text", "candidate_text"):
            if (
                not isinstance(candidate[text_name], str)
                or len(candidate[text_name]) > 160
            ):
                raise ProtocolValidationError(
                    ErrorCode.PROTOCOL_INVALID_MESSAGE,
                    f"{name}.{text_name} must contain at most 160 characters",
                )
        if candidate["decision"] not in {"replaced", "review", "rejected"}:
            raise ProtocolValidationError(
                ErrorCode.PROTOCOL_INVALID_MESSAGE,
                f"{name}.decision is unsupported",
            )
        if candidate["reason"] is not None and (
            not isinstance(candidate["reason"], str) or not candidate["reason"]
        ):
            raise ProtocolValidationError(
                ErrorCode.PROTOCOL_INVALID_MESSAGE,
                f"{name}.reason must be null or non-empty",
            )
        for probability_name in (
            "primary_word_probability",
            "candidate_word_probability",
        ):
            probability = candidate[probability_name]
            if probability is not None and (
                not isinstance(probability, (int, float))
                or isinstance(probability, bool)
                or not math.isfinite(probability)
                or not 0 <= probability <= 1
            ):
                raise ProtocolValidationError(
                    ErrorCode.PROTOCOL_INVALID_MESSAGE,
                    f"{name}.{probability_name} must be null or between 0 and 1",
                )
        for log_name in ("primary_log_probability", "candidate_log_probability"):
            number = candidate[log_name]
            if number is not None and (
                not isinstance(number, (int, float))
                or isinstance(number, bool)
                or not math.isfinite(number)
            ):
                raise ProtocolValidationError(
                    ErrorCode.PROTOCOL_INVALID_MESSAGE,
                    f"{name}.{log_name} must be null or finite",
                )
        terms = candidate["recovered_hotwords"]
        if (
            not isinstance(terms, Sequence)
            or isinstance(terms, (str, bytes, bytearray))
            or len(terms) > 20
            or not all(isinstance(term, str) and term for term in terms)
        ):
            raise ProtocolValidationError(
                ErrorCode.PROTOCOL_INVALID_MESSAGE,
                f"{name}.recovered_hotwords must contain at most 20 terms",
            )


def _validate_hotword_audit(value: Any, field_name: str) -> None:
    audit = _require_object(value, field_name)
    _require_fields(
        audit,
        required={
            "term_count",
            "matched_count",
            "missing_count",
            "matched_terms",
            "missing_terms",
            "omitted_term_count",
        },
        field_name=field_name,
    )
    for name in (
        "term_count",
        "matched_count",
        "missing_count",
        "omitted_term_count",
    ):
        _require_nonnegative_int(audit[name], f"{field_name}.{name}")
    for name in ("matched_terms", "missing_terms"):
        terms = audit[name]
        if (
            not isinstance(terms, Sequence)
            or isinstance(terms, (str, bytes, bytearray))
            or not all(isinstance(term, str) and term for term in terms)
            or len(terms) > 20
        ):
            raise ProtocolValidationError(
                ErrorCode.PROTOCOL_INVALID_MESSAGE,
                f"{field_name}.{name} must contain at most 20 terms",
            )
