# WhisperSubtitle 项目记忆

## 工程定位
本地 Whisper 语音转文本桌面工具，目标机 RTX 5070 Ti / Win11 / CUDA 12.8 / float16。
模型 `mobiuslabsgmbh/faster-whisper-large-v3-turbo` 内置于 `models/huggingface/`，离线可用。

## 架构（四层）
1. **启动层**：`Whisper.lnk` → `launch.vbs`（无控制台）→ `src/utils/test_env.py` 校验依赖/CUDA → `pythonw.exe` 启动 GUI
2. **GUI 层**：`src/gui/WhisperPyQtGUI.py`（PyQt5）。三栏布局：左设置(固定440px) / 中参数·监视双页(固定500px, QStackedWidget) / 右日志(自适应)。用 `QProcess` 拉起转录子进程，注入 `HF_HOME`/`PYTHONIOENCODING=utf-8`/`PYTHONUNBUFFERED=1`，读 stdout 回显日志。
3. **转录层**：`src/core/` 四脚本互斥 —— `WhisperProjectCN.py`(中文,开上下文,中文标点) / `WhisperProjectCN2.py`(中文防幻觉,关上下文,严格阈值+`clean_repetition`+`clean_inner_repetition`) / `WhisperProject.py`(英文标准,开上下文,宽松阈值) / `WhisperProject2.py`(英文防幻觉,关上下文,严格阈值+`clean_repetition`去重)。共用：argparse(input/-o/--desktop) → 递归扫视频 → `merge_segments_to_sentences` → 后处理 → 写 `Text/*.txt`。
4. **推理输出**：faster-whisper + CTranslate2；输出 `Text/` 子目录(含备份)，可选 `--desktop` 存到 `C:/Users/Administrator/Desktop/Whisper语音列表/{Text,Markdown}`。

## GUI 设计要点
- 浅色主题：`#f8f9fa`/`#ffffff`/`#1a1a1a`；字体 LXGW WenKai；Fusion 风格。
- Win11 DWM API 圆角 + 浅色标题栏/边框（`DwmSetWindowAttribute` attr 33/34/35）。
- 窗口屏幕 55%×65%，最小 860×550；右下角 50%/75% 缩放按钮。
- 日志关键词着色：红=错 绿=成 蓝=命令 橙=警告；超 20000 行自动裁剪头部 1000 行。
- 性能监控：`PerfChart` 自绘折线（CPU/内存/GPU/显存），psutil + pynvml，1s 定时器。
- 交互：开始→自动切监视页+启定时器；停止→terminate→5s→kill；完成→自动切回参数页。

## 已知问题/注意点
- 桌面保存路径已动态化：`Path.home() / "Desktop" / "Whisper语音列表"`（OneDrive 重定向未处理，目标机无此情况）。
- 每次「开始转录」都新起 QProcess → 每次重新加载模型（模型不跨会话常驻）。
- 参数表已单一数据源：`src/core/presets.py` 定义四模式参数，脚本 `**get_preset(id)["params"]`、GUI 遍历 `PRESETS` 渲染，改一处自动同步。

## 已修复（2026-07-08）
- 删除过时文档 `docs/packaging.md`（描述旧扁平+ttkbootstrap 结构，与现 `src/` 布局不符）。
- 左栏「浏览」按钮改为下拉菜单：选文件(`_browse_input`, 含音视频过滤) / 选文件夹(`_browse_input_folder`)；删除废弃的 `_browse_file`。
- 完全删除队列空桩方法 5 个（`_add_file_to_queue`/`_add_folder_to_queue`/`_remove_selected`/`_clear_queue`/`_update_queue_status`，均无调用引用）。
- 启动加速：精简 `src/utils/test_env.py`，去掉 torch/faster_whisper/av/soundfile/numpy 预检，只校验 PyQt5/psutil + 关键文件存在。test_env 热态耗时 1.34s→0.11s；torch/CUDA 真实可用性留给 core 脚本转录时自检。注：torch 必须最先 import，否则在 numpy/av 之后加载会触发 c10.dll 初始化失败（OSError WinError 1114），精简后 test_env 不 import torch 故规避。冷启动剩余大头是 OS/Defender 的 DLL 扫描（~4.8s），需将 `whisper_env` 加入 Defender 排除列表。

## 技术文档
- `docs/architecture/技术文档.md`：10 章完整技术档案（架构总览/GUI细节/优劣势雷达+分层诊断/启动性能/模型重载/三版演进规划/已知问题/实测数据），配 7 张 SVG 图（`01-架构总览.svg` ~ `07-三版本演进.svg`）。
- 三版演进规划：V1 补缺陷备份基线（只规范不重构）/ V2 解耦重构建 Service 层（PySide6，关注点分离是 V3 复用关键）/ V3 Web UI（推荐 PyWebView 起点）。待用户拍板 V3 审美诉求等 4 个问题。
