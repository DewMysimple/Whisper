"""Deprecated import path for :mod:`infrastructure.environment_check`."""

from ..infrastructure.environment_check import (
    REQUIRED_MODULES,
    check_environment,
    main,
)


__all__ = ["REQUIRED_MODULES", "check_environment", "main"]


if __name__ == "__main__":
    raise SystemExit(main())
