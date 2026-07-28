"""Conservative Chinese detail re-recognition and candidate scoring."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
import math
import re
from typing import Any

from .mixed_language import (
    LanguageDetectionRegion,
    hotword_terms,
    segments_for_region,
    splice_candidate_segments,
)


SUPPORTED_DETAIL_MODELS = frozenset({"large-v3", "large-v3-turbo"})
DETAIL_MIN_CHINESE_PROBABILITY = 0.5
DETAIL_CONTEXT_CHARACTERS = 80
DETAIL_CLIP_PADDING_SECONDS = 0.4
DETAIL_WORD_PROBABILITY_GAIN = 0.08
DETAIL_LOG_PROBABILITY_GAIN = 0.12
DETAIL_HOTWORD_WORD_PROBABILITY = 0.85
DETAIL_MIN_LENGTH_RATIO = 0.65
DETAIL_MAX_LENGTH_RATIO = 1.5
DETAIL_MAX_CHARACTER_RATE = 12.0
DETAIL_MAX_RATE_MULTIPLIER = 1.8

_CJK = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]")
_LATIN_OR_NUMBER = re.compile(
    r"(?:[A-Za-z]+(?:['’\-][A-Za-z]+)*)|(?:\d+(?:[.:/-]\d+)*)"
)
_WHITESPACE = re.compile(r"\s+")


@dataclass(frozen=True, slots=True)
class DetailCandidateRegion:
    """One real Chinese speech region eligible for local re-recognition."""

    start: float
    end: float
    chinese_probability: float

    def __post_init__(self) -> None:
        if not (
            math.isfinite(self.start)
            and math.isfinite(self.end)
            and 0 <= self.start < self.end
        ):
            raise ValueError("detail candidate timestamps are invalid")
        if not math.isfinite(self.chinese_probability) or not (
            0 <= self.chinese_probability <= 1
        ):
            raise ValueError("chinese_probability must be between 0 and 1")


@dataclass(frozen=True, slots=True)
class CandidateDecision:
    """Decision and comparable metrics for one local Chinese candidate."""

    decision: str
    reason: str | None
    primary_text: str
    candidate_text: str
    primary_word_probability: float | None
    candidate_word_probability: float | None
    primary_log_probability: float | None
    candidate_log_probability: float | None
    recovered_hotwords: tuple[str, ...] = ()


def select_chinese_detail_regions(
    detections: Sequence[LanguageDetectionRegion],
) -> tuple[DetailCandidateRegion, ...]:
    """Select real VAD blocks that are confidently Chinese speech."""
    return tuple(
        DetailCandidateRegion(
            start=item.start,
            end=item.end,
            chinese_probability=item.chinese_probability,
        )
        for item in sorted(detections, key=lambda value: (value.start, value.end))
        if item.top_language == "zh"
        and item.chinese_probability >= DETAIL_MIN_CHINESE_PROBABILITY
    )


def prior_context(
    segments: Sequence[object],
    region_start: float,
    *,
    limit: int = DETAIL_CONTEXT_CHARACTERS,
) -> str:
    """Return preceding primary text without leaking the candidate region."""
    pieces = [
        str(getattr(segment, "text", "")).strip()
        for segment in segments
        if _number(getattr(segment, "end", None)) is not None
        and float(getattr(segment, "end")) <= region_start
        and str(getattr(segment, "text", "")).strip()
    ]
    return "".join(pieces)[-limit:]


def candidate_prompt(existing_prompt: object, context: str) -> str | None:
    """Combine the user's prompt with bounded preceding context."""
    pieces = []
    if isinstance(existing_prompt, str) and existing_prompt.strip():
        pieces.append(existing_prompt.strip())
    if context.strip():
        pieces.append(context.strip())
    if not pieces:
        return None
    return "\n".join(pieces)[-4000:]


