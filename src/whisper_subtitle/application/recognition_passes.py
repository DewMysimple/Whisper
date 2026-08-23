"""Recognition passes kept separate from batch/output orchestration."""

from __future__ import annotations

import time
from collections.abc import Mapping
from dataclasses import replace
from pathlib import Path
from typing import TYPE_CHECKING, Any

from ..domain.detail_review import (
    DETAIL_CLIP_PADDING_SECONDS,
    DetailCandidateRegion,
    candidate_prompt,
    evaluate_detail_candidate,
    prior_context,
    replacement_preserves_protected_content,
    select_chinese_detail_regions,
    splice_detail_candidates,
    stable_splice_boundary_is_safe,
)
from ..domain.mixed_language import (
    EnglishCandidateRegion,
    candidate_rejection_reason,
    latin_hotwords,
    select_english_candidate_regions,
    splice_candidate_segments,
)
from ..domain.quality import build_recognition_quality_diagnostics
from ..domain.transcription import TranscriptionEngine

if TYPE_CHECKING:
    from .transcribe import TranscriptionService

def run_mixed_second_pass(
    service: "TranscriptionService",
    media_path: Path,
    engine: TranscriptionEngine,
    primary_segments: list[object],
    params: Mapping[str, Any],
    *,
    model_id: str,
    current: int,
    total: int,
    preset_id: str,
    media_started_at: float,
) -> tuple[list[object], list[dict[str, Any]], int]:
    """Detect and conservatively replace trustworthy English speech regions."""
    service._check_cancelled()
    service._emit(
        "language_scan_started",
        "🌐 正在扫描短语音块的中英文概率",
        current=current,
        total=total,
        preset_id=preset_id,
        input_path=media_path,
        media_progress_percent=75,
        media_elapsed_seconds=time.monotonic() - media_started_at,
        media_status="running",
    )
    detections = engine.detect_language_regions(
        str(media_path),
        max_speech_duration_s=8,
        min_silence_duration_ms=300,
        cancelled=service._cancelled,
    )
    service._check_cancelled()
    candidates = select_english_candidate_regions(detections, model_id=model_id)
    diagnostics: list[dict[str, Any]] = [
        {
            "start": detection.start,
            "end": detection.end,
            "top_language": detection.top_language,
            "top_probability": detection.top_probability,
            "english_probability": detection.english_probability,
            "chinese_probability": detection.chinese_probability,
            "primary_text": _segment_excerpt(
                primary_segments, detection.start, detection.end
            ),
            "candidate_text": "",
            "decision": "primary",
            "reason": None,
        }
        for detection in detections
    ]
    service._emit(
        "language_scan_completed",
        f"🌐 语言扫描完成：{len(detections)} 个语音块，{len(candidates)} 个英文候选区间",
        current=current,
        total=total,
        preset_id=preset_id,
        input_path=media_path,
        media_progress_percent=85,
        media_elapsed_seconds=time.monotonic() - media_started_at,
        media_status="running",
    )
    replacements: list[tuple[EnglishCandidateRegion, list[object]]] = []
    for index, region in enumerate(candidates, start=1):
        service._check_cancelled()
        candidate_options = dict(params)
        candidate_options.update(
            {
                "language": "en",
                "task": "transcribe",
                "multilingual": False,
                "condition_on_previous_text": False,
                "initial_prompt": None,
                "hotwords": latin_hotwords(params.get("hotwords")),
                "clip_timestamps": [region.start, region.end],
            }
        )
        generated, candidate_info = engine.transcribe(
            str(media_path), **candidate_options
        )
        candidate_segments: list[object] = []
        for segment in generated:
            service._check_cancelled()
            candidate_segments.append(segment)
        candidate_quality = build_recognition_quality_diagnostics(
            candidate_segments,
            candidate_info,
            candidate_options,
        )
        rejection = candidate_rejection_reason(
            primary_segments,
            candidate_segments,
            region,
            candidate_quality,
        )
        if rejection is None:
            decision = "replaced"
        elif rejection in {"unsafe_boundary", "no_aligned_primary_segment"}:
            decision = "review"
        else:
            decision = "rejected"
        if rejection is None:
            replacements.append((region, candidate_segments))
        _mark_region_diagnostics(
            diagnostics,
            region,
            candidate_segments,
            decision=decision,
            reason=rejection,
        )
        percent = 85 + index / max(1, len(candidates)) * 13
        service._emit(
            "secondary_pass_progress",
            (
                f"🔎 英文候选复识别 {index}/{len(candidates)} · "
                f"{'已采用' if decision == 'replaced' else '建议复核' if decision == 'review' else '已拒绝'}"
            ),
            current=current,
            total=total,
            preset_id=preset_id,
            input_path=media_path,
            media_progress_percent=percent,
            media_elapsed_seconds=time.monotonic() - media_started_at,
            media_status="running",
        )
    return (
        splice_candidate_segments(primary_segments, replacements),
        diagnostics,
        len(candidates),
    )

