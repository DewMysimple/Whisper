"""Conservative helpers for optional Chinese/English second-pass recognition."""

from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
import math
import re
from typing import Any


SUPPORTED_MIXED_MODELS = frozenset({"large-v3", "large-v3-turbo"})
MODEL_ENGLISH_THRESHOLDS = {
    "large-v3": 0.75,
    "large-v3-turbo": 0.75,
}
_LATIN_WORD = re.compile(r"[A-Za-z]+(?:['’\-][A-Za-z]+)*")
_HOTWORD_SEPARATOR = re.compile(r"[\n,，;；]+")
_HARD_REJECTION_REASONS = frozenset(
    {"high_compression_ratio", "silence_conflict"}
)


@dataclass(frozen=True, slots=True)
class LanguageDetectionRegion:
    """Language probabilities for one real VAD speech region."""

    start: float
    end: float
    top_language: str
    top_probability: float
    english_probability: float
    chinese_probability: float

    def __post_init__(self) -> None:
        if not (
            math.isfinite(self.start)
            and math.isfinite(self.end)
            and 0 <= self.start < self.end
        ):
            raise ValueError("language region timestamps are invalid")
        if not self.top_language:
            raise ValueError("top_language must be non-empty")
        for value in (
            self.top_probability,
            self.english_probability,
            self.chinese_probability,
        ):
            if not math.isfinite(value) or not 0 <= value <= 1:
                raise ValueError("language probabilities must be between 0 and 1")


@dataclass(frozen=True, slots=True)
class EnglishCandidateRegion:
    """One merged English region eligible for a forced-English second pass."""

    start: float
    end: float
    english_probability: float
    chinese_probability: float
    detection_count: int


@dataclass(frozen=True, slots=True)
class MixedLanguageSegment:
    """Segment fragment assembled from real word timestamps."""

    start: float
    end: float
    text: str
    words: tuple[object, ...]
    temperature: float | None
    avg_logprob: float | None
    compression_ratio: float | None
    no_speech_prob: float | None


def select_english_candidate_regions(
    detections: Sequence[LanguageDetectionRegion],
    *,
    model_id: str,
    merge_gap_seconds: float = 0.8,
    max_region_seconds: float = 12.0,
) -> tuple[EnglishCandidateRegion, ...]:
    """Select strong English regions and adjacent weak English continuations."""
    threshold = MODEL_ENGLISH_THRESHOLDS.get(model_id, 0.85)
    weak_threshold = max(0.6, threshold - 0.15)
    ordered = sorted(detections, key=lambda item: (item.start, item.end))
    strong = [
        item.top_language == "en"
        and item.english_probability >= threshold
        and item.english_probability - item.chinese_probability >= 0.1
        for item in ordered
    ]
    selected = strong.copy()
    for index, item in enumerate(ordered):
        if selected[index] or item.top_language != "en":
            continue
        weak = (
            item.english_probability >= weak_threshold
            and item.english_probability > item.chinese_probability
        )
        if not weak:
            continue
        previous_strong = (
            index > 0
            and strong[index - 1]
            and item.start - ordered[index - 1].end <= merge_gap_seconds
        )
        next_strong = (
            index + 1 < len(ordered)
            and strong[index + 1]
            and ordered[index + 1].start - item.end <= merge_gap_seconds
        )
        selected[index] = previous_strong or next_strong

    groups: list[list[LanguageDetectionRegion]] = []
    for item, include in zip(ordered, selected):
        if not include:
            continue
        if (
            groups
            and item.start - groups[-1][-1].end <= merge_gap_seconds
            and item.end - groups[-1][0].start <= max_region_seconds
        ):
            groups[-1].append(item)
        else:
            groups.append([item])
    return tuple(
        EnglishCandidateRegion(
            start=group[0].start,
            end=group[-1].end,
            english_probability=max(item.english_probability for item in group),
            chinese_probability=max(item.chinese_probability for item in group),
            detection_count=len(group),
        )
        for group in groups
    )


