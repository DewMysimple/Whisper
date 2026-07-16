"""Module entry point for the retained headless Python CLI."""

import sys

from .cli import main


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
