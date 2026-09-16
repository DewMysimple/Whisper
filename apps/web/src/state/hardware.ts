import type { ResolvedHardware } from '../contracts/desktop';

export function formatResolvedHardware(hardware: ResolvedHardware | undefined): string {
  if (hardware === undefined) return '硬件信息不可用';
  if (hardware.device === 'cuda') {
    return `CUDA ${hardware.deviceIndex} · ${hardware.computeType.toUpperCase()}`;
  }
  return `CPU · ${hardware.computeType.toUpperCase()} · ${hardware.cpuThreads} 线程`;
}
