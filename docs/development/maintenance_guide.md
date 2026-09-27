# 定期工程维护指南

本指南用于不改变产品功能契约的周期性维护。维护目标是减少事实源漂移、修复责任越界、保持工程入口可用，而不是按文件大小进行无目的拆分。

## 评估顺序

1. 确认工作树、当前分支和远程状态，保留范围外改动。
2. 读取 `AGENTS.md` 与项目记忆的四个基线状态页。
3. 检查架构依赖方向、跨语言重复常量、过大的编排职责和绕过 bridge 的原生调用。
4. 检查根目录、README 链接、依赖声明、生成目录和机器相关文件是否进入版本控制。
5. 检查当前文档与记忆是否仍描述现有源码，并清理失效的 active 结论。

## 处置分类

- 本期维护：已有重复事实源、明确责任越界、断裂入口、失效说明或缺少自动门禁，且可以在不改变产品行为的前提下修复。
- 继续保持：边界清晰、测试覆盖且拆分收益不足的协调模块；稳定的 Desktop IPC v1、Preset 和输出契约。
- 延后处理：需要产品选择、真实模型/GPU 资源、协议升级、UI 行为变化或独立迁移计划的事项。

2026-09-27 用户已授权日常清理旧发布包与可再生构建缓存，并选择只保留最新可运行目录，ZIP 按需生成。`models/`、开发虚拟环境、Node 依赖、当前正式版和用户输出仍受保护；不因体积较大自动删除。

每次实质任务完成验证和记忆同步后，从仓库根目录预览并执行收尾：

```powershell
corepack pnpm workspace:clean
corepack pnpm workspace:finish
corepack pnpm workspace:size
```

`workspace:clean` 默认只预览 `build/`、Rust `target/`、Tauri/Web 测试与构建输出及 Vite/Python 缓存；`workspace:clean:apply` 仅应用这个白名单。`workspace:finish` 额外先验证当前发布目录全部文件哈希，再删除 `dist/WhisperSubtitle.previous-YYYYMMDD` 及同名 ZIP／SHA256 和当前可再生 ZIP，并清除 ZIP 校验条目。需要预览发布清理时运行 `powershell -NoProfile -File tools/maintenance/clean_workspace.ps1 -PruneReleases`。未知目录或其他用户压缩包不自动删除。

所有删除使用共同的仓库边界、Git 跟踪、路径联接和进程检查；永久删除，不送入回收站。当前可运行目录、唯一模型、环境、依赖和源码保持。下一次开发会按需重建编译缓存，首次编译较慢。`release:build` 成功后自动移除自己的发布中间态；失败时保留诊断，排障时可用 `-KeepBuild` 保留成功构建中间态。

空间排查使用 `workspace:size`，统计文件字节并跳过符号链接／目录联接，避免重复遍历 pnpm 依赖。先区分发布副本、构建缓存、实际权重和依赖；依赖按声明及传递闭包核对，模型去重先验哈希。一次性深度清理不能变成自动卸载依赖或删除模型的规则。

## 常规门禁

从仓库根目录运行：

```powershell
python tools/codegen/generate_model_catalog.py --check
python tools/codegen/generate_preset_catalog.py --check
python tools/maintenance/check_repository_hygiene.py
corepack pnpm check
.\whisper_env\Scripts\python.exe -m pytest -q
python wiki-memory/工具/memory_lint.py index
python wiki-memory/工具/memory_lint.py check
```

Rust/Tauri 变更还需在 `apps/desktop/src-tauri` 运行格式、测试和 clippy。涉及交互时运行 Playwright；涉及桌面产物时完成 Release 构建与 EXE 烟测；涉及识别行为时增加真实媒体、golden 或 benchmark 验证。

## 完成条件

维护日志必须写清本期修复、保留项、延后项和实际验证。相关 active 页面应同步更新，自动索引应重建。所有验证通过后，创建独立提交并推送当前分支远程；提交或推送未完成时，维护任务仍未完成。
