# 批次 1：架构重构测试护栏计划

## 目标

只补充测试、固定回归数据和 benchmark 统计能力，不修改 `src/whisper_subtitle` 业务代码，不暂存或提交 Git。

## 阶段

- [complete] 0. 记录 Git、业务源码哈希、现有测试与回归数据基线
- [complete] 1. 增加 CLI preset/参数转发、退出码与错误传播契约测试
- [complete] 2. 增加文件夹批处理、混合扩展名、空目录、损坏输入和输出失败测试
- [complete] 3. 增加固定中文短音频与中英文真实回归数据保护
- [complete] 4. 将 benchmark 扩展为冷/热启动、多次测量、中位数与波动范围 schema
- [complete] 5. 运行完整 pytest、golden、CLI/环境/GUI 冒烟与真实音频回归并生成执行报告

## 约束

- 不修改 `src/whisper_subtitle` 下任何文件。
- 不覆盖既有 golden 来掩盖失败。
- 不执行 `git add`、commit、tag 或 push。
- 不覆盖 `.claude/settings.local.json` 和 `Requirement/isolate.md`，不删除 `.workbuddy`。
- 仅处理批次 1，不提前执行后续模块化重构。

## 错误记录

| 错误 | 次数 | 处理 |
|---|---:|---|
| Windows 下将 `WhisperProject*.py` 直接传给 `rg`，通配符未由 shell 展开 | 1 | 改为对目录执行 `rg` 并使用 `-g 'WhisperProject*.py'` 过滤 |
| 首次 SAPI 生成的 WAV 仅 46 字节、0 音频帧 | 1 | 补充 `SpVoice.AudioOutputStream = SpFileStream` 后重新生成并验证 WAV 帧数与时长 |
| 新中文 golden 初次哈希校验与 Windows 实际输出相差 1 字节 | 1 | 确认差异仅为 CRLF/LF；按 `.gitattributes` 将 golden 定义为规范 LF，并保留 UTF-8 文本精确断言 |
| 24 次 benchmark 的第 23 次因 Hugging Face 代理断连导致模型初始化失败 | 1 | runner 子进程强制 `HF_HUB_OFFLINE=1`/`TRANSFORMERS_OFFLINE=1`，先做离线模型冒烟，再从完整测量重新生成基线 |
| GUI 冒烟脚本使用当前 .NET 不支持的 `Process.Kill(bool)` 后等待超时 | 1 | 精确清理测试进程，改用无参 `Kill()` 与有超时 `WaitForExit(5000)`，两种入口复测通过 |
| benchmark v2 首次写盘使用 Windows CRLF，触发 JSON 应为 LF 的 Git 警告 | 1 | writer 显式指定 `newline="\n"`，并机械规范化本次 baseline 后复查 |
