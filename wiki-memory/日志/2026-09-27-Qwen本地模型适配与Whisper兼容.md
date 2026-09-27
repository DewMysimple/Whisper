---
title: Qwen 本地模型适配与 Whisper 兼容
type: log
status: archived
kind: feature
updated: 2026-09-27
importance: high
topic: qwen-backend-integration-2026-09-27
source_logs: []
---

# Qwen 本地模型适配与 Whisper 兼容

## 目标

按用户授权接入前述 Qwen3-ASR，保留以前的模型和使用方式，维护公共边界与可扩展能力来源。

## 已落地代码

- Qwen3-ASR 1.7B／0.6B、共享 ForcedAligner 0.6B；原生 Transformers 格式，运行离线。
- 注册表驱动文件校验、Web／Rust 模型与参数能力投影、IPC 条件限制。
- 后端工厂、PyTorch 硬件能力、公共分段偏移与对齐文字映射、缓存释放。
- 模型与参数页只显示当前后端有效控件；原模型和默认 Turbo、旧参数覆盖保留。
- CLI 增加可选 `--model`；便携构建纳入 Qwen，可选择 WhisperOnly。
- 发布组装增加独立目录和运行占用检查，避免旧版仍运行时替换正式目录。

## 验证结果

- 源码真实 CUDA：两档 Qwen 的中英文识别及对齐成功。
- 源码 Worker：Whisper → 1.7B → 0.6B → Whisper 顺序成功；1.7B 连续任务复用，
  Qwen 生成 TXT／Markdown／SRT，52 秒长静音样本的三段文字和时间偏移正确；切回后的
  cn/cn2 与原 golden 一致。
- 最终 Python 449 项、Web 157 项、完整浏览器 39 项通过；Rust 40 项通过、2 项原有
  环境测试忽略，fmt 和 Clippy 通过。发布补充与路径检查 23 项通过；仓库卫生、生成
  投影和记忆体检通过。
- 从零创建的发布环境安装成功且 `pip check` 通过；Qwen 0.6B 的 CPU FP32 CLI
  `en2` 真实英文转录成功，与中文、英文、中文防幻觉路径合计覆盖四 preset。
- 最终冻结 Worker 五组真实离线转录全部通过，复现源码的切换、缓存、三种输出、长
  静音偏移与旧 golden。未改写参考文本或原 golden。
- 实际 Release EXE 通过本地模型选择、后端硬件能力、Qwen 1.7B CUDA BF16 中文
  SRT 任务；Host 日志确认成功 1、失败 0。整卡占用约 8.0 GiB，包含其他桌面进程，
  不是模型峰值或通用显存承诺。最终正式路径再次验证受控 Worker 子进程与 IPC 就绪。
- 最终便携目录含 5,952 个文件，manifest 5,951 项；逐文件哈希、ZIP 全量 CRC、外层
  SHA256 全部通过。ZIP 13,971,479,971 字节，包含 Turbo、两档 Qwen、共享对齐模型与
  完整运行库。便携版交付到 `dist/WhisperSubtitle/` 及同名 ZIP／SHA256。

可再生证据位于 `build/qwen-validation/`：`worker-source/`、`worker-release-final/`、
`desktop-smoke.log`、`formal-ui.log`、`release-validation.json` 及各自动化检查日志。

## 发布处理

旧版占用正式目录，先用 `-OutputRoot` 独立构建。用户明确回复“你直接终止”后结束旧版，
Windows 延迟释放旧 Worker 文件锁；释放后保存原便携目录／ZIP／SHA256 为
`dist/WhisperSubtitle.previous-20260927*`，把同一套已校验新产物移回正式路径并复验。
发布预检查忽略已经退出的进程，仍阻止替换真实运行中的目录。可选 NSIS 安装器本轮
没有构建；便携版为本次实际交付物。

## 范围与保留

下载的模型、验证输出、旧版备份和发布中间态不进入版本控制。默认仍为 Turbo；其余
未安装的 Whisper 模型仅保持代码与契约兼容，不外推为完成真实权重验收。Qwen 对齐语言
及参数边界见开发说明；短夹具不构成所有真实媒体的识别质量排名。

架构结论：[[决策/ADR-006-多后端本地识别与Qwen适配]]。
