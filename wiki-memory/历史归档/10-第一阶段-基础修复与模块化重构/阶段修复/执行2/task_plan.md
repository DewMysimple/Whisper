# 执行2 修改计划

## 目标

按照 `Requirement/执行2.md` 完成 Python 包迁移、统一 CLI、结构化日志、GUI 文件选择与设置持久化、依赖清理和真实音频前后回归。

## 阶段

- [complete] 0. 恢复 `.workbuddy`，建立代码/磁盘/音频转录基线
- [complete] 1. 建立 `src/whisper_subtitle` 包结构并迁移源码
- [complete] 2. 增加单 CLI、模块入口和结构化日志
- [complete] 3. GUI 改用 QFileDialog 并加入 QSettings
- [complete] 4. 重写依赖、重建虚拟环境并执行真实音频回归
- [complete] 5. 综合测试、差异审查和文档收尾

## 约束与决策

- 用户已明确继续在当前工作区直接修改，不创建 worktree。
- `.workbuddy` 必须恢复并保留。
- 保留执行1的业务修复，不覆盖用户的 `.claude`、`.obsidian`、`.trash` 等无关状态。
- 包迁移只调整路径和导入，不改转录算法。
- 虚拟环境重建采用“新环境并行验证，成功后再切换”的方式，避免先破坏当前可用环境。
- 所有执行文档写入 `Log/执行2`。

## 错误记录

| 错误 | 次数 | 处理 |
|---|---:|---|
| 统一 CLI 调用 Core `main()` 时绕过了各模块 `__main__` 中的编码配置，GBK 控制台打印 emoji 再次触发 `UnicodeEncodeError` | 1 | 在统一 CLI 入口自身配置 stdout/stderr 编码容错，并记录配置失败日志 |
| GUI 持久化测试误用 CLI 的 preset 名 `en2`，但 GUI 内部 ID 是 `en_v2` | 1 | 保持现有 GUI preset ID 不变以避免业务配置迁移；测试改用 `en_v2` |
| 重建后 PyPI 安装 `torch 2.13.0+cpu`，CUDA 不可用；同时 `check` 因缺少直接依赖 psutil 返回 1 | 1 | 保留旧环境不删；补齐 psutil/pynvml 顶层依赖，并从 PyTorch 官方 cu128 索引安装匹配 GPU 轮子后重测 |
| PyTorch cu128 dry-run 首次访问官方索引时出现 `SSLEOFError` | 1 | 之前 `pip index` 已成功证明版本存在；加入可复现索引配置后重试，必要时仅对官方域使用 trusted-host |
| pip 下载 2.77 GB torch cu128 wheel 到约 650 MB 时连接中断，退出码 2 | 2 | 改用 curl 对 PyTorch 官方 wheel URL 断点续传，完成后从本地 wheel 安装；旧环境继续保留 |
| CUDA 依赖安装后 `pip check` 报告 torch 2.11.0+cu128 要求 `setuptools<82`，环境中为 83.0.0 | 1 | 将 setuptools 作为直接构建工具声明为 `>=68,<82`，降级后重新执行完整依赖检查 |
| 回归比较脚本使用 `[Linq.Enumerable]::SequenceEqual[byte]` 时被 Windows PowerShell 5.1 解析器拒绝 | 1 | 改用两侧文件长度与 SHA-256 双重比较；相同哈希可证明字节内容一致 |
| PowerShell 5.1 将通过管道传给 Python 的脚本文本中“执行2”编码成 `??2`，导致基线文件路径无效 | 1 | Python 脚本改为在 `Log/*/baseline` 中定位目标文件，不再通过管道传递中文路径字面量 |
| 收尾补丁误带空的文件更新段，`apply_patch` 拒绝执行 | 1 | 删除空段后重新提交有效补丁；首次失败未修改任何文件 |
