# WhisperSubtitle Agent 工作约定

本工程的长期记忆位于 `wiki-memory/`。本文件是每次任务的入口和完成门禁；详细记忆协议以 `wiki-memory/AGENTS.md` 为准。

## 启动顺序

1. 读取 `wiki-memory/AGENTS.md`。
2. 依次读取 `wiki-memory/当前状态/项目概览.md`、`系统架构.md`、`当前约束.md`、`当前待办.md`。
3. 根据任务再读取相关 active 决策、知识页和 `当前状态/已知问题.md`。
4. 不默认读取 `wiki-memory/历史归档/`；只有追溯旧需求、旧验收证据或冲突来源时才进入。

## 工作原则

- 当前工作树中的代码、配置、schema 和测试是最高优先级事实；记忆与之冲突时必须更新记忆并在日志说明。
- 动手前检查 `git status --short --branch`；范围外的用户改动必须保留，不得混入本任务提交。
- 架构维护优先处理真实责任边界、重复事实源和缺失门禁；不仅因文件行数进行碎片化拆分。
- 保持 Tauri/React → Rust Host → Desktop IPC v1 → Python Worker → application/domain/infrastructure 边界。改变 IPC、Preset、输出或 UI 行为需要单独授权和验收。
- `models/`、虚拟环境、`build/`、`target/`、发布产物和用户输出不属于源码维护范围；除非任务明确授权，不删除这些本地资料。
- 历史归档和已封存日志只读；需要更正时新增日志并建立链接。

## 验证路由

- 通用工程检查：`corepack pnpm check`、`python scripts/check_repository_hygiene.py`、`python wiki-memory/工具/memory_lint.py check`。
- Python 变更：使用已安装本项目的解释器运行 `python -m pytest -q`。若裸系统 Python 未安装工程，先选择活动虚拟环境，不把纯导入失败误判为回归。
- React/TypeScript 变更：`corepack pnpm check`；涉及交互时加 `corepack pnpm e2e`。
- Rust/Tauri 变更：在 `apps/desktop/src-tauri` 运行 `cargo fmt --check`、`cargo test --locked`和适用的 `cargo clippy --locked --all-targets -- -D warnings`。
- 模型目录修改：先改 `src/whisper_subtitle/domain/models.py`，再运行 `python scripts/generate_model_catalog.py`。Preset 修改同理运行 `python scripts/generate_preset_catalog.py`。
- 涉及桌面产物、打包或 UI 正式验收时，补充 Tauri Release 构建和 EXE 启动烟测。涉及 GPU、模型或识别输出时，补充真实媒体与必要的 benchmark/golden 验证。

## 完成门禁

1. 核对实际 diff，确认没有范围外变更、生成物或本机路径。
2. 按 `wiki-memory/AGENTS.md` 新增任务日志、更新必要的 active 页，然后生成索引并运行记忆体检。
3. 所有相关验证通过后，创建独立 Git 提交并推送到当前分支远程。
4. 未提交、未推送或推送失败时，不得宣称任务完成；禁止强推或改写历史绕过问题。
