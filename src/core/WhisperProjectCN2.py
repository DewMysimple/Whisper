#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Faster-Whisper 中文语音识别转纯文本 TXT (防幻觉版)
适配: RTX 5070 Ti | Windows 11 | CUDA 12.8 | float16
模型: Whisper Large-V3-Turbo
输出: 纯文本，每行一句，无时间戳，无文件头
特点: 关闭上下文依赖 + 收紧阈值 + clean_repetition 去重 + 句内重复清理，
      抑制中文尾部重复幻觉与句内连续重复。
"""

import os
import sys
import re
import argparse
import warnings
from pathlib import Path

# 设置 HF_HOME，将模型缓存放在工程目录内
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
os.environ["HF_HOME"] = str(PROJECT_ROOT / "models" / "huggingface")

from faster_whisper import WhisperModel

warnings.filterwarnings("ignore")


def ensure_chinese_punctuation(text: str) -> str:
    """将英文标点转换为中文标点，并确保句子以中文标点结尾"""
    # 英文标点 → 中文标点
    replacements = {
        ',': '，',
        '.': '。',
        '!': '！',
        '?': '？',
        ':': '：',
        ';': '；',
        '"': '"',
        '"': '"',
        "'": ''',
        "'": ''',
        '(': '（',
        ')': '）',
    }

    for en, cn in replacements.items():
        text = text.replace(en, cn)

    text = text.strip()
    if text and text[-1] not in '。！？':
        text += '。'

    return text


def merge_segments_to_sentences(segments):
    """
    智能合并 Whisper 片段为完整句子。
    中文句子以 。！？ 结尾。
    """
    sentences = []
    current_parts = []
    current_start = 0.0
    current_end = 0.0

    for segment in segments:
        text = segment.text.strip()
        if not text:
            continue

        if not current_parts:
            current_start = segment.start

        current_parts.append(text)
        current_end = segment.end

        # 检查是否句子结束（中文句子以 。！？ 结尾）
        if any(text.endswith(p) for p in ['。', '！', '？', '。"', '！"', '？"']):
            full_text = ' '.join(current_parts)
            sentences.append({
                'start': current_start,
                'end': current_end,
                'text': full_text
            })
            current_parts = []

    # 处理剩余未闭合的片段（强制合并为一句）
    if current_parts:
        full_text = ' '.join(current_parts)
        sentences.append({
            'start': current_start,
            'end': current_end,
            'text': full_text
        })

    return sentences


def clean_inner_repetition(text: str) -> str:
    """
    清理句内连续重复片段（中文幻觉修复）。
    仅当同一 2-6 字片段连续出现 3 次及以上时才清理，保留一次。
    例如 "谢谢观看谢谢观看谢谢观看" → "谢谢观看"。
    口语中正常的 2 次强调重复（如"好的好的"、"对对"）不会被误删。
    """
    if not text:
        return text
    # 匹配连续重复 3 次及以上的中文片段（2-6 字），保留一次
    pattern = re.compile(r'([\u4e00-\u9fa5]{2,6})\1{2,}')
    prev = None
    # 迭代清理，避免嵌套重复残留
    while prev != text:
        prev = text
        text = pattern.sub(r'\1', text)
    return text


def clean_repetition(lines):
    """
    清理连续重复句子（中文幻觉修复）
    1. 末尾连续 4 句+完全相同 → 截断保留第一句（常见于视频结尾静音/音乐段）
    2. 全文连续相同句仅保留一句
    """
    if not lines:
        return lines

    # 保险1: 截断尾部极端重复
    n = len(lines)
    if n >= 4:
        last = lines[-1]
        if all(l == last for l in lines[-4:]):
            idx = n - 1
            while idx > 0 and lines[idx - 1] == last:
                idx -= 1
            lines = lines[:idx + 1]

    # 保险2: 全文去重，连续相同句仅保留一句
    if not lines:
        return lines
    cleaned = [lines[0]]
    for line in lines[1:]:
        if line == cleaned[-1]:
            continue
        cleaned.append(line)

    return cleaned


def txt_to_md(txt_path: Path, md_path: Path, video_path: Path):
    """将纯文本 TXT 复制为 Markdown 格式（内容完全一致，仅扩展名不同）"""
    with open(txt_path, 'r', encoding='utf-8') as f:
        content = f.read()

    with open(md_path, 'w', encoding='utf-8') as f:
        f.write(content)


def process_video(video_path: Path, model: WhisperModel, forced_output_dir: Path = None, desktop: bool = False) -> Path:
    """处理单个视频文件"""
    print(f"\n{'='*60}")
    print(f"🎬 正在处理: {video_path.name}")
    print(f"{'='*60}")

    # 决定输出目录：用户指定 或 视频同目录的 Text 文件夹
    if forced_output_dir is not None:
        output_dir = forced_output_dir
    else:
        output_dir = video_path.parent / "Text"
    output_dir.mkdir(parents=True, exist_ok=True)

    # 始终创建视频同目录的 Text 文件夹（作为备份存档）
    text_dir = video_path.parent / "Text"
    text_dir.mkdir(parents=True, exist_ok=True)

    # 转录参数 —— 从 presets.py 单一数据源读取
    from presets import get_preset
    segments, info = model.transcribe(str(video_path), **get_preset("cn2")["params"])

    print(f"🌐 检测到语言: {info.language} (概率: {info.language_probability:.2f})")

    # 收集所有片段（生成器转列表）
    segments_list = list(segments)
    print(f"🧩 原始片段数: {len(segments_list)}")

    # 智能合并为句子级时间轴
    sentences = merge_segments_to_sentences(segments_list)
    print(f"📝 合并后句子数: {len(sentences)}")

    # 后处理：中文标点转换 + 句内重复清理 + 句级重复清理
    lines = []
    for sentence in sentences:
        text = sentence['text']
        text = ensure_chinese_punctuation(text)
        text = clean_inner_repetition(text)
        lines.append(text)

    original_count = len(lines)
    lines = clean_repetition(lines)
    removed_count = original_count - len(lines)
    if removed_count > 0:
        print(f"🧹 清理重复句: 删除 {removed_count} 句幻觉重复")

    # 生成纯文本 TXT 文件（无时间戳，无文件头）
    base_name = video_path.stem
    output_path = output_dir / f"{base_name}.txt"

    with open(output_path, 'w', encoding='utf-8') as f:
        for line in lines:
            f.write(line + "\n")

    # 如果用户指定了输出目录，额外备份一份到视频同目录的 Text 文件夹
    if output_dir != text_dir:
        backup_path = text_dir / f"{base_name}.txt"
        with open(backup_path, 'w', encoding='utf-8') as f:
            for line in lines:
                f.write(line + "\n")
        print(f"✅ 完成输出: {output_path} ({len(lines)} 句) + 备份: {backup_path}")
    else:
        print(f"✅ 完成输出: {output_path} ({len(lines)} 句)")

    # 如果启用了桌面保存，保存到桌面并转 Markdown
    if desktop:
        desktop_base = Path.home() / "Desktop" / "Whisper语音列表"
        desktop_text_dir = desktop_base / "Text"
        desktop_md_dir = desktop_base / "Markdown"
        desktop_text_dir.mkdir(parents=True, exist_ok=True)
        desktop_md_dir.mkdir(parents=True, exist_ok=True)

        desktop_txt_path = desktop_text_dir / f"{base_name}.txt"
        desktop_md_path = desktop_md_dir / f"{base_name}.md"

        with open(desktop_txt_path, 'w', encoding='utf-8') as f:
            for line in lines:
                f.write(line + "\n")

        txt_to_md(desktop_txt_path, desktop_md_path, video_path)
        print(f"📁 桌面保存: {desktop_txt_path} + {desktop_md_path}")

    return output_path


def main():
    parser = argparse.ArgumentParser(
        description='Faster-Whisper 中文语音识别转纯文本 TXT (防幻觉版, 适配 RTX 5070Ti)',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=r"""
