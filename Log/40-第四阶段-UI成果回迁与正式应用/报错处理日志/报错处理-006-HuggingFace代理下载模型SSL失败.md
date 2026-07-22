# 报错处理 006：Hugging Face 代理下载模型 SSL 失败

日期：2026-07-23。

状态：下载链路已通过 ModelScope 绕过；六个模型目录及关键文件静态核对通过；尚未在本记录中完成六个模型逐一真实加载和转录验收。

## 1. 记录来源与范围

本记录根据以下 Claude Code 对话导出总结：

`C:\Users\Administrator\Desktop\Obsidian仓库\_Artificial Intelligence\Claude对话查看\Claude对话记录\2026-07-23_01-54_dd6be7d3-b08d-4945-8104-8145a57dabcd.md`

对话记录了通过 Hugging Face 下载 `large-v3` 失败、清理未完成下载、改用 ModelScope 下载 `large-v3`，以及继续补齐 `tiny`、`base`、`small`、`medium` 的过程。

本问题属于外部模型下载链路和本机代理兼容问题，不是 WhisperSubtitle 转录算法、模型切换逻辑、Preset、CUDA 推理或 Desktop IPC 的运行错误。

## 2. 用户可见现象

初始环境为：

- Windows 系统代理已开启，地址为 `127.0.0.1:7890`；
- `HTTP_PROXY`、`HTTPS_PROXY` 环境变量最初未设置；
- Hugging Face CLI 位于 `F:\WhisperSubtitle\whisper_env\Scripts\hf.exe`，版本为 `1.23.0`；
- 正式模型目录中尚无 `large-v3`，已有 `large-v3-turbo`。

为 Hugging Face CLI 配置代理后，主站和小型 JSON 文件可以连接或下载，但大型 `model.bin` 长时间没有产生有效进度。对话中出现的具体表现包括：

- `hf.exe` 运行数分钟后，`model.bin` 对应 incomplete 文件仍为 0；
- 进程一度没有建立有效网络连接；
- 终止并重试后出现上一次下载残留的锁文件冲突；
- 调低并发、增加超时、改为单文件下载仍未解决；
- 通过代理使用 curl 下载时退出码为 35；
- SSL 报错为 `[SSL: UNEXPECTED_EOF_WHILE_READING]`。

## 3. 根因与伴随问题

对话中的网络诊断把主要失败点定位到承载大模型文件的 Hugging Face CDN：代理可以访问 Hugging Face 主站，但与 `cdn-lfs.huggingface.co` 建立大文件下载连接时发生 SSL 握手/连接提前结束，导致 `model.bin` 无法开始或持续下载。

另有一个次生问题：多次强制终止下载后留下锁文件，使后续 Hugging Face CLI 尝试被旧锁阻塞。锁冲突不是最初的网络根因，但增加了重试失败和误判“仍在下载”的可能性。

直连测试在对话中被报告为可以下载，但速度约 345 KB/s；代理链路更快地访问主站，却无法稳定通过模型文件 CDN。以上速度和 SSL 诊断来自导出的对话过程，本次归档没有重新执行网络测速。

## 4. 当时采取的处理

### 4.1 清理未完成的 Hugging Face 下载

用户要求删除刚才下载的未完成内容。原对话中的 Claude 声称已清理 `large-v3` 目标目录及相关缓存，并确认模型目录只剩原有 `large-v3-turbo`。

导出的 Markdown 没有保存实际清理命令和所有目标路径，只记录了“PowerShell 被安全限制后通过 Bash 清理”。因此不能从该记录证明当时删除是否进入 Windows 回收站，也不能独立复核清理目标是否仅限未完成文件。该历史操作不是本次归档执行的操作。

### 4.2 改用 ModelScope

随后改用国内可访问性更好的 ModelScope，并建立独立环境：

- 环境根目录：`C:\Users\Administrator\AppData\Local\WhisperSubtitle-ModelScope`；
- Python：`C:\Users\Administrator\AppData\Local\WhisperSubtitle-ModelScope\Scripts\python.exe`；
- CLI：`C:\Users\Administrator\AppData\Local\WhisperSubtitle-ModelScope\Scripts\modelscope.exe`。

