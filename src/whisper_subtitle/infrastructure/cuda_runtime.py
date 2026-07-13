"""Make CUDA runtime wheels discoverable by the Windows DLL loader."""

from __future__ import annotations

import importlib.util
import os
import ctypes
from pathlib import Path
from typing import Any


_NVIDIA_RUNTIME_PACKAGES = ("nvidia.cublas", "nvidia.cuda_nvrtc")
_DLL_DIRECTORY_HANDLES: list[Any] = []
_LOADED_LIBRARIES: list[Any] = []
_REGISTERED_DIRECTORIES: set[Path] = set()


def configure_cuda_runtime() -> tuple[Path, ...]:
    """Register CUDA wheel ``bin`` directories for the current process.

    NVIDIA's Windows wheels keep native libraries under namespace-package
    directories that are not searched automatically by the Windows loader.
    The returned handles must remain alive, so they are retained at module
    scope for the duration of the process.
    """
    if os.name != "nt" or not hasattr(os, "add_dll_directory"):
        return ()

    added: list[Path] = []
    for package_name in _NVIDIA_RUNTIME_PACKAGES:
        try:
            spec = importlib.util.find_spec(package_name)
        except (ImportError, ModuleNotFoundError):
            spec = None
        if spec is None:
            continue
        for location in spec.submodule_search_locations or ():
            bin_directory = (Path(location) / "bin").resolve()
            if not bin_directory.is_dir() or bin_directory in _REGISTERED_DIRECTORIES:
                continue
            handle = os.add_dll_directory(str(bin_directory))
            _DLL_DIRECTORY_HANDLES.append(handle)
            if package_name == "nvidia.cublas":
                for library_name in ("cublasLt64_12.dll", "cublas64_12.dll"):
                    library_path = bin_directory / library_name
                    if library_path.is_file():
                        _LOADED_LIBRARIES.append(ctypes.WinDLL(str(library_path)))
            _REGISTERED_DIRECTORIES.add(bin_directory)
            added.append(bin_directory)
    return tuple(added)
