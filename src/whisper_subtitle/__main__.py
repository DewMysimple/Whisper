"""Module entry point; no arguments starts the desktop GUI."""

import sys

from .cli import main


if __name__ == "__main__":
    arguments = sys.argv[1:] or ["gui"]
    sys.exit(main(arguments))