def evaluate_detail_candidate(
    primary_segments: Sequence[object],
    raw_candidate_segments: Sequence[object],
    region: DetailCandidateRegion,
    diagnostics: Mapping[str, Any],
    hotwords: object,
) -> tuple[CandidateDecision, list[object]]:
    """Score one candidate and return a safe splice-ready segment list."""
    candidate_segments = segments_for_region(
        raw_candidate_segments,
        region.start,
        region.end,
        require_contained_words=True,
    )
    primary_text = _region_text(primary_segments, region.start, region.end)
    candidate_text = _region_text(candidate_segments, region.start, region.end)
    primary_word_probability = _mean_word_probability(
        primary_segments, region.start, region.end
    )
    candidate_word_probability = _mean_word_probability(
        candidate_segments, region.start, region.end
    )
    primary_log_probability = _mean_segment_number(
        primary_segments, region.start, region.end, "avg_logprob"
    )
    candidate_log_probability = _mean_segment_number(
        candidate_segments, region.start, region.end, "avg_logprob"
    )
    recovered = _recovered_hotwords(primary_text, candidate_text, hotwords)
    lost_hotwords = _lost_hotwords(primary_text, candidate_text, hotwords)

    def result(decision: str, reason: str | None) -> CandidateDecision:
        return CandidateDecision(
            decision=decision,
            reason=reason,
            primary_text=primary_text,
            candidate_text=candidate_text,
            primary_word_probability=primary_word_probability,
            candidate_word_probability=candidate_word_probability,
            primary_log_probability=primary_log_probability,
            candidate_log_probability=candidate_log_probability,
            recovered_hotwords=recovered,
        )

    if not candidate_segments or not candidate_text:
        return result("rejected", "empty_candidate"), candidate_segments
    if not _CJK.search(candidate_text):
        return result("rejected", "missing_chinese_text"), candidate_segments
    if _normalized_text(primary_text) == _normalized_text(candidate_text):
        return result("unchanged", None), candidate_segments
    timeline_reason = _timeline_rejection(candidate_segments, region)
    if timeline_reason is not None:
        return result("rejected", timeline_reason), candidate_segments
    for suspicious in diagnostics.get("segments", ()):
        reasons = set(suspicious.get("reasons", ()))
        if reasons & {"high_compression_ratio", "silence_conflict"}:
            return result("rejected", "unsafe_quality"), candidate_segments

    duration = max(0.001, region.end - region.start)
    primary_length = _content_length(primary_text)
    candidate_length = _content_length(candidate_text)
    if primary_length <= 0:
        return result("rejected", "empty_primary_alignment"), candidate_segments
    length_ratio = candidate_length / primary_length
    if not DETAIL_MIN_LENGTH_RATIO <= length_ratio <= DETAIL_MAX_LENGTH_RATIO:
        return result("rejected", "unsafe_length_change"), candidate_segments
    primary_rate = primary_length / duration
    candidate_rate = candidate_length / duration
    if candidate_rate > DETAIL_MAX_CHARACTER_RATE or candidate_rate > max(
        1.0, primary_rate * DETAIL_MAX_RATE_MULTIPLIER
    ):
        return result("rejected", "implausible_speech_rate"), candidate_segments
    if (
        _protected_tokens(primary_text) - _protected_tokens(candidate_text)
        or lost_hotwords
    ):
        return result("review", "protected_content_changed"), candidate_segments

    word_gain = _gain(candidate_word_probability, primary_word_probability)
    log_gain = _gain(candidate_log_probability, primary_log_probability)
    probability_improved = (
        word_gain is not None
        and log_gain is not None
        and word_gain >= DETAIL_WORD_PROBABILITY_GAIN
        and log_gain >= DETAIL_LOG_PROBABILITY_GAIN
    )
    recovered_hotword_probability = _best_recovered_hotword_probability(
        candidate_segments,
        recovered,
    )
    recovered_confident_hotword = bool(recovered) and (
        recovered_hotword_probability is not None
        and recovered_hotword_probability >= DETAIL_HOTWORD_WORD_PROBABILITY
        and candidate_word_probability is not None
        and _not_worse(candidate_word_probability, primary_word_probability, 0.02)
        and _not_worse(candidate_log_probability, primary_log_probability, 0.05)
    )
    if probability_improved:
        return result("replaced", "confidence_improved"), candidate_segments
    if recovered_confident_hotword:
        return result("replaced", "hotword_recovered"), candidate_segments
    return result("review", "insufficient_probability_gain"), candidate_segments


