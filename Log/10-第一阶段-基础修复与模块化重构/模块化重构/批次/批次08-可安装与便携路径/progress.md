# 批次 08 进度日志

## 2026-07-13

- 已读取文件规划与 Git worktree 技能说明。
- 已确认当前是普通 `master` 检出；沿用此前选择在原工作区执行，以保留批次 0–7 前置变更。
- 已读取批次 8 的目标、工作内容、禁止事项和验收标准。
- 已初步扫描固定 `PROJECT_ROOT/src`、`whisper_env`、模型目录、logo 和 launch 路径假设。
- 已确认不自动提交 Git、保持 `.workbuddy` 不变。
- 初次创建规划文件时误建带空格目录，已纠正文件路径，待清理空目录。
- Windows 将尾随空格目录规范化为正确目录，实际没有额外目录；清理保护拒绝删除非空的正确目录。
- 批次 8 全量基线通过：`230 passed in 0.62s`。
- 已读取 init/bootstrap/engine/test_env/entry/launch/pyproject 与现有路径相关测试。
- 已确认需要集中解释器、工作目录、模型、用户缓存与 package resource 解析。
- 新合同首次按预期因 `paths.py` 尚未实现而收集失败；实现后 AppPaths 6 项测试通过。
- 已迁移 bootstrap、Whisper engine、CLI `--model-dir`、GUI MainWindow/ProcessRunner/panels、环境检查和 launch.vbs。
- package logo 与原资源 SHA256 一致：`1AD04589B6072733667BFB0A1D8C6B0B4DCF45236B92373E9CFFF4666B319D15`。
- 新旧路径/GUI/CLI/引擎定向回归：`40 passed in 0.37s`。
- 正在补充真实安装态和 console script 验证。
- 首次临时 venv 验证发现 Windows venv 不继承父 venv site-packages，并暴露 CLI check 忽略返回码的问题；已改为 prefix wheel 安装并修复退出码传播。
- prefix 安装测试第一次未隔离已安装分发，导致当前 editable 包被 pip 卸载；已为测试增加 `--ignore-installed`，正在恢复本地 editable 环境。
- editable 环境已用本地无依赖安装恢复，全量回归 `240 passed in 2.19s`。
- 首次 cscript 验证返回 1；定位为 WshShell.Run 直接命令不能可靠处理 `2>`，已改用 `%COMSPEC% /d /c` 包装。
- 修正后 `cscript launch.vbs` 返回 0，GUI 成功启动并在验证后清理。
- prefix wheel 安装态的模块入口、console script、resource 和 check 全部通过。
- 24 次批次 8 基准全部成功，最大总进程耗时中位数比例 `0.884`，静态参数与黄金输出未变化。
- 批次 8 已完成；将按用户新指令继续批次 9。
