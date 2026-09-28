---
type: knowledge
status: active
kind: module
importance: high
updated: 2026-09-28
topic: python-transcription-core
source_logs:
  - "[[日志/2026-09-28-公共契约与后端生命周期维护]]"
  - "[[日志/2026-09-27-Qwen本地模型适配与Whisper兼容]]"
  - "[[日志/2026-09-26-校准四预设并修复配乐旁白漏识别]]"
  - "[[日志/2026-08-23-项目记忆重建]]"
  - "[[日志/2026-08-24-架构瘦身实施]]"
  - "[[日志/2026-09-09-工程定期维护]]"
  - "[[日志/2026-09-17-优化仓库与发布目录结构]]"
supersedes: null
---

# Python 转录核心

## 职责

- `domain/execution.py` 统一后端中立 `HardwareInfo`；硬件工厂通过 `BackendHardwareDetector` 表达共同接口。Qwen 单窗识别、对齐与线程作用域分别维护；Windows 推理依赖加载前统一初始化 CUDA。Worker 空闲释放以计时器代次拒绝过期回调。

- `domain/contracts.py` 定义请求、Preset、结果和进度契约。
- `domain/models.py` 是模型身份、能力和仓库映射的唯一注册表。
- `domain/presets.py` 是四个 preset 的唯一注册表。
- `domain/postprocess/`、`detail_review.py`、`mixed_language.py`、`quality.py` 负责纯文本、片段质量和候选复核规则。
- `application/transcribe.py` 是单文件/批量转录的统一编排入口；混合语言和中文细节复核位于 `application/recognition_passes.py`。
- `infrastructure/engines.py` 选择适配器；`whisper_engine.py` 保留 faster-whisper，`qwen_engine.py` 接入原生 Transformers Qwen3-ASR 和 ForcedAligner。媒体窗口、原始偏移、片段契约与后处理／输出流程共用；见 [[决策/ADR-006-多后端本地识别与Qwen适配]]。

## 修改规则

新增模型先改 `domain/models.py`，再运行 `tools/codegen/generate_model_catalog.py` 更新 Web/Rust 投影；新增 preset 先改注册表和契约测试，再运行 `tools/codegen/generate_preset_catalog.py` 更新 Web 投影。新增后处理必须保持纯函数，不访问磁盘、Qt 或 CTranslate2。不要通过新增脚本复制转录主流程。

## 四预设旁白校准

2026-09-26 按用户授权，四预设统一 VAD threshold 0.05、静音等待 2000 ms、边缘补齐 600 ms，并关闭前文续写；模型校准与后处理仍由原事实源维护。配乐旁白漏句来自 VAD 解码前过滤，调整后本次 302 字符参考的 CER 从 12.58% 降为 2.32%，32 个遗漏字全部恢复；同音词与纯音乐幻觉仍有边界，真实验证仅覆盖 Turbo。

必须显式传递继承窗口 30 秒，避免常驻模型的 FeatureExtractor 保留前任务的自定义 chunk_length。用户覆盖继续优先，不自动清空。复验说明见 `docs/development/transcription_calibration.md` 和 [[日志/2026-09-26-校准四预设并修复配乐旁白漏识别]]。

## 入口

`src/whisper_subtitle/`、`docs/development/extension_guide.md`、`tests/test_registry.py`、`tests/test_presets.py`。