def splice_detail_candidates(
    primary_segments: Sequence[object],
    replacements: Sequence[tuple[DetailCandidateRegion, Sequence[object]]],
) -> list[object]:
    """Reuse the established word-safe splice implementation."""
    return splice_candidate_segments(primary_segments, replacements)  # type: ignore[arg-type]


def replacement_preserves_protected_content(
    primary_segments: Sequence[object],
    tentative_segments: Sequence[object],
    hotwords: object,
) -> bool:
    """Guard against boundary splices deleting global protected content."""
    primary_text = " ".join(str(getattr(item, "text", "")) for item in primary_segments)
    tentative_text = " ".join(
        str(getattr(item, "text", "")) for item in tentative_segments
    )
    if _protected_tokens(primary_text) - _protected_tokens(tentative_text):
        return False
    return not _lost_hotwords(primary_text, tentative_text, hotwords)


def stable_splice_boundary_is_safe(
    primary_segments: Sequence[object],
    region: DetailCandidateRegion,
) -> bool:
    """Require a word-safe base or segment boundaries contained by the VAD block."""
    if any(_segment_has_timed_words(item) for item in primary_segments):
        return True
    selected = []
    for segment in primary_segments:
        start = _number(getattr(segment, "start", None))
        end = _number(getattr(segment, "end", None))
        if start is None or end is None or end <= start:
            continue
        midpoint = start + (end - start) / 2
        if region.start - 0.12 <= midpoint <= region.end + 0.12:
            selected.append((start, end))
    return bool(selected) and all(
        start >= region.start - 0.12 and end <= region.end + 0.12
        for start, end in selected
    )


def _timeline_rejection(
    segments: Sequence[object], region: DetailCandidateRegion
) -> str | None:
    previous_end = -math.inf
    for segment in segments:
        start = _number(getattr(segment, "start", None))
        end = _number(getattr(segment, "end", None))
        if start is None or end is None or start < previous_end or end <= start:
            return "invalid_timeline"
        if start < region.start - 0.12 or end > region.end + 0.12:
            return "candidate_outside_region"
        previous_end = end
    return None


def _region_text(segments: Sequence[object], start: float, end: float) -> str:
    word_pieces: list[str] = []
    has_timed_words = False
    for segment in segments:
        words = getattr(segment, "words", None)
        if not isinstance(words, Sequence) or isinstance(
            words, (str, bytes, bytearray)
        ):
            continue
        for word in words:
            word_start = _word_number(word, "start")
            word_end = _word_number(word, "end")
            if word_start is None or word_end is None or word_end <= word_start:
                continue
            has_timed_words = True
            midpoint = word_start + (word_end - word_start) / 2
            if start - 0.12 <= midpoint <= end + 0.12:
                if isinstance(word, Mapping):
                    text = word.get("word", word.get("text", ""))
                else:
                    text = getattr(word, "word", getattr(word, "text", ""))
                if str(text).strip():
                    word_pieces.append(str(text).strip())
    if has_timed_words:
        return "".join(word_pieces)
    pieces = []
    for segment in segments:
        segment_start = _number(getattr(segment, "start", None))
        segment_end = _number(getattr(segment, "end", None))
        if segment_start is None or segment_end is None:
            continue
        if segment_end >= start - 0.12 and segment_start <= end + 0.12:
            text = str(getattr(segment, "text", "")).strip()
            if text:
                pieces.append(text)
    return " ".join(pieces)


def _mean_word_probability(
    segments: Sequence[object], start: float, end: float
) -> float | None:
    values = []
    for segment in segments:
        words = getattr(segment, "words", None)
        if not isinstance(words, Sequence) or isinstance(
            words, (str, bytes, bytearray)
        ):
            continue
        for word in words:
            word_start = _word_number(word, "start")
            word_end = _word_number(word, "end")
            probability = _word_number(word, "probability")
            if word_start is None or word_end is None or probability is None:
                continue
            midpoint = word_start + (word_end - word_start) / 2
            if start - 0.12 <= midpoint <= end + 0.12:
                values.append(probability)
    return sum(values) / len(values) if values else None


