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

`models/`、虚拟环境、`build/`、Rust `target/`、发布产物和用户输出均是受保护的本地资料。即使体积较大，周期维护也不自动删除；只有用户明确授权并确认目标后才能清理。

## 常规门禁

从仓库根目录运行：

```powershell
python scripts/generate_model_catalog.py --check
python scripts/generate_preset_catalog.py --check
python scripts/check_repository_hygiene.py
corepack pnpm check
.\whisper_env\Scripts\python.exe -m pytest -q
python wiki-memory/工具/memory_lint.py index
python wiki-memory/工具/memory_lint.py check
```

Rust/Tauri 变更还需在 `apps/desktop/src-tauri` 运行格式、测试和 clippy。涉及交互时运行 Playwright；涉及桌面产物时完成 Release 构建与 EXE 烟测；涉及识别行为时增加真实媒体、golden 或 benchmark 验证。

## 完成条件

维护日志必须写清本期修复、保留项、延后项和实际验证。相关 active 页面应同步更新，自动索引应重建。所有验证通过后，创建独立提交并推送当前分支远程；提交或推送未完成时，维护任务仍未完成。