def latin_hotwords(value: object) -> str | None:
    """Keep only user-provided terms containing Latin letters."""
    terms = [term for term in hotword_terms(value) if re.search(r"[A-Za-z]", term)]
    return "\n".join(dict.fromkeys(terms)) or None


def hotword_terms(value: object) -> tuple[str, ...]:
    """Return normalized, de-duplicated user-provided hint terms."""
    if not isinstance(value, str):
        return ()
    return tuple(
        dict.fromkeys(
            term.strip() for term in _HOTWORD_SEPARATOR.split(value) if term.strip()
        )
    )


def hotword_audit(value: object, final_text: str) -> dict[str, Any] | None:
    """Count exact normalized term appearances without changing recognition."""
    terms = list(hotword_terms(value))
    if not terms:
        return None
    normalized = re.sub(r"\s+", "", final_text.casefold())
    matched = [
        term
        for term in terms
        if re.sub(r"\s+", "", term.casefold()) in normalized
    ]
    missing = [
        term
        for term in terms
        if re.sub(r"\s+", "", term.casefold()) not in normalized
    ]
    return {
        "term_count": len(terms),
        "matched_count": len(matched),
        "missing_count": len(missing),
        "matched_terms": matched[:20],
        "missing_terms": missing[:20],
        "omitted_term_count": max(0, len(terms) - 20),
    }


def candidate_rejection_reason(
    base_segments: Sequence[object],
    candidate_segments: Sequence[object],
    region: EnglishCandidateRegion,
    diagnostics: Mapping[str, Any],
) -> str | None:
    """Return a stable rejection reason, or None when automatic splice is safe."""
    if not candidate_segments:
        return "empty_candidate"
    text = " ".join(str(getattr(segment, "text", "")) for segment in candidate_segments)
    latin_word_count = len(_LATIN_WORD.findall(text))
    if latin_word_count < 2:
        return "insufficient_latin_words"
    duration = max(0.001, region.end - region.start)
    if latin_word_count / duration > 4.5:
        return "implausible_speech_rate"
    for segment in candidate_segments:
        log_probability = _number(getattr(segment, "avg_logprob", None))
        no_speech_probability = _number(getattr(segment, "no_speech_prob", None))
        if (
            log_probability is None
            or log_probability < -0.7
            or (no_speech_probability is not None and no_speech_probability > 0.45)
        ):
            return "low_candidate_confidence"
    for suspicious in diagnostics.get("segments", ()):
        reasons = set(suspicious.get("reasons", ()))
        if reasons & _HARD_REJECTION_REASONS:
            return "unsafe_quality"

    previous_end = -math.inf
    for segment in candidate_segments:
        start = _number(getattr(segment, "start", None))
        end = _number(getattr(segment, "end", None))
        if start is None or end is None or start < previous_end or end <= start:
            return "invalid_timeline"
        if start < region.start - 0.5 or end > region.end + 0.5:
            return "candidate_outside_region"
        previous_end = end

    base_words = _flatten_words(base_segments)
    candidate_words = _flatten_words(candidate_segments)
    if base_words and candidate_words:
        selected_words = _selected_word_indexes(base_words, region)
        if not selected_words:
            return "no_aligned_primary_segment"
        previous_word_end = (
            _word_number(base_words[selected_words[0] - 1][0], "end")
            if selected_words[0] > 0
            else None
        )
        next_word_start = (
            _word_number(base_words[selected_words[-1] + 1][0], "start")
            if selected_words[-1] + 1 < len(base_words)
            else None
        )
        candidate_start = _word_number(candidate_words[0][0], "start")
        candidate_end = _word_number(candidate_words[-1][0], "end")
        if candidate_start is None or candidate_end is None:
            return "invalid_timeline"
        if previous_word_end is not None and candidate_start < previous_word_end - 0.08:
            return "unsafe_boundary"
        if next_word_start is not None and candidate_end > next_word_start + 0.08:
            return "unsafe_boundary"
        return None

    selected = _selected_base_indexes(base_segments, region)
    if not selected:
        return "no_aligned_primary_segment"
    first, last = selected[0], selected[-1]
    candidate_start = _number(getattr(candidate_segments[0], "start", None))
    candidate_end = _number(getattr(candidate_segments[-1], "end", None))
    if candidate_start is None or candidate_end is None:
        return "invalid_timeline"
    if first > 0:
        prior_end = _number(getattr(base_segments[first - 1], "end", None))
        if prior_end is not None and candidate_start < prior_end:
            return "unsafe_boundary"
    if last + 1 < len(base_segments):
        next_start = _number(getattr(base_segments[last + 1], "start", None))
        if next_start is not None and candidate_end > next_start:
            return "unsafe_boundary"
    return None


