"""Time-aware plain-text and Markdown layout for real Whisper segments."""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass, replace
import unicodedata

from .postprocess import get_strategy


LINE_PAUSE_SECONDS = 0.8
PARAGRAPH_PAUSE_SECONDS = 1.8
PREFERRED_LINE_UNITS = 80
HARD_LINE_UNITS = 120
PARAGRAPH_LINE_LIMIT = 3
PARAGRAPH_UNIT_LIMIT = 240

_CHINESE_STRONG_PUNCTUATION = frozenset("。！？")
_ASCII_STRONG_PUNCTUATION = frozenset("!?")
_WEAK_PUNCTUATION = frozenset("，,；;：:、")
_CLOSING_PUNCTUATION = frozenset("\"'”’）)]】》」』")
_ENGLISH_ABBREVIATIONS = frozenset(
    {
        "mr.",
        "mrs.",
        "ms.",
        "dr.",
        "prof.",
        "sr.",
        "jr.",
        "vs.",
        "etc.",
        "e.g.",
        "i.e.",
        "a.m.",
        "p.m.",
        "u.s.",
        "u.k.",
        "no.",
    }
)


@dataclass(frozen=True, slots=True)
class TranscriptUnit:
    """One readable transcript line with its source time range."""

    text: str
    start: float
    end: float
    paragraph_break_after: bool = False


@dataclass(frozen=True, slots=True)
class TranscriptDocument:
    """Post-processed transcript units and their two rendered text formats."""

    units: tuple[TranscriptUnit, ...]
    source_unit_count: int
    txt_content: str
    markdown_content: str


@dataclass(frozen=True, slots=True)
class _Piece:
    text: str
    start: float
    end: float
    boundary: str


def display_units(text: str) -> int:
    """Count CJK/full-width glyphs as two units and other glyphs as one."""
    return sum(
        2 if unicodedata.east_asian_width(character) in {"W", "F"} else 1
        for character in text
    )


def _value(segment: object, name: str, default: object = None) -> object:
    if isinstance(segment, Mapping):
        return segment.get(name, default)
    return getattr(segment, name, default)


def _gap_at_least(gap: float, threshold: float) -> bool:
    return gap + 1e-9 >= threshold


def _english_token_ending_at(text: str, index: int) -> str:
    start = index
    while start > 0 and not text[start - 1].isspace():
        start -= 1
    return text[start : index + 1].casefold()


def _is_strong_boundary(text: str, index: int, language: str) -> bool:
    character = text[index]
    if character in _CHINESE_STRONG_PUNCTUATION:
        return True
    if character in _ASCII_STRONG_PUNCTUATION:
        return True
    if character != ".":
        return False

    previous = text[index - 1] if index > 0 else ""
    following = text[index + 1] if index + 1 < len(text) else ""
    if previous.isdigit() and following.isdigit():
        return False
    if language != "en":
        return True
    if following and not following.isspace() and following not in _CLOSING_PUNCTUATION:
        return False

    token = _english_token_ending_at(text, index)
    if token in _ENGLISH_ABBREVIATIONS:
        return False
    if len(token) == 2 and token[0].isalpha():
        return False
    return True


def _tokenize_segment(text: str, start: float, end: float, language: str) -> list[_Piece]:
    pieces: list[_Piece] = []
    buffer: list[str] = []
    pending_strong = False

    def emit(boundary: str) -> None:
        value = "".join(buffer)
        if value:
            pieces.append(_Piece(value, start, end, boundary))
        buffer.clear()

    for index, character in enumerate(text):
        if pending_strong and character not in _CLOSING_PUNCTUATION:
            emit("strong")
            pending_strong = False

        buffer.append(character)
        if _is_strong_boundary(text, index, language):
            pending_strong = True
        elif not pending_strong and character in _WEAK_PUNCTUATION:
            emit("weak")
        elif not pending_strong and language == "en" and character.isspace():
            emit("space")

    if buffer:
        emit("strong" if pending_strong else "segment")
    elif pieces and pieces[-1].boundary not in {"strong", "weak"}:
        pieces[-1] = replace(pieces[-1], boundary="segment")
    return pieces


def _is_ascii_word_character(character: str) -> bool:
    return character.isascii() and (character.isalnum() or character in "_-")


def _content_hard_limit(language: str) -> int:
    # Existing post-processing may append a full-width Chinese terminator or
    # one ASCII terminator. Reserve that space so rendered lines stay <= 120.
    return HARD_LINE_UNITS - (2 if language == "zh" else 1)


def _hard_split_text(text: str, limit: int) -> list[str]:
    value = text.strip()
    if display_units(text) <= limit:
        return [text] if value else []
    if value and all(_is_ascii_word_character(character) for character in value):
        return [value]

    chunks: list[str] = []
    remainder = value
    while display_units(remainder) > limit:
        width = 0
        cut = 0
        for index, character in enumerate(remainder):
            character_width = display_units(character)
            if width + character_width > limit:
                break
            width += character_width
            cut = index + 1

        if 0 < cut < len(remainder):
            if _is_ascii_word_character(remainder[cut - 1]) and _is_ascii_word_character(
                remainder[cut]
            ):
                word_start = cut
                while word_start > 0 and _is_ascii_word_character(
                    remainder[word_start - 1]
                ):
                    word_start -= 1
                if word_start > 0:
                    cut = word_start
                else:
                    while cut < len(remainder) and _is_ascii_word_character(
                        remainder[cut]
                    ):
                        cut += 1
        if cut <= 0:
            break
        chunks.append(remainder[:cut].strip())
        remainder = remainder[cut:].strip()

    if remainder:
        chunks.append(remainder)
    return [chunk for chunk in chunks if chunk]


