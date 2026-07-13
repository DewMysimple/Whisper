# 仓库资料与产物策略

| 位置 | 职责 | 保留策略 |
| --- | --- | --- |
| `src/` | 可安装生产代码与包资源 | 文件名小写 snake_case；禁止生成输出 |
| `tests/fixtures/` | 小型固定输入 | 可版本化；替换时更新来源和元数据 |
| `tests/golden/` | 语义输出与参数快照 | 行为变更必须显式评审，不能静默重写 |
| `tests/benchmark/baseline.json` | 重构前性能/输出参考 | 保留为历史比较基准 |
| `tests/benchmark/runs/` | benchmark 临时输出 | 忽略，不纳入版本控制 |
| `docs/` | 当前架构、开发和迁移文档 | 当前文档使用英文 snake_case 路径 |
| `docs/archive/` | 重构前资料 | 只读追溯，不代表当前实现 |
| `Requirement/` | 用户提供的阶段需求原文 | 不重命名、不改写；新增需求单独保存 |
| `Log/` | 分析、计划、证据和执行报告 | 按阶段保留；性能原始 JSON 可随报告保存 |
| `assets/` | 便携启动资源源文件 | 与包内资源保持来源关系 |
| `models/` | 本地大模型 | 忽略，不提交 |
| `whisper_env/` | 本地虚拟环境 | 忽略，不提交 |
| `build/`、缓存、`__pycache__/` | 可再生产物 | 忽略，可安全清理 |
| `.workbuddy/` | 用户工作区数据 | 不修改、不删除 |

## 命名

- 生产 Python 模块、测试和当前英文路径使用小写 snake_case。
- 历史 Requirement、Log 和 archive 文件保留原名，避免破坏审计链。
- 新代码不以物理脚本名表达 preset；统一使用 preset ID/CLI alias。

## Golden 与 benchmark

- golden 只在明确接受行为变化后更新。
- benchmark 每个 preset 至少运行冷进程和暖系统缓存各 3 次。
- 比较输出哈希、参数、总耗时、模型加载、转写、进程内存和 GPU 显存。
- 候选依赖必须在从零环境中验证，复制虚拟环境不能作为删除依赖的证据。
