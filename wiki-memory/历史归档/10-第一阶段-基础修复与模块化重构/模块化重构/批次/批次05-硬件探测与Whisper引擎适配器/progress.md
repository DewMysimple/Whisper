# 批次 05 进度记录

## 2026-07-13

- 读取分阶段执行计划中批次 5 的目标、禁止事项和验收标准。
- 读取并采用 `planning-with-files-zh` 与 `using-git-worktrees` 技能。
- 确认当前为 `master` 普通 checkout；因批次 0–4 未提交且用户此前选择原地执行，本批继续在当前目录工作。
- 确认不删除 `.workbuddy`，不暂存、不提交 Git。
- 创建批次 5 的 `task_plan.md`、`findings.md`、`progress.md`。
- 首次基线命令选中了 PATH 默认 Python，因该解释器未安装 pytest 而未进入测试收集；同时发现当前 .NET 不支持 `Convert.ToHexString`。已调整为项目 `whisper_env` 和兼容摘要实现。
- 使用 `whisper_env\\Scripts\\python.exe` 建立基线：`194 passed in 1.47s`；源码 25 个，内容聚合 SHA256 为 `301204574E422DF086DA1A98016F8C7559513FCA4129354A4006C5FADFE4E0BB`；暂存区与 `.workbuddy` 状态计数均为 0。
- 完成四套 Core 盘点，确认硬件分支、模型构造参数完全一致，转录差异仅来自 preset。
- 新增 domain `TranscriptionEngine` 协议、结构化 `HardwareInfo`/`HardwareDetector`、延迟加载的 `FasterWhisperEngine`/`ModelLocation`，以及显式 `configure_runtime()` bootstrap；新增模块均通过 `py_compile`。
- 四套 Core 已移除 `os`/`warnings`/`WhisperModel`/Torch 直接依赖，`process_video` 改为依赖 `TranscriptionEngine`，`main(engine=...)` 支持直接注入 fake engine；未注入时显式 bootstrap、探测硬件并加载适配器。
- 首次聚焦回归为 24 failed / 70 passed；失败全部是旧测试引用已移除的 `Core.WhisperModel`。已将测试注入边界迁移到 fake engine 和 `FasterWhisperEngine.load()`。
- 迁移后的 Core/后处理聚焦回归为 `94 passed`。
- 新增硬件、适配器、bootstrap/import 副作用测试；新旧相关聚焦套件为 `39 passed in 0.20s`。
- 第一轮完整测试为 `205 passed in 0.35s`，测试收集 205 条，`compileall` 通过；Core 直接运行时依赖审计为 0。
- 一次全局依赖 `rg` 因 PowerShell 双引号转义导致正则未闭合，改用单引号后成功；依赖位置仅在显式 bootstrap、infrastructure 适配器和 GUI 子进程环境配置中。
- 完成 24 次四 preset 冷/热 benchmark：24/24 成功，静态契约与输出全部等于 baseline，总耗时最大比值 `1.012`，低于 `1.20` 阈值。
- 完成固定中文音频 cn/cn2 实际 GPU 回归：文本与独立 golden 相同，规范化 SHA256 均为 `83C3A8...7ABD`，无 `.tmp`。初始 PowerShell 原始比较因 CRLF/LF 判为不同，改用 universal-newline 后确认内容无差异。
- 首次 console help 烟雾因 `Select-Object -First` 提前关闭原生管道返回 `-1`；帮助正文已生成，后续改为完整捕获输出后再检查。
- 完整捕获后 console/module help、环境 check、四套 Core help 全部成功；module 与 console GUI 离屏启动均存活 3 秒。
- 已删除本批 benchmark candidate、临时转录目录、fixture `Text` 备份与 GUI 日志；首轮缓存清理对绝对 `__pycache__` 路径重复 `Join-Path`，这些缓存未被删除，已调整路径处理准备重试。
- 修正路径处理后清理 9 个 `__pycache__`；项目缓存、benchmark runs、batch05 fixtures 均为 0。环境内 setuptools 的两个 `.tmpl` 模板被识别为依赖文件并保留。
- 最终无缓存全量测试 `205 passed in 0.40s`，`git diff --check` 通过；源码 29 个，聚合 SHA256 `A181B138...E765`。
- 最终审计：暂存区 0、`.workbuddy` 0、requirements 差异 0、跟踪基线备份差异 0、项目 `.tmp` 0、Core 直接依赖 0；已输出 `执行报告.md`。
