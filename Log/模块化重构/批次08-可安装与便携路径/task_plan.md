# 批次 08：消除源码树与固定虚拟环境假设

## 目标

让项目既能在当前便携目录运行，也能作为正常安装包运行，不依赖固定的 `src/` 路径、`whisper_env` 名称或单一模型目录。

## 边界

- 保留便携模式，不做依赖瘦身。
- 不修改转录算法、preset 参数和输出规则。
- 保留批次 7 的统一 CLI/QProcess 协议。
- 不自动暂存或提交 Git。
- 不修改或删除 `.workbuddy`。
- 延续批次 0–7 未提交基线，在当前工作区原地实施。

## 阶段

- [complete] 1. 固化 230 项测试基线，梳理路径、资源、模型、环境检查和 launch 假设。
- [complete] 2. 为 AppPaths、模型路径优先级、资源解析和安装态入口补充失败测试。
- [complete] 3. 建立集中 AppPaths/配置提供器与模型路径解析。
- [complete] 4. 迁移 GUI、bootstrap、引擎和静态资源到集中路径边界。
- [complete] 5. 重写运行能力环境检查并调整 launch.vbs。
- [complete] 6. 验证便携、editable 与隔离安装后的模块/console/GUI 入口。
- [complete] 7. 全量回归、性能/黄金核对、清理与执行报告。

## 验收

- 安装包运行不依赖仓库 `src/` 文件路径。
- GUI 子进程优先使用 `sys.executable`，不要求虚拟环境名为 `whisper_env`。
- 模型目录按显式参数、环境变量、便携默认值解析，缺失时错误可操作。
- 静态资源通过 package data / `importlib.resources` 解析。
- launch、`python -m whisper_subtitle`、console script 与 GUI 入口通过。

## 遇到的错误

| 错误 | 尝试次数 | 处理 |
| --- | ---: | --- |
| 初次创建批次目录时路径末段误带前导空格 | 1 | 立即用 apply_patch 删除误建文件并在正确目录创建规划文件；随后清理空目录 |
| 清理误建目录时保护检查报告目录非空 | 1 | 确认 Windows 已将尾随空格规范化为正确目录，实际没有额外目录；保留正确批次文档，不再删除 |
| 新合同首次收集找不到 `whisper_subtitle.paths` | 1 | 确认测试先行红灯后实现集中路径模块 |
| 路径测试通过后环境检查合同仍无法导入 `check_environment` | 1 | 实现基于模块能力与模型可用性的环境检查，移除源码文件检查 |
| 首次隔离 venv 安装检查看不到父 venv 依赖，且 CLI 忽略了返回式 check 的退出码 | 1 | 改用独立 prefix wheel 安装并通过 PYTHONPATH 使用当前依赖；修复 `_run_check()` 返回 `main()` 的状态码 |
| prefix 安装测试未加隔离参数，pip 卸载了当前 editable 包 | 1 | 为安装测试增加 `--ignore-installed`；用本地 `pip install -e . --no-deps --no-build-isolation` 恢复开发环境 |
| 首次 cscript 启动返回 1，环境检查子命令未启动 | 1 | WshShell.Run 的重定向需要命令解释器；用 `%COMSPEC% /d /c` 包装检查命令并保留错误文件捕获 |
