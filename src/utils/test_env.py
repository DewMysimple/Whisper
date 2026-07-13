#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
启动前轻量环境自检。

设计原则：只校验 GUI 运行必需项，不 import torch / faster_whisper 等重包。
- torch / faster_whisper / CUDA 的真实可用性，留给 core 转录脚本自检
  （用户点「开始转录」时，core 脚本会检测 torch.cuda.is_available() 并把
  异常/回退信息打到 stdout，GUI 日志会实时显示）。
- 这样能把 VBS 同步等待的 test_env 耗时从 ~1.3s 降到 ~0.15s。
- 规避 torch 必须最先 import 的顺序坑（在 numpy/av 之后 import 会触发
  c10.dll 初始化失败），这里根本不 import torch。
"""

import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
VENV_PYTHON = PROJECT_ROOT / "whisper_env" / "Scripts" / "python.exe"
GUI_SCRIPT = PROJECT_ROOT / "src" / "gui" / "WhisperPyQtGUI.py"
CORE_SCRIPTS = [
    PROJECT_ROOT / "src" / "core" / "WhisperProject.py",
    PROJECT_ROOT / "src" / "core" / "WhisperProject2.py",
    PROJECT_ROOT / "src" / "core" / "WhisperProjectCN.py",
]
MODEL_DIR = PROJECT_ROOT / "models" / "huggingface" / "hub"

# GUI 运行必需的轻量包（不含 torch / faster_whisper / av / soundfile 等重包）
REQUIRED_PACKAGES = ["PyQt5", "psutil"]


def main():
    failed = []

    # 1. 轻量包导入校验
    for pkg in REQUIRED_PACKAGES:
        try:
            __import__(pkg)
        except Exception as e:
            failed.append(f"  {pkg}: {e}")

    # 2. 关键文件 / 目录存在性校验
    if not VENV_PYTHON.exists():
        failed.append(f"  虚拟环境 Python 未找到: {VENV_PYTHON}")
    if not GUI_SCRIPT.exists():
        failed.append(f"  GUI 脚本未找到: {GUI_SCRIPT}")
    for s in CORE_SCRIPTS:
        if not s.exists():
            failed.append(f"  转录脚本未找到: {s}")
    if not MODEL_DIR.exists():
        failed.append(f"  模型目录未找到: {MODEL_DIR}")

    if failed:
        print("环境自检失败:", file=sys.stderr)
        for msg in failed:
            print(msg, file=sys.stderr)
        sys.exit(1)

    sys.exit(0)


if __name__ == "__main__":
    main()
