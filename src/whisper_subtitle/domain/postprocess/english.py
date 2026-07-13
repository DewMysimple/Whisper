"""Pure English text normalization helpers."""

from __future__ import annotations

import re
from types import MappingProxyType


PROPER_NOUNS = MappingProxyType(
    {
        "i": "I",
        "i'm": "I'm",
        "i'll": "I'll",
        "i've": "I've",
        "i'd": "I'd",
        "monday": "Monday",
        "tuesday": "Tuesday",
        "wednesday": "Wednesday",
        "thursday": "Thursday",
        "friday": "Friday",
        "saturday": "Saturday",
        "sunday": "Sunday",
        "january": "January",
        "february": "February",
        "march": "March",
        "april": "April",
        "may": "May",
        "june": "June",
        "july": "July",
        "august": "August",
        "september": "September",
        "october": "October",
        "november": "November",
        "december": "December",
        "english": "English",
        "chinese": "Chinese",
        "japanese": "Japanese",
        "french": "French",
        "american": "American",
        "british": "British",
        "european": "European",
        "youtube": "YouTube",
        "google": "Google",
        "facebook": "Facebook",
        "iphone": "iPhone",
        "ipad": "iPad",
        "macbook": "MacBook",
        "adobe": "Adobe",
        "photoshop": "Photoshop",
        "blender": "Blender",
        "gaea": "Gaea",
        "houdini": "Houdini",
        "unreal": "Unreal",
        "unity": "Unity",
    }
)


def ensure_proper_case(text: str) -> str:
    """Capitalize sentences and restore the historical proper-noun spellings."""
    if not text:
        return text

    sentences = []
    for sentence in text.split(". "):
        sentence = sentence.strip()
        if sentence:
            if sentence[0].islower():
                sentence = sentence[0].upper() + sentence[1:]
            sentences.append(sentence)
    text = ". ".join(sentences)

    for lower, proper in PROPER_NOUNS.items():
        pattern = re.compile(r"\b" + re.escape(lower) + r"\b", re.IGNORECASE)
        text = pattern.sub(proper, text)
    return text


def ensure_punctuation(text: str) -> str:
    """Ensure English text ends in the same punctuation accepted by old Core."""
    text = text.strip()
    if text and text[-1] not in ".!?":
        text += "."
    return text
