import schema from '../../../../contracts/desktop_ipc/v1/desktop_ipc.schema.json';
import type { ExecutionOptions, HardwareCapabilities, HardwareDevice } from '../contracts/desktop';

type Rule = { type?: string; enum?: readonly string[]; minimum?: number; maximum?: number };
// The IPC schema is shared with Host/Worker; the UI does not own numeric limits.
export const EXECUTION_RULES = schema.$defs.ExecutionSettings.properties as Record<
  keyof ExecutionOptions,
  Rule
>;

export function isExecutionOptions(value: unknown): value is ExecutionOptions {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return Object.entries(value).every(([key, setting]) => {
    if (!Object.hasOwn(EXECUTION_RULES, key)) return false;
    const rule = EXECUTION_RULES[key as keyof ExecutionOptions];
    if (!rule) return false;
    if (rule.enum) return typeof setting === 'string' && rule.enum.includes(setting);
    return (
      typeof setting === 'number' &&
      Number.isInteger(setting) &&
      setting >= (rule.minimum ?? 0) &&
      setting <= (rule.maximum ?? Infinity)
    );
  });
}

export function executionDevice(
  options: ExecutionOptions,
  capabilities: HardwareCapabilities,
): HardwareDevice | undefined {
  const kind =
    options.device === 'auto' || options.device === undefined
      ? capabilities.devices.some((item) => item.device === 'cuda')
        ? 'cuda'
        : 'cpu'
      : options.device;
  return capabilities.devices.find(
    (item) => item.device === kind && item.deviceIndex === (options.device_index ?? 0),
  );
}

export function executionProblem(
  options: ExecutionOptions,
  capabilities: HardwareCapabilities,
): string | null {
  if (!isExecutionOptions(options)) return '硬件设置字段或范围无效。';
  const device = executionDevice(options, capabilities);
  if (!device) return '所选设备当前不可用，请重新选择设备。';
  if (
    options.compute_type &&
    options.compute_type !== 'auto' &&
    !device.computeTypes.includes(options.compute_type)
  ) {
    return '所选设备不支持该计算精度，请改用自动选择或其他精度。';
  }
  return null;
}

export function readHardwareCapabilities(value: unknown): HardwareCapabilities {
  const result = value as {
    hardware_capabilities?: { cpu_threads?: unknown; devices?: unknown };
    hardware_error?: unknown;
  } | null;
  const capabilities = result?.hardware_capabilities;
  if (
    !capabilities ||
    !Number.isInteger(capabilities.cpu_threads) ||
    Number(capabilities.cpu_threads) < 1 ||
    !Array.isArray(capabilities.devices)
  ) {
    throw new Error(
      typeof result?.hardware_error === 'string'
        ? result.hardware_error
        : '当前 Worker 未提供硬件能力，请使用配套的开发 Worker。',
    );
  }
  const devices: HardwareDevice[] = capabilities.devices.map((entry: unknown) => {
    const device = entry as Record<string, unknown>;
    if (
      !device ||
      !['cpu', 'cuda'].includes(String(device.device)) ||
      !Number.isInteger(device.device_index) ||
      Number(device.device_index) < 0 ||
      typeof device.name !== 'string' ||
      !Array.isArray(device.compute_types) ||
      !device.compute_types.every((type) => typeof type === 'string')
    ) {
      throw new Error('Worker 返回的硬件能力无效。');
    }
    return {
      device: device.device as 'cpu' | 'cuda',
      deviceIndex: Number(device.device_index),
      name: device.name,
      computeTypes: device.compute_types as string[],
    };
  });
  if (!devices.some((device) => device.device === 'cpu' && device.deviceIndex === 0))
    throw new Error('Worker 未提供 CPU 能力。');
  return { cpuThreads: Number(capabilities.cpu_threads), devices };
}
