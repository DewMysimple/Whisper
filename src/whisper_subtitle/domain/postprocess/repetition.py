"""Pure sentence-level and Chinese intra-sentence repetition cleanup."""

from __future__ import annotations

import re


_INNER_REPETITION_PATTERN = re.compile(r"([\u4e00-\u9fa5]{2,6})\1{2,}")


def clean_inner_repetition(text: str) -> str:
    """Collapse a 2-6 Chinese-character fragment repeated at least three times."""
    if not text:
        return text
    previous = None
    while previous != text:
        previous = text
        text = _INNER_REPETITION_PATTERN.sub(r"\1", text)
    return text


def clean_repetition(lines):
    """Preserve one item from every consecutive run, including repeated tails."""
    if not lines:
        return lines

    count = len(lines)
    if count >= 4:
        last = lines[-1]
        if all(line == last for line in lines[-4:]):
            index = count - 1
            while index > 0 and lines[index - 1] == last:
                index -= 1
            lines = lines[: index + 1]

    if not lines:
        return lines
    cleaned = [lines[0]]
    for line in lines[1:]:
        if line == cleaned[-1]:
            continue
        cleaned.append(line)
    return cleaned
