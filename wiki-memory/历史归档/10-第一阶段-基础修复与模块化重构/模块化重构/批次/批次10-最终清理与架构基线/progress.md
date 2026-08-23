# 批次 10 进度日志

## 2026-07-13

- 读取批次 10 总计划、文件化计划技能和 worktree 隔离规范。
- 确认当前不是隔离 worktree；因批次 0–9 前置成果未提交且禁止自动提交，决定原地继续。
- 确认本批次不会修改 `.workbuddy`，不会自动执行任何 Git 发布操作。
- 开始仓库结构、兼容入口、引用和命名审计。
- 批次 10 起点全量测试通过：`246 passed`。
- 完成引用审计：launch/GUI/CLI 已不调用四个 Core 脚本；剩余引用来自兼容测试、旧元数据和历史文档。
- 确认五个大写 Python 文件全部属于公开兼容入口，形成待用户确认的删除建议。
- 确认现有 `docs/architecture` 和 `docs/scripts` 是重构前快照，需要归档标记并新增当前文档。
- 将环境检查实现迁至 `infrastructure.environment_check`，CLI/GUI 改用 canonical 路径；旧 `utils.test_env` 保留弃用转发。
- CLI GUI 子命令改为直接启动 `presentation.gui.main_window`，主流程不再依赖旧大写 GUI 模块。
- 定向回归 `29 passed`，`whisper-subtitle check` 通过。
- 将旧 `docs/architecture` 和 `docs/scripts` 分别归档到 `docs/archive/pre_refactor_architecture` 与 `docs/archive/legacy_scripts`。
- 输出 `兼容入口审计.md`；等待用户确认删除五个大写公开入口及其专属元数据。
- 用户确认删除并要求使用回收站；已将 `core/`、旧 `gui/` 和旧 Core 路径测试发送到 Windows 回收站。
- 删除 Preset 的 `module/script`、CLI `PRESET_MODULES`、legacy 字典及 console 旧脚本适配器；benchmark 改记录 canonical entrypoint。
- 将兼容测试迁移到 domain/application/CLI canonical 契约，删除对四个薄壳的重复参数化。
- 新增根 README、当前架构、扩展指南、仓库策略、迁移映射和 archive 说明。
- 新增 `tests/test_architecture.py` 作为 snake_case、旧目录和关键依赖方向门禁。
- 清理后首次全量 canonical 回归为 `172 passed`；新增架构测试后当前收集 176 项。
- 全量 canonical 回归 `176 passed`，环境自检和 CLI help 通过。
- 真实中文 cn/cn2 与 golden 规范化文本一致；最终四 preset benchmark 24/24 通过。
- 首次发布 wheel 检查发现 `build/lib` 残留导致旧 core/gui 被重新打包；该 wheel 判定不合格，准备干净重建。
- 旧 build、首次 wheel 和首次安装环境均已发送到回收站。
- 干净 wheel 151,272 字节、43 个成员、无旧 core/gui，SHA256 为 `FCE7796D...E524C`。
- 从零完整安装耗时 23.16 秒，1.305 GiB；`pip check`、环境检查、包资源、真实 CUDA 中文转写和 GUI 全部通过。
- `launch.vbs` 便携 GUI 冒烟通过，新增进程已在验证后终止。
- 输出 `最终差异与性能报告.md` 和 `执行报告.md`。
- 验收临时安装、wheel、build、benchmark runs 和转写输出均已发送到回收站。
- 清理后最终回归：`176 passed in 2.01s`，环境自检、旧导入扫描和 `git diff --check` 通过。
- 最终 staged 文件数为 0，`.workbuddy` 变更数为 0；批次 10 完成。