def splice_candidate_segments(
    base_segments: Sequence[object],
    replacements: Sequence[tuple[EnglishCandidateRegion, Sequence[object]]],
) -> list[object]:
    """Splice accepted candidates into primary segments with monotonic ordering."""
    base_words = _flatten_words(base_segments)
    if base_words and all(_flatten_words(candidate) for _, candidate in replacements):
        return _splice_candidate_words(base_words, replacements)
    accepted: dict[int, tuple[int, Sequence[object]]] = {}
    for region, candidate in replacements:
        indexes = _selected_base_indexes(base_segments, region)
        if indexes:
            accepted[indexes[0]] = (indexes[-1], candidate)
    merged: list[object] = []
    index = 0
    while index < len(base_segments):
        replacement = accepted.get(index)
        if replacement is None:
            merged.append(base_segments[index])
            index += 1
            continue
        last, candidate = replacement
        merged.extend(candidate)
        index = last + 1
    return merged


def segments_for_region(
    segments: Sequence[object],
    start: float,
    end: float,
    *,
    require_contained_words: bool = False,
) -> list[object]:
    """Trim word-timed segments to a safe absolute media interval."""
    words = _flatten_words(segments)
    if not words:
        return [
            segment
            for segment in segments
            if _segment_midpoint_in_region(segment, start, end)
        ]
    selected = [
        item
        for item in words
        if (
            _word_within_region(item[0], start, end)
            if require_contained_words
            else _word_midpoint_in_region(item[0], start, end)
        )
    ]
    grouped: list[object] = []
    group: list[tuple[object, object]] = []
    for item in selected:
        if group and item[1] is not group[-1][1]:
            grouped.append(_word_group_segment(group))
            group = []
        group.append(item)
    if group:
        grouped.append(_word_group_segment(group))
    return grouped


def _splice_candidate_words(
    base_words: list[tuple[object, object]],
    replacements: Sequence[tuple[EnglishCandidateRegion, Sequence[object]]],
) -> list[object]:
    accepted: dict[int, tuple[int, list[tuple[object, object]]]] = {}
    for region, candidate_segments in replacements:
        indexes = _selected_word_indexes(base_words, region)
        candidate_words = _flatten_words(candidate_segments)
        if indexes and candidate_words:
            accepted[indexes[0]] = (indexes[-1], candidate_words)

    merged_words: list[tuple[object, object]] = []
    index = 0
    while index < len(base_words):
        replacement = accepted.get(index)
        if replacement is None:
            merged_words.append(base_words[index])
            index += 1
            continue
        last, candidate_words = replacement
        merged_words.extend(candidate_words)
        index = last + 1

    segments: list[object] = []
    group: list[tuple[object, object]] = []
    for item in merged_words:
        if group and item[1] is not group[-1][1]:
            segments.append(_word_group_segment(group))
            group = []
        group.append(item)
    if group:
        segments.append(_word_group_segment(group))
    return segments


