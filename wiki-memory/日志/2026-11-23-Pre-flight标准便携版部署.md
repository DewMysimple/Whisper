---
title: Pre-flight 标准便携版部署
type: log
status: archived
kind: operations
updated: 2026-11-23
importance: high
topic: preflight-promote-standard-portable
source_logs:
  - "[[日志/2026-11-23-执行前清单操作区紧凑布局]]"
---

# Pre-flight 标准便携版部署

用户授权后续工程任务自行关闭占用便携版目录的 WhisperSubtitle 实例，必要时结束该实例的进程树。已核对运行实例的标准路径，向旧版窗口发送正常关闭请求。Host 和两个冻结 Worker 进程正常退出。

将验收后的候选移入 `dist/WhisperSubtitle/`，标准目录的 EXE 和清单 SHA-256 均与候选一致。标准入口隔离烟测覆盖 96 DPI、1600×1000 窗口，拖放框仍为 695×360 物理像素。实测从资源管理器拖入 WAV，成功检查并进入任务清单；标准预设确认可以取消。无历史监控任务时，媒体进度入口的子页与旧版一致，手动切换到监控可查看输入。IPC v1 握手通过，冻结 Worker 连续就绪 5 秒。Host 和 Worker 正常退出且没有残留测试进程。

`generate_release_manifest.py --verify` 对标准目录重新校验 6,562 项，全部通过。本轮实机验证使用仓库 WAV 夹具检查导入与确认，未启动真实识别任务。

源码提交 `b74cff7` 的远程 CI 中，Web／浏览器、Rust Host、Python 3.14 通过。Python 3.10 唯一失败为 `tests/test_quality_benchmark.py::test_runner_reads_probe_contract_and_actual_output_formats` 第 70 行。前一提交 `4ca680b` 的同一用例和断言也失败。两份日志均只记录基准返回 `failed`，未提供内部异常。[本次 CI](https://github.com/DewMysimple/Whisper/actions/runs/45113229783) · [基线任务](https://github.com/DewMysimple/Whisper/actions/runs/45026317493/job/137220013748)

`corepack pnpm workspace:clean` 和带 `-PruneReleases` 的发布预览核对后，`corepack pnpm workspace:finish` 复验标准版并清理明确识别的旧发布备份、Web／Rust 构建物及测试缓存。`corepack pnpm workspace:size` 报告 40,768,834,304 bytes（37.97 GiB）、50,855 个文件。标准便携目录和校验文件、已有 Qwen 专用包、模型、开发环境及用户的 `prompt/` 保留。
