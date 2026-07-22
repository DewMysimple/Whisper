"""Contracts for CTranslate2-backed hardware detection."""

from types import SimpleNamespace

import pytest

from whisper_subtitle.infrastructure.hardware import HardwareDetector, HardwareInfo


def make_ctranslate2(*, cuda_devices, compute_types=(), cpu_compute_types=()):
    return SimpleNamespace(
        get_cuda_device_count=lambda: cuda_devices,
        get_supported_compute_types=lambda device, _index=0: (
            set(compute_types) if device == "cuda" else set(cpu_compute_types)
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


def test_capabilities_report_each_cuda_device_and_runtime_compute_types(monkeypatch):
    nvml = make_nvml()
    nvml.nvmlDeviceGetName = lambda handle: f"GPU {handle[-1]}".encode()
    detector = HardwareDetector(
        lambda: make_ctranslate2(
            cuda_devices=2,
            compute_types={"float16", "int8_float16", "float32"},
            cpu_compute_types={"int8", "float32"},
        ),
        lambda: nvml,
    )
    monkeypatch.setattr(detector, "_physical_core_count", lambda: 8)

    capabilities = detector.capabilities()

    assert capabilities["cpu_compute_types"] == ["float32", "int8"]
    assert capabilities["gpus"] == [
        {
            "index": 0,
            "name": "GPU 0",
            "compute_types": ["float16", "float32", "int8_float16"],
        },
        {
            "index": 1,
            "name": "GPU 1",
            "compute_types": ["float16", "float32", "int8_float16"],
        },
    ]


def test_explicit_hardware_preferences_are_validated_against_runtime(monkeypatch):
    detector = HardwareDetector(
        lambda: make_ctranslate2(
            cuda_devices=1,
            compute_types={"float16", "int8_float16", "float32"},
            cpu_compute_types={"int8", "float32"},
        ),
        lambda: make_nvml(),
    )
    monkeypatch.setattr(detector, "_physical_core_count", lambda: 8)

    cpu = detector.detect(
        {
            "mode": "cpu",
            "gpu_device_index": 0,
            "cuda_compute_type": "float16",
            "cpu_compute_type": "float32",
            "cpu_threads": 6,
        }
    )
    cuda = detector.detect(
        {
            "mode": "cuda",
            "gpu_device_index": 0,
            "cuda_compute_type": "int8_float16",
            "cpu_compute_type": "int8",
            "cpu_threads": 4,
        }
    )

    assert (cpu.device, cpu.compute_type, cpu.cpu_threads) == ("cpu", "float32", 6)
    assert (cuda.device, cuda.compute_type, cuda.device_index) == (
        "cuda",
        "int8_float16",
        0,
    )

    with pytest.raises(RuntimeError, match="not supported"):
        detector.detect(
            {
                "mode": "cuda",
                "gpu_device_index": 0,
                "cuda_compute_type": "int8",
                "cpu_compute_type": "int8",
                "cpu_threads": 4,
            }
        )
    with pytest.raises(RuntimeError, match="between 1 and 8"):
        detector.detect(
            {
                "mode": "cpu",
                "gpu_device_index": 0,
                "cuda_compute_type": "float16",
                "cpu_compute_type": "int8",
                "cpu_threads": 9,
            }
        )


def test_auto_mode_uses_fp32_as_compatibility_fallback():
    detector = HardwareDetector(
        lambda: make_ctranslate2(cuda_devices=1, compute_types={"float32"}),
        lambda: make_nvml(),
    )

    info = detector.detect(
        {
            "mode": "auto",
            "gpu_device_index": 0,
            "cuda_compute_type": "float16",
            "cpu_compute_type": "int8",
            "cpu_threads": 4,
        }
    )

    assert info.compute_type == "float32"


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
