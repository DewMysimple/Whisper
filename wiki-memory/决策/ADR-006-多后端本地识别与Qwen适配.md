---
title: 多后端本地识别与 Qwen 适配
type: decision
status: active
kind: architecture
updated: 2026-09-27
importance: high
topic: multi-backend-local-asr
source_logs:
  - "[[日志/2026-09-27-Qwen本地模型适配与Whisper兼容]]"
---

# ADR-006：多后端本地识别与 Qwen 适配

用户在 Qwen3-ASR 选型后授权新模型改造，要求保持旧模型可用并重视公共模块与可维护性。
本授权包含必要的模型选择、后端能力展示和 IPC v1 模型枚举扩展；不包含应用内联网下载。

## 边界

- 保留六个 Whisper ID、默认 Turbo、四 preset 和现有输出流程；新增 Qwen3-ASR 1.7B／0.6B。
- 使用 Transformers 原生 `-hf` checkpoint，两个 ASR 共用 ForcedAligner 0.6B。
  `domain/models.py` 统一模型身份、仓库、文件、架构和依赖，生成 Web／Rust 投影。
- 工厂 `infrastructure/engines.py` 按后端选择推理和硬件探测。原 CTranslate2 路径保留，
  Torch 延迟导入，不成为普通 Whisper 安装的必要条件。
- Qwen 参数支持范围来自 `domain/backend_parameters.py`，Web／Rust／Worker／schema
  一致限制；参数覆盖仍按模型与 preset 隔离，旧覆盖不迁移到新模型。
- `system.environment` 增加可选 `model_id`，原空参数继续查询默认后端；不新增命令、
  事件或生命周期。硬件仍在提交时解析并冻结，显式不支持的精度报错。
- 分段保留原媒体偏移；ForcedAligner 提供真实字／词时间戳，公共字幕模块继续排版。
  不伪造语言概率或用平均时间分配替代失败的对齐。
- 模型缓存负责不同后端的替换和关闭；共享输入、后处理、任务调度、结果及原子输出流程。

## 发布

默认便携构建包含两个后端，`-WhisperOnly` 可生成原轻量运行库。模型打包复用本地注册表
校验，只复制已安装的 Qwen 和共享对齐模型。应用推理期间始终本地离线。
正式运行中的目录需要关闭应用后替换，可先通过 `-OutputRoot` 生成独立验收版本。

具体版本、参数语义、目录结构和验证命令见 `docs/development/qwen_asr.md`。
