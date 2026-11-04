"""Reference-based ASR metrics; never interpret backend placeholder confidence."""

from __future__ import annotations

import re
import unicodedata


def normalize(text: str) -> str:
    return "".join(c.lower() if c.isspace() or unicodedata.category(c)[0] in {"L", "N"}
                   else " " for c in unicodedata.normalize("NFKC", text))


def edit_distance(reference, hypothesis) -> int:
    """Exact unit-cost Levenshtein using bit vectors, bounded by reference length."""
    if not reference:
        return len(hypothesis)
    masks = {}
    for i, unit in enumerate(reference):
        masks[unit] = masks.get(unit, 0) | (1 << i)
    positive, negative, score = ~0, 0, len(reference)
    high_bit = 1 << (len(reference) - 1)
    for unit in hypothesis:
        equal = masks.get(unit, 0)
        combined = equal | negative
        horizontal = (((equal & positive) + positive) ^ positive) | equal
        plus = negative | ~(horizontal | positive)
        minus = positive & horizontal
        score += bool(plus & high_bit) - bool(minus & high_bit)
        plus = (plus << 1) | 1
        positive = (minus << 1) | ~(combined | plus)
        negative = combined & plus
    return score


def text_metrics(reference: str | None, hypothesis: str) -> dict:
    if reference is None:
        return {"cer": None, "wer": None, "unexpected_text_units": None, "empty_omission": None}
    ref, hyp = normalize(reference), normalize(hypothesis)
    chars, recognized = "".join(ref.split()), "".join(hyp.split())
    words, recognized_words = ref.split(), hyp.split()
    return {
        "cer": edit_distance(chars, recognized) / len(chars) if chars else None,
        "wer": edit_distance(words, recognized_words) / len(words) if words else None,
        "unexpected_text_units": len(recognized) if not chars else 0,
        "empty_omission": bool(chars and not recognized),
    }


def srt_cues(text: str) -> list[dict]:
    cues = []
    for block in re.split(r"\n\s*\n", text.strip()):
        lines = block.splitlines()
        if len(lines) < 3:
            continue
        times = re.fullmatch(r"(\d+):(\d\d):(\d\d),(\d{3}) --> (\d+):(\d\d):(\d\d),(\d{3})", lines[1])
        if times:
            h, m, s, ms, eh, em, es, ems = map(int, times.groups())
            cues.append({"start": h*3600+m*60+s+ms/1000,
                         "end": eh*3600+em*60+es+ems/1000,
                         "text": " ".join(lines[2:])})
    return cues


def timing_metrics(reference_spans: list[dict], cues: list[dict]) -> dict:
    """Only score unambiguous exact-text matches; do not invent alignment."""
    matched, missing, offsets = 0, [], []
    for span in reference_spans:
        key = "".join(normalize(span["text"]).split())
        candidates = [cue for cue in cues if "".join(normalize(cue["text"]).split()) == key]
        if not candidates:
            missing.append(span["text"])
        if len(candidates) == 1:
            matched += 1
            offsets.extend(abs(candidates[0][field] - span[field]) for field in ("start", "end"))
    return {"timed_reference_count": len(reference_spans), "matched_reference_count": matched,
            "missing_reference_spans": missing,
            "mean_boundary_offset_seconds": sum(offsets)/len(offsets) if offsets else None}


def compare_reports(before: dict, after: dict) -> list[dict]:
    previous = {(r["sample_id"], r["model_id"]): r for r in before["results"]}
    comparisons = []
    for result in after["results"]:
        old = previous.get((result["sample_id"], result["model_id"]))
        comparable = old is not None and old.get("status") == result.get("status") == "completed" and bool(result.get("input_sha256")) and all(old.get(k) == result.get(k) for k in
            ("input_sha256", "reference_sha256", "preset_id", "parameters", "subtitle_options"))
        deltas = {}
        if comparable:
            for key in ("cer", "wer", "unexpected_text_units", "mean_boundary_offset_seconds",
                        "total_seconds", "peak_rss_mib", "peak_gpu_device_mib"):
                a, b = old.get("metrics", {}).get(key), result.get("metrics", {}).get(key)
                deltas[key] = b-a if isinstance(a, (float, int)) and isinstance(b, (float, int)) else None
        comparisons.append({"sample_id": result["sample_id"], "model_id": result["model_id"],
                            "comparable": comparable, "delta_candidate_minus_baseline": deltas})
    return comparisons
