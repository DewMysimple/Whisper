# 批次 2 进度

## 2026-07-13

- 已读取总计划、规划技能和 worktree 技能。
- 已确认当前为普通 checkout，因批次 0/1 未提交前置成果与用户既有偏好，继续在当前工作区原地执行。
- 已记录批次 2 范围、约束和验收目标，建立文件化计划。
- 已完成基线验证：`126 passed in 1.31s`，源码聚合哈希与六份 golden 已记录。
- 已盘点 CLI、GUI、Core 与测试中的 preset 引用，确定 typed domain registry + Core 兼容视图方案。
- 已新增 domain 类型化契约和唯一 preset registry，并将 `core/presets.py` 改为派生兼容层。
- 已迁移 CLI 与 GUI：CLI 使用 alias resolver，GUI 使用 typed preset；旧 QSettings ID 与 CLI alias 均可恢复。
- 已移除 benchmark 中的手写 alias→ID 映射；56 条契约/registry/旧兼容测试和扩展后的 81 条相关测试均通过。
- 完整 pytest 先后达到 151/153 条通过，生产与测试工具中的手写 preset 映射审计为 0。
- 已完成 24 次真实四 preset benchmark，输出/参数/策略完全一致，最大性能回退 8.2%，通过 20% 门禁。
- 已完成真实中文 cn/cn2、环境检查、两种 CLI 帮助和两种 GUI offscreen 冒烟，全部通过。
- 已恢复 benchmark 触碰的已跟踪备份，并为 runner 增加成功/失败均原样恢复副作用文件的保护测试。
- 已将本批修改的 GUI 文件机械规范化为 LF，`git diff --check` 不再出现 GUI 换行警告。
- 最终复测为 `154 passed in 1.36s`；手写重复映射计数 0，六份 golden 哈希不变。
- 已安全清理 benchmark runs、中文临时 Text 备份、pytest/Python 缓存；无残留应用进程。
- 已确认 Git 暂存文件 0、`.workbuddy` 状态变化 0；未提交、未打标签、未推送。
- 批次 2 全部阶段完成，已生成执行报告。
