# 批次 06 发现记录

## 初始上下文

- 批次 0–5 的改动尚未提交，批次 6 必须基于当前工作区原地继续。
- 当前是普通 `master` checkout；因为未提交的前置批次无法安全迁移，沿用此前原地执行决定。
- 批次 5 完成时完整测试为 205 项通过，性能最大比率为 1.012。
- `.workbuddy` 当前无 Git 状态变化；暂存区为空。

## 待确认

- 四个 Core 的流程完全同构，真实差异仅为 preset、帮助文本和少量兼容后处理函数。
- `process_video` 的行为差异可由 preset 的语言与后处理策略推导；防幻觉 preset 额外显示删除句数和输出句数。
- 当前 CLI 通过 preset registry 动态导入旧 Core，再用临时 `sys.argv` 调用 `main()`；可继续保留该公开路径。
- `TranscriptionRequest / TranscriptionResult / ProgressEvent / BatchResult` 足以承载统一用例，仅需给 `BatchResult` 增加不破坏兼容性的结构化 outcome。
- 模型加载失败和显式输出目录创建失败历史上向调用者传播；媒体发现失败和单文件转录失败则转换为退出码 1。
- 历史退出码规则是：全部成功为 0，部分或全部失败为 1；批次 6 保持该规则，用结构化 outcome 区分部分失败与全部失败。

## 设计决定

- `application/transcribe.py` 提供 `TranscriptionService.run(request, engine=...)` 和单文件兼容方法，应用层只发布 `ProgressEvent`，不打印。
- `presentation/console.py` 负责旧 CLI 参数解析、编码设置和事件打印。
- 默认运行时配置、硬件探测与引擎加载通过构造器依赖注入，测试可完全绕过 Torch/faster-whisper。
- 四个 Core 仅保留历史函数名包装器、preset 常量和一行式 `main()` 转发。

## 验证发现

- 完整测试从批次 5 的 205 项增长到 217 项，全部通过。
- 四个 Core 当前分别为 79、84、74、84 行；AST 审计不再引用媒体发现、硬件探测、Whisper 引擎、输出存储或后处理编排符号。
- 真实 benchmark 的四 preset 静态字段与基线完全相等；总进程耗时最大中位数比率为 1.023。
- 固定中文音频的 `cn/cn2` 输出都与独立 golden 逻辑一致，规范化 SHA256 为 `83C3A8CAB6BDEB88CE0FF0B6C79C3BB73ADD9190E16388D17ECC05A0F4EF7ABD`。
- CLI、模块入口、四个 Core 帮助和环境自检均返回 0；模块/console GUI 离屏启动 3 秒均保持运行。
