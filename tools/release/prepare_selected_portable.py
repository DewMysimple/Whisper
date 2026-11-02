"""Derive a model-specific portable tree without changing the current release."""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent))

from generate_release_manifest import (
    assert_unlinked,
    generate_manifest,
    selected_model_assets,
    sha256,
    verify_manifest,
)
from whisper_subtitle.domain.models import ASSETS_BY_ID, MODELS_BY_ID
from whisper_subtitle.paths import AppPaths

MANIFEST = Path("_internal/release-manifest.json")
MARKER = Path("_internal/selected-release.json")
GUIDE = Path("使用说明.md")


def selected_guide(source: str, model_id: str) -> str:
    model = MODELS_BY_ID[model_id]
    description = f"本包只包含 {model.label} 识别模型"
    if model.companion_id:
        description += f"及其必需的 {ASSETS_BY_ID[model.companion_id].label} 时间戳对齐模型"
    description += "。首次启动请在“模型与参数”中选择“" + model.label + "”。"
    if model_id != "large-v3-turbo":
        description += "软件初始默认仍为 Large V3 Turbo，本包不包含其权重，切换后即可转录。"
    description += "其他未安装模型不可用；软件不会自动联网下载模型。"
    if model.companion_id:
        description += "对齐模型名称中的 0.6B 不代表本包包含 Qwen3-ASR 0.6B。"
    lines = [description if line.startswith("Qwen3-ASR 提供 ") else line
             for line in source.splitlines()]
    return "\n".join(lines).replace("WhisperSubtitle.zip", f"WhisperSubtitle-{model_id}.zip") + "\n"


def prepare_selected_portable(
    source: Path, stage: Path, model_id: str, *, repository_root: Path = REPOSITORY_ROOT,
) -> Path:
    assets = selected_model_assets([model_id])
    repository_root = repository_root.absolute()
    source, stage = source.absolute(), stage.absolute()
    expected_stage = repository_root / "build" / "release-selected" / f"WhisperSubtitle-{model_id}"
    if source != repository_root / "dist" / "WhisperSubtitle" or stage != expected_stage:
        raise ValueError("Selected release paths must use the current dist and owned build staging directory")
    assert_unlinked(source)
    assert_unlinked(stage)
    source_manifest = source / MANIFEST
    verify_manifest(source, source_manifest)
    payload = json.loads(source_manifest.read_text(encoding="utf-8"))
    if not isinstance(payload.get("version"), str) or not payload["version"]:
        raise ValueError("Current release manifest has no version")
    location = AppPaths.discover(explicit_model_dir=source / "_internal/models", environ={}).model_location
    location.require_bundle(model_id)
    marker = {"schemaVersion": 1, "sourceManifestSha256": sha256(source_manifest), "modelIds": [model_id]}
    if stage.exists():
        # Reuse only an intact stage derived from this exact current release.
        # Unknown or stale content is never overwritten or deleted by this tool.
        verify_manifest(stage, stage / MANIFEST)
        stage_payload = json.loads((stage / MANIFEST).read_text(encoding="utf-8"))
        if (stage_payload.get("modelIds") != [model_id]
                or json.loads((stage / MARKER).read_text(encoding="utf-8")) != marker):
            raise ValueError("Existing selected release stage is not owned by this source/model selection")
        return stage
    if not (source / GUIDE).is_file():
        raise ValueError("Current portable release is missing its user guide")
    stage.mkdir(parents=True)
    for row in payload["files"]:
        relative = Path(row["path"])
        if relative in (MANIFEST, MARKER, GUIDE):
            continue
        if relative.parts[:2] == ("_internal", "models") and (
            len(relative.parts) < 4 or relative.parts[2] not in assets
        ):
            continue
        destination = stage / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source / relative, destination)
    (stage / GUIDE).write_text(selected_guide((source / GUIDE).read_text(encoding="utf-8"), model_id), encoding="utf-8")
    (stage / MARKER).write_text(json.dumps(marker, indent=2) + "\n", encoding="utf-8")
    generate_manifest(stage, stage / MANIFEST, payload["version"], [model_id])
    verify_manifest(stage, stage / MANIFEST)
    return stage


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--stage", required=True, type=Path)
    parser.add_argument("--model-id", required=True, choices=tuple(MODELS_BY_ID))
    args = parser.parse_args()
    stage = prepare_selected_portable(args.source, args.stage, args.model_id)
    print(f"Selected portable stage: {stage}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
