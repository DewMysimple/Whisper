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
| `wiki-memory/历史归档/90-原始需求/` | 用户提供的阶段需求原文 | 不改写；新增需求单独保存并更新索引 |
| `wiki-memory/` | 当前项目记忆、决策、知识和新任务日志 | 只保留精炼结论；旧阶段和执行证据放入 `历史归档/` |
| `wiki-memory/历史归档/` | 迁移前 `Log` 的完整审计资料 | 只读追溯；历史描述不代表当前实现 |
| `assets/` | 便携启动资源源文件 | 与包内资源保持来源关系 |
| `models/` | 本地大模型 | 忽略，不提交 |
| `whisper_env/` | 本地虚拟环境 | 忽略，不提交 |
| `build/`、`target/`、缓存、`__pycache__/` | 可再生产物 | 忽略；定期维护不自动删除，清理需明确授权 |
| `dist/release/` | 本地发布与验收产物 | 忽略；保留最近验收产物，清理需明确授权 |
| `requirements.txt` | pip 兼容入口 | 只委托到 `pyproject.toml`，不重复维护依赖清单 |
| `*.lnk` | 机器相关快捷方式 | 忽略且不提交；正式入口由安装/打包流程创建 |
| `.agents/`、`.claude/`、`.workbuddy/` | 本地 Agent/工具状态，不参与产品运行 | 不属于仓库产品边界；不需要时可清理，不纳入提交 |

## 命名

- 生产 Python 模块、测试和当前英文路径使用小写 snake_case。
- 历史需求、Log 和 archive 文件保留原名，避免破坏审计链。
- 新代码不以物理脚本名表达 preset；统一使用 preset ID/CLI alias。
- Python 依赖以 `pyproject.toml` 为唯一事实源；兼容安装入口不得复制版本约束。
- 模型身份以 `domain/models.py` 为唯一事实源，并通过生成脚本投影到 Web 和 Rust。

## Golden 与 benchmark

- golden 只在明确接受行为变化后更新。
- benchmark 每个 preset 至少运行冷进程和暖系统缓存各 3 次。
- 比较输出哈希、参数、总耗时、模型加载、转写、进程内存和 GPU 显存。
- 候选依赖必须在从零环境中验证，复制虚拟环境不能作为删除依赖的证据。
