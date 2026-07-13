"""Contracts for CTranslate2-backed hardware detection."""

from types import SimpleNamespace

import pytest

from whisper_subtitle.infrastructure.hardware import HardwareDetector, HardwareInfo


def make_ctranslate2(*, cuda_devices, compute_types=()):
    return SimpleNamespace(
        get_cuda_device_count=lambda: cuda_devices,
        get_supported_compute_types=lambda device: (
            set(compute_types) if device == "cuda" else set()
        ),
    )


def make_nvml(*, gpu_name=b"Test GPU", cuda_driver=12080):
    return SimpleNamespace(
        nvmlInit=lambda: None,
        nvmlShutdown=lambda: None,
        nvmlDeviceGetHandleByIndex=lambda index: f"handle-{index}",
        nvmlDeviceGetName=lambda handle: gpu_name,
        nvmlSystemGetCudaDriverVersion_v2=lambda: cuda_driver,
    )


def test_cpu_detection_preserves_historical_inference_settings():
    nvml_calls = []
    detector = HardwareDetector(
        lambda: make_ctranslate2(cuda_devices=0),
        lambda: nvml_calls.append(True),
    )

    assert detector.detect() == HardwareInfo(
        device="cpu",
        compute_type="int8",
        cuda_available=False,
        gpu_name=None,
        cuda_version=None,
        cpu_threads=4,
    )
    assert nvml_calls == []


def test_cuda_detection_uses_ctranslate_capability_and_nvml_metadata():
    detector = HardwareDetector(
        lambda: make_ctranslate2(
            cuda_devices=1,
            compute_types={"float32", "float16", "int8"},
        ),
        lambda: make_nvml(gpu_name=b"Test GPU", cuda_driver=12080),
    )

    assert detector.detect() == HardwareInfo(
        device="cuda",
        compute_type="float16",
        cuda_available=True,
        gpu_name="Test GPU",
        cuda_version="driver 12.8",
        cpu_threads=0,
    )


def test_nvml_metadata_failure_does_not_hide_working_ctranslate_cuda():
    detector = HardwareDetector(
        lambda: make_ctranslate2(cuda_devices=1, compute_types={"float32"}),
        lambda: (_ for _ in ()).throw(RuntimeError("NVML unavailable")),
    )

    info = detector.detect()

    assert info.device == "cuda"
    assert info.compute_type == "float32"
    assert info.gpu_name == "CUDA device 0"
    assert info.cuda_version is None


@pytest.mark.parametrize(
    "kwargs",
    [
        {
            "device": "cuda",
            "compute_type": "float16",
            "cuda_available": False,
            "gpu_name": None,
            "cuda_version": None,
            "cpu_threads": 0,
        },
        {
            "device": "cpu",
            "compute_type": "int8",
            "cuda_available": True,
            "gpu_name": "GPU",
            "cuda_version": "12.8",
            "cpu_threads": 4,
        },
    ],
)
def test_hardware_info_rejects_inconsistent_device_state(kwargs):
    with pytest.raises(ValueError):
        HardwareInfo(**kwargs)
