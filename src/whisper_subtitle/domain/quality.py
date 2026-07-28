"""Recognition quality diagnostics derived from real Whisper segments."""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from typing import Any

MAX_DIAGNOSTIC_EXCERPT_CHARACTERS = 160


def build_recognition_quality_diagnostics(
    segments: Sequence[object],
    info: object,
    parameters: Mapping[str, Any],
) -> dict[str, Any]:
    """Return transport-safe diagnostics without changing recognized text."""

    log_probability_threshold = _finite_number(
        parameters.get("log_prob_threshold")
    )
    compression_ratio_threshold = _finite_number(
        parameters.get("compression_ratio_threshold")
    )
    no_speech_threshold = _finite_number(parameters.get("no_speech_threshold"))
    suspicious: list[dict[str, Any]] = []
    fallback_count = 0
    max_temperature = 0.0

    for index, segment in enumerate(segments):
        temperature = _finite_number(getattr(segment, "temperature", None))
        average_log_probability = _finite_number(
            getattr(segment, "avg_logprob", None)
        )
        compression_ratio = _finite_number(
            getattr(segment, "compression_ratio", None)
        )
        no_speech_probability = _finite_number(
            getattr(segment, "no_speech_prob", None)
        )
        reasons: list[str] = []
        if temperature is not None:
            max_temperature = max(max_temperature, temperature)
            if temperature > 0:
                fallback_count += 1
                reasons.append("fallback_temperature")
        if (
            average_log_probability is not None
            and log_probability_threshold is not None
            and average_log_probability < log_probability_threshold
        ):
            reasons.append("low_log_probability")
        if (
            compression_ratio is not None
            and compression_ratio_threshold is not None
            and compression_ratio > compression_ratio_threshold
        ):
            reasons.append("high_compression_ratio")
        if (
            no_speech_probability is not None
            and no_speech_threshold is not None
            and no_speech_probability > no_speech_threshold
            and (
                average_log_probability is None
                or log_probability_threshold is None
                or average_log_probability < log_probability_threshold
            )
        ):
            reasons.append("silence_conflict")
        if not reasons:
            continue
        suspicious.append(
            {
                "index": index,
                "start": _nonnegative_number(getattr(segment, "start", None)),
                "end": _nonnegative_number(getattr(segment, "end", None)),
                "text": _excerpt(getattr(segment, "text", "")),
                "temperature": temperature,
                "avg_logprob": average_log_probability,
                "compression_ratio": compression_ratio,
                "no_speech_prob": no_speech_probability,
                "reasons": reasons,
            }
        )

    language = getattr(info, "language", None)
    language_probability = _finite_number(
        getattr(info, "language_probability", None)
    )
    return {
        "detected_language": language if isinstance(language, str) and language else None,
        "language_probability": language_probability,
        "segment_count": len(segments),
        "fallback_segment_count": fallback_count,
        "max_temperature": max_temperature,
        "low_confidence_count": len(suspicious),
        "segments": suspicious,
    }


def _finite_number(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    number = float(value)
    return number if math.isfinite(number) else None


def _nonnegative_number(value: object) -> float | None:
    number = _finite_number(value)
    return max(0.0, number) if number is not None else None


def _excerpt(value: object) -> str:
    if not isinstance(value, str):
        return ""
    normalized = " ".join(value.split())
    return "".join(list(normalized)[:MAX_DIAGNOSTIC_EXCERPT_CHARACTERS])
