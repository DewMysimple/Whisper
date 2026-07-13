"""WhisperSubtitle application package and logging configuration."""

import logging

from .paths import get_app_paths


_APP_PATHS = get_app_paths()
# Historical name retained for external callers. Installed mode resolves to
# the runtime working directory rather than guessing from a src-layout path.
PROJECT_ROOT = _APP_PATHS.portable_root or _APP_PATHS.working_directory
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
