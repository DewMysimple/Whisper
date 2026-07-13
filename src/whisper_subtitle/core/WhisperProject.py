#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Faster-Whisper 英文语音识别转纯文本 TXT
适配: RTX 5070 Ti | Windows 11 | CUDA 12.8 | float16
模型: Whisper Large-V3-Turbo
输出: 纯文本，每行一句，无时间戳，无文件头
       默认保存到视频同目录的 Text 文件夹中
"""

import os
import sys
import re
import argparse
import logging
import warnings
from pathlib import Path

from .. import PROJECT_ROOT

logger = logging.getLogger(__name__)

# 设置 HF_HOME，将模型缓存放在工程目录内
os.environ["HF_HOME"] = str(PROJECT_ROOT / "models" / "huggingface")

from faster_whisper import WhisperModel

warnings.filterwarnings("ignore")


def _configure_cli_encoding():
    """避免 Windows GBK 控制台因 emoji 日志触发 UnicodeEncodeError。"""
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            try:
                reconfigure(errors="replace")
            except (OSError, ValueError) as exc:
                logger.warning(
                    "无法配置标准流编码（%s）: %s",
                    type(exc).__name__, exc,
                )


def ensure_proper_case(text: str) -> str:
    """确保句子首字母大写，并修复常见专有名词大小写"""
    if not text:
        return text

    # 1. 按句分割，确保每个句子首字母大写
    sentences = []
    for sentence in text.split('. '):
        sentence = sentence.strip()
        if sentence:
            if sentence[0].islower():
                sentence = sentence[0].upper() + sentence[1:]
            sentences.append(sentence)
    text = '. '.join(sentences)

    # 2. 常见英文专有名词修正（使用词边界 \b 确保整词匹配）
    proper_nouns = {
        'i': 'I',
        "i'm": "I'm",
        "i'll": "I'll",
        "i've": "I've",
        "i'd": "I'd",
        'monday': 'Monday', 'tuesday': 'Tuesday', 'wednesday': 'Wednesday',
        'thursday': 'Thursday', 'friday': 'Friday', 'saturday': 'Saturday', 'sunday': 'Sunday',
        'january': 'January', 'february': 'February', 'march': 'March', 'april': 'April',
        'may': 'May', 'june': 'June', 'july': 'July', 'august': 'August',
        'september': 'September', 'october': 'October', 'november': 'November', 'december': 'December',
        'english': 'English', 'chinese': 'Chinese', 'japanese': 'Japanese', 'french': 'French',
        'american': 'American', 'british': 'British', 'european': 'European',
        'youtube': 'YouTube', 'google': 'Google', 'facebook': 'Facebook',
        'iphone': 'iPhone', 'ipad': 'iPad', 'macbook': 'MacBook',
        'adobe': 'Adobe', 'photoshop': 'Photoshop', 'blender': 'Blender',
        'gaea': 'Gaea', 'houdini': 'Houdini', 'unreal': 'Unreal', 'unity': 'Unity',
    }

    for lower, proper in proper_nouns.items():
        pattern = re.compile(r'\b' + re.escape(lower) + r'\b', re.IGNORECASE)
        text = pattern.sub(proper, text)

    return text


def ensure_punctuation(text: str) -> str:
    """确保文本以标点符号结尾"""
    text = text.strip()
    if text and text[-1] not in '.!?':
        text += '.'
    return text


def merge_segments_to_sentences(segments):
    """
    智能合并 Whisper 片段为完整句子。
    只有当片段以 . ! ? 结尾时，才视为句子结束。
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

        # 检查是否句子结束（支持带引号的情况如 ." !" ?"）
        if any(text.endswith(p) for p in ['.', '!', '?', '."', '!"', '?"', '.\'', '!\'', '?\'']):
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
    from .presets import get_preset
    segments, info = model.transcribe(str(video_path), **get_preset("en_v1")["params"])

    print(f"🌐 检测到语言: {info.language} (概率: {info.language_probability:.2f})")

    # 收集所有片段（生成器转列表）
    segments_list = list(segments)
    print(f"🧩 原始片段数: {len(segments_list)}")

    # 智能合并为句子级时间轴
    sentences = merge_segments_to_sentences(segments_list)
    print(f"📝 合并后句子数: {len(sentences)}")

    # 生成纯文本 TXT 文件（无时间戳，无文件头）
    base_name = video_path.stem
    output_path = output_dir / f"{base_name}.txt"

    with open(output_path, 'w', encoding='utf-8') as f:
        for sentence in sentences:
            # 后处理：大小写修正 + 标点补全
            text = sentence['text']
            text = ensure_proper_case(text)
            text = ensure_punctuation(text)
            # 每行一句，纯文本输出
            f.write(text + "\n")

    # 如果用户指定了输出目录，额外备份一份到视频同目录的 Text 文件夹
    if output_dir != text_dir:
        backup_path = text_dir / f"{base_name}.txt"
        with open(backup_path, 'w', encoding='utf-8') as f:
            for sentence in sentences:
                text = sentence['text']
                text = ensure_proper_case(text)
                text = ensure_punctuation(text)
                f.write(text + "\n")
        print(f"✅ 完成输出: {output_path} + 备份: {backup_path}")
    else:
        print(f"✅ 完成输出: {output_path}")
    
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
            for sentence in sentences:
                text = sentence['text']
                text = ensure_proper_case(text)
                text = ensure_punctuation(text)
                f.write(text + "\n")
        
        txt_to_md(desktop_txt_path, desktop_md_path, video_path)
        print(f"📁 桌面保存: {desktop_txt_path} + {desktop_md_path}")
    
    return output_path


