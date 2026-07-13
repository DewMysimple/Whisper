# 批次 0 发现

- 当前 HEAD：`9261d97 refactor: establish tested modularization baseline`。
- 批次开始时仅有三类未提交状态：用户本地 `.claude/settings.local.json`、用户文件 `Requirement/isolate.md`、生成目录 `tests/benchmark/runs/`。
- 用户明确要求本批不修改业务代码、不要自动提交 Git。
- 当前为普通 checkout（`.git` 与 common dir 相同），分支为 `master`；延续用户偏好在当前工作区执行。
- 系统 Git 配置 `core.autocrlf=true`，仓库尚无 `.gitattributes`，因此之前出现 LF/CRLF 提示。
- 批次开始时 13 个业务 Python 文件聚合 SHA256 为 `4E2A68A4F2A15A9FF3492D296C63ED46F2A14487A5873D7FEE35A02F7CCD5D2B`。
- 基线 pytest：71 条全部通过；`whisper-subtitle check` 返回 0。
- 四份 golden 均存在且哈希保持执行3记录值；英文两份为 `D6AD4418...DE78`，中文两份为 `69D77F85...CD3D`。
- `whisper_env/` 与 `models/` 已被忽略；`tests/benchmark/runs/` 尚未忽略，需要补充。`.pytest_cache` 也应由仓库根规则显式忽略，而不是依赖 pytest 目录内部规则。
- `.gitattributes` 的扩展名规则不会匹配 `.gitignore` 等无扩展名控制文件，需显式列出三者，才能在 `core.autocrlf=true` 的 Windows 环境消除提示。
- `.gitignore` 现已覆盖 pytest/mypy/Ruff/coverage 缓存、`test_error.txt` 和 `tests/benchmark/runs/`；原有虚拟环境与模型忽略规则保留。
- `.gitattributes` 已验证：Python/Markdown/JSON/TXT 为 LF，VBS 为 CRLF，WAV 等二进制禁用文本归一化；三个无扩展名控制文件为 LF。
- `pyproject.toml` 已增加 pytest 的 tests 路径、文件模式、严格配置/marker 和 strict xfail；仍可收集 71 条测试。
- 完整 pytest 为 `71 passed in 1.19s`；环境检查、console/module CLI 帮助均通过。
- 四份 golden 重新计算后与 baseline.json 完全一致且非空。
- `python -m whisper_subtitle` 与 `whisper-subtitle gui` 均在 Qt offscreen 环境持续运行 2 秒，GUI 冒烟通过。
- 批次验证后业务源码聚合 SHA256 仍为 `4E2A68A4F2A15A9FF3492D296C63ED46F2A14487A5873D7FEE35A02F7CCD5D2B`，`git diff -- src/whisper_subtitle` 为空。
