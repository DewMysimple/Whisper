import { describe, expect, it } from 'vitest';

import type { HardwareCapabilities } from '../contracts/desktop';
import { hardwarePreferenceSupported, recommendedHardwarePreference } from './hardware';

const CAPABILITIES: HardwareCapabilities = {
  cpuName: 'Test CPU',
  cpuPhysicalCores: 2,
  cpuLogicalCores: 4,
  cpuComputeTypes: ['int8', 'float32'],
  gpus: [{ index: 2, name: 'GPU 2', computeTypes: ['float32'] }],
};

describe('hardware preferences', () => {
  it('creates a recommendation that is valid for the reported machine', () => {
    const recommended = recommendedHardwarePreference(CAPABILITIES);

    expect(recommended).toEqual({
      mode: 'auto',
      gpuDeviceIndex: 2,
      cudaComputeType: 'float32',
      cpuComputeType: 'int8',
      cpuThreads: 2,
    });
    expect(hardwarePreferenceSupported(recommended, CAPABILITIES)).toBe(true);
  });

  it('rejects unavailable devices, precision modes and excess CPU threads', () => {
    expect(
      hardwarePreferenceSupported(
        {
          mode: 'cuda',
          gpuDeviceIndex: 0,
          cudaComputeType: 'float16',
          cpuComputeType: 'int8',
          cpuThreads: 2,
        },
        CAPABILITIES,
      ),
    ).toBe(false);
    expect(
      hardwarePreferenceSupported(
        {
          mode: 'cpu',
          gpuDeviceIndex: 2,
          cudaComputeType: 'float32',
          cpuComputeType: 'int8',
          cpuThreads: 3,
        },
        CAPABILITIES,
      ),
    ).toBe(false);
  });
});