def run_chinese_detail_second_pass(
    service: "TranscriptionService",
    media_path: Path,
    engine: TranscriptionEngine,
    primary_segments: list[object],
    params: Mapping[str, Any],
    *,
    current: int,
    total: int,
    preset_id: str,
    media_started_at: float,
) -> tuple[list[object], list[dict[str, Any]], int]:
    """Re-recognize Chinese VAD blocks and adopt only proven improvements."""
    service._check_cancelled()
    service._emit(
        "detail_scan_started",
        "🔬 正在划分中文细节复识别区间",
        current=current,
        total=total,
        preset_id=preset_id,
        input_path=media_path,
        media_progress_percent=65,
        media_elapsed_seconds=time.monotonic() - media_started_at,
        media_status="running",
    )
    detections = engine.detect_language_regions(
        str(media_path),
        max_speech_duration_s=8,
        min_silence_duration_ms=300,
        speech_pad_ms=400,
        cancelled=service._cancelled,
    )
    service._check_cancelled()
    candidates = select_chinese_detail_regions(detections)
    service._emit(
        "detail_scan_completed",
        f"🔬 中文细节扫描完成：{len(candidates)} 个真实语音块",
        current=current,
        total=total,
        preset_id=preset_id,
        input_path=media_path,
        media_progress_percent=70,
        media_elapsed_seconds=time.monotonic() - media_started_at,
        media_status="running",
    )
    service._emit(
        "detail_primary_scoring_started",
        "📐 正在建立不改写正文的词级概率基线",
        current=current,
        total=total,
        preset_id=preset_id,
        input_path=media_path,
        media_progress_percent=70,
        media_elapsed_seconds=time.monotonic() - media_started_at,
        media_status="running",
    )
    scoring_options = dict(params)
    scoring_options["word_timestamps"] = True
    generated_scoring, _scoring_info = engine.transcribe(
        str(media_path),
        **scoring_options,
    )
    scoring_segments: list[object] = []
    for segment in generated_scoring:
        service._check_cancelled()
        scoring_segments.append(segment)
    service._emit(
        "detail_primary_scoring_completed",
        "📐 词级概率基线已建立；稳定第一遍正文保持不变",
        current=current,
        total=total,
        preset_id=preset_id,
        input_path=media_path,
        media_progress_percent=75,
        media_elapsed_seconds=time.monotonic() - media_started_at,
        media_status="running",
    )
    diagnostics: list[dict[str, Any]] = []
    replacements: list[tuple[DetailCandidateRegion, list[object]]] = []
    for index, region in enumerate(candidates, start=1):
        service._check_cancelled()
        context = prior_context(primary_segments, region.start)
        candidate_options = dict(params)
        candidate_options.update(
            {
                "language": "zh",
                "task": "transcribe",
                "multilingual": False,
                "condition_on_previous_text": True,
                "initial_prompt": candidate_prompt(
                    params.get("initial_prompt"), context
                ),
                "word_timestamps": True,
                "clip_timestamps": [
                    max(0.0, region.start - DETAIL_CLIP_PADDING_SECONDS),
                    region.end + DETAIL_CLIP_PADDING_SECONDS,
                ],
            }
        )
        generated, candidate_info = engine.transcribe(
            str(media_path), **candidate_options
        )
        raw_candidate_segments: list[object] = []
        for segment in generated:
            service._check_cancelled()
            raw_candidate_segments.append(segment)
        candidate_quality = build_recognition_quality_diagnostics(
            raw_candidate_segments,
            candidate_info,
            candidate_options,
        )
        decision, candidate_segments = evaluate_detail_candidate(
            scoring_segments,
            raw_candidate_segments,
            region,
            candidate_quality,
            params.get("hotwords"),
        )
        decision = replace(
            decision,
            primary_text=_segment_excerpt(
                primary_segments,
                region.start,
                region.end,
            ),
        )
        if decision.decision == "replaced":
            if not stable_splice_boundary_is_safe(primary_segments, region):
                decision = replace(
                    decision,
                    decision="review",
                    reason="unsafe_boundary",
                )
            else:
                tentative_replacements = [
                    *replacements,
                    (region, candidate_segments),
                ]
                tentative_segments = splice_detail_candidates(
                    primary_segments,
                    tentative_replacements,
                )
                if replacement_preserves_protected_content(
                    primary_segments,
                    tentative_segments,
                    params.get("hotwords"),
                ):
                    replacements = tentative_replacements
                else:
                    decision = replace(
                        decision,
                        decision="review",
                        reason="protected_content_changed",
                    )
        if decision.decision != "unchanged":
            diagnostics.append(
                {
                    "start": region.start,
                    "end": region.end,
                    "chinese_probability": region.chinese_probability,
                    "primary_text": decision.primary_text[:160],
                    "candidate_text": decision.candidate_text[:160],
                    "decision": decision.decision,
                    "reason": decision.reason,
                    "primary_word_probability": decision.primary_word_probability,
                    "candidate_word_probability": decision.candidate_word_probability,
                    "primary_log_probability": decision.primary_log_probability,
                    "candidate_log_probability": decision.candidate_log_probability,
                    "recovered_hotwords": list(decision.recovered_hotwords[:20]),
                }
            )
        percent = 75 + index / max(1, len(candidates)) * 23
        label = {
            "replaced": "已采用",
            "review": "建议复核",
            "rejected": "已拒绝",
            "unchanged": "结果一致",
        }[decision.decision]
        service._emit(
            "detail_second_pass_progress",
            f"🔎 中文细节复识别 {index}/{len(candidates)} · {label}",
            current=current,
            total=total,
            preset_id=preset_id,
            input_path=media_path,
            media_progress_percent=percent,
            media_elapsed_seconds=time.monotonic() - media_started_at,
            media_status="running",
        )
    return (
        splice_detail_candidates(primary_segments, replacements),
        diagnostics,
        len(candidates),
    )