使用示例:
  单文件 (自动创建 Text 目录):
      python WhisperProjectCN2.py "D:\\视频\\课程1.mp4"
      → 输出到 D:\视频\Text\课程1.txt

  文件夹 (递归扫描子文件夹中的视频，自动创建 Text 目录):
      python WhisperProjectCN2.py "D:\\视频\\课程文件夹"
      → 输出到 D:\视频\课程文件夹\子文件夹A\Text\课程x.txt
      → 输出到 D:\视频\课程文件夹\子文件夹B\Text\课程y.txt

  强制指定输出目录 (不使用自动 Text 目录):
      python WhisperProjectCN2.py "D:\\视频\\课程1.mp4" -o "D:\\字幕"
      → 输出到 D:\字幕\课程1.txt
        """
    )
    parser.add_argument('input', help='输入视频文件或文件夹路径')
    parser.add_argument(
        '-o', '--output', default='.',
        help='强制指定输出文件夹路径 (默认: 在视频所在目录自动创建 Text 文件夹)'
    )
    parser.add_argument(
        '--desktop', action='store_true',
        help='额外保存到桌面 Whisper语音列表 并转 Markdown'
    )
    args = parser.parse_args()

    input_path = Path(args.input)

    # 判断是否用户显式指定了输出目录
    forced_output_dir = Path(args.output) if args.output != '.' else None
    if forced_output_dir is not None:
        forced_output_dir.mkdir(parents=True, exist_ok=True)

    # 验证 CUDA / GPU 状态
    import torch
    if not torch.cuda.is_available():
        print("⚠️ 警告: CUDA 不可用，将回退到 CPU 运行 (速度极慢)")
        device = "cpu"
        compute_type = "int8"
    else:
        gpu_name = torch.cuda.get_device_name(0)
        print(f"🖥️  检测到 GPU: {gpu_name}")
        print(f"🔧 CUDA 版本: {torch.version.cuda}")
        print(f"⚡ 使用 float16 半精度加速")
        device = "cuda"
        compute_type = "float16"

    # 初始化模型
    print("\n📦 正在加载 Whisper Large-V3-Turbo 模型...")
    print(f"   模型路径: {PROJECT_ROOT / 'models' / 'huggingface' / 'hub'}")
    print("   模型已内置在工程目录中，无需联网下载\n")

    model = WhisperModel(
        "large-v3-turbo",
        device=device,
        compute_type=compute_type,
        cpu_threads=4 if device == "cpu" else 0,
        num_workers=1,
    )
    print("✅ 模型加载完成\n")

    # 收集待处理视频
    video_extensions = {'.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.mpeg', '.mpg'}

    if input_path.is_file():
        if input_path.suffix.lower() not in video_extensions:
            print(f"❌ 错误: 不支持的文件格式 {input_path.suffix}")
            sys.exit(1)
        video_files = [input_path]
    elif input_path.is_dir():
        # 递归扫描所有子文件夹中的视频文件
        video_files = sorted([
            f for f in input_path.rglob('*')
            if f.is_file() and f.suffix.lower() in video_extensions
        ])
    else:
        print(f"❌ 错误: 输入路径不存在 {input_path}")
        sys.exit(1)

    if not video_files:
        print("❌ 未找到视频文件，支持格式: " + ", ".join(video_extensions))
        sys.exit(1)

    print(f"📁 找到 {len(video_files)} 个视频文件:")
    for vf in video_files:
        print(f"   • {vf}")
    print()

    # 批量处理
    success_count = 0
    for video_file in video_files:
        try:
            process_video(video_file, model, forced_output_dir, args.desktop)
            success_count += 1
        except Exception as e:
            print(f"\n❌ 处理 {video_file.name} 时出错: {e}")
            import traceback
            traceback.print_exc()

    print(f"\n{'='*60}")
    print(f"🎉 全部处理完成! 成功: {success_count} / {len(video_files)}")
    if forced_output_dir:
        print(f"📂 强制输出目录: {forced_output_dir.absolute()}")
    else:
        print(f"📂 输出位置: 各视频所在目录的 Text 子文件夹中")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
