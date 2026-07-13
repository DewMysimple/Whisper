# 批次 10 发现记录

## 起点

- 当前为普通 `master` checkout，`.git` 与 common dir 相同，不是 submodule。
- 批次 0–9 的改动尚未提交；为保留完整前置状态，本批次原地继续，不创建空白 worktree。
- 总计划要求任何公开兼容入口删除前取得用户确认。

## 引用审计

- launch、GUI 和 CLI 已统一使用 `whisper-subtitle transcribe --preset ...`，运行时不再调用四个 `WhisperProject*.py`。
- 四个 Core 模块仍被兼容测试导入，并保留旧函数、旧脚本执行和旧后处理 API；它们都是薄壳，没有独立推理流程。
- `domain.presets.Preset.module`、`cli.PRESET_MODULES`、`core.presets` 及 golden/benchmark 的 `script` 字段仍保存旧模块元数据，但不参与实际转录调度。
- `gui/WhisperPyQtGUI.py` 是 GUI 历史模块路径的薄壳；CLI 仍从该薄壳导入 `main`，可先迁移为直接导入 `presentation.gui.main_window`。
- `utils/test_env.py` 仍是环境检查实现，不是单纯薄壳；文件名已经符合 snake_case。可把实现迁至 infrastructure，再保留旧路径转发。
- `docs/architecture` 和 `docs/scripts` 描述的是重构前单体原型，当前内容已经过时；应明确归档属性并新增当前架构文档，不能继续作为现状说明。

## 命名审计

- 生产 Python 文件中只有四个 `WhisperProject*.py` 和 `gui/WhisperPyQtGUI.py` 不符合小写 snake_case；五者均为公开兼容入口。
- 当前 canonical application/domain/infrastructure/presentation 文件均符合 snake_case。
- 历史中文文档、Requirement 输入和 Log 批次记录的文件名不应机械改名，否则会破坏审计链和既有引用。

## 公开兼容入口建议

- 建议删除：四个 `core/WhisperProject*.py` 和 `gui/WhisperPyQtGUI.py`。
- 建议同步删除：仅为上述入口服务的 `core.presets` 兼容字典、`cli.PRESET_MODULES` 和 Preset 的物理 `module/script` 元数据。
- 建议保留：`utils.test_env` 作为旧环境检查导入路径的弃用转发层；它已符合命名规范且维护成本很低。
- 删除前必须取得用户明确确认；确认前只迁移内部调用、补文档和准备测试，不删除这些公开路径。

## 依赖方向实态

- domain 只依赖标准库和 domain 子模块，是纯内核。
- infrastructure 依赖 domain/paths，封装文件系统、硬件和 CTranslate2。
- application 依赖 domain，并为默认运行组合 infrastructure；测试可通过端口注入替换。
- presentation 依赖 application/domain/paths，不包含模型推理实现。
- cli/launch 是 composition/entry 层；历史 core/gui 是兼容层。

## 用户确认与清理结果

- 用户明确同意删除，但要求移动到 Windows 回收站。
- `src/whisper_subtitle/core/`、`src/whisper_subtitle/gui/` 和 `tests/test_core_cli_paths.py` 已发送到回收站，未永久删除。
- `Preset` 已删除 `module/script` 物理脚本元数据，新增 `transcription_options()` 返回独立可变参数副本。
- CLI 删除 `PRESET_MODULES`；benchmark schema 3 改记录统一 `entrypoint`。
- presentation console 删除只为 Core 薄壳服务的旧 argparse/process_video 适配器。
- 兼容重复测试删除后，canonical 全量测试从 246 项收敛到 176 项；减少项主要是同一行为对四个旧模块的重复参数化。

## 文档与仓库策略

- 旧单体资料移动到 `docs/archive/`，当前文档改为 architecture/development/migration/policy 四类。
- `Requirement/` 保存用户需求原文，`Log/` 保存计划与证据，均保留原名以维护审计链。
- tests fixtures、golden、benchmark baseline 分别承担固定输入、语义输出和历史性能参考；runs 为可清理临时产物。
- 新增架构门禁，检查生产 Python 文件 snake_case、旧 core/gui 缺失、domain 无向外依赖、presentation 无旧脚本调度。
