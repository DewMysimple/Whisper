# 批次 1 进度

## 2026-07-13

- 已读取总执行计划、批次 0 记录、现有测试、preset、CLI 与 benchmark 实现。
- 已确认继续使用当前工作区，不建立 worktree。
- 已确认本批次仅改测试、回归数据、benchmark 工具和 `Log` 文档，不改业务源码、不暂存、不提交。
- 已建立批次 1 文件化计划并开始记录基线。
- Windows 下 `rg` 通配符查询失败一次，已改用目录加 `-g` 过滤的方案。
- 已记录 71 条测试基线与 13 个业务文件聚合哈希，并确认四个 Core 的输入校验、批处理和异常传播边界。
- 已新增 42 条 CLI/Core 契约测试，覆盖四 preset 转发、参数快照、退出码、`sys.argv` 恢复、混合扩展名递归批处理、空目录、不支持格式、损坏输入、模型缺失和输出权限异常；子集测试全部通过。
- 已创建固定音频夹具说明；首次 SAPI 输出因未绑定 `AudioOutputStream` 得到 0 帧 WAV，已记录并准备按修正方案重生成。
- 已成功生成并验证固定中文 WAV，cn/cn2 真实 GPU 回归均得到预期中文句子；新增两份独立中文 golden 与元数据，原四份 golden 哈希保持不变。
- 新中文 golden 首次哈希测试发现 Windows CRLF 与仓库 LF 的单字节差异；已将新 golden 明确定义为规范 LF 并更新相应元数据。
- 已扩展 benchmark runner 和 schema 测试：冷/热阶段各至少 3 次，统计中位数和波动范围，且 runner 不再自动覆盖 golden；46 条相关测试通过。
- 首轮真实 24 次 benchmark 在第 23 次遇到 Hugging Face 代理断连；已确认非 GPU/输出回归，新增离线模型解析环境，准备先做 cn2 冒烟再重跑完整基线。
- cn2 离线模型冒烟通过，输出与 golden 完全一致。
- 第二轮 24 次 benchmark 全部成功并写出 v2 baseline；冷/热各 3 样本，四 golden 哈希不变，25 条 benchmark/产物测试通过。
- 完整 pytest 为 126 passed；环境检查、console/module CLI 帮助均通过。
- GUI 冒烟首次因 `Kill(bool)` API 不兼容导致回收超时，已精确清理残留并改用无参 `Kill()`；module 与 console GUI 离屏启动均通过且无残留进程。
- 最终差异检查发现 baseline JSON 为 CRLF；已调整 runner 显式写 LF，准备规范化本次文件并复核。
- 已将 v2 baseline 规范化为 LF，CRLF 数为 0；`git diff --check` 与换行警告复核通过。
- 已确认业务源码无差异、聚合哈希不变，暂存文件为 0，`.workbuddy` 无状态变化，无残留 GUI/CLI 进程。
- 批次 1 全部阶段完成，开始生成最终执行报告。
- 最终复测为 `126 passed in 1.37s`；再次清理 pytest/Python 缓存并通过 `git diff --check`。
