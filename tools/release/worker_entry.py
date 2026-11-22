"""Frozen entry point for the release-only headless Python Worker."""

import sys


if __name__ == "__main__":
    if sys.argv[1:] == ["--media-probe"]:
        from whisper_subtitle.infrastructure.media_probe import main
    else:
        from whisper_subtitle.worker.stdio import main
    raise SystemExit(main())
