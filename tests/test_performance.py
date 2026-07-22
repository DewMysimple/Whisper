from types import SimpleNamespace

from whisper_subtitle.infrastructure.performance import collect_performance_sample


class FakePsutil:
    @staticmethod
    def cpu_percent(*, interval=None):
        assert interval is None
        return 23.4

    @staticmethod
    def virtual_memory():
        return SimpleNamespace(
            percent=48.5,
            used=8 * 1024**3,
            total=16 * 1024**3,
            available=8 * 1024**3,
        )

    @staticmethod
    def cpu_freq():
        return SimpleNamespace(current=5200.0)

    @staticmethod
    def cpu_count(*, logical):
        return 28 if logical else 20

    @staticmethod
    def pids():
        return list(range(278))

    @staticmethod
    def boot_time():
        return 100.0

    @staticmethod
    def swap_memory():
        return SimpleNamespace(used=2 * 1024**3, total=32 * 1024**3)

    @staticmethod
    def Process():
        return FakeProcess()


class FakeProcess:
    @staticmethod
    def memory_info():
        return SimpleNamespace(rss=512 * 1024**2)

    @staticmethod
    def num_threads():
        return 12

    @staticmethod
    def num_handles():
        return 240


class FakeNvml:
    NVML_TEMPERATURE_GPU = 0
    NVML_CLOCK_GRAPHICS = 0
    NVML_CLOCK_MEM = 2

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
        return SimpleNamespace(gpu=71, memory=34)

    @staticmethod
    def nvmlDeviceGetMemoryInfo(_handle):
        return SimpleNamespace(used=6 * 1024**3, total=16 * 1024**3)

    @staticmethod
    def nvmlDeviceGetName(_handle):
        return b"Test GPU"

    @staticmethod
    def nvmlDeviceGetTemperature(_handle, sensor):
        assert sensor == FakeNvml.NVML_TEMPERATURE_GPU
        return 44

    @staticmethod
    def nvmlDeviceGetClockInfo(_handle, clock):
        return 2700 if clock == FakeNvml.NVML_CLOCK_GRAPHICS else 14001

    @staticmethod
    def nvmlDeviceGetPowerUsage(_handle):
        return 125500

    @staticmethod
    def nvmlDeviceGetEnforcedPowerLimit(_handle):
        return 300000

    @staticmethod
    def nvmlDeviceGetFanSpeed(_handle):
        return 42

    @staticmethod
    def nvmlSystemGetDriverVersion():
        return b"610.62"

    @staticmethod
    def nvmlDeviceGetPerformanceState(_handle):
        return 2


def test_collect_performance_sample_returns_machine_metrics():
    sample = collect_performance_sample(
        psutil_loader=lambda: FakePsutil,
        nvml_loader=lambda: FakeNvml,
        cpu_name_loader=lambda: "Test CPU",
        clock=lambda: 1000.0,
    )

    assert sample["cpu_percent"] == 23.4
    assert sample["memory_percent"] == 48.5
    assert sample["memory_available_gib"] == 8.0
    assert sample["swap_used_gib"] == 2.0
    assert sample["worker_rss_gib"] == 0.5
    assert sample["worker_thread_count"] == 12
    assert sample["worker_handle_count"] == 240
    assert sample["cpu_name"] == "Test CPU"
    assert sample["cpu_frequency_mhz"] == 5200.0
    assert sample["cpu_physical_cores"] == 20
    assert sample["cpu_logical_cores"] == 28
    assert sample["system_process_count"] == 278
    assert sample["system_uptime_seconds"] == 900
    assert sample["gpu_percent"] == 71.0
    assert sample["gpu_memory_controller_percent"] == 34.0
    assert sample["vram_used_gib"] == 6.0
    assert sample["vram_total_gib"] == 16.0
    assert sample["gpu_name"] == "Test GPU"
    assert sample["gpu_temperature_c"] == 44.0
    assert sample["gpu_clock_mhz"] == 2700.0
    assert sample["gpu_memory_clock_mhz"] == 14001.0
    assert sample["gpu_power_watts"] == 125.5
    assert sample["gpu_power_limit_watts"] == 300.0
    assert sample["gpu_fan_percent"] == 42.0
    assert sample["gpu_driver_version"] == "610.62"
    assert sample["gpu_performance_state"] == "P2"


def test_collect_performance_sample_tolerates_unavailable_nvml():
    sample = collect_performance_sample(
        psutil_loader=lambda: FakePsutil,
        nvml_loader=lambda: (_ for _ in ()).throw(RuntimeError("no nvml")),
        cpu_name_loader=lambda: "Test CPU",
    )

    assert sample["cpu_percent"] == 23.4
    assert sample["gpu_percent"] is None
    assert sample["gpu_temperature_c"] is None