先下载 `large-v3` 到正式模型目录。对话报告：

- 模型大小约 2.88 GB；
- 总耗时约 266 秒；
- 平均速度约 11.1 MB/s；
- `config.json`、`model.bin`、`tokenizer.json`、`vocabulary.json` 和 `preprocessor_config.json` 均存在。

之后继续补齐 `tiny`、`base`、`small`、`medium`。`large-v3-turbo` 是本次操作前已经存在的模型，没有重新下载。

对话导出没有保存每次 `modelscope download` 使用的精确仓库 ID、revision 或远端文件哈希。因此本记录只能确认当前落地文件结构，不能把它们声明为与 Hugging Face 指定 revision 逐字节一致。

## 5. 当前文件静态核对

2026-07-23 根据正式目录进行只读复核：

`F:\WhisperSubtitle\apps\desktop\src-tauri\target\release\models`

| 模型 | 目录 | `config.json` | `model.bin` | `tokenizer.json` | 当前约占用 |
| --- | --- | --- | --- | --- | ---: |
| `tiny` | 存在 | 存在 | 存在 | 存在 | 0.073 GiB |
| `base` | 存在 | 存在 | 存在 | 存在 | 0.138 GiB |
| `small` | 存在 | 存在 | 存在 | 存在 | 0.453 GiB |
| `medium` | 存在 | 存在 | 存在 | 存在 | 1.425 GiB |
| `large-v3` | 存在 | 存在 | 存在 | 存在 | 2.879 GiB |
| `large-v3-turbo` | 存在 | 存在 | 存在 | 存在 | 1.510 GiB |

六个模型合计约 6.48 GiB。独立 ModelScope 环境当前仍存在，安装的 `modelscope` 版本为 `1.38.1`。

上述检查满足正式 Host 当前用于发现完整模型的最低文件条件，并额外确认了 tokenizer 文件；它不等同于 CTranslate2 真实加载、CUDA 初始化或媒体转录成功。

## 6. 已验证与未验证事项

### 已验证

- 对话原文件可读取，时间和下载过程完整；
- 独立 ModelScope 环境、Python 和 CLI 当前存在；
- 六个支持模型目录当前全部存在；
- 六个目录均有 `config.json`、`model.bin` 和 `tokenizer.json`；
- `large-v3-turbo` 保持为原先已有模型；
- 本次归档没有修改模型、环境、代码、EXE 或 Worker。

### 尚未在本记录中验证

- 软件“模型切换”工作台刷新后是否逐一显示六个模型；
- 六个模型是否都能通过真实 `model.load`；
- 六个模型在本机 CUDA/CPU 和不同计算精度下的兼容性；
- 每个新模型的真实短媒体转录、输出内容和显存占用；
- ModelScope 社区镜像与 Hugging Face 官方指定 revision 的文件哈希一致性；
- 原对话中删除未完成 Hugging Face 文件的可恢复性。

因此当前状态不能写成“六模型完整功能验收通过”。后续若要把六个模型作为正式可用集合，应另开功能测试，逐一冻结来源、哈希、加载配置和最小真实转录结果。

## 7. 边界与后续门禁

- 本次属于报错过程归档，不占用“第 21 次修改”编号；
- 没有修改 Python 转录算法、faster-whisper、CTranslate2、CUDA、Preset 或字幕/文本输出；
- 没有修改 Desktop IPC v1、前端模型切换代码或正式二进制；
- 没有修改第三阶段 `C:\Users\Administrator\Desktop\WhisperUI`；
- 没有安装、下载、删除、移动或重写任何模型；
- 没有关闭或重启 Desktop/Worker；
- 没有执行 Git 暂存、提交、分支、标签、推送或发布；
- 独立 ModelScope 环境不得自动删除；如以后明确要求移除，也必须遵守“只能移入 Windows 回收站”的规则。

