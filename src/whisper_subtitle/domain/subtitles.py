"""Pure SRT cue composition from timestamped transcription sentences."""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
import re

from .postprocess.strategies import get_strategy


@dataclass(frozen=True, slots=True)
class SubtitleOptions:
    """User-controlled subtitle layout constraints."""

    max_characters_per_line: int = 18
    max_lines_per_cue: int = 1
    min_cue_duration_ms: int = 800
    max_cue_duration_ms: int = 7000
    max_characters_per_second: float = 20.0
    cue_gap_ms: int = 80

    def __post_init__(self) -> None:
        rules = (
            ("max_characters_per_line", self.max_characters_per_line, 8, 84),
            ("max_lines_per_cue", self.max_lines_per_cue, 1, 3),
            ("min_cue_duration_ms", self.min_cue_duration_ms, 250, 5000),
            ("max_cue_duration_ms", self.max_cue_duration_ms, 1000, 15000),
            ("max_characters_per_second", self.max_characters_per_second, 5, 40),
            ("cue_gap_ms", self.cue_gap_ms, 0, 1000),
        )
        for name, value, minimum, maximum in rules:
            if type(value) not in {int, float} or not minimum <= value <= maximum:
                raise ValueError(f"invalid subtitle option {name}: {value!r}")
        if self.min_cue_duration_ms > self.max_cue_duration_ms:
            raise ValueError("min_cue_duration_ms cannot exceed max_cue_duration_ms")

    @classmethod
    def from_mapping(cls, value: Mapping[str, object] | None) -> "SubtitleOptions":
        if value is None:
            return cls()
        return cls(
            max_characters_per_line=int(value.get("max_characters_per_line", 18)),
            max_lines_per_cue=int(value.get("max_lines_per_cue", 1)),
            min_cue_duration_ms=int(value.get("min_cue_duration_ms", 800)),
            max_cue_duration_ms=int(value.get("max_cue_duration_ms", 7000)),
            max_characters_per_second=float(value.get("max_characters_per_second", 20)),
            cue_gap_ms=int(value.get("cue_gap_ms", 80)),
        )


@dataclass(frozen=True, slots=True)
class SubtitleCue:
    start: float
    end: float
    lines: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class _TimedUnit:
    start: float
    end: float
    text: str
    leading_space: bool = False


_BREAK_AFTER = frozenset("。！？!?；;：:,，、")
_WHITESPACE = re.compile(r"\s+")
_ASCII_FRAGMENT = re.compile(r"[A-Za-z0-9'\u2019.,!?;:\-]+")
_SOFT_CUE_END = frozenset(",\uff0c;\uff1b:\uff1a")
_STRONG_CUE_END = frozenset(".\u3002!\uff01?\uff1f")


def _normalize_text(value: object) -> str:
    return _WHITESPACE.sub(" ", str(value)).strip()


def _word_value(word: object, name: str, default: object = None) -> object:
    if isinstance(word, Mapping):
        return word.get(name, default)
    return getattr(word, name, default)


def _is_ascii_fragment(text: str) -> bool:
    return bool(text) and _ASCII_FRAGMENT.fullmatch(text) is not None


def _extract_segment_units(segments: Iterable[object]) -> list[list[_TimedUnit]]:
    """Extract real faster-whisper word boundaries and join English subword pieces."""
    segment_units: list[list[_TimedUnit]] = []
    for segment in segments:
        words = _word_value(segment, "words")
        if words is None:
            if _normalize_text(_word_value(segment, "text", "")):
                return []
            continue
        units: list[_TimedUnit] = []
        for word in words:
            raw = str(_word_value(word, "word", ""))
            text = _normalize_text(raw)
            start_value = _word_value(word, "start")
            end_value = _word_value(word, "end")
            if not text or start_value is None or end_value is None:
                continue
            start = max(0.0, float(start_value))
            end = max(start + 0.001, float(end_value))
            leading_space = bool(raw[:1].isspace())
            if (
                units
                and not leading_space
                and _is_ascii_fragment(units[-1].text)
                and _is_ascii_fragment(text)
            ):
                previous = units[-1]
                units[-1] = _TimedUnit(
                    previous.start,
                    max(previous.end, end),
                    previous.text + text,
                    previous.leading_space,
                )
                continue
            units.append(_TimedUnit(start, end, text, leading_space))
        if units:
            segment_units.append(units)
    return segment_units


