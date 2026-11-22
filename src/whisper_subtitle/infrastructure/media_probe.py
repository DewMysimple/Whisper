"""Private PyAV helper transport. Only the Worker starts this child."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import NamedTuple


class ProbeResult(NamedTuple):
    readable: bool
    duration: float | None
    error: str | None
    code: str | None


def probe_container(path: Path) -> ProbeResult:
    try:
        import av

        with av.open(str(path), mode="r") as container:
            if not container.streams.audio:
                return ProbeResult(False, None, "媒体没有音轨", "media.no_audio")
            if container.duration is not None and container.duration > 0:
                duration = float(container.duration) / float(av.time_base)
            else:
                durations = (
                    float(stream.duration * stream.time_base)
                    for stream in container.streams
                    if stream.duration is not None
                    and stream.time_base is not None
                    and stream.duration > 0
                )
                duration = max(durations, default=None)
        return ProbeResult(True, duration, None, None)
    except FileNotFoundError as exc:
        return ProbeResult(False, None, str(exc), "media.not_found")
    except PermissionError as exc:
        return ProbeResult(False, None, str(exc), "media.access_denied")
    except ImportError as exc:
        return ProbeResult(False, None, str(exc), "media.probe_unavailable")
    except Exception as exc:
        return ProbeResult(False, None, str(exc) or type(exc).__name__, "media.unreadable")


def main() -> int:
    for line in sys.stdin.buffer:
        path = Path(json.loads(line))
        result = probe_container(path)
        # The default JSON escaping also makes this pipe independent of the
        # console code page in a Windows release.
        sys.stdout.write(json.dumps(result) + "\n")
        sys.stdout.flush()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
