from types import SimpleNamespace
from concurrent.futures import ThreadPoolExecutor
import threading

import pytest

from whisper_subtitle.infrastructure.performance import PerformanceMonitor, collect_performance_sample


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


class CountingNvml(FakeNvml):
    def __init__(self):
        self.initializations = 0
        self.shutdowns = 0

    def nvmlInit(self):
        self.initializations += 1

    def nvmlShutdown(self):
        self.shutdowns += 1


def make_monitor(nvml):
    return PerformanceMonitor(
        psutil_loader=lambda: FakePsutil,
        nvml_loader=lambda: nvml,
        cpu_name_loader=lambda: "Test CPU",
        clock=lambda: 1000.0,
    )


def test_monitor_keeps_one_session_and_preserves_standalone_metrics():
    nvml = CountingNvml()
    monitor = make_monitor(nvml)
    assert nvml.initializations == 0
    standalone = collect_performance_sample(
        psutil_loader=lambda: FakePsutil, nvml_loader=lambda: FakeNvml,
        cpu_name_loader=lambda: "Test CPU", clock=lambda: 1000.0,
    )
    try:
        for _ in range(20):
            assert monitor() == standalone
        assert (nvml.initializations, nvml.shutdowns) == (1, 0)
    finally:
        monitor.close()
    monitor.close()
    assert monitor()["gpu_percent"] is None
    assert (nvml.initializations, nvml.shutdowns) == (1, 1)


def test_close_before_first_sample_never_loads_nvml():
    nvml = CountingNvml()
    monitor = make_monitor(nvml)
    monitor.close()
    assert monitor()["cpu_percent"] == 23.4
    assert monitor()["gpu_percent"] is None
    assert (nvml.initializations, nvml.shutdowns) == (0, 0)


def test_failed_initialization_is_not_retried_each_tick_or_shutdown():
    class UnavailableNvml(CountingNvml):
        def nvmlInit(self):
            super().nvmlInit()
            raise RuntimeError("driver unavailable")

    nvml = UnavailableNvml()
    monitor = make_monitor(nvml)
    try:
        for _ in range(3):
            sample = monitor()
            assert sample["gpu_percent"] is None
            assert sample["cpu_percent"] == 23.4
    finally:
        monitor.close()
    assert (nvml.initializations, nvml.shutdowns) == (1, 0)


def test_query_failure_does_not_reinitialize_and_optional_failure_keeps_other_metrics():
    class FlakyNvml(CountingNvml):
        def __init__(self):
            super().__init__()
            self.queries = 0

        def nvmlDeviceGetUtilizationRates(self, handle):
            self.queries += 1
            if self.queries == 1:
                raise RuntimeError("transient query failure")
            return super().nvmlDeviceGetUtilizationRates(handle)

        def nvmlDeviceGetFanSpeed(self, handle):
            raise RuntimeError("fan sensor unavailable")

    nvml = FlakyNvml()
    monitor = make_monitor(nvml)
    try:
        assert monitor()["gpu_percent"] is None
        sample = monitor()
        assert sample["gpu_percent"] == 71.0
        assert sample["gpu_fan_percent"] is None
    finally:
        monitor.close()
    assert (nvml.initializations, nvml.shutdowns) == (1, 1)


def test_concurrent_samples_initialize_only_one_session():
    nvml = CountingNvml()
    monitor = make_monitor(nvml)
    gate = threading.Event()

    def sample():
        assert gate.wait(2)
        return monitor()

    try:
        with ThreadPoolExecutor(max_workers=8) as executor:
            futures = [executor.submit(sample) for _ in range(20)]
            gate.set()
            assert all(future.result(timeout=2)["gpu_percent"] == 71 for future in futures)
        assert (nvml.initializations, nvml.shutdowns) == (1, 0)
    finally:
        monitor.close()
    assert nvml.shutdowns == 1


def test_close_waits_for_inflight_getters_and_shutdown_failure_is_terminal():
    entered, release, closing = threading.Event(), threading.Event(), threading.Event()

    class BlockingNvml(CountingNvml):
        def nvmlDeviceGetUtilizationRates(self, handle):
            entered.set()
            assert release.wait(2)
            assert self.shutdowns == 0
            return super().nvmlDeviceGetUtilizationRates(handle)

        def nvmlShutdown(self):
            super().nvmlShutdown()
            raise RuntimeError("native cleanup failure")

    nvml = BlockingNvml()
    monitor = make_monitor(nvml)

    def close():
        closing.set()
        monitor.close()

    with ThreadPoolExecutor(max_workers=2) as executor:
        sample = executor.submit(monitor)
        try:
            assert entered.wait(2)
            shutdown = executor.submit(close)
            assert closing.wait(2)
            assert not shutdown.done()
            assert nvml.shutdowns == 0
        finally:
            release.set()
        assert sample.result(timeout=2)["gpu_percent"] == 71
        shutdown.result(timeout=2)
    monitor.close()
    assert monitor()["gpu_percent"] is None
    assert (nvml.initializations, nvml.shutdowns) == (1, 1)


@pytest.mark.parametrize("query_failure", [False, True])
def test_standalone_collector_still_releases_each_successful_init(query_failure):
    class MaybeFailingNvml(CountingNvml):
        def nvmlDeviceGetUtilizationRates(self, handle):
            if query_failure:
                raise RuntimeError("query failure")
            return super().nvmlDeviceGetUtilizationRates(handle)

    nvml = MaybeFailingNvml()
    for _ in range(2):
        collect_performance_sample(psutil_loader=lambda: FakePsutil, nvml_loader=lambda: nvml)
    assert (nvml.initializations, nvml.shutdowns) == (2, 2)
