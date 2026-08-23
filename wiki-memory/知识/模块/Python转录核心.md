---
type: knowledge
status: active
kind: module
importance: high
updated: 2026-08-24
topic: python-transcription-core
source_logs:
  - "[[日志/2026-08-23-项目记忆重建]]"
  - "[[日志/2026-08-24-架构瘦身实施]]"
supersedes: null
---

# Python 转录核心

## 职责

- `domain/contracts.py` 定义请求、Preset、结果和进度契约。
- `domain/presets.py` 是四个 preset 的唯一注册表。
- `domain/postprocess/`、`detail_review.py`、`mixed_language.py`、`quality.py` 负责纯文本、片段质量和候选复核规则。
- `application/transcribe.py` 是单文件/批量转录的统一编排入口；混合语言和中文细节复核位于 `application/recognition_passes.py`。
- `infrastructure/whisper_engine.py` 适配 faster-whisper，其他 infrastructure 模块负责 CUDA、硬件、媒体、性能和输出。

## 修改规则

新增 preset 先改注册表和契约测试，再运行 `scripts/generate_preset_catalog.py` 更新 Web 投影；新增后处理必须保持纯函数，不访问磁盘、Qt 或 CTranslate2。不要通过新增脚本复制转录主流程。

## 入口

`src/whisper_subtitle/`、`docs/development/extension_guide.md`、`tests/test_registry.py`、`tests/test_presets.py`。
