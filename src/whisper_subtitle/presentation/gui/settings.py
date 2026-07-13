"""Typed persistence boundary around QSettings."""

from __future__ import annotations

import logging
from dataclasses import dataclass

from PyQt5.QtCore import QSettings

from ...domain.presets import DEFAULT_PRESET_ID, canonical_preset_id


logger = logging.getLogger(__name__)


def resolve_saved_preset_id(value: str) -> str:
    """Normalize historical canonical IDs and CLI aliases from QSettings."""
    try:
        return canonical_preset_id(value)
    except KeyError:
        return DEFAULT_PRESET_ID


@dataclass(frozen=True, slots=True)
class StoredSettings:
    input_path: str
    output_path: str
    preset_id: str
    geometry: object | None


class SettingsRepository:
    """Own all QSettings keys used by the main window."""

    def __init__(self, settings: QSettings | None = None) -> None:
        self.settings = settings or QSettings("WhisperSubtitle", "WhisperSubtitle")

    def load(self) -> StoredSettings:
        preset_id = self.settings.value(
            "transcription/preset", DEFAULT_PRESET_ID, type=str
        )
        return StoredSettings(
            input_path=self.settings.value("paths/input", "", type=str),
            output_path=self.settings.value("paths/output", "", type=str),
            preset_id=resolve_saved_preset_id(preset_id),
            geometry=self.settings.value("window/geometry"),
        )

    def set_input_path(self, value: str) -> None:
        self.settings.setValue("paths/input", value)

    def set_output_path(self, value: str) -> None:
        self.settings.setValue("paths/output", value)

    def set_preset_id(self, value: str) -> None:
        self.settings.setValue("transcription/preset", value)

    def save(
        self,
        *,
        input_path: str,
        output_path: str,
        preset_id: str,
        geometry: object,
    ) -> None:
        self.set_input_path(input_path)
        self.set_output_path(output_path)
        self.set_preset_id(preset_id)
        self.settings.setValue("window/geometry", geometry)
        self.settings.sync()
        if self.settings.status() != QSettings.NoError:
            logger.warning("QSettings 写入失败，状态码: %s", self.settings.status())