def main():
    parser = argparse.ArgumentParser(
        description='Faster-Whisper 英文语音识别转纯文本 TXT (适配 RTX 5070Ti)',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
使用示例:
  单文件 (自动创建 Text 目录):
      python faster_whisper_en_aggressive.py "D:\\视频\\课程1.mp4"
      → 输出到 D:\\视频\\Text\\课程1.txt

  文件夹 (递归扫描子文件夹中的视频，自动创建 Text 目录):
      python faster_whisper_en_aggressive.py "D:\\视频\\课程文件夹"
      → 输出到 D:\\视频\\课程文件夹\\子文件夹A\\Text\\课程x.txt
      → 输出到 D:\\视频\\课程文件夹\\子文件夹B\\Text\\课程y.txt

  强制指定输出目录 (不使用自动 Text 目录):
      python faster_whisper_en_aggressive.py "D:\\视频\\课程1.mp4" -o "D:\\字幕"
      → 输出到 D:\\字幕\\课程1.txt
        """
    )
    parser.add_argument('input', help='输入媒体文件或文件夹路径')
    parser.add_argument(
        '-o', '--output', default='.',
        help='强制指定输出文件夹路径 (默认: 在媒体文件所在目录自动创建 Text 文件夹)'
    )
    parser.add_argument(
        '--desktop', action='store_true',
        help='额外保存到桌面 Whisper语音列表 并转 Markdown'
    )
    args = parser.parse_args()

    input_path = Path(args.input)

    # 加载模型前先校验输入，避免无效路径或格式白费启动时间与显存
    media_extensions = {
        '.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.mpeg', '.mpg',
        '.mp3', '.wav', '.m4a', '.aac', '.ogg',
    }
    if input_path.is_file():
        if input_path.suffix.lower() not in media_extensions:
            print(f"❌ 错误: 不支持的文件格式 {input_path.suffix}")
            return 1
        video_files = [input_path]
    elif input_path.is_dir():
        video_files = sorted([
            f for f in input_path.rglob('*')
            if f.is_file() and f.suffix.lower() in media_extensions
        ])
    else:
        print(f"❌ 错误: 输入路径不存在 {input_path}")
        return 1

    if not video_files:
        print("❌ 未找到媒体文件，支持格式: " + ", ".join(sorted(media_extensions)))
        return 1

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

    print(f"📁 找到 {len(video_files)} 个媒体文件:")
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
        print(f"📂 输出位置: 各媒体文件所在目录的 Text 子文件夹中")
    print(f"{'='*60}")
    return 0 if success_count == len(video_files) else 1


if __name__ == "__main__":
    _configure_cli_encoding()
    sys.exit(main())