def _word_group_segment(group: Sequence[tuple[object, object]]) -> MixedLanguageSegment:
    words = tuple(word for word, _parent in group)
    parent = group[0][1]
    start = _word_number(words[0], "start") or 0.0
    end = _word_number(words[-1], "end") or start + 0.001
    return MixedLanguageSegment(
        start=start,
        end=max(start + 0.001, end),
        text="".join(str(_word_value(word, "word", "")) for word in words),
        words=words,
        temperature=_number(getattr(parent, "temperature", None)),
        avg_logprob=_number(getattr(parent, "avg_logprob", None)),
        compression_ratio=_number(getattr(parent, "compression_ratio", None)),
        no_speech_prob=_number(getattr(parent, "no_speech_prob", None)),
    )


def _flatten_words(segments: Sequence[object]) -> list[tuple[object, object]]:
    flattened: list[tuple[object, object]] = []
    for segment in segments:
        words = getattr(segment, "words", None)
        if not isinstance(words, Sequence) or isinstance(words, (str, bytes, bytearray)):
            continue
        for word in words:
            if (
                _word_number(word, "start") is not None
                and _word_number(word, "end") is not None
                and str(_word_value(word, "word", "")).strip()
            ):
                flattened.append((word, segment))
    return sorted(
        flattened,
        key=lambda item: (
            _word_number(item[0], "start") or 0.0,
            _word_number(item[0], "end") or 0.0,
        ),
    )


def _selected_word_indexes(
    words: Sequence[tuple[object, object]],
    region: EnglishCandidateRegion,
) -> list[int]:
    selected: list[int] = []
    selection_start = max(0.0, region.start - 0.12)
    selection_end = region.end + 0.12
    for index, (word, _segment) in enumerate(words):
        start = _word_number(word, "start")
        end = _word_number(word, "end")
        if start is None or end is None or end <= start:
            continue
        overlap = max(0.0, min(end, selection_end) - max(start, selection_start))
        midpoint = start + (end - start) / 2
        if selection_start <= midpoint <= selection_end or overlap / (end - start) >= 0.25:
            selected.append(index)
    return selected


def _word_value(word: object, name: str, default: object = None) -> object:
    if isinstance(word, Mapping):
        return word.get(name, default)
    return getattr(word, name, default)


def _word_number(word: object, name: str) -> float | None:
    return _number(_word_value(word, name))


def _selected_base_indexes(
    segments: Sequence[object],
    region: EnglishCandidateRegion,
) -> list[int]:
    selected: list[int] = []
    for index, segment in enumerate(segments):
        start = _number(getattr(segment, "start", None))
        end = _number(getattr(segment, "end", None))
        if start is None or end is None:
            continue
        midpoint = start + (end - start) / 2
        if region.start <= midpoint <= region.end:
            selected.append(index)
    return selected


def _segment_midpoint_in_region(segment: object, start: float, end: float) -> bool:
    segment_start = _number(getattr(segment, "start", None))
    segment_end = _number(getattr(segment, "end", None))
    if segment_start is None or segment_end is None or segment_end <= segment_start:
        return False
    midpoint = segment_start + (segment_end - segment_start) / 2
    return start - 0.12 <= midpoint <= end + 0.12


def _word_midpoint_in_region(word: object, start: float, end: float) -> bool:
    word_start = _word_number(word, "start")
    word_end = _word_number(word, "end")
    if word_start is None or word_end is None or word_end <= word_start:
        return False
    midpoint = word_start + (word_end - word_start) / 2
    return start - 0.12 <= midpoint <= end + 0.12


def _word_within_region(word: object, start: float, end: float) -> bool:
    word_start = _word_number(word, "start")
    word_end = _word_number(word, "end")
    return (
        word_start is not None
        and word_end is not None
        and word_end > word_start
        and word_start >= start - 0.12
        and word_end <= end + 0.12
    )


def _number(value: object) -> float | None:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        number = float(value)
        if math.isfinite(number):
            return number
    return None
