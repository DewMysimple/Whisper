"""WhisperSubtitle application package and logging configuration."""

import logging
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
LOGGER_NAME = "whisper_subtitle"


def configure_logging(level=logging.INFO):
    """Configure the package logger once and return it."""
    package_logger = logging.getLogger(LOGGER_NAME)
    if not package_logger.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(logging.Formatter(
            "%(asctime)s | %(levelname)s | %(name)s | %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S",
        ))
        package_logger.addHandler(handler)
    package_logger.setLevel(level)
    package_logger.propagate = False
    return package_logger


logger = configure_logging()

__all__ = ["LOGGER_NAME", "PROJECT_ROOT", "configure_logging", "logger"]
