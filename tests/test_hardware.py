"""Contracts for CTranslate2-backed hardware detection."""

from types import SimpleNamespace

import pytest

from whisper_subtitle.infrastructure.hardware import HardwareDetector, HardwareInfo


def make_ctranslate2(*, cuda_devices, compute_types=()):
    return SimpleNamespace(
        get_cuda_device_count=lambda: cuda_devices,
        get_supported_compute_types=lambda _device, _index=0: set(compute_types),
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


def test_cuda_detection_uses_fp32_as_compatibility_fallback():
    detector = HardwareDetector(
        lambda: make_ctranslate2(cuda_devices=1, compute_types={"float32"}),
        lambda: make_nvml(),
    )

    info = detector.detect()

    assert info.compute_type == "float32"


def test_cuda_detection_rejects_runtime_without_supported_automatic_precision():
    detector = HardwareDetector(
        lambda: make_ctranslate2(cuda_devices=1, compute_types={"int8"}),
        lambda: make_nvml(),
    )

    with pytest.raises(RuntimeError, match="neither float16 nor float32"):
        detector.detect()


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


def configurable_detector():
    supported = {
        ("cpu", 0): {"int8", "int8_float32", "float32"},
        ("cuda", 0): {"float16", "float32", "int8_float16"},
        ("cuda", 1): {"float32", "int8_float32"},
    }
    return HardwareDetector(
        lambda: SimpleNamespace(
            get_cuda_device_count=lambda: 2,
            get_supported_compute_types=lambda device, index: supported[(device, index)],
        ),
        lambda: make_nvml(),
    )


@pytest.mark.parametrize("settings", [{}, {"device": "auto", "compute_type": "auto", "device_index": 0}])
def test_automatic_execution_keeps_existing_cuda_selection(settings):
    detector = configurable_detector()
    assert detector.resolve(settings) == detector.detect()


def test_cpu_automatic_threads_differ_from_explicit_runtime_auto():
    detector = HardwareDetector(lambda: make_ctranslate2(cuda_devices=0))
    assert detector.resolve({}).cpu_threads == 4
    assert detector.resolve({"cpu_threads": 0}).cpu_threads == 0
    assert detector.resolve({"cpu_threads": 12}).cpu_threads == 12


def test_explicit_cpu_and_second_gpu_resolve_supported_precision_and_threads():
    detector = configurable_detector()
    cpu = detector.resolve({"device": "cpu", "compute_type": "int8_float32", "cpu_threads": 6})
    assert (cpu.device, cpu.compute_type, cpu.cpu_threads, cpu.gpu_name) == (
        "cpu", "int8_float32", 6, None,
    )
    cuda = detector.resolve({"device": "cuda", "device_index": 1, "cpu_threads": 2})
    assert (cuda.device, cuda.compute_type, cuda.device_index, cuda.cpu_threads) == (
        "cuda", "float32", 1, 2,
    )
    assert detector.resolve({"device": "cpu"}).cpu_threads == 4
    assert detector.resolve({"device": "cpu", "cpu_threads": 0}).cpu_threads == 0


@pytest.mark.parametrize(
    ("settings", "message"),
    [
        ({"device": "cuda", "device_index": 2}, "unavailable"),
        ({"device": "cpu", "device_index": 1}, "requires device_index 0"),
        ({"device": "cpu", "compute_type": "float16"}, "does not support"),
        ({"device": "cuda", "device_index": 1, "compute_type": "float16"}, "does not support"),
        ({"compute_type": "bfloat16"}, "does not support"),
    ],
)
def test_explicit_execution_rejects_unsupported_configuration_without_fallback(settings, message):
    with pytest.raises(ValueError, match=message):
        configurable_detector().resolve(settings)


def test_explicit_cuda_is_not_silently_changed_to_cpu():
    detector = HardwareDetector(lambda: make_ctranslate2(cuda_devices=0, compute_types={"int8"}))
    with pytest.raises(ValueError, match="CUDA device 0 is unavailable"):
        detector.resolve({"device": "cuda"})


def test_capabilities_report_each_device_supported_types_and_logical_cores(monkeypatch):
    monkeypatch.setattr("whisper_subtitle.infrastructure.hardware.os.cpu_count", lambda: 24)
    result = configurable_detector().capabilities()
    assert result["cpu_threads"] == 24
    assert [(item["device"], item["device_index"], item["compute_types"]) for item in result["devices"]] == [
        ("cpu", 0, ["float32", "int8", "int8_float32"]),
        ("cuda", 0, ["float16", "float32", "int8_float16"]),
        ("cuda", 1, ["float32", "int8_float32"]),
    ]
    assert all(item["name"] for item in result["devices"])
