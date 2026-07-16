"""Frozen entry point for the release-only headless Python Worker."""

from whisper_subtitle.worker.stdio import main


if __name__ == "__main__":
    raise SystemExit(main())
