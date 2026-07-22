import type {
  HardwareCapabilities,
  HardwarePreference,
  ResolvedHardware,
} from '../contracts/desktop';

export const DEFAULT_HARDWARE_PREFERENCE: HardwarePreference = {
  mode: 'auto',
  gpuDeviceIndex: 0,
  cudaComputeType: 'float16',
  cpuComputeType: 'int8',
  cpuThreads: 4,
};

export function recommendedHardwarePreference(
  capabilities: HardwareCapabilities | undefined,
): HardwarePreference {
  if (capabilities === undefined) return { ...DEFAULT_HARDWARE_PREFERENCE };
  const gpu = capabilities.gpus[0];
  const cudaComputeType = gpu?.computeTypes.includes('float16')
    ? 'float16'
    : gpu?.computeTypes.includes('int8_float16')
      ? 'int8_float16'
      : 'float32';
  return {
    ...DEFAULT_HARDWARE_PREFERENCE,
    gpuDeviceIndex: gpu?.index ?? 0,
    cudaComputeType,
    cpuComputeType: capabilities.cpuComputeTypes.includes('int8') ? 'int8' : 'float32',
    cpuThreads: Math.min(4, Math.max(1, capabilities.cpuPhysicalCores)),
  };
}

export function hardwarePreferenceSupported(
  preference: HardwarePreference,
  capabilities: HardwareCapabilities | undefined,
): boolean {
  if (capabilities === undefined) return preference.mode === 'auto';
  if (preference.cpuThreads < 1 || preference.cpuThreads > capabilities.cpuPhysicalCores) {
    return false;
  }
  if (preference.mode === 'cpu') {
    return capabilities.cpuComputeTypes.includes(preference.cpuComputeType);
  }
  const gpu = capabilities.gpus.find((item) => item.index === preference.gpuDeviceIndex);
  if (preference.mode === 'cuda') {
    return gpu?.computeTypes.includes(preference.cudaComputeType) ?? false;
  }
  if (capabilities.gpus.length === 0) {
    return capabilities.cpuComputeTypes.includes(preference.cpuComputeType);
  }
  return gpu?.computeTypes.includes(preference.cudaComputeType) ?? false;
}

export function formatResolvedHardware(hardware: ResolvedHardware | undefined): string {
  if (hardware === undefined) return '自动硬件配置';
  if (hardware.device === 'cuda') {
    return `CUDA ${hardware.deviceIndex} · ${hardware.computeType.toUpperCase()}`;
  }
  return `CPU · ${hardware.computeType.toUpperCase()} · ${hardware.cpuThreads} 线程`;
}
