# WhisperSubtitle Agent 入口

项目长期记忆位于 `wiki-memory/`。

每次工作开始时按以下顺序读取：

1. `wiki-memory/AGENTS.md`
2. `wiki-memory/当前状态/项目概览.md`
3. `wiki-memory/当前状态/系统架构.md`
4. `wiki-memory/当前状态/当前约束.md`
5. `wiki-memory/当前状态/当前待办.md`
6. 与任务相关的 active 决策和知识页

不要默认读取 `wiki-memory/历史归档/`；只有需要追溯历史、验证旧结论或查找原始需求时才读取。完成实质任务后，按 `wiki-memory/AGENTS.md` 执行记忆同步。

硬性提交约定：每完成一次仓库修改任务，验证通过后必须创建 Git 提交并推送到当前分支的远程；未完成提交和推送，不得宣称任务完成。推送失败时必须如实报告，不得强推或改写历史。

本文件只提供入口，不复制完整记忆维护协议。
