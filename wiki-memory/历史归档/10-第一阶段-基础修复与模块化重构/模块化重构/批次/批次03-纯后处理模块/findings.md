# 批次 3 发现

- 批次 3 只迁移纯后处理逻辑，不触碰 GPU、模型、文件发现或写盘。
- 批次开始时业务源码为 16 个 Python 文件，聚合 SHA256 为 `4F486387B42CE3C022F271B0C350C604157546387EF0E04B2E691D2AC8D0E7DC`；154 条测试全部通过。
- typed preset registry 原先只有展示性质的后处理值；本批将其改为四个可执行策略 ID：`english_standard`、`english_anti_hallucination`、`chinese_standard`、`chinese_anti_hallucination`。
- 四个旧 Core 必须继续导出原函数名，现有外部调用和测试不应感知实现位置变化。
- 当前为普通 `master` checkout；批次 0–2 未提交成果是本批前置，因此继续原地执行。
- 旧中文标点实现的 `"'": '''` 两行被 Python 解析为一个多行字符串，导致含单引号输入产生异常源码片段文本；批次 3 为保证逐字节兼容将精确保留，不能在重构中顺手修复。
- `domain/postprocess/` 最终按英文、中文、片段合并、重复清理和策略编排拆分；这些模块不导入模型、GUI 或文件写入代码。
- 四个 Core 的旧后处理函数均已成为单一 `return` 的薄包装器；AST 审计和特征搜索确认 Core 内无复制算法实现。
- 四个 `process_video()` 均从 typed preset 读取策略 ID，再由统一 `apply_strategy()` 执行；输出目录、备份和桌面写盘分支没有改变。
- 完整测试从 154 增至 178；六份 golden 哈希保持不变，固定中文音频的 cn/cn2 输出仍为 `今天天气很好，我们一起测试中文语音转录。`。
- 24 次真实基准全部通过；八组冷/热总耗时中位数相对基线为 1.003–1.072，低于 1.20 门禁。