def build_transcript_units(
    segments: Iterable[object], language: str
) -> tuple[TranscriptUnit, ...]:
    """Create readable units from punctuation, real pauses and safe length limits."""
    units: list[TranscriptUnit] = []
    current_parts: list[str] = []
    current_start = 0.0
    current_end = 0.0
    previous_segment_end: float | None = None
    hard_limit = _content_hard_limit(language)

    def mark_previous_paragraph() -> None:
        if units and not units[-1].paragraph_break_after:
            units[-1] = replace(units[-1], paragraph_break_after=True)

    def flush(*, paragraph_break_after: bool = False) -> None:
        nonlocal current_start, current_end
        text = "".join(current_parts).strip()
        if text:
            units.append(
                TranscriptUnit(
                    text=text,
                    start=current_start,
                    end=current_end,
                    paragraph_break_after=paragraph_break_after,
                )
            )
        current_parts.clear()
        current_start = 0.0
        current_end = 0.0

    for segment in segments:
        text = str(_value(segment, "text", "")).strip()
        if not text:
            continue
        start = float(_value(segment, "start", 0.0))
        end = float(_value(segment, "end", start))
        gap = start - previous_segment_end if previous_segment_end is not None else 0.0
        if _gap_at_least(gap, LINE_PAUSE_SECONDS):
            paragraph_break = _gap_at_least(gap, PARAGRAPH_PAUSE_SECONDS)
            if current_parts:
                flush(paragraph_break_after=paragraph_break)
            elif paragraph_break:
                mark_previous_paragraph()

        pieces = _tokenize_segment(text, start, end, language)
        for piece_index, piece in enumerate(pieces):
            piece_text = piece.text
            if piece_index == 0 and current_parts:
                piece_text = f" {piece_text.lstrip()}"
            piece_width = display_units(piece_text)
            current_width = display_units("".join(current_parts))

            if current_parts and current_width + piece_width > hard_limit:
                flush()
                piece_text = piece_text.lstrip()

            hard_chunks = _hard_split_text(piece_text, hard_limit)
            for chunk_index, chunk in enumerate(hard_chunks):
                if not current_parts:
                    current_start = piece.start
                current_parts.append(chunk)
                current_end = piece.end
                is_last_chunk = chunk_index == len(hard_chunks) - 1
                if not is_last_chunk:
                    flush()
                    continue

                current_width = display_units("".join(current_parts))
                if piece.boundary == "strong":
                    flush()
                elif current_width >= PREFERRED_LINE_UNITS and piece.boundary in {
                    "weak",
                    "space",
                    "segment",
                }:
                    flush()

        previous_segment_end = end

    flush()
    return tuple(units)


def _apply_strategy(
    units: tuple[TranscriptUnit, ...], strategy_id: str
) -> tuple[TranscriptUnit, ...]:
    strategy = get_strategy(strategy_id)
    raw_texts = [unit.text for unit in units]
    cleaned_texts = strategy.process_lines(raw_texts)
    normalized_units = [replace(unit, text=strategy.process_text(unit.text)) for unit in units]

    aligned: list[TranscriptUnit] = []
    cleaned_index = 0
    for unit in normalized_units:
        if cleaned_index < len(cleaned_texts) and unit.text == cleaned_texts[cleaned_index]:
            aligned.append(unit)
            cleaned_index += 1
            continue
        if aligned:
            previous = aligned[-1]
            aligned[-1] = replace(
                previous,
                end=max(previous.end, unit.end),
                paragraph_break_after=(
                    previous.paragraph_break_after or unit.paragraph_break_after
                ),
            )

    if cleaned_index != len(cleaned_texts):
        raise ValueError("post-processing changed transcript order unexpectedly")
    return tuple(aligned)


def _render_txt(units: tuple[TranscriptUnit, ...]) -> str:
    return "".join(f"{unit.text}\n" for unit in units)


def _render_markdown(units: tuple[TranscriptUnit, ...], language: str) -> str:
    paragraphs: list[str] = []
    current: list[str] = []
    current_width = 0

    def flush() -> None:
        if not current:
            return
        separator = "" if language == "zh" else " "
        paragraphs.append(separator.join(current))
        current.clear()

    for unit in units:
        current.append(unit.text.strip())
        current_width += display_units(unit.text)
        if (
            unit.paragraph_break_after
            or len(current) >= PARAGRAPH_LINE_LIMIT
            or current_width >= PARAGRAPH_UNIT_LIMIT
        ):
            flush()
            current_width = 0
    flush()
    return "\n\n".join(paragraphs) + ("\n" if paragraphs else "")


def build_transcript_document(
    segments: Iterable[object], language: str, strategy_id: str
) -> TranscriptDocument:
    """Build automatic TXT sentence lines and short Markdown paragraphs."""
    source_units = build_transcript_units(segments, language)
    units = _apply_strategy(source_units, strategy_id)
    return TranscriptDocument(
        units=units,
        source_unit_count=len(source_units),
        txt_content=_render_txt(units),
        markdown_content=_render_markdown(units, language),
    )
