"""Offline native Transformers Qwen3 ASR and shared forced alignment adapter."""

from __future__ import annotations

import gc
import importlib
from collections.abc import Callable, Iterator, Mapping
from contextlib import contextmanager
from itertools import chain
from typing import Any

from ..domain.alignment import aligned_words
from ..domain.backend_parameters import QWEN_ALIGNMENT_LANGUAGES, QWEN_LANGUAGES, qwen_defaults
from ..domain.models import MODELS_BY_ID
from ..domain.transcription import TranscribedSegment, TranscribedWord, TranscriptionInfo, TranscriptionCancelled
from ..paths import ModelLocation
from .audio_chunks import SAMPLE_RATE, decode_media, speech_windows
from ..domain.execution import HardwareInfo
from .torch_hardware import load_torch


class QwenASREngine:
    def __init__(self, model, processor, *, hardware: HardwareInfo,
                 location: ModelLocation, model_name: str, torch, transformers) -> None:
        self._model, self._processor = model, processor
        self.hardware, self.location, self.model_name = hardware, location, model_name
        self._torch, self._transformers = torch, transformers
        self._aligner = self._aligner_processor = None

    @classmethod
    def load(cls, hardware: HardwareInfo, location: ModelLocation, *, model_name: str):
        path = str(location.require_bundle(model_name))
        torch = load_torch()
        try:
            transformers = importlib.import_module("transformers")
            model_class = transformers.Qwen3ASRForConditionalGeneration
            processor_class = transformers.Qwen3ASRProcessor
        except (ImportError, AttributeError) as exc:
            raise RuntimeError("请安装 whisper_subtitle[qwen]，需要配套的 Transformers 5.17.0。") from exc
        if hardware.compute_type not in {"float16", "bfloat16", "float32"}:
            raise ValueError(f"Qwen 不支持计算精度 {hardware.compute_type}")
        processor = processor_class.from_pretrained(path, local_files_only=True)
        model = model_class.from_pretrained(
            path, local_files_only=True, dtype=getattr(torch, hardware.compute_type),
            attn_implementation="sdpa",
        ).to(f"cuda:{hardware.device_index}" if hardware.device == "cuda" else "cpu").eval()
        return cls(model, processor, hardware=hardware, location=location,
                   model_name=model_name, torch=torch, transformers=transformers)

    def _load_aligner(self):
        if self._aligner is None:
            path = str(self.location.require_model(MODELS_BY_ID[self.model_name].companion_id))
            self._aligner_processor = self._transformers.Qwen3ASRProcessor.from_pretrained(path, local_files_only=True)
            self._aligner = self._transformers.Qwen3ASRForTokenClassification.from_pretrained(
                path, local_files_only=True, dtype=self._model.dtype, attn_implementation="sdpa",
            ).to(self._model.device).eval()

    def transcribe(self, media_path: str, **options: Any):
        return self.transcribe_cancellable(media_path, cancelled=None, **options)

    def transcribe_cancellable(self, media_path: str, *, cancelled: Callable[[], bool] | None, **options: Any):
        self._check_cancelled(cancelled)
        params = qwen_defaults()
        unknown = set(options) - params.keys()
        if unknown:
            raise ValueError(f"Qwen 不支持推理选项: {', '.join(sorted(unknown))}")
        params.update(options)
        if params["max_new_tokens"] is None:
            params["max_new_tokens"] = qwen_defaults()["max_new_tokens"]
        language = params["language"]
        if language is not None and language not in QWEN_LANGUAGES:
            raise ValueError(f"Qwen 不支持语言: {language}")
        if params["word_timestamps"] and language is not None and language not in QWEN_ALIGNMENT_LANGUAGES:
            raise ValueError(f"Qwen 对齐模型不支持 {language}，请仅输出 TXT/Markdown")
        audio = decode_media(media_path)
        self._check_cancelled(cancelled)
        info = TranscriptionInfo(len(audio) / SAMPLE_RATE, language)
        iterator = self._segments(audio, params, info, cancelled=cancelled)
        first = next(iterator, None)
        return (chain((first,), iterator) if first is not None else iter(())), info

    @staticmethod
    def _check_cancelled(cancelled: Callable[[], bool] | None) -> None:
        if cancelled is not None and cancelled():
            raise TranscriptionCancelled("Qwen task was cancelled; incomplete window discarded")

    @contextmanager
    def _inference_threads(self) -> Iterator[None]:
        """Restore process-wide Torch settings before yielding a segment."""
        previous = self._torch.get_num_threads()
        try:
            if self.hardware.cpu_threads > 0:
                self._torch.set_num_threads(self.hardware.cpu_threads)
            yield
        finally:
            if self._torch.get_num_threads() != previous:
                self._torch.set_num_threads(previous)

    def _recognize_chunk(
        self, chunk: Any, params: Mapping[str, Any], prompt: str | None,
        *, cancelled: Callable[[], bool] | None = None,
    ) -> tuple[str, str | None, str | None]:
        self._check_cancelled(cancelled)
        inputs = self._processor.apply_transcription_request(
            audio=chunk,
            language=QWEN_LANGUAGES.get(params["language"]),
            prompt=prompt,
        ).to(self._model.device, self._model.dtype)
        self._check_cancelled(cancelled)
        generation_options = {}
        if cancelled is not None:
            torch = self._torch
            class CancelRequested(self._transformers.StoppingCriteria):
                def __call__(self, input_ids, scores, **kwargs):
                    return torch.full((input_ids.shape[0],), cancelled(), dtype=torch.bool, device=input_ids.device)
            generation_options["stopping_criteria"] = self._transformers.StoppingCriteriaList([CancelRequested()])
        with self._torch.inference_mode():
            ids = self._model.generate(
                **inputs, max_new_tokens=params["max_new_tokens"], do_sample=False,
                **generation_options,
            )
        self._check_cancelled(cancelled)
        generated = ids[:, inputs["input_ids"].shape[1]:]
        # A full token budget without EOS means the transcript is incomplete.
        eos = self._model.generation_config.eos_token_id
        eos = [eos] if isinstance(eos, int) else eos
        if (
            generated.shape[1] >= params["max_new_tokens"]
            and int(generated[0, -1]) not in (eos or [])
        ):
            raise ValueError("Qwen 转录达到 token 上限，请缩短音频窗口或提高最大 token 数")
        parsed = self._processor.decode(generated, return_format="parsed")[0]
        text = parsed["transcription"].strip()
        detected = parsed.get("language") or params["language"]
        code = next(
            (code for code, name in QWEN_LANGUAGES.items() if detected in (code, name)),
            None,
        )
        return text, detected, code

    def _align_chunk(
        self, chunk: Any, text: str, *, offset: float, duration: float,
    ) -> tuple[TranscribedWord, ...]:
        self._load_aligner()
        # The generic CJK/word splitter avoids optional native tokenizers.
        alignment, tokens = self._aligner_processor.prepare_forced_aligner_inputs(
            audio=chunk, transcript=text, language=None,
        )
        alignment = alignment.to(self._aligner.device, self._aligner.dtype)
        with self._torch.inference_mode():
            output = self._aligner(**alignment)
        stamps = self._aligner_processor.decode_forced_alignment(
            logits=output.logits,
            input_ids=alignment["input_ids"],
            word_lists=tokens,
            timestamp_token_id=self._aligner.config.timestamp_token_id,
        )[0]
        return aligned_words(text, stamps, offset=offset, duration=duration)

    def _segments(
        self, audio: Any, params: Mapping[str, Any], info: TranscriptionInfo,
        *, cancelled: Callable[[], bool] | None = None,
    ) -> Iterator[TranscribedSegment]:
        self._check_cancelled(cancelled)
        windows = speech_windows(
            audio, chunk_length=params["chunk_length"],
            vad_filter=params["vad_filter"], vad_parameters=params["vad_parameters"],
        )
        prompt = "\n".join(
            str(params[key]) for key in ("initial_prompt", "hotwords") if params.get(key)
        ) or None
        for start, end in windows:
            self._check_cancelled(cancelled)
            with self._inference_threads():
                chunk = audio[start:end]
                text, detected, code = self._recognize_chunk(chunk, params, prompt, **({"cancelled": cancelled} if cancelled is not None else {}))
                self._check_cancelled(cancelled)
                if info.language is None:
                    info.language = code
                words = None
                if text and params["word_timestamps"]:
                    if code not in QWEN_ALIGNMENT_LANGUAGES:
                        raise ValueError(f"Qwen 对齐模型不支持检测到的语言 {detected}，请仅输出 TXT/Markdown")
                    words = self._align_chunk(
                        chunk, text, offset=start / SAMPLE_RATE,
                        duration=(end - start) / SAMPLE_RATE,
                    )
                    self._check_cancelled(cancelled)
            yield TranscribedSegment(start / SAMPLE_RATE, end / SAMPLE_RATE, text, words)

    def close(self) -> None:
        self._model = self._processor = self._aligner = self._aligner_processor = None
        gc.collect()
        if self.hardware.device == "cuda":
            with self._torch.cuda.device(self.hardware.device_index):
                self._torch.cuda.empty_cache()