def _mean_segment_number(
    segments: Sequence[object], start: float, end: float, name: str
) -> float | None:
    values = []
    for segment in segments:
        segment_start = _number(getattr(segment, "start", None))
        segment_end = _number(getattr(segment, "end", None))
        value = _number(getattr(segment, name, None))
        if segment_start is None or segment_end is None or value is None:
            continue
        if segment_end >= start - 0.12 and segment_start <= end + 0.12:
            values.append(value)
    return sum(values) / len(values) if values else None


def _recovered_hotwords(
    primary_text: str, candidate_text: str, hotwords: object
) -> tuple[str, ...]:
    primary = _normalized_text(primary_text)
    candidate = _normalized_text(candidate_text)
    return tuple(
        term
        for term in hotword_terms(hotwords)
        if _normalized_text(term) not in primary
        and _normalized_text(term) in candidate
    )


def _lost_hotwords(
    primary_text: str, candidate_text: str, hotwords: object
) -> tuple[str, ...]:
    primary = _normalized_text(primary_text)
    candidate = _normalized_text(candidate_text)
    return tuple(
        term
        for term in hotword_terms(hotwords)
        if _normalized_text(term) in primary
        and _normalized_text(term) not in candidate
    )


def _best_recovered_hotword_probability(
    segments: Sequence[object], recovered_hotwords: Sequence[str]
) -> float | None:
    """Return the best exact recovered-term mean probability, not the clip mean."""
    words: list[tuple[str, float]] = []
    for segment in segments:
        segment_words = getattr(segment, "words", None)
        if not isinstance(segment_words, Sequence) or isinstance(
            segment_words, (str, bytes, bytearray)
        ):
            continue
        for word in segment_words:
            if isinstance(word, Mapping):
                text = word.get("word", word.get("text", ""))
            else:
                text = getattr(word, "word", getattr(word, "text", ""))
            probability = _word_number(word, "probability")
            normalized = _normalized_text(str(text))
            if normalized and probability is not None:
                words.append((normalized, probability))
    if not words:
        return None
    joined = "".join(text for text, _ in words)
    offsets: list[tuple[int, int, float]] = []
    cursor = 0
    for text, probability in words:
        offsets.append((cursor, cursor + len(text), probability))
        cursor += len(text)
    scores: list[float] = []
    for term in recovered_hotwords:
        normalized_term = _normalized_text(term)
        if not normalized_term:
            continue
        start = joined.find(normalized_term)
        if start < 0:
            continue
        end = start + len(normalized_term)
        probabilities = [
            probability
            for word_start, word_end, probability in offsets
            if word_end > start and word_start < end
        ]
        if probabilities:
            scores.append(sum(probabilities) / len(probabilities))
    return max(scores) if scores else None


def _protected_tokens(text: str) -> set[str]:
    return {item.casefold() for item in _LATIN_OR_NUMBER.findall(text)}


def _normalized_text(text: str) -> str:
    return _WHITESPACE.sub("", text).casefold()


def _content_length(text: str) -> int:
    return len(_normalized_text(text))


def _gain(candidate: float | None, primary: float | None) -> float | None:
    if candidate is None or primary is None:
        return None
    return candidate - primary


def _not_worse(
    candidate: float | None, primary: float | None, tolerance: float
) -> bool:
    return (
        candidate is not None
        and primary is not None
        and candidate >= primary - tolerance
    )


def _word_number(word: object, name: str) -> float | None:
    if isinstance(word, Mapping):
        return _number(word.get(name))
    return _number(getattr(word, name, None))


def _segment_has_timed_words(segment: object) -> bool:
    words = getattr(segment, "words", None)
    if not isinstance(words, Sequence) or isinstance(
        words, (str, bytes, bytearray)
    ):
        return False
    return any(
        _word_number(word, "start") is not None
        and _word_number(word, "end") is not None
        for word in words
    )


def _number(value: object) -> float | None:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        number = float(value)
        return number if math.isfinite(number) else None
    return None
