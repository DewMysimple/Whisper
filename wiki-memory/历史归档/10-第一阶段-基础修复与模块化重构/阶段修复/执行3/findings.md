# 执行3 实施发现

- 需求来源：`Requirement/执行3.md`。
- 本阶段明确禁止修改业务代码，只能生成测试、测量数据和报告。
- 固定音频沿用执行2的 `Log/执行2/baseline/regression_input.wav`。
- 当前为普通 Git checkout（`.git` 与 common dir 相同、master 分支）；按用户此前选择在当前工作区继续。
- 修改前 13 个业务 Python 源文件聚合 SHA256 为 `F62D9D5E4227F7554C9C812376E0B761ACF17B3A79BE0901B93220E971A8112D`。
- `whisper-subtitle check` 基线返回 0；仓库尚无 pytest 用例，基线 pytest 显示 `no tests ran` 并返回 5。
- 需求示例与实际公开契约存在命名差异：`PRESETS` 实际为列表，GUI ID 是 `cn/cn2/en_v1/en_v2`，CLI 对外别名是 `cn/cn2/en/en2`；测试应同时验证 CLI 四别名和 presets 四配置，不修改业务代码。
- 需求举例的 `name`、`repetition_penalty` 并不存在；实际必需字段为 `id/label/desc/group/script/params/postprocess`，防幻觉版与标准版差异体现在 compression/log-prob/no-speech 阈值、上下文开关和 VAD 静音阈值。
- 四个 `txt_to_md` 当前契约都是 UTF-8 内容原样复制，并不主动生成标题；单元测试将按实际业务行为验证内容与分段原样保留。
- 首轮四个 preset 均在约 4.3–4.5 秒内完成并生成非空输出；Windows WDDM 下 NVML 未提供匹配进程显存，需采用设备峰值相对启动前基线的增量作为本项目显存近似值。
- 修正测量后四 preset 峰值显存增量为 2320.13–2321.63 MiB，进程峰值内存为 2147.34–2185.02 MiB。
- 最终测量：启动到模型加载开始 1.1831–1.2417 秒，模型加载 2.2654–2.3752 秒，推理到写盘 0.4854–0.5262 秒，总进程 4.2765–4.4140 秒。
- 英文 en/en2 golden 均为 102 字节且 SHA256 为 `D6AD4418CE220D3981878CB84FB903B6E483FF2497FCBD6A9D5C65C15463DE78`；中文强制 preset 的 cn/cn2 输出均为 108 字节且 SHA256 为 `69D77F85DDD53B7F98F9A0E63F3639D6F8D194F33430278B96CBAAE798E2CD3D`。
- 新增 `test_postprocess.py`、`test_presets.py`、`test_artifacts.py`；pytest 共执行 71 条用例并全部通过。
- 测试覆盖 5 类后处理函数、11 个模块内实际实现，以及 presets 的字段、类型、CLI 别名、差异参数和生成工件完整性。
- 测试完成后业务源码聚合 SHA256 仍为 `F62D9D5E4227F7554C9C812376E0B761ACF17B3A79BE0901B93220E971A8112D`，确认未修改业务代码。
