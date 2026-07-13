"""Contracts for Windows CUDA runtime wheel discovery."""

from __future__ import annotations

from types import SimpleNamespace

from whisper_subtitle.infrastructure import cuda_runtime


def test_non_windows_runtime_configuration_is_a_noop(monkeypatch):
    monkeypatch.setattr(cuda_runtime.os, "name", "posix")

    assert cuda_runtime.configure_cuda_runtime() == ()


def test_windows_runtime_registers_each_existing_bin_once(monkeypatch, tmp_path):
    cublas = tmp_path / "nvidia" / "cublas"
    nvrtc = tmp_path / "nvidia" / "cuda_nvrtc"
    (cublas / "bin").mkdir(parents=True)
    (nvrtc / "bin").mkdir(parents=True)
    for library_name in ("cublasLt64_12.dll", "cublas64_12.dll"):
        (cublas / "bin" / library_name).touch()
    locations = {
        "nvidia.cublas": cublas,
        "nvidia.cuda_nvrtc": nvrtc,
    }
    handles = []

    monkeypatch.setattr(cuda_runtime.os, "name", "nt")
    monkeypatch.setattr(
        cuda_runtime.importlib.util,
        "find_spec",
        lambda name: SimpleNamespace(submodule_search_locations=[locations[name]]),
    )
    monkeypatch.setattr(
        cuda_runtime.os,
        "add_dll_directory",
        lambda path: handles.append(path) or SimpleNamespace(path=path),
        raising=False,
    )
    monkeypatch.setattr(cuda_runtime, "_DLL_DIRECTORY_HANDLES", [])
    monkeypatch.setattr(cuda_runtime, "_LOADED_LIBRARIES", [])
    monkeypatch.setattr(cuda_runtime, "_REGISTERED_DIRECTORIES", set())
    loaded_libraries = []
    monkeypatch.setattr(
        cuda_runtime.ctypes,
        "WinDLL",
        lambda path: loaded_libraries.append(path) or SimpleNamespace(path=path),
    )

    first = cuda_runtime.configure_cuda_runtime()
    second = cuda_runtime.configure_cuda_runtime()

    assert first == ((cublas / "bin").resolve(), (nvrtc / "bin").resolve())
    assert second == ()
    assert handles == [str(path) for path in first]
    assert len(cuda_runtime._DLL_DIRECTORY_HANDLES) == 2
    assert loaded_libraries == [
        str(cublas / "bin" / "cublasLt64_12.dll"),
        str(cublas / "bin" / "cublas64_12.dll"),
    ]
    assert len(cuda_runtime._LOADED_LIBRARIES) == 2