def _append_unit_text(current: str, unit: _TimedUnit) -> str:
    if not current:
        return unit.text
    separator = " " if unit.leading_space else ""
    return f"{current}{separator}{unit.text}"


def _split_oversized_unit(unit: _TimedUnit, limit: int) -> list[_TimedUnit]:
    if len(unit.text) <= limit:
        return [unit]
    chunks = [unit.text[index : index + limit] for index in range(0, len(unit.text), limit)]
    duration = unit.end - unit.start
    result: list[_TimedUnit] = []
    consumed = 0
    for index, chunk in enumerate(chunks):
        chunk_start = unit.start + duration * consumed / len(unit.text)
        consumed += len(chunk)
        chunk_end = unit.end if index == len(chunks) - 1 else unit.start + duration * consumed / len(unit.text)
        result.append(_TimedUnit(chunk_start, chunk_end, chunk, unit.leading_space and index == 0))
    return result


def _select_group_end(
    units: list[_TimedUnit], start_index: int, options: SubtitleOptions, capacity: int
) -> int:
    """Choose a spoken phrase boundary without exceeding the configured capacity."""
    preferred_capacity = max(1, int(capacity * 0.85))
    minimum_duration = options.min_cue_duration_ms / 1000
    maximum_duration = options.max_cue_duration_ms / 1000
    text = ""
    preferred_end: int | None = None
    index = start_index
    while index < len(units):
        candidate = _append_unit_text(text, units[index])
        duration = units[index].end - units[start_index].start
        if text and (len(candidate) > capacity or duration > maximum_duration):
            return preferred_end or index
        text = candidate
        if len(text) <= preferred_capacity:
            preferred_end = index + 1
        ending = units[index].text[-1]
        if ending in _STRONG_CUE_END:
            return index + 1
        if (
            ending in _SOFT_CUE_END
            and len(text) >= max(6, capacity // 3)
            and duration >= minimum_duration
        ):
            return index + 1
        index += 1
    return len(units)


def _remove_repeated_word_cues(
    cues: list[SubtitleCue], strategy_id: str
) -> list[SubtitleCue]:
    """Keep anti-hallucination cleanup while retaining the matching word timings."""
    if not strategy_id.endswith("anti_hallucination"):
        return cues
    strategy = get_strategy(strategy_id)
    processed = ["".join(cue.lines) for cue in cues]
    retained = list(range(len(cues)))
    for transform in strategy.lines_transforms:
        transformed = transform(processed)
        next_retained: list[int] = []
        cursor = 0
        for text in transformed:
            while cursor < len(processed) and processed[cursor] != text:
                cursor += 1
            if cursor >= len(processed):
                return cues
            next_retained.append(retained[cursor])
            cursor += 1
        retained = next_retained
        processed = transformed
    return [cues[index] for index in retained]


def _process_word_cue_text(text: str, strategy_id: str) -> str:
    """Apply the preset text cleanup without inventing punctuation mid-sentence."""
    source_has_terminal = bool(text) and text[-1] in _STRONG_CUE_END
    processed = _normalize_text(get_strategy(strategy_id).process_text(text))
    if not source_has_terminal and processed and processed[-1] in _STRONG_CUE_END:
        processed = processed[:-1].rstrip()
    return processed


def build_word_timed_subtitle_cues(
    segments: Iterable[object],
    strategy_id: str,
    options: SubtitleOptions | Mapping[str, object] | None = None,
) -> list[SubtitleCue]:
    """Build cues from actual word starts/ends instead of proportional sentence timing."""
    resolved = options if isinstance(options, SubtitleOptions) else SubtitleOptions.from_mapping(options)
    capacity = resolved.max_characters_per_line * resolved.max_lines_per_cue
    segment_units = _extract_segment_units(segments)
    if not segment_units:
        return []

    groups: list[tuple[float, float, str]] = []
    for raw_units in segment_units:
        units = [
            part
            for unit in raw_units
            for part in _split_oversized_unit(unit, capacity)
        ]
        cursor = 0
        while cursor < len(units):
            end_index = _select_group_end(units, cursor, resolved, capacity)
            group = units[cursor:end_index]
            text = ""
            for unit in group:
                text = _append_unit_text(text, unit)
            groups.append((group[0].start, group[-1].end, text))
            cursor = end_index

    cues = [
        SubtitleCue(
            start,
            end,
            tuple(
                _split_text(
                    _process_word_cue_text(text, strategy_id),
                    resolved.max_characters_per_line,
                )
            ),
        )
        for start, end, text in groups
    ]
    cues = _remove_repeated_word_cues(cues, strategy_id)

    # Preserve the next cue's real start. If a model boundary overlaps, shorten
    # the previous cue instead of delaying the next spoken word on screen.
    desired_gap = resolved.cue_gap_ms / 1000
    adjusted: list[SubtitleCue] = []
    for cue in cues:
        if adjusted and adjusted[-1].end + desired_gap > cue.start:
            previous = adjusted[-1]
            adjusted[-1] = SubtitleCue(
                previous.start,
                max(previous.start + 0.001, cue.start - desired_gap),
                previous.lines,
            )
        adjusted.append(cue)
    return adjusted


def _postprocess_timed_sentences(
    sentences: Iterable[Mapping[str, float | str]], strategy_id: str
) -> list[dict[str, float | str]]:
    strategy = get_strategy(strategy_id)
    items = [
        {
            "start": float(sentence["start"]),
            "end": float(sentence["end"]),
            "text": _normalize_text(strategy.process_text(str(sentence["text"]))),
        }
        for sentence in sentences
        if _normalize_text(sentence.get("text", ""))
    ]
    for transform in strategy.lines_transforms:
        transformed = transform([str(item["text"]) for item in items])
        retained: list[dict[str, float | str]] = []
        cursor = 0
        for text in transformed:
            while cursor < len(items) and items[cursor]["text"] != text:
                cursor += 1
            if cursor >= len(items):
                raise ValueError("subtitle postprocess changed text identity unexpectedly")
            retained.append(items[cursor])
            cursor += 1
        items = retained
    return items


def _split_text(text: str, limit: int) -> list[str]:
    text = text.strip()
    chunks: list[str] = []
    while len(text) > limit:
        minimum = max(1, int(limit * 0.55))
        split_at = 0
        for index in range(limit - 1, minimum - 1, -1):
            character = text[index]
            if character.isspace():
                split_at = index
                break
            if character in _BREAK_AFTER:
                split_at = index + 1
                break
        if split_at == 0:
            split_at = limit
        chunks.append(text[:split_at].strip())
        text = text[split_at:].strip()
    if text:
        chunks.append(text)
    return chunks


def _split_sentence(
    sentence: Mapping[str, float | str], options: SubtitleOptions
) -> list[tuple[float, float, tuple[str, ...]]]:
    text = str(sentence["text"])
    start = max(0.0, float(sentence["start"]))
    end = max(start + 0.001, float(sentence["end"]))
    duration = end - start
    reading_limit = max(1, int(options.max_characters_per_second * options.max_cue_duration_ms / 1000))
    line_width = max(1, min(options.max_characters_per_line, reading_limit))
    chunks: list[tuple[str, ...]] = []
    current_lines: list[str] = []
    current_characters = 0
    for line in _split_text(text, line_width):
        line_characters = len(line)
        if current_lines and (
            len(current_lines) >= options.max_lines_per_cue
            or current_characters + line_characters > reading_limit
        ):
            chunks.append(tuple(current_lines))
            current_lines = []
            current_characters = 0
        current_lines.append(line)
        current_characters += line_characters
    if current_lines:
        chunks.append(tuple(current_lines))
    weights = [
        max(1, sum(len(line.replace(" ", "")) for line in lines))
        for lines in chunks
    ]
    total_weight = sum(weights)
    values = []
    cursor = start
    consumed = 0
    for index, (lines, weight) in enumerate(zip(chunks, weights)):
        consumed += weight
        chunk_end = end if index == len(chunks) - 1 else start + duration * consumed / total_weight
        values.append((cursor, max(cursor + 0.001, chunk_end), lines))
        cursor = chunk_end
    return values


def _merge_short_sentences(
    items: list[dict[str, float | str]], options: SubtitleOptions
) -> list[dict[str, float | str]]:
    if not items:
        return []
    capacity = options.max_characters_per_line * options.max_lines_per_cue
    maximum_duration = options.max_cue_duration_ms / 1000
    minimum_duration = options.min_cue_duration_ms / 1000
    maximum_gap = options.cue_gap_ms / 1000
    merged: list[dict[str, float | str]] = []
    for item in items:
        if merged:
            previous = merged[-1]
            gap = float(item["start"]) - float(previous["end"])
            combined_text = f'{previous["text"]} {item["text"]}'.strip()
            combined_duration = float(item["end"]) - float(previous["start"])
            short = (
                float(previous["end"]) - float(previous["start"]) < minimum_duration
                or float(item["end"]) - float(item["start"]) < minimum_duration
            )
            if (
                short
                and gap <= maximum_gap
                and len(combined_text) <= capacity
                and combined_duration <= maximum_duration
            ):
                merged[-1] = {
                    "start": previous["start"],
                    "end": item["end"],
                    "text": combined_text,
                }
                continue
        merged.append(dict(item))
    return merged


def build_subtitle_cues(
    sentences: Iterable[Mapping[str, float | str]],
    strategy_id: str,
    options: SubtitleOptions | Mapping[str, object] | None = None,
) -> list[SubtitleCue]:
    """Create ordered, non-overlapping cues without inventing model timestamps."""
    resolved = options if isinstance(options, SubtitleOptions) else SubtitleOptions.from_mapping(options)
    items = _merge_short_sentences(
        _postprocess_timed_sentences(sentences, strategy_id), resolved
    )
    raw_cues: list[tuple[float, float, tuple[str, ...]]] = []
    for sentence in items:
        raw_cues.extend(_split_sentence(sentence, resolved))

    gap = resolved.cue_gap_ms / 1000
    cues: list[SubtitleCue] = []
    previous_end = 0.0
    for start, end, lines in raw_cues:
        adjusted_start = max(start, previous_end + (gap if cues else 0.0))
        if adjusted_start >= end:
            adjusted_start = previous_end
        adjusted_end = max(adjusted_start + 0.001, end)
        cues.append(
            SubtitleCue(
                adjusted_start,
                adjusted_end,
                lines,
            )
        )
        previous_end = adjusted_end
    return cues


def format_srt_timestamp(seconds: float) -> str:
    milliseconds = max(0, round(seconds * 1000))
    hours, remainder = divmod(milliseconds, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    whole_seconds, milliseconds = divmod(remainder, 1000)
    return f"{hours:02d}:{minutes:02d}:{whole_seconds:02d},{milliseconds:03d}"


def render_srt(cues: Iterable[SubtitleCue]) -> str:
    blocks = []
    for index, cue in enumerate(cues, start=1):
        blocks.append(
            "\n".join(
                (
                    str(index),
                    f"{format_srt_timestamp(cue.start)} --> {format_srt_timestamp(cue.end)}",
                    *cue.lines,
                )
            )
        )
    return "\n\n".join(blocks) + ("\n" if blocks else "")


def build_srt_document(
    sentences: Iterable[Mapping[str, float | str]],
    strategy_id: str,
    options: SubtitleOptions | Mapping[str, object] | None = None,
    *,
    word_segments: Iterable[object] | None = None,
) -> str:
    if word_segments is not None:
        word_cues = build_word_timed_subtitle_cues(word_segments, strategy_id, options)
        if word_cues:
            return render_srt(word_cues)
    return render_srt(build_subtitle_cues(sentences, strategy_id, options))
