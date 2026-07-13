# -*- coding: utf-8 -*-
"""
转录模式参数配置中心（单一数据源）
================================
脚本侧与 GUI 共享此文件，避免参数两套维护导致漂移。

- 脚本：`from presets import get_preset` 后 `model.transcribe(path, **preset["params"])`
- GUI  ：`from presets import PRESETS, get_display_value, DISPLAY_KEYS` 遍历渲染

本文件只含纯数据与取值函数，不 import 任何重依赖，
GUI 进程 import 零成本。
"""

# ============================================================
# 公共 initial_prompt（同语言共用）
# ============================================================
CN_PROMPT = (
    "请准确转录以下中文音频。"
    "使用正确的中文标点符号。"
    "确保每个句子完整，并以句号、感叹号或问号结尾。"
    "保持原文的语气和表达方式。"
)

EN_PROMPT = (
    "Please transcribe the following English audio accurately. "
    "Use proper punctuation, capitalization, and grammar. "
    "Ensure each sentence is complete and ends with a period, exclamation mark, or question mark."
)


# ============================================================
# 四种转录模式
# ============================================================
PRESETS = [
    {
        "id": "cn",
        "label": "中文转录",
        "desc": "中文语音转录，输出到 Text 文件夹",
        "group": "中文",
        "script": "WhisperProjectCN.py",
        "params": {
            "language": "zh",
            "task": "transcribe",
            "beam_size": 5,
            "best_of": 5,
            "patience": 1.5,
            "length_penalty": 1.0,
            "temperature": 0.0,
            "compression_ratio_threshold": 2.4,
            "log_prob_threshold": -1.0,
            "no_speech_threshold": 0.6,
            "condition_on_previous_text": True,
            "initial_prompt": CN_PROMPT,
            "word_timestamps": False,
            "vad_filter": True,
            "vad_parameters": {
                "min_silence_duration_ms": 300,
                "max_speech_duration_s": 999999,
            },
        },
        "postprocess": "无",
    },
    {
        "id": "cn2",
        "label": "中文防幻觉",
        "desc": "中文防幻觉版，关闭上下文 + 收紧阈值，清理尾部与句内重复幻觉，输出到 Text 文件夹",
        "group": "中文",
        "script": "WhisperProjectCN2.py",
        "params": {
            "language": "zh",
            "task": "transcribe",
            "beam_size": 5,
            "best_of": 5,
            "patience": 1.5,
            "length_penalty": 1.0,
            "temperature": 0.0,
            "compression_ratio_threshold": 2.0,
            "log_prob_threshold": -1.5,
            "no_speech_threshold": 0.8,
            "condition_on_previous_text": False,
            "initial_prompt": CN_PROMPT,
            "word_timestamps": False,
            "vad_filter": True,
            "vad_parameters": {
                "min_silence_duration_ms": 500,
                "max_speech_duration_s": 999999,
            },
        },
        "postprocess": "中文标点 + clean_inner_repetition + clean_repetition",
    },
    {
        "id": "en_v1",
        "label": "英文标准版",
        "desc": "英文标准版，输出到 Text 文件夹",
        "group": "英文",
        "script": "WhisperProject.py",
        "params": {
            "language": "en",
            "task": "transcribe",
            "beam_size": 5,
            "best_of": 5,
            "patience": 1.5,
            "length_penalty": 1.0,
            "temperature": 0.0,
            "compression_ratio_threshold": 2.4,
            "log_prob_threshold": -1.0,
            "no_speech_threshold": 0.6,
            "condition_on_previous_text": True,
            "initial_prompt": EN_PROMPT,
            "word_timestamps": False,
            "vad_filter": True,
            "vad_parameters": {
                "min_silence_duration_ms": 300,
                "max_speech_duration_s": 999999,
            },
        },
        "postprocess": "无",
    },
    {
        "id": "en_v2",
        "label": "英文防幻觉",
        "desc": "英文防幻觉版，自动清理视频结尾的重复幻觉，输出到 Text 文件夹",
        "group": "英文",
        "script": "WhisperProject2.py",
        "params": {
            "language": "en",
            "task": "transcribe",
            "beam_size": 5,
            "best_of": 5,
            "patience": 1.5,
            "length_penalty": 1.0,
            "temperature": 0.0,
            "compression_ratio_threshold": 2.0,
            "log_prob_threshold": -1.5,
            "no_speech_threshold": 0.8,
            "condition_on_previous_text": False,
            "initial_prompt": EN_PROMPT,
            "word_timestamps": False,
            "vad_filter": True,
            "vad_parameters": {
                "min_silence_duration_ms": 500,
                "max_speech_duration_s": 999999,
            },
        },
        "postprocess": "clean_repetition()",
    },
]


# ============================================================
# 参数表展示顺序（GUI 参数页用），含派生项
#  - "min_silence_duration_ms"：从 params.vad_parameters 派生
#  - "后处理"：从 postprocess 字段派生
#  - initial_prompt 不展示（长字符串）
# ============================================================
DISPLAY_KEYS = [
    "language", "task", "beam_size", "best_of", "patience",
    "length_penalty", "temperature", "compression_ratio_threshold",
    "log_prob_threshold", "no_speech_threshold",
    "condition_on_previous_text", "word_timestamps",
    "vad_filter", "min_silence_duration_ms", "后处理",
]


def get_preset(preset_id):
    """按 id 取 preset，找不到抛 KeyError"""
    for p in PRESETS:
        if p["id"] == preset_id:
            return p
    raise KeyError(f"未知 preset id: {preset_id}")


def get_display_value(preset, key):
    """取参数表展示值（字符串），处理派生项与嵌套 vad_parameters"""
    if key == "后处理":
        return preset["postprocess"]
    if key == "min_silence_duration_ms":
        return str(preset["params"]["vad_parameters"]["min_silence_duration_ms"])
    val = preset["params"].get(key)
    return str(val) if val is not None else "-"