def _segment_excerpt(segments: list[object], start: float, end: float) -> str:
    pieces = [
        str(getattr(segment, "text", "")).strip()
        for segment in segments
        if (midpoint := _segment_midpoint(segment)) is not None
        and start <= midpoint <= end
    ]
    if not any(pieces):
        pieces = [
            str(getattr(segment, "text", "")).strip()
            for segment in segments
            if (
                isinstance(getattr(segment, "start", None), (int, float))
                and isinstance(getattr(segment, "end", None), (int, float))
                and float(getattr(segment, "end")) >= start
                and float(getattr(segment, "start")) <= end
            )
        ]
    return " ".join(" ".join(pieces).split())[:160]


def _segment_midpoint(segment: object) -> float | None:
    start = getattr(segment, "start", None)
    end = getattr(segment, "end", None)
    if not isinstance(start, (int, float)) or not isinstance(end, (int, float)):
        return None
    return float(start) + (float(end) - float(start)) / 2


def _mark_region_diagnostics(
    diagnostics: list[dict[str, Any]],
    region: EnglishCandidateRegion,
    candidate_segments: list[object],
    *,
    decision: str,
    reason: str | None,
) -> None:
    candidate_text = " ".join(
        str(getattr(segment, "text", "")).strip() for segment in candidate_segments
    )
    candidate_text = " ".join(candidate_text.split())[:160]
    for item in diagnostics:
        if item["start"] < region.end and item["end"] > region.start:
            item["candidate_text"] = candidate_text
            item["decision"] = decision
            item["reason"] = reason

