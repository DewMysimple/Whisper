from types import SimpleNamespace

from whisper_subtitle.infrastructure.performance import collect_performance_sample


class FakePsutil:
    @staticmethod
    def cpu_percent(*, interval=None):
        assert interval is None
        return 23.4

    @staticmethod
    def virtual_memory():
        return SimpleNamespace(percent=48.5, used=8 * 1024**3, total=16 * 1024**3)


class FakeNvml:
    @staticmethod
    def nvmlInit():
        return None

    @staticmethod
    def nvmlShutdown():
        return None

    @staticmethod
    def nvmlDeviceGetHandleByIndex(index):
        assert index == 0
        return object()

    @staticmethod
    def nvmlDeviceGetUtilizationRates(_handle):
        return SimpleNamespace(gpu=71)

    @staticmethod
    def nvmlDeviceGetMemoryInfo(_handle):
        return SimpleNamespace(used=6 * 1024**3, total=16 * 1024**3)

    @staticmethod
    def nvmlDeviceGetName(_handle):
        return b"Test GPU"


def test_collect_performance_sample_returns_machine_metrics():
    sample = collect_performance_sample(
        psutil_loader=lambda: FakePsutil,
        nvml_loader=lambda: FakeNvml,
    )

    assert sample["cpu_percent"] == 23.4
    assert sample["memory_percent"] == 48.5
    assert sample["gpu_percent"] == 71.0
    assert sample["vram_used_gib"] == 6.0
    assert sample["vram_total_gib"] == 16.0
    assert sample["gpu_name"] == "Test GPU"


def test_collect_performance_sample_tolerates_unavailable_nvml():
    sample = collect_performance_sample(
        psutil_loader=lambda: FakePsutil,
        nvml_loader=lambda: (_ for _ in ()).throw(RuntimeError("no nvml")),
    )

    assert sample["cpu_percent"] == 23.4
    assert sample["gpu_percent"] is None
