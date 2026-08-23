# 批次 08 发现记录

## 初始事实

- 当前为普通 `master` 检出，批次 0–7 是本批次的未提交前置变更，因此继续原地实施。
- 批次 7 最终基线为 `230 passed`，暂存区和 `.workbuddy` 均无变化。
- `launch.vbs` 固定引用 `whisper_env/Scripts/python*.exe` 和 `src/whisper_subtitle/...` 脚本。
- GUI 固定使用仓库虚拟环境解释器、仓库工作目录和 `assets/logo.png`。
- `utils/test_env.py` 以源码脚本存在性和固定虚拟环境目录作为健康标准。
- 当前 `PROJECT_ROOT = Path(__file__).resolve().parents[2]` 只对 src-layout 仓库成立，安装后不可靠。
- bootstrap 与 ProcessRunner 默认把 HF_HOME 指向仓库 `models/huggingface`。

## 待验证

- `FasterWhisperEngine` 当前模型位置解析和错误信息。
- 现有 `bootstrap.py`、包入口、console script 和 launch 行为。
- logo 是否已位于包内，或需要复制为 package data。
- 在不联网、不复制巨型模型的情况下模拟隔离安装的方式。

## 基线与当前实现

- 批次 8 开始全量基线：`230 passed in 0.62s`。
- `FasterWhisperEngine.load()` 仍只把模型名交给 faster-whisper；本地位置通过 bootstrap 设置 `HF_HOME` 间接生效。
- `resolve_model_location(project_root)` 目前只有“仓库/models/huggingface”一种规则，没有显式参数/环境变量优先级，也没有可操作的缺失诊断。
- GUI `ProcessRunner` 把 `HF_HOME` 固定为 `project_root/models/huggingface`，且构造器强制需要仓库工作目录。
- `launch.vbs` 已用 `-m whisper_subtitle` 启动，但解释器和检查仍绑定固定便携目录；可改为候选解释器发现 + 模块入口，不再检查源码脚本。
- 包内目前没有 logo 资源；根目录 `assets/logo.png` 为 102843 字节，需作为 package data 复用并保留便携 fallback。
- 隔离安装验证可用临时 venv + `pip install --no-deps .`，复用系统/现有依赖需另行处理；入口/help 和资源可在无模型加载下验证。

## 已实现边界

- `paths.py` 集中提供解释器、工作目录、便携根目录、用户数据、模型位置和 package resource。
- 模型优先级已固化为：显式参数 → `WHISPER_SUBTITLE_MODEL_DIR` → `HF_HOME` → 便携目录 → 用户缓存。
- `ModelLocation.require_model()` 支持直接 CTranslate2 模型目录和 Hugging Face snapshot，并在缺失时给出 `--model-dir` 与环境变量提示。
- 真实 `FasterWhisperEngine` 加载前解析本地 snapshot；注入 fake factory 的单元测试合同保持不变。
- GUI 解释器默认来自 `sys.executable`，工作目录和 `HF_HOME` 来自 AppPaths。
- logo 已复制为 `whisper_subtitle/resources/logo.png`，与原文件 SHA256 相同，并由 `importlib.resources` 读取；便携旧 assets 保留 fallback。
- 环境检查改为验证 PyQt5/psutil/faster_whisper 可发现、当前解释器存在、本地模型完整，不再检查 `src` 或 Core 脚本。
- launch 支持 `WHISPER_SUBTITLE_PYTHON`、三个便携 venv 候选和 PATH `python` fallback，统一用模块入口 check/gui。

## 验证结果

- 全量测试：`240 passed in 2.19s`。
- prefix wheel 安装后，仓库外 cwd 的 `python -m whisper_subtitle --help`、console script、package logo 和 `check` 均通过。
- 当前便携模式的模块入口、console script、环境检查均返回 0。
- `cscript launch.vbs` 返回 0，实际启动 GUI；检测到的两个 pythonw 进程（venv launcher/base process）均已终止。
- 24/24 基准运行成功，静态参数/输出字段与基线完全相同。
- 总进程耗时中位数比例：cn 0.884/0.859；cn2 0.865/0.868；en 0.852/0.864；en2 0.867/0.854（cold/warm），最大 0.884。
- 本地 snapshot 直载消除了模型名解析阶段的部分启动开销，同时黄金输出不变。
